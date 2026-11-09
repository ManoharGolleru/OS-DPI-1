import { html } from "uhtml";
import { TreeBase } from "./treebase";
import * as Props from "./props";
import "css/display.css";
import Globals from "app/globals";
import { formatSlottedString, hasSlots } from "./slots";
import { formatNote } from "./notes";

class Display extends TreeBase {
  stateName = new Props.String("$Display");
  Name = new Props.String("");
  background = new Props.Color("white");
  fontSize = new Props.Float(2);
  scale = new Props.Float(1);
  highlightWords = new Props.Boolean(false);
  showHistory = new Props.Boolean(false);

  /** @type {HTMLDivElement | null} */
  current = null;

  static functionsInitialized = false;

  /** @type {string[]} */
  _history = [];

  template() {
    const { state } = Globals;
    // State also holds numeric scores, timers and boolean indicators.
    // Keep zero visible, and give the text formatters a string.
    const value = String(state.get(this.stateName.value) ?? "");

    // Track history: add non-empty values when they change
    if (value && (this._history.length === 0 || this._history[0] !== value)) {
      this._history.unshift(value);
      if (this._history.length > 20) this._history.length = 20;
    }

    const content =
      (hasSlots(value) && formatSlottedString(value)) || formatNote(value);

    const historyPanel =
      this.showHistory.value && this._history.length > 0
        ? html`<ol class="display-history" aria-label="Utterance history">
            ${this._history.map(
              (entry) => html`<li title=${entry}>${entry}</li>`,
            )}
          </ol>`
        : html``;

    // shrink the text once it's on screen if it doesn't fit
    requestAnimationFrame(() => this.fitText());

    return this.component(
      {
        // in the designer an empty message bar shows sample text (CSS), so
        // its text size can be seen while it is being chosen
        classes: value ? [] : ["display-empty"],
        style: {
          backgroundColor: this.background.value,
          fontSize: this.fontSize.value + "rem",
          flexDirection: "column",
        },
      },
      // prettier-ignore
      html`<button
        ref=${this}
        @pointerup=${this.click}
        tabindex="-1"
        ?disabled=${!this.Name.value}
        data=${{
          name: this.Name.value,
          ComponentName: this.Name.value,
          ComponentType: this.className,
        }}
      >${content}</button>${historyPanel}`,
    );
  }

  /** Shrink the text until it fits the box, so the end of a long
   * sentence (like a live AI suggestion) is never cut off. Steps down
   * from the configured fontSize to half of it at most. */
  fitText() {
    const button = this.current;
    if (!button || !button.isConnected) return;
    button.style.fontSize = "";
    const range = document.createRange();
    range.selectNodeContents(button);
    const available = button.clientHeight;
    if (!available) return;
    let size = 1;
    while (
      size > 0.5 &&
      range.getBoundingClientRect().height > available + 1
    ) {
      size -= 0.05;
      button.style.fontSize = size.toFixed(2) + "em";
    }
  }

  /** Attempt to locate the word the user is touching
   */
  click = () => {
    /**
     * @param {HTMLElement} root
     * @param {Selection} s
     * @returns {number}
     */
    function getOffsetToSelection(root, s) {
      const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

      let offset = 0;
      while (treeWalker.nextNode()) {
        const node = /** @type {Text} */ (treeWalker.currentNode);
        if (node == s.focusNode) {
          return offset + s.focusOffset;
        }
        offset += node.data.length;
      }
      return -1;
    }
    const s = window.getSelection();
    if (!s) return;
    let element = document.getElementById(this.id);
    if (!element) {
      return;
    }
    element = element.querySelector("button");
    if (!element) {
      return;
    }
    if (!element.contains(s.anchorNode)) {
      return;
    }
    let word = "";
    if (s.isCollapsed) {
      s.modify("move", "forward", "character");
      s.modify("move", "backward", "word");
      s.modify("extend", "forward", "word");
      word = s.toString();
      s.modify("move", "forward", "character");
    } else {
      word = s.toString();
    }
    this.current?.setAttribute("data--clicked-word", word);
    this.current?.setAttribute(
      "data--clicked-caret",
      getOffsetToSelection(element, s).toString(),
    );
    s.empty();
  };

  /**
   * @param {SpeechSynthesisEvent} event
   */
  handleEvent(event) {
    /**
     * @param {HTMLElement} root
     * @param {number} offset
     * @returns {[Text|null, number]}
     */
    function getNodeAtOffset(root, offset) {
      const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

      while (treeWalker.nextNode()) {
        const node = /** @type {Text} */ (treeWalker.currentNode);
        if (node.parentElement instanceof HTMLSpanElement) {
          const it = node.data;
          if (offset > it.length) {
            offset -= it.length;
          } else {
            return [node, offset];
          }
        }
      }
      return [null, -1];
    }
    if (!this.highlightWords.value) {
      return;
    }
    const element = document.getElementById(this.id);
    if (!element) {
      return;
    }
    const span = element.querySelector("button span");
    if (!span) {
      return;
    }
    const [text, offset] = getNodeAtOffset(element, event.charIndex);
    if (!text) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    if (event.type == "boundary") {
      try {
        selection.setBaseAndExtent(text, offset, text, offset);
        selection.modify("extend", "forward", "word");
      } catch (e) {
        console.error(e);
      }
    } else if (event.type == "end") {
      selection.empty();
    }
  }

  init() {
    document.addEventListener("boundary", this);
    document.addEventListener("end", this);
    window.addEventListener("resize", () => this.fitText());
  }
}
TreeBase.register(Display, "Display");
