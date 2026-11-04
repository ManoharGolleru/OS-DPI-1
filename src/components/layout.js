import { html, render } from "uhtml";
import { TreeBase } from "./treebase";
import { DesignerPanel } from "./designer";
import * as Props from "./props";
import "css/layout.css";
import Globals from "app/globals";
import { TabPanel } from "./tabcontrol";
import { StackContainer } from "./stack";
import { Tones, sayLikeButton, hasNaturalVoices } from "./speech";
import { elevenProblem, getElevenKey, isEleven } from "./elevenlabs";
import { callAfterRender } from "app/render";
import { ModalDialog } from "./modal-dialog";
import { clearCues } from "./access/pattern";
import {
  blankLayout,
  pieceKinds,
  pieceAt,
  pieceLabel,
  addPiece,
  addTalkingBoard,
  movePieceTo,
  canDropOn,
  pieceUnit,
  addTab,
  renameTab,
  removePiece,
  toggleClearButton,
  moveTarget,
  movePiece,
  clearButtonFor,
  visualClasses,
  boards,
  boardTree,
  currentBoard,
  showBoard,
  isBoard,
  addLinkedBoard,
  renameBoard,
  renameGrid,
  isToneGrid,
  canChooseMessageBar,
  messageBarMode,
  setMessageBarMode,
  deleteBoard,
  linkTarget,
  setLinkTarget,
  linkToNewBoard,
} from "./pieces";

// map old names to new for the transition
const typeToClassName = {
  audio: "Audio",
  stack: "Stack",
  page: "Page",
  grid: "Grid",
  speech: "Speech",
  button: "Button",
  logger: "Logger",
  gap: "Gap",
  option: "Option",
  radio: "Radio",
  vsd: "VSD",
  "modal dialog": "ModalDialog",
  "tab control": "TabControl",
  "tab panel": "TabPanel",
  display: "Display",
};

export class Layout extends DesignerPanel {
  allowDelete = false;

  static tableName = "layout";
  static defaultValue = blankLayout;

  uiScale = new Props.Float(0.7);

  /** @type {string} */
  _searchQuery = "";

  /** The piece clicked on the board
   * @type {TreeBase | null} */
  _selected = null;

  /** Where the next piece goes while the Add menu is open
   * @type {{anchor: TreeBase | null, side: "above" | "below" | "left" | "right" | "inside"} | null} */
  _adding = null;


  /** The selected piece, if it is still on the board */
  get selected() {
    const selected = this._selected;
    if (selected && TreeBase.idMap.get(selected.id) === selected) {
      return selected;
    }
    return null;
  }

  /** @param {TreeBase | null} component */
  select(component) {
    if (component === this.selected) return;
    this._selected = component;
    this._adding = null;
    // show the Layout tab, without moving focus off the board (a click
    // on an empty square there opens a text box)
    const designer = Globals.designer;
    const patch = component && designer ? { [designer.stateName.value]: this.name.value } : {};
    Globals.state.update(patch);
  }

  settings() {
    return html`<div class=${this.CSSClasses("layout")} help="Layout tab" id=${this.id}>
      ${this.simpleView()}
    </div>`;
  }

  /** The full component tree, shown in the Advanced → Components tab
   * @param {string} rootId - the id of the element holding it */
  treeView(rootId) {
    return html`<details class="panel-help">
        <summary>About the Components tab</summary>
        <div class="panel-help-body">
          <p>The full tree of every component on the board — pages, containers, buttons, displays, and more. For everyday building, use the Layout tab instead.</p>
          <ul>
            <li>Expand any item to edit its properties.</li>
            <li>Use the <strong>＋ Add…</strong> selector inside a component to add children (Stacks, Grids, Buttons, etc.).</li>
            <li>Use <strong>Edit → Duplicate</strong> or right-click a button on the canvas to copy, move, or delete it.</li>
            <li>Press <kbd>Ctrl+H</kbd> to highlight the selected component on the canvas.</li>
            <li>Use the search box below to filter components by name.</li>
          </ul>
        </div>
      </details>
      <div class="layout-search">
        <input
          type="search"
          placeholder="Search components…"
          aria-label="Search layout components"
          .value=${this._searchQuery}
          @input=${(/** @type {InputEvent} */ e) => {
            const input = /** @type {HTMLInputElement} */ (e.target);
            this._searchQuery = input.value;
            this._applySearch(input.value, rootId);
          }}
        />
      </div>
      ${this.children[0].settings()}`;
  }

  /** The plain-language editor: add pieces, and change the one clicked */
  simpleView() {
    const selected = this.selected;
    const page = this.children[0];
    const empty = !page.children.some((c) => visualClasses.has(c.className));
    // outline the selected piece on the board
    const outline = html`<style
      .textContent=${selected
        ? `body.designing #UI [id="${selected.id}"] {
            outline: 3px solid var(--brand);
            outline-offset: -3px;
          }`
        : ""}
    ></style>`;

    let body;
    if (this._adding) {
      body = this.addMenu();
    } else if (selected) {
      body = this.inspector(selected);
    } else if (empty) {
      this._adding = { anchor: null, side: "below" };
      body = this.addMenu();
    } else {
      body = html`${hasWordGrid(page) ? howToFill() : html``}
        <p class="piece-hint">
          Click a piece on the board to change it. Use the + buttons around
          it to add a piece next to it.
        </p>
        <button
          class="piece-action"
          @click=${() => {
            this._adding = { anchor: null, side: "below" };
            Globals.state.update();
          }}
        >
          + Add a piece at the bottom
        </button>`;
    }
    return html`<div class="layout-simple">
      ${outline}${empty ? html`` : html`${this.boardsBar()}${voiceSetting(page)}`}${body}
    </div>`;
  }

  /** The boards, as a tree of which opens which, to switch between */
  boardsBar() {
    const tree = boardTree();
    /** @param {TreeBase} board */
    const open = (board) => {
      showBoard(board["name"].value);
      this.select(board);
    };
    const addBoard = () => {
      const board = addLinkedBoard();
      this._adding = null;
      this._selected = board;
      showBoard(board["name"].value);
    };
    if (!tree.length) {
      return html`<div class="boards-bar">
        <div class="boards-head">
          <strong>Boards</strong>
          <button class="piece-action" @click=${addBoard}>+ Add a board</button>
        </div>
        <small>
          A board can open other boards, like folders: Home → Food → Fruit.
          Adding one puts a button on this board that opens it.
        </small>
      </div>`;
    }
    const current = currentBoard();
    return html`<div class="boards-bar">
      <div class="boards-head">
        <strong>Boards</strong>
        <button
          class="piece-action"
          title=${`Adds a button on “${current?.["name"].value}” that opens the new board`}
          @click=${addBoard}
        >
          + New board
        </button>
      </div>
      ${boardTreeView(open)}
    </div>`;
  }

  /** The choice of pieces to add */
  addMenu() {
    const adding = /** @type {NonNullable<Layout["_adding"]>} */ (this._adding);
    const page = this.children[0];
    const empty = !page.children.some((c) => visualClasses.has(c.className));
    const where = adding.anchor
      ? adding.side === "inside"
        ? "inside this tab"
        : `${adding.side === "above" || adding.side === "below" ? adding.side : "to the " + adding.side} of the ${pieceLabel(adding.anchor).toLowerCase()}`
      : "";
    return html`<h3 class="piece-heading">
        ${empty ? "Your board is empty. What do you want to start with?" : `Add a piece ${where}`}
      </h3>
      ${empty
        ? html`<button
            class="piece-choice piece-choice-main"
            @click=${() => {
              this._adding = null;
              this._selected = addTalkingBoard();
            }}
          >
            <span class="piece-icon" aria-hidden="true">💬▦</span>
            <strong>Talking board</strong>
            <span>A message bar with a word grid below it, ready to type words into.</span>
          </button>
          <p class="piece-hint">Or start with one piece:</p>`
        : html``}
      <div class="piece-menu">
        ${pieceKinds.map(
          (piece) => html`<button
            class="piece-choice"
            @click=${() => {
              this._adding = null;
              this._selected = addPiece(piece.kind, adding.anchor, adding.side);
              focusNameOf(this._selected);
            }}
          >
            <span class="piece-icon" aria-hidden="true">${piece.icon}</span>
            <strong>${piece.label}</strong>
            <span>${piece.about}</span>
          </button>`,
        )}
      </div>
      ${empty
        ? html``
        : html`<button
            class="piece-action"
            @click=${() => {
              this._adding = null;
              Globals.state.update();
            }}
          >
            Cancel
          </button>`}`;
  }

  /** Settings for the selected piece
   * @param {TreeBase} piece */
  inspector(piece) {
    /** @type {["above" | "below" | "left" | "right", string][]} */
    const sides = [
      ["above", "↑ Up"],
      ["below", "↓ Down"],
      ["left", "← Left"],
      ["right", "→ Right"],
    ];
    const isTab = piece.className === "TabPanel";
    const board = isBoard(piece);
    const canRemove = board
      ? piece !== boards()[0]
      : !isTab || (piece.parent?.children.length ?? 0) > 1;
    const moveButtons = isTab
      ? html``
      : html`<div class="piece-add">
          <span>Move it (or drag ⠿ on the board):</span>
          <div class="piece-sides">
            ${sides.map(
              ([side, label]) => html`<button
                ?disabled=${!moveTarget(piece, side)}
                aria-label=${`Move ${side === "above" ? "up" : side === "below" ? "down" : side}`}
                @click=${() => movePiece(piece, side)}
              >
                ${label}
              </button>`,
            )}
          </div>
        </div>`;
    return html`<div class="piece-inspector">
      <div class="piece-title">
        <h3>${pieceLabel(piece)}${isTab ? `: ${piece["label"].value}` : ""}</h3>
        <button
          class="piece-done"
          title="Stop changing this piece"
          @click=${() => this.select(null)}
        >
          Done
        </button>
      </div>
      ${this.pieceSettings(piece)} ${this.lookSettings(piece)}
      ${isTab && !piece.children.length
        ? html`<button
            class="piece-action"
            @click=${() => {
              this._adding = { anchor: piece, side: "inside" };
              Globals.state.update();
            }}
          >
            + Add a piece inside this ${board ? "board" : "tab"}
          </button>`
        : html``}
      ${isTab
        ? html``
        : html`<p class="piece-hint">
            Use the + buttons around it on the board to add a piece next to
            it, and drag the grey bars between pieces to resize them.
          </p>`}
      <details class="piece-more">
        <summary>More options</summary>
        ${this.moreSettings(piece)} ${moveButtons}
      </details>
      <button
        class="piece-action"
        title="Every setting of this piece, in the full component tree"
        @click=${() => showInComponents(piece)}
      >
        All settings (Advanced → Components)
      </button>
      ${canRemove
        ? html`<button
            class="piece-action piece-remove"
            @click=${() => {
              if (board) {
                deleteBoard(piece);
                this.select(null);
                return;
              }
              const tabs = isTab ? piece.parent : null;
              removePiece(piece);
              this.select(tabs ?? null);
            }}
          >
            ${board ? "Delete this board" : isTab ? "Remove this tab" : "Remove from the board"}
          </button>`
        : html``}
    </div>`;
  }

  /** The settings few people need, folded under "More options"
   * @param {TreeBase} piece */
  moreSettings(piece) {
    if (piece.className !== "Grid") return html``;
    const fill = piece["fillItems"];
    /** @param {string} label @param {any} prop */
    const number = (label, prop) => html`<label class="piece-field">
      <span>${label}</span>
      <input
        type="number"
        min="1"
        max="12"
        .value=${String(prop.value)}
        @change=${(/** @type {Event} */ e) => {
          const input = /** @type {HTMLInputElement} */ (e.target);
          prop.set(Math.min(12, Math.max(1, Math.round(+input.value || 1))));
          piece.update();
        }}
      />
    </label>`;
    return html`<p class="piece-hint">
        The grid grows by itself as you add words. To set its size yourself:
      </p>
      ${number("Rows", piece["rows"])} ${number("Columns", piece["columns"])}
      <fieldset class="piece-field">
        <legend>Words go</legend>
        <label
          ><input
            type="radio"
            name=${piece.id + "-fill"}
            ?checked=${fill.value}
            @change=${() => {
              fill.set(true);
              piece.update();
            }}
          />
          in order, filling each row</label
        >
        <label
          ><input
            type="radio"
            name=${piece.id + "-fill"}
            ?checked=${!fill.value}
            @change=${async () => {
              // words keep the squares they are in now
              await /** @type {any} */ (piece).placeByPosition();
              piece.update();
            }}
          />
          in the square I click</label
        >
      </fieldset>`;
  }

  /** Color, size and spacing for any piece that has them
   * @param {TreeBase} piece */
  lookSettings(piece) {
    const background = piece["background"];
    const scale = piece["scale"];
    const spacing = piece["spacing"];

    /** A row of color swatches for one setting
     * @param {string} name
     * @param {Props.Prop} prop
     * @param {string[][]} choices - [label, value, swatch color (the value
     *   if left out; "" for none), mark shown on the swatch]
     */
    const swatches = (name, prop, choices) => html`<div class="piece-field">
      <span>${name}</span>
      <div class="piece-colors" role="radiogroup" aria-label=${name}>
        ${choices.map(
          ([label, value, swatch = value, mark = ""]) => html`<button
            class="piece-color"
            role="radio"
            aria-checked=${prop.value === value ? "true" : "false"}
            aria-label=${label}
            title=${label}
            style=${swatch ? `background-color: ${swatch}` : ""}
            @click=${() => {
              prop.set(value);
              piece.update();
            }}
          >
            ${mark}
          </button>`,
        )}
      </div>
    </div>`;

    const buttonColor = piece["buttonColor"];
    const colors =
      background instanceof Props.Color
        ? html`${swatches("Background", background, PieceColors)}
          ${buttonColor instanceof Props.String
            ? swatches("Buttons", buttonColor, [
                ["Same as the background", "", background.value, "="],
                ["No color", "none", ""],
                ...PieceColors.slice(1),
              ])
            : html``}`
        : html``;

    // size only means something next to other pieces in a row or column:
    // it is this piece's share of the room
    const sizable =
      scale instanceof Props.Float &&
      piece.parent instanceof StackContainer &&
      piece.parent.children.length > 1;
    /** @param {number} factor */
    const resize = (factor) => {
      const size = Math.max(0.1, +scale.value || 1) * factor;
      scale.set(Math.round(size * 100) / 100);
      piece.update();
    };
    const size = sizable
      ? html`<div class="piece-field">
          <span>Size</span>
          <button class="piece-action" @click=${() => resize(1 / 1.25)}>
            − Smaller
          </button>
          <button class="piece-action" @click=${() => resize(1.25)}>
            + Bigger
          </button>
        </div>`
      : html``;

    let space = html``;
    if (spacing instanceof Props.Integer) {
      const spacings = [
        ["None", 0],
        ["Small", 3],
        ["Medium", 8],
        ["Large", 16],
      ];
      // a spacing set elsewhere stays selectable
      if (!spacings.some(([, value]) => value == spacing.value)) {
        spacings.push([`Custom (${spacing.value})`, spacing.value]);
      }
      space = html`<label class="piece-field">
        <span>Space between buttons</span>
        <select
          @change=${(/** @type {Event} */ e) => {
            spacing.set(/** @type {HTMLSelectElement} */ (e.target).value);
            piece.update();
          }}
        >
          ${spacings.map(
            ([label, value]) =>
              html`<option value=${value} ?selected=${spacing.value == value}>
                ${label}
              </option>`,
          )}
        </select>
      </label>`;
    }

    return html`${colors} ${size} ${space}`;
  }

  /** The few settings that matter for each kind of piece
   * @param {TreeBase} piece */
  pieceSettings(piece) {
    /** @param {string} label @param {any} prop */
    const text = (label, prop) => html`<label class="piece-field">
      <span>${label}</span>
      <input
        type="text"
        .value=${String(prop.value)}
        @change=${(/** @type {Event} */ e) => {
          prop.set(/** @type {HTMLInputElement} */ (e.target).value);
          piece.update();
        }}
      />
    </label>`;

    switch (piece.className) {
      case "Grid":
        return html`<div class="piece-name">
            ${text("Name", {
              get value() {
                return piece["name"].value;
              },
              set: (/** @type {string} */ value) => renameGrid(piece, value),
            })}
          </div>
          ${isToneGrid(piece)
            ? html`<p class="piece-hint">
                Tap a tone on the board, and the words after it are said that
                way until another is tapped. The tones are Normal, Calm,
                Urgent, Angry and Sarcastic.
              </p>`
            : html`${toneSetting(piece)} ${messageBarSetting(piece)}
              ${howToFill()}`}`;
      case "Display": {
        const size = piece["fontSize"];
        const sizes = [
          ["Small", 1.5],
          ["Medium", 2],
          ["Large", 3],
          ["Extra large", 4],
        ];
        // a size set elsewhere stays selectable
        if (!sizes.some(([, value]) => value == size.value)) {
          sizes.push([`Custom (${size.value})`, size.value]);
        }
        return html`<label class="piece-field">
            <span>Text size</span>
            <select
              @change=${(/** @type {Event} */ e) => {
                size.set(/** @type {HTMLSelectElement} */ (e.target).value);
                piece.update();
              }}
            >
              ${sizes.map(
                ([label, value]) =>
                  html`<option value=${value} ?selected=${size.value == value}>
                    ${label}
                  </option>`,
              )}
            </select>
          </label>
          <label class="piece-field piece-check">
            <input
              type="checkbox"
              ?checked=${!!clearButtonFor(piece)}
              @change=${() => toggleClearButton(piece)}
            />
            <span>Clear button next to it</span>
          </label>`;
      }
      case "Button": {
        const target = linkTarget(piece);
        return html`${text(target ? "Label" : "Says", piece["label"])}
          <label class="piece-field">
            <span>When tapped</span>
            <select
              @change=${(/** @type {Event} */ e) => {
                const value = /** @type {HTMLSelectElement} */ (e.target).value;
                if (value === "+") linkToNewBoard(piece);
                else {
                  setLinkTarget(piece, value);
                  Globals.state.update();
                }
              }}
            >
              <option value="" ?selected=${!target}>says its words</option>
              ${boards().map(
                (b) => html`<option value=${b["name"].value} ?selected=${target === b["name"].value}>
                  opens “${b["name"].value}”
                </option>`,
              )}
              <option value="+">opens a new board</option>
            </select>
          </label>
          ${target
            ? html`<button class="piece-action" @click=${() => showBoard(target)}>
                Show “${target}”
              </button>`
            : html``}`;
      }
      case "TabControl":
        return html`<div class="piece-field piece-tabs">
            <span>Tabs</span>
            ${piece.children.map(
              (tab) => html`<input
                type="text"
                aria-label="Tab name"
                .value=${String(tab["label"].value)}
                @change=${(/** @type {Event} */ e) =>
                  renameTab(tab, /** @type {HTMLInputElement} */ (e.target).value)}
              />`,
            )}
            <button class="piece-action" @click=${() => addTab(piece)}>
              + Add a tab
            </button>
          </div>
          <p class="piece-hint">
            Click a tab on the board to show it, then click inside it to
            change what it holds.
          </p>`;
      case "TabPanel":
        if (isBoard(piece)) {
          return html`${text("Board name", {
              get value() {
                return piece["label"].value;
              },
              set: (/** @type {string} */ value) => renameBoard(piece, value),
            })}
            <p class="piece-hint">
              Buttons and word squares that open this board, and its Back
              buttons, follow the new name.
            </p>`;
        }
        return html`${text("Tab name", {
          get value() {
            return piece["label"].value;
          },
          set: (/** @type {string} */ value) => renameTab(piece, value),
        })}`;
      default:
        return html`<p class="piece-hint">
          This piece's settings are in Advanced → Components.
        </p>`;
    }
  }

  /**
   * Show/hide .settings elements based on search query
   * @param {string} query
   * @param {string} rootId - the element holding the tree
   */
  _applySearch(query, rootId) {
    const panel = document.getElementById(rootId);
    if (!panel) return;
    const q = query.trim().toLowerCase();
    const allSettings = /** @type {NodeListOf<HTMLElement>} */ (
      panel.querySelectorAll(".settings")
    );
    if (!q) {
      // Show everything
      for (const el of allSettings) {
        el.style.display = "";
      }
      return;
    }
    // First pass: determine which elements match
    const matches = new Set();
    for (const el of allSettings) {
      const summary = el.querySelector("summary");
      const text = (summary?.textContent || el.textContent || "").toLowerCase();
      if (text.includes(q)) {
        matches.add(el);
        // Also mark all ancestors
        let parent = el.parentElement;
        while (parent && parent !== panel) {
          if (parent.classList.contains("settings")) matches.add(parent);
          parent = parent.parentElement;
        }
      }
    }
    // Second pass: show/hide
    for (const el of allSettings) {
      el.style.display = matches.has(el) ? "" : "none";
    }
  }

  allowedChildren = ["Page"];

  /**
   * An opportunity to upgrade the format if needed
   * @param {any} obj
   * @returns {Object}
   */
  static upgrade(obj) {
    /** @param {Object} obj */
    function oldToNew(obj) {
      if ("type" in obj) {
        // convert to new representation
        const newObj = {
          children: obj.children.map((/** @type {Object} */ child) =>
            oldToNew(child),
          ),
        };
        if ("filters" in obj.props) {
          for (const filter of obj.props.filters) {
            newObj.children.push({
              className: "GridFilter",
              props: { ...filter },
              children: [],
            });
          }
        }
        newObj.className = typeToClassName[obj.type];
        const { filters, ...props } = obj.props;
        newObj.props = props;
        obj = newObj;
      }
      return obj;
    }
    obj = oldToNew(obj);
    // make sure it begins with Layout
    if (obj.className != "Layout" && obj.className == "Page") {
      obj = {
        className: "Layout",
        props: { name: "Layout" },
        children: [obj],
      };
    }
    return obj;
  }

  /** Allow highlighting the current component in the UI
   */
  highlight() {
    // clear any existing highlight
    for (const element of document.querySelectorAll("#UI [highlight]")) {
      element.removeAttribute("highlight");
    }
    // find the selection in the panel
    let selected = document.querySelector("#designer .layout [aria-selected]");
    if (!selected) return;
    selected = selected.closest("[id]");
    if (!selected) return;
    const id = selected.id;
    if (!id) return;
    let component = TreeBase.componentFromId(id);
    if (component) {
      const element = document.getElementById(component.id);
      if (element) {
        element.setAttribute("highlight", "component");
        return;
      }
      // the component is not currently visible. Find its nearest visible parent
      component = component.parent;
      while (component) {
        const element = document.getElementById(component.id);
        if (element) {
          element.setAttribute("highlight", "parent");
          return;
        }
        component = component.parent;
      }
    }
  }

  makeVisible() {
    let component = Globals.designer.selectedComponent;
    if (component) {
      const element = document.getElementById(component.id);
      if (element) {
        return; // already visible
      }
      // climb the tree scheduling updates to parent to make this component visible
      component = component.parent;
      let patch = {};
      while (component) {
        if (
          component instanceof TabPanel &&
          component.parent &&
          component.parent.currentPanel != component
        ) {
          patch[component.parent.stateName.value] = component.name.value;
        } else if (component instanceof ModalDialog) {
          patch[component.stateName.value] = 1;
        }
        component = component.parent;
      }
      callAfterRender(() => this.highlight());
      Globals.state.update(patch);
    }
  }
  /**
   * Merge an object into the panel contents
   * @param {ExternalRep} obj
   * @returns {Promise<void>}
   */
  async merge(obj) {
    console.assert(obj.className == "Layout", obj);
    const toMerge = obj.children[0].children;
    const page = this.children[0];
    for (let newChild of toMerge) {
      if (newChild.className == "Speech") continue;
      TreeBase.fromObject(newChild, page);
    }
    this.onUpdate();
  }
}
TreeBase.register(Layout, "Layout");

/** The full component tree, as a tab of its own under Advanced, so the
 * Layout tab stays simple */
export class ComponentsPanel extends DesignerPanel {
  settings() {
    return html`<div
      class=${this.CSSClasses("layout components")}
      help="Components tab"
      id=${this.id}
      @keydown=${(/** @type {KeyboardEvent} */ event) => {
        if (event.key.toLowerCase() == "h" && event.ctrlKey) {
          event.preventDefault();
          Globals.layout.highlight();
        }
      }}
    >
      ${Globals.layout.treeView(this.id)}
    </div>`;
  }

  // the tree is the layout's, and so is its undo history
  async undo() {
    await Globals.layout.undo();
  }

  async redo() {
    await Globals.layout.redo();
  }
}
TreeBase.register(ComponentsPanel, "ComponentsPanel");

// ── Boards, drawn as a tree with lines from each board to the ones it
// opens, in the Layout panel and on the board map ─────────────────────────

/** @typedef {{board: TreeBase, children: BoardNode[]}} BoardNode */

/** The boards nested by which opens which (from boardTree's order)
 * @returns {BoardNode[]} */
function nestedBoards() {
  /** @type {BoardNode[]} */
  const roots = [];
  /** @type {BoardNode[]} the open path, by depth */
  const path = [];
  for (const { board, depth } of boardTree()) {
    const node = { board, children: [] };
    path.length = depth;
    (depth ? path[depth - 1].children : roots).push(node);
    path.push(node);
  }
  return roots;
}

/** The boards from Home to the one showing
 * @returns {BoardNode[]} */
function pathToCurrent() {
  const current = currentBoard();
  /** @param {BoardNode[]} nodes @returns {BoardNode[] | null} */
  const find = (nodes) => {
    for (const node of nodes) {
      if (node.board === current) return [node];
      const below = find(node.children);
      if (below) return [node, ...below];
    }
    return null;
  };
  return find(nestedBoards()) ?? [];
}

/** @param {(board: TreeBase) => void} open */
function boardTreeView(open) {
  const current = currentBoard();
  /** @param {BoardNode[]} nodes @returns {Hole} */
  const branch = (nodes) => html`<ul class="board-tree" role="list">
    ${nodes.map(
      ({ board, children }) => html`<li>
        <button
          class=${board === current ? "board-chip current" : "board-chip"}
          aria-current=${board === current ? "true" : "false"}
          @click=${() => open(board)}
        >
          ${board["name"].value}
        </button>
        ${children.length ? branch(children) : html``}
      </li>`,
    )}
  </ul>`;
  return branch(nestedBoards());
}

// ── The board map: where you are among the boards, above the board in the
// designer ───────────────────────────────────────────────────────────────

let mapOpen = false;

function drawBoardMap() {
  const map = fixedElement("board-map");
  const board = document.getElementById("UI");
  const showing = !!Globals.state?.get("editing") && boards().length > 1 && board;
  document.body.classList.toggle("has-board-map", !!showing);
  if (!showing) {
    map.hidden = true;
    mapOpen = false;
    return;
  }
  const box = board.getBoundingClientRect();
  map.hidden = false;
  Object.assign(map.style, {
    left: `${box.left + 10}px`,
    top: `${box.top + 6}px`,
    width: `${box.width - 20}px`,
  });
  /** @param {TreeBase} target */
  const open = (target) => {
    mapOpen = false;
    showBoard(target["name"].value);
    Globals.layout.select(target);
  };
  const path = pathToCurrent();
  const here = path.at(-1);
  const opens = here?.children ?? [];
  render(
    map,
    html`<nav class="board-map-bar" aria-label="Boards">
        <span class="board-map-label">Board:</span>
        ${path.map(
          (node, i) => html`${i ? html`<span class="board-map-sep" aria-hidden="true">›</span>` : html``}<button
              class=${node === here ? "board-chip current" : "board-chip"}
              aria-current=${node === here ? "page" : "false"}
              @click=${() => open(node.board)}
            >
              ${node.board["name"].value}
            </button>`,
        )}
        ${opens.length
          ? html`<span class="board-map-opens">opens</span>${opens.map(
              (node) => html`<button class="board-chip next" @click=${() => open(node.board)}>
                ${node.board["name"].value} ➜
              </button>`,
            )}`
          : html``}
        <button
          class=${mapOpen ? "board-map-toggle open" : "board-map-toggle"}
          aria-expanded=${mapOpen}
          @click=${() => {
            mapOpen = !mapOpen;
            drawBoardMap();
          }}
        >
          🗺 Map
        </button>
      </nav>
      ${mapOpen
        ? html`<div class="board-map-tree" role="dialog" aria-label="All boards">
            ${boardTreeView(open)}
          </div>`
        : html``}`,
  );
}

document.addEventListener("rendercomplete", drawBoardMap);
window.addEventListener("resize", drawBoardMap);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mapOpen) {
    mapOpen = false;
    drawBoardMap();
  }
});

// ── On the board: + buttons around the selected piece, and a grip to drag
// it somewhere else (designer only) ──────────────────────────────────────

/** @typedef {"above" | "below" | "left" | "right"} Side */

/** The side whose piece menu is open, and the piece it is for */
let overlayMenu = /** @type {Side | null} */ (null);
let overlayFor = /** @type {TreeBase | null} */ (null);

/** @param {string} id */
function fixedElement(id) {
  let element = document.getElementById(id);
  if (!element) {
    element = document.createElement("div");
    element.id = id;
    document.body.append(element);
  }
  return element;
}

/** Draw the + buttons and grip over the selected piece */
function drawOverlay() {
  const overlay = fixedElement("piece-overlay");
  const layout = Globals.layout;
  const piece = Globals.state?.get("editing") ? layout?.selected : null;
  const unit = piece && pieceUnit(piece);
  const element = unit && document.getElementById(unit.id);
  if (!piece || !element || piece.className === "TabPanel" || layout._adding) {
    overlay.hidden = true;
    overlayMenu = null;
    return;
  }
  if (overlayFor !== piece) {
    overlayMenu = null;
    overlayFor = piece;
  }
  const box = element.getBoundingClientRect();
  overlay.hidden = false;
  Object.assign(overlay.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  /** @type {[Side, string][]} */
  const sides = [
    ["above", "Add a piece above"],
    ["below", "Add a piece below"],
    ["left", "Add a piece to the left"],
    ["right", "Add a piece to the right"],
  ];
  // each + sits on the middle of its edge, in the gap between pieces, and
  // moves in only where the piece meets the edge of the board
  const board = document.getElementById("UI")?.getBoundingClientRect() ?? box;
  const size = 24;
  const half = size / 2;
  /** @param {number} at @param {number} least @param {number} most */
  const clamp = (at, least, most) => Math.min(Math.max(at, least), most);
  const across = (/** @type {number} */ length) => length / 2 - half;
  const minX = board.left + 2 - box.left;
  const maxX = board.right - size - 2 - box.left;
  const minY = board.top + 2 - box.top;
  const maxY = board.bottom - size - 2 - box.top;
  /** @type {Record<Side, {left: number, top: number}>} */
  const spots = {
    above: { left: across(box.width), top: clamp(-half, minY, maxY) },
    below: { left: across(box.width), top: clamp(box.height - half, minY, maxY) },
    left: { left: clamp(-half, minX, maxX), top: across(box.height) },
    right: { left: clamp(box.width - half, minX, maxX), top: across(box.height) },
  };
  const menu = overlayMenu
    ? html`<div class=${`overlay-menu ${overlayMenu}`} role="menu">
        ${pieceKinds.map(
          (kind) => html`<button
            role="menuitem"
            @click=${() => {
              const side = /** @type {Side} */ (overlayMenu);
              overlayMenu = null;
              layout._selected = addPiece(kind.kind, piece, side);
              focusNameOf(layout._selected);
            }}
          >
            <span aria-hidden="true">${kind.icon}</span> ${kind.label}
          </button>`,
        )}
      </div>`
    : html``;
  render(
    overlay,
    html`${sides.map(
        ([side, label]) => html`<button
          class=${`overlay-add ${side}${overlayMenu === side ? " open" : ""}`}
          style=${`left: ${spots[side].left}px; top: ${spots[side].top}px`}
          aria-label=${label}
          title=${label}
          aria-expanded=${overlayMenu === side}
          @click=${() => {
            overlayMenu = overlayMenu === side ? null : side;
            Globals.state.update();
          }}
        >
          +
        </button>`,
      )}
      <button
        class=${box.top > 30 ? "overlay-grip" : "overlay-grip inside"}
        title="Drag to move it"
        aria-label="Drag to move it"
        @pointerdown=${(/** @type {PointerEvent} */ e) => startDrag(e, piece)}
      >
        ⠿ Move
      </button>
      ${menu}`,
  );
}

/**
 * Drag the selected piece by its grip; dropping it on another piece puts
 * it on the side of that piece nearest the pointer.
 * @param {PointerEvent} event
 * @param {TreeBase} piece
 */
function startDrag(event, piece) {
  if (!event.isPrimary) return;
  event.preventDefault();
  const board = document.getElementById("UI");
  const indicator = fixedElement("piece-drop");
  indicator.hidden = true;
  document.body.classList.add("piece-dragging");
  clearCues(); // no hover highlight left on the board while dragging
  overlayMenu = null;
  /** @type {{target: TreeBase, side: Side | "inside"} | null} */
  let drop = null;

  const move = (/** @type {PointerEvent} */ e) => {
    e.stopPropagation(); // the board doesn't react while a piece is dragged
    const under = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((el) => board?.contains(el));
    const target = under ? pieceAt(under) : null;
    const element = target && document.getElementById(pieceUnit(target).id);
    if (!target || !element || !canDropOn(piece, target)) {
      drop = null;
      indicator.hidden = true;
      return;
    }
    const box = element.getBoundingClientRect();
    /** @type {Side | "inside"} */
    let side = "inside";
    if (target.className !== "TabPanel") {
      const x = (e.clientX - box.left) / box.width;
      const y = (e.clientY - box.top) / box.height;
      /** @type {[Side, number][]} */
      const distances = [
        ["above", y],
        ["below", 1 - y],
        ["left", x],
        ["right", 1 - x],
      ];
      side = distances.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
    }
    drop = { target, side };
    indicator.hidden = false;
    indicator.className = side;
    Object.assign(indicator.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  };
  const end = (/** @type {Event} */ e) => {
    e.stopPropagation();
    window.removeEventListener("pointerover", quiet, true);
    window.removeEventListener("pointerout", quiet, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    document.body.classList.remove("piece-dragging");
    indicator.hidden = true;
    if (drop && e.type === "pointerup") movePieceTo(piece, drop.target, drop.side);
  };
  // the board's hover highlight (switch access) watches these; it stays
  // quiet while a piece is dragged
  const quiet = (/** @type {Event} */ e) => e.stopPropagation();
  // on the window, ahead of the board's own pointer handling
  window.addEventListener("pointerover", quiet, true);
  window.addEventListener("pointerout", quiet, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
}

document.addEventListener("rendercomplete", drawOverlay);
window.addEventListener("resize", drawOverlay);
document.addEventListener("scroll", drawOverlay, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && overlayMenu) {
    overlayMenu = null;
    drawOverlay();
  }
});

/** @param {TreeBase} node @returns {boolean} */
function hasWordGrid(node) {
  return (
    (node.className === "Grid" && node["name"]?.value !== "suggestions") ||
    node.children.some(hasWordGrid)
  );
}

/** How to put words and pictures into a word grid, shown prominently */
/** Put the cursor in a new grid's Name box, ready to type over "grid2"
 * @param {TreeBase | null} piece */
function focusNameOf(piece) {
  if (piece?.className !== "Grid") return;
  callAfterRender(() => {
    const input = document.querySelector(".piece-inspector .piece-name input");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  });
}

/** Switch to Advanced → Components with this piece's settings open
 * @param {TreeBase} piece */
function showInComponents(piece) {
  const panel = Globals.designer.children.find((p) => p.name.value === "Components");
  if (panel) panel.lastFocused = piece.id + "-settings";
  callAfterRender(() => {
    // open the piece and every container around it
    for (let c = /** @type {TreeBase | undefined} */ (piece); c; c = c.parent) {
      const details = document.getElementById(c.id + "-details");
      if (details instanceof HTMLDetailsElement) details.open = true;
    }
    const summary = document.getElementById(piece.id + "-settings");
    summary?.scrollIntoView({ block: "center" });
    summary?.focus();
  });
  Globals.designer.switchTab("Components");
}

/** The board's voice, with a way to hear it
 * @param {TreeBase} page */
function voiceSetting(page) {
  /** @param {TreeBase} node @returns {TreeBase | undefined} */
  const find = (node) =>
    node.className === "Speech" ? node : node.children.map(find).find(Boolean);
  const speech = find(page);
  const voice = speech?.["voiceURI"];
  /** every Speech on the board, so the one that talks gets the voice too
   * @param {TreeBase} node @returns {TreeBase[]} */
  const all = (node) =>
    node.className === "Speech" ? [node] : node.children.flatMap(all);
  if (!(voice instanceof Props.Voice)) return html``;
  return html`<div class="piece-field board-voice">
      <span>Voice</span>
      <select
        is="select-voice"
        value=${voice.value}
        @change=${(/** @type {Event} */ e) => {
          const value = /** @type {HTMLSelectElement} */ (e.target).value;
          for (const each of all(page)) each["voiceURI"].set(value);
          speech?.update();
        }}
      >
        <option value="" ?selected=${!voice.value}>The computer's voice</option>
      </select>
      <button
        class="piece-action"
        title="Hear the voice"
        @click=${() => sayLikeButton({ label: "Hello, how are you?" })}
      >
        ▶
      </button>
    </div>
    ${naturalVoices === false
      ? html`<p class="piece-hint">
          For voices that sound more like a person (Aria, Jenny, Guy…), open
          this app in Microsoft Edge; they show up in this list there.
        </p>`
      : html``}
    ${isEleven(voice.value) && elevenProblem
      ? html`<p class="piece-hint voice-problem" role="status">⚠ ${elevenProblem}</p>`
      : html``}
    ${getElevenKey()
      ? html``
      : html`<p class="piece-hint">
          More voices: paste a free ElevenLabs key in Content → Keys.
        </p>`}`;
}

/** Whether this browser has Edge's natural voices, once known
 * @type {boolean | null} */
let naturalVoices = null;
function checkNaturalVoices() {
  hasNaturalVoices().then((has) => {
    if (has === naturalVoices) return;
    naturalVoices = has;
    Globals.state?.update();
  });
}
checkNaturalVoices();
// online voices arrive after the computer's own
speechSynthesis.addEventListener("voiceschanged", checkNaturalVoices);

/** What a tapped word does to the message bar
 * @param {TreeBase} grid */
function messageBarSetting(grid) {
  if (!canChooseMessageBar(grid)) return html``;
  const mode = messageBarMode(grid);
  const choices = [
    ["add", "says it and adds it to the message bar"],
    ["show", "says it, shows it, then clears it"],
    ["say", "just says it"],
  ];
  return html`<label class="piece-field message-bar-setting">
    <span>Tapping a word</span>
    <select
      @change=${(/** @type {Event} */ e) => {
        const value = /** @type {HTMLSelectElement} */ (e.target).value;
        setMessageBarMode(grid, /** @type {any} */ (value));
        Globals.state.update();
      }}
    >
      ${choices.map(
        ([value, label]) =>
          html`<option value=${value} ?selected=${mode === value}>${label}</option>`,
      )}
    </select>
  </label>`;
}

/** How every word in a grid is said, like a whole tab of sarcasm
 * @param {TreeBase} grid */
function toneSetting(grid) {
  const tone = grid["tone"];
  if (!(tone instanceof Props.String)) return html``;
  return html`<label class="piece-field">
    <span>Tone</span>
    <select
      title="How every word in this grid is said; one word can have its own (click its picture)"
      @change=${(/** @type {Event} */ e) => {
        tone.set(/** @type {HTMLSelectElement} */ (e.target).value);
        grid.update();
      }}
    >
      <option value="" ?selected=${!tone.value}>The tone buttons' choice</option>
      ${Object.keys(Tones).map(
        (name) => html`<option value=${name} ?selected=${tone.value === name}>
          ${name}
        </option>`,
      )}
    </select>
  </label>`;
}

/** The colors offered for a piece: strong enough to tell pieces apart,
 * light enough that black words stay readable. "" means no color. */
const PieceColors = [
  ["No color", ""],
  ["White", "white"],
  ["Yellow", "#ffe066"],
  ["Orange", "#ffb366"],
  ["Red", "#ff8080"],
  ["Pink", "#ff99cc"],
  ["Purple", "#c9a3ff"],
  ["Blue", "#80b3ff"],
  ["Teal", "#66d9c7"],
  ["Green", "#8ce68c"],
  ["Gray", "#c8c8c8"],
];

function howToFill() {
  return html`<div class="piece-howto" role="note">
    <strong>Fill the grid on the board:</strong>
    <div class="howto-row">
      <span class="howto-gesture">Click</span>
      <span>a square to type a word</span>
    </div>
    <div class="howto-row">
      <span class="howto-gesture">Click a picture</span>
      <span>to choose a better one, or make the square open a board</span>
    </div>
    <div class="howto-row">
      <span class="howto-gesture">Double-click</span>
      <span>to use a picture from your computer</span>
    </div>
    <small>Enter moves on to the next square. Paste a list to fill many.</small>
  </div>`;
}

// In the designer, clicking a piece on the board selects it for the
// Layout tab (capture phase, before the piece handles the click itself)
document.addEventListener(
  "click",
  (event) => {
    if (!Globals.state?.get("editing") || !Globals.layout) return;
    const board = document.getElementById("UI");
    if (!board || !board.contains(/** @type {Node} */ (event.target))) return;
    if (event.target instanceof Element && event.target.closest(".resize-handle")) return;
    Globals.layout.select(pieceAt(event.target));
  },
  true,
);
