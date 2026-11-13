import { spawn } from "node:child_process";

export function acceptance(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex(line => /^##\s+Acceptance criteria\s*$/i.test(line));
  if (start < 0) return [];
  let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).filter(line => /^\s*[-*]\s+\[[ xX]\]\s+/.test(line)).map((text, index) => ({ id: `A${index + 1}`, text: text.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, "") }));
}

export function inheritModel(base, inherit) {
  if (!inherit) return base;
  return {
    ...base,
    buildPrintCommand(options) {
      const result = base.buildPrintCommand(options);
      const expression = / -m (?:'noterion-inherit-local-model'|"noterion-inherit-local-model"|noterion-inherit-local-model)(?= |$)/;
      if (!expression.test(result.command)) throw new Error("Codex 模型参数结构已变化，不能沿用本机模型配置。");
      return { ...result, command: result.command.replace(expression, "") };
    },
  };
}

export function resumeDecision(outcome, issue, { sameRequirements, mergedInHead = false, blockersClosed = false, freshDiscussion = false, autoClose = true }) {
  if (issue.state === "closed") return "completed";
  if (outcome.mergeCommit) {
    if (!sameRequirements || !mergedInHead || !blockersClosed || !issue.labels.includes("ready-for-agent") || issue.labels.includes("ready-for-human")) return "hold";
    return autoClose ? "publish-and-close" : "pending-close";
  }
  if (outcome.needsUser && sameRequirements && !freshDiscussion) return "hold";
  return "retry";
}

export function powershell(command, cwd, signal, timeoutMs) {
  return new Promise(resolveResult => {
    const wrapped = `$ErrorActionPreference = 'Stop'\n${command}\n$noterionCommandSucceeded = $?\n$noterionNativeExit = $LASTEXITCODE\nif ($null -ne $noterionNativeExit -and $noterionNativeExit -ne 0) { exit $noterionNativeExit }\nif (-not $noterionCommandSucceeded) { exit 1 }`;
    const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let forced = false;
    const append = chunk => { output = (output + chunk.toString()).slice(-200_000); };
    child.stdout.on("data", append); child.stderr.on("data", append);
    const stop = () => {
      forced = true;
      if (child.pid) spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
    };
    const timer = setTimeout(stop, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.on("error", error => { output += error.message; });
    child.on("close", code => { clearTimeout(timer); signal.removeEventListener("abort", stop); resolveResult({ exitCode: forced ? 124 : code ?? 1, output }); });
  });
}
