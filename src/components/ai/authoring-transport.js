import {AIError, getAIKey} from "./index";

/** One Groq local-tool turn. Other AI features keep their existing request path. */
export async function aiToolTurn({model, messages, tools, signal, maxTokens = 2200, toolChoice="required"}) {
  const key = getAIKey("groq");
  if (!key) throw new AIError("no-key", "Add your Groq key under Content > Keys.");
  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal,
      headers: {"Content-Type":"application/json", Authorization:`Bearer ${key}`},
      body: JSON.stringify({model,messages,tools,tool_choice:toolChoice,parallel_tool_calls:false,
        reasoning_effort:"medium",max_completion_tokens:maxTokens,
        ...(model.startsWith("qwen/") ? {reasoning_format:"hidden"} : {})}),
    });
  } catch(error) {
    if(signal?.aborted) throw error;
    throw new AIError("network", "Could not reach Groq. Your board is unchanged.");
  }
  const data = await response.json().catch(() => ({}));
  const rate = {
    remaining: Number(response.headers.get("x-ratelimit-remaining-tokens") ?? NaN),
    reset: response.headers.get("x-ratelimit-reset-tokens") || "",
  };
  if(!response.ok) {
    const kind = response.status === 401 || response.status === 403 ? "auth"
      : response.status === 429 ? "rate-limit" : data.error?.code === "tool_use_failed" ? "tool-call" : "http";
    const error = new AIError(kind, data.error?.message || `Groq returned HTTP ${response.status}.`);
    error.retryAfter = response.headers.get("retry-after");
    error.rate = rate;
    throw error;
  }
  const choice = data.choices?.[0];
  if(choice?.finish_reason === "length")throw new AIError("bad-response", "Groq stopped before completing its edits. No partial tool arguments were applied.");
  if(!choice?.message)throw new AIError("bad-response", "Groq returned no message.");
  // Do not store hidden reasoning or authorization headers in the editor history.
  const {content,tool_calls} = choice.message;
  return {message:{role:"assistant",content:content || null,...(tool_calls?.length?{tool_calls}: {})},
    usage:data.usage || {}, rate};
}
