//! Atomic adoption of server-owned AI drafts into the existing local store.
use super::*;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) const AI_SCHEMA: &str = "
CREATE TABLE ai_import_records (
    id TEXT PRIMARY KEY NOT NULL,
    record_json TEXT NOT NULL
);
CREATE TABLE ai_adoption_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    payload_hash TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    record_json TEXT NOT NULL
);
CREATE INDEX ai_receipts_fingerprint ON ai_adoption_receipts(fingerprint);
";

/// Constructed only by the Rust AI module, never deserialized from the WebView.
#[derive(Clone, Serialize)]
pub struct AiBatch {
    pub draft_id: String,
    pub root: String,
    pub epoch: u64,
    pub baseline_points: Vec<Point>,
    pub baseline_resources: Vec<Resource>,
    pub points: Vec<Point>,
    pub fingerprint: String,
    pub source_name: String,
    pub source_resource_ids: Vec<String>,
    pub original_record_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiChoice {
    pub candidate_id: String,
    pub point: Point,
    pub action: String,
    pub target_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiRecord {
    pub id: String,
    pub source_name: String,
    pub created_at: u64,
    pub point_ids: Vec<String>,
    pub added: usize,
    pub updated: usize,
    pub reused: usize,
    pub source_resource_ids: Vec<String>,
    pub fingerprint: String,
    pub mappings: HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAdoptResult {
    pub snapshot: Snapshot,
    pub record: AiRecord,
    pub duplicate: bool,
}

pub(super) fn prepare_schema(connection: &mut Connection) -> Result<(), String> {
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| disk_error("无法读取存储版本", e))?;
    if version == 1 {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| disk_error("无法开始存储升级，原有知识未修改", e))?;
        // Recheck after acquiring the write transaction: another app process may
        // have opened or upgraded the same data directory in the meantime.
        let (application_id, current_version): (i32, i32) = (
            transaction
                .query_row("PRAGMA application_id", [], |row| row.get(0))
                .map_err(|e| disk_error("无法识别正式存储", e))?,
            transaction
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(|e| disk_error("无法读取存储版本", e))?,
        );
        if application_id != APPLICATION_ID || ![1, 2].contains(&current_version) {
            return Err("存储版本已改变，未升级或覆盖原有数据。".into());
        }
        read_facts(&transaction)?;
        if current_version == 1 {
            transaction
                .execute_batch(AI_SCHEMA)
                .and_then(|_| transaction.execute_batch("PRAGMA user_version=2;"))
                .map_err(|e| disk_error("存储升级失败，原有知识未修改", e))?;
        }
        transaction
            .commit()
            .map_err(|e| disk_error("存储升级未完成，请检查目录权限和磁盘", e))?;
    }
    // Missing or incompatible tables are an error, not permission to recreate
    // records or replace the authoritative facts with an empty database.
    connection
        .prepare("SELECT id, record_json FROM ai_import_records LIMIT 0")
        .and_then(|_| {
            connection.prepare("SELECT operation_id, payload_hash, fingerprint, record_json FROM ai_adoption_receipts LIMIT 0")
        })
        .map_err(|e| disk_error("AI 采用记录无法读取，原有数据未重建", e))?;
    Ok(())
}

impl Store {
    /// Validate a complete set of new candidates against today's official graph.
    /// Positions are deliberately outside the AI knowledge output contract.
    pub fn validate_candidate_points(&self, points: &[Point]) -> Result<(), String> {
        self.ensure_available()?;
        let (mut facts, _) = read_facts(self.connection.as_ref().unwrap())?;
        facts.points.extend_from_slice(points);
        validate_facts(&facts)
    }

    /// Exact-input lookup uses the persistent receipt ledger so updating a record
    /// or deleting its contributed points never makes an old input appear new.
    pub fn ai_duplicate(&self, fingerprint: &str) -> Result<Option<AiRecord>, String> {
        self.ensure_available()?;
        self.connection
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT record_json FROM ai_adoption_receipts WHERE fingerprint=?1 ORDER BY rowid LIMIT 1",
                [fingerprint],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| disk_error("无法核对重复输入", e))?
            .map(|json| decode_record(&json))
            .transpose()
    }

    pub fn ai_records(&self) -> Result<Vec<AiRecord>, String> {
        self.ensure_available()?;
        let mut statement = self
            .connection
            .as_ref()
            .unwrap()
            .prepare("SELECT record_json FROM ai_import_records ORDER BY rowid DESC")
            .map_err(|e| disk_error("无法读取导入记录", e))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| disk_error("无法读取导入记录", e))?;
        rows.map(|row| {
            let json = row.map_err(|e| disk_error("无法读取导入记录", e))?;
            decode_record(&json)
        })
        .collect()
    }

    pub fn adopt_ai(
        &mut self,
        batch: AiBatch,
        choices: Vec<AiChoice>,
        operation_id: String,
    ) -> Result<AiAdoptResult, String> {
        self.ensure_available()?;
        if operation_id.trim().is_empty()
            || operation_id.len() > 200
            || operation_id.chars().any(char::is_control)
        {
            return Err("采用请求无效，请重新确认候选。".into());
        }
        if batch.root != self.root.to_string_lossy() {
            return Err("数据目录已切换，请在当前目录重新整理知识。".into());
        }
        // The digest binds the operation to the server-owned draft AND all user
        // choices. The database never keeps the complete original input text.
        let payload = serde_json::to_vec(&(&batch, &choices))
            .map_err(|e| disk_error("无法整理采用请求", e))?;
        let payload_hash = format!("{:x}", Sha256::digest(payload));
        let root = self.root.clone();
        let epoch = self.epoch;
        let transaction = self
            .connection
            .as_mut()
            .unwrap()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| disk_error("无法开始采用，原有知识未修改", e))?;
        let (mut facts, revision) = read_facts(&transaction)?;

        // A successful commit may have lost its UI response. Check its receipt
        // before any stale-draft test so retrying never recreates or overwrites.
        if let Some((saved_hash, json)) = transaction
            .query_row(
                "SELECT payload_hash, record_json FROM ai_adoption_receipts WHERE operation_id=?1",
                [&operation_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|e| disk_error("无法核对采用回执", e))?
        {
            if saved_hash != payload_hash {
                return Err("同一次采用请求的内容已经改变，请重新确认并发起新的采用。".into());
            }
            return Ok(AiAdoptResult {
                snapshot: make_snapshot(&root, facts, revision),
                record: decode_record(&json)?,
                duplicate: true,
            });
        }
        if epoch != batch.epoch {
            return Err("数据目录已重新打开，请重新核对当前目录的候选知识。".into());
        }
        if batch.fingerprint.is_empty() || batch.fingerprint.len() > 256 {
            return Err("输入指纹无效，请重新整理知识。".into());
        }

        // Fingerprints survive knowledge deletion and record updates. An exact
        // repeated input reports its prior adoption without reviving deleted IDs.
        if let Some(json) = transaction
            .query_row(
                "SELECT record_json FROM ai_adoption_receipts WHERE fingerprint=?1 ORDER BY rowid LIMIT 1",
                [&batch.fingerprint],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| disk_error("无法核对重复输入", e))?
        {
            let record = decode_record(&json)?;
            save_receipt(&transaction, &operation_id, &payload_hash, &batch.fingerprint, &record)?;
            transaction
                .commit()
                .map_err(|e| disk_error("重复输入回执未保存，请重试", e))?;
            return Ok(AiAdoptResult {
                snapshot: make_snapshot(&root, facts, revision),
                record,
                duplicate: true,
            });
        }
        let original_record = match &batch.original_record_id {
            Some(id) => Some(
                read_record(&transaction, id)?.ok_or("原导入记录已不存在，请重新选择更新记录。")?,
            ),
            None => None,
        };
        let candidate_ids: HashSet<&str> = batch.points.iter().map(|p| p.id.as_str()).collect();
        if candidate_ids.len() != batch.points.len()
            || choices.len() != batch.points.len()
            || batch.points.iter().any(|p| {
                Uuid::parse_str(&p.id).is_err()
                    || facts.points.iter().any(|existing| existing.id == p.id)
            })
        {
            return Err("候选身份或采用选择不完整，请重新核对整批知识。".into());
        }

        let mut mappings = HashMap::new();
        let mut seen_candidates = HashSet::new();
        let mut used_targets = HashSet::new();
        for choice in &choices {
            if !candidate_ids.contains(choice.candidate_id.as_str())
                || !seen_candidates.insert(choice.candidate_id.as_str())
                || choice.point.id != choice.candidate_id
            {
                return Err("候选身份不能修改或重复，请重新核对整批知识。".into());
            }
            let target = match choice.action.as_str() {
                "skip" => continue,
                "create" => {
                    if choice.target_id.is_some()
                        || facts.points.iter().any(|p| p.id == choice.candidate_id)
                    {
                        return Err("新建候选的身份已被占用，请重新整理知识。".into());
                    }
                    choice.candidate_id.clone()
                }
                "reuse" | "update" => {
                    let target = choice
                        .target_id
                        .as_ref()
                        .ok_or("请明确选择要复用或更新的已有知识点。")?;
                    check_point_baseline(&facts, &batch, target)?;
                    target.clone()
                }
                _ => return Err("采用方式无效，请选择新建、复用、更新或跳过。".into()),
            };
            if !used_targets.insert(target.clone()) {
                return Err("多个候选不能同时写入同一个知识点，请先合并候选或分别处理。".into());
            }
            mappings.insert(choice.candidate_id.clone(), target);
        }
        if mappings.is_empty() {
            return Err("请至少选择一个需要采用的知识点。".into());
        }

        let mut additions = Vec::new();
        let mut modifications = Vec::new();
        let (mut added, mut updated, mut reused) = (0, 0, 0);
        for choice in &choices {
            if choice.action == "skip" {
                continue;
            }
            let mut point = choice.point.clone();
            point.id = mappings[&choice.candidate_id].clone();
            point.name = point.name.trim().to_owned();
            for topic_id in &mut point.topic_ids {
                if candidate_ids.contains(topic_id.as_str()) {
                    *topic_id = mappings
                        .get(topic_id)
                        .ok_or("某个所属主题已被跳过，请修正引用或一并采用该主题。")?
                        .clone();
                } else {
                    check_point_baseline(&facts, &batch, topic_id)?;
                }
            }
            for resource_id in &point.resource_ids {
                check_resource_baseline(&facts, &batch, resource_id)?;
            }
            // Reject malformed user edits before unioning with existing links.
            if point.name.is_empty()
                || !valid_point_color(&point.color)
                || point.topic_ids.iter().collect::<HashSet<_>>().len() != point.topic_ids.len()
                || point.resource_ids.iter().collect::<HashSet<_>>().len()
                    != point.resource_ids.len()
            {
                return Err("候选名称、颜色或关联重复，请修正后再采用。".into());
            }
            match choice.action.as_str() {
                "create" => {
                    added += 1;
                    additions.push(point);
                }
                "reuse" | "update" => {
                    let existing = facts.points.iter().find(|p| p.id == point.id).unwrap();
                    if choice.action == "reuse" {
                        let mut retained = existing.clone();
                        retained.topic_ids.extend(point.topic_ids);
                        retained.resource_ids.extend(point.resource_ids);
                        unique(&mut retained.topic_ids);
                        unique(&mut retained.resource_ids);
                        modifications.push(retained);
                        reused += 1;
                    } else {
                        // AI updates content and links, not the user's visual styling.
                        point.color = existing.color.clone();
                        // Input omission is not an unlink/delete instruction.
                        point.topic_ids.extend(existing.topic_ids.iter().cloned());
                        point
                            .resource_ids
                            .extend(existing.resource_ids.iter().cloned());
                        unique(&mut point.topic_ids);
                        unique(&mut point.resource_ids);
                        modifications.push(point);
                        updated += 1;
                    }
                }
                _ => unreachable!(),
            }
        }
        for source_id in &batch.source_resource_ids {
            check_resource_baseline(&facts, &batch, source_id)?;
        }
        for point in modifications {
            let index = facts.points.iter().position(|p| p.id == point.id).unwrap();
            facts.points[index] = point;
        }
        facts.points.extend(additions);
        validate_facts(&facts)?;

        let mut record = original_record.unwrap_or_else(|| AiRecord {
            id: Uuid::new_v4().to_string(),
            source_name: String::new(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            point_ids: Vec::new(),
            added: 0,
            updated: 0,
            reused: 0,
            source_resource_ids: Vec::new(),
            fingerprint: String::new(),
            mappings: HashMap::new(),
        });
        record.source_name = batch.source_name.trim().to_owned();
        record.fingerprint = batch.fingerprint.clone();
        record.added = added;
        record.updated = updated;
        record.reused = reused;
        record.point_ids.extend(
            choices
                .iter()
                .filter_map(|c| mappings.get(&c.candidate_id).cloned()),
        );
        unique(&mut record.point_ids);
        record
            .source_resource_ids
            .extend(batch.source_resource_ids.iter().cloned());
        unique(&mut record.source_resource_ids);
        record.mappings.extend(mappings);
        let next_revision = revision
            .checked_add(1)
            .ok_or("数据版本已超出可保存范围。")?;
        let sqlite_revision =
            i64::try_from(next_revision).map_err(|_| "数据版本已超出可保存范围。")?;
        let serialized =
            serde_json::to_string(&facts).map_err(|e| disk_error("无法整理待采用知识", e))?;
        transaction
            .execute(
                "UPDATE noterion_state SET revision=?1, facts=?2 WHERE singleton=1",
                params![sqlite_revision, serialized],
            )
            .map_err(|e| disk_error("整批知识保存失败，原有内容未修改", e))?;
        let record_json =
            serde_json::to_string(&record).map_err(|e| disk_error("无法整理导入记录", e))?;
        transaction
            .execute("INSERT INTO ai_import_records(id,record_json) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json", params![record.id, record_json])
            .map_err(|e| disk_error("导入记录保存失败，整批知识未采用", e))?;
        save_receipt(
            &transaction,
            &operation_id,
            &payload_hash,
            &batch.fingerprint,
            &record,
        )?;
        transaction
            .commit()
            .map_err(|e| disk_error("整批采用未确认提交，请保留当前候选并重试", e))?;
        Ok(AiAdoptResult {
            snapshot: make_snapshot(&root, facts, next_revision),
            record,
            duplicate: false,
        })
    }
}

fn check_point_baseline(facts: &Facts, batch: &AiBatch, id: &str) -> Result<(), String> {
    let expected = batch
        .baseline_points
        .iter()
        .find(|p| p.id == id)
        .ok_or("引用的已有知识不属于本次候选上下文，请重新核对。")?;
    if facts.points.iter().find(|p| p.id == id) != Some(expected) {
        return Err("采用涉及的知识已修改或删除，请重新核对候选。".into());
    }
    Ok(())
}

fn check_resource_baseline(facts: &Facts, batch: &AiBatch, id: &str) -> Result<(), String> {
    let expected = batch
        .baseline_resources
        .iter()
        .find(|r| r.id == id)
        .ok_or("引用的资料不属于本次候选上下文，请重新选择。")?;
    let current = facts
        .resources
        .iter()
        .find(|r| r.id == id)
        .ok_or("采用涉及的资料已移除，请重新选择。")?;
    // Availability is computed from the managed file on every snapshot; it is
    // not an authored metadata change and is never part of a knowledge identity.
    let mut expected = expected.clone();
    let mut current = current.clone();
    expected.status = None;
    current.status = None;
    if current != expected {
        return Err("采用涉及的资料信息已改变，请重新核对候选。".into());
    }
    Ok(())
}

fn decode_record(json: &str) -> Result<AiRecord, String> {
    serde_json::from_str(json).map_err(|e| disk_error("导入记录内容无法读取，未替换原有记录", e))
}

fn read_record(connection: &Connection, id: &str) -> Result<Option<AiRecord>, String> {
    connection
        .query_row(
            "SELECT record_json FROM ai_import_records WHERE id=?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| disk_error("无法读取原导入记录", e))?
        .map(|json| decode_record(&json))
        .transpose()
}

fn save_receipt(
    connection: &Connection,
    operation_id: &str,
    payload_hash: &str,
    fingerprint: &str,
    record: &AiRecord,
) -> Result<(), String> {
    let json = serde_json::to_string(record).map_err(|e| disk_error("无法整理采用回执", e))?;
    connection.execute("INSERT INTO ai_adoption_receipts(operation_id,payload_hash,fingerprint,record_json) VALUES(?1,?2,?3,?4)", params![operation_id, payload_hash, fingerprint, json])
        .map_err(|e| disk_error("采用回执保存失败，整批知识未采用", e))?;
    Ok(())
}
