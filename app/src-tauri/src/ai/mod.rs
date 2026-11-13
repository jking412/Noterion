mod credentials;
mod deepseek;
mod draft;
mod extract;
mod retrieve;

use crate::store::{AiAdoptResult, AiChoice, SharedStore, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::sync::Notify;
use uuid::Uuid;

const CANCELLED: &str = "AI 操作已取消；输入和已有知识均已保留。";
const MAX_TEXT: usize = 256 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiRequest {
    pub action: String,
    pub text: String,
    pub source_name: Option<String>,
    pub resource_ids: Vec<String>,
    pub session_id: Option<String>,
    pub original_record_id: Option<String>,
    pub allow_supplement: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEvent {
    task_id: String,
    phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<AiResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiResult {
    Extract {
        draft: draft::Draft,
    },
    Search {
        hits: Vec<retrieve::Hit>,
        note: String,
        sources: Vec<retrieve::Source>,
    },
    Answer {
        blocks: Vec<retrieve::AnswerBlock>,
        sources: Vec<retrieve::Source>,
        note: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdoptInput {
    pub draft_id: String,
    pub operation_id: String,
    pub choices: Vec<AiChoice>,
}

#[derive(Clone, Default)]
pub struct AiHost(Arc<Inner>);
#[derive(Default)]
struct Inner {
    tasks: Mutex<HashMap<String, Arc<Cancellation>>>,
    drafts: Mutex<HashMap<String, Arc<draft::StoredDraft>>>,
    sessions: Mutex<HashMap<String, Session>>,
}
#[derive(Clone)]
struct Session {
    root: String,
    epoch: u64,
    history: Vec<Value>,
}
#[derive(Default)]
struct Cancellation {
    flag: AtomicBool,
    wake: Notify,
}
pub(super) struct Task {
    id: String,
    store: SharedStore,
    epoch: u64,
    cancel: Arc<Cancellation>,
    channel: Option<Channel<AiEvent>>,
    received: AtomicUsize,
}
impl Task {
    fn check(&self) -> Result<(), String> {
        if self.cancel.flag.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        let guard = self
            .store
            .lock()
            .map_err(|_| "本地存储正在恢复，请稍后重试。")?;
        if guard.epoch() != self.epoch {
            return Err("数据目录已切换，本次 AI 上下文已失效，请重新操作。".into());
        }
        Ok(())
    }
    fn phase(&self, phase: &str, detail: &str) -> Result<(), String> {
        self.check()?;
        self.send(AiEvent {
            task_id: self.id.clone(),
            phase: phase.into(),
            detail: Some(detail.into()),
            result: None,
            error: None,
        })
    }
    fn delta(&self, delta: &str) -> Result<(), String> {
        self.check()?;
        let old = self
            .received
            .fetch_add(delta.chars().count(), Ordering::Relaxed);
        // JSON contains internal identity handles. Only show progress until decoding and validation finish.
        if old / 160 != (old + delta.chars().count()) / 160 {
            self.send(AiEvent {
                task_id: self.id.clone(),
                phase: "receiving".into(),
                detail: Some(format!(
                    "正在接收模型结果（{} 字）；完成后校验内容与来源。",
                    old + delta.chars().count()
                )),
                result: None,
                error: None,
            })?;
        }
        Ok(())
    }
    fn send(&self, event: AiEvent) -> Result<(), String> {
        if let Some(channel) = &self.channel {
            channel
                .send(event)
                .map_err(|_| "AI 工作区已关闭，本次操作停止。".into())
        } else {
            Ok(())
        }
    }
}

fn context(store: &SharedStore) -> Result<(Snapshot, u64, PathBuf), String> {
    let guard = store.lock().map_err(|_| "本地存储正在恢复，请重试。")?;
    Ok((
        guard.snapshot()?,
        guard.epoch(),
        guard.config_dir().to_owned(),
    ))
}
fn client(directory: &std::path::Path) -> Result<deepseek::DeepSeek, String> {
    let config = credentials::load(directory)?;
    let key = credentials::key(&config, directory)?
        .ok_or("尚未配置 DeepSeek 密钥，请先打开 AI 设置。")?;
    deepseek::DeepSeek::new(config, key)
}

#[tauri::command]
pub fn ai_settings(store: tauri::State<'_, SharedStore>) -> Result<credentials::Settings, String> {
    let directory = store
        .lock()
        .map_err(|_| "本地设置暂时不可用。")?
        .config_dir()
        .to_owned();
    credentials::settings(&directory)
}
#[tauri::command]
pub fn ai_configure(
    store: tauri::State<'_, SharedStore>,
    input: credentials::Configure,
) -> Result<credentials::Settings, String> {
    let directory = store
        .lock()
        .map_err(|_| "本地设置暂时不可用。")?
        .config_dir()
        .to_owned();
    credentials::configure(&directory, input)
}
#[tauri::command]
pub async fn ai_check(store: tauri::State<'_, SharedStore>) -> Result<String, String> {
    let state = store.inner().clone();
    let (_, epoch, directory) = context(&state)?;
    let client = client(&directory)?;
    let task = Task {
        id: Uuid::new_v4().to_string(),
        store: state,
        epoch,
        cancel: Arc::new(Cancellation::default()),
        channel: None,
        received: AtomicUsize::new(0),
    };
    let messages =
        vec![json!({"role":"user","content":"连接检查。请只返回 json 对象 {\"ok\":true}。"})];
    let completion = client.complete(&task, &messages, None, false, true).await?;
    let value: Value = serde_json::from_str(&completion.content)
        .map_err(|_| "连接已响应，但未返回可使用的结构化结果。")?;
    if value["ok"] != true {
        return Err("连接已响应，但可用性检查未通过。".into());
    }
    task.check()?;
    Ok("DeepSeek 连接与结构化输出可用。".into())
}
#[tauri::command]
pub fn ai_start(
    state: tauri::State<'_, AiHost>,
    store: tauri::State<'_, SharedStore>,
    request: AiRequest,
    on_event: Channel<AiEvent>,
) -> Result<String, String> {
    if !["extract", "search", "answer"].contains(&request.action.as_str())
        || request.text.trim().is_empty()
        || request.text.len() > MAX_TEXT
        || request.resource_ids.len() > 16
        || request.source_name.as_ref().is_some_and(|s| s.len() > 800)
    {
        return Err("请输入本次学习文本或问题；文本不能超过 256 KiB，来源最多选择16份。".into());
    }
    if request.action != "extract" && request.text.len() > 12_000 {
        return Err("问题过长，请缩短问题，将学习正文放入解析工作区。".into());
    }
    if request.resource_ids.iter().collect::<HashSet<_>>().len() != request.resource_ids.len() {
        return Err("所选资料重复，请重新选择。".into());
    }
    let store = store.inner().clone();
    let (snapshot, epoch, directory) = context(&store)?;
    let allowed: HashSet<_> = snapshot.resources.iter().map(|r| r.id.as_str()).collect();
    if request
        .resource_ids
        .iter()
        .any(|id| !allowed.contains(id.as_str()))
    {
        return Err("所选资料已不存在，请刷新资料选择。".into());
    }
    let client = client(&directory)?;
    let host = state.inner().clone();
    let id = Uuid::new_v4().to_string();
    let cancel = Arc::new(Cancellation::default());
    {
        let mut tasks = host.0.tasks.lock().map_err(|_| "AI 任务状态暂时不可用。")?;
        if tasks.len() >= 2 {
            return Err("已有 AI 操作正在进行，请完成或取消后再试。".into());
        }
        tasks.insert(id.clone(), cancel.clone());
    }
    let task = Task {
        id: id.clone(),
        store,
        epoch,
        cancel,
        channel: Some(on_event),
        received: AtomicUsize::new(0),
    };
    tauri::async_runtime::spawn(async move {
        let work = run(&host, &task, request, snapshot, directory, client);
        tokio::pin!(work);
        let timeout = tokio::time::sleep(Duration::from_secs(300));
        tokio::pin!(timeout);
        let result = loop {
            tokio::select! {
                value=&mut work=>break value,
                _=task.cancel.wake.notified()=>break Err(CANCELLED.into()),
                _=&mut timeout=>break Err("本次 AI 操作超过五分钟，请缩短文本或稍后重试；已有数据未修改。".into()),
                _=tokio::time::sleep(Duration::from_millis(150))=>if let Err(error)=task.check() {break Err(error)},
            }
        };
        match result {
            Ok(result) => {
                let _ = task.send(AiEvent {
                    task_id: task.id.clone(),
                    phase: "complete".into(),
                    detail: Some("AI 结果已完成校验。".into()),
                    result: Some(result),
                    error: None,
                });
            }
            Err(error) => {
                let cancelled = error == CANCELLED;
                let _ = task.send(AiEvent {
                    task_id: task.id.clone(),
                    phase: if cancelled { "cancelled" } else { "failed" }.into(),
                    detail: None,
                    result: None,
                    error: Some(error),
                });
            }
        }
        if let Ok(mut tasks) = host.0.tasks.lock() {
            tasks.remove(&task.id);
        }
    });
    Ok(id)
}

async fn run(
    host: &AiHost,
    task: &Task,
    request: AiRequest,
    snapshot: Snapshot,
    _directory: PathBuf,
    client: deepseek::DeepSeek,
) -> Result<AiResult, String> {
    task.phase("starting", "正在准备本次允许发送的文本与知识上下文。")?;
    if request.action == "extract" {
        let records = task
            .store
            .lock()
            .map_err(|_| "本地存储暂时不可用。")?
            .ai_records()?;
        let draft = extract::run(&client, task, &request, snapshot, task.epoch, &records).await?;
        task.phase("validating", "正在核对整批身份、主题关系及资料引用。")?;
        {
            let store = task.store.lock().map_err(|_| "本地存储暂时不可用。")?;
            store.validate_candidate_points(&draft.batch.points)?;
        }
        task.check()?;
        let preview = draft.preview.clone();
        let mut drafts = host.0.drafts.lock().map_err(|_| "AI 候选状态不可用。")?;
        if drafts.len() >= 8 {
            if let Some(id) = drafts.keys().next().cloned() {
                drafts.remove(&id);
            }
        }
        drafts.insert(preview.id.clone(), Arc::new(draft));
        return Ok(AiResult::Extract { draft: preview });
    }
    let history = if let Some(id) = &request.session_id {
        let sessions = host.0.sessions.lock().map_err(|_| "AI 会话状态不可用。")?;
        let session = sessions
            .get(id)
            .ok_or("AI 会话已失效，请新建会话后提问。")?;
        if session.root != snapshot.root || session.epoch != task.epoch {
            return Err("AI 会话所属目录已变更，请新建会话。".into());
        }
        session.history.clone()
    } else {
        vec![]
    };
    let mut texts = vec![];
    let mut total = 0;
    for id in &request.resource_ids {
        let resource = snapshot
            .resources
            .iter()
            .find(|r| &r.id == id)
            .ok_or("所选资料不存在。")?;
        let extension = resource
            .filename
            .as_deref()
            .and_then(|n| std::path::Path::new(n).extension())
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ["md", "markdown", "txt"].contains(&extension.as_str()) {
            let text = read_text(&task.store, id)?;
            total += text.len();
            if total > 64 * 1024 {
                return Err("本次选择的文本资料超过64 KiB，请减少选择或先分段解析为知识。".into());
            }
            texts.push((id.clone(), text));
        }
    }
    let result = retrieve::run(&client, task, &request, snapshot.clone(), texts, history).await?;
    task.check()?;
    let current = task
        .store
        .lock()
        .map_err(|_| "本地存储暂时不可用。")?
        .snapshot()?;
    validate_sources(&result, &snapshot, &current)?;
    match result {
        retrieve::Retrieved::Search {
            hits,
            note,
            sources,
        } => Ok(AiResult::Search {
            hits,
            note,
            sources,
        }),
        retrieve::Retrieved::Answer {
            blocks,
            note,
            sources,
            history,
        } => {
            let id = request
                .session_id
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            let mut sessions = host.0.sessions.lock().map_err(|_| "AI 会话状态不可用。")?;
            if sessions.len() >= 8 && !sessions.contains_key(&id) {
                if let Some(old) = sessions.keys().next().cloned() {
                    sessions.remove(&old);
                }
            }
            sessions.insert(
                id.clone(),
                Session {
                    root: snapshot.root,
                    epoch: task.epoch,
                    history,
                },
            );
            Ok(AiResult::Answer {
                blocks,
                note,
                sources,
                session_id: id,
            })
        }
    }
}

fn validate_sources(
    result: &retrieve::Retrieved,
    before: &Snapshot,
    now: &Snapshot,
) -> Result<(), String> {
    let (sources, ids) = match result {
        retrieve::Retrieved::Search { hits, sources, .. } => (
            sources,
            hits.iter().map(|h| h.point_id.as_str()).collect::<Vec<_>>(),
        ),
        retrieve::Retrieved::Answer { sources, .. } => (sources, vec![]),
    };
    for id in ids
        .into_iter()
        .chain(sources.iter().filter_map(|s| s.point_id.as_deref()))
    {
        if before.points.iter().find(|p| p.id == id) != now.points.iter().find(|p| p.id == id) {
            return Err("使用的知识在生成期间已修改或删除，请重新提问。".into());
        }
    }
    for id in sources.iter().filter_map(|s| s.resource_id.as_deref()) {
        if before.resources.iter().find(|r| r.id == id) != now.resources.iter().find(|r| r.id == id)
        {
            return Err("使用的资料在生成期间已修改或删除，请重新提问。".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ai_cancel(state: tauri::State<'_, AiHost>, task_id: String) -> Result<(), String> {
    if let Some(task) = state
        .inner()
        .0
        .tasks
        .lock()
        .map_err(|_| "AI 任务状态不可用。")?
        .get(&task_id)
    {
        task.flag.store(true, Ordering::SeqCst);
        task.wake.notify_one();
    }
    Ok(())
}
#[tauri::command]
pub fn ai_adopt(
    state: tauri::State<'_, AiHost>,
    store: tauri::State<'_, SharedStore>,
    input: AdoptInput,
) -> Result<AiAdoptResult, String> {
    if input.operation_id.is_empty() || input.operation_id.len() > 120 || input.choices.len() > 250
    {
        return Err("采用请求格式不合法。".into());
    }
    let draft = state
        .inner()
        .0
        .drafts
        .lock()
        .map_err(|_| "AI 候选状态不可用。")?
        .get(&input.draft_id)
        .cloned()
        .ok_or("AI 候选已失效，请重新解析后采用。")?;
    // The model only saw selected sources. A user may explicitly attach another
    // real baseline resource while editing; this does not send its contents.
    let authorized: HashSet<_> = draft
        .batch
        .baseline_resources
        .iter()
        .map(|r| r.id.as_str())
        .collect();
    let candidates: HashSet<_> = draft.batch.points.iter().map(|p| p.id.as_str()).collect();
    let existing: HashSet<_> = draft
        .batch
        .baseline_points
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    for choice in &input.choices {
        if !candidates.contains(choice.candidate_id.as_str())
            || choice.point.id != choice.candidate_id
            || choice.point.name.len() > 400
            || choice.point.description.len() > 24_000
            || choice.point.topic_ids.len() > 32
            || choice.point.resource_ids.len() > 32
            || choice
                .point
                .resource_ids
                .iter()
                .any(|id| !authorized.contains(id.as_str()))
            || choice
                .point
                .topic_ids
                .iter()
                .any(|id| !candidates.contains(id.as_str()) && !existing.contains(id.as_str()))
            || choice
                .target_id
                .as_ref()
                .is_some_and(|id| !existing.contains(id.as_str()))
        {
            return Err(
                "候选身份、所属主题、资料或更新目标超出了本次允许范围，请重新核对。".into(),
            );
        }
    }
    let result = store.lock().map_err(|_| "本地存储暂时不可用。")?.adopt_ai(
        draft.copy_batch(),
        input.choices,
        input.operation_id,
    )?;
    // Keep the server-held draft for idempotent retries after a lost IPC response.
    Ok(result)
}
#[tauri::command]
pub fn ai_read_text(
    store: tauri::State<'_, SharedStore>,
    resource_id: String,
) -> Result<String, String> {
    read_text(store.inner(), &resource_id)
}

fn read_text(store: &SharedStore, id: &str) -> Result<String, String> {
    let (path, size) = {
        let guard = store.lock().map_err(|_| "资料暂时不可读。")?;
        let snapshot = guard.snapshot()?;
        let resource = snapshot
            .resources
            .iter()
            .find(|r| r.id == id)
            .ok_or("资料已移除，请刷新。")?;
        let name = resource
            .filename
            .as_deref()
            .ok_or("只能读取已保存的 Markdown/TXT 纯文本资料。")?;
        let extension = std::path::Path::new(name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["md", "markdown", "txt"].contains(&extension.as_str()) {
            return Err(
                "本次仅支持已取得的 Markdown/TXT 纯文本，不读取 PDF、图片或音视频正文。".into(),
            );
        }
        let (path, _, size) = guard.resolve_file(id)?;
        (path, size)
    };
    if size > MAX_TEXT as u64 {
        return Err("文本资料超过256 KiB，请先在外部分段后再解析。".into());
    }
    let file = std::fs::File::open(path).map_err(|_| "无法读取所选纯文本资料。")?;
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(MAX_TEXT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取文本资料中断，原资料未修改。")?;
    if bytes.len() > MAX_TEXT || bytes.len() != size as usize {
        return Err("文本资料在读取期间已变动，请重新选择。".into());
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| "文本不是 UTF-8，请先在外部转换为 UTF-8 的 Markdown/TXT。")?;
    Ok(text.trim_start_matches('\u{feff}').to_owned())
}
