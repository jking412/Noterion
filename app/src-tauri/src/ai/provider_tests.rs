use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
};

fn config(provider: ProviderKind) -> ConnectionConfig {
    ConnectionConfig {
        provider,
        model: "vendor/model:2026".into(),
        base_url: "https://example.test/v1".into(),
    }
}
fn tools() -> Value {
    json!([{"type":"function","function":{"name":"search_knowledge","description":"Search actual knowledge","parameters":{"type":"object","properties":{"terms":{"type":"array","items":{"type":"string"}}},"required":["terms"]}}}])
}
fn openai_text(text: &str, finish: &str) -> Value {
    json!({"choices":[{"message":{"role":"assistant","content":text},"finish_reason":finish}]})
}
fn anthropic_text(text: &str, finish: &str) -> Value {
    json!({"type":"message","role":"assistant","content":[{"type":"text","text":text}],"stop_reason":finish})
}
fn events(stream: &mut Stream, values: &[Value]) {
    for value in values {
        stream.event(&value.to_string()).unwrap();
    }
}
fn text_events(text: &str) -> Vec<Value> {
    vec![
        json!({"type":"message_start","message":{"role":"assistant","content":[]}}),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}}),
        json!({"type":"content_block_stop","index":0}),
        json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}}),
        json!({"type":"message_stop"}),
    ]
}

#[test]
fn compatibility_request_does_not_guess_model_specific_options() {
    let messages = [json!({"role":"user","content":"return json"})];
    let body = request_body(
        &config(ProviderKind::Openai),
        &messages,
        Some(tools()),
        true,
        true,
    )
    .unwrap();
    assert_eq!(body["model"], "vendor/model:2026");
    assert_eq!(body["tool_choice"], "none");
    assert_eq!(body["stream"], true);
    let tool_request = request_body(
        &config(ProviderKind::Openai),
        &messages,
        Some(tools()),
        true,
        false,
    )
    .unwrap();
    assert_eq!(tool_request["tool_choice"], "required");
    for field in [
        "thinking",
        "reasoning_effort",
        "temperature",
        "response_format",
        "max_tokens",
        "max_completion_tokens",
    ] {
        assert!(body.get(field).is_none(), "{field} must not be guessed");
    }
    let deepseek = request_body(
        &config(ProviderKind::Deepseek),
        &messages,
        None,
        false,
        true,
    )
    .unwrap();
    assert_eq!(deepseek["thinking"]["type"], "disabled");
    assert_eq!(deepseek["response_format"]["type"], "json_object");
    assert_eq!(deepseek["max_tokens"], 8192);
}

#[test]
fn messages_request_converts_system_tools_and_groups_parallel_tool_results() {
    let messages = vec![
        json!({"role":"system","content":"Only use evidence"}),
        json!({"role":"user","content":"Find Docker"}),
        json!({"role":"assistant","content":"","tool_calls":[
            {"id":"tool_1","type":"function","function":{"name":"search_knowledge","arguments":"{\"terms\":[\"Docker\"]}"}},
            {"id":"tool_2","type":"function","function":{"name":"search_knowledge","arguments":"{\"terms\":[\"容器\"]}"}}
        ]}),
        json!({"role":"tool","tool_call_id":"tool_1","content":"{\"hits\":[\"p1\"]}"}),
        json!({"role":"tool","tool_call_id":"tool_2","content":"{\"hits\":[\"p2\"]}"}),
    ];
    let body = request_body(
        &config(ProviderKind::Anthropic),
        &messages,
        Some(tools()),
        true,
        false,
    )
    .unwrap();
    assert_eq!(body["system"][0]["text"], "Only use evidence");
    assert_eq!(body["messages"].as_array().unwrap().len(), 3);
    assert_eq!(body["messages"][1]["content"][0]["type"], "tool_use");
    assert_eq!(
        body["messages"][1]["content"][0]["input"]["terms"][0],
        "Docker"
    );
    let results = &body["messages"][2]["content"];
    assert_eq!(results[0]["type"], "tool_result");
    assert_eq!(results[0]["tool_use_id"], "tool_1");
    assert_eq!(results[1]["tool_use_id"], "tool_2");
    assert_eq!(body["tools"][0]["name"], "search_knowledge");
    assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
    assert_eq!(body["tool_choice"]["type"], "auto");
    assert!(body.get("thinking").is_none());
    assert!(body.get("temperature").is_none());
    assert!(body.get("response_format").is_none());
}

#[test]
fn openai_json_text_and_tools_use_canonical_messages() {
    assert_eq!(
        openai_completion(&openai_text("{\"ok\":true}", "stop"))
            .unwrap()
            .content,
        "{\"ok\":true}"
    );
    let response = json!({"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[
        {"id":"call_1","type":"function","function":{"name":"search_knowledge","arguments":"{\"terms\":[\"Docker\"]}"}}
    ]},"finish_reason":"tool_calls"}]});
    let c = openai_completion(&response).unwrap();
    assert_eq!(c.tools.len(), 1);
    assert_eq!(c.tools[0].function.name, "search_knowledge");
    assert_eq!(c.message["tool_calls"][0]["id"], "call_1");
}

#[test]
fn messages_json_text_and_tools_preserve_signed_thinking() {
    let native = json!([
        {"type":"thinking","thinking":"Internal reasoning","signature":"signed-blob"},
        {"type":"redacted_thinking","data":"redacted-blob"},
        {"type":"tool_use","id":"tool_1","name":"search_knowledge","input":{"terms":["Docker"]}}
    ]);
    let c = anthropic_completion(&json!({"content":native,"stop_reason":"tool_use"})).unwrap();
    assert_eq!(c.tools.len(), 1);
    assert_eq!(c.message["_anthropicContent"], native);
    let body = request_body(
        &config(ProviderKind::Anthropic),
        &[
            json!({"role":"user","content":"Find Docker"}),
            c.message,
            json!({"role":"tool","tool_call_id":"tool_1","content":"{\"hits\":[\"p1\"]}"}),
        ],
        Some(tools()),
        false,
        false,
    )
    .unwrap();
    assert_eq!(body["messages"][1]["content"], native);
    assert_eq!(body["messages"][2]["content"][0]["tool_use_id"], "tool_1");
    assert_eq!(
        anthropic_completion(&anthropic_text("{\"ok\":true}", "end_turn"))
            .unwrap()
            .content,
        "{\"ok\":true}"
    );
}

#[test]
fn openai_stream_assembles_fragmented_parallel_functions_and_requires_done() {
    let mut stream = Stream::new(false);
    events(
        &mut stream,
        &[
            json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_","function":{"name":"search_","arguments":"{\"terms\":["}}]}}]}),
            json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"read_point","arguments":"{\"handle\":\"p1\"}"}},{"index":0,"id":"1","function":{"name":"knowledge","arguments":"\"Docker\"]}"}}]}}]}),
            json!({"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}),
            json!({"choices":[],"usage":{"completion_tokens":40}}),
        ],
    );
    stream.event("[DONE]").unwrap();
    let result = stream.finish().unwrap();
    assert_eq!(result.tools.len(), 2);
    assert_eq!(result.tools[0].id, "call_1");
    assert_eq!(result.tools[0].function.name, "search_knowledge");
    assert_eq!(
        result.tools[0].function.arguments,
        "{\"terms\":[\"Docker\"]}"
    );
    assert_eq!(result.tools[1].function.name, "read_point");
    let mut interrupted = Stream::new(false);
    interrupted
        .event(&json!({"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}).to_string())
        .unwrap();
    assert!(interrupted.finish().err().unwrap().message.contains("中断"));
}

#[test]
fn messages_stream_assembles_json_thinking_signatures_and_multiround_tools() {
    let mut stream = Stream::new(true);
    events(
        &mut stream,
        &[
            json!({"type":"message_start","message":{"role":"assistant","content":[]}}),
            json!({"type":"ping"}),
            json!({"type":"future_event","value":"forward compatible"}),
            json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Plan"}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sign"}}),
            json!({"type":"content_block_stop","index":0}),
            json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_1","name":"search_knowledge","input":{}}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"terms\":["}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"Docker\"]}"}}),
            json!({"type":"content_block_stop","index":1}),
            json!({"type":"message_delta","delta":{"stop_reason":"tool_use"}}),
            json!({"type":"message_stop"}),
        ],
    );
    let result = stream.finish().unwrap();
    assert_eq!(
        result.tools[0].function.arguments,
        "{\"terms\":[\"Docker\"]}"
    );
    assert_eq!(result.message["_anthropicContent"][0]["thinking"], "Plan");
    assert_eq!(result.message["_anthropicContent"][0]["signature"], "sign");
    let body = request_body(&config(ProviderKind::Anthropic), &[
        json!({"role":"user","content":"Find Docker"}), result.message.clone(),
        json!({"role":"tool","tool_call_id":"tool_1","content":"{\"hits\":[{\"handle\":\"p1\",\"sourceHandle\":\"s1\"}]}"}),
        json!({"role":"user","content":"Return final json with citations"}),
    ], None, false, true).unwrap();
    assert_eq!(
        body["messages"][1]["content"],
        result.message["_anthropicContent"]
    );
    assert_eq!(body["messages"][2]["content"][0]["type"], "tool_result");
    let final_body = request_body(
        &config(ProviderKind::Anthropic),
        &[
            json!({"role":"user","content":"Find Docker"}),
            result.message,
            json!({"role":"tool","tool_call_id":"tool_1","content":"{\"hits\":[]}"}),
        ],
        Some(tools()),
        false,
        true,
    )
    .unwrap();
    assert_eq!(final_body["tools"][0]["name"], "search_knowledge");
    assert_eq!(final_body["tool_choice"]["type"], "none");
    let final_json =
        r#"{"blocks":[{"markdown":"知识","basis":"personal","sourceHandles":["s1"]}],"note":""}"#;
    let mut final_stream = Stream::new(true);
    events(&mut final_stream, &text_events(final_json));
    assert_eq!(final_stream.finish().unwrap().content, final_json);
}

#[test]
fn invalid_empty_truncated_refused_and_incomplete_results_never_succeed() {
    for (finish, anthropic) in [
        ("length", false),
        ("content_filter", false),
        ("", false),
        ("max_tokens", true),
        ("model_context_window_exceeded", true),
        ("refusal", true),
        ("pause_turn", true),
        ("unknown", true),
    ] {
        assert!(validate_finish(finish, anthropic).is_err());
    }
    for text in ["", "   \n\t"] {
        assert!(openai_completion(&openai_text(text, "stop")).is_err());
        assert!(anthropic_completion(&anthropic_text(text, "end_turn")).is_err());
    }
    let mut stream = Stream::new(true);
    let mut incomplete = text_events("{}");
    incomplete.remove(3); // missing content_block_stop
    events(&mut stream, &incomplete);
    assert!(stream.finish().err().unwrap().message.contains("内容块"));
    let mut stream = Stream::new(true);
    events(&mut stream, &text_events("{}")[..5]);
    assert!(stream.finish().err().unwrap().message.contains("中断"));
    assert!(parse_tools(&json!([
        {"id":"same","function":{"name":"a","arguments":"{}"}},
        {"id":"same","function":{"name":"a","arguments":"{}"}}
    ]))
    .is_err());
    assert!(parse_tools(&json!([{ "id":"a","function":{"name":"a","arguments":"[]"}}])).is_err());
}

#[test]
fn sse_frames_support_crlf_multiline_and_ignore_comments() {
    let mut frame = SseFrame::default();
    assert!(frame.line(": keepalive").unwrap().is_none());
    assert!(frame.line("event: message_start").unwrap().is_none());
    assert!(frame.line("data: {\"type\":").unwrap().is_none());
    assert!(frame.line("data: \"ping\"}").unwrap().is_none());
    assert_eq!(frame.line("").unwrap().unwrap(), "{\"type\":\n\"ping\"}");
}

/// A real local HTTP server captures serialized paths/headers/bodies. It has no
/// paid credentials, no external network, and deliberately fragments UTF-8/SSE.
fn fixture(
    status: u16,
    content_type: &str,
    payload: String,
) -> (
    String,
    mpsc::Receiver<(String, Value)>,
    thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/v1", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    let content_type = content_type.to_owned();
    let thread = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut received = Vec::new();
        let header_end;
        loop {
            let mut bytes = [0; 1024];
            let count = socket.read(&mut bytes).unwrap();
            assert!(count > 0);
            received.extend_from_slice(&bytes[..count]);
            if let Some(index) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                header_end = index + 4;
                break;
            }
        }
        let headers = String::from_utf8(received[..header_end].to_vec()).unwrap();
        let content_length: usize = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|v| v.trim().parse().unwrap())
            })
            .unwrap();
        while received.len() < header_end + content_length {
            let mut bytes = [0; 1024];
            let count = socket.read(&mut bytes).unwrap();
            assert!(count > 0);
            received.extend_from_slice(&bytes[..count]);
        }
        let body =
            serde_json::from_slice(&received[header_end..header_end + content_length]).unwrap();
        tx.send((headers, body)).unwrap();
        let headers = format!("HTTP/1.1 {status} Fixture\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",payload.len());
        socket.write_all(headers.as_bytes()).unwrap();
        for fragment in payload.as_bytes().chunks(7) {
            if socket.write_all(fragment).is_err() {
                break;
            }
            socket.flush().ok();
            thread::sleep(Duration::from_millis(1));
        }
    });
    (address, rx, thread)
}

fn exchange(
    provider: ProviderKind,
    status: u16,
    content_type: &str,
    payload: String,
) -> (Result<Completion, Failure>, String, Value) {
    let (address, rx, server) = fixture(status, content_type, payload);
    let mut config = config(provider);
    config.base_url = address;
    let client = Provider::new(config.clone(), "fixture-secret".into()).unwrap();
    let body = request_body(
        &config,
        &[
            json!({"role":"system","content":"只返回json"}),
            json!({"role":"user","content":"检查"}),
        ],
        None,
        false,
        true,
    )
    .unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result = runtime.block_on(client.once(None, &body));
    let (headers, body) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    server.join().unwrap();
    (result, headers.to_ascii_lowercase(), body)
}

#[test]
fn http_contract_chat_completions_json_and_sse() {
    let (result, headers, body) = exchange(
        ProviderKind::Openai,
        200,
        "application/json",
        openai_text("{\"ok\":true}", "stop").to_string(),
    );
    assert_eq!(result.unwrap().content, "{\"ok\":true}");
    assert!(headers.starts_with("post /v1/chat/completions http/1.1"));
    assert!(headers.contains("authorization: bearer fixture-secret"));
    assert!(!headers.contains("x-api-key"));
    assert!(body.get("thinking").is_none());
    let payload = format!(
        "data: {}\r\n\r\ndata: [DONE]\r\n\r\n",
        json!({"choices":[{"index":0,"delta":{"content":"{\"中文\":true}"},"finish_reason":"stop"}]})
    );
    let (result, _, _) = exchange(ProviderKind::Openai, 200, "text/event-stream", payload);
    assert_eq!(result.unwrap().content, "{\"中文\":true}");
}

#[test]
fn http_contract_messages_json_and_sse_with_api_version() {
    let (result, headers, body) = exchange(
        ProviderKind::Anthropic,
        200,
        "application/json",
        anthropic_text("{\"ok\":true}", "end_turn").to_string(),
    );
    assert_eq!(result.unwrap().content, "{\"ok\":true}");
    assert!(headers.starts_with("post /v1/messages http/1.1"));
    assert!(headers.contains("x-api-key: fixture-secret"));
    assert!(headers.contains(&format!("anthropic-version: {ANTHROPIC_VERSION}")));
    assert!(!headers.contains("authorization:"));
    assert_eq!(body["system"][0]["text"], "只返回json");
    assert_eq!(body["messages"][0]["role"], "user");
    let payload = text_events("{\"中文\":true}")
        .iter()
        .map(|v| {
            format!(
                "event: {}\r\ndata: {v}\r\n\r\n",
                v["type"].as_str().unwrap()
            )
        })
        .collect();
    let (result, _, _) = exchange(ProviderKind::Anthropic, 200, "text/event-stream", payload);
    assert_eq!(result.unwrap().content, "{\"中文\":true}");
}

#[test]
fn http_error_contract_is_recoverable_and_does_not_echo_provider_secrets() {
    for status in [400, 401, 403, 404, 413, 422, 429, 503, 529, 307] {
        let (result, _, _) = exchange(
            ProviderKind::Anthropic,
            status,
            "application/json",
            "{\"error\":\"fixture-secret raw prompt\"}".into(),
        );
        let failure = result.err().unwrap();
        assert!(failure.message.contains(&format!("HTTP {status}")));
        assert!(!failure.message.contains("fixture-secret"));
        assert_eq!(failure.retry, matches!(status, 429 | 503 | 529));
    }
}

#[test]
fn http_interrupted_streams_and_server_errors_cannot_become_success() {
    for provider in [ProviderKind::Openai, ProviderKind::Anthropic] {
        let payload = if provider == ProviderKind::Anthropic {
            text_events("{}")
                .iter()
                .take(5)
                .map(|v| format!("data: {v}\n\n"))
                .collect()
        } else {
            format!(
                "data: {}\n\n",
                json!({"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]})
            )
        };
        let (result, _, _) = exchange(provider, 200, "text/event-stream", payload);
        assert!(result.err().unwrap().message.contains("中断"));
    }
    let (result, _, _) = exchange(
        ProviderKind::Anthropic,
        200,
        "text/event-stream",
        format!(
            "data: {}\n\n",
            json!({"type":"error","error":{"type":"overloaded_error","message":"fixture-secret"}})
        ),
    );
    let failure = result.err().unwrap();
    assert!(failure.retry);
    assert!(!failure.message.contains("fixture-secret"));
}

#[test]
fn http_silent_stream_reaches_real_read_timeout_and_remains_retryable() {
    use std::io::BufRead;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut config = config(ProviderKind::Anthropic);
    config.base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (stop, stopped) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = std::io::BufReader::new(&mut socket);
        let mut content_length = None;
        loop {
            let mut line = String::new();
            assert!(request.read_line(&mut line).unwrap() > 0);
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                content_length = Some(value.trim().parse::<usize>().unwrap());
            }
        }
        let mut body = vec![0; content_length.unwrap()];
        request.read_exact(&mut body).unwrap();
        assert!(serde_json::from_slice::<Value>(&body).unwrap().is_object());
        drop(request);
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").unwrap();
        socket.flush().unwrap();
        // No SSE bytes or heartbeat are sent. Exercise the production 45-second
        // read timeout, while bounding fixture cleanup even if that timeout breaks.
        let _ = stopped.recv_timeout(Duration::from_secs(46));
    });
    let client = Provider::new(config.clone(), "fixture-secret".into()).unwrap();
    let body = request_body(
        &config,
        &[json!({"role":"user","content":"检查"})],
        None,
        false,
        true,
    )
    .unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let started = std::time::Instant::now();
    let result = runtime.block_on(client.once(None, &body));
    let elapsed = started.elapsed();
    let _ = stop.send(());
    server.join().unwrap();
    let failure = result.err().expect("a silent SSE body must time out");
    assert!(elapsed >= Duration::from_secs(45));
    assert!(failure.retry);
    assert!(failure.message.contains("长时间"));
    assert!(!failure.message.contains("fixture-secret"));
}

#[test]
fn http_closed_local_port_is_retryable_and_does_not_echo_secret() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut config = config(ProviderKind::Openai);
    config.base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    drop(listener);
    let client = Provider::new(config.clone(), "fixture-secret".into()).unwrap();
    let body = request_body(
        &config,
        &[json!({"role":"user","content":"检查"})],
        None,
        false,
        true,
    )
    .unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let failure = runtime
        .block_on(client.once(None, &body))
        .err()
        .expect("a closed port must reject the connection");
    assert!(failure.retry);
    assert!(failure.message.contains("无法连接"));
    assert!(!failure.message.contains("fixture-secret"));
}
