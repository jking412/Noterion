// Pure scheduling and report checks. No GitHub, Git, filesystem, or Agent calls.

const stoppedStatuses = new Set([
  "blocked", "failed", "pending-close", "completed", "merged", "done", "stopped",
]);

const numberSet = (values) => new Set(Array.from(values ?? [], Number));
const outcomeFor = (outcomes, number) => outcomes instanceof Map
  ? outcomes.get(number) ?? outcomes.get(String(number))
  : outcomes?.[number];
const labelsFor = (issue) => new Set((issue.labels ?? []).map((label) =>
  String(typeof label === "string" ? label : label?.name ?? "").toLowerCase()));

/**
 * Select open, dependency-cleared issues from the fixed startup batch.
 * `issues` must include known dependency states, even for issues outside the batch.
 * Missing dependency metadata or unavailable dependency issues never unlock work.
 */
export function selectReady(issues, batchNumbers, outcomes = {}, activeNumbers = [], maxParallel = 2) {
  if (!Array.isArray(issues)) throw new Error("issues must be an array");
  if (!Number.isInteger(maxParallel) || maxParallel < 1) {
    throw new Error("maxParallel must be a positive integer");
  }
  const batch = numberSet(batchNumbers);
  const active = numberSet(activeNumbers);
  const byNumber = new Map();
  for (const issue of issues) {
    if (!Number.isInteger(issue?.number) || issue.number < 1) {
      throw new Error("Every issue needs a positive integer number");
    }
    if (byNumber.has(issue.number)) throw new Error(`Duplicate issue #${issue.number}`);
    byNumber.set(issue.number, issue);
  }

  const ready = [];
  const human = [];
  const waiting = [];
  let slots = Math.max(0, maxParallel - active.size);

  for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
    if (!batch.has(issue.number) || String(issue.state).toLowerCase() !== "open") continue;
    const labels = labelsFor(issue);
    // Human questions cannot be turned into executable Agent work by another label.
    if (labels.has("ready-for-human")) {
      human.push(issue);
      continue;
    }
    if (active.has(issue.number)) continue;

    const outcome = outcomeFor(outcomes, issue.number);
    const status = typeof outcome === "string" ? outcome : outcome?.status;
    if (stoppedStatuses.has(status)) {
      waiting.push({ issue, reason: `Previous result: ${status}`, blockedBy: [] });
      continue;
    }
    if (!labels.has("ready-for-agent")) {
      waiting.push({ issue, reason: "Not labelled ready-for-agent", blockedBy: [] });
      continue;
    }
    if (!Array.isArray(issue.dependencies) || issue.dependencies.some((number) =>
      !Number.isInteger(number) || number < 1)) {
      waiting.push({ issue, reason: "Dependencies have not been verified", blockedBy: [] });
      continue;
    }
    const blockedBy = [...new Set(issue.dependencies)].filter((number) =>
      String(byNumber.get(number)?.state).toLowerCase() !== "closed");
    if (blockedBy.length > 0) {
      waiting.push({ issue, reason: "Dependencies are open or unavailable", blockedBy });
      continue;
    }
    if (slots === 0) {
      waiting.push({ issue, reason: "Waiting for an available execution slot", blockedBy: [] });
      continue;
    }
    ready.push(issue);
    slots--;
  }
  return { ready, human, waiting };
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;

function requireReport(value, statuses, name) {
  if (!isObject(value)) throw new Error(`${name} report must be an object`);
  if (!statuses.includes(value.status)) throw new Error(`${name} status is invalid`);
  if (!hasText(value.summary)) throw new Error(`${name} needs a nonempty summary or blocking reason`);
  if (!Array.isArray(value.checks) || value.checks.some((check) =>
    !isObject(check) || !hasText(check.command))) {
    throw new Error(`${name} checks must be an array of objects with nonempty command strings`);
  }
  if (value.status === "blocked" && value.reason !== undefined && !hasText(value.reason)) {
    throw new Error(`${name} blocking reason must be nonempty when supplied`);
  }
}

/** Checks declare commands; the caller must execute them and check real exit codes. */
export function validateImplementation(value) {
  requireReport(value, ["ready", "blocked"], "Implementation");
  return value;
}

/** An approval is valid only when every listed acceptance criterion has evidence. */
export function validateReview(value) {
  requireReport(value, ["approved", "changes", "blocked"], "Review");
  if (!Array.isArray(value.acceptance) || value.acceptance.some((item) =>
    !isObject(item) || !hasText(item.criterion) || typeof item.passed !== "boolean"
    || typeof item.evidence !== "string")) {
    throw new Error("Review acceptance must list criterion, evidence, and a boolean passed value");
  }
  if (value.status === "approved" && (value.acceptance.length === 0 || value.acceptance.some((item) =>
    !item.passed || !hasText(item.evidence)))) {
    throw new Error("Review approval requires nonempty evidence for every passing acceptance criterion");
  }
  return value;
}

/** Parse the final complete tagged report, never a completion slogan or older approval. */
export function parseReport(stdout, tag) {
  if (typeof stdout !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(tag)) {
    throw new Error("Expected text output and a simple report tag");
  }
  const pattern = new RegExp(`<${tag}\\s*>([\\s\\S]*?)<\\/${tag}\\s*>`, "g");
  let payload;
  let completeIndex = -1;
  for (const match of stdout.matchAll(pattern)) {
    payload = match[1].trim();
    completeIndex = match.index;
  }
  if (payload === undefined) throw new Error(`Missing <${tag}> report`);
  const opening = new RegExp(`<${tag}\\s*>`, "g");
  for (const match of stdout.matchAll(opening)) {
    if (match.index > completeIndex) throw new Error(`Incomplete final <${tag}> report`);
  }
  const fenced = payload.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced) payload = fenced[1].trim();
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`Invalid JSON in the final <${tag}> report`);
  }
}
