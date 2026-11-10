import {AIError, getAIKey} from "./index";
import {AUTHORING_RESPONSE_FORMAT,toWireMessages,decodeAuthoringResponse} from "./authoring-protocol";
import {diagnosticFingerprint} from "./authoring-diagnostics";
const rates=new Map();
const recentUsage=new Map();
let rateKey="";
export const lastAuthoringRate=model=>rates.get(model) || null;

/** One strict structured Groq command. Other AI features keep their existing request path. */
export async function aiToolTurn({model, messages, signal, maxTokens = 3000, temperature=1, reasoningEffort="medium", onDiagnostic=()=>{}}) {
  const started=performance.now();
  const key = getAIKey("groq");
  if(key!==rateKey){rates.clear();recentUsage.clear();rateKey=key;}
  if (!key) throw new AIError("no-key", "Add your Groq key under Content > Keys.");
  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal,
      headers: {"Content-Type":"application/json", Authorization:`Bearer ${key}`},
      body: JSON.stringify({model,messages:toWireMessages(messages),response_format:AUTHORING_RESPONSE_FORMAT,
        reasoning_effort:reasoningEffort,temperature,max_completion_tokens:maxTokens,
        ...(model.startsWith("qwen/") ? {reasoning_format:"hidden"} : {})}),
    });
  } catch(error) {
    onDiagnostic({stage:"provider",code:signal?.aborted?"cancelled":"network",elapsedMs:Math.round(performance.now()-started)});
    if(signal?.aborted) throw error;
    throw new AIError("network", "Could not reach Groq. Your board is unchanged.");
  }
  const data = await response.json().catch(() => ({}));
  const choice = data.choices?.[0];
  const rate = {
    limit:Number(response.headers.get("x-ratelimit-limit-tokens") ?? NaN),
    remaining: Number(response.headers.get("x-ratelimit-remaining-tokens") ?? NaN),
    reset: response.headers.get("x-ratelimit-reset-tokens") || "",
    requestsRemaining:Number(response.headers.get("x-ratelimit-remaining-requests") ?? NaN),
    requestsReset:response.headers.get("x-ratelimit-reset-requests") || "",
    receivedAt:Date.now(),
  };
  // Groq's CORS response may hide quota headers. In that case pace against
  // its documented 8K TPM free tier using measured, non-cached usage.
  if(response.ok && !Number.isFinite(rate.remaining) && data.usage) {
    const now=Date.now(),usage=data.usage;
    const charges=(recentUsage.get(model)||[]).filter(entry=>now-entry.at<60000);
    charges.push({at:now,tokens:Math.max(0,(usage.prompt_tokens||0)-(usage.prompt_tokens_details?.cached_tokens||0))+(usage.completion_tokens||0)});
    recentUsage.set(model,charges);
    Object.assign(rate,{limit:8000,remaining:Math.max(0,8000-charges.reduce((sum,entry)=>sum+entry.tokens,0)),reset:"60s",source:"free-tier-local"});
  } else rate.source="provider";
  rates.set(model,rate);
  const kind = response.status === 401 || response.status === 403 ? "auth"
    : response.status === 413 ? "request-size"
    : response.status === 429 ? /tokens per day|requests per day|\bTPD\b|\bRPD\b/i.test(data.error?.message||"")||rate.requestsRemaining===0?"daily-limit":"rate-limit"
    : data.error?.code==="json_validate_failed" ? "bad-response" : ["tool_use_failed","tool_use_required"].includes(data.error?.code) ? "tool-call" : "http";
  const failed=typeof data.error?.failed_generation==="string"?data.error.failed_generation:"";
  const providerCode=["tool_use_failed","tool_use_required","json_validate_failed"].includes(data.error?.code)?data.error.code:"other";
  onDiagnostic({stage:"provider",status:response.status,code:response.ok?"ok":kind,providerCode:response.ok?undefined:providerCode,
    finishReason:["stop","tool_calls","length","content_filter"].includes(choice?.finish_reason)?choice.finish_reason:"unknown",
    promptTokens:data.usage?.prompt_tokens || 0,completionTokens:data.usage?.completion_tokens || 0,
    cachedTokens:data.usage?.prompt_tokens_details?.cached_tokens || 0,
    reasoningTokens:data.usage?.completion_tokens_details?.reasoning_tokens || 0,elapsedMs:Math.round(performance.now()-started),
    tokenLimit:Number.isFinite(rate.limit)?rate.limit:null,tokensRemaining:Number.isFinite(rate.remaining)?rate.remaining:null,
    requestsRemaining:Number.isFinite(rate.requestsRemaining)?rate.requestsRemaining:null,
    maxTokens,reasoningEffort,temperature,quotaSource:rate.source,
    details:{protocol:"strict-json",responseSchemaFingerprint:diagnosticFingerprint(JSON.stringify(AUTHORING_RESPONSE_FORMAT)),...(response.ok?{command:choice?.message?.content}: {providerError:{
      type:data.error?.type,code:data.error?.code,param:data.error?.param,message:data.error?.message,
      ...(failed?{failedGeneration:{originalLength:failed.length,truncated:failed.length>2800,head:failed.slice(0,1400),tail:failed.length>1400?failed.slice(-1400):""}}:{}),
    }})}});
  if(!response.ok) {
    const error = new AIError(kind, data.error?.message || `Groq returned HTTP ${response.status}.`);
    error.retryAfter = response.headers.get("retry-after");
    error.rate = rate;error.usage=data.usage || {};
    // Strict output can still fail provider validation. Decode only for a
    // precise correction; NEVER execute or recover rejected generations.
    if(kind==="bad-response"&&failed)try{decodeAuthoringResponse(failed);}catch(problem){error.repairHint=problem.message.slice(0,400);}
    throw error;
  }
  const invalidResponse=message=>Object.assign(new AIError("bad-response",message),{usage:data.usage||{},rate});
  if(choice?.finish_reason === "length")throw invalidResponse("Groq stopped before completing its command. No partial edits were applied.");
  if(!choice?.message)throw invalidResponse("Groq returned no message.");
  // Do not store hidden reasoning or authorization headers in the editor history.
  let message;
  try { message=decodeAuthoringResponse(choice.message.content); }
  catch(error){throw invalidResponse("Invalid structured authoring command: "+error.message);}
  return {message,usage:data.usage || {},rate};
}
