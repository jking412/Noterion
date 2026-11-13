use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use uuid::Uuid;

#[path = "store_ai.rs"]
mod ai_support;
pub use ai_support::{AiAdoptResult, AiBatch, AiChoice, AiRecord};

pub type SharedStore = Arc<Mutex<Store>>;
const DATABASE: &str = "noterion.sqlite3";
const APPLICATION_ID: i32 = 1_313_821_765;

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub topic_ids: Vec<String>,
    #[serde(default)]
    pub resource_ids: Vec<String>,
    pub is_theme: bool,
    pub color: String,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub title: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Facts {
    points: Vec<Point>,
    resources: Vec<Resource>,
    positions: HashMap<String, Position>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub points: Vec<Point>,
    pub resources: Vec<Resource>,
    pub positions: HashMap<String, Position>,
    pub root: String,
    pub revision: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteImpact {
    pub deleted_ids: Vec<String>,
    pub retained_ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct DirectoryConfig {
    root: PathBuf,
}

pub struct CopiedFile {
    pub id: String,
    pub filename: String,
    pub title: String,
    pub mime: String,
    pub kind: String,
    pub size: u64,
}

pub struct Store {
    root: PathBuf,
    config_dir: PathBuf,
    connection: Option<Connection>,
    error: Option<String>,
    epoch: u64,
}

fn disk_error(action: &str, error: impl std::fmt::Display) -> String {
    format!("{action}：{error}")
}
fn unique(values: &mut Vec<String>) {
    let mut seen = HashSet::new();
    values.retain(|value| seen.insert(value.clone()));
}

/// Generated identities form managed paths; only a safe original extension is retained.
pub fn managed_name(id: &str, filename: &str) -> String {
    let extension = Path::new(filename)
        .extension()
        .and_then(|part| part.to_str())
        .filter(|part| part.len() <= 16 && part.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension.is_empty() {
        id.to_owned()
    } else {
        format!("{id}.{extension}")
    }
}

impl Store {
    pub fn new() -> Self {
        let override_dir = std::env::var_os("NOTERION_CONFIG_DIR").map(PathBuf::from);
        let executable_dir = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .unwrap_or_default();
        // Only a directory pointer lives in the user's settings directory. Knowledge
        // and managed copies stay in the installation directory or an explicit choice.
        let config_dir = override_dir
            .clone()
            .or_else(|| {
                std::env::var_os("LOCALAPPDATA").map(|path| PathBuf::from(path).join("Noterion"))
            })
            .unwrap_or_default();
        let root = override_dir.unwrap_or(executable_dir).join("data");
        let mut store = Self {
            root,
            config_dir,
            connection: None,
            error: None,
            epoch: 0,
        };
        if let Err(error) = store.initialize(true) {
            store.error = Some(error);
        }
        store
    }

    fn initialize(&mut self, allow_create: bool) -> Result<(), String> {
        if !self.config_dir.is_absolute() {
            return Err(
                "用户配置目录不可用，无法保存数据目录选择。请检查 LOCALAPPDATA 设置。".into(),
            );
        }
        fs::create_dir_all(&self.config_dir)
            .map_err(|e| disk_error("无法创建用户配置目录，正式数据未转移到其他位置", e))?;
        match fs::read(self.config_dir.join("directory.json")) {
            Ok(bytes) => {
                let config: DirectoryConfig = serde_json::from_slice(&bytes)
                    .map_err(|e| disk_error("数据目录配置无法读取，请重新选择已有目录", e))?;
                let (root, connection) = open_store(&config.root, false)?;
                self.root = root;
                self.connection = Some(connection);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !allow_create {
                    return Err(
                        "数据目录配置缺失，未创建新数据。请选择原数据目录，或明确创建新数据。"
                            .into(),
                    );
                }
                // Configuration absence never authorizes overwriting a nonempty directory.
                let create = !self.root.join(DATABASE).exists();
                let (root, connection) = open_store(&self.root, create)?;
                save_config(&self.config_dir, &root)?;
                self.root = root;
                self.connection = Some(connection);
            }
            Err(error) => return Err(disk_error("数据目录配置无法读取", error)),
        }
        self.snapshot()?;
        self.epoch = self.epoch.wrapping_add(1);
        Ok(())
    }

    fn ensure_available(&self) -> Result<(), String> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        if self.connection.is_none() {
            return Err("正式存储尚未打开，请选择数据目录。".into());
        }
        let canonical = fs::canonicalize(&self.root).map_err(|e| {
            disk_error(
                "当前数据目录不可用，未创建空库，请重新连接或选择已有目录",
                e,
            )
        })?;
        if canonical != self.root || !self.root.join(DATABASE).is_file() {
            return Err("当前数据目录或正式数据库已移走，未创建空库，请重新打开已有目录。".into());
        }
        Ok(())
    }

    pub fn files_dir(&self) -> Result<PathBuf, String> {
        self.ensure_available()?;
        let files = self.root.join("files");
        let canonical = fs::canonicalize(&files)
            .map_err(|e| disk_error("资料保存目录不可用，未重新创建", e))?;
        if canonical != files {
            return Err("资料保存目录已被重定向，请恢复原目录后重试。".into());
        }
        Ok(files)
    }

    pub fn snapshot(&self) -> Result<Snapshot, String> {
        self.ensure_available()?;
        let (facts, revision) = read_facts(self.connection.as_ref().unwrap())?;
        Ok(make_snapshot(&self.root, facts, revision))
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    fn mutate(
        &mut self,
        edit: impl FnOnce(&mut Facts, u64) -> Result<(), String>,
    ) -> Result<Snapshot, String> {
        self.ensure_available()?;
        let root = self.root.clone();
        let transaction = self
            .connection
            .as_mut()
            .unwrap()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| disk_error("无法开始保存，原有内容未修改", e))?;
        let (mut facts, revision) = read_facts(&transaction)?;
        edit(&mut facts, revision)?;
        validate_facts(&facts)?;
        let next_revision = revision
            .checked_add(1)
            .ok_or("数据版本已超出可保存范围。")?;
        let sqlite_revision =
            i64::try_from(next_revision).map_err(|_| "数据版本已超出可保存范围。")?;
        let serialized =
            serde_json::to_string(&facts).map_err(|e| disk_error("无法整理待保存内容", e))?;
        transaction
            .execute(
                "UPDATE noterion_state SET revision=?1, facts=?2 WHERE singleton=1",
                params![sqlite_revision, serialized],
            )
            .map_err(|e| disk_error("正式保存失败，原有内容未修改", e))?;
        transaction
            .commit()
            .map_err(|e| disk_error("正式提交失败，请检查磁盘和目录权限", e))?;
        Ok(make_snapshot(&root, facts, next_revision))
    }

    fn select_directory(&mut self, path: &Path, create: bool) -> Result<Snapshot, String> {
        let (root, connection) = open_store(path, create)?;
        let (facts, revision) = read_facts(&connection)?;
        // Persist the choice before replacing the active connection and facts.
        save_config(&self.config_dir, &root)?;
        self.root = root;
        self.connection = Some(connection);
        self.error = None;
        self.epoch = self.epoch.wrapping_add(1);
        Ok(make_snapshot(&self.root, facts, revision))
    }

    pub fn resolve_file(&self, id: &str) -> Result<(PathBuf, String, u64), String> {
        let snapshot = self.snapshot()?;
        let resource = snapshot
            .resources
            .iter()
            .find(|r| r.id == id)
            .ok_or("这份资料已移除，请刷新资料库。")?;
        if resource.kind == "link" {
            return Err("这是链接资料，请使用外部打开。".into());
        }
        let filename = resource.filename.as_ref().ok_or("资料文件信息不完整。")?;
        let path = self.files_dir()?.join(managed_name(id, filename));
        let canonical = fs::canonicalize(&path)
            .map_err(|e| disk_error("管理目录中的资料文件缺失或不可读", e))?;
        if canonical != path {
            return Err("资料文件路径已被重定向，不能打开。".into());
        }
        let metadata = fs::metadata(&path).map_err(|e| disk_error("资料文件无法读取", e))?;
        if !metadata.is_file() || resource.size != Some(metadata.len()) {
            return Err("资料文件缺失或长度已改变，请重新添加原文件。".into());
        }
        Ok((
            path,
            resource
                .mime
                .clone()
                .unwrap_or_else(|| "application/octet-stream".into()),
            metadata.len(),
        ))
    }

    pub fn add_copied_file(
        &mut self,
        file: CopiedFile,
        point_ids: Vec<String>,
    ) -> Result<Snapshot, String> {
        let CopiedFile {
            id,
            filename,
            title,
            mime,
            kind,
            size,
        } = file;
        if Uuid::parse_str(&id).is_err()
            || filename.is_empty()
            || Path::new(&filename)
                .file_name()
                .and_then(|name| name.to_str())
                != Some(filename.as_str())
        {
            return Err("资料文件信息无效，请重新选择文件。".into());
        }
        let destination = self.files_dir()?.join(managed_name(&id, &filename));
        let canonical =
            fs::canonicalize(&destination).map_err(|e| disk_error("文件副本尚未完整保存", e))?;
        let metadata =
            fs::metadata(&destination).map_err(|e| disk_error("文件副本尚未完整保存", e))?;
        if canonical != destination || !metadata.is_file() || metadata.len() != size {
            return Err("文件副本尚未完整保存，未创建正式资料记录。".into());
        }
        let resource = Resource {
            id,
            title: title.trim().to_owned(),
            kind,
            url: None,
            filename: Some(filename),
            mime: Some(mime),
            size: Some(size),
            status: None,
        };
        self.mutate(move |facts, _| {
            ensure_point_ids(facts, &point_ids)?;
            if facts.resources.iter().any(|r| r.id == resource.id) {
                return Err("资料已存在，请刷新资料库。".into());
            }
            associate_new(facts, &resource.id, &point_ids);
            facts.resources.push(resource);
            Ok(())
        })
    }
}

fn read_facts(connection: &Connection) -> Result<(Facts, u64), String> {
    let (serialized, sqlite_revision): (String, i64) = connection
        .query_row(
            "SELECT facts, revision FROM noterion_state WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| disk_error("正式存储读取失败，未显示为空库", e))?;
    let revision =
        u64::try_from(sqlite_revision).map_err(|_| "正式数据版本无效，未显示为空库。")?;
    let facts: Facts = serde_json::from_str(&serialized)
        .map_err(|e| disk_error("正式数据内容损坏，未显示为空库", e))?;
    validate_facts(&facts)?;
    Ok((facts, revision))
}

fn make_snapshot(root: &Path, mut facts: Facts, revision: u64) -> Snapshot {
    for resource in &mut facts.resources {
        let ready = resource.kind == "link"
            || resource.filename.as_ref().is_some_and(|name| {
                let path = root.join("files").join(managed_name(&resource.id, name));
                fs::canonicalize(&path).ok().as_ref() == Some(&path)
                    && fs::metadata(&path)
                        .is_ok_and(|meta| meta.is_file() && Some(meta.len()) == resource.size)
            });
        resource.status = Some(if ready { "ready" } else { "missing" }.into());
    }
    Snapshot {
        points: facts.points,
        resources: facts.resources,
        positions: facts.positions,
        root: root.to_string_lossy().into_owned(),
        revision,
    }
}

fn valid_point_color(color: &str) -> bool {
    ["docker", "linux", "mysql", "concurrency", "neutral"].contains(&color)
        || (color.len() == 7
            && color.starts_with('#')
            && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit))
}

fn validate_facts(facts: &Facts) -> Result<(), String> {
    let by_id: HashMap<&str, &Point> = facts
        .points
        .iter()
        .map(|point| (point.id.as_str(), point))
        .collect();
    let resources: HashSet<&str> = facts
        .resources
        .iter()
        .map(|resource| resource.id.as_str())
        .collect();
    if by_id.len() != facts.points.len() || resources.len() != facts.resources.len() {
        return Err("正式数据存在重复身份，无法保存。".into());
    }
    for resource in &facts.resources {
        if Uuid::parse_str(&resource.id).is_err()
            || resource.title.trim().is_empty()
            || ![
                "text", "markdown", "html", "link", "image", "pdf", "video", "file",
            ]
            .contains(&resource.kind.as_str())
        {
            return Err("学习资料信息无效，请检查名称和类型。".into());
        }
        if resource.kind == "link" {
            validate_url(resource.url.as_deref().unwrap_or(""))?;
        } else if resource.filename.as_deref().is_none_or(str::is_empty)
            || resource.size.is_none()
            || resource.mime.as_deref().is_none_or(str::is_empty)
        {
            return Err("正式资料记录缺少文件信息。".into());
        }
    }
    let mut remaining = HashMap::new();
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for point in &facts.points {
        if Uuid::parse_str(&point.id).is_err() || point.name.trim().is_empty() {
            return Err("知识点名称不能为空。".into());
        }
        if !valid_point_color(&point.color) {
            return Err("知识点颜色无效。".into());
        }
        let topics: HashSet<&str> = point.topic_ids.iter().map(String::as_str).collect();
        if topics.len() != point.topic_ids.len()
            || point.resource_ids.iter().collect::<HashSet<_>>().len() != point.resource_ids.len()
        {
            return Err("所属主题或资料关联重复。".into());
        }
        if topics.contains(point.id.as_str()) {
            return Err("知识点不能属于自己。".into());
        }
        for topic_id in &point.topic_ids {
            let topic = by_id
                .get(topic_id.as_str())
                .ok_or_else(|| format!("“{}”引用的所属主题已不存在，请重新选择。", point.name))?;
            if !topic.is_theme {
                return Err(format!(
                    "“{}”被“{}”用作所属主题，但尚未设置为可作为主题。请启用其主题角色或修正该归属。",
                    topic.name, point.name
                ));
            }
            children.entry(topic_id).or_default().push(&point.id);
        }
        if point
            .resource_ids
            .iter()
            .any(|id| !resources.contains(id.as_str()))
        {
            return Err("关联资料已移除，请重新选择。".into());
        }
        remaining.insert(point.id.as_str(), topics.len());
    }
    // Kahn traversal rejects arbitrary-length cycles without recursion depth limits.
    let mut queue: VecDeque<&str> = remaining
        .iter()
        .filter_map(|(id, count)| (*count == 0).then_some(*id))
        .collect();
    let mut visited = 0;
    while let Some(id) = queue.pop_front() {
        visited += 1;
        for child in children.get(id).into_iter().flatten() {
            let count = remaining.get_mut(child).unwrap();
            *count -= 1;
            if *count == 0 {
                queue.push_back(child);
            }
        }
    }
    if visited != facts.points.len() {
        return Err("这组所属主题会形成循环，请重新选择。".into());
    }
    if facts.positions.iter().any(|(id, position)| {
        !by_id.contains_key(id.as_str()) || !position.x.is_finite() || !position.y.is_finite()
    }) {
        return Err("节点位置无效，请重新读取图谱。".into());
    }
    Ok(())
}

fn validate_url(raw: &str) -> Result<String, String> {
    let url =
        tauri::Url::parse(raw.trim()).map_err(|_| "请输入有效的 http:// 或 https:// 网页地址。")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("请输入不含账号密码的 http:// 或 https:// 网页地址。".into());
    }
    Ok(url.to_string())
}
fn ensure_point_ids(facts: &Facts, ids: &[String]) -> Result<(), String> {
    if ids
        .iter()
        .any(|id| !facts.points.iter().any(|point| point.id == *id))
    {
        return Err("要关联的知识点已移除，请重新选择。".into());
    }
    Ok(())
}
fn associate_new(facts: &mut Facts, resource_id: &str, point_ids: &[String]) {
    for point in &mut facts.points {
        if point_ids.contains(&point.id) && !point.resource_ids.iter().any(|id| id == resource_id) {
            point.resource_ids.push(resource_id.to_owned());
        }
    }
}
fn deletion_impact(facts: &Facts, id: &str) -> Result<DeleteImpact, String> {
    if !facts.points.iter().any(|point| point.id == id) {
        return Err("这个知识点已移除，请重新读取图谱。".into());
    }
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for point in &facts.points {
        for parent in &point.topic_ids {
            children.entry(parent).or_default().push(&point.id);
        }
    }
    let mut affected = HashSet::from([id]);
    let mut queue = VecDeque::from([id]);
    while let Some(parent) = queue.pop_front() {
        for child in children.get(parent).into_iter().flatten() {
            if affected.insert(child) {
                queue.push_back(child);
            }
        }
    }
    let mut deleted = HashSet::from([id]);
    loop {
        let before = deleted.len();
        for point in &facts.points {
            if affected.contains(point.id.as_str())
                && !point.topic_ids.is_empty()
                && point
                    .topic_ids
                    .iter()
                    .all(|parent| deleted.contains(parent.as_str()))
            {
                deleted.insert(point.id.as_str());
            }
        }
        if before == deleted.len() {
            break;
        }
    }
    Ok(DeleteImpact {
        deleted_ids: facts
            .points
            .iter()
            .filter(|point| deleted.contains(point.id.as_str()))
            .map(|point| point.id.clone())
            .collect(),
        retained_ids: facts
            .points
            .iter()
            .filter(|point| {
                affected.contains(point.id.as_str()) && !deleted.contains(point.id.as_str())
            })
            .map(|point| point.id.clone())
            .collect(),
    })
}

fn open_store(path: &Path, create: bool) -> Result<(PathBuf, Connection), String> {
    if !path.is_absolute() {
        return Err("请选择本机绝对路径的数据目录。".into());
    }
    if create {
        match fs::read_dir(path) {
            Ok(mut entries) => {
                if entries.next().is_some() {
                    return Err(
                        "该目录已有内容。请打开已有数据，或为新数据选择空目录；未覆盖任何内容。"
                            .into(),
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir_all(path).map_err(|e| disk_error("无法创建数据目录", e))?;
            }
            Err(error) => return Err(disk_error("无法访问数据目录", error)),
        }
    } else if !path.is_dir() || !path.join(DATABASE).is_file() {
        return Err(
            "此目录没有可打开的 Noterion 正式数据，未创建空库。请选择原数据目录或明确创建新数据。"
                .into(),
        );
    }
    let root = fs::canonicalize(path).map_err(|e| disk_error("数据目录不可用", e))?;
    let database = root.join(DATABASE);
    if !create
        && fs::canonicalize(&database).map_err(|e| disk_error("数据库不可读", e))? != database
    {
        return Err("数据库路径已被重定向，无法打开。".into());
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | if create {
            OpenFlags::SQLITE_OPEN_CREATE
        } else {
            OpenFlags::empty()
        };
    let mut connection = Connection::open_with_flags(&database, flags)
        .map_err(|e| disk_error("无法打开正式存储，请检查目录权限", e))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|e| disk_error("无法配置正式存储", e))?;
    if create {
        fs::create_dir(root.join("files")).map_err(|e| disk_error("无法创建资料目录", e))?;
        let transaction = connection
            .transaction()
            .map_err(|e| disk_error("无法初始化正式存储", e))?;
        transaction.execute_batch(&format!("PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version=2; CREATE TABLE noterion_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0), facts TEXT NOT NULL); {}", ai_support::AI_SCHEMA))
            .map_err(|e| disk_error("无法初始化正式存储", e))?;
        transaction
            .execute(
                "INSERT INTO noterion_state VALUES(1,0,?1)",
                [serde_json::to_string(&Facts::default()).unwrap()],
            )
            .map_err(|e| disk_error("无法初始化正式存储", e))?;
        transaction
            .commit()
            .map_err(|e| disk_error("初始化正式存储失败", e))?;
    }
    let application_id: i32 = connection
        .query_row("PRAGMA application_id", [], |row| row.get(0))
        .map_err(|e| disk_error("无法识别正式存储", e))?;
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| disk_error("无法读取存储版本", e))?;
    if application_id != APPLICATION_ID || ![1, 2].contains(&version) {
        return Err("此数据库不属于当前版本的 Noterion，未修改内容。".into());
    }
    let files = root.join("files");
    if fs::canonicalize(&files).map_err(|e| disk_error("资料目录缺失，未重新创建", e))? != files
    {
        return Err("资料目录已被重定向，无法打开。".into());
    }
    // Validate the old authoritative content and file directory before any migration
    // or journal-mode change. An unrelated or corrupt database is never upgraded.
    read_facts(&connection)?;
    ai_support::prepare_schema(&mut connection)?;
    connection
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;")
        .map_err(|e| disk_error("数据目录不可写或不能可靠提交，请选择可写位置", e))?;
    Ok((root, connection))
}

fn save_config(directory: &Path, root: &Path) -> Result<(), String> {
    let target = directory.join("directory.json");
    let temporary = directory.join(format!(".directory-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| disk_error("无法保存数据目录选择，请检查程序目录写权限", e))?;
        let bytes = serde_json::to_vec(&DirectoryConfig {
            root: root.to_owned(),
        })
        .map_err(|e| disk_error("无法保存数据目录选择", e))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| disk_error("无法完整保存数据目录选择", e))?;
        drop(file);
        replace_file(&temporary, &target)
            .map_err(|e| disk_error("无法提交数据目录选择，原选择保持不变", e))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(source: *const u16, target: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // REPLACE_EXISTING | WRITE_THROUGH keeps a valid old choice until the rename.
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0x1 | 0x8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}
fn lock_store(state: &SharedStore) -> Result<std::sync::MutexGuard<'_, Store>, String> {
    state
        .lock()
        .map_err(|_| "本地存储暂时不可用，请重启应用后重试。".into())
}

#[tauri::command]
pub fn app_load(state: tauri::State<'_, SharedStore>) -> Result<Snapshot, String> {
    let mut store = lock_store(&state)?;
    if store.error.is_some() && store.config_dir.join("directory.json").is_file() {
        // A directory disconnected at startup may have returned. Retry only the
        // persisted choice; missing settings never authorize creating a new store.
        store.error = None;
        store.connection = None;
        if let Err(error) = store.initialize(false) {
            store.error = Some(error);
        }
    }
    store.snapshot()
}

#[tauri::command]
pub fn ai_records(state: tauri::State<'_, SharedStore>) -> Result<Vec<AiRecord>, String> {
    lock_store(&state)?.ai_records()
}
#[tauri::command]
pub fn directory_select(
    path: String,
    create: bool,
    state: tauri::State<'_, SharedStore>,
) -> Result<Snapshot, String> {
    lock_store(&state)?.select_directory(Path::new(&path), create)
}
#[tauri::command]
pub fn point_save(
    mut point: Point,
    creating: bool,
    state: tauri::State<'_, SharedStore>,
) -> Result<Snapshot, String> {
    let mut store = lock_store(&state)?;
    point.name = point.name.trim().to_owned();
    unique(&mut point.topic_ids);
    unique(&mut point.resource_ids);
    if creating {
        point.id = Uuid::new_v4().to_string();
    }
    store.mutate(move |facts, _| {
        let existing = facts.points.iter().position(|item| item.id == point.id);
        if creating {
            facts.points.push(point);
        } else if let Some(index) = existing {
            facts.points[index] = point;
        } else {
            return Err("这个知识点已移除，请重新读取后再编辑。".into());
        }
        Ok(())
    })
}
#[tauri::command]
pub fn delete_preview(
    id: String,
    state: tauri::State<'_, SharedStore>,
) -> Result<DeleteImpact, String> {
    let store = lock_store(&state)?;
    store.ensure_available()?;
    let (facts, _) = read_facts(store.connection.as_ref().unwrap())?;
    deletion_impact(&facts, &id)
}
#[tauri::command]
pub fn point_delete(
    id: String,
    revision: u64,
    state: tauri::State<'_, SharedStore>,
) -> Result<Snapshot, String> {
    lock_store(&state)?.mutate(move |facts, current_revision| {
        if revision != current_revision {
            return Err("知识内容已改变，请关闭并重新查看删除影响后再确认。".into());
        }
        let impact = deletion_impact(facts, &id)?;
        let deleted: HashSet<String> = impact.deleted_ids.into_iter().collect();
        facts.points.retain(|point| !deleted.contains(&point.id));
        for point in &mut facts.points {
            point.topic_ids.retain(|parent| !deleted.contains(parent));
        }
        facts
            .positions
            .retain(|point_id, _| !deleted.contains(point_id));
        // All resource records and managed files survive knowledge deletion.
        Ok(())
    })
}
#[tauri::command]
pub fn resource_add_link(
    title: String,
    url: String,
    point_ids: Vec<String>,
    state: tauri::State<'_, SharedStore>,
) -> Result<Snapshot, String> {
    let url = validate_url(&url)?;
    let resource = Resource {
        id: Uuid::new_v4().to_string(),
        title: title.trim().to_owned(),
        kind: "link".into(),
        url: Some(url),
        filename: None,
        mime: None,
        size: None,
        status: None,
    };
    lock_store(&state)?.mutate(move |facts, _| {
        ensure_point_ids(facts, &point_ids)?;
        associate_new(facts, &resource.id, &point_ids);
        facts.resources.push(resource);
        Ok(())
    })
}
#[tauri::command]
pub fn resource_associate(
    id: String,
    point_ids: Vec<String>,
    state: tauri::State<'_, SharedStore>,
) -> Result<Snapshot, String> {
    lock_store(&state)?.mutate(move |facts, _| {
        if !facts.resources.iter().any(|resource| resource.id == id) {
            return Err("这份资料已移除，请刷新资料库。".into());
        }
        ensure_point_ids(facts, &point_ids)?;
        for point in &mut facts.points {
            point.resource_ids.retain(|resource_id| resource_id != &id);
            if point_ids.contains(&point.id) {
                point.resource_ids.push(id.clone());
            }
        }
        Ok(())
    })
}
#[tauri::command]
pub fn resource_remove(
    id: String,
    state: tauri::State<'_, SharedStore>,
) -> Result<Snapshot, String> {
    lock_store(&state)?.mutate(move |facts, _| {
        if !facts.resources.iter().any(|resource| resource.id == id) {
            return Err("这份资料已移除，请刷新资料库。".into());
        }
        facts.resources.retain(|resource| resource.id != id);
        for point in &mut facts.points {
            point.resource_ids.retain(|resource_id| resource_id != &id);
        }
        Ok(())
    })
}
#[tauri::command]
pub fn point_move(
    id: String,
    position: Position,
    state: tauri::State<'_, SharedStore>,
) -> Result<Snapshot, String> {
    lock_store(&state)?.mutate(move |facts, _| {
        if !facts.points.iter().any(|point| point.id == id) {
            return Err("知识点已移除，位置未保存。".into());
        }
        facts.positions.insert(id, position);
        Ok(())
    })
}
