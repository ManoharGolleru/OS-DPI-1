/**
 * Pluggable AI services.
 *
 * Everything in OS-DPI that talks to an AI (live speech suggestions, board
 * generation, AI word prediction) goes through aiComplete()/aiJSON() here
 * instead of calling one vendor directly. Which service is used is a
 * device setting chosen in the designer's AI panel; API keys stay in this
 * browser's localStorage and are never saved inside a board file.
 *
 * To plug in another service, call registerAIProvider() with an object
 * shaped like the built-in ones below.
 */

/**
 * @typedef {Object} AIRequest
 * @property {string} prompt - the full user prompt
 * @property {boolean} [json] - the reply must be a single JSON object
 * @property {"low" | "medium" | "high"} [effort] - how hard reasoning
 *   models should think; "low" keeps interactive features fast
 * @property {number} [maxTokens]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} AIConfig
 * @property {string} model
 * @property {string} baseUrl
 * @property {string} key
 */

/**
 * @typedef {Object} AIProvider
 * @property {string} id
 * @property {string} name - shown in the service picker
 * @property {string} description - one line shown under the picker
 * @property {string} defaultModel
 * @property {string} [defaultBaseUrl] - shown (and editable) when set
 * @property {"required" | "optional" | "none"} key
 * @property {string} [keyUrl] - where to get a key
 * @property {string} [keyPlaceholder]
 * @property {(config: AIConfig, request: AIRequest) => Promise<string>} complete
 */

/** Error with a kind the UI can turn into a helpful message */
export class AIError extends Error {
  /**
   * @param {"no-key" | "auth" | "rate-limit" | "network" | "refused" | "bad-response" | "http"} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** @type {Map<string, AIProvider>} */
const providers = new Map();

/** Add (or replace) an AI service
 * @param {AIProvider} provider
 */
export function registerAIProvider(provider) {
  providers.set(provider.id, provider);
}

/** @returns {AIProvider[]} */
export function aiProviders() {
  return [...providers.values()];
}

// ── settings (device-local) ─────────────────────────────────────────────

const SETTINGS_KEY = "os-dpi-ai-settings";
/** Groq keys were saved here before other services existed; keep reading
 * it so nobody has to paste their key again */
const LEGACY_GROQ_KEY = "os-dpi-groq-key";

/** @returns {{provider?: string, models?: Object<string,string>, baseUrls?: Object<string,string>}} */
function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/** @param {ReturnType<typeof readSettings>} settings */
function writeSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** @param {string} id */
function keyStorageName(id) {
  return id === "groq" ? LEGACY_GROQ_KEY : `os-dpi-ai-key:${id}`;
}

/** The selected service (Groq unless the user picked another) */
export function aiProvider() {
  const id = readSettings().provider || "groq";
  return providers.get(id) || /** @type {AIProvider} */ (providers.get("groq"));
}

/** @param {string} id */
export function setAIProvider(id) {
  if (!providers.has(id)) return;
  writeSettings({ ...readSettings(), provider: id });
}

/** @param {string} [id] defaults to the selected service */
export function getAIKey(id = aiProvider().id) {
  const stored = (localStorage.getItem(keyStorageName(id)) || "").trim();
  if (stored) return stored;
  if (id === "groq") {
    // dev-only fallback; never set this for production builds — anything
    // in the bundle is public
    const env = (import.meta.env.VITE_GROQ_API_KEY || "").trim();
    if (env && env !== "your_groq_api_key_here") return env;
  }
  return "";
}

/** Save (or clear, with "") the key for a service
 * @param {string} key
 * @param {string} [id]
 */
export function setAIKey(key, id = aiProvider().id) {
  key = key.trim();
  if (key) localStorage.setItem(keyStorageName(id), key);
  else localStorage.removeItem(keyStorageName(id));
}

/** @param {string} [id] */
export function getAIModel(id = aiProvider().id) {
  return (
    readSettings().models?.[id] || providers.get(id)?.defaultModel || ""
  );
}

/** @param {string} model @param {string} [id] */
export function setAIModel(model, id = aiProvider().id) {
  const settings = readSettings();
  settings.models = { ...settings.models, [id]: model.trim() };
  if (!model.trim()) delete settings.models[id];
  writeSettings(settings);
}

/** @param {string} [id] */
export function getAIBaseUrl(id = aiProvider().id) {
  return (
    readSettings().baseUrls?.[id] || providers.get(id)?.defaultBaseUrl || ""
  );
}

/** @param {string} url @param {string} [id] */
export function setAIBaseUrl(url, id = aiProvider().id) {
  const settings = readSettings();
  settings.baseUrls = { ...settings.baseUrls, [id]: url.trim() };
  if (!url.trim()) delete settings.baseUrls[id];
  writeSettings(settings);
}

/** True when the selected service has everything it needs to run */
export function aiReady() {
  const provider = aiProvider();
  return provider.key !== "required" || !!getAIKey(provider.id);
}

/** Short phrase for notices: "a free Groq API key", "an Anthropic API key"… */
export function aiKeyPhrase() {
  const provider = aiProvider();
  return provider.id === "groq"
    ? "a free Groq API key"
    : `an API key for ${provider.name}`;
}

// ── calling the AI ──────────────────────────────────────────────────────

/** Send a prompt to the selected service and return its text reply
 * @param {AIRequest} request
 * @returns {Promise<string>}
 */
export async function aiComplete(request) {
  const provider = aiProvider();
  const config = {
    model: getAIModel(provider.id),
    baseUrl: getAIBaseUrl(provider.id).replace(/\/+$/, ""),
    key: getAIKey(provider.id),
  };
  if (provider.key === "required" && !config.key) {
    throw new AIError("no-key", `${provider.name} needs an API key.`);
  }
  return provider.complete(config, request);
}

/** Like aiComplete, but parse the reply as a JSON object. Tolerates code
 * fences or chatter around the object, which some models add.
 * @param {AIRequest} request
 * @returns {Promise<any>}
 */
export async function aiJSON(request) {
  const text = await aiComplete({ ...request, json: true });
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new AIError("bad-response", "The AI reply was not valid JSON.");
  }
}

// ── built-in services ───────────────────────────────────────────────────

/** Any service speaking the OpenAI chat-completions protocol: Groq, OpenAI,
 * Ollama, LM Studio, OpenRouter, …
 * @param {AIConfig} config
 * @param {AIRequest} request
 * @param {{maxTokensField?: string}} [options]
 */
async function openAICompatible(config, request, options = {}) {
  /** @type {Object<string, any>} */
  const body = {
    model: config.model,
    messages: [{ role: "user", content: request.prompt }],
  };
  if (request.json) body.response_format = { type: "json_object" };
  // Reasoning models think before answering; without a low effort they can
  // spend the whole token budget thinking and return nothing. Other models
  // reject the parameter, so only send it to the families that take it.
  if (request.effort && /gpt-oss|^gpt-5|^o\d/.test(config.model)) {
    body.reasoning_effort = request.effort;
  }
  if (request.maxTokens) {
    body[options.maxTokensField || "max_tokens"] = request.maxTokens;
  }

  /** @type {Object<string,string>} */
  const headers = { "Content-Type": "application/json" };
  if (config.key) headers.Authorization = `Bearer ${config.key}`;

  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    throw new AIError(
      "network",
      `Couldn't reach ${config.baseUrl}. Check the address and your connection.`,
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AIError("auth", "The API key was rejected.");
    }
    if (response.status === 429) {
      throw new AIError("rate-limit", "Rate limit reached.");
    }
    const err = await response.json().catch(() => ({}));
    throw new AIError(
      "http",
      err.error?.message || `AI service error ${response.status}`,
    );
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new AIError("bad-response", "Empty reply from the AI.");
  return text;
}

registerAIProvider({
  id: "groq",
  name: "Groq",
  description: "Free key, fast cloud models. The default.",
  defaultModel: "openai/gpt-oss-120b",
  defaultBaseUrl: "https://api.groq.com/openai/v1",
  key: "required",
  keyUrl: "https://console.groq.com/keys",
  keyPlaceholder: "gsk_…",
  complete: (config, request) => openAICompatible(config, request),
});

registerAIProvider({
  id: "openai",
  name: "OpenAI",
  description: "Paid key from platform.openai.com.",
  defaultModel: "gpt-5-mini",
  defaultBaseUrl: "https://api.openai.com/v1",
  key: "required",
  keyUrl: "https://platform.openai.com/api-keys",
  keyPlaceholder: "sk-…",
  complete: (config, request) =>
    openAICompatible(config, request, {
      maxTokensField: "max_completion_tokens",
    }),
});

registerAIProvider({
  id: "anthropic",
  name: "Anthropic (Claude)",
  description: "Paid key from console.anthropic.com.",
  defaultModel: "claude-opus-5",
  key: "required",
  keyUrl: "https://console.anthropic.com/settings/keys",
  keyPlaceholder: "sk-ant-…",
  complete: anthropicComplete,
});

registerAIProvider({
  id: "ollama",
  name: "Ollama (on this computer)",
  description:
    "Runs a model locally — private and works offline. Install Ollama and pull a model first.",
  defaultModel: "llama3.2",
  defaultBaseUrl: "http://localhost:11434/v1",
  key: "none",
  complete: (config, request) => openAICompatible(config, request),
});

registerAIProvider({
  id: "custom",
  name: "Other (OpenAI-compatible)",
  description:
    "Any service with an OpenAI-style /chat/completions endpoint, e.g. LM Studio or OpenRouter.",
  defaultModel: "",
  defaultBaseUrl: "http://localhost:1234/v1",
  key: "optional",
  complete: (config, request) => openAICompatible(config, request),
});

/** Claude, through the official SDK (loaded only when this service is used)
 * @param {AIConfig} config
 * @param {AIRequest} request
 * @returns {Promise<string>}
 */
async function anthropicComplete(config, request) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // The key is the user's own and stays on their device; there is no
  // server here to proxy through.
  const client = new Anthropic({
    apiKey: config.key,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });
  const content = request.json
    ? `${request.prompt}\n\nRespond with only the JSON object, no other text.`
    : request.prompt;
  /** @type {any} */
  const params = {
    model: config.model,
    max_tokens: 16000,
    messages: [{ role: "user", content }],
  };
  // Haiku 4.5 rejects the effort setting
  if (request.effort && !/haiku/.test(config.model)) {
    params.output_config = { effort: request.effort };
  }

  let message;
  try {
    if (/^claude-(opus-5$|fable-5)/.test(config.model)) {
      // let the API retry a declined request on another model rather than
      // leave the AAC user with nothing
      message = await client.beta.messages.create(
        {
          ...params,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: request.signal },
      );
    } else {
      message = await client.messages.create(params, {
        signal: request.signal,
      });
    }
  } catch (error) {
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      throw new AIError("auth", "The API key was rejected.");
    } else if (error instanceof Anthropic.RateLimitError) {
      throw new AIError("rate-limit", "Rate limit reached.");
    } else if (error instanceof Anthropic.APIConnectionError) {
      if (request.signal?.aborted) throw error;
      throw new AIError("network", "Couldn't reach Anthropic.");
    } else if (error instanceof Anthropic.APIError) {
      throw new AIError("http", error.message);
    }
    throw error;
  }
  if (message.stop_reason === "refusal") {
    throw new AIError("refused", "The AI declined this request.");
  }
  const text = message.content
    .filter((/** @type {any} */ block) => block.type === "text")
    .map((/** @type {any} */ block) => block.text)
    .join("");
  if (!text) throw new AIError("bad-response", "Empty reply from the AI.");
  return text;
}
