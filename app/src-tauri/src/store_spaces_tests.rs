use super::*;

struct Fixture {
    root: PathBuf,
    config: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!("noterion-spaces-{}", Uuid::new_v4()));
        let root = base.join("data");
        let config = base.join("config");
        fs::create_dir_all(&config).unwrap();
        Self { root, config }
    }
    fn open(&self, create: bool) -> Store {
        let (root, connection) = open_store(&self.root, create).unwrap();
        let space_id = active_space(&connection).unwrap();
        Store {
            root,
            config_dir: self.config.clone(),
            connection: Some(connection),
            error: None,
            epoch: 1,
            space_id,
        }
    }
    fn legacy(&self, version: i32, corrupt_receipt: bool) -> String {
        fs::create_dir_all(self.root.join("files")).unwrap();
        let id = "10000000-0000-4000-8000-000000000001".to_owned();
        let resource_id = "20000000-0000-4000-8000-000000000001".to_owned();
        fs::write(
            self.root
                .join("files")
                .join(managed_name(&resource_id, "笔记.txt")),
            "旧资料",
        )
        .unwrap();
        let facts = Facts {
            points: vec![Point {
                id: id.clone(),
                name: "Docker".into(),
                description: "原始理解".into(),
                topic_ids: vec![],
                resource_ids: vec![resource_id.clone()],
                is_theme: true,
                color: "#A1B2C3".into(),
            }],
            resources: vec![Resource {
                id: resource_id.clone(),
                title: "笔记".into(),
                kind: "text".into(),
                url: None,
                filename: Some("笔记.txt".into()),
                mime: Some("text/plain".into()),
                size: Some(9),
                status: None,
            }],
            positions: HashMap::from([(id.clone(), Position { x: 42.0, y: -17.0 })]),
        };
        let connection = Connection::open(self.root.join(DATABASE)).unwrap();
        connection.execute_batch(&format!("PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version={version}; CREATE TABLE noterion_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,facts TEXT NOT NULL);{}",
            if version == 2 { ai_support::AI_SCHEMA } else { "" })).unwrap();
        connection
            .execute(
                "INSERT INTO noterion_state VALUES(1,7,?1)",
                [serde_json::to_string(&facts).unwrap()],
            )
            .unwrap();
        if version == 2 {
            let record = AiRecord {
                id: "legacy-record".into(),
                source_name: "旧笔记".into(),
                created_at: 1,
                point_ids: vec![id],
                added: 1,
                updated: 0,
                reused: 0,
                source_resource_ids: vec![resource_id.clone()],
                fingerprint: "legacy-input".into(),
                mappings: HashMap::new(),
            };
            let json = serde_json::to_string(&record).unwrap();
            connection
                .execute(
                    "INSERT INTO ai_import_records VALUES('legacy-record',?1)",
                    [&json],
                )
                .unwrap();
            connection.execute("INSERT INTO ai_adoption_receipts VALUES('legacy-operation','legacy-hash','legacy-input',?1)",[if corrupt_receipt { "broken" } else { &json }]).unwrap();
        }
        resource_id
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.root.parent().unwrap());
    }
}

#[test]
fn independent_spaces_keep_same_named_knowledge_and_recent_space_after_reopen() {
    let fixture = Fixture::new();
    let mut store = fixture.open(true);
    let original = store.snapshot().unwrap();
    let space = store.create_space("项目 A".into()).unwrap();
    assert_eq!(space.spaces.len(), 2);
    assert_ne!(space.space_id, original.space_id);
    let (batch, choices) = candidate(&store, "input-a");
    let id = choices[0].point.id.clone();
    store.adopt_ai(batch, choices, "adopt-a".into()).unwrap();
    store.switch_space(&original.space_id).unwrap();
    assert!(store.snapshot().unwrap().points.is_empty());
    store.switch_space(&space.space_id).unwrap();
    let restored = store.snapshot().unwrap();
    assert_eq!(restored.points[0].id, id);
    assert_eq!(restored.points[0].color, "#112233");
    store
        .rename_space(&space.space_id, "新项目".into())
        .unwrap();
    drop(store);
    let reopened = fixture.open(false).snapshot().unwrap();
    assert_eq!(reopened.space_id, space.space_id);
    assert_eq!(
        reopened
            .spaces
            .iter()
            .find(|s| s.id == space.space_id)
            .unwrap()
            .name,
        "新项目"
    );
    assert_eq!(reopened.points[0].description, "项目 A");
}

fn candidate(store: &Store, fingerprint: &str) -> (AiBatch, Vec<AiChoice>) {
    let snapshot = store.snapshot().unwrap();
    let point = Point {
        id: Uuid::new_v4().to_string(),
        name: "Docker".into(),
        description: "项目 A".into(),
        topic_ids: vec![],
        resource_ids: vec![],
        is_theme: true,
        color: "#112233".into(),
    };
    let choices = vec![AiChoice {
        candidate_id: point.id.clone(),
        point: point.clone(),
        action: "create".into(),
        target_id: None,
    }];
    (
        AiBatch {
            draft_id: Uuid::new_v4().to_string(),
            root: snapshot.root,
            epoch: snapshot.epoch,
            space_id: snapshot.space_id,
            baseline_points: snapshot.points,
            baseline_resources: snapshot.resources,
            points: vec![point],
            fingerprint: fingerprint.into(),
            source_name: "笔记.md".into(),
            source_resource_ids: vec![],
            original_record_id: None,
        },
        choices,
    )
}

#[test]
fn legacy_versions_preserve_identity_colors_positions_files_and_receipts() {
    for version in [1, 2] {
        let fixture = Fixture::new();
        let resource_id = fixture.legacy(version, false);
        let mut store = fixture.open(false);
        let snapshot = store.snapshot().unwrap();
        assert_eq!(snapshot.space_id, "default");
        assert_eq!(snapshot.spaces[0].name, "默认空间");
        assert_eq!(snapshot.revision, 7);
        assert_eq!(
            snapshot.points[0].id,
            "10000000-0000-4000-8000-000000000001"
        );
        assert_eq!(snapshot.points[0].color, "#A1B2C3");
        assert_eq!(snapshot.points[0].resource_ids, vec![resource_id.clone()]);
        assert_eq!(snapshot.positions[&snapshot.points[0].id].x, 42.0);
        assert_eq!(snapshot.positions[&snapshot.points[0].id].y, -17.0);
        let (file, _, _) = store.resolve_file(&resource_id).unwrap();
        assert_eq!(fs::read_to_string(file).unwrap(), "旧资料");
        if version == 2 {
            assert_eq!(store.ai_records().unwrap()[0].id, "legacy-record");
            assert_eq!(
                store.ai_duplicate("legacy-input").unwrap().unwrap().id,
                "legacy-record"
            );
        }
        store.create_space("另一个空间".into()).unwrap();
        assert!(store.resolve_file(&resource_id).is_err());
        assert!(store.ai_duplicate("legacy-input").unwrap().is_none());
        assert!(store.ai_records().unwrap().is_empty());
    }
}

#[test]
fn broken_legacy_receipt_aborts_upgrade_without_replacing_original_data() {
    let fixture = Fixture::new();
    fixture.legacy(2, true);
    let database = fixture.root.join(DATABASE);
    let before = fs::read(&database).unwrap();
    let error = open_store(&fixture.root, false).err().unwrap();
    assert!(error.contains("原有采用记录损坏"));
    assert_eq!(fs::read(&database).unwrap(), before);

    // A failure after v1's AI tables have been created must also roll those
    // changes back, so the exact original database remains recoverable.
    let fixture = Fixture::new();
    fixture.legacy(1, false);
    let database = fixture.root.join(DATABASE);
    Connection::open(&database)
        .unwrap()
        .execute_batch("CREATE TABLE noterion_spaces(blocker TEXT);")
        .unwrap();
    let before = fs::read(&database).unwrap();
    assert!(open_store(&fixture.root, false).is_err());
    assert_eq!(fs::read(&database).unwrap(), before);
}

#[test]
fn repeated_inputs_are_local_to_each_space_and_old_drafts_cannot_return_after_switch() {
    let fixture = Fixture::new();
    let mut store = fixture.open(true);
    let a = store.snapshot().unwrap();
    let (batch, choices) = candidate(&store, "shared-input");
    let old_draft = batch.clone();
    let old_choices = choices.clone();
    let first = store
        .adopt_ai(batch.clone(), choices.clone(), "same-operation".into())
        .unwrap();
    assert!(!first.duplicate);
    assert!(
        store
            .adopt_ai(batch, choices, "same-operation".into())
            .unwrap()
            .duplicate
    );
    let b = store.create_space("空间 B".into()).unwrap();
    assert!(store.ai_duplicate("shared-input").unwrap().is_none());
    let (batch, choices) = candidate(&store, "shared-input");
    assert!(
        !store
            .adopt_ai(batch, choices, "same-operation".into())
            .unwrap()
            .duplicate
    );
    assert_eq!(store.snapshot().unwrap().points.len(), 1);
    assert!(store.check_context(&a.space_id, a.epoch).is_err());
    store.switch_space(&a.space_id).unwrap();
    assert!(store.check_context(&a.space_id, a.epoch).is_err());
    assert!(store
        .adopt_ai(old_draft, old_choices, "late-operation".into())
        .is_err());
    assert_eq!(store.snapshot().unwrap().points.len(), 1);
    assert_eq!(store.ai_records().unwrap().len(), 1);
    store.switch_space(&b.space_id).unwrap();
    assert_eq!(store.ai_records().unwrap().len(), 1);
}

#[test]
fn unavailable_previous_directory_can_reopen_moved_data_but_rejects_stale_contexts() {
    let fixture = Fixture::new();
    let resource_id = fixture.legacy(2, false);
    let mut store = fixture.open(false);
    let previous = store.snapshot().unwrap();
    // Disconnect the old handles, as app_load recovery does, before moving the
    // fixture on Windows. The active visit identity remains in memory.
    store.connection.take();
    let moved = fixture.root.with_file_name("moved-data");
    fs::rename(&fixture.root, &moved).unwrap();
    assert!(store.snapshot().is_err());
    assert!(store
        .select_directory(&moved, false, &previous.space_id, previous.epoch + 1)
        .is_err());
    assert!(store.select_directory(&moved, false, "", 0).is_err());
    let restored = store
        .select_directory(&moved, false, &previous.space_id, previous.epoch)
        .expect("the current visit can reconnect its moved data");
    assert_eq!(
        restored.root,
        fs::canonicalize(&moved).unwrap().to_string_lossy()
    );
    assert_eq!(restored.points[0].description, "原始理解");
    let (file, _, _) = store.resolve_file(&resource_id).unwrap();
    assert_eq!(fs::read_to_string(file).unwrap(), "旧资料");
    assert!(store
        .select_directory(&moved, false, &previous.space_id, previous.epoch)
        .is_err());
    assert_eq!(store.snapshot().unwrap().epoch, restored.epoch);

    let mut unopened = Store {
        root: fixture.root.clone(),
        config_dir: fixture.config.clone(),
        connection: None,
        error: Some("原目录不可用".into()),
        epoch: 0,
        space_id: String::new(),
    };
    assert_eq!(
        unopened
            .select_directory(&moved, false, "", 0)
            .unwrap()
            .points[0]
            .description,
        "原始理解"
    );
}
