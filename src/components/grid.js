import { html } from "uhtml";
import * as Props from "./props";
import { TreeBase } from "./treebase";
import { GridFilter } from "./gridFilter";
import { styleString, readableTextColor } from "./style";
import { formatSlottedString } from "./slots";
import Globals from "app/globals";
import db from "app/db";
import { fileOpen } from "browser-fs-access";
import { findPictogram, isPictogram, pictureChoices } from "./pictograms";
import { boards, setSquareLink, showBoard } from "./pieces";
import { Tones, sayLikeButton } from "./speech";
import "css/grid.css";

/**
 * Return an image or video element given the name + parameters
 * like "foo.mp4 autoplay loop".
 * @param {string} src
 * @param {string} title
 * @param {null|function():void} onload
 * @returns {Hole}
 */
export function imageOrVideo(src, title, onload = null) {
  const match = /(?<src>.*\.(?:mp4|webm))(?<options>.*$)/.exec(src);

  if (match && match.groups) {
    // video
    const options = match.groups.options;
    const vsrc = match.groups.src;
    return html`<video
      is="video-db"
      dbsrc=${vsrc}
      title=${title}
      ?loop=${options.indexOf("loop") >= 0}
      ?autoplay=${options.indexOf("autoplay") >= 0}
      ?muted=${options.indexOf("muted") >= 0}
      @load=${onload}
    />`;
  } else {
    // image
    return html`<img
      is="img-db"
      dbsrc=${src}
      title=${title}
      @load=${onload}
    />`;
  }
}

/** The grid whose picture choices are showing, so a click elsewhere can
 * close them
 * @type {Grid | null} */
let openPicker = null;

document.addEventListener("pointerdown", (event) => {
  if (!openPicker?._picturePick) return;
  const target = /** @type {Element} */ (event.target);
  // clicks inside the choices, or on a picture (which reopens them), stay
  if (target.closest?.(".picture-popover, .grid button")) return;
  openPicker.closePictures();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") openPicker?.closePictures();
});

class Grid extends TreeBase {
  fillItems = new Props.Boolean(true, {
    title: "When on, buttons fill left-to-right in order. Turn off to set each button's exact row/column position.",
  });
  fullSize = new Props.Boolean(false, {
    title: "When buttons are placed by position, show all the rows and columns, even empty ones",
  });
  rows = new Props.Integer(3, { min: 1, title: "Number of rows in the grid" });
  columns = new Props.Integer(3, { min: 1, title: "Number of columns in the grid" });
  scale = new Props.Float(1);
  name = new Props.String("grid");
  background = new Props.Color("white");
  tone = new Props.String("", {
    title: "How every word here is said: Calm, Urgent, Angry or Sarcastic (empty for the tone buttons' choice)",
  });
  buttonColor = new Props.String("", {
    title: 'The buttons\' color: empty for the grid\'s own color, "none" for plain buttons, or any color',
  });
  spacing = new Props.Integer(3, {
    min: 0,
    max: 40,
    title: "Space between the buttons, in pixels",
  });

  allowedChildren = ["GridFilter"];

  /** @type {GridFilter[]} */
  children = [];

  page = 1;
  pageBoundaries = { 0: 0 }; //track starting indices of pages

  /** The cell being typed into in the designer: which cell (by position on
   * this page), the row it edits (-1 for a new word) and the text so far
   * @type {{key: string, absIdx: number, row: number, column: number, text: string, opened: number} | null} */
  _editCell = null;

  /** Open the in-place text box on a cell (designer only)
   * @param {number} row
   * @param {number} column
   * @param {number} absIdx - the row being renamed, or -1 to add a word
   * @param {string} text
   */
  startEditing(row, column, absIdx, text) {
    if (!Globals.state?.get("editing")) return;
    this._picturePick = null;
    const opened = performance.now();
    this._editCell = { key: `${row},${column}`, absIdx, row, column, text, opened };
    Globals.state.update();
  }

  /**
   * Choose a picture from the computer for a cell (designer, double-click):
   * an empty cell gets a new button named after the file, a word keeps its
   * word and gets the picture. Must be called from the click itself, so
   * the browser allows the file chooser.
   * @param {number} absIdx - the button's row, or -1 for an empty cell
   * @param {number} row
   * @param {number} column
   */
  async pickPicture(absIdx, row, column) {
    this._editCell = null;
    this._picturePick = null;
    let file;
    try {
      file = await fileOpen({ description: "Pictures", mimeTypes: ["image/*"] });
    } catch {
      Globals.state.update(); // chooser closed without a picture
      return;
    }
    await db.addMedia(file, file.name);
    await this.assignMediaToCell(absIdx, file.name, row, column);
  }

  /** Empty cells on the page last drawn, in reading order, so typing can
   * move on to the next one
   * @type {[number, number][]} */
  _emptyCells = [];

  /** The rows and columns last drawn */
  _shape = { rows: 1, columns: 1 };

  /** Save what was typed: a new word becomes a button, a renamed button
   * keeps its picture, and clearing the text removes the button. After
   * Enter on a new word the next empty cell opens, so a list of words can
   * be typed in one go.
   * @param {boolean} [keepTyping]
   */
  async finishEditing(keepTyping = false) {
    const edit = this._editCell;
    if (!edit) return;
    this._editCell = null;
    const label = edit.text.trim();

    if (edit.absIdx < 0) {
      if (label) {
        await this.addWords([label], edit.row, edit.column, keepTyping);
      } else {
        Globals.state.update();
      }
      return;
    }

    const { data } = Globals;
    const rows = [...data.contentRows];
    const target = data.getMatchingRows(this.children, false)[edit.absIdx];
    const index = rows.indexOf(target);
    // predicted words and notes aren't board content; leave them be
    if (index < 0 || label === String(target.label ?? "")) {
      Globals.state.update();
      return;
    }
    /** @type {Row[]} */
    const changed = [];
    if (label) {
      rows[index] = { ...target, label };
      // a picture found for the old word is wrong for the new one; one
      // the student chose stays
      if (!target.symbol || isPictogram(String(target.symbol))) {
        changed.push(rows[index]);
      }
    } else {
      rows.splice(index, 1);
    }
    data.setContent(rows);
    await db.write("content", rows);
    Globals.state.update();
    this.addPictures(changed);
  }

  /** Add words as buttons, starting at the cell that was clicked and going
   * on through the empty cells after it
   * @param {string[]} labels
   * @param {number} row
   * @param {number} column
   * @param {boolean} keepTyping - open the next empty cell afterwards
   */
  async addWords(labels, row, column, keepTyping) {
    const { data } = Globals;
    const empties = this._emptyCells;
    // a word typed into a square past the next one in line goes where it
    // was typed, so the grid switches to placing words by position
    if (empties.findIndex(([r, c]) => r === row && c === column) > 0) {
      await this.placeByPosition();
    }
    // buttons fill in order: new words take the first empty cells
    let start = 0;
    if (!this.fillItems.value) {
      // placed by position: start at the clicked cell
      start = Math.max(
        0,
        empties.findIndex(([r, c]) => r === row && c === column),
      );
    }
    /** @type {number[][]} */
    const positions = empties.slice(start, start + labels.length);
    // past the end of this page, positioned words go on new pages
    let page = Math.max(
      this.page,
      ...data.getMatchingRows(this.children, false).map((r) => +(r.page || 1)),
    );
    const { rows: height, columns: width } = this._shape;
    for (let i = 0; positions.length < labels.length; i++) {
      if (i % (height * width) === 0) page++;
      const cell = i % (height * width);
      positions.push([Math.floor(cell / width) + 1, (cell % width) + 1, page]);
    }

    const added = labels.map((label, i) => {
      const [r, c, p = this.page] = positions[i];
      return this.newRow(label, r, c, p);
    });
    const rows = [...data.contentRows, ...added];
    data.setContent(rows);
    await db.write("content", rows);

    if (this.fillItems.value) {
      await this.growFor(data.getMatchingRows(this.children, false).length);
      // the next empty square after the words, once it is drawn
      this._typeNext = keepTyping;
      Globals.state.update();
      this.addPictures(added);
      return;
    }
    const next = empties[start + labels.length];
    // keep one empty square to spare, as a grid filling in order does
    if (this.fullSize.value && !empties[start + labels.length]) {
      const { rows: height, columns: width } = this._shape;
      await this.growFor(height * width);
      this._typeNext = keepTyping;
    }
    if (keepTyping && next) {
      this._editCell = {
        key: `${next[0]},${next[1]}`,
        absIdx: -1,
        row: next[0],
        column: next[1],
        text: "",
        opened: 0, // opened by Enter, not a click
      };
    }
    Globals.state.update();
    this.addPictures(added);
  }

  /** Switch from filling in order to placing words by position, leaving
   * every word in the square it is shown in now and keeping the grid's
   * size, so words can then go in any square */
  async placeByPosition() {
    if (!this.fillItems.value) return;
    const { data } = Globals;
    const rows = Math.max(1, this.rows.value);
    const columns = Math.max(1, this.columns.value);
    const words = data.getMatchingRows(this.children, false);
    // the same squares template() draws them in
    let perPage = rows * columns;
    if (words.length > perPage) perPage--;
    const content = [...data.contentRows];
    words.forEach((word, i) => {
      const index = content.indexOf(word);
      if (index < 0) return; // predicted words and notes aren't board content
      const cell = i % perPage;
      const page = Math.floor(i / perPage) + 1;
      const { page: _, ...rest } = word;
      content[index] = {
        ...rest,
        row: Math.floor(cell / columns) + 1,
        column: (cell % columns) + 1,
        ...(page > 1 ? { page } : {}),
      };
    });
    data.setContent(content);
    await db.write("content", content);
    this.fillItems.set(false);
    this.fullSize.set(true);
    // save without moving focus off the square being typed in
    await Globals.layout.doUpdate(true);
  }

  /** Open the text box on the first empty square at the next drawing */
  _typeNext = false;

  /**
   * Grow the grid so all its words fit with one empty square to spare
   * (widening first, as boards are wider than tall), up to 8 × 8; beyond
   * that it gets pages.
   * @param {number} count
   */
  async growFor(count) {
    let rows = this.rows.value;
    let columns = this.columns.value;
    while (rows * columns < count + 1) {
      if (columns <= rows + 1 && columns < 8) columns++;
      else if (rows < 8) rows++;
      else break;
    }
    if (rows === this.rows.value && columns === this.columns.value) return;
    this.rows.set(rows);
    this.columns.set(columns);
    // save without moving focus off the square being typed in
    await Globals.layout.doUpdate(true);
  }

  /** The picture choices showing for a word on the board (designer)
   * @type {{absIdx: number, row: number, column: number, label: string, choices: string[] | null} | null} */
  _picturePick = null;

  /** Show picture choices for a word, next to it on the board
   * @param {number} absIdx
   * @param {number} row
   * @param {number} column
   * @param {string} label
   */
  async openPictures(absIdx, row, column, label) {
    this._editCell = null;
    const pick = { absIdx, row, column, label, choices: /** @type {string[] | null} */ (null) };
    this._picturePick = pick;
    openPicker = this;
    Globals.state.update();
    const { choices } = await pictureChoices([label]);
    if (this._picturePick !== pick) return;
    pick.choices = choices.get(label) ?? [];
    Globals.state.update();
  }

  closePictures() {
    if (!this._picturePick) return;
    this._picturePick = null;
    Globals.state.update();
  }

  /** Use a picture (or none) for a word
   * @param {number} absIdx
   * @param {string} symbol */
  async setPicture(absIdx, symbol) {
    this._picturePick = null;
    const { data } = Globals;
    const target = data.getMatchingRows(this.children, false)[absIdx];
    const rows = [...data.contentRows];
    const index = rows.indexOf(target);
    if (index >= 0) {
      const { symbol: _old, ...rest } = target;
      rows[index] = symbol ? { ...rest, symbol } : rest;
      data.setContent(rows);
      await db.write("content", rows);
    }
    Globals.state.update();
  }

  /** Set or clear one field of a word, like how it is said
   * @param {number} absIdx
   * @param {string} field
   * @param {string} value - "" clears it */
  async setWordField(absIdx, field, value) {
    const { data } = Globals;
    const target = data.getMatchingRows(this.children, false)[absIdx];
    const rows = [...data.contentRows];
    const index = rows.indexOf(target);
    if (index < 0 || String(target[field] ?? "") === value) return;
    const { [field]: _old, ...rest } = target;
    rows[index] = value ? { ...rest, [field]: value } : rest;
    data.setContent(rows);
    await db.write("content", rows);
    Globals.state.update();
  }

  /** The picture choices, floating by the word's square */
  picturePopover() {
    const pick = /** @type {NonNullable<Grid["_picturePick"]>} */ (this._picturePick);
    const { rows, columns } = this._shape;
    const row = Globals.data.getMatchingRows(this.children, false)[pick.absIdx];
    const current = String(row?.symbol ?? "");
    const link = String(row?.link ?? "");
    // below the square in the top half, above it in the bottom half, and
    // kept inside the grid sideways
    /** @type {Partial<CSSStyleDeclaration>} */
    const style = {};
    if (pick.row <= rows / 2) style.top = `${(100 * pick.row) / rows}%`;
    else style.bottom = `${(100 * (rows - pick.row + 1)) / rows}%`;
    if (pick.column <= columns / 2) style.left = `${(100 * (pick.column - 1)) / columns}%`;
    else style.right = `${(100 * (columns - pick.column)) / columns}%`;

    return html`<div
      class="picture-popover"
      style=${styleString(style)}
      role="dialog"
      aria-label=${`Settings for ${pick.label}`}
    >
      <div class="picture-popover-title">
        <strong>“${pick.label}”</strong>
        <button aria-label="Close" @click=${() => this.closePictures()}>✕</button>
      </div>
      <div class="picture-popover-choices">
        ${pick.choices === null
          ? [html`<span class="picture-popover-note">Finding pictures…</span>`]
          : pick.choices.length
            ? pick.choices.map(
                (url) => html`<button
                  class=${url === current ? "chosen" : ""}
                  aria-pressed=${url === current}
                  @click=${() => this.setPicture(pick.absIdx, url)}
                >
                  <img src=${url} alt="" />
                </button>`,
              )
            : [html`<span class="picture-popover-note">No match found</span>`]}
      </div>
      <div class="picture-popover-actions">
        <button
          @click=${() => this.pickPicture(pick.absIdx, pick.row, pick.column)}
        >
          From my computer…
        </button>
        ${current
          ? html`<button @click=${() => this.setPicture(pick.absIdx, "")}>
              No picture
            </button>`
          : html``}
      </div>
      <label class="picture-popover-link">
        <span>Tapping it</span>
        <select
          @change=${async (/** @type {Event} */ e) => {
            const value = /** @type {HTMLSelectElement} */ (e.target).value;
            if (!row) return;
            const target = await setSquareLink(this, row, value);
            if (value === "+") {
              this._picturePick = null;
              showBoard(target);
            }
          }}
        >
          <option value="" ?selected=${!link}>says the word</option>
          ${boards().map(
            (board) => html`<option
              value=${board["name"].value}
              ?selected=${link === board["name"].value}
            >
              opens “${board["name"].value}”
            </option>`,
          )}
          <option value="+">opens a new board</option>
        </select>
      </label>
      ${row && row.sets !== "tone"
        ? html`<label class="picture-popover-link">
              <span>Tone</span>
              <select
                @change=${(/** @type {Event} */ e) =>
                  this.setWordField(
                    pick.absIdx,
                    "tone",
                    /** @type {HTMLSelectElement} */ (e.target).value,
                  )}
              >
                <option value="" ?selected=${!row.tone}>
                  ${this.tone.value
                    ? `the grid's (${this.tone.value})`
                    : "the tone buttons' choice"}
                </option>
                ${Object.keys(Tones).map(
                  (tone) => html`<option value=${tone} ?selected=${row.tone === tone}>
                    ${tone}
                  </option>`,
                )}
              </select>
            </label>
            <label class="picture-popover-link">
              <span>Say it like</span>
              <input
                type="text"
                placeholder=${String(row.label ?? "")}
                .value=${String(row.say ?? "")}
                @change=${(/** @type {Event} */ e) =>
                  this.setWordField(
                    pick.absIdx,
                    "say",
                    /** @type {HTMLInputElement} */ (e.target).value.trim(),
                  )}
              />
              <button
                title="Hear it"
                aria-label="Hear it"
                @click=${(/** @type {Event} */ e) => {
                  // what is in the box now, even if not saved yet
                  const box = /** @type {HTMLElement} */ (e.currentTarget)
                    .previousElementSibling;
                  const say = box instanceof HTMLInputElement ? box.value.trim() : "";
                  sayLikeButton({ ...row, say, GridTone: this.tone.value });
                }}
              >
                ▶
              </button>
            </label>`
        : html``}
    </div>`;
  }

  /** Give buttons a matching picture, without holding up typing; a
   * button that has changed since (or no picture found) is left alone
   * @param {Row[]} added
   */
  async addPictures(added) {
    if (!added.length) return;
    const symbols = await Promise.all(
      added.map((row) => findPictogram(String(row.label))),
    );
    const { data } = Globals;
    const rows = [...data.contentRows];
    let changed = false;
    added.forEach((row, i) => {
      const index = rows.indexOf(row);
      if (index < 0 || symbols[i] === (row.symbol ?? "")) return;
      if (!symbols[i] && !row.symbol) return;
      const { symbol, ...rest } = row;
      rows[index] = symbols[i] ? { ...rest, symbol: symbols[i] } : rest;
      changed = true;
    });
    if (!changed) return;
    data.setContent(rows);
    await db.write("content", rows);
    Globals.state.update();
  }

  /** A content row that will show up in this grid: it satisfies the grid's
   * "equals" filters (e.g. the category being shown) and, when items are
   * placed by position, sits in the cell that was clicked
   * @param {string} label
   * @param {number} row
   * @param {number} column
   * @param {number} page
   * @returns {Row}
   */
  newRow(label, row, column, page) {
    /** @type {Row} */
    const result = { label, sheetName: "sheet1" };
    for (const filter of this.children) {
      if (filter.operator.value !== "equals") continue;
      const value = filter.value.value;
      const field = filter.field.value.slice(1);
      if (field && value !== "" && value !== "*" && value != null) {
        result[field] = value;
      }
    }
    if (!this.fillItems.value) {
      Object.assign(result, { row, column });
      if (page > 1) result.page = page;
    }
    return result;
  }

  /** The text box shown in a cell while it is being edited */
  cellEditor() {
    const edit = /** @type {NonNullable<Grid["_editCell"]>} */ (this._editCell);
    return html`<div
      class="grid-cell-editor"
      @click=${(/** @type {MouseEvent} */ e) => {
        // the second click of the double-click that opened this box
        if (e.detail >= 2 && performance.now() - edit.opened < 600) {
          this.pickPicture(edit.absIdx, edit.row, edit.column);
        }
      }}
    >
      <input
        aria-label="Word for this button"
        placeholder="Type a word"
        title=${edit.absIdx < 0
          ? "Enter adds the word and moves to the next cell; Escape stops. Paste a list (one per line) to fill several cells."
          : null}
        .value=${edit.text}
        ref=${(/** @type {HTMLInputElement | null} */ el) => {
          if (el && document.activeElement !== el) {
            requestAnimationFrame(() => {
              el.focus();
              el.select();
            });
          }
        }}
        @input=${(/** @type {InputEvent} */ e) => {
          edit.text = /** @type {HTMLInputElement} */ (e.target).value;
        }}
        @paste=${(/** @type {ClipboardEvent} */ e) => {
          // a pasted list (one word per line) fills a cell per word
          if (edit.absIdx >= 0) return;
          const words = (e.clipboardData?.getData("text") ?? "")
            .split(/[\r\n\t]+/)
            .map((word) => word.trim())
            .filter(Boolean);
          if (words.length < 2) return;
          e.preventDefault();
          this._editCell = null;
          this.addWords(words, edit.row, edit.column, true);
        }}
        @keydown=${(/** @type {KeyboardEvent} */ e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            this.finishEditing(true);
          } else if (e.key === "Escape") {
            this._editCell = null;
            Globals.state.update();
          }
        }}
        @blur=${() => {
          if (this._editCell === edit) this.finishEditing();
        }}
      />
    </div>`;
  }

  /**
   * Assign a media file to a grid cell by its absolute index.
   * If absIdx is -1 (empty cell), a new button is made in that cell.
   * @param {number} absIdx
   * @param {string} mediaName
   * @param {number} row - the cell's row on this page
   * @param {number} column
   */
  async assignMediaToCell(absIdx, mediaName, row, column) {
    const { data } = Globals;

    if (absIdx >= 0) {
      // Find the existing row and update its symbol field
      const allRows = data.getMatchingRows(this.children, false);
      const targetRow = allRows[absIdx];
      if (targetRow) {
        const contentIdx = data.contentRows.indexOf(targetRow);
        if (contentIdx >= 0) {
          data.contentRows[contentIdx] = {
            ...data.contentRows[contentIdx],
            symbol: mediaName,
          };
          await db.write("content", data.contentRows);
        } else {
          const noteIdx = data.noteRows.indexOf(targetRow);
          if (noteIdx >= 0) {
            data.noteRows[noteIdx] = {
              ...data.noteRows[noteIdx],
              symbol: mediaName,
            };
            await db.write("notes", data.noteRows);
          }
        }
      }
    } else {
      // Empty cell — a new button named after the file, in this grid and
      // in the cell it was put on, like a typed word
      if (this._emptyCells.findIndex(([r, c]) => r === row && c === column) > 0) {
        await this.placeByPosition();
      }
      const label = mediaName.replace(/\.[^.]+$/, "");
      const rows = [
        ...data.contentRows,
        { ...this.newRow(label, row, column, this.page), symbol: mediaName },
      ];
      data.setContent(rows);
      await db.write("content", rows);
    }

    Globals.state.update();
  }

  /**
   * Swap two cells by their absolute index in the filtered rows array.
   * Supports both fillItems modes.
   * @param {number} fromAbsIdx
   * @param {number} toAbsIdx
   */
  async swapCells(fromAbsIdx, toAbsIdx) {
    if (fromAbsIdx === toAbsIdx || isNaN(fromAbsIdx) || isNaN(toAbsIdx)) return;
    const { data } = Globals;

    // clearFields=false preserves object identity so indexOf() works
    const allRows = data.getMatchingRows(this.children, false);
    const fromRow = allRows[fromAbsIdx];
    const toRow = allRows[toAbsIdx];
    if (!fromRow || !toRow) return;

    const fromContentIdx = data.contentRows.indexOf(fromRow);
    const toContentIdx = data.contentRows.indexOf(toRow);
    if (fromContentIdx < 0 || toContentIdx < 0) return;

    if (this.fillItems.value) {
      // Sequential mode: swap positions in the array
      [data.contentRows[fromContentIdx], data.contentRows[toContentIdx]] =
        [data.contentRows[toContentIdx], data.contentRows[fromContentIdx]];
    } else {
      // Explicit positioning mode: swap row/column/page coordinate fields
      const { row: fromR, column: fromC, page: fromP } = fromRow;
      data.contentRows[fromContentIdx] = {
        ...fromRow,
        row: toRow.row,
        column: toRow.column,
        page: toRow.page,
      };
      data.contentRows[toContentIdx] = {
        ...toRow,
        row: fromR,
        column: fromC,
        page: fromP,
      };
    }

    await db.write("content", data.contentRows);
    Globals.state.update();
  }

  /** @param {Row} item */
  gridCell(item) {
    if (this._editCell?.key === `${item.row},${item.column}`) {
      return this.cellEditor();
    }
    const name = this.name.value;
    const hasContent = !!(item.label || item.symbol);
    const absIdx = item._absIndex ?? -1;
    const isDraggable = hasContent && absIdx >= 0;
    const self = this;
    // a tone button shows whether its tone is the one picked
    const tone = String(Globals.state?.get("$Tone") || "Normal");
    const chosen = item.sets === "tone" && item.label === tone;

    /** @type {Hole[]} */
    let content;
    let msg = formatSlottedString(item.label || "");
    if (item.symbol) {
      content = [
        html`<div>
          <figure>
            ${imageOrVideo(item.symbol, item.label || "")}
            <figcaption>${msg}</figcaption>
          </figure>
        </div>`,
      ];
    } else {
      content = msg;
    }
    if (item.link) {
      content = [
        ...(Array.isArray(content) ? content : [content]),
        html`<span class="board-link-badge" title=${`Opens ${item.link}`}>➜</span>`,
      ];
    }
    if (!item.symbol && absIdx >= 0 && Globals.state?.get("editing")) {
      content = [
        ...(Array.isArray(content) ? content : [content]),
        html`<span class="picture-add" title="Add a picture">🖼</span>`,
      ];
    }

    // Use data-drag-idx attribute so handlers can read the index at event time
    // rather than relying on closures that may be stale after re-renders.
    return html`<button
      tabindex="-1"
      data-drag-idx=${isDraggable ? String(absIdx) : null}
      .draggable=${isDraggable}
      data=${{
        ...item,
        ComponentName: name,
        ComponentType: this.className,
        GridTone: this.tone.value,
      }}
      aria-pressed=${item.sets === "tone" ? String(chosen) : null}
      class=${item.sets === "tone" && chosen ? "tone-chosen" : null}
      ?disabled=${!item.label && !item.symbol}
      title=${Globals.state?.get("editing") && absIdx >= 0
        ? "Click the word to change it, or its picture to choose another; double-click for a picture from your computer"
        : null}
      @click=${(/** @type {MouseEvent} */ e) => {
        if (absIdx < 0 || !Globals.state?.get("editing")) return;
        // pictures don't take clicks themselves (grid.css), so check where
        // the click landed
        const button = /** @type {HTMLElement} */ (e.currentTarget);
        const onPicture = [...button.querySelectorAll("img, video, .picture-add")].some(
          (element) => {
            const box = element.getBoundingClientRect();
            return (
              e.clientX >= box.left && e.clientX <= box.right &&
              e.clientY >= box.top && e.clientY <= box.bottom
            );
          },
        );
        if (e.detail >= 2) self.pickPicture(absIdx, item.row, item.column);
        else if (onPicture) {
          self.openPictures(absIdx, item.row, item.column, String(item.label ?? ""));
        } else self.startEditing(item.row, item.column, absIdx, String(item.label ?? ""));
      }}
      @dragstart=${function (/** @type {DragEvent} */ e) {
        if (!Globals.state?.get("editing")) {
          e.preventDefault();
          return;
        }
        const idx = /** @type {HTMLElement} */ (e.currentTarget).dataset.dragIdx;
        if (!idx || !e.dataTransfer) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", idx);
        e.dataTransfer.effectAllowed = "move";
        /** @type {HTMLElement} */ (e.currentTarget).classList.add("grid-dragging");
      }}
      @dragend=${function (/** @type {DragEvent} */ e) {
        /** @type {HTMLElement} */ (e.currentTarget).classList.remove("grid-dragging");
        // Clean up any lingering hover highlights in case dragleave didn't fire
        document.querySelectorAll(".grid-drag-over").forEach(
          (el) => el.classList.remove("grid-drag-over"),
        );
      }}
      @dragover=${function (/** @type {DragEvent} */ e) {
        if (!Globals.state?.get("editing") || !e.dataTransfer) return;
        const isMedia = e.dataTransfer.types.includes(
          "application/x-osdpi-media",
        );
        const idx = /** @type {HTMLElement} */ (e.currentTarget).dataset.dragIdx;
        if (!isMedia && !idx) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = isMedia ? "copy" : "move";
      }}
      @dragenter=${function (/** @type {DragEvent} */ e) {
        if (!Globals.state?.get("editing") || !e.dataTransfer) return;
        const isMedia = e.dataTransfer.types.includes(
          "application/x-osdpi-media",
        );
        const idx = /** @type {HTMLElement} */ (e.currentTarget).dataset.dragIdx;
        if (!isMedia && !idx) return;
        /** @type {HTMLElement} */ (e.currentTarget).classList.add("grid-drag-over");
      }}
      @dragleave=${function (/** @type {DragEvent} */ e) {
        const el = /** @type {HTMLElement} */ (e.currentTarget);
        if (!el.contains(/** @type {Node} */ (e.relatedTarget))) {
          el.classList.remove("grid-drag-over");
        }
      }}
      @drop=${function (/** @type {DragEvent} */ e) {
        e.preventDefault();
        /** @type {HTMLElement} */ (e.currentTarget).classList.remove("grid-drag-over");
        if (!Globals.state?.get("editing") || !e.dataTransfer) return;
        const mediaName = e.dataTransfer.getData("application/x-osdpi-media");
        if (mediaName) {
          const absIdx = parseInt(
            /** @type {HTMLElement} */ (e.currentTarget).dataset.dragIdx ?? "-1",
            10,
          );
          self.assignMediaToCell(
            isNaN(absIdx) ? -1 : absIdx,
            mediaName,
            item.row,
            item.column,
          );
          return;
        }
        const toIdx = parseInt(
          /** @type {HTMLElement} */ (e.currentTarget).dataset.dragIdx ?? "",
          10,
        );
        const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
        self.swapCells(fromIdx, toIdx);
      }}
    >
      ${content}
    </button>`;
  }

  /** @param {number} row @param {number} column */
  emptyCell(row, column) {
    this._emptyCells.push([row, column]);
    if (this._typeNext) {
      this._typeNext = false;
      const key = `${row},${column}`;
      this._editCell = { key, absIdx: -1, row, column, text: "", opened: 0 };
    }
    if (this._editCell?.key === `${row},${column}`) return this.cellEditor();
    const self = this;
    // clickable in the designer (to add a word); inert on the board
    const editing = !!Globals.state?.get("editing");
    return html`<button
      tabindex="-1"
      class="grid-empty"
      ?disabled=${!editing}
      title=${editing ? "Click to add a word; double-click to add a picture" : null}
      @click=${(/** @type {MouseEvent} */ e) => {
        if (!editing) return;
        // double-click chooses a picture; the first click opened a text box
        if (e.detail >= 2) self.pickPicture(-1, row, column);
        else self.startEditing(row, column, -1, "");
      }}
      @dragover=${function (/** @type {DragEvent} */ e) {
        if (!Globals.state?.get("editing") || !e.dataTransfer) return;
        if (!e.dataTransfer.types.includes("application/x-osdpi-media")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      @dragenter=${function (/** @type {DragEvent} */ e) {
        if (!Globals.state?.get("editing") || !e.dataTransfer) return;
        if (!e.dataTransfer.types.includes("application/x-osdpi-media")) return;
        /** @type {HTMLElement} */ (e.currentTarget).classList.add("grid-drag-over");
      }}
      @dragleave=${function (/** @type {DragEvent} */ e) {
        const el = /** @type {HTMLElement} */ (e.currentTarget);
        if (!el.contains(/** @type {Node} */ (e.relatedTarget))) {
          el.classList.remove("grid-drag-over");
        }
      }}
      @drop=${function (/** @type {DragEvent} */ e) {
        e.preventDefault();
        /** @type {HTMLElement} */ (e.currentTarget).classList.remove("grid-drag-over");
        if (!Globals.state?.get("editing") || !e.dataTransfer) return;
        const mediaName = e.dataTransfer.getData("application/x-osdpi-media");
        if (mediaName) self.assignMediaToCell(-1, mediaName, row, column);
      }}
    ></button>`;
  }

  /**
   * Allow selecting pages in the grid
   *
   * @param {Number} pages
   * @param {Row} info
   */
  pageSelector(pages, info) {
    const { state } = Globals;
    const background = this.background.value;
    const name = this.name.value;

    return html`<div class="page-control">
      <div class="text">Page ${this.page} of ${pages}</div>
      <div class="back-next">
        <button
          style=${styleString({ backgroundColor: background })}
          .disabled=${this.page == 1}
          data=${{
            ...info,
            ComponentName: name,
            ComponentType: this.className,
          }}
          click
          @Activate=${() => {
            this.page = ((((this.page - 2) % pages) + pages) % pages) + 1;
            state.update(); // trigger redraw
          }}
          tabindex="-1"
        >
          &#9754;</button
        ><button
          .disabled=${this.page == pages}
          data=${{
            ...info,
            ComponentName: name,
            ComponentType: this.className,
          }}
          click
          @Activate=${() => {
            this.page = (this.page % pages) + 1;
            state.update(); // trigger redraw
          }}
          tabindex="-1"
        >
          &#9755;
        </button>
      </div>
    </div>`;
  }

  template() {
    /** @type {Partial<CSSStyleDeclaration>} */
    const style = { backgroundColor: this.background.value };
    const { data } = Globals;
    let rows = Math.max(1, this.rows.value);
    let columns = Math.max(1, this.columns.value);
    let fillItems = this.fillItems.value;
    this._emptyCells = [];

    // Tag every item with its absolute index before pagination so drag-and-drop
    // can identify which source rows to swap.
    let items = /** @type {(Row & {_absIndex: number})[]} */ (
      data.getMatchingRows(this.children).map((item, i) => ({
        ...item,
        _absIndex: i,
      }))
    );

    let maxPage = 1;
    const result = [];
    if (!fillItems) {
      // collect the items for the current page and get the dimensions
      let maxRow = 0, maxColumn = 0;
      const itemMap = new Map();
      /**
       * @param {number} row
       * @param {number} column
       */
      const itemKey = (row, column) => row * 1000 + column;

      for (const item of items) {
        // ignore items without row and column
        if (!item.row || !item.column) continue;
        // get the max page value if any
        maxPage = Math.max(maxPage, item.page || 1);
        // collect the items on this page
        if (this.page == (item.page || 1)) {
          maxRow = Math.max(maxRow, item.row);
          maxColumn = Math.max(maxColumn, item.column);
          const key = itemKey(item.row, item.column);
          // only use the first one
          if (!itemMap.has(key)) itemMap.set(key, item);
        }
      }
      // Positioned items set the grid's shape. A grid with none yet uses
      // the rows and columns from the designer, so its empty cells show
      // (boards made before this have content, so their shape is unchanged).
      if (maxRow && maxColumn) {
        // a grid switched from filling in order keeps its empty squares
        rows = this.fullSize.value ? Math.max(rows, maxRow) : maxRow;
        columns = this.fullSize.value ? Math.max(columns, maxColumn) : maxColumn;
      }
      for (let row = 1; row <= rows; row++) {
        for (let column = 1; column <= columns; column++) {
          if (maxPage > 1 && row == rows && column == columns) {
            // draw the page selector in the last cell
            result.push(this.pageSelector(maxPage, { row, column }));
          } else {
            const key = itemKey(row, column);
            if (itemMap.has(key)) {
              result.push(this.gridCell(itemMap.get(key)));
            } else {
              result.push(this.emptyCell(row, column));
            }
          }
        }
      }
    } else {
      // fill items sequentially
      let perPage = rows * columns;
      if (items.length > perPage) {
        perPage = perPage - 1;
      }
      maxPage = Math.ceil(items.length / perPage);
      // Slice for the current page. Items retain their _absIndex from before the slice.
      const pageStart = (this.page - 1) * perPage;
      items = items.slice(pageStart, this.page * perPage);
      // render them into the result
      for (let i = 0; i < items.length; i++) {
        const row = Math.floor(i / columns) + 1;
        const column = (i % columns) + 1;
        result.push(this.gridCell({ ...items[i], row, column }));
      }
      // fill any spaces that remain
      for (let i = items.length; i < perPage; i++) {
        result.push(
          this.emptyCell(Math.floor(i / columns) + 1, (i % columns) + 1),
        );
      }
      // draw the page selector if needed
      if (maxPage > 1) {
        result.push(this.pageSelector(maxPage, { row: rows, column: columns }));
      }
    }

    // empty result provokes a crash from uhtmlV4
    if (!result.length) {
      rows = columns = 1;
      result.push(this.emptyCell(1, 1));
    }

    this._shape = { rows, columns };
    this._typeNext = false; // no empty square to go on to
    if (this._picturePick && Globals.state?.get("editing")) {
      result.push(this.picturePopover());
    }
    // minmax(0, 1fr) shares the height equally after the spacing is taken out
    style.gridTemplate = `repeat(${rows}, minmax(0, 1fr)) / repeat(${columns}, 1fr)`;
    const spacing = `${Math.max(0, this.spacing.value)}px`;
    style.gap = spacing;
    style.padding = spacing;

    // the buttons take the grid's color unless they have their own, or
    // none; text on them stays readable
    const own = this.buttonColor.value.trim();
    const fill = own === "none" ? "" : own || this.background.value;
    const colored = !!fill && fill !== "white";
    if (colored) {
      Object.assign(style, {
        "--button-color": fill,
        "--button-text": readableTextColor(fill),
      });
    }

    const body = html`<div style=${styleString(style)}>${result}</div>`;

    // the live AI suggestions strip (speechSuggestions.js) gets its own
    // larger text
    const classes = this.name.value === "suggestions" ? ["grid-suggestions"] : [];
    if (colored) classes.push("colored");
    return this.component({ classes }, body);
  }

  settingsDetails() {
    const props = this.props;
    const inputs = Object.values(props).map((prop) => prop.input());
    const filters = GridFilter.FilterSettings(this.children);
    return [html`<div>${filters}${inputs}</div>`];
  }

  settingsChildren() {
    return html`<div />`;
  }
}
TreeBase.register(Grid, "Grid");
