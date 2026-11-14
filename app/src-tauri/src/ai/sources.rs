//! Keep model source repair local to evidence; the candidate proposals stay intact.
use super::{Output, Quote};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

pub(super) const MAX_QUOTES: usize = 64;

struct Passage<'a> {
    id: String,
    text: &'a str,
    start: usize,
    end: usize,
}

fn passages(chunk: &str) -> Vec<Passage<'_>> {
    let mut result = vec![];
    let mut start = 0;
    while start < chunk.len() {
        let mut end = (start + 1200).min(chunk.len());
        while !chunk.is_char_boundary(end) {
            end -= 1;
        }
        if end < chunk.len() {
            if let Some(newline) = chunk[start..end].rfind('\n').filter(|index| *index >= 600) {
                end = start + newline + 1;
            }
        }
        let text = &chunk[start..end];
        if !text.trim().is_empty() {
            result.push(Passage {
                id: format!("s{}", result.len() + 1),
                text,
                start,
                end,
            });
        }
        start = end;
    }
    result
}

pub(super) fn source_passages(chunk: &str) -> Vec<Value> {
    passages(chunk)
        .into_iter()
        .map(|passage| json!({"id":passage.id,"text":passage.text}))
        .collect()
}

pub(super) fn locate_quote(chunk: &str, quote: &Quote) -> Result<(usize, usize), String> {
    if let Some(id) = &quote.source_id {
        let passage = passages(chunk)
            .into_iter()
            .find(|passage| &passage.id == id)
            .ok_or("unknown_source_id")?;
        if quote.quote != passage.text {
            return Err("source_id_text_mismatch".into());
        }
        return Ok((passage.start, passage.end));
    }
    locate(chunk, &quote.quote)
}

/// Only whitespace differences can be resolved without asking the model again.
/// Return byte positions in the unchanged source, never positions in normalized text.
pub(super) fn locate(chunk: &str, quote: &str) -> Result<(usize, usize), String> {
    if quote.trim().is_empty() {
        return Err("empty".into());
    }
    if quote.len() > 6000 {
        return Err("too_long".into());
    }
    if let Some(start) = chunk.find(quote) {
        return Ok((start, start + quote.len()));
    }
    let (text, spans) = normalize(chunk);
    let (quote, _) = normalize(quote.trim());
    let start = text.find(&quote).ok_or("not_in_chunk")?;
    let after_first_character = start + text[start..].chars().next().unwrap().len_utf8();
    if text[after_first_character..].contains(&quote) {
        return Err("ambiguous_whitespace_match".into());
    }
    let first = text[..start].chars().count();
    let count = quote.chars().count();
    let (start, end) = (spans[first].0, spans[first + count - 1].1);
    if end - start > 6000 {
        return Err("too_long".into());
    }
    Ok((start, end))
}

fn normalize(text: &str) -> (String, Vec<(usize, usize)>) {
    let mut normalized = String::new();
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut whitespace = false;
    for (start, character) in text.char_indices() {
        let end = start + character.len_utf8();
        if character.is_whitespace() {
            if whitespace {
                spans.last_mut().unwrap().1 = end;
            } else {
                normalized.push(' ');
                spans.push((start, end));
            }
            whitespace = true;
        } else {
            normalized.push(character);
            spans.push((start, end));
            whitespace = false;
        }
    }
    (normalized, spans)
}

fn source_issues(evidence: &[Quote], chunk: &str) -> Vec<String> {
    if evidence.is_empty() {
        return vec!["missing".into()];
    }
    if evidence.len() > MAX_QUOTES {
        return vec!["too_many".into()];
    }
    let mut issues = vec![];
    for quote in evidence {
        if let Err(issue) = locate_quote(chunk, quote) {
            if !issues.contains(&issue) {
                issues.push(issue);
            }
        }
    }
    issues
}

fn output(content: &str) -> Result<Output, String> {
    let output: Output =
        serde_json::from_str(content).map_err(|_| "AI 输出不是约定的完整 Point JSON 结构。")?;
    if output.points.len() > 80 || output.warnings.len() > 20 {
        return Err("AI 返回的候选数量超出本段上限。".into());
    }
    let mut ids = HashSet::new();
    for candidate in &output.points {
        candidate.point.check()?;
        let id = &candidate.point.id;
        if !id.starts_with('n') || !id.chars().all(|c| c.is_ascii_alphanumeric()) || !ids.insert(id)
        {
            return Err("AI 返回重复或非法的候选身份。".into());
        }
    }
    Ok(output)
}

pub(super) fn source_plan(content: &str, chunk: &str) -> Result<Option<Value>, String> {
    let output = output(content)?;
    let candidates: Vec<_> = output
        .points
        .iter()
        .filter_map(|candidate| {
            let reasons = source_issues(&candidate.evidence, chunk);
            if reasons.is_empty() {
                None
            } else {
                Some(json!({
                    "id": candidate.point.id,
                    "name": candidate.point.name,
                    "description": candidate.point.description,
                    "reasons": reasons
                }))
            }
        })
        .collect();
    Ok((!candidates.is_empty()).then(|| json!({"candidates":candidates})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Repairs {
    repairs: Vec<Repair>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Repair {
    id: String,
    #[serde(default)]
    evidence: Option<Vec<Quote>>,
    #[serde(default, rename = "sourceIds")]
    source_ids: Option<Vec<String>>,
}

pub(super) fn apply_source_repairs(
    content: &str,
    repair_response: &str,
    chunk: &str,
) -> Result<String, String> {
    let output = output(content)?;
    let expected: HashSet<_> = output
        .points
        .iter()
        .filter(|candidate| !source_issues(&candidate.evidence, chunk).is_empty())
        .map(|candidate| candidate.point.id.as_str())
        .collect();
    let repairs: Repairs =
        serde_json::from_str(repair_response).map_err(|_| "AI 来源修正结构不完整。")?;
    if repairs.repairs.len() != expected.len() || expected.is_empty() {
        return Err("AI 来源修正没有完整覆盖待处理候选。".into());
    }
    let mut document: Value =
        serde_json::from_str(content).map_err(|_| "AI 来源修正前的候选不可读取。")?;
    let mut seen = HashSet::new();
    for repair in repairs.repairs {
        if !expected.contains(repair.id.as_str()) || !seen.insert(repair.id.clone()) {
            return Err("AI 来源修正引用了重复或未获准的候选。".into());
        }
        let evidence = match (repair.evidence, repair.source_ids) {
            (Some(evidence), None) => evidence,
            (None, Some(ids)) if !ids.is_empty() && ids.len() <= MAX_QUOTES => {
                let catalog = passages(chunk);
                let mut sources = HashSet::new();
                let mut evidence = vec![];
                for id in ids {
                    if !sources.insert(id.clone()) {
                        return Err("AI 来源修正引用了重复的原文片段。".into());
                    }
                    let passage = catalog
                        .iter()
                        .find(|passage| passage.id == id)
                        .ok_or("AI 来源修正引用了不存在的原文片段。")?;
                    evidence.push(Quote {
                        quote: passage.text.to_owned(),
                        inferred: true,
                        source_id: Some(id),
                    });
                }
                evidence
            }
            _ => return Err("AI 来源修正应提供一种完整的原文引用。".into()),
        };
        if !source_issues(&evidence, chunk).is_empty() {
            return Err("AI 来源修正仍未提供可定位的原文。".into());
        }
        let candidate = document["points"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|candidate| candidate["point"]["id"].as_str() == Some(&repair.id))
            .unwrap();
        candidate["evidence"] = Value::Array(
            evidence
                .into_iter()
                .map(|quote| {
                    let mut value = json!({"quote":quote.quote,"inferred":quote.inferred});
                    if let Some(id) = quote.source_id {
                        value["sourceId"] = json!(id);
                    }
                    value
                })
                .collect(),
        );
    }
    Ok(document.to_string())
}
