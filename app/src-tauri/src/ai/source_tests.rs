use super::*;

fn point(id: &str, name: &str) -> serde_json::Value {
    json!({"id":id,"name":name,"description":"","topicIds":[],"resourceIds":[],"isTheme":false,"color":"neutral"})
}

#[test]
fn source_recovery_never_fabricates_evidence_for_missing_sources() {
    let original = "Docker 用于管理容器。";
    let empty = json!({"points":[{"point":point("n1","Docker"),"evidence":[]}]}).to_string();
    let error = decode(
        &empty,
        original,
        0,
        original,
        &HashMap::new(),
        &HashMap::new(),
    )
    .err()
    .expect("missing sources must request a repair instead of manufacturing evidence");
    assert_eq!(error, "AI 候选缺少可核对的原文依据。");
    assert_eq!(
        source_plan(&empty, original).unwrap().unwrap()["candidates"][0]["reasons"],
        json!(["missing"])
    );
}

#[test]
fn source_recovery_keeps_all_nine_verifiable_quotes() {
    let original =
        "Docker 1 Docker 2 Docker 3 Docker 4 Docker 5 Docker 6 Docker 7 Docker 8 Docker 9";
    let quotes: Vec<_> = (1..=9)
        .map(|i| json!({"quote":format!("Docker {i}"),"inferred":false}))
        .collect();
    let output = json!({"points":[{"point":point("n1","Docker"),"evidence":quotes}],"warnings":[]})
        .to_string();
    let decoded = decode(
        &output,
        original,
        0,
        original,
        &HashMap::new(),
        &HashMap::new(),
    );
    let (candidates, _) = decoded.unwrap_or_else(|error| {
        panic!("nine genuine quotations must reach preview without losing sources: {error}")
    });
    assert_eq!(candidates[0].evidence.len(), 9);
    assert_eq!(candidates[0].evidence[8].quote, "Docker 9");
    assert_eq!(candidates[0].evidence[8].start, 72);
    assert_eq!(candidates[0].evidence[8].end, 80);
}

#[test]
fn source_recovery_maps_whitespace_back_to_exact_chinese_emoji_and_utf16_source() {
    let prefix = "前😀\r\n";
    let chunk = "Docker\r\n\t学习 😀 记录。";
    let original = format!("{prefix}{chunk}\n后记");
    let output = json!({"points":[{"point":point("n1","Docker"),"evidence":[{"quote":"Docker 学习 😀 记录。","inferred":false}]}]}).to_string();
    assert!(
        source_plan(&output, chunk).unwrap().is_none(),
        "format changes need no model repair"
    );
    let (candidates, _) = decode(
        &output,
        chunk,
        prefix.len(),
        &original,
        &HashMap::new(),
        &HashMap::new(),
    )
    .unwrap();
    let evidence = &candidates[0].evidence[0];
    assert_eq!(evidence.quote, "Docker\r\n\t学习 😀 记录。");
    assert_eq!((evidence.start, evidence.end), (5, 23));
    assert!(!evidence.inferred);
}

#[test]
fn source_recovery_requests_precise_sources_when_whitespace_mapping_is_ambiguous() {
    let original = "Docker\t学习。 / Docker\r\n学习。";
    let output = json!({"points":[{"point":point("n1","Docker"),"evidence":[{"quote":"Docker 学习。","inferred":false}]}]}).to_string();
    let plan = source_plan(&output, original).unwrap().unwrap();
    assert_eq!(
        plan["candidates"][0]["reasons"],
        json!(["ambiguous_whitespace_match"])
    );
    assert!(decode(
        &output,
        original,
        0,
        original,
        &HashMap::new(),
        &HashMap::new()
    )
    .is_err());
}

#[test]
fn source_recovery_cannot_borrow_evidence_from_another_chunk_or_a_changed_original() {
    let original = "Linux。\nDocker。";
    let chunk = "Linux。\n";
    let output = json!({"points":[{"point":point("n1","Docker"),"evidence":[{"quote":"Docker。","inferred":false}]}]}).to_string();
    assert_eq!(
        source_plan(&output, chunk).unwrap().unwrap()["candidates"][0]["reasons"],
        json!(["not_in_chunk"])
    );
    assert!(decode(
        &output,
        chunk,
        0,
        original,
        &HashMap::new(),
        &HashMap::new()
    )
    .is_err());
    let valid = json!({"points":[{"point":point("n1","Linux"),"evidence":[{"quote":"Linux。","inferred":false}]}]}).to_string();
    assert!(
        decode(&valid, chunk, 1, original, &HashMap::new(), &HashMap::new()).is_err(),
        "offset must identify this exact unchanged chunk"
    );
}

#[test]
fn source_recovery_preserves_the_selected_identity_of_identical_source_passages() {
    let prefix = "😀\r\n";
    let repeated = "学".repeat(400);
    let chunk = repeated.repeat(2);
    let original = format!("{prefix}{chunk}");
    let catalog = source_passages(&chunk);
    assert_eq!(catalog.len(), 2);
    assert_eq!(catalog[0]["text"], catalog[1]["text"]);
    let output = json!({"points":[{"point":point("n1","学"),"evidence":[]}]}).to_string();
    let repair = json!({"repairs":[{"id":"n1","sourceIds":["s2"]}]}).to_string();
    let patched = apply_source_repairs(&output, &repair, &chunk).unwrap();
    let (candidates, _) = decode(
        &patched,
        &chunk,
        prefix.len(),
        &original,
        &HashMap::new(),
        &HashMap::new(),
    )
    .unwrap();
    let evidence = &candidates[0].evidence[0];
    assert_eq!(evidence.quote, repeated);
    assert_eq!(
        (evidence.start, evidence.end),
        (404, 804),
        "sourceId must locate the selected second occurrence"
    );
    assert!(evidence.inferred);
}

#[test]
fn source_recovery_repairs_only_missing_sources_and_preserves_knowledge_relationships() {
    let original = "Docker：管理容器。\n进入容器终端：docker exec -it demo sh。";
    let mut theme = point("n1", "Docker");
    theme["isTheme"] = json!(true);
    theme["color"] = json!("docker");
    let mut operation = point("n2", "进入容器终端");
    operation["description"] = json!("`docker exec -it demo sh`");
    operation["topicIds"] = json!(["n1"]);
    operation["resourceIds"] = json!(["resource1"]);
    let before = json!({"points":[
        {"point":theme,"evidence":[{"quote":"Docker：管理容器。","inferred":false}]},
        {"point":operation}
    ],"warnings":[]});
    let output = before.to_string();
    let plan = source_plan(&output, original).unwrap().unwrap();
    assert_eq!(plan["candidates"].as_array().unwrap().len(), 1);
    assert_eq!(plan["candidates"][0]["id"], "n2");
    let repair = json!({"repairs":[{"id":"n2","evidence":[{"quote":"进入容器终端：docker exec -it demo sh。","inferred":false}]}]}).to_string();
    let patched = apply_source_repairs(&output, &repair, original).unwrap();
    let after: serde_json::Value = serde_json::from_str(&patched).unwrap();
    assert_eq!(after["points"][0], before["points"][0]);
    assert_eq!(after["points"][1]["point"], before["points"][1]["point"]);
    let resources = HashMap::from([("resource1".into(), "saved-material".into())]);
    let (candidates, _) =
        decode(&patched, original, 0, original, &HashMap::new(), &resources).unwrap();
    assert_eq!(candidates.len(), 2);
    assert_eq!(
        candidates[1].point.topic_ids,
        vec![candidates[0].point.id.clone()]
    );
    assert_eq!(candidates[1].point.resource_ids, vec!["saved-material"]);
    assert_eq!(candidates[1].point.description, "`docker exec -it demo sh`");
}

#[test]
fn source_recovery_rejects_incomplete_unrelated_or_overbroad_repair_patches() {
    let original = "Docker：管理容器。\nLinux：操作系统。";
    let output = json!({"points":[
        {"point":point("n1","Linux"),"evidence":[{"quote":"Linux：操作系统。","inferred":false}]},
        {"point":point("n2","Docker"),"evidence":[]}
    ]})
    .to_string();
    let valid_evidence = json!([{"quote":"Docker：管理容器。","inferred":false}]);
    let invalid_patches = [
        json!({"repairs":[]}),
        json!({"repairs":[{"id":"n1","evidence":valid_evidence}]}),
        json!({"repairs":[{"id":"unknown","evidence":valid_evidence}]}),
        json!({"repairs":[{"id":"n2","evidence":valid_evidence},{"id":"n2","evidence":valid_evidence}]}),
        json!({"repairs":[{"id":"n2","evidence":valid_evidence},{"id":"n1","evidence":valid_evidence}]}),
        json!({"repairs":[{"id":"n2","evidence":[]}]}),
        json!({"repairs":[{"id":"n2","sourceIds":[]}]}),
        json!({"repairs":[{"id":"n2","sourceIds":["s99"]}]}),
        json!({"repairs":[{"id":"n2","sourceIds":["s1","s1"]}]}),
        json!({"repairs":[{"id":"n2","sourceIds":["s1"],"evidence":valid_evidence}]}),
        json!({"repairs":[{"id":"n2","evidence":valid_evidence,"point":point("n2","更改知识") }]}),
        json!({"repairs":[{"id":"n2","evidence":[{"quote":"Docker 可以操作云服务器。","inferred":false}]}]}),
        json!({"repairs":[{"id":"n2","evidence":[{"quote":"Docker：管理容器。","inferred":false,"sourceId":"s1"}]}]}),
    ];
    for patch in invalid_patches {
        assert!(
            apply_source_repairs(&output, &patch.to_string(), original).is_err(),
            "must reject: {patch}"
        );
    }
    let two_missing = json!({"points":[
        {"point":point("n1","Linux"),"evidence":[]},
        {"point":point("n2","Docker"),"evidence":[]}
    ]})
    .to_string();
    let repeated_identity = json!({"repairs":[
        {"id":"n2","evidence":valid_evidence},
        {"id":"n2","evidence":valid_evidence}
    ]})
    .to_string();
    assert!(apply_source_repairs(&two_missing, &repeated_identity, original).is_err(), "matching patch count must not allow duplicate identities to leave another candidate unrepaired");
}

#[test]
fn source_recovery_distinguishes_excess_source_count_from_missing_sources() {
    let original = "Docker。";
    let output = json!({"points":[{"point":point("n1","Docker"),"evidence":vec![json!({"quote":original,"inferred":false});65]}]}).to_string();
    assert_eq!(
        source_plan(&output, original).unwrap().unwrap()["candidates"][0]["reasons"],
        json!(["too_many"])
    );
    let error = decode(
        &output,
        original,
        0,
        original,
        &HashMap::new(),
        &HashMap::new(),
    )
    .err()
    .unwrap();
    assert_eq!(error, "AI 候选的原文依据数量超出上限。");
}
