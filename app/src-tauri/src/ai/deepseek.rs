use super::{credentials::ConnectionConfig, Task};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Duration};

const MAX_RESPONSE: usize = 2 * 1024 * 1024;
const MAX_CONTENT: usize = 1024 * 1024;

pub struct DeepSeek {
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
    pub message: Value,
}
struct Failure {
    message: String,
    retry: bool,
}

impl DeepSeek {
    pub fn new(config: ConnectionConfig, secret: String) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| "无法建立安全的 DeepSeek 连接。")?;
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
        let mut body = json!({
            "model": self.config.model, "messages": messages,
            "thinking": {"type":"disabled"}, "stream": true, "max_tokens": 8192,
        });
        if let Some(tools) = tools {
            body["tools"] = tools;
            body["tool_choice"] = json!(if required { "required" } else { "auto" });
        }
        if as_json {
            body["response_format"] = json!({"type":"json_object"});
        }
        for attempt in 0..3 {
            task.check()?;
            match self.once(task, &body).await {
                Ok(completion) => return Ok(completion),
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
        Err("DeepSeek 调用未完成。".into())
    }

    async fn once(&self, task: &Task, body: &Value) -> Result<Completion, Failure> {
        let mut response = self
            .http
            .post(format!("{}/chat/completions", self.config.base_url))
            .bearer_auth(&self.secret)
            .json(body)
            .send()
            .await
            .map_err(|e| Failure {
                message: if e.is_timeout() {
                    "DeepSeek 连接超时，请重试。"
                } else {
                    "无法连接 DeepSeek，请检查网络与连接地址。"
                }
                .into(),
                retry: true,
            })?;
        let status = response.status().as_u16();
        if status != 200 {
            let message = match status {
                401 | 403 => "DeepSeek 鉴权失败，请检查密钥和连接权限。",
                402 => "DeepSeek 账户余额不足，请在服务商平台检查余额。",
                429 => "DeepSeek 请求受限，请稍后重试。",
                500 | 502 | 503 | 504 => "DeepSeek 服务暂时不可用，请稍后重试。",
                300..=399 => "DeepSeek 地址返回重定向；为保护密钥，未跟随，请检查连接地址。",
                400 | 404 | 422 => "DeepSeek 请求或模型配置不受支持，请检查模型名称和连接地址。",
                _ => "DeepSeek 返回服务错误，本次未完成。",
            };
            return Err(Failure {
                message: message.into(),
                retry: matches!(status, 429 | 500 | 502 | 503 | 504),
            });
        }
        let is_sse = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.contains("text/event-stream"));
        let mut total = 0usize;
        let mut buffer = Vec::new();
        let mut assembled = Assembled::default();
        while let Some(chunk) = tokio::time::timeout(Duration::from_secs(45), response.chunk())
            .await
            .map_err(|_| Failure {
                message: "DeepSeek 长时间没有响应，请重试。".into(),
                retry: true,
            })?
            .map_err(|_| Failure {
                message: "DeepSeek 响应中断，本次未完成。".into(),
                retry: true,
            })?
        {
            task.check().map_err(|message| Failure {
                message,
                retry: false,
            })?;
            total = total.saturating_add(chunk.len());
            if total > MAX_RESPONSE {
                return Err(invalid("DeepSeek 响应超出本次安全上限，请缩短输入。"));
            }
            buffer.extend_from_slice(&chunk);
            if is_sse {
                while let Some(index) = buffer.iter().position(|b| *b == b'\n') {
                    let line: Vec<_> = buffer.drain(..=index).collect();
                    let line = std::str::from_utf8(&line)
                        .map_err(|_| invalid("DeepSeek 返回了无法读取的文本。"))?
                        .trim();
                    if let Some(data) = line.strip_prefix("data:") {
                        assembled.event(data.trim(), task)?;
                    }
                }
                if buffer.len() > 256 * 1024 {
                    return Err(invalid("DeepSeek 流式片段过大，本次未完成。"));
                }
                if assembled.done {
                    break;
                }
            }
        }
        if !is_sse {
            let value: Value = serde_json::from_slice(&buffer)
                .map_err(|_| invalid("DeepSeek 返回的响应格式无效。"))?;
            let choice = value["choices"]
                .as_array()
                .and_then(|v| v.first())
                .ok_or_else(|| invalid("DeepSeek 返回空结果。"))?;
            let finish = choice["finish_reason"].as_str().unwrap_or("");
            validate_finish(finish)?;
            let message = choice["message"].clone();
            let content = message["content"].as_str().unwrap_or("").to_owned();
            let tools = parse_tools(&message["tool_calls"])?;
            if content.len() > MAX_CONTENT || tools.len() > 8 {
                return Err(invalid("DeepSeek 结果超出本次上限。"));
            }
            return Ok(Completion {
                content,
                tools,
                message,
            });
        }
        if !assembled.done && !buffer.is_empty() {
            let line = std::str::from_utf8(&buffer)
                .map_err(|_| invalid("DeepSeek 返回了无法读取的文本。"))?
                .trim();
            if let Some(data) = line.strip_prefix("data:") {
                assembled.event(data.trim(), task)?;
            }
        }
        if !assembled.done {
            return Err(Failure {
                message: "DeepSeek 流式响应在完成前中断，请重试。".into(),
                retry: true,
            });
        }
        validate_finish(&assembled.finish)?;
        let calls: Vec<Value> = assembled.tools.into_values().collect();
        let tools = parse_tools(&json!(calls))?;
        let mut message = json!({"role":"assistant", "content":assembled.content});
        if !calls.is_empty() {
            message["tool_calls"] = json!(calls);
        }
        Ok(Completion {
            content: assembled.content,
            tools,
            message,
        })
    }
}

fn invalid(message: &str) -> Failure {
    Failure {
        message: message.into(),
        retry: false,
    }
}
fn validate_finish(finish: &str) -> Result<(), Failure> {
    match finish {
        "stop" | "tool_calls" => Ok(()),
        "length" => Err(invalid(
            "DeepSeek 输出被截断，请缩短文本后重试；未采用不完整结果。",
        )),
        "content_filter" => Err(invalid("DeepSeek 未能处理这段内容，请调整输入。")),
        "aborted" | "insufficient_system_resource" => Err(Failure {
            message: "DeepSeek 生成被中断，请稍后重试。".into(),
            retry: true,
        }),
        _ => Err(invalid("DeepSeek 没有返回明确的完成状态。")),
    }
}
fn parse_tools(value: &Value) -> Result<Vec<ToolCall>, Failure> {
    if value.is_null() {
        return Ok(vec![]);
    }
    let tools: Vec<ToolCall> = serde_json::from_value(value.clone())
        .map_err(|_| invalid("DeepSeek 工具调用格式无效。"))?;
    let mut ids = std::collections::HashSet::new();
    if tools.len() > 8
        || tools.iter().any(|t| {
            t.id.is_empty()
                || t.id.len() > 128
                || !ids.insert(&t.id)
                || t.function.name.is_empty()
                || t.function.name.len() > 80
                || t.function.arguments.len() > 16_384
        })
    {
        return Err(invalid("DeepSeek 工具调用超出允许范围。"));
    }
    Ok(tools)
}

#[derive(Default)]
struct Assembled {
    done: bool,
    finish: String,
    content: String,
    tools: BTreeMap<usize, Value>,
}
impl Assembled {
    fn event(&mut self, data: &str, task: &Task) -> Result<(), Failure> {
        if data == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: Value =
            serde_json::from_str(data).map_err(|_| invalid("DeepSeek 流式响应格式无效。"))?;
        let choices = value["choices"]
            .as_array()
            .ok_or_else(|| invalid("DeepSeek 流式响应缺少结果。"))?;
        let Some(choice) = choices.first() else {
            return Ok(());
        };
        if let Some(finish) = choice["finish_reason"].as_str() {
            self.finish = finish.to_owned();
        }
        if let Some(content) = choice["delta"]["content"].as_str() {
            self.content.push_str(content);
            if self.content.len() > MAX_CONTENT {
                return Err(invalid("DeepSeek 生成内容过长，请缩短输入。"));
            }
            // Structured output stays internal until the complete result is validated.
            task.check().map_err(|message| Failure {
                message,
                retry: false,
            })?;
        }
        if let Some(calls) = choice["delta"]["tool_calls"].as_array() {
            for call in calls {
                let index = call["index"]
                    .as_u64()
                    .ok_or_else(|| invalid("DeepSeek 工具序号无效。"))?
                    as usize;
                if index >= 8 {
                    return Err(invalid("DeepSeek 工具调用过多。"));
                }
                let target = self.tools.entry(index).or_insert_with(
                    || json!({"id":"", "type":"function", "function":{"name":"", "arguments":""}}),
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
                        if accumulated.len() > 16_384 {
                            return Err(invalid("DeepSeek 工具参数过长。"));
                        }
                        *dest = json!(accumulated);
                    }
                }
            }
        }
        Ok(())
    }
}
