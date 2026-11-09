import { html, render } from "uhtml";
import { TreeBase } from "./treebase";
import { DesignerPanel } from "./designer";
import * as Props from "./props";
import db from "app/db";
import "css/content.css";
import pleaseWait from "./wait";
import Globals from "app/globals";
import { fileOpen } from "browser-fs-access";
import { AuthoringPanel } from "./ai/authoring-panel";
import { aiSettings, voiceSettings } from "./ai/settings";

export class Content extends DesignerPanel {
  name = new Props.String("Content");

  lastFocused = this.id;

  /** @type {{ current: number, total: number } | null} */
  _uploadState = null;

  /** Current page for media list pagination (50 items per page) */
  _mediaPage = 1;

  authoring = new AuthoringPanel();

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
        ${this.authoring.template()}
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
