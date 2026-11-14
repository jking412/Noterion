//! Exercise the real HTTP -> extraction -> preview -> durable adoption interfaces.
use super::*;
use credentials::{ConnectionConfig, ProviderKind};
use std::{io::Write, net::TcpListener, thread};

fn point(id: &str, name: &str) -> Value {
    json!({"id":id,"name":name,"description":"","topicIds":[],"resourceIds":[],"isTheme":false,"color":"neutral"})
}

fn fixture(kind: ProviderKind) -> (provider::Provider, thread::JoinHandle<Vec<Value>>) {
    let (client, server, _) = fixture_with(kind, 2, |body, _| {
        if body.to_string().contains("sourceRepair") {
            json!({"repairs":[{"id":"n2","evidence":[{"quote":"Docker 用于管理容器。","inferred":false}]}]}).to_string()
        } else {
            json!({"points":[
                {"point":point("n1","Linux"),"evidence":[{"quote":"Linux 是操作系统。","inferred":false}]},
                {"point":point("n2","Docker"),"evidence":[]}
            ],"warnings":[]}).to_string()
        }
    });
    (client, server)
}

fn fixture_with(
    kind: ProviderKind,
    count: usize,
    content: impl Fn(&Value, usize) -> String + Send + 'static,
) -> (provider::Provider, thread::JoinHandle<Vec<Value>>, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let mut requests = vec![];
        let deadline = std::time::Instant::now() + Duration::from_secs(12);
        while requests.len() < count && std::time::Instant::now() < deadline {
            let (mut socket, _) = match listener.accept() {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(error) => panic!("{error}"),
            };
            // Windows can inherit the nonblocking listener mode on accept.
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = vec![];
            let header_end = loop {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    break i + 4;
                }
            };
            let headers = String::from_utf8_lossy(&bytes[..header_end]);
            let size: usize = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .unwrap();
            while bytes.len() < header_end + size {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
            }
            let body: Value =
                serde_json::from_slice(&bytes[header_end..header_end + size]).unwrap();
            let content = content(&body, requests.len());
            requests.push(body);
            let payload = if kind == ProviderKind::Anthropic {
                json!({"role":"assistant","content":[{"type":"text","text":content}],"stop_reason":"end_turn"})
            } else {
                json!({"choices":[{"message":{"role":"assistant","content":content},"finish_reason":"stop"}]})
            }.to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",payload.len()).unwrap();
        }
        requests
    });
    (
        provider::Provider::new(
            ConnectionConfig {
                provider: kind,
                model: "fixture-model".into(),
                base_url: base_url.clone(),
            },
            "synthetic-only".into(),
        )
        .unwrap(),
        server,
        base_url,
    )
}

#[test]
fn missing_sources_recover_through_real_protocols_and_remain_explicitly_adopted() {
    for kind in [
        ProviderKind::Deepseek,
        ProviderKind::Openai,
        ProviderKind::Anthropic,
    ] {
        let directory = std::env::current_dir()
            .unwrap()
            .join("target/import-recovery-tests")
            .join(Uuid::new_v4().to_string());
        let store = Arc::new(Mutex::new(crate::store::Store::isolated(directory.clone())));
        let (snapshot, epoch, _) = context(&store).unwrap();
        let task = Task {
            id: Uuid::new_v4().to_string(),
            store: store.clone(),
            epoch,
            cancel: Arc::new(Cancellation::default()),
            channel: None,
        };
        let host = AiHost::default();
        let request = AiRequest {
            action: "extract".into(),
            text: "😀\r\nLinux 是操作系统。\r\nDocker 用于管理容器。".into(),
            source_name: None,
            resource_ids: vec![],
            session_id: None,
            original_record_id: None,
            allow_supplement: false,
        };
        let (client, server) = fixture(kind);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(run(
            &host,
            &task,
            request,
            snapshot,
            directory.clone(),
            client,
        ));
        let requests = server.join().unwrap();
        let preview = match result {
            Ok(AiResult::Extract { draft }) => draft,
            Err(error) => {
                panic!("ordinary source omission must recover into preview, got: {error}")
            }
            _ => panic!("expected extraction"),
        };
        assert_eq!(preview.points.len(), 2);
        assert_eq!(preview.points[0].point.name, "Linux");
        assert_eq!(preview.points[1].evidence[0].quote, "Docker 用于管理容器。");
        assert_eq!(preview.points[1].evidence[0].start, 18);
        assert!(
            store.lock().unwrap().snapshot().unwrap().points.is_empty(),
            "preview must not save"
        );
        assert_eq!(requests.len(), 2);
        assert!(requests[1].to_string().contains("sourceRepair"));
        let draft = host.0.drafts.lock().unwrap()[&preview.id].clone();
        let choices: Vec<_> = preview
            .points
            .iter()
            .map(|c| crate::store::AiChoice {
                candidate_id: c.point.id.clone(),
                point: c.point.clone(),
                action: "create".into(),
                target_id: None,
            })
            .collect();
        let operation = Uuid::new_v4().to_string();
        let saved = store
            .lock()
            .unwrap()
            .adopt_ai(draft.copy_batch(), choices.clone(), operation.clone())
            .unwrap();
        assert_eq!(saved.snapshot.points.len(), 2);
        let retry = store
            .lock()
            .unwrap()
            .adopt_ai(draft.copy_batch(), choices, operation)
            .unwrap();
        assert!(retry.duplicate);
        assert_eq!(retry.snapshot.points.len(), 2);
        drop(store);
        let reopened = crate::store::Store::isolated(directory);
        assert_eq!(reopened.snapshot().unwrap().points.len(), 2);
        assert_eq!(reopened.ai_records().unwrap().len(), 1);
    }
}

fn extraction_request(text: String) -> AiRequest {
    AiRequest {
        action: "extract".into(),
        text,
        source_name: None,
        resource_ids: vec![],
        session_id: None,
        original_record_id: None,
        allow_supplement: false,
    }
}

fn isolated_task() -> (Task, PathBuf) {
    let directory = std::env::current_dir()
        .unwrap()
        .join("target/import-recovery-tests")
        .join(Uuid::new_v4().to_string());
    let store = Arc::new(Mutex::new(crate::store::Store::isolated(directory.clone())));
    let epoch = store.lock().unwrap().epoch();
    (
        Task {
            id: Uuid::new_v4().to_string(),
            store,
            epoch,
            cancel: Arc::new(Cancellation::default()),
            channel: None,
        },
        directory,
    )
}

#[test]
fn structure_repair_does_not_spend_the_missing_source_repair_budget() {
    let (task, directory) = isolated_task();
    let snapshot = task.store.lock().unwrap().snapshot().unwrap();
    let (client, server, _) = fixture_with(ProviderKind::Openai, 3, |body, index| {
        if index == 0 {
            return "{\"points\":".into();
        }
        if body.to_string().contains("sourceRepair") {
            json!({"repairs":[{"id":"n1","evidence":[{"quote":"Docker 用于管理容器。","inferred":false}]}]}).to_string()
        } else {
            json!({"points":[{"point":point("n1","Docker"),"evidence":[]}],"warnings":[]})
                .to_string()
        }
    });
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result = runtime.block_on(run(
        &AiHost::default(),
        &task,
        extraction_request("Docker 用于管理容器。".into()),
        snapshot,
        directory,
        client,
    ));
    let requests = server.join().unwrap();
    assert!(
        matches!(result, Ok(AiResult::Extract { .. })),
        "separate recoverable defects must reach preview: {}",
        result.err().unwrap_or_default()
    );
    assert_eq!(requests.len(), 3);
}

#[test]
fn retry_retains_completed_chunks_without_publishing_an_incomplete_preview() {
    let (task, directory) = isolated_task();
    let host = AiHost::default();
    let first = "Linux 是操作系统。";
    let text = format!(
        "{first}{}Docker 用于管理容器。",
        " ".repeat(12_000 - first.len())
    );
    let (client, server, base_url) = fixture_with(ProviderKind::Openai, 5, |body, index| {
        let repair = body.to_string().contains("sourceRepair");
        if repair {
            let evidence = if index == 2 {
                vec![]
            } else {
                vec![json!({"quote":"Docker 用于管理容器。","inferred":false})]
            };
            json!({"repairs":[{"id":"n2","evidence":evidence}]}).to_string()
        } else if index == 0 {
            json!({"points":[{"point":point("n1","Linux"),"evidence":[{"quote":"Linux 是操作系统。","inferred":false}]}],"warnings":[]}).to_string()
        } else {
            json!({"points":[{"point":point("n2","Docker"),"evidence":[]}],"warnings":[]})
                .to_string()
        }
    });
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let snapshot = task.store.lock().unwrap().snapshot().unwrap();
    let first_result = runtime.block_on(run(
        &host,
        &task,
        extraction_request(text.clone()),
        snapshot,
        directory.clone(),
        client,
    ));
    assert!(
        first_result.is_err(),
        "unresolved input must not appear fully processed"
    );
    assert!(host.0.drafts.lock().unwrap().is_empty());
    assert!(task
        .store
        .lock()
        .unwrap()
        .snapshot()
        .unwrap()
        .points
        .is_empty());
    let client = provider::Provider::new(
        ConnectionConfig {
            provider: ProviderKind::Openai,
            model: "fixture-model".into(),
            base_url,
        },
        "synthetic-only".into(),
    )
    .unwrap();
    let snapshot = task.store.lock().unwrap().snapshot().unwrap();
    let retry = runtime.block_on(run(
        &host,
        &task,
        extraction_request(text),
        snapshot,
        directory,
        client,
    ));
    let requests = server.join().unwrap();
    let draft = match retry {
        Ok(AiResult::Extract { draft }) => draft,
        _ => panic!("retry must recover retained chunks into complete preview"),
    };
    assert_eq!(draft.points.len(), 2);
    assert_eq!(draft.points[0].point.name, "Linux");
    assert_eq!(draft.points[1].point.name, "Docker");
    assert_eq!(
        requests.len(),
        5,
        "completed first chunk must not be sent again"
    );
}
