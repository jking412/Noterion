use super::*;

pub(super) const DEFAULT_SPACE: &str = "default";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub name: String,
}

pub(super) fn prepare_spaces(connection: &mut Connection) -> Result<(), String> {
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| disk_error("无法读取空间版本", e))?;
    if version < 3 {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| disk_error("无法开始空间升级，原有知识未修改", e))?;
        let version: i32 = transaction
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|e| disk_error("无法读取空间版本", e))?;
        let application_id: i32 = transaction
            .query_row("PRAGMA application_id", [], |row| row.get(0))
            .map_err(|e| disk_error("无法识别正式存储", e))?;
        if application_id != APPLICATION_ID {
            return Err("存储身份已改变，未修改原有数据。".into());
        }
        if [1, 2].contains(&version) {
            // Validate all legacy business data before replacing any schema. DDL,
            // facts, receipts and the recent selection commit in one transaction.
            read_legacy_facts(&transaction)?;
            if version == 1 {
                transaction
                    .execute_batch(ai_support::AI_SCHEMA)
                    .map_err(|e| disk_error("空间升级失败，原有数据已保留", e))?;
            }
            for table in ["ai_import_records", "ai_adoption_receipts"] {
                let mut statement = transaction
                    .prepare(&format!("SELECT record_json FROM {table}"))
                    .map_err(|e| disk_error("原有采用记录无法读取，未升级空间", e))?;
                let rows = statement
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|e| disk_error("原有采用记录无法读取，未升级空间", e))?;
                for row in rows {
                    let json =
                        row.map_err(|e| disk_error("原有采用记录无法读取，未升级空间", e))?;
                    let _: AiRecord = serde_json::from_str(&json)
                        .map_err(|e| disk_error("原有采用记录损坏，未升级空间", e))?;
                }
            }
            transaction.execute_batch("
                CREATE TABLE noterion_spaces (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    revision INTEGER NOT NULL CHECK(revision>=0),
                    facts TEXT NOT NULL
                );
                INSERT INTO noterion_spaces SELECT 'default','默认空间',revision,facts FROM noterion_state WHERE singleton=1;
                CREATE TABLE noterion_preferences (
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                    active_space_id TEXT NOT NULL REFERENCES noterion_spaces(id)
                );
                INSERT INTO noterion_preferences VALUES(1,'default');
                ALTER TABLE ai_import_records RENAME TO ai_import_records_legacy;
                ALTER TABLE ai_adoption_receipts RENAME TO ai_adoption_receipts_legacy;
                DROP INDEX ai_receipts_fingerprint;
                CREATE TABLE ai_import_records (
                    space_id TEXT NOT NULL REFERENCES noterion_spaces(id),
                    id TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    PRIMARY KEY(space_id,id)
                );
                CREATE TABLE ai_adoption_receipts (
                    space_id TEXT NOT NULL REFERENCES noterion_spaces(id),
                    operation_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    PRIMARY KEY(space_id,operation_id)
                );
                CREATE INDEX ai_receipts_fingerprint ON ai_adoption_receipts(space_id,fingerprint);
                INSERT INTO ai_import_records SELECT 'default',id,record_json FROM ai_import_records_legacy;
                INSERT INTO ai_adoption_receipts SELECT 'default',operation_id,payload_hash,fingerprint,record_json FROM ai_adoption_receipts_legacy;
                DROP TABLE ai_import_records_legacy;
                DROP TABLE ai_adoption_receipts_legacy;
                DROP TABLE noterion_state;
                PRAGMA user_version=3;
            ").map_err(|e| disk_error("空间升级失败，原有数据已保留", e))?;
        } else if version != 3 {
            return Err("空间版本已改变，未修改原有数据。".into());
        }
        transaction
            .commit()
            .map_err(|e| disk_error("空间升级未提交，原有数据已保留", e))?;
    }
    let spaces = read_spaces(connection)?;
    if spaces.is_empty() {
        return Err("空间清单缺失，未创建空空间。".into());
    }
    for space in &spaces {
        read_facts(connection, &space.id)?;
    }
    let selected = active_space(connection)?;
    if !spaces.iter().any(|space| space.id == selected) {
        return Err("最近空间已不存在，未创建空空间。".into());
    }
    connection.prepare("SELECT space_id,id,record_json FROM ai_import_records LIMIT 0")
        .and_then(|_| connection.prepare("SELECT space_id,operation_id,payload_hash,fingerprint,record_json FROM ai_adoption_receipts LIMIT 0"))
        .map_err(|e| disk_error("空间采用记录无法读取，未重建数据", e))?;
    Ok(())
}

pub(super) fn active_space(connection: &Connection) -> Result<String, String> {
    connection
        .query_row(
            "SELECT active_space_id FROM noterion_preferences WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| disk_error("无法读取最近空间，未创建空空间", e))
}

pub(super) fn read_spaces(connection: &Connection) -> Result<Vec<Space>, String> {
    let mut statement = connection
        .prepare("SELECT id,name FROM noterion_spaces ORDER BY rowid")
        .map_err(|e| disk_error("空间清单无法读取", e))?;
    let rows = statement
        .query_map([], |row| {
            Ok(Space {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| disk_error("空间清单无法读取", e))?;
    rows.map(|row| {
        let space = row.map_err(|e| disk_error("空间清单无法读取", e))?;
        validate_space_name(&space.name)?;
        if space.id != DEFAULT_SPACE && Uuid::parse_str(&space.id).is_err() {
            return Err("空间身份无效，未重建数据。".into());
        }
        Ok(space)
    })
    .collect()
}

fn validate_space_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        Err("请输入 1–100 字的空间名称。".into())
    } else {
        Ok(())
    }
}

impl Store {
    pub fn space_id(&self) -> &str {
        &self.space_id
    }

    pub fn check_context(&self, space_id: &str, epoch: u64) -> Result<(), String> {
        self.ensure_available()?;
        self.check_context_identity(space_id, epoch)
    }

    pub(super) fn check_context_identity(&self, space_id: &str, epoch: u64) -> Result<(), String> {
        if space_id != self.space_id() || epoch != self.epoch {
            return Err("空间已切换，请在当前空间重新操作。".into());
        }
        Ok(())
    }

    pub fn create_space(&mut self, name: String) -> Result<Snapshot, String> {
        self.ensure_available()?;
        let name = name.trim().to_owned();
        validate_space_name(&name)?;
        let id = Uuid::new_v4().to_string();
        let transaction = self
            .connection
            .as_mut()
            .unwrap()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| disk_error("无法创建空间", e))?;
        transaction
            .execute(
                "INSERT INTO noterion_spaces(id,name,revision,facts) VALUES(?1,?2,0,?3)",
                params![id, name, serde_json::to_string(&Facts::default()).unwrap()],
            )
            .map_err(|e| disk_error("空间未保存，请重试", e))?;
        transaction
            .execute(
                "UPDATE noterion_preferences SET active_space_id=?1 WHERE singleton=1",
                [&id],
            )
            .map_err(|e| disk_error("无法保存当前空间", e))?;
        transaction
            .commit()
            .map_err(|e| disk_error("空间未保存，请重试", e))?;
        self.space_id = id;
        self.epoch = self.epoch.wrapping_add(1);
        self.snapshot()
    }

    pub fn switch_space(&mut self, id: &str) -> Result<Snapshot, String> {
        self.ensure_available()?;
        let connection = self.connection.as_mut().unwrap();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| disk_error("无法切换空间", e))?;
        read_facts(&transaction, id)?;
        transaction
            .execute(
                "UPDATE noterion_preferences SET active_space_id=?1 WHERE singleton=1",
                [id],
            )
            .map_err(|e| disk_error("无法保存当前空间", e))?;
        transaction
            .commit()
            .map_err(|e| disk_error("空间未切换，请重试", e))?;
        self.space_id = id.to_owned();
        self.epoch = self.epoch.wrapping_add(1);
        self.snapshot()
    }

    pub fn rename_space(&mut self, id: &str, name: String) -> Result<Snapshot, String> {
        self.ensure_available()?;
        let name = name.trim().to_owned();
        validate_space_name(&name)?;
        let connection = self.connection.as_mut().unwrap();
        let affected = connection
            .execute(
                "UPDATE noterion_spaces SET name=?1 WHERE id=?2",
                params![name, id],
            )
            .map_err(|e| disk_error("空间名称未保存，请重试", e))?;
        if affected != 1 {
            return Err("空间已不存在，请重新选择。".into());
        }
        self.snapshot()
    }
}
