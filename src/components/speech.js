import { TreeBase } from "./treebase";
import { html } from "uhtml";
import Globals from "app/globals";
import * as Props from "./props";
import { toString } from "./slots";
import { cursor } from "./notes";
import { CLEAR_AFTER_SAYING } from "./pieces";
import {
  ELEVEN,
  elevenVoices,
  getElevenKey,
  isEleven,
  loadElevenVoices,
  speakEleven,
  stopEleven,
} from "./elevenlabs";

/**
 * Board designs from other OS-DPI forks sometimes bind pitch/rate/volume to
 * a state name (e.g. "$Rate") rather than a number; this app's Speech props
 * are plain floats, so that comes through as NaN. Assigning a non-finite
 * value to SpeechSynthesisUtterance's rate/pitch/volume throws, so fall back
 * to the neutral default instead of letting one bad value silence speech.
 * @param {number} value
 * @param {number} fallback
 */
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Tell the page how speaking is going: "boundary" at each word (the
 * message bar can highlight it) and "end" when done
 * @param {"boundary" | "end"} type
 * @param {number} [charIndex]
 */
function announce(type, charIndex = 0) {
  const event = new Event(type);
  Object.defineProperty(event, "charIndex", { value: charIndex });
  document.dispatchEvent(event);
}

/** Counts what has been asked to be said, so only the latest one's end
 * counts (a word cut off by the next one ends too) */
let sayings = 0;

/** A word shown in the message bar only while it is said ("says it,
 * shows it, then clears it", pieces.js) is cleared once it has been said */
document.addEventListener("end", () => {
  const bar = String(Globals.state?.get(CLEAR_AFTER_SAYING) || "");
  if (bar) Globals.state.update({ [bar]: "", [CLEAR_AFTER_SAYING]: "" });
});

/**
 * @param {string} message
 * @param {string} voiceURI
 * @param {number} pitch
 * @param {number} rate
 * @param {number} volume
 * @param {() => void} [done] - called when it has been said
 */
export async function speak(
  message,
  voiceURI,
  pitch,
  rate,
  volume,
  done = () => announce("end"),
) {
  if (!message) return;
  stopEleven();
  const voices = await getVoices();
  const voice = voiceURI && voices.find((voice) => voice.voiceURI == voiceURI);
  const utterance = new SpeechSynthesisUtterance(message);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }
  utterance.pitch = finiteOr(pitch, 1);
  utterance.rate = finiteOr(rate, 1);
  utterance.volume = finiteOr(volume, 1);
  utterance.addEventListener("boundary", (event) =>
    announce("boundary", event.charIndex),
  );
  utterance.addEventListener("end", done);
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

/** Ways of saying a word. The browser voice can only change its speed,
 * pitch and volume, so each tone is a mix of those; volume can't go above
 * full, so Calm is quieter rather than Angry louder. An ending adds
 * punctuation many voices say with more force. */
export const Tones = {
  Normal: { rate: 1, pitch: 1, volume: 1, ending: "" },
  Calm: { rate: 0.8, pitch: 0.85, volume: 0.55, ending: "" },
  Urgent: { rate: 1.3, pitch: 1.15, volume: 1, ending: "!" },
  Angry: { rate: 1.1, pitch: 0.7, volume: 1, ending: "!" },
  Sarcastic: { rate: 0.65, pitch: 1.3, volume: 0.9, ending: "" },
};

/** @param {any} name
 * @returns {keyof typeof Tones | ""} */
function toneNamed(name) {
  const key = String(name ?? "").trim();
  return key in Tones ? /** @type {keyof typeof Tones} */ (key) : "";
}

/**
 * What to say and how, for the message just set to be spoken: a button's
 * own "say it like" text stands in for its word, and the tone is the
 * button's own, else its grid's, else the one picked on the tone buttons
 * ($Tone).
 * @param {string} message
 * @param {Record<string, any>} button - the button pressed (Actions keeps
 *   the data of the last press)
 */
function howToSay(message, button = Globals.actions?.last?.data ?? {}) {
  const say = String(button.say ?? "").trim();
  if (say && message.trim() === String(button.label ?? "").trim()) {
    message = say;
  }
  const name =
    toneNamed(button.tone) ||
    toneNamed(button.GridTone) ||
    toneNamed(Globals.state.get("$Tone")) ||
    "Normal";
  const tone = Tones[name];
  if (tone.ending && !/[.!?]\s*$/.test(message)) message += tone.ending;
  return { message, tone, name };
}

class Speech extends TreeBase {
  stateName = new Props.String("$Speak");
  voiceURI = new Props.Voice("", { label: "Voice" });
  pitch = new Props.Float(1);
  rate = new Props.Float(1);
  volume = new Props.Float(1);

  /** Say a message in this board's voice, the way the button wants it
   * @param {string} text
   * @param {Record<string, any>} [button] */
  say(text, button) {
    const { message, tone, name } = howToSay(text, button);
    const voice = this.voiceURI.value;
    const saying = ++sayings;
    const done = () => {
      if (saying === sayings) announce("end");
    };
    const computerVoice = () =>
      speak(
        message,
        voice,
        // pitch runs 0 to 2 and volume 0 to 1
        Math.min(2, finiteOr(this.pitch.value, 1) * tone.pitch),
        finiteOr(this.rate.value, 1) * tone.rate,
        Math.min(1, finiteOr(this.volume.value, 1) * tone.volume),
        done,
      );
    if (!isEleven(voice)) {
      computerVoice();
      return;
    }
    // ElevenLabs says the tone itself; when it can't speak (no key, no
    // internet, allowance used up) the computer's voice does
    speechSynthesis.cancel();
    speakEleven(message, voice, name, finiteOr(this.volume.value, 1), done).then(
      (spoke) => {
        if (!spoke) computerVoice();
      },
    );
  }

  async speak() {
    const { state } = Globals;
    const voiceURI = this.voiceURI.value;
    const message = toString(state.get(this.stateName.value)).replace(
      cursor,
      "",
    );
    const voices = await getVoices();
    const voice =
      voiceURI && voices.find((voice) => voice.voiceURI == voiceURI);
    const utterance = new SpeechSynthesisUtterance(message);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "en-US";
    }
    utterance.pitch = finiteOr(this.pitch.value, 1);
    utterance.rate = finiteOr(this.rate.value, 1);
    utterance.volume = finiteOr(this.volume.value, 1);
    utterance.addEventListener("boundary", (event) => {
      document.dispatchEvent(
        new SpeechSynthesisEvent("boundary", {
          utterance: event.utterance,
          charIndex: event.charIndex,
        }),
      );
    });
    utterance.addEventListener("end", (event) => {
      document.dispatchEvent(
        new SpeechSynthesisEvent("end", {
          utterance: event.utterance,
          charIndex: event.charIndex,
        }),
      );
    });
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  template() {
    const { state } = Globals;
    boardSpeech = this;
    if (state.hasBeenUpdated(this.stateName.value)) {
      this.say(toString(state.get(this.stateName.value)));
    }
    return html`<div />`;
  }
}
TreeBase.register(Speech, "Speech");

/** The board's Speech, last drawn, so the designer can try out a word
 * @type {Speech | null} */
let boardSpeech = null;

/** Say a word the way its button would on the board (designer preview)
 * @param {Record<string, any>} button - the button's data */
export function sayLikeButton(button) {
  const text = String(button.label ?? "");
  if (boardSpeech) boardSpeech.say(text, button);
  else {
    const { message, tone } = howToSay(text, button);
    speak(message, "", tone.pitch, tone.rate, tone.volume);
  }
}

/** Only voices with a United States English accent are offered
 * @param {SpeechSynthesisVoice} voice */
function isUSEnglish(voice) {
  return /^en[-_]US/i.test(voice.lang);
}

/** macOS ships novelty voices (Bells, Boing, Zarvox, …), legacy robotic
 * voices (Fred, Junior, …), and cartoonish character voices (Grandma,
 * Rocko, …). None are appropriate for an AAC user's voice, so keep them
 * out of the picker and out of the default-voice selection. */
const NOVELTY_VOICES = new Set([
  "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos",
  "Deranged", "Good News", "Jester", "Organ", "Superstar", "Trinoids",
  "Whisper", "Wobble", "Zarvox",
  "Fred", "Junior", "Kathy", "Ralph",
  "Eddy", "Flo", "Grandma", "Grandpa", "Reed", "Rocko", "Sandy", "Shelley",
]);

/** @param {SpeechSynthesisVoice} voice */
function isGenericVoice(voice) {
  // names may carry a locale suffix, e.g. "Eddy (English (US))"
  const baseName = voice.name.split("(")[0].trim();
  return !NOVELTY_VOICES.has(baseName);
}

/** Keep the generic US voices; fall back rather than offer nothing on
 * systems where the filters would leave an empty list
 * @param {SpeechSynthesisVoice[]} all */
function usOnly(all) {
  const generic = all.filter(isGenericVoice);
  const candidates = generic.length ? generic : all;
  const us = candidates.filter(isUSEnglish);
  return us.length ? us : candidates;
}

/** @type{SpeechSynthesisVoice[]} */
let voices = [];

// Pre-load voices as early as possible so speakSync() can use them.
// Chrome fires "voiceschanged" asynchronously; this ensures the cache is warm.
if (typeof speechSynthesis !== "undefined") {
  voices = usOnly(speechSynthesis.getVoices());
  speechSynthesis.addEventListener("voiceschanged", () => {
    voices = usOnly(speechSynthesis.getVoices());
  });
}

/** The preferred US-accent voice, or null when none have loaded yet */
export function preferredVoice() {
  return voices.find((voice) => voice.default) || voices[0] || null;
}

/**
 * Speak text synchronously inside a user-gesture handler.
 *
 * Unlike speak(), this does NOT await voice loading, so it stays within
 * Chrome's transient user-activation context and works without "await".
 * Call this directly from pointerup / click handlers.
 *
 * @param {string} text
 */
export function speakSync(text) {
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  // Attach the best pre-loaded voice if available (improves Chrome reliability)
  const voice = preferredVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

/**
 * Promise to return voices
 *
 * @return {Promise<SpeechSynthesisVoice[]>} Available voices
 */
function getVoices() {
  return new Promise(function (resolve) {
    // iOS won't fire the voiceschanged event so we have to poll for them
    function f() {
      voices = (voices.length && voices) || usOnly(speechSynthesis.getVoices());
      if (voices.length) resolve(voices);
      else setTimeout(f, 100);
    }
    f();
  });
}

/** Edge's online voices that sound like a person, e.g. "Microsoft Aria
 * Online (Natural) - English (United States)"; only Edge has them
 * @param {SpeechSynthesisVoice} voice */
export function isNatural(voice) {
  return /\(Natural\)/i.test(voice.name);
}

/** True when the browser offers Edge's natural voices */
export async function hasNaturalVoices() {
  return (await getVoices()).some(isNatural);
}

/** A short name for the voice list: "Aria (natural)" rather than the
 * whole of Edge's name
 * @param {SpeechSynthesisVoice} voice */
function voiceName(voice) {
  const natural = /^Microsoft (\w+?)(Multilingual)? Online \(Natural\)/i.exec(voice.name);
  if (natural) return `${natural[1]} (natural)`;
  return `${voice.name} ${voice.lang}`;
}

class VoiceSelect extends HTMLSelectElement {
  constructor() {
    super();
  }
  /** Browsers load voices in stages (the computer's first, online ones
   * like Edge's natural voices a moment later), so the list is made again
   * whenever more arrive */
  refresh = () => this.addVoices();

  connectedCallback() {
    this.addVoices();
    speechSynthesis.addEventListener("voiceschanged", this.refresh);
    document.addEventListener("os-dpi-voices", this.refresh);
  }

  disconnectedCallback() {
    speechSynthesis.removeEventListener("voiceschanged", this.refresh);
    document.removeEventListener("os-dpi-voices", this.refresh);
  }

  async addVoices() {
    const voices = await getVoices();
    const current = this.value || this.getAttribute("value");
    // the voices added last time go; options from the page (like the
    // computer's own voice) stay
    for (const old of this.querySelectorAll("[data-voice]")) old.remove();
    /** @param {SpeechSynthesisVoice} a
     * @param {SpeechSynthesisVoice} b
     */
    function compareVoices(a, b) {
      // the natural voices first: they sound the most like a person
      return (
        +isNatural(b) - +isNatural(a) ||
        a.lang.localeCompare(b.lang) ||
        voiceName(a).localeCompare(voiceName(b))
      );
    }
    voices.sort(compareVoices);
    for (const voice of voices) {
      const item = document.createElement("option");
      item.dataset.voice = "";
      item.value = voice.voiceURI;
      if (voice.voiceURI == current) item.setAttribute("selected", "");
      item.innerText = voiceName(voice);
      this.add(item);
    }
    // ElevenLabs voices, once the student has pasted a key
    if (getElevenKey()) {
      loadElevenVoices();
      const group = document.createElement("optgroup");
      group.dataset.voice = "";
      group.label = "ElevenLabs (your key)";
      for (const [id, name] of elevenVoices()) {
        const item = document.createElement("option");
        item.value = ELEVEN + id;
        item.innerText = name;
        group.append(item);
      }
      // the board's voice stays picked while the list (re)loads
      if (current && isEleven(current) && !group.querySelector(`[value="${CSS.escape(current)}"]`)) {
        const item = document.createElement("option");
        item.value = current;
        item.innerText = "ElevenLabs voice (loading…)";
        group.append(item);
      }
      if (group.children.length) this.append(group);
    }
    if (current) this.value = current;
  }
}
customElements.define("select-voice", VoiceSelect, { extends: "select" });
