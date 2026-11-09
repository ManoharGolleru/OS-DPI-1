/**
 * ElevenLabs voices, with the student's own free key: natural US voices
 * that are the same in every browser, and tones (Angry, Sarcastic, …)
 * said with real emotion.
 *
 * The key stays in this browser's localStorage, like the AI service keys
 * (ai/index.js), and is never saved in a board or a build. Audio already
 * made is kept on this device, so a word said again plays at once and
 * costs nothing from the monthly allowance. Whenever ElevenLabs can't
 * speak (no key, no internet, allowance used up) the computer's voice
 * does, so a word is never left unsaid.
 */
import Globals from "app/globals";

const API = "https://api.elevenlabs.io/v1";
const KEY_NAME = "os-dpi-elevenlabs-key";
const CACHE_NAME = "os-dpi-elevenlabs";

/** Marks an ElevenLabs voice in a Speech component's voiceURI */
export const ELEVEN = "eleven:";

/** Fast, for words said plainly */
const FAST_MODEL = "eleven_flash_v2_5";
/** Understands emotion tags like [angry], for tones */
const EXPRESSIVE_MODEL = "eleven_v3";

/** How each tone is asked for: a tag for the expressive model, and
 * settings for the fast one if the expressive one can't be used. The
 * player can't go above full volume, so the voice itself carries an angry
 * or urgent tone; Calm is quieter. */
const toneStyles = {
  Normal: { tag: "", stability: 0.5, style: 0, speed: 1, volume: 1 },
  Calm: { tag: "[calm]", stability: 0.8, style: 0, speed: 0.85, volume: 0.6 },
  Urgent: { tag: "[urgent]", stability: 0.3, style: 0.6, speed: 1.15, volume: 1 },
  Angry: { tag: "[angry]", stability: 0.2, style: 0.9, speed: 1.05, volume: 1 },
  Sarcastic: { tag: "[sarcastic]", stability: 0.3, style: 0.8, speed: 0.85, volume: 1 },
};

/** @param {string} voiceURI */
export function isEleven(voiceURI) {
  return String(voiceURI || "").startsWith(ELEVEN);
}

/** @returns {string} */
export function getElevenKey() {
  try {
    return (localStorage.getItem(KEY_NAME) || "").trim();
  } catch {
    return "";
  }
}

/** Save (or clear, with "") the key on this device
 * @param {string} key */
export function setElevenKey(key) {
  key = key.trim();
  try {
    if (key) localStorage.setItem(KEY_NAME, key);
    else localStorage.removeItem(KEY_NAME);
  } catch {
    // storage blocked; the key just isn't remembered
  }
  elevenProblem = "";
  voiceKeyVersion++;
  checkedVoices.clear();
  pendingVoiceChecks.clear();
  voiceList = null;
  // a load still going with the old key is dropped, so the new key's
  // voices always come
  loadingVoices = null;
  loadElevenVoices();
}

/** What last went wrong, for the designer to show ("" when all is well)
 * @type {string} */
export let elevenProblem = "";

/** @param {string} problem */
function setProblem(problem) {
  if (problem === elevenProblem) return;
  elevenProblem = problem;
  Globals.state?.update();
}

// ── voices ──────────────────────────────────────────────────────────────

/** The US English voices: [id, name shown in the list]
 * @type {[string, string][] | null} */
let voiceList = null;
/** @type {Promise<void> | null} */
let loadingVoices = null;

/**
 * Metadata for a selected ElevenLabs voice. This is only a verification
 * result, not a stored API key or a change to the board's voice ID.
 * @typedef {{status: "checking" | "verified" | "ready" | "error", name: string, error: string}} VoiceInfo
 */
/** @type {Map<string, VoiceInfo>} */
const checkedVoices = new Map();
/** @type {Map<string, number>} */
const pendingVoiceChecks = new Map();
let voiceCheckSequence = 0;
let voiceKeyVersion = 0;

/** @param {string} voiceURI @returns {VoiceInfo | null} */
export function elevenVoiceInfo(voiceURI) {
  if (!isEleven(voiceURI)) return null;
  return checkedVoices.get(voiceURI.slice(ELEVEN.length)) ?? null;
}

function announceVoiceCheck() {
  document.dispatchEvent(new Event("os-dpi-voices"));
  Globals.state?.update();
}

/**
 * Resolve a manually entered voice ID to its real name using the key.
 * A lookup is done once for each ID/key, unless the user explicitly retries.
 * @param {string} voiceURI
 * @param {boolean} [retry]
 */
export function checkElevenVoice(voiceURI, retry = false) {
  if (!isEleven(voiceURI)) return;
  const id = voiceURI.slice(ELEVEN.length).trim();
  if (!id || (checkedVoices.has(id) && !retry)) return;

  const key = getElevenKey();
  const version = voiceKeyVersion;
  const sequence = ++voiceCheckSequence;
  pendingVoiceChecks.set(id, sequence);
  checkedVoices.set(id, { status: "checking", name: "", error: "" });

  if (!key) {
    checkedVoices.set(id, {
      status: "error", name: "",
      error: "Add an ElevenLabs API key under Content → Keys.",
    });
    announceVoiceCheck();
    return;
  }

  const current = () =>
    version === voiceKeyVersion && pendingVoiceChecks.get(id) === sequence;

  fetch(`${API}/voices/${encodeURIComponent(id)}`, {
    headers: { "xi-api-key": key },
  })
    .then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!current()) return;
      if (response.ok && result.voice_id === id) {
        const previous = checkedVoices.get(id);
        checkedVoices.set(id, {
          status: previous?.status === "ready" ? "ready" : "verified",
          name: String(result.name || "").trim() || "Custom ElevenLabs voice",
          error: "",
        });
      } else {
        const detail = String(result.detail?.status || "");
        const error =
          response.status === 401 || response.status === 403
            ? "Voice lookup denied. Check the API key's Voices: Read permission."
            : detail === "voice_not_found" || response.status === 404
              ? "Voice not found for this API key. Check the ID and workspace."
              : response.status === 429
                ? "ElevenLabs rate limit reached. Enter the ID again to retry."
                : `Unable to verify voice (HTTP ${response.status}). Enter the ID again to retry.`;
        checkedVoices.set(id, { status: "error", name: "", error });
      }
      announceVoiceCheck();
    })
    .catch(() => {
      if (!current()) return;
      checkedVoices.set(id, {
        status: "error", name: "",
        error: "Couldn't connect to ElevenLabs. Enter the ID again to retry.",
      });
      announceVoiceCheck();
    })
    .finally(() => {
      if (current()) pendingVoiceChecks.delete(id);
    });
}

/** Called only once playback starts, not merely when the ID is recognized.
 * @param {string} voiceId */
function markVoicePlayed(voiceId) {
  const info = checkedVoices.get(voiceId);
  if (!info || info.status === "ready") return;
  checkedVoices.set(voiceId, { status: "ready", name: info.name, error: "" });
  announceVoiceCheck();
}

/** The voices once loaded (none before) */
export function elevenVoices() {
  return voiceList ?? [];
}

/** Get the voices, once; the voice lists redraw when they arrive */
export function loadElevenVoices() {
  if (voiceList || loadingVoices) return;
  const key = getElevenKey();
  /** @param {boolean} withKey */
  const list = (withKey) =>
    fetch(`${API}/voices`, { headers: withKey ? { "xi-api-key": key } : {} });
  const load = (loadingVoices = list(!!key)
    // a key that may not read Voices (only Text to Speech, as the steps
    // say) can still speak; ElevenLabs's own voices list without one
    .then((response) => (!response.ok && key ? list(false) : response))
    .then(async (response) => {
      if (!response.ok) throw new Error(`voices: ${response.status}`);
      const { voices } = await response.json();
      if (load !== loadingVoices) return; // the key changed meanwhile
      voiceList = voices
        // American voices only, as with the computer's voices
        .filter((/** @type {any} */ v) => /american/i.test(v.labels?.accent ?? ""))
        .map((/** @type {any} */ v) => {
          const name = String(v.name).split(" - ")[0];
          const about = [v.labels?.gender, v.labels?.age?.replace("_", " ")]
            .filter((x) => x && x !== "neutral")
            .join(", ");
          return /** @type {[string, string]} */ ([
            v.voice_id,
            about ? `${name} (${about})` : name,
          ]);
        })
        .sort((/** @type {[string, string]} */ a, /** @type {[string, string]} */ b) =>
          a[1].localeCompare(b[1]),
        );
      document.dispatchEvent(new Event("os-dpi-voices"));
      Globals.state?.update();
    })
    .catch((error) => {
      console.error("ElevenLabs voices failed to load", error);
      if (load === loadingVoices) {
        setProblem("ElevenLabs voices couldn't be loaded; check the internet connection and the key.");
      }
    })
    .finally(() => {
      if (load === loadingVoices) loadingVoices = null;
    }));
}

// ── speaking ────────────────────────────────────────────────────────────

/** One ordinary audio player. Web Audio would allow louder than full, but
 * Safari can run it without a sound coming out, so the voice plays the way
 * any audio clip does. */
const player = new Audio();
/** The clip's address, freed when the next one plays
 * @type {string} */
let playingUrl = "";
/** Each request's number, so only the latest one plays */
let latest = 0;

/** Clips made this session
 * @type {Map<string, Blob>} */
const clips = new Map();

/** Stop whatever ElevenLabs is saying */
export function stopEleven() {
  latest++;
  player.pause();
}

/**
 * Say text in an ElevenLabs voice.
 * @param {string} text
 * @param {string} voiceURI - ELEVEN + the voice id
 * @param {string} tone - a name from speech.js's Tones
 * @param {number} volume - the board's own volume, 0 to 1
 * @param {() => void} [done] - called when it has been said
 * @returns {Promise<boolean>} false when it couldn't, so the computer's
 *   voice can say it instead
 */
export async function speakEleven(text, voiceURI, tone, volume, done = () => {}) {
  const key = getElevenKey();
  if (!key) {
    setProblem("Paste an ElevenLabs key to use this voice; the computer's voice speaks until then.");
    return false;
  }
  stopEleven();
  const request = latest;
  const voice = voiceURI.slice(ELEVEN.length);
  const style = toneStyles[/** @type {keyof typeof toneStyles} */ (tone)] ?? toneStyles.Normal;
  const id = `${voice}|${tone}|${text}`;

  let clip = clips.get(id);
  if (!clip) {
    const audio = await saved(id, () => make(text, voice, style, key));
    if (!audio) return false;
    clip = new Blob([audio], { type: "audio/mpeg" });
    clips.set(id, clip);
    if (clips.size > 100) clips.delete(/** @type {string} */ (clips.keys().next().value));
  }
  if (request !== latest) return true; // something newer was said
  setProblem("");
  const played = await play(clip, Math.min(1, Math.max(0, style.volume * volume)), done);
  if (played && request === latest) markVoicePlayed(voice);
  return played;
}

/**
 * Audio kept on this device from before, or made now and kept
 * @param {string} id
 * @param {() => Promise<ArrayBuffer | null>} makeIt
 * @returns {Promise<ArrayBuffer | null>}
 */
async function saved(id, makeIt) {
  // a made-up address to file it under; it is never fetched
  const address = `https://audio.os-dpi.invalid/${encodeURIComponent(id)}`;
  /** @type {Cache | null} */
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const kept = await cache.match(address);
    if (kept) return await kept.arrayBuffer();
  } catch {
    // no cache storage (private window); just make it each time
  }
  const audio = await makeIt();
  if (audio && cache) {
    cache
      .put(address, new Response(audio.slice(0), { headers: { "Content-Type": "audio/mpeg" } }))
      .catch(() => {});
  }
  return audio;
}

/**
 * Ask ElevenLabs for the audio: the expressive model for a tone, falling
 * back to the fast one with the tone's settings
 * @param {string} text
 * @param {string} voice
 * @param {typeof toneStyles.Normal} style
 * @param {string} key
 * @returns {Promise<ArrayBuffer | null>}
 */
async function make(text, voice, style, key) {
  if (style.tag) {
    const audio = await ask(voice, key, {
      text: `${style.tag} ${text}`,
      model_id: EXPRESSIVE_MODEL,
    });
    if (audio) return audio;
  }
  return ask(voice, key, {
    text,
    model_id: FAST_MODEL,
    voice_settings: {
      stability: style.stability,
      similarity_boost: 0.75,
      style: style.style,
      speed: style.speed,
    },
  });
}

/**
 * @param {string} voice
 * @param {string} key
 * @param {Object} body
 * @returns {Promise<ArrayBuffer | null>}
 */
async function ask(voice, key, body) {
  let response;
  try {
    response = await fetch(
      `${API}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  } catch {
    setProblem("No internet connection to ElevenLabs; the computer's voice is speaking instead.");
    return null;
  }
  if (response.ok) return response.arrayBuffer();

  const detail = await response.text().catch(() => "");
  console.error("ElevenLabs:", response.status, detail);
  // ElevenLabs explains itself in detail.message
  let reason = "";
  try {
    reason = String(JSON.parse(detail)?.detail?.message ?? "");
  } catch {
    reason = detail.slice(0, 200);
  }
  if (/unusual.activity/i.test(detail)) {
    setProblem("ElevenLabs has paused free use for this account (it reported unusual activity, which can happen on a school network or VPN); the computer's voice is speaking instead.");
  } else if (/quota|credits|limit/i.test(detail)) {
    setProblem("This month's free ElevenLabs allowance is used up; the computer's voice is speaking instead. Words said before still play.");
  } else if (response.status === 401) {
    setProblem("The ElevenLabs key wasn't accepted. Check it was copied whole, and that it may use Text to Speech.");
  } else if (response.status === 429) {
    setProblem("ElevenLabs is busy; the computer's voice is speaking instead for now.");
  } else {
    setProblem(`ElevenLabs didn't speak (error ${response.status}${reason ? `: ${reason}` : ""}); the computer's voice is speaking instead.`);
  }
  return null;
}

/** A moment of silence, as a WAV clip, to start the player during a tap */
function silence() {
  const samples = 800; // 0.1 s at 8000 Hz, 8-bit
  const wav = new DataView(new ArrayBuffer(44 + samples));
  const text = (/** @type {number} */ at, /** @type {string} */ value) =>
    [...value].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  wav.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); // PCM
  wav.setUint16(22, 1, true); // mono
  wav.setUint32(24, 8000, true);
  wav.setUint32(28, 8000, true);
  wav.setUint16(32, 1, true);
  wav.setUint16(34, 8, true);
  text(36, "data");
  wav.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) wav.setUint8(44 + i, 128); // 8-bit silence
  return URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
}

/** Browsers (Safari above all) only let a page start sound during a tap or
 * key press, but ElevenLabs's audio arrives a moment after one. Playing
 * silence on the player during the student's first tap lets it play
 * whatever comes later. */
let unlocked = false;
function unlock() {
  if (unlocked || !getElevenKey()) return;
  unlocked = true;
  player.src = silence();
  player.play().catch(() => {
    unlocked = false; // try again on the next tap
  });
}
document.addEventListener("pointerdown", unlock, true);
document.addEventListener("keydown", unlock, true);

/**
 * @param {Blob} clip
 * @param {number} volume - 0 to 1
 * @param {() => void} done - called when it has played to the end
 * @returns {Promise<boolean>}
 */
async function play(clip, volume, done) {
  if (playingUrl) URL.revokeObjectURL(playingUrl);
  playingUrl = URL.createObjectURL(clip);
  player.src = playingUrl;
  player.volume = volume;
  player.onended = done;
  try {
    await player.play();
    return true;
  } catch (error) {
    console.error("ElevenLabs audio couldn't play", error);
    setProblem("The browser blocked the sound. Tap or click anywhere on the page once, then try again.");
    return false;
  }
}
