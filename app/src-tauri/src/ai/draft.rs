use crate::store::{AiBatch, Point};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub quote: String,
    pub start: usize,
    pub end: usize,
    pub inferred: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub point: Point,
    pub evidence: Vec<Evidence>,
    pub matches: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub points: Vec<Candidate>,
    pub source_name: String,
    pub source_resource_ids: Vec<String>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate_record_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_record_id: Option<String>,
}
pub struct StoredDraft {
    pub batch: AiBatch,
    pub preview: Draft,
}

impl StoredDraft {
    pub fn copy_batch(&self) -> AiBatch {
        let b = &self.batch;
        AiBatch {
            draft_id: b.draft_id.clone(),
            root: b.root.clone(),
            epoch: b.epoch,
            baseline_points: b.baseline_points.clone(),
            baseline_resources: b.baseline_resources.clone(),
            points: b.points.clone(),
            fingerprint: b.fingerprint.clone(),
            source_name: b.source_name.clone(),
            source_resource_ids: b.source_resource_ids.clone(),
            original_record_id: b.original_record_id.clone(),
        }
    }
}

// Model-facing Point requires all seven fields and rejects extra properties.
// This is a transport decoder, not another persisted knowledge model.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutputPoint {
    pub id: String,
    pub name: String,
    pub description: String,
    pub topic_ids: Vec<String>,
    pub resource_ids: Vec<String>,
    pub is_theme: bool,
    pub color: String,
}
impl OutputPoint {
    pub fn check(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.len() > 80
            || self.name.trim().is_empty()
            || self.name.len() > 400
            || self.description.len() > 24_000
            || self.topic_ids.len() > 32
            || self.resource_ids.len() > 32
            || !["docker", "linux", "mysql", "concurrency", "neutral"]
                .contains(&self.color.as_str())
        {
            return Err("AI 知识点字段、名称、长度或颜色不合法，请重新解析。".into());
        }
        Ok(())
    }
}
