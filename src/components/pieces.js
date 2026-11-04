/**
 * The pieces a student builds a board from in the Layout tab — a message
 * bar, a word grid, a button and tabs — and the plumbing that makes each
 * one work as soon as it is added: it gets a unique name, the Actions rules
 * that make tapping it do the obvious thing, and a Speech component on the
 * page so there is a voice.
 *
 * Pieces are ordinary layout components (Grid, Display, Button,
 * TabControl, …) arranged in Stacks, so boards built here open in the full
 * component tree and everything else (switch scanning, AI generation)
 * keeps working.
 */
import { TreeBase } from "./treebase";
import Globals from "app/globals";
import db from "app/db";

/** A brand-new board: an empty page */
export const blankLayout = {
  className: "Layout",
  // text big enough to read on a tablet; the whole board scales from this
  props: { name: "Layout", uiScale: "1.6" },
  children: [{ className: "Page", props: {}, children: [] }],
};

export const blankActions = { className: "Actions", props: {}, children: [] };

/** @param {string} origin @param {string} condition @param {[string, string][]} updates */
export function rule(origin, condition, updates) {
  return {
    className: "Action",
    props: { origin },
    children: [
      {
        className: "ActionCondition",
        props: { Condition: condition },
        children: [],
      },
      ...updates.map(([stateName, newValue]) => ({
        className: "ActionUpdate",
        props: { stateName, newValue },
        children: [],
      })),
    ],
  };
}

/** @typedef {"message" | "grid" | "button" | "tabs" | "board" | "tones"} PieceKind */

/** What the Add menu offers, in order
 * @type {{kind: PieceKind, label: string, icon: string, about: string}[]} */
export const pieceKinds = [
  {
    kind: "message",
    label: "Message bar",
    icon: "💬",
    about: "Shows the sentence being built. Tap it to say it all.",
  },
  {
    kind: "grid",
    label: "Word grid",
    icon: "▦",
    about: "Rows of word buttons. Tap a word to say it.",
  },
  {
    kind: "button",
    label: "Button",
    icon: "▢",
    about: "One button that says a word or phrase.",
  },
  {
    kind: "tabs",
    label: "Tabs",
    icon: "🗂",
    about: "Pages of words to switch between, like Food and People.",
  },
  {
    kind: "board",
    label: "Board button",
    icon: "📂",
    about: "A button that opens a new board, like a folder. Boards can open more boards.",
  },
  {
    kind: "tones",
    label: "Tone buttons",
    icon: "🎭",
    about: "Calm, Urgent, Angry… Pick one, and the words after it are said that way.",
  },
];

/** How much room each kind of piece takes next to others to start with */
const defaultScale = { message: 1, grid: 4, button: 1, tabs: 4, clear: 1, tones: 1 };

/** Components a student can click on and change */
const selectable = new Set([
  "Grid",
  "Display",
  "Button",
  "TabControl",
  "TabPanel",
  "Radio",
  "VSD",
  "Gap",
  "Prediction",
]);

/** Components that take up room on the board */
export const visualClasses = new Set([
  "Stack",
  "Gap",
  "Grid",
  "Display",
  "Radio",
  "TabControl",
  "VSD",
  "Button",
  "Prediction",
]);

/** The friendly name for what a component is
 * @param {TreeBase} component */
export function pieceLabel(component) {
  switch (component.className) {
    case "Grid":
      return isToneGrid(component) ? "Tone buttons" : "Word grid";
    case "Display":
      return "Message bar";
    case "Button":
      if (isClearButton(component)) return "Clear button";
      if (linkTarget(component)) {
        return /^← /.test(String(component["label"].value)) ? "Back button" : "Board button";
      }
      return "Button";
    case "TabControl":
      return component["name"].value === BOARDS ? "Boards" : "Tabs";
    case "TabPanel":
      return isBoard(component) ? "Board" : "Tab";
    case "VSD":
      return "Picture scene";
    case "Radio":
      return "Choices";
    case "Gap":
      return "Space";
    case "Prediction":
      return "Word prediction";
    default:
      return component.className;
  }
}

/** The piece under a click on the board, or null for the background
 * @param {EventTarget | null} target */
export function pieceAt(target) {
  if (!(target instanceof Element)) return null;
  const element = target.closest('[id^="TreeBase-"]');
  let component = element ? TreeBase.componentFromId(element.id) : undefined;
  while (component && !selectable.has(component.className)) {
    component = component.parent;
  }
  return component || null;
}

/** @param {TreeBase} component */
export function isClearButton(component) {
  return (
    component.className === "Button" &&
    /^clear\d*$/.test(String(component["name"]?.value))
  );
}

/** The board's page
 * @returns {TreeBase} */
function page() {
  return Globals.layout.children[0];
}

/** @param {TreeBase} node @returns {TreeBase[]} */
function allComponents(node) {
  return [node, ...node.children.flatMap(allComponents)];
}

/** A name no other component uses: grid, grid2, grid3, …
 * @param {string} base */
function uniqueName(base) {
  const used = new Set();
  for (const component of allComponents(Globals.layout)) {
    for (const prop of ["name", "Name", "stateName"]) {
      const value = component[prop]?.value;
      if (value) used.add(String(value).replace(/^\$/, ""));
    }
  }
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(base + i)) return base + i;
}

function gridSpec() {
  return {
    className: "Grid",
    props: {
      name: uniqueName("grid"),
      // small to start; it grows as words are typed (grid.js)
      rows: "2",
      columns: "3",
      fillItems: "true",
      background: "white",
      scale: String(defaultScale.grid),
    },
    children: [],
  };
}

/** @param {string} label */
function tabSpec(label) {
  return {
    className: "TabPanel",
    props: { name: label, label, direction: "column" },
    children: [gridSpec()],
  };
}

/** The layout for a new piece of the given kind
 * @param {PieceKind | "clear"} kind */
function spec(kind) {
  switch (kind) {
    case "message":
      return {
        className: "Stack",
        props: { direction: "row", scale: String(defaultScale.message) },
        children: [
          {
            className: "Display",
            props: {
              stateName: "$Display",
              Name: uniqueName("display"),
              background: "white",
              fontSize: "2",
              scale: "5",
            },
            children: [],
          },
          spec("clear"),
        ],
      };
    case "clear":
      return {
        className: "Button",
        props: { label: "Clear", name: uniqueName("clear"), scale: "1" },
        children: [],
      };
    case "grid":
      return gridSpec();
    case "tones": {
      // a word grid of its own whose words set the tone ($Tone) rather
      // than being said (setUp gives it that rule, addPiece the words)
      const name = uniqueName(TONES);
      return {
        className: "Grid",
        props: {
          name,
          rows: "1",
          columns: String(toneWords.length),
          fillItems: "true",
          background: "white",
          scale: String(defaultScale.tones),
        },
        children: [
          {
            className: "GridFilter",
            props: { field: "#grid", operator: "equals", value: `'${name}'` },
            children: [],
          },
        ],
      };
    }
    case "button":
      return {
        className: "Button",
        props: {
          label: "Hello",
          name: uniqueName("button"),
          scale: String(defaultScale.button),
        },
        children: [],
      };
    case "tabs": {
      // the tabs themselves are added once this is on the board, so their
      // grids get names that differ from each other (addPiece)
      const name = uniqueName("tabs");
      return {
        className: "TabControl",
        props: {
          name,
          stateName: "$" + name,
          tabEdge: "top",
          scale: String(defaultScale.tabs),
        },
        children: [],
      };
    }
  }
}

/** True for containers that line their children up in a row or column
 * @param {TreeBase | undefined} node */
function isFlexContainer(node) {
  return (
    !!node &&
    ["Page", "Stack", "TabPanel"].includes(node.className) &&
    !(node["columns"]?.value > 0)
  );
}

/**
 * Add a piece to the board.
 *
 * With no anchor it goes at the end of the page; "inside" puts it in an
 * (empty) tab; otherwise it goes above, below, left or right of the
 * anchor, wrapping the anchor in a new row or column when needed.
 *
 * @param {PieceKind | "clear"} kind
 * @param {TreeBase | null} anchor
 * @param {"above" | "below" | "left" | "right" | "inside"} [side]
 * @returns {TreeBase} the component to select afterwards
 */
export function addPiece(kind, anchor = null, side = "below") {
  if (kind === "board") return addBoardButton(anchor, side);
  const created = TreeBase.fromObject(spec(kind), null);
  place(created, anchor, side, kind === "clear");
  if (kind === "tabs") {
    for (const label of ["Tab 1", "Tab 2"]) {
      TreeBase.fromObject(tabSpec(label), created);
    }
  }
  setUp(allComponents(created));
  if (kind === "tones") addToneWords(created);
  Globals.layout.update();
  // select the part a student would change next
  return created.className === "Stack" ? created.children[0] : created;
}

/** A message bar and a word grid below it, ready to use: the quickest
 * start on an empty board
 * @returns {TreeBase} the grid, to type words into */
export function addTalkingBoard() {
  const display = addPiece("message");
  return addPiece("grid", display, "below");
}

/**
 * Put a component (not on the board) next to an anchor, or at the end of
 * the page without one, wrapping the anchor in a new row or column when
 * the side needs it.
 * @param {TreeBase} node
 * @param {TreeBase | null} anchor
 * @param {"above" | "below" | "left" | "right" | "inside"} side
 * @param {boolean} [intoMessageBar] - next to the display itself rather
 *   than next to the whole message bar (for its Clear button)
 */
function place(node, anchor, side, intoMessageBar = false) {
  let container = page();
  let index = container.children.length;

  // next to a message bar means next to it and its Clear button together
  if (anchor && !intoMessageBar && side !== "inside") {
    anchor = messageBar(anchor) ?? anchor;
  }

  if (anchor && side === "inside") {
    container = anchor;
    index = anchor.children.length;
  } else if (anchor && isFlexContainer(anchor.parent)) {
    const parent = /** @type {TreeBase} */ (anchor.parent);
    const axis = side === "above" || side === "below" ? "column" : "row";
    const after = side === "below" || side === "right" ? 1 : 0;
    const visualSiblings = parent.children.filter((c) =>
      visualClasses.has(c.className),
    );
    if (visualSiblings.length <= 1) parent["direction"].set(axis);
    if (parent["direction"].value === axis) {
      container = parent;
      index = anchor.index + after;
    } else {
      container = wrap(anchor, axis);
      anchor["scale"]?.set(defaultScale[kindOf(anchor)] ?? 1);
      index = after;
    }
  }
  container.children.splice(index, 0, node);
  node.parent = container;
}

/**
 * Move a piece next to another one (dragging it on the board)
 * @param {TreeBase} component
 * @param {TreeBase} target
 * @param {"above" | "below" | "left" | "right" | "inside"} side
 */
export function movePieceTo(component, target, side) {
  const unit = messageBar(component) ?? component;
  if (!canDropOn(component, target)) return;
  const from = /** @type {TreeBase} */ (unit.parent);
  from.children.splice(unit.index, 1);
  unit.parent = undefined;
  place(unit, target, side);
  tidy(from);
  Globals.layout.update();
}

/** True when a piece can be dropped next to (or into) a target: not on
 * itself, its own message bar, or anything inside it
 * @param {TreeBase} component
 * @param {TreeBase} target */
export function canDropOn(component, target) {
  const unit = messageBar(component) ?? component;
  const anchor = messageBar(target) ?? target;
  for (let node = /** @type {TreeBase | undefined} */ (anchor); node; node = node.parent) {
    if (node === unit) return false;
  }
  return true;
}

/** Put a component in a new row (or column) that takes its place
 * @param {TreeBase} component
 * @param {"row" | "column"} direction
 * @returns {TreeBase} the new row or column */
function wrap(component, direction) {
  const parent = /** @type {TreeBase} */ (component.parent);
  const wrapper = TreeBase.create("Stack", null, {
    direction,
    scale: component["scale"]?.value ?? 1,
  });
  parent.children[component.index] = wrapper;
  wrapper.parent = parent;
  component.parent = wrapper;
  wrapper.children = [component];
  return wrapper;
}

/** @param {TreeBase} component
 * @returns {PieceKind | "other"} */
function kindOf(component) {
  return (
    /** @type {Record<string, PieceKind>} */ ({
      Grid: "grid",
      Display: "message",
      Button: "button",
      TabControl: "tabs",
    })[component.className] ?? "other"
  );
}

/** Add a tab (with its own word grid) to a Tabs piece
 * @param {TreeBase} tabs
 * @returns {TreeBase} the new tab */
export function addTab(tabs) {
  const labels = new Set(tabs.children.map((tab) => tab["label"].value));
  let n = tabs.children.length + 1;
  while (labels.has(`Tab ${n}`)) n++;
  const tab = TreeBase.fromObject(tabSpec(`Tab ${n}`), tabs);
  setUp(allComponents(tab));
  Globals.state.update({ [tabs["stateName"].value]: tab["name"].value });
  Globals.layout.update();
  return tab;
}

/** Rename a tab, keeping it the one showing if it was
 * @param {TreeBase} tab
 * @param {string} label */
export function renameTab(tab, label) {
  label = label.trim();
  const tabs = tab.parent;
  if (!label || !tabs) return;
  const showing = Globals.state.get(tabs["stateName"].value) === tab["name"].value;
  tab["label"].set(label);
  tab["name"].set(label);
  if (showing) Globals.state.update({ [tabs["stateName"].value]: label });
  Globals.layout.update();
}

/**
 * Where a piece goes when moved one step up, down, left or right: past its
 * neighbor in that direction, or out of the row (or column) it shares with
 * others to sit beside that row. Null when it can't go that way.
 * @param {TreeBase} component
 * @param {"above" | "below" | "left" | "right"} side
 * @returns {{container: TreeBase, index: number, swap: boolean} | null}
 */
export function moveTarget(component, side) {
  const unit = messageBar(component) ?? component;
  const axis = side === "above" || side === "below" ? "column" : "row";
  const step = side === "above" || side === "left" ? -1 : 1;
  let child = unit;
  let container = unit.parent;
  while (container && isFlexContainer(container)) {
    if (container["direction"].value === axis) {
      const peers = container.children;
      const at = peers.indexOf(child);
      if (child !== unit) {
        return { container, index: step < 0 ? at : at + 1, swap: false };
      }
      let next = at + step;
      while (peers[next] && !visualClasses.has(peers[next].className)) {
        next += step;
      }
      if (peers[next]) return { container, index: next, swap: true };
    }
    child = container;
    container = container.parent;
  }
  return null;
}

/** Move a piece one step up, down, left or right (see moveTarget)
 * @param {TreeBase} component
 * @param {"above" | "below" | "left" | "right"} side */
export function movePiece(component, side) {
  const target = moveTarget(component, side);
  if (!target) return;
  const unit = messageBar(component) ?? component;
  if (target.swap) {
    unit.moveTo(target.index);
  } else {
    const from = /** @type {TreeBase} */ (unit.parent);
    from.children.splice(unit.index, 1);
    target.container.children.splice(target.index, 0, unit);
    unit.parent = target.container;
    tidy(from);
  }
  Globals.layout.update();
}

/**
 * Remove a piece and tidy up: a message bar goes with its Clear button,
 * and rows or columns left holding one piece are dissolved.
 * @param {TreeBase} component
 */
export function removePiece(component) {
  const target = messageBar(component) ?? component;
  const container = target.parent;
  target.remove();
  tidy(container);
  Globals.layout.update();
}

/** What moves and gets added next to as one: a message bar together
 * with its Clear button, otherwise the component itself
 * @param {TreeBase} component */
export function pieceUnit(component) {
  return messageBar(component) ?? component;
}

/** The row holding a message bar and its Clear button, if that is what
 * this display sits in
 * @param {TreeBase} component */
function messageBar(component) {
  const parent = component.parent;
  if (
    component.className === "Display" &&
    parent?.className === "Stack" &&
    parent.children.every((c) => c === component || isClearButton(c))
  ) {
    return parent;
  }
  return null;
}

/** Show or hide the Clear button next to a message bar
 * @param {TreeBase} display */
export function toggleClearButton(display) {
  const clear = clearButtonFor(display);
  if (clear) {
    removePiece(clear);
    return;
  }
  // the bar and its button share a row of their own
  const row = wrap(display, "row");
  display["scale"].set(5);
  TreeBase.fromObject(spec("clear"), row);
  setUp(row.children);
  Globals.layout.update();
}

/** @param {TreeBase} display */
export function clearButtonFor(display) {
  return display.parent?.children.find(isClearButton) ?? null;
}

/** Dissolve rows and columns that hold one piece or none
 * @param {TreeBase | undefined} node */
function tidy(node) {
  while (
    node &&
    node.className === "Stack" &&
    node.children.length <= 1 &&
    node.parent
  ) {
    const parent = node.parent;
    if (node.children.length === 1) {
      const only = node.children[0];
      only["scale"]?.set(node["scale"].value);
      parent.children[node.index] = only;
      only.parent = parent;
      node.children = [];
      TreeBase.idMap.delete(node.id);
    } else {
      node.remove();
    }
    node = parent;
  }
}

/**
 * Make new components work: rules so tapping does the obvious thing,
 * a voice on the page, and separate words for each word grid.
 * @param {TreeBase[]} added
 */
function setUp(added) {
  const actions = Globals.actions;
  const origins = new Set(actions.children.map((r) => r["origin"].value));
  /** @param {string} origin @param {string} condition @param {[string, string][]} updates */
  const addRule = (origin, condition, updates) => {
    if (!origin || origins.has(origin)) return;
    origins.add(origin);
    TreeBase.fromObject(rule(origin, condition, updates), actions);
  };
  const speakAndAdd = /** @type {[string, string][]} */ ([
    ["$Speak", "#label"],
    ["$Display", "add_word(#label)"],
  ]);
  for (const component of added) {
    if (component.className === "Grid" && isToneGrid(component)) {
      addRule(component["name"].value, "", [["$Tone", "#label"]]);
    } else if (component.className === "Grid") {
      addRule(component["name"].value, "", speakAndAdd);
    } else if (component.className === "Display") {
      const state = component["stateName"].value;
      addRule(component["Name"].value, state, [["$Speak", state]]);
    } else if (isClearButton(component)) {
      addRule(component["name"].value, "", [["$Display", "''"]]);
    } else if (component.className === "Button") {
      addRule(component["name"].value, "", speakAndAdd);
    }
  }
  actions.update();

  const board = page();
  if (!board.children.some((c) => c.className === "Speech")) {
    TreeBase.fromObject(
      { className: "Speech", props: { stateName: "$Speak" }, children: [] },
      board,
    );
  }

  separateGrids(added.filter((c) => c.className === "Grid"));
}

/**
 * With more than one word grid, each needs its own words: new grids show
 * words marked with their name (words typed into a grid are marked that
 * way, grid.js), and the grids already there keep the unmarked words, so
 * words loaded from a spreadsheet stay where they were.
 * @param {TreeBase[]} newGrids
 */
function separateGrids(newGrids) {
  const grids = allComponents(Globals.layout).filter(
    (c) => c.className === "Grid" && c["name"].value !== "suggestions",
  );
  if (grids.length < 2) return;
  for (const grid of grids) {
    if (grid.children.some((f) => f["field"].value === "#grid")) continue;
    const props = newGrids.includes(grid)
      ? { field: "#grid", operator: "equals", value: `'${grid["name"].value}'` }
      : { field: "#grid", operator: "empty", value: "" };
    TreeBase.fromObject({ className: "GridFilter", props, children: [] }, grid);
  }
}

// ── Boards: pages of a board that buttons and word squares open ─────────
//
// The boards live in one TabControl named "boards" with its tabs hidden;
// $board names the one showing. A message bar stays outside it, so the
// sentence being built carries across boards. A button opens a board with
// an Actions rule setting $board; a word square opens one with a "link"
// field and its grid's "#link" rule.

const BOARDS = "boards";
export const HOME = "Home";

/** The boards, once a board has more than one
 * @returns {TreeBase | null} */
export function boardsControl() {
  return (
    allComponents(Globals.layout).find(
      (c) => c.className === "TabControl" && c["name"].value === BOARDS,
    ) ?? null
  );
}

/** @param {TreeBase | undefined | null} component */
export function isBoard(component) {
  return (
    component?.className === "TabPanel" &&
    component.parent?.className === "TabControl" &&
    component.parent["name"].value === BOARDS
  );
}

/** @returns {TreeBase[]} */
export function boards() {
  return boardsControl()?.children ?? [];
}

/** The board showing (null with only one board)
 * @returns {TreeBase | null} */
export function currentBoard() {
  const all = boards();
  const showing = Globals.state.get("$board");
  return all.find((board) => board["name"].value === showing) ?? all[0] ?? null;
}

/** @param {string} name */
export function showBoard(name) {
  Globals.state.update({ $board: name });
}

/** The board a component is on (null with only one board)
 * @param {TreeBase} component */
export function boardOf(component) {
  for (let node = /** @type {TreeBase | undefined} */ (component); node; node = node.parent) {
    if (isBoard(node)) return node;
  }
  return null;
}

/** Names quote-free (they go into Actions expressions) and unique
 * @param {string} name
 * @param {TreeBase | null} [except] - the board being renamed */
function boardName(name, except = null) {
  const base = name.replace(/['"\\]/g, "").trim() || "Board";
  const taken = new Set(
    boards().filter((b) => b !== except).map((b) => String(b["name"].value)),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Turn a single board into boards: what is there becomes Home, and a
 * message bar stays above all of them
 * @returns {TreeBase} the boards */
function ensureBoards() {
  const existing = boardsControl();
  if (existing) return existing;
  const board = page();
  const shared = (/** @type {TreeBase} */ c) =>
    c.className === "Display" ||
    (c.className === "Stack" &&
      c.children.some((child) => child.className === "Display") &&
      c.children.every((child) => child.className === "Display" || isClearButton(child)));
  const moving = board.children.filter(
    (c) => visualClasses.has(c.className) && !shared(c),
  );
  const at = moving.length ? moving[0].index : board.children.length;
  const room = moving.reduce((sum, c) => sum + (+c["scale"]?.value || 1), 0);
  const control = TreeBase.fromObject(
    {
      className: "TabControl",
      props: {
        name: BOARDS,
        stateName: "$board",
        tabEdge: "none",
        scale: String(room || defaultScale.grid),
      },
      children: [],
    },
    null,
  );
  const home = TreeBase.fromObject(
    {
      className: "TabPanel",
      props: { name: HOME, label: HOME, direction: board["direction"].value },
      children: [],
    },
    control,
  );
  for (const c of moving) {
    board.children.splice(c.index, 1);
    home.children.push(c);
    c.parent = home;
  }
  board.children.splice(at, 0, control);
  control.parent = board;
  return control;
}

/**
 * A new board with a way back to the board it was made from, and a word
 * grid to fill
 * @param {string} from - the board it is opened from
 * @returns {TreeBase} the new board
 */
function createBoard(from) {
  const control = ensureBoards();
  const name = boardName("New board");
  const board = TreeBase.fromObject(
    {
      className: "TabPanel",
      props: { name, label: name, direction: "column" },
      children: [],
    },
    control,
  );
  const back = TreeBase.fromObject(
    {
      className: "Button",
      props: { label: `← ${from}`, name: uniqueName("back"), scale: "0.6" },
      children: [],
    },
    board,
  );
  setLinkTarget(back, from);
  const grid = TreeBase.fromObject(gridSpec(), board);
  setUp([back, grid]);
  return board;
}

/** The board a button opens ("" when it doesn't open one)
 * @param {TreeBase} button */
export function linkTarget(button) {
  const name = button["name"]?.value;
  for (const action of Globals.actions?.children ?? []) {
    if (action["origin"].value !== name) continue;
    for (const update of action.children) {
      if (update.className === "ActionUpdate" && update["stateName"].value === "$board") {
        return String(update["newValue"].text).replace(/^'|'$/g, "");
      }
    }
  }
  return "";
}

/** Make a button open a board, or ("") say its words again
 * @param {TreeBase} button
 * @param {string} target */
export function setLinkTarget(button, target) {
  const actions = Globals.actions;
  const name = button["name"].value;
  for (const action of [...actions.children]) {
    if (action["origin"].value === name) action.remove();
  }
  const updates = /** @type {[string, string][]} */ (
    target
      ? [["$board", `'${target}'`]]
      : [
          ["$Speak", "#label"],
          ["$Display", "add_word(#label)"],
        ]
  );
  TreeBase.fromObject(rule(name, "", updates), actions);
  actions.update();
}

/** A button that opens a new board (the + menu's "Board button")
 * @param {TreeBase | null} anchor
 * @param {"above" | "below" | "left" | "right" | "inside"} side
 * @returns {TreeBase} the button */
export function addBoardButton(anchor, side) {
  ensureBoards();
  const fromBoard = (anchor && boardOf(anchor)) ?? currentBoard();
  const board = createBoard(String(fromBoard?.["name"].value ?? HOME));
  const button = TreeBase.fromObject(
    {
      className: "Button",
      props: {
        label: board["name"].value,
        name: uniqueName("link"),
        scale: String(defaultScale.button),
      },
      children: [],
    },
    null,
  );
  place(button, anchor ?? fromBoard, anchor ? side : "inside");
  setLinkTarget(button, board["name"].value);
  Globals.layout.update();
  return button;
}

/** New board opened by a button added at the end of the board showing
 * @returns {TreeBase} the new board */
export function addLinkedBoard() {
  const button = addBoardButton(null, "inside");
  return /** @type {TreeBase} */ (
    boards().find((b) => b["name"].value === linkTarget(button))
  );
}

/** Make a button open a new board, made from the board it is on
 * @param {TreeBase} button
 * @returns {string} the new board's name */
export function linkToNewBoard(button) {
  ensureBoards();
  const from = boardOf(button) ?? currentBoard();
  const board = createBoard(String(from?.["name"].value ?? HOME));
  setLinkTarget(button, board["name"].value);
  Globals.layout.update();
  return board["name"].value;
}

/** Make a word square open a board ("" for none, "+" for a new one)
 * @param {TreeBase} grid
 * @param {Row} row - the square's row in the content
 * @param {string} target
 * @returns {Promise<string>} the board it opens now */
export async function setSquareLink(grid, row, target) {
  if (target === "+") {
    const from = boardOf(grid) ?? (ensureBoards(), currentBoard());
    target = createBoard(String(from?.["name"].value ?? HOME))["name"].value;
    Globals.layout.update();
  }
  ensureSquareLinks(grid);
  const { data } = Globals;
  const rows = [...data.contentRows];
  const index = rows.indexOf(row);
  if (index >= 0) {
    const { link: _old, ...rest } = row;
    rows[index] = target ? { ...rest, link: target } : rest;
    data.setContent(rows);
    await db.write("content", rows);
  }
  Globals.state.update();
  return target;
}

/** A grid's squares with a "link" open that board instead of saying the
 * word: a rule ahead of its other rules
 * @param {TreeBase} grid */
function ensureSquareLinks(grid) {
  const actions = Globals.actions;
  const name = grid["name"].value;
  const mine = actions.children.filter((r) => r["origin"].value === name);
  if (mine.some((r) => r.children.some((c) => c["Condition"]?.text === "#link"))) return;
  const linkRule = TreeBase.fromObject(rule(name, "#link", [["$board", "#link"]]), actions);
  if (mine.length) linkRule.moveTo(mine[0].index);
  actions.update();
}

/** A grid's rule that says its words (not the one for squares that open
 * a board)
 * @param {TreeBase} grid */
function sayingRule(grid) {
  const name = grid["name"].value;
  return Globals.actions.children.find(
    (r) =>
      r["origin"].value === name &&
      r.children.some(
        (c) => c.className === "ActionUpdate" && c["stateName"].value === "$Speak",
      ),
  );
}

/** True when the grid says its words with the usual rule, so whether
 * they go into the message bar can be chosen
 * @param {TreeBase} grid */
export function canChooseMessageBar(grid) {
  return !!sayingRule(grid);
}

/** The state that, set to a message bar's state name, clears that bar
 * once the word has been said (speech.js) */
export const CLEAR_AFTER_SAYING = "$ClearAfterSaying";

/** @typedef {"add" | "show" | "say"} MessageBarMode */

/** What a word tapped in this grid does to the message bar: "add" builds
 * a sentence, "show" shows the word and clears it once said, "say" leaves
 * the bar alone
 * @param {TreeBase} grid
 * @returns {MessageBarMode} */
export function messageBarMode(grid) {
  const updates = (sayingRule(grid)?.children ?? []).filter(
    (c) => c.className === "ActionUpdate",
  );
  if (updates.some((c) => c["stateName"].value === CLEAR_AFTER_SAYING)) return "show";
  if (updates.some((c) => c["stateName"].value === "$Display")) return "add";
  return "say";
}

/** Change what a grid's tapped words do to the message bar, by changing
 * its rule: "add" sets $Display to add_word(#label), "show" sets it to
 * the word alone and asks for it to be cleared once said, "say" leaves
 * $Display out
 * @param {TreeBase} grid
 * @param {MessageBarMode} mode */
export function setMessageBarMode(grid, mode) {
  const saying = sayingRule(grid);
  if (!saying || mode === messageBarMode(grid)) return;
  for (const update of saying.children.filter(
    (c) =>
      c.className === "ActionUpdate" &&
      ["$Display", CLEAR_AFTER_SAYING].includes(c["stateName"].value),
  )) {
    update.remove();
  }
  /** @type {[string, string][]} */
  const updates =
    mode === "add"
      ? [["$Display", "add_word(#label)"]]
      : mode === "show"
        ? [
            ["$Display", "#label"],
            [CLEAR_AFTER_SAYING, "'$Display'"],
          ]
        : [];
  for (const [stateName, newValue] of updates) {
    TreeBase.fromObject(
      { className: "ActionUpdate", props: { stateName, newValue }, children: [] },
      saying,
    );
  }
  Globals.actions.update();
}

/** Rename a board, and everything that opens it
 * @param {TreeBase} board
 * @param {string} label */
export async function renameBoard(board, label) {
  const old = String(board["name"].value);
  const name = boardName(label, board);
  if (name === old) return;
  board["name"].set(name);
  board["label"].set(name);
  for (const button of allComponents(Globals.layout).filter((c) => c.className === "Button")) {
    if (linkTarget(button) !== old) continue;
    setLinkTarget(button, name);
    if (button["label"].value === old) button["label"].set(name);
    if (button["label"].value === `← ${old}`) button["label"].set(`← ${name}`);
  }
  const { data } = Globals;
  if (data.contentRows.some((row) => row.link === old)) {
    const rows = data.contentRows.map((row) => (row.link === old ? { ...row, link: name } : row));
    data.setContent(rows);
    await db.write("content", rows);
  }
  if (Globals.state.get("$board") === old) Globals.state.update({ $board: name });
  Globals.layout.update();
}

/** Rename a word grid, and everything that finds it by name: its Actions
 * rules, its own filter, and the words typed into it
 * @param {TreeBase} grid
 * @param {string} label */
export async function renameGrid(grid, label) {
  const old = String(grid["name"].value);
  // quotes would break the filter expression below
  const wanted = label.replace(/['"\\]/g, "").trim();
  if (!wanted || wanted === old) return;
  const name = uniqueName(wanted);
  grid["name"].set(name);

  for (const rule of Globals.actions.children) {
    if (rule["origin"].value === old) rule["origin"].set(name);
  }
  Globals.actions.update();

  for (const filter of grid.children) {
    // .text is the formula as typed ('grid2'); .value would evaluate it
    if (filter["field"].value === "#grid" && filter["value"].text === `'${old}'`) {
      filter["value"].set(`'${name}'`);
    }
  }

  const { data } = Globals;
  if (data.contentRows.some((row) => row.grid === old)) {
    const rows = data.contentRows.map((row) => (row.grid === old ? { ...row, grid: name } : row));
    data.setContent(rows);
    await db.write("content", rows);
  }
  Globals.layout.update();
}

/** Delete a board (not Home), with the buttons and squares that open it
 * @param {TreeBase} board */
export async function deleteBoard(board) {
  const all = boards();
  if (board === all[0]) return;
  const name = String(board["name"].value);
  for (const button of allComponents(Globals.layout).filter((c) => c.className === "Button")) {
    if (linkTarget(button) === name && boardOf(button) !== board) removePiece(button);
  }
  const { data } = Globals;
  if (data.contentRows.some((row) => row.link === name)) {
    const rows = data.contentRows.map((row) => {
      if (row.link !== name) return row;
      const { link: _gone, ...rest } = row;
      return rest;
    });
    data.setContent(rows);
    await db.write("content", rows);
  }
  board.remove();
  if (Globals.state.get("$board") === name) Globals.state.update({ $board: all[0]["name"].value });
  Globals.layout.update();
}

/**
 * The boards as a tree, following the buttons and squares that open
 * them from Home; boards nothing opens are listed at the end
 * @returns {{board: TreeBase, depth: number}[]}
 */
export function boardTree() {
  const all = boards();
  const byName = new Map(all.map((b) => [String(b["name"].value), b]));
  /** @param {TreeBase} board @returns {string[]} */
  const opens = (board) => {
    const targets = allComponents(board)
      .filter((c) => c.className === "Button" && !/^← /.test(String(c["label"].value)))
      .map(linkTarget);
    for (const grid of allComponents(board).filter((c) => c.className === "Grid")) {
      for (const row of Globals.data.getMatchingRows(
        /** @type {import("./gridFilter").GridFilter[]} */ (grid.children),
        false,
      )) {
        if (row.link) targets.push(String(row.link));
      }
    }
    return targets;
  };
  /** @type {{board: TreeBase, depth: number}[]} */
  const result = [];
  const seen = new Set();
  /** @param {TreeBase} board @param {number} depth */
  const visit = (board, depth) => {
    if (seen.has(board)) return;
    seen.add(board);
    result.push({ board, depth });
    for (const target of opens(board)) {
      const child = byName.get(target);
      if (child) visit(child, depth + 1);
    }
  };
  if (all[0]) visit(all[0], 0);
  for (const board of all) visit(board, 0);
  return result;
}

// ── Tone buttons: words that choose how the next words are said ─────────

const TONES = "tones";

/** The tone buttons' words; speech.js knows how each sounds */
const toneWords = ["Normal", "Calm", "Urgent", "Angry", "Sarcastic"];

/** True for a grid of tone buttons: its rule sets $Tone, or, before it
 * has a rule, it is new and named for them
 * @param {TreeBase} grid */
export function isToneGrid(grid) {
  const name = grid["name"].value;
  const rule = Globals.actions.children.find((r) => r["origin"].value === name);
  if (rule) {
    return rule.children.some(
      (c) => c.className === "ActionUpdate" && c["stateName"].value === "$Tone",
    );
  }
  return new RegExp(`^${TONES}\\d*$`).test(name);
}

/** Fill new tone buttons with the tones, marked so they show which is
 * picked (grid.js)
 * @param {TreeBase} grid */
async function addToneWords(grid) {
  const { data } = Globals;
  const name = grid["name"].value;
  const words = toneWords.map((label) => ({
    label,
    grid: name,
    sets: "tone",
    sheetName: "sheet1",
  }));
  const rows = [...data.contentRows, ...words];
  data.setContent(rows);
  await db.write("content", rows);
  Globals.state.update();
}
