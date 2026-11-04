import { html } from "uhtml";
import Globals from "app/globals";
import {
  aiProvider,
  aiProviders,
  setAIProvider,
  getAIKey,
  setAIKey,
  getAIModel,
  setAIModel,
  getAIBaseUrl,
  setAIBaseUrl,
  aiReady,
} from "./index";
import { elevenProblem, getElevenKey, setElevenKey } from "../elevenlabs";
import "css/aiSettings.css";

/** Whether the student opened or closed the panel; until they do, it
 * opens itself only when the service still needs setting up
 * @type {boolean | null} */
let panelOpen = null;

/** Transient "✓ Saved" confirmation, and which box it belongs to */
let notice = "";
/** @type {"ai" | "voices"} */
let noticeFor = "ai";
/** @type {number | null} */
let noticeTimer = null;

/** @param {string} text
 * @param {"ai" | "voices"} [where] */
function showNotice(text, where = "ai") {
  notice = text;
  noticeFor = where;
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice = "";
    noticeTimer = null;
    Globals.state.update();
    // a warning stays long enough to read
  }, text.startsWith("⚠") ? 10000 : 2500);
  Globals.state.update();
}

/** The "AI service" settings block: which service, its key, model and
 * address. Everything is saved on this device only. */
export function aiSettings() {
  const provider = aiProvider();
  const key = getAIKey(provider.id);
  return html`<details
    class="ai-key"
    ?open=${panelOpen ?? !aiReady()}
    @toggle=${(/** @type {Event} */ e) => {
      panelOpen = /** @type {HTMLDetailsElement} */ (e.target).open;
    }}
  >
    <summary>
      AI service: ${provider.name} ${aiReady() ? "✓" : "— needs a key"}
    </summary>
    <label class="ai-settings-row">
      <span>Service</span>
      <select
        @change=${(/** @type {Event} */ e) => {
          setAIProvider(/** @type {HTMLSelectElement} */ (e.target).value);
          Globals.state.update();
        }}
      >
        ${aiProviders().map(
          (p) =>
            html`<option value=${p.id} ?selected=${p.id === provider.id}>
              ${p.name}
            </option>`,
        )}
      </select>
    </label>
    <p class="ai-key-note">${provider.description}</p>

    ${provider.key !== "none"
      ? html`
          ${provider.keyUrl
            ? html`<ol class="ai-key-steps">
                <li>
                  Go to
                  <a href=${provider.keyUrl} target="_blank" rel="noreferrer"
                    >${provider.keyUrl.replace(/^https:\/\//, "")}</a
                  >
                  and sign up.
                </li>
                <li>Create an API key, then copy it.</li>
                <li>Paste it into the field below.</li>
              </ol>`
            : html``}
          <label class="ai-settings-row">
            <span>API key${provider.key === "optional" ? " (if needed)" : ""}</span>
            <input
              type="password"
              class="ai-input"
              placeholder=${provider.keyPlaceholder || ""}
              autocomplete="off"
              .value=${key}
              @change=${(/** @type {Event} */ e) => {
                const value = /** @type {HTMLInputElement} */ (e.target).value;
                setAIKey(value, provider.id);
                showNotice(value.trim() ? "✓ Key saved" : "Key removed");
              }}
            />
          </label>
          <div class="ai-key-actions">
            <button
              type="button"
              class="ai-key-remove-btn"
              ?disabled=${!key}
              @click=${() => {
                setAIKey("", provider.id);
                showNotice("Key removed");
              }}
            >
              Remove key
            </button>
          </div>
        `
      : html``}

    <label class="ai-settings-row">
      <span>Model</span>
      <input
        class="ai-input"
        placeholder=${provider.defaultModel || "model name"}
        .value=${getAIModel(provider.id)}
        @change=${(/** @type {Event} */ e) => {
          setAIModel(/** @type {HTMLInputElement} */ (e.target).value, provider.id);
          showNotice("✓ Model saved");
        }}
      />
    </label>
    ${provider.defaultBaseUrl
      ? html`<label class="ai-settings-row">
          <span>Address</span>
          <input
            class="ai-input"
            placeholder=${provider.defaultBaseUrl}
            .value=${getAIBaseUrl(provider.id)}
            @change=${(/** @type {Event} */ e) => {
              setAIBaseUrl(
                /** @type {HTMLInputElement} */ (e.target).value,
                provider.id,
              );
              showNotice("✓ Address saved");
            }}
          />
        </label>`
      : html``}
    ${provider.id === "ollama"
      ? html`<p class="ai-key-note">
          Using the online version of OS-DPI? Start Ollama with
          <code>OLLAMA_ORIGINS=*</code> so the web page is allowed to reach it.
        </p>`
      : html``}
    <p class="ai-key-note">
      These settings are stored only on this device and are never included
      when you save or share a design.
    </p>
    ${notice && noticeFor === "ai" ? html`<span class="ai-key-confirm">${notice}</span>` : html``}
  </details>`;
}

/** Whether the student opened or closed the voices panel
 * @type {boolean | null} */
let voicesOpen = null;

/** The ElevenLabs key, next to the AI service's: more natural voices,
 * and tones said with real feeling (elevenlabs.js). Saved on this device
 * only. */
export function voiceSettings() {
  const key = getElevenKey();
  return html`<details
    class="ai-key voice-key"
    ?open=${voicesOpen ?? false}
    @toggle=${(/** @type {Event} */ e) => {
      voicesOpen = /** @type {HTMLDetailsElement} */ (e.target).open;
    }}
  >
    <summary>Voices: ElevenLabs ${key ? "✓" : "— optional free key"}</summary>
    <p class="ai-key-note">
      Natural voices that sound the same in every browser, and tones (Angry,
      Sarcastic…) said with real feeling. Free for about 10,000 letters a
      month; words said before replay for free. Everything said on the board
      is sent to ElevenLabs to be spoken.
    </p>
    <ol class="ai-key-steps">
      <li>
        Go to
        <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer"
          >elevenlabs.io/app/settings/api-keys</a
        >
        and sign up.
      </li>
      <li>Create an API key with <strong>Text to Speech: Access</strong> (everything else can be No Access), then copy it.</li>
      <li>Paste it into the field below.</li>
      <li>In the Layout tab, pick a voice under “ElevenLabs” in the Voice menu.</li>
    </ol>
    <label class="ai-settings-row">
      <span>API key</span>
      <input
        type="password"
        class="ai-input"
        placeholder="sk_..."
        autocomplete="off"
        .value=${key}
        @change=${(/** @type {Event} */ e) => {
          const value = /** @type {HTMLInputElement} */ (e.target).value.trim();
          setElevenKey(value);
          // the key list shows only a key's ID; the key itself is shown
          // once, when it is made, and starts with sk_
          showNotice(
            !value
              ? "Key removed"
              : value.startsWith("sk_")
                ? "✓ Key saved"
                : "⚠ That doesn't look like a key: ElevenLabs keys start with sk_ (the key list only shows an ID). Make a new key and copy it when it's shown.",
            "voices",
          );
        }}
      />
    </label>
    <div class="ai-key-actions">
      <button
        type="button"
        class="ai-key-remove-btn"
        ?disabled=${!key}
        @click=${() => {
          setElevenKey("");
          showNotice("Key removed", "voices");
        }}
      >
        Remove key
      </button>
    </div>
    ${notice && noticeFor === "voices" ? html`<span class="ai-key-confirm">${notice}</span>` : html``}
    ${elevenProblem ? html`<p class="ai-error" role="status">⚠ ${elevenProblem}</p>` : html``}
    <p class="ai-key-note">
      The key is stored only on this device and is never included when you
      save or share a design.
    </p>
  </details>`;
}
