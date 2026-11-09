import { html, render } from "uhtml";
import { TreeBase } from "./treebase";
import { DesignerPanel } from "./designer";
import * as Props from "./props";
import db from "app/db";
import "css/content.css";
import pleaseWait from "./wait";
import Globals from "app/globals";
import { fileOpen } from "browser-fs-access";
import { aiJSON, aiReady, aiKeyPhrase, AIError } from "./ai";
import { aiSettings, voiceSettings } from "./ai/settings";

/** Depth-first search for a node with the given className
 * @param {any} node @param {string} cls */
function findNode(node, cls) {
  if (node.className === cls) return node;
  for (const child of node.children || []) {
    const found = findNode(child, cls);
    if (found) return found;
  }
  return null;
}

/** Pick grid dimensions that fit count items
 * @param {number} count */
function gridDims(count) {
  const columns = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(count))));
  const rows = Math.max(1, Math.ceil(count / columns));
  return { rows, columns };
}

/** Build a Grid spec with optional filters
 * @param {number} count - items the grid must fit
 * @param {string} scale
 * @param {{field: string, operator: string, value: string}[]} filters
 */
function gridSpec(count, scale, filters = []) {
  const { rows, columns } = gridDims(count);
  return {
    className: "Grid",
    props: { rows, columns, name: "grid", background: "white", fillItems: true, scale },
    children: (filters.length ? filters : [{}]).map((props) => ({
      className: "GridFilter",
      props,
      children: [],
    })),
  };
}

export class Content extends DesignerPanel {
  name = new Props.String("Content");

  lastFocused = this.id;

  /** @type {{ current: number, total: number } | null} */
  _uploadState = null;

  /** Current page for media list pagination (50 items per page) */
  _mediaPage = 1;

  // ── AI generation state ──────────────────────────────────────────────────
  _aiDescription = "";
  /** @type {"" | "loading" | "error" | "success"} */
  _aiStatus = "";
  _aiError = "";
  /** The Home screen's "Generate with AI" choice sets this flag before
   * navigating here; consume it so the generator opens ready to type into */
  _aiOpenRequested = !!localStorage.getItem("osdpi-open-ai-generator");
  /** Short description of the layout the last generation built */
  _aiLayoutNote = "";
  /** Note about auto-switch hints in the last generation */
  _aiNextNote = "";
  /** After AI generation, rebuild the board to fit the generated rows.
   * Uses a Display message strip plus, when the vocabulary is organised
   * into categories, a TabControl (one tab per category) or a Radio
   * category filter above a filtered Grid.
   * @param {Row[]} rows
   * @param {"tabs" | "categories" | "simple"} style
   * @returns {Promise<string>} a short note describing the layout built
   */
  async _buildLayout(rows, style) {
    const page = findNode(Globals.layout, "Page");
    if (!page) return "";

    /** @type {Map<string, number>} items per category, in first-seen order */
    const categories = new Map();
    for (const row of rows) {
      const cat = String(row.category || "").trim();
      if (cat) categories.set(cat, (categories.get(cat) || 0) + 1);
    }
    if (categories.size < 2 || categories.size > 8) style = "simple";

    // Message window plus a Clear button: words accumulate in the Display,
    // pressing it speaks the sentence, Clear starts over. Listening is
    // toggled from speechSuggestions.js's own floating mic icon, not a
    // board button — the board's "suggestions" grid (below) makes it show
    // that icon instead of the full generic bar.
    const display = {
      className: "Stack",
      props: { direction: "row", background: "", scale: "1" },
      children: [
        {
          className: "Display",
          props: {
            stateName: "$Display",
            Name: "display",
            background: "white",
            fontSize: "2",
            scale: "5",
          },
          children: [],
        },
        {
          className: "Button",
          props: { label: "Clear", name: "clear", background: "", scale: "1" },
          children: [],
        },
      ],
    };

    // Live suggestions region: while the speaker is listening
    // (speechSuggestions.js), AI conversation suggestions continuously
    // refresh these rows; the rest of the board is left alone.
    // Starts at scale 0 (collapsed) — speechSuggestions expands it when
    // suggestions arrive and collapses it again when the mic stops.
    const suggestionStrip = {
      className: "Grid",
      props: {
        rows: 2,
        columns: 3,
        name: "suggestions",
        background: "white",
        fillItems: true,
        scale: "0",
      },
      children: [
        {
          className: "GridFilter",
          props: { field: "#suggestion", operator: "equals", value: "'1'" },
          children: [],
        },
      ],
    };

    /** @type {object[]} */
    let children;
    let note;
    if (style === "tabs") {
      const tabs = {
        className: "TabControl",
        props: { stateName: "$tab", name: "tabs", tabEdge: "top", scale: "5" },
        children: [...categories.entries()].map(([cat, count]) => ({
          className: "TabPanel",
          props: { name: cat, label: cat, background: "" },
          children: [
            gridSpec(count, "1", [
              { field: "#category", operator: "equals", value: `'${cat}'` },
            ]),
          ],
        })),
      };
      children = [display, suggestionStrip, tabs];
      note = `in ${categories.size} tab pages`;
    } else if (style === "categories") {
      // Radio buttons are capped at 45% width (radio.css), so only 2 fit per
      // row — give it enough scale to fit every row, or extra rows get
      // clipped and painted over by the grid below. Half a unit per row
      // keeps them tappable without crowding out the live suggestions.
      const radioRows = Math.ceil(categories.size / 2);
      const radio = {
        className: "Radio",
        props: {
          stateName: "$category",
          label: "",
          scale: String(Math.max(1, radioRows / 2)),
        },
        children: [...categories.keys()].map((cat) => ({
          className: "Option",
          props: { name: cat, value: cat },
          children: [],
        })),
      };
      const maxCount = Math.max(...categories.values());
      children = [
        display,
        suggestionStrip,
        radio,
        gridSpec(maxCount, "3.5", [
          { field: "#category", operator: "equals", value: "$category" },
        ]),
      ];
      note = `with a ${categories.size}-category filter`;
    } else {
      children = [
        display,
        suggestionStrip,
        // exclude the live suggestion rows — they render in the strip above
        gridSpec(rows.length, "4", [
          { field: "#suggestion", operator: "empty", value: "" },
        ]),
      ];
      note = "in a simple grid";
    }

    // Replace the visual children of the Page with the new layout
    const visualClasses = new Set([
      "Stack", "Display", "TabControl", "Grid", "Radio", "Gap", "Button", "VSD",
    ]);
    for (const child of [...page.children]) {
      if (visualClasses.has(child.className)) child.remove();
    }
    for (const child of children) {
      TreeBase.fromObject(child, page);
    }

    await db.write("layout", Globals.layout.toObject({ omittedProps: [] }));
    Globals.layout.update();
    return note;
  }

  /** Add a Speech component + the sentence-building actions:
   * grid presses speak the word and append it to the message window,
   * pressing the message window speaks the whole sentence, and the
   * Clear button empties it.
   */
  _setupActions() {
    // Add Speech component to the Page if absent
    const page = findNode(Globals.layout, "Page");
    if (page && !page.children.some((c) => c.className === "Speech")) {
      TreeBase.fromObject(
        { className: "Speech", props: { stateName: "$Speak" }, children: [] },
        page,
      );
      db.write("layout", Globals.layout.toObject({ omittedProps: [] }));
    }

    if (!Globals.actions) return;

    // Replace rules from earlier generations — only the first matching rule
    // fires, so a leftover "*" rule would shadow the new ones. "listen" is
    // kept here so boards generated by an earlier version (which had an
    // on-board Listen button) get that now-unused rule cleaned up too.
    const generatedOrigins = new Set([
      "*",
      "grid",
      "display",
      "clear",
      "suggestions",
      "listen",
    ]);
    for (const rule of [...Globals.actions.children]) {
      if (
        rule.className === "Action" &&
        generatedOrigins.has(rule.origin?.value)
      )
        rule.remove();
    }

    const rules = [
      // ready-made phrases are complete utterances: speak and show as-is,
      // same as live suggestions, instead of accumulating word-by-word
      {
        origin: "grid",
        condition: "#category='Phrases'",
        updates: [
          ["$Speak", "#label"],
          ["$Display", "#label"],
        ],
      },
      // items tagged with a "next" category also switch the board there,
      // saving the user a navigation step ($category drives the Radio
      // filter, $tab the TabControl — whichever the layout uses)
      {
        origin: "grid",
        condition: "#next",
        updates: [
          ["$Speak", "#label"],
          ["$Display", "add_word(#label)"],
          ["$category", "#next"],
          ["$tab", "#next"],
        ],
      },
      {
        origin: "grid",
        condition: "",
        updates: [
          ["$Speak", "#label"],
          ["$Display", "add_word(#label)"],
        ],
      },
      { origin: "display", condition: "$Display", updates: [["$Speak", "$Display"]] },
      { origin: "clear", condition: "", updates: [["$Display", "''"]] },
      // suggestions are complete utterances: speak and show as-is
      {
        origin: "suggestions",
        condition: "",
        updates: [
          ["$Speak", "#label"],
          ["$Display", "#label"],
        ],
      },
    ];
    for (const rule of rules) {
      TreeBase.fromObject(
        {
          className: "Action",
          props: { origin: rule.origin },
          children: [
            {
              className: "ActionCondition",
              props: { Condition: rule.condition },
              children: [],
            },
            ...rule.updates.map(([stateName, newValue]) => ({
              className: "ActionUpdate",
              props: { stateName, newValue },
              children: [],
            })),
          ],
        },
        Globals.actions,
      );
    }
    db.write("actions", Globals.actions.toObject({ omittedProps: [] }));
  }

  /** Derive auto-switch hints from example sentences.
   *
   * Asking a model to tag "which category follows this word" directly
   * produces relatedness guesses (sunny → other weather adjectives).
   * Writing sentences is a task models do reliably, so instead: get
   * example sentences built only from the board's words, then derive each
   * word's hint mechanically — majority vote over the category of the word
   * that actually follows it. Sentence-final words naturally get no hint.
   *
   * Mutates rows in place; returns how many hints were applied.
   * @param {Row[]} rows
   * @returns {Promise<number>}
   */
  async _fetchNextHints(rows) {
    try {
      const words = rows.map((r) => `"${r.label}" (${r.category})`).join(", ");
      const prompt =
        `These words are on an AAC communication board: ${words}\n\n` +
        `Write about 15 short, natural sentences someone would actually say out loud, ` +
        `each built ONLY from these exact words, in speaking order. ` +
        `Cover as many of the words as you can across the sentences.\n` +
        `Return JSON: {"sentences": [["I like", "sunny", "days"], ...]} — ` +
        `each sentence is an array whose elements are words from the list, copied exactly.`;

      const parsed = await aiJSON({ prompt });
      const sentences = parsed.sentences;
      if (!Array.isArray(sentences)) return 0;

      // Majority vote: for each word, which category actually follows it?
      const byLabel = new Map(
        rows.map((r) => [String(r.label).trim().toLowerCase(), r]),
      );
      /** @type {Map<string, Map<string, number>>} */
      const votes = new Map();
      for (const sentence of sentences) {
        if (!Array.isArray(sentence)) continue;
        for (let i = 0; i + 1 < sentence.length; i++) {
          const a = byLabel.get(String(sentence[i]).trim().toLowerCase());
          const b = byLabel.get(String(sentence[i + 1]).trim().toLowerCase());
          if (!a || !b || !b.category) continue;
          let v = votes.get(a.label);
          if (!v) votes.set(a.label, (v = new Map()));
          v.set(b.category, (v.get(b.category) || 0) + 1);
        }
      }
      let count = 0;
      for (const row of rows) {
        const v = votes.get(row.label);
        if (!v) continue;
        const best = [...v.entries()].sort((x, y) => y[1] - x[1])[0];
        if (best) {
          row.next = best[0];
          count++;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  async _generateWithAI() {
    if (!aiReady()) {
      this._aiError = `This needs ${aiKeyPhrase()}. Add it under "AI service" below.`;
      this._aiStatus = "error";
      Globals.state.update();
      return;
    }
    if (!this._aiDescription.trim()) {
      this._aiError = "Tell me what board you want to create.";
      this._aiStatus = "error";
      Globals.state.update();
      return;
    }
    if (Globals.data.length > 0) {
      if (
        !window.confirm(
          `This will replace your current ${Globals.data.length} rows and rebuild the board layout with AI-generated content. Continue?`,
        )
      )
        return;
    }

    this._aiStatus = "loading";
    this._aiError = "";
    Globals.state.update();

    try {
      const prompt =
        `You are helping build an AAC (Augmentative and Alternative Communication) board.\n` +
        `The user said: "${this._aiDescription.trim()}"\n\n` +
        `Generate vocabulary items for this board. ` +
        `Unless the user specified a different number, generate about 20 items. ` +
        `Return a JSON object shaped like {"layout": "...", "items": [{"label": "...", "category": "..."}, ...]}. ` +
        `"label" is the 1–3 words shown on the button; "category" groups related items. ` +
        `Set "layout" based on board size — every extra press costs an AAC user real effort, so hide vocabulary behind navigation only when a flat grid would get crowded: ` +
        `"simple" — one flat grid with no categories; use when there are about 16 items or fewer so all vocabulary is visible and speakable in one press. ` +
        `"categories" — a row of category filter buttons above one grid; prefer this for larger boards whose items group naturally (e.g. People, Phrases, Places, Reactions — even a single subject usually splits this way). ` +
        `"tabs" — categories shown as separate tab pages; use only for big boards (30+ items) with clearly distinct groups. ` +
        `When layout is "tabs" or "categories", give every item a category and use 2–8 short category names. ` +
        `Choose the words so they chain into natural sentences (starters, describing words, things, time words). ` +
        `Make vocabulary functional and appropriate for AAC users.\n\n` +
        `Also include 4–8 extra items with category exactly "Phrases" — each one a complete, ` +
        `ready-to-speak short sentence about the topic (up to about 6 words), e.g. "I love the Bills" ` +
        `or "Did you watch the game?". These are spoken whole when pressed, not built word-by-word like ` +
        `the other items, so users who don't want to build a sentence word-by-word can just tap one.`;

      const parsed = await aiJSON({ prompt });

      // Handle {"items":[...]} or {"vocabulary":[...]} or a direct array
      const rawRows = Array.isArray(parsed)
        ? parsed
        : parsed.items ??
          parsed.vocabulary ??
          Object.values(parsed).find((v) => Array.isArray(v));
      if (!Array.isArray(rawRows)) throw new Error("AI returned unexpected format");

      // Normalize: labels are strings; categories are trimmed with quotes
      // stripped so they can appear in GridFilter expressions.
      const rows = rawRows
        .map((r) => (typeof r === "string" ? { label: r } : r))
        .filter((r) => r && typeof r === "object" && r.label)
        .map((r) => {
          const row = { ...r, label: String(r.label) };
          if (row.category)
            row.category = String(row.category).replace(/'/g, "").trim();
          return row;
        });
      if (!rows.length) throw new Error("AI returned no usable items");

      // Normalize casing so the "speak-whole-sentence" action rule (and the
      // category filters) can match this category name exactly.
      for (const row of rows) {
        if (String(row.category || "").trim().toLowerCase() === "phrases") {
          row.category = "Phrases";
        }
      }
      const hasPhrases = rows.some((r) => r.category === "Phrases");

      /** @type {"tabs" | "categories" | "simple"} */
      let style = ["tabs", "categories"].includes(parsed.layout)
        ? parsed.layout
        : "simple";
      // Ready-made phrases need their own filterable section even when the
      // rest of the vocabulary is flat enough for a simple grid.
      if (hasPhrases && style === "simple") style = "categories";
      if (style !== "simple") {
        // Every row needs a category or it would be hidden by the filters
        for (const row of rows) if (!row.category) row.category = "More";
      }

      // Auto-switch hints come only from the sentence-derivation pass —
      // drop any inline guesses the model may have added.
      for (const row of rows) delete row.next;
      const categoryCount = new Set(
        rows.map((r) => r.category).filter(Boolean),
      ).size;
      let nextHints = 0;
      if (categoryCount >= 2) {
        // Phrases are already complete sentences — they don't need (or
        // benefit from) an auto-switch hint of their own.
        nextHints = await this._fetchNextHints(
          rows.filter((r) => r.category !== "Phrases"),
        );
      }
      console.log("AI board generation:", { layout: parsed.layout, nextHints, rows });
      this._aiNextNote =
        (nextHints > 0 ? `, auto-switching after ${nextHints} words` : "") +
        (hasPhrases ? ", plus a Phrases section of ready-made sentences" : "");

      Globals.data.setContent(rows);
      await db.write("content", rows);

      this._aiLayoutNote = await this._buildLayout(rows, style);
      this._setupActions();

      this._aiStatus = "success";
      Globals.state.update();
    } catch (/** @type {any} */ err) {
      this._aiError =
        err instanceof AIError && err.kind === "auth"
          ? `${err.message} Check it under "AI service" below.`
          : err.message || "Unknown error";
      this._aiStatus = "error";
      Globals.state.update();
    }
  }

  /** Delete the media files that are checked */
  async deleteSelected() {
    // list the names that are checked
    const toDelete = [
      ...document.querySelectorAll(
        "#ContentMedia input[type=checkbox]:checked",
      ),
    ].map((element) => {
      // clear the checks as we go
      const checkbox = /** @type{HTMLInputElement} */ (element);
      checkbox.checked = false;
      return checkbox.name;
    });
    const selectAll = /** @type {HTMLInputElement} */ (
      document.getElementById("ContentSelectAll")
    );
    if (selectAll) selectAll.checked = false;
    // delete them
    await pleaseWait(db.deleteMedia(...toDelete));
    // refresh the page
    Globals.state.update();
  }

  /** Open a file picker and load selected media into the design */
  async loadMedia() {
    try {
      const files = await fileOpen({
        description: "Media files",
        mimeTypes: ["image/*", "audio/*", "video/mp4", "video/webm"],
        multiple: true,
      });
      this._mediaPage = 1; // reset pagination when new media is loaded
      this._uploadState = { current: 0, total: files.length };
      Globals.state.update();
      for (const file of files) {
        await db.addMedia(file, file.name);
        if (file.type.startsWith("image/")) {
          for (const img of document.querySelectorAll(
            `img[dbsrc="${file.name}"]`,
          )) {
            /** @type {ImgDb} */ (img).refresh();
          }
        }
        if (file.type.startsWith("video/")) {
          for (const video of document.querySelectorAll(
            `video[dbsrc="${file.name}"]`,
          )) {
            /** @type {ImgDb} */ (video).refresh();
          }
        }
        this._uploadState.current++;
        Globals.state.update();
      }
      this._uploadState = null;
    } catch {
      // ignore cancel
      this._uploadState = null;
    }
    Globals.state.update();
  }

  /** Check or uncheck all the media file checkboxes */
  selectAll({ target }) {
    for (const element of document.querySelectorAll(
      '#ContentMedia input[type="checkbox"]',
    )) {
      const checkbox = /** @type {HTMLInputElement} */ (element);
      checkbox.checked = target.checked;
    }
  }

  settings() {
    const data = Globals.data;
    return html`<div class=${this.CSSClasses("content")} id=${this.id}>
      <div>
        <h1>Content</h1>
        <details class="panel-help">
          <summary>About the Content tab</summary>
          <div class="panel-help-body">
            <p>The Content tab manages two kinds of data used by your board:</p>
            <ul>
              <li><strong>Spreadsheet rows</strong> — each row drives one button in a Grid component. Load a <code>.csv</code>, <code>.xlsx</code>, or <code>.ods</code> file via <strong>File → Load Sheet</strong>. Fields become available as <code>#fieldName</code> in Actions and Patterns.</li>
              <li><strong>Media files</strong> — images, audio, and video shown on buttons. Load files below, then drag any item onto a button on the canvas to assign it.</li>
            </ul>
            <p>Use <strong>File → Save sheet</strong> to export the current spreadsheet. Use <strong>File → Save logs (CSV)</strong> to export any logger data.</p>
          </div>
        </details>
        <section class="content-section">
        <h2>Spreadsheet rows</h2>
        <p class="content-rows-summary">
          ${data.length
            ? `${data.length} rows with these fields: ${String([...data.allFields].sort()).replaceAll(",", ", ")}`
            : "No rows loaded — use File → Load Sheet, or generate a board below."}
        </p>
        <details
          class="ai-section"
          ?open=${this._aiStatus === "error" || this._aiOpenRequested}
        >
          <summary>✨ Generate with AI</summary>
          <div class="ai-body">
            <textarea
              class="ai-input ai-textarea"
              placeholder="e.g. create a board for a conversation about the Buffalo Bills"
              .value=${this._aiDescription}
              @input=${(/** @type {InputEvent} */ e) => {
                this._aiDescription = /** @type {HTMLTextAreaElement} */ (e.target).value;
              }}
              @keydown=${(/** @type {KeyboardEvent} */ e) => {
                if (e.key === "Enter" && !e.shiftKey && this._aiStatus !== "loading") {
                  e.preventDefault();
                  this._generateWithAI();
                }
              }}
            ></textarea>

            <button
              class="ai-generate-btn"
              ?disabled=${this._aiStatus === "loading"}
              @click=${() => this._generateWithAI()}
            >
              ${this._aiStatus === "loading" ? "Generating…" : "✨ Generate"}
            </button>

            <p class="ai-key-note">The AI key is under Keys, below.</p>

            ${this._aiStatus === "error"
              ? html`<p class="ai-error">⚠ ${this._aiError}</p>`
              : html``}
            ${this._aiStatus === "success"
              ? html`<p class="ai-success">
                  ✓ Generated ${Globals.data.length} rows${this._aiLayoutNote
                    ? ` ${this._aiLayoutNote}`
                    : ""}${this._aiNextNote}. Check the row count above.
                </p>`
              : html``}
          </div>
        </details>
        </section>

        <section class="content-section content-keys">
        <h2>Keys</h2>
        <p class="ai-key-note">
          Free keys for the AI features and for more voices. They stay on
          this device and are never saved in a design.
        </p>
        ${aiSettings()} ${voiceSettings()}
        </section>

        <section class="content-section">
        <h2>Media files</h2>
        <div class="content-media-tip">
          <strong>How to add images or audio to a button:</strong>
          <ol>
            <li>Click <strong>Load media</strong> below to import image or audio files</li>
            <li>Drag any item from the list onto a button in your board to assign it</li>
          </ol>
        </div>
        <div class="content-media-actions">
          <button class="content-load-media-btn" @click=${this.loadMedia.bind(this)}>+ Load media</button>
          <button @click=${this.deleteSelected}>Delete checked</button>
          <label class="content-select-all">
            <input
              type="checkbox"
              name="Select all"
              id="ContentSelectAll"
              @input=${this.selectAll}
            />
            Select All
          </label>
        </div>
        ${this._uploadState !== null
          ? html`<div class="content-upload-progress">
              <span
                >Uploading ${this._uploadState.current} of
                ${this._uploadState.total}…</span
              >
              <progress
                max=${this._uploadState.total}
                value=${this._uploadState.current}
              ></progress>
            </div>`
          : html``}
        <div
          ref=${(ol) => {
            const self = this;
            db.listMedia().then((names) => {
              const pageSize = 50;
              const visible = names.slice(0, self._mediaPage * pageSize);
              const remaining = names.length - visible.length;
              const list = visible.map((name) => {
                let preview;
                if (/\.(mp3|aac|wav|oga|weba)$/i.test(name)) {
                  preview = html`<div class="media-type-icon">🎵</div>`;
                } else if (/\.(mp4|webm)$/i.test(name)) {
                  preview = html`<div class="media-type-icon">🎬</div>`;
                } else {
                  // .draggable=false prevents the browser's default image-drag
                  // from firing before our li-level handler can set the custom
                  // MIME type.
                  preview = html`<img
                    is="img-db"
                    dbsrc=${name}
                    alt=${name}
                    .draggable=${false}
                  />`;
                }
                return html`<li
                  .draggable=${true}
                  @dragstart=${(/** @type {DragEvent} */ e) => {
                    if (
                      /** @type {HTMLElement} */ (e.target).tagName ===
                      "INPUT"
                    ) {
                      e.preventDefault();
                      return;
                    }
                    if (!e.dataTransfer) return;
                    e.dataTransfer.setData("application/x-osdpi-media", name);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <label>
                    <figure>${preview}</figure>
                    <div class="media-meta">
                      <input type="checkbox" name=${name} />
                      <span class="media-name" title=${name}>${name}</span>
                    </div>
                  </label>
                </li>`;
              });
              const loadMore =
                remaining > 0
                  ? html`<button
                      class="content-load-more-btn"
                      @click=${() => {
                        self._mediaPage++;
                        Globals.state.update();
                      }}
                    >
                      Load more (${remaining} remaining)
                    </button>`
                  : html``;
              render(ol, html`<ol id="ContentMedia">${list}</ol>${loadMore}`);
            });
          }}
        ></div>
        </section>
      </div>
    </div>`;
  }
  /**
   * Merge an object into the panel contents
   * @param {ExternalRep} obj
   * @returns {Promise<void>}
   */
  async merge(obj) {
    console.assert(obj.className == "Content", obj);
    const toMerge = obj.children;
    Globals.data.setContent(Globals.data.contentRows.concat(toMerge));
    db.write("content", Globals.data.contentRows);
    this.onUpdate();
  }
}
TreeBase.register(Content, "Content");
