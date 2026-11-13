use super::{
    credentials::{ConnectionConfig, ProviderKind},
    Task,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    time::Duration,
};

const MAX_RESPONSE: usize = 2 * 1024 * 1024;
const MAX_CONTENT: usize = 1024 * 1024;
const MAX_TOOL_ARGUMENTS: usize = 16_384;
const ANTHROPIC_VERSION: &str = "2026-10-21";

/// One immutable connection and credential, captured before a task starts.
pub struct Provider {
    http: reqwest::Client,
    config: ConnectionConfig,
    secret: String,
}

#[derive(Clone, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub function: Function,
}
#[derive(Clone, Deserialize)]
pub struct Function {
    pub name: String,
    pub arguments: String,
}
pub struct Completion {
    pub content: String,
    pub tools: Vec<ToolCall>,
    // Internal canonical messages use Chat Completions' text/function shape.
    // Anthropic conversion happens only at the network boundary.
    pub message: Value,
}
#[derive(Debug)]
struct Failure {
    message: String,
    retry: bool,
}

impl Provider {
    pub fn new(config: ConnectionConfig, secret: String) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "无法建立安全的模型连接。")?;
        Ok(Self {
            http,
            config,
            secret,
        })
    }

    pub async fn complete(
        &self,
        task: &Task,
        messages: &[Value],
        tools: Option<Value>,
        required: bool,
        as_json: bool,
    ) -> Result<Completion, String> {
        if serde_json::to_vec(messages)
            .map_err(|_| "无法整理 AI 上下文。")?
            .len()
            > 320_000
        {
            return Err("本次 AI 上下文过长，请缩短输入或新建会话。".into());
        }
        let body = request_body(&self.config, messages, tools, required, as_json)?;
        for attempt in 0..3 {
            task.check()?;
            match self.once(Some(task), &body).await {
                Ok(completion) => {
                    if required && completion.tools.is_empty() {
                        return Err("当前服务或模型未执行必需的工具调用。查找与问答需要支持工具的模型，请更换模型后重试。".into());
                    }
                    return Ok(completion);
                }
                Err(error) if error.retry && attempt < 2 => {
                    task.phase(
                        "retrying",
                        "连接暂时不可用，正在有限重试；尚未采用任何知识。",
                    )?;
                    tokio::time::sleep(Duration::from_millis(500 * (1 << attempt))).await;
                }
                Err(error) => return Err(error.message),
            }
        }
        Err("模型调用未完成。".into())
    }

    async fn once(&self, task: Option<&Task>, body: &Value) -> Result<Completion, Failure> {
        let anthropic = self.config.provider == ProviderKind::Anthropic;
        let suffix = if anthropic {
            "messages"
        } else {
            "chat/completions"
        };
        let mut request = self.http.post(format!("{}/{suffix}", self.config.base_url));
        request = if anthropic {
            request
                .header("x-api-key", &self.secret)
                .header("anthropic-version", ANTHROPIC_VERSION)
        } else {
            request.bearer_auth(&self.secret)
        };
        let mut response = request.json(body).send().await.map_err(|e| Failure {
            message: if e.is_timeout() {
                "模型连接超时，请检查网络后重试。"
            } else {
                "无法连接模型服务，请检查网络与连接地址。"
            }
            .into(),
            retry: true,
        })?;
        let status = response.status().as_u16();
        if status != 200 {
            // Do not echo provider bodies: proxies can include credentials or prompts.
            return Err(http_failure(status));
        }
        let is_sse = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.contains("text/event-stream"));
        let mut total = 0usize;
        let mut buffer = Vec::new();
        let mut stream = Stream::new(anthropic);
        let mut frame = SseFrame::default();
        while let Some(chunk) = tokio::time::timeout(Duration::from_secs(45), response.chunk())
            .await
            .map_err(|_| Failure {
                message: "模型长时间没有响应，请重试。".into(),
                retry: true,
            })?
            .map_err(|_| Failure {
                message: "模型响应中断，本次未完成，请重试。".into(),
                retry: true,
            })?
        {
            check(task)?;
            total = total.saturating_add(chunk.len());
            if total > MAX_RESPONSE {
                return Err(invalid("模型响应超出本次安全上限，请缩短输入。"));
            }
            buffer.extend_from_slice(&chunk);
            if is_sse {
                while let Some(index) = buffer.iter().position(|b| *b == b'\n') {
                    let line: Vec<_> = buffer.drain(..=index).collect();
                    let line = std::str::from_utf8(&line)
                        .map_err(|_| invalid("模型返回了无法读取的文本。"))?
                        .trim_end_matches(['\r', '\n']);
                    if let Some(data) = frame.line(line)? {
                        stream.event(&data)?;
                    }
                    if stream.done() {
                        break;
                    }
                }
                if buffer.len() > 256 * 1024 {
                    return Err(invalid("模型流式片段过大，本次未完成。"));
                }
                if stream.done() {
                    break;
                }
            }
        }
        check(task)?;
        if !is_sse {
            let value: Value =
                serde_json::from_slice(&buffer).map_err(|_| invalid("模型返回的响应格式无效。"))?;
            return if anthropic {
                anthropic_completion(&value)
            } else {
                openai_completion(&value)
            };
        }
        stream.finish()
    }
}

fn check(task: Option<&Task>) -> Result<(), Failure> {
    if let Some(task) = task {
        task.check().map_err(|message| Failure {
            message,
            retry: false,
        })?;
    }
    Ok(())
}

fn request_body(
    config: &ConnectionConfig,
    messages: &[Value],
    tools: Option<Value>,
    required: bool,
    as_json: bool,
) -> Result<Value, String> {
    if config.provider == ProviderKind::Anthropic {
        return anthropic_request(config, messages, tools, required, as_json);
    }
    // Do not guess a compatibility server's JSON mode, reasoning, sampling or token
    // parameter support. Business prompts request JSON; Rust validates every result.
    let mut messages = messages.to_vec();
    if as_json {
        messages.push(json!({"role":"user", "content":"请只返回符合上述契约的完整 JSON 对象，不要 Markdown 代码围栏或额外文字。"}));
    }
    let mut body = json!({"model":config.model, "messages":messages, "stream":true});
    if config.provider == ProviderKind::Deepseek {
        body["thinking"] = json!({"type":"disabled"});
        body["max_tokens"] = json!(8192);
        if as_json {
            body["response_format"] = json!({"type":"json_object"});
        }
    }
    if let Some(tools) = tools {
        body["tools"] = tools;
        body["tool_choice"] = json!(if as_json {
            "none"
        } else if required {
            "required"
        } else {
            "auto"
        });
    }
    Ok(body)
}

fn anthropic_request(
    config: &ConnectionConfig,
    messages: &[Value],
    tools: Option<Value>,
    required: bool,
    as_json: bool,
) -> Result<Value, String> {
    let mut system = Vec::new();
    let mut converted: Vec<Value> = Vec::new();
    for message in messages {
        let role = message["role"].as_str().ok_or("无法整理消息角色。")?;
        let text = message["content"].as_str().unwrap_or("");
        if role == "system" {
            if !text.is_empty() {
                system.push(json!({"type":"text","text":text}));
            }
            continue;
        }
        let (role, content) = match role {
            "user" => ("user", vec![json!({"type":"text","text":text})]),
            "assistant" => {
                if let Some(blocks) = message["_anthropicContent"].as_array() {
                    // Preserve signed thinking blocks exactly on this fixed provider.
                    ("assistant", blocks.clone())
                } else {
                    let mut content = Vec::new();
                    if !text.is_empty() {
                        content.push(json!({"type":"text","text":text}));
                    }
                    if let Some(calls) = message["tool_calls"].as_array() {
                        for call in calls {
                            let input: Value = serde_json::from_str(
                                call["function"]["arguments"]
                                    .as_str()
                                    .ok_or("无法整理工具参数。")?,
                            )
                            .map_err(|_| "无法整理工具参数。")?;
                            content.push(json!({"type":"tool_use","id":call["id"],"name":call["function"]["name"],"input":input}));
                        }
                    }
                    ("assistant", content)
                }
            }
            "tool" => (
                "user",
                vec![
                    json!({"type":"tool_result","tool_use_id":message["tool_call_id"],"content":text}),
                ],
            ),
            _ => return Err("当前模型协议不支持此消息角色。".into()),
        };
        append_message(&mut converted, role, content)?;
    }
    if as_json {
        append_message(
            &mut converted,
            "user",
            vec![
                json!({"type":"text", "text":"请只返回符合上述契约的完整 JSON 对象，不要 Markdown 代码围栏或额外文字。"}),
            ],
        )?;
    }
    if required {
        append_message(
            &mut converted,
            "user",
            vec![
                json!({"type":"text", "text":"本轮必须先调用提供的工具获得真实结果，不要直接回答或编造工具结果。"}),
            ],
        )?;
    }
    let mut body =
        json!({"model":config.model,"messages":converted,"max_tokens":8192,"stream":true});
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    if let Some(tools) = tools {
        let tools = tools.as_array().ok_or("无法整理本机检索工具。")?;
        body["tools"] = json!(tools.iter().map(|t| json!({"name":t["function"]["name"],"description":t["function"]["description"],"input_schema":t["function"]["parameters"]})).collect::<Vec<_>>());
        // Always-on thinking models can reject forced tool choice. Require the
        // actual tool result locally instead of guessing capability from a model ID.
        body["tool_choice"] = json!({"type":if as_json { "none" } else { "auto" }});
    }
    Ok(body)
}

fn append_message(messages: &mut Vec<Value>, role: &str, blocks: Vec<Value>) -> Result<(), String> {
    if blocks.is_empty() {
        return Err("模型返回了空消息，无法继续；请重试或更换模型。".into());
    }
    if let Some(last) = messages.last_mut().filter(|last| last["role"] == role) {
        last["content"]
            .as_array_mut()
            .ok_or("无法整理模型消息。")?
            .extend(blocks);
    } else {
        messages.push(json!({"role":role,"content":blocks}));
    }
    Ok(())
}

fn invalid(message: &str) -> Failure {
    Failure {
        message: message.into(),
        retry: false,
    }
}
fn http_failure(status: u16) -> Failure {
    let message = match status {
        401 | 403 => "模型服务鉴权失败，请替换密钥或检查连接权限。",
        402 => "模型服务账户余额不足，请在服务商平台检查余额。",
        429 => "模型请求受限，请稍后重试。",
        500 | 502 | 503 | 504 | 529 => "模型服务暂时不可用，请稍后重试。",
        300..=399 => "连接地址返回重定向；为保护密钥，未跟随，请检查连接地址。",
        404 => "未找到模型或接口，请检查完整模型名称、连接地址与连接类型。",
        400 | 422 => "当前服务或模型不支持本次请求，请检查模型名称、连接类型及工具调用能力。",
        413 => "模型服务拒绝过长输入，请缩短文本后重试。",
        _ => "模型服务返回错误，本次未完成。",
    };
    Failure {
        message: format!("{message}（HTTP {status}）"),
        retry: matches!(status, 429 | 500 | 502 | 503 | 504 | 529),
    }
}

fn validate_finish(finish: &str, anthropic: bool) -> Result<(), Failure> {
    match (anthropic, finish) {
        (false, "stop" | "tool_calls") | (true, "end_turn" | "tool_use" | "stop_sequence") => {
            Ok(())
        }
        (false, "length") | (true, "max_tokens" | "model_context_window_exceeded") => Err(invalid(
            "模型输出被截断，请缩短文本或新建会话后重试；未采用不完整结果。",
        )),
        (false, "content_filter") | (true, "refusal") => {
            Err(invalid("模型未能处理这段内容，请调整输入。"))
        }
        (true, "pause_turn") => Err(invalid(
            "当前服务返回了本产品不支持的服务端工具暂停，请选择支持本机工具调用的模型。",
        )),
        (false, "aborted" | "insufficient_system_resource") => Err(Failure {
            message: "模型生成被中断，请稍后重试。".into(),
            retry: true,
        }),
        _ => Err(invalid("模型没有返回明确且受支持的完成状态。")),
    }
}

fn parse_tools(value: &Value) -> Result<Vec<ToolCall>, Failure> {
    if value.is_null() {
        return Ok(vec![]);
    }
    let tools: Vec<ToolCall> =
        serde_json::from_value(value.clone()).map_err(|_| invalid("模型工具调用格式无效。"))?;
    let mut ids = HashSet::new();
    if tools.len() > 8
        || tools.iter().any(|t| {
            t.id.is_empty()
                || t.id.len() > 128
                || !ids.insert(&t.id)
                || t.function.name.is_empty()
                || t.function.name.len() > 80
                || t.function.arguments.len() > MAX_TOOL_ARGUMENTS
                || serde_json::from_str::<Value>(&t.function.arguments)
                    .ok()
                    .is_none_or(|v| !v.is_object())
        })
    {
        return Err(invalid("模型工具调用超出允许范围或参数不是有效对象。"));
    }
    Ok(tools)
}

fn completion(
    content: String,
    calls: Vec<Value>,
    native: Option<Value>,
    finish: &str,
    anthropic: bool,
) -> Result<Completion, Failure> {
    validate_finish(finish, anthropic)?;
    let tools = parse_tools(&json!(calls))?;
    if (finish == "tool_calls" || finish == "tool_use") == tools.is_empty() {
        return Err(invalid("模型工具调用与完成状态不一致，请重试或更换模型。"));
    }
    if content.len() > MAX_CONTENT {
        return Err(invalid("模型结果超出本次上限。"));
    }
    if content.trim().is_empty() && tools.is_empty() {
        return Err(invalid("模型返回空结果，请重试或更换模型。"));
    }
    let mut message = json!({"role":"assistant","content":content});
    if !calls.is_empty() {
        message["tool_calls"] = json!(calls);
    }
    if let Some(native) = native {
        message["_anthropicContent"] = native;
    }
    Ok(Completion {
        content,
        tools,
        message,
    })
}

fn openai_completion(value: &Value) -> Result<Completion, Failure> {
    let choice = value["choices"]
        .as_array()
        .and_then(|v| v.first())
        .ok_or_else(|| invalid("模型返回空结果。"))?;
    let message = &choice["message"];
    if message["refusal"].as_str().is_some_and(|s| !s.is_empty()) {
        return Err(invalid("模型拒绝了本次内容，请调整输入。"));
    }
    let calls = match &message["tool_calls"] {
        Value::Null => vec![],
        Value::Array(calls) => calls.clone(),
        _ => return Err(invalid("模型工具调用格式无效。")),
    };
    completion(
        message["content"].as_str().unwrap_or("").to_owned(),
        calls,
        None,
        choice["finish_reason"].as_str().unwrap_or(""),
        false,
    )
}

fn anthropic_completion(value: &Value) -> Result<Completion, Failure> {
    if value["type"] == "error" {
        return Err(stream_failure(value));
    }
    let blocks = value["content"]
        .as_array()
        .ok_or_else(|| invalid("模型 Messages 响应缺少内容块。"))?;
    let mut content = String::new();
    let mut calls = Vec::new();
    for block in blocks {
        match block["type"].as_str().unwrap_or("") {
            "text" => content.push_str(
                block["text"]
                    .as_str()
                    .ok_or_else(|| invalid("模型文本内容块格式无效。"))?,
            ),
            "tool_use" => {
                if !block["input"].is_object() {
                    return Err(invalid("模型工具参数不是有效对象。"));
                }
                calls.push(json!({"id":block["id"],"type":"function","function":{"name":block["name"],"arguments":block["input"].to_string()}}));
            }
            "thinking" | "redacted_thinking" => {}
            _ => {
                return Err(invalid(
                    "当前模型返回了不支持的内容类型，请选择文本与本机工具调用模型。",
                ))
            }
        }
    }
    completion(
        content,
        calls,
        Some(json!(blocks)),
        value["stop_reason"].as_str().unwrap_or(""),
        true,
    )
}

#[derive(Default)]
struct SseFrame {
    data: String,
}
impl SseFrame {
    fn line(&mut self, line: &str) -> Result<Option<String>, Failure> {
        if line.is_empty() {
            return Ok((!self.data.is_empty()).then(|| std::mem::take(&mut self.data)));
        }
        if let Some(data) = line.strip_prefix("data:") {
            if !self.data.is_empty() {
                self.data.push('\n');
            }
            self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
            if self.data.len() > 256 * 1024 {
                return Err(invalid("模型流式事件过大，本次未完成。"));
            }
        }
        Ok(None)
    }
}

enum Stream {
    Openai(OpenaiStream),
    Anthropic(AnthropicStream),
}
impl Stream {
    fn new(anthropic: bool) -> Self {
        if anthropic {
            Self::Anthropic(AnthropicStream::default())
        } else {
            Self::Openai(OpenaiStream::default())
        }
    }
    fn event(&mut self, data: &str) -> Result<(), Failure> {
        match self {
            Self::Openai(s) => s.event(data),
            Self::Anthropic(s) => s.event(data),
        }
    }
    fn done(&self) -> bool {
        match self {
            Self::Openai(s) => s.done,
            Self::Anthropic(s) => s.done,
        }
    }
    fn finish(self) -> Result<Completion, Failure> {
        if !self.done() {
            return Err(Failure {
                message: "模型流式响应在完成前中断，请重试。".into(),
                retry: true,
            });
        }
        match self {
            Self::Openai(s) => completion(
                s.content,
                s.tools.into_values().collect(),
                None,
                &s.finish,
                false,
            ),
            Self::Anthropic(s) => {
                if !s.started || !s.open_blocks.is_empty() {
                    return Err(invalid("模型内容块未完整结束，请重试。"));
                }
                anthropic_completion(
                    &json!({"content":s.blocks.into_values().collect::<Vec<_>>(),"stop_reason":s.finish}),
                )
            }
        }
    }
}

#[derive(Default)]
struct OpenaiStream {
    done: bool,
    finish: String,
    content: String,
    tools: BTreeMap<usize, Value>,
}
impl OpenaiStream {
    fn event(&mut self, data: &str) -> Result<(), Failure> {
        if data.trim() == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: Value =
            serde_json::from_str(data).map_err(|_| invalid("模型流式响应格式无效。"))?;
        if value.get("error").is_some() {
            return Err(stream_failure(&value));
        }
        let choices = value["choices"]
            .as_array()
            .ok_or_else(|| invalid("模型流式响应缺少结果。"))?;
        let Some(choice) = choices.first() else {
            return Ok(());
        };
        if choice["index"].as_u64().is_some_and(|i| i != 0) {
            return Err(invalid("模型返回了多组结果，请更换模型配置。"));
        }
        if let Some(finish) = choice["finish_reason"].as_str() {
            if !self.finish.is_empty() && self.finish != finish {
                return Err(invalid("模型完成状态不一致。"));
            }
            self.finish = finish.to_owned();
        }
        if choice["delta"]["refusal"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
        {
            return Err(invalid("模型拒绝了本次内容，请调整输入。"));
        }
        if let Some(content) = choice["delta"]["content"].as_str() {
            self.content.push_str(content);
            if self.content.len() > MAX_CONTENT {
                return Err(invalid("模型生成内容过长，请缩短输入。"));
            }
        }
        if let Some(calls) = choice["delta"]["tool_calls"].as_array() {
            for call in calls {
                let index = call["index"]
                    .as_u64()
                    .filter(|i| *i < 8)
                    .ok_or_else(|| invalid("模型工具序号无效或工具过多。"))?
                    as usize;
                let target = self.tools.entry(index).or_insert_with(
                    || json!({"id":"","type":"function","function":{"name":"","arguments":""}}),
                );
                for path in [
                    vec!["id"],
                    vec!["function", "name"],
                    vec!["function", "arguments"],
                ] {
                    let incoming = path.iter().fold(call, |v, k| &v[*k]);
                    if let Some(fragment) = incoming.as_str() {
                        let mut dest = &mut *target;
                        for key in &path {
                            dest = &mut dest[*key];
                        }
                        let mut accumulated = dest.as_str().unwrap_or("").to_owned();
                        accumulated.push_str(fragment);
                        if accumulated.len() > MAX_TOOL_ARGUMENTS {
                            return Err(invalid("模型工具参数过长。"));
                        }
                        *dest = json!(accumulated);
                    }
                }
            }
        }
        Ok(())
    }
}

#[derive(Default)]
struct AnthropicStream {
    started: bool,
    done: bool,
    finish: String,
    blocks: BTreeMap<usize, Value>,
    open_blocks: HashSet<usize>,
    tool_json: BTreeMap<usize, String>,
}
impl AnthropicStream {
    fn event(&mut self, data: &str) -> Result<(), Failure> {
        let value: Value =
            serde_json::from_str(data).map_err(|_| invalid("模型 Messages 流式响应格式无效。"))?;
        let kind = value["type"].as_str().unwrap_or("");
        match kind {
            "ping" => {}
            "error" => return Err(stream_failure(&value)),
            "message_start" => {
                if self.started {
                    return Err(invalid("模型重复开始流式消息。"));
                }
                self.started = true;
                if value["message"]["role"]
                    .as_str()
                    .is_some_and(|r| r != "assistant")
                {
                    return Err(invalid("模型消息角色无效。"));
                }
            }
            "content_block_start" => {
                let index = block_index(&value)?;
                if !self.started || self.blocks.contains_key(&index) {
                    return Err(invalid("模型内容块顺序无效。"));
                }
                let block = value["content_block"].clone();
                if !matches!(
                    block["type"].as_str(),
                    Some("text" | "tool_use" | "thinking" | "redacted_thinking")
                ) {
                    return Err(invalid("当前模型返回了不支持的内容块，请更换模型。"));
                }
                self.blocks.insert(index, block);
                self.open_blocks.insert(index);
            }
            "content_block_delta" => {
                let index = block_index(&value)?;
                if !self.open_blocks.contains(&index) {
                    return Err(invalid("模型内容块在开始前或结束后收到片段。"));
                }
                let block = self
                    .blocks
                    .get_mut(&index)
                    .ok_or_else(|| invalid("模型内容块缺失。"))?;
                let delta = &value["delta"];
                let (field, fragment) = match delta["type"].as_str() {
                    Some("text_delta") if block["type"] == "text" => {
                        ("text", delta["text"].as_str())
                    }
                    Some("thinking_delta") if block["type"] == "thinking" => {
                        ("thinking", delta["thinking"].as_str())
                    }
                    Some("signature_delta") if block["type"] == "thinking" => {
                        ("signature", delta["signature"].as_str())
                    }
                    Some("input_json_delta") if block["type"] == "tool_use" => {
                        let fragment = delta["partial_json"]
                            .as_str()
                            .ok_or_else(|| invalid("模型工具片段格式无效。"))?;
                        let accumulated = self.tool_json.entry(index).or_default();
                        accumulated.push_str(fragment);
                        if accumulated.len() > MAX_TOOL_ARGUMENTS {
                            return Err(invalid("模型工具参数过长。"));
                        }
                        return Ok(());
                    }
                    _ => return Err(invalid("模型流式内容与内容块类型不一致。")),
                };
                let fragment = fragment.ok_or_else(|| invalid("模型内容片段格式无效。"))?;
                let mut accumulated = block[field].as_str().unwrap_or("").to_owned();
                accumulated.push_str(fragment);
                if accumulated.len() > MAX_CONTENT {
                    return Err(invalid("模型内容过长，请缩短输入。"));
                }
                block[field] = json!(accumulated);
            }
            "content_block_stop" => {
                let index = block_index(&value)?;
                if !self.open_blocks.remove(&index) {
                    return Err(invalid("模型内容块结束状态无效。"));
                }
                if let Some(arguments) = self.tool_json.remove(&index) {
                    self.blocks
                        .get_mut(&index)
                        .ok_or_else(|| invalid("模型工具内容块缺失。"))?["input"] =
                        serde_json::from_str(&arguments)
                            .map_err(|_| invalid("模型工具参数不是完整 JSON。"))?;
                }
            }
            "message_delta" => {
                if let Some(finish) = value["delta"]["stop_reason"].as_str() {
                    self.finish = finish.to_owned();
                }
            }
            "message_stop" => {
                self.done = true;
            }
            // The Messages protocol explicitly permits future event types.
            _ => {}
        }
        Ok(())
    }
}
fn block_index(value: &Value) -> Result<usize, Failure> {
    value["index"]
        .as_u64()
        .filter(|i| *i < 64)
        .map(|i| i as usize)
        .ok_or_else(|| invalid("模型内容块序号无效或过多。"))
}
fn stream_failure(value: &Value) -> Failure {
    let kind = value["error"]["type"].as_str().unwrap_or("");
    match kind {
        "overloaded_error" | "api_error" | "rate_limit_error" => Failure {
            message: "模型服务在生成中暂时不可用，请稍后重试。".into(),
            retry: true,
        },
        "authentication_error" | "permission_error" => {
            invalid("模型服务鉴权失败，请检查密钥与权限。")
        }
        _ => invalid("模型服务在流式生成中返回错误，请重试或检查模型能力。"),
    }
}

#[cfg(test)]
#[path = "provider_tests.rs"]
mod tests;
