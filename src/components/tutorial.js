/** A step-by-step guided tour of the designer for new users */

import Globals from "app/globals";
import "css/tutorial.css";

/**
 * Find a toolbar menu button by its label
 * @param {string} label
 * @returns {Element | null}
 */
function menuButton(label) {
  return (
    [...document.querySelectorAll("#toolbar .Menu > button")].find(
      (button) => button.textContent?.trim() === label,
    ) || null
  );
}

/**
 * @typedef {Object} TutorialStep
 * @property {string} title
 * @property {string} body
 * @property {string} [tab] - designer tab to switch to before showing
 * @property {boolean} [preview] - show this step in user mode
 * @property {() => Element | null} [find] - element to highlight
 */

/** @type {TutorialStep[]} */
const steps = [
  {
    title: "Welcome to OS-DPI",
    body:
      "This quick tour shows you around the designer. " +
      "Use Next (or the → key) to continue and Esc to leave at any time.",
  },
  {
    find: () => document.querySelector("#UI"),
    title: "Your board",
    body:
      "The left side is the board itself — a live view of what the " +
      "person using it will see. It updates as you build.",
  },
  {
    find: () => document.querySelector("#tabs .buttons"),
    title: "Designer panels",
    body:
      "Layout is where you build the board. Content holds its words and " +
      "media. Advanced has the rest: the full component tree " +
      "(Components), actions, cues, patterns, and access methods.",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector(".piece-choice-main") ||
      document.querySelector("#tabs .panels"),
    title: "Start a board",
    body:
      "On an empty board, Talking board gives you a message bar and a " +
      "word grid in one click. Or add one piece at a time: a message " +
      "bar, a word grid, a button, or tabs for pages of words.",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector("#UI .grid") ||
      document.querySelector("#tabs .panels"),
    title: "Fill the grid with words",
    body:
      "Click a square on the board and type a word. Enter moves on to " +
      "the next square, and pasting a list fills a square per line. The " +
      "grid grows by itself as you add words.",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector("#UI .grid img") ||
      document.querySelector("#UI .grid") ||
      document.querySelector("#tabs .panels"),
    title: "Pictures",
    body:
      "Each word gets a free picture symbol by itself. Click a picture " +
      "to choose a better one (an AI helps if you set one up), or " +
      "double-click a square to use a picture from your computer.",
  },
  {
    tab: "Layout",
    find: () => document.querySelector("#UI"),
    title: "Change and arrange pieces",
    body:
      "Click a piece on the board to select it: its settings show in " +
      "Layout. The + buttons around it add a piece on that side, ⠿ Move " +
      "drags it somewhere else, and the grey bars between pieces resize " +
      "them.",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector(".message-bar-setting") ||
      document.querySelector("#tabs .panels"),
    title: "What tapping a word does",
    body:
      "Click a word grid, then choose Tapping a word. “Adds it to the " +
      "message bar” builds a sentence; “shows it, then clears it” puts " +
      "the word in the message bar only while it is said; “just says it” " +
      "leaves the message bar alone. Each grid can do something different.",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector("#UI .grid button.tone-chosen") ||
      document.querySelector("#tabs .panels"),
    title: "Tones: how words are said",
    body:
      "Add Tone buttons from a piece's + menu: tap Calm, Urgent, Angry or " +
      "Sarcastic on the board, and the words after it are said that way " +
      "until another tone is tapped. To make a whole grid one tone, like " +
      "a tab of sarcasm, click the grid and choose its Tone.",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector("#UI .grid img") ||
      document.querySelector("#UI .grid") ||
      document.querySelector("#tabs .panels"),
    title: "One word, said your way",
    body:
      "Click a word's picture to change just that word: give it its own " +
      "Tone, or type how to Say it, like “riiiight” for “right”. Press ▶ " +
      "to hear it; the button still shows the plain word.",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector(".board-voice") ||
      document.querySelector("#tabs .panels"),
    title: "The board's voice",
    body:
      "Choose the voice at the top of Layout and press ▶ to hear it. " +
      "Microsoft Edge adds voices that sound more like a person (Aria, " +
      "Jenny, Guy…).",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector(".boards-bar") ||
      document.querySelector("#tabs .panels"),
    title: "More boards, if you want them",
    body:
      "One board is all most people need. If you want more, a board can " +
      "open other boards, like folders: Home → Food → Fruit. Use the + " +
      "button under Boards (it also puts a button to the new board here), " +
      "or choose Board button from a piece's + menu. A word square " +
      "can open a board too: click its picture and pick what tapping it " +
      "does.",
  },
  {
    tab: "Layout",
    find: () =>
      document.querySelector("#board-map:not([hidden])") ||
      document.querySelector(".boards-bar") ||
      document.querySelector("#tabs .panels"),
    title: "Finding your way between boards",
    body:
      "Each new board gets a Back button, and the message bar stays on " +
      "every board, so a sentence can be built across them. Once there " +
      "is more than one board, the strip above the board shows where you " +
      "are and which boards it opens; 🗺 Map shows them all as a tree.",
  },
  {
    tab: "Content",
    find: () =>
      document.querySelector(".content .ai-section") ||
      document.querySelector("#tabs .panels"),
    title: "Content: words from elsewhere",
    body:
      "The words behind your grids live here too. Load a spreadsheet " +
      "with File → Load Sheet, or open “✨ Generate with AI”, describe " +
      "the board you want, and let it build one for you.",
  },
  {
    tab: "Content",
    find: () => document.querySelector(".content-load-media-btn"),
    title: "Your own media",
    body:
      "Load your own images and sounds here, then drag a thumbnail onto " +
      "a button on the board to use it.",
  },
  {
    tab: "Content",
    find: () =>
      document.querySelector(".voice-key") ||
      document.querySelector("#tabs .panels"),
    title: "More voices: ElevenLabs",
    body:
      "For natural voices that sound the same in every browser, and tones " +
      "said with real feeling, paste a free ElevenLabs key under Keys, " +
      "then pick an ElevenLabs voice in Layout. Everything " +
      "said on the board is then sent to ElevenLabs to be spoken.",
  },
  {
    find: () => menuButton("File"),
    title: "Saving and loading",
    body:
      "The File menu saves and loads whole designs (.osdpi files), " +
      "spreadsheets, and media.",
  },
  {
    find: () => menuButton("Help"),
    title: "Help, in context",
    body:
      "The Help menu opens the wiki page for whatever component you have " +
      "selected — handy when you wonder what a component does.",
  },
  {
    find: () => document.querySelector(".toolbar-preview-btn"),
    title: "Try it out",
    body:
      "Preview switches to user mode so you can use the board for real. " +
      "Press Alt+D there to come back to the designer. Let’s take a look…",
  },
  {
    preview: true,
    find: () => document.querySelector(".ss-mic"),
    title: "Speech suggestions",
    body:
      "This is user mode. Tap the mic and OS-DPI listens to the " +
      "conversation: an AI turns what it hears into tap-to-say reply " +
      "chips and fills the board with matching picture buttons.",
  },
  {
    preview: true,
    find: () => document.querySelector(".ss-bar"),
    title: "Steering the suggestions",
    body:
      "While listening, the bar shows what was heard. A hint box lets " +
      "the user type a few letters to steer the suggestions toward what " +
      "they want to say, and quick phrases like “Just a second” hold " +
      "their place in the conversation while they compose.",
  },
  {
    preview: true,
    find: () => document.querySelector(".ss-reset"),
    title: "Reset the board",
    body:
      "After a conversation fills the board with suggestions, tap this " +
      "twice to clear it back to a blank design. The pencil next to it " +
      "returns to the editor.",
  },
  {
    title: "That’s the tour!",
    body:
      "To begin: click Talking board in Layout, type some words into the " +
      "grid, and press Preview to try it. You can run this tour again any " +
      "time from Help → Tutorial.",
  },
];

class Tutorial {
  index = 0;

  /** @type {HTMLDivElement | null} */
  root = null;

  /** True while the tour has switched the app into user mode */
  inPreview = false;

  open() {
    if (this.root) return;
    const root = document.createElement("div");
    root.className = "tutorial-overlay";
    root.innerHTML = `
      <div class="tutorial-highlight" hidden></div>
      <div
        class="tutorial-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="TutorialTitle"
      >
        <button class="tutorial-close" aria-label="Close tutorial">×</button>
        <h3 id="TutorialTitle"></h3>
        <p></p>
        <div class="tutorial-footer">
          <span class="tutorial-progress"></span>
          <div class="tutorial-nav">
            <button class="tutorial-back">Back</button>
            <button class="tutorial-next">Next</button>
          </div>
        </div>
      </div>`;
    document.body.append(root);
    this.root = root;

    root
      .querySelector(".tutorial-close")
      ?.addEventListener("click", () => this.close());
    root
      .querySelector(".tutorial-back")
      ?.addEventListener("click", () => this.show(this.index - 1));
    root
      .querySelector(".tutorial-next")
      ?.addEventListener("click", () => this.show(this.index + 1));

    /** @param {KeyboardEvent} event */
    this.keyHandler = (event) => {
      if (event.key === "Escape") this.close();
      else if (event.key === "ArrowRight" || event.key === "Enter")
        this.show(this.index + 1);
      else if (event.key === "ArrowLeft") this.show(this.index - 1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", this.keyHandler, true);

    this.resizeHandler = () => this.place();
    window.addEventListener("resize", this.resizeHandler);

    this.show(0);
  }

  close() {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    if (this.keyHandler)
      document.removeEventListener("keydown", this.keyHandler, true);
    if (this.resizeHandler)
      window.removeEventListener("resize", this.resizeHandler);
    // the tour started from the designer — return there
    if (this.inPreview) {
      this.inPreview = false;
      Globals.state?.update({ editing: true });
    }
  }

  /** @param {number} index */
  show(index) {
    const root = this.root;
    if (!root || index < 0) return;
    if (index >= steps.length) {
      this.close();
      return;
    }
    this.index = index;
    const step = steps[index];

    const title = /** @type {HTMLElement} */ (root.querySelector("h3"));
    const body = /** @type {HTMLElement} */ (root.querySelector("p"));
    const progress = /** @type {HTMLElement} */ (
      root.querySelector(".tutorial-progress")
    );
    const back = /** @type {HTMLButtonElement} */ (
      root.querySelector(".tutorial-back")
    );
    const next = /** @type {HTMLButtonElement} */ (
      root.querySelector(".tutorial-next")
    );
    title.textContent = step.title;
    body.textContent = step.body;
    progress.textContent = `${index + 1} of ${steps.length}`;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? "Finish" : "Next";
    next.focus();

    // steps default to the designer; preview steps run in user mode
    const wantPreview = !!step.preview;
    if (wantPreview !== this.inPreview) {
      this.inPreview = wantPreview;
      Globals.state?.update({ editing: !wantPreview });
      // give the mode switch a moment to render before measuring
      setTimeout(() => this.place(), 350);
    }
    if (step.tab && Globals.designer) {
      Globals.designer.switchTab(step.tab);
      // give the panel a moment to render before measuring the target
      setTimeout(() => this.place(), 350);
    }
    this.place();
  }

  /** Position the highlight and the card for the current step */
  place() {
    const root = this.root;
    if (!root) return;
    const step = steps[this.index];
    const highlight = /** @type {HTMLElement} */ (
      root.querySelector(".tutorial-highlight")
    );
    const card = /** @type {HTMLElement} */ (
      root.querySelector(".tutorial-card")
    );

    const target = step.find ? step.find() : null;
    let rect = null;
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) rect = null;
    }

    root.classList.toggle("tutorial-overlay--dim", !rect);
    if (!rect) {
      highlight.hidden = true;
      card.classList.add("tutorial-card--center");
      card.style.top = "";
      card.style.left = "";
      return;
    }

    const pad = 6;
    const margin = 12;
    highlight.hidden = false;
    highlight.style.top = `${rect.top - pad}px`;
    highlight.style.left = `${rect.left - pad}px`;
    highlight.style.width = `${rect.width + 2 * pad}px`;
    highlight.style.height = `${rect.height + 2 * pad}px`;

    card.classList.remove("tutorial-card--center");
    const cardRect = card.getBoundingClientRect();
    let top = rect.bottom + pad + margin;
    if (top + cardRect.height > window.innerHeight - margin) {
      top = rect.top - pad - cardRect.height - margin;
    }
    top = Math.max(margin, top);
    let left = rect.left;
    left = Math.min(left, window.innerWidth - cardRect.width - margin);
    left = Math.max(margin, left);
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }
}

let active = /** @type {Tutorial | null} */ (null);

/** Start (or restart) the guided tour */
export function startTutorial() {
  if (!active) active = new Tutorial();
  active.open();
}
