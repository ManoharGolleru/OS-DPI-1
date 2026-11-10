/** Opt-in, memory-only metadata. Never retain prompts, arguments, text, or keys. */
export function createDiagnostics({model, mode, selected, request = "",includeBoardText=false}) {
  const report = {
    version: 1,
    build: typeof APP_VERSION === "undefined" ? "development" : APP_VERSION,
    model, mode, selected: !!selected,
    intent: /\bqwerty\b/i.test(request) ? "keyboard" : mode === "new" ? "creation" : "edit",
    started: new Date().toISOString(), events: [], outcome: "running",includeBoardText,
  };
  // Explicit field allowlist: even an error message can contain private board text.
  const fields = new Set(["stage", "status", "code", "finishReason", "promptTokens", "completionTokens",
    "reasoningTokens", "elapsedMs", "round", "tool", "validArguments", "ok", "errors", "warnings",
    "sections", "resultBytes", "before", "after", "controls", "persisted", "rendered", "copied",
    "cachedTokens","tokenLimit","tokensRemaining","requestsRemaining","maxTokens","reasoningEffort","estimatedTokens","waitSeconds","quotaSource","providerCode","temperature"]);
  return {
    report,
    record(event) {
      if (report.events.length >= 160) return;
      const entry=Object.fromEntries(Object.entries(event).filter(([key]) => fields.has(key)));
      if(includeBoardText && event.details)entry.details=scrub(event.details);
      report.events.push(entry);
    },
    finish(outcome) { report.outcome = outcome; report.elapsedMs = Date.now() - Date.parse(report.started); },
  };
}

function scrub(value) {
  if(Array.isArray(value))return value.slice(0,40).map(scrub);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([key,v])=>[key,/api.?key|authorization|password|secret|access.?token/i.test(key)?'[redacted]':scrub(v)]));
  if(typeof value==='string')return value.replace(/\b(?:gsk_|sk_)[A-Za-z0-9_-]{12,}/g,'[redacted]').replace(/([?&](?:token|key|api_key)=)[^&#]*/gi,'$1[redacted]').slice(0,3000);
  return value;
}

/** Non-cryptographic identity for comparison, without including board contents. */
export function diagnosticFingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
