import "@ungap/custom-elements";
import { render, html } from "uhtml";
import { Messages } from "./components/errors";
import { Data } from "./data";
import { State } from "./state";
import "./components";
import { Layout, ComponentsPanel } from "./components/layout";
import { TreeBase } from "./components/treebase";
import { removeUnsafePictures } from "./components/pictograms";
import { Monitor } from "./components/monitor";
import { ToolBar } from "./components/toolbar";
import db from "./db";
import pleaseWait from "./components/wait";
import "css/designer.css";
import "css/colors.css";
import Globals from "./globals";
import { PatternList } from "./components/access/pattern";
import { MethodChooser } from "./components/access/method";
import { CueList } from "./components/access/cues";
import { Actions } from "./components/actions";
import { callAfterRender, safeRender, postRender } from "./render";
import { Designer } from "components/designer";
import { Content } from "components/content";
import { workerCheckForUpdate, workerUpdateButton } from "components/serviceWorker";
import { accessed } from "./eval";
import { speechSuggestions } from "components/speechSuggestions";
import { attachTapRouter } from "components/tapRouter";

/** let me wait for the page to load */
const pageLoaded = new Promise((resolve) => {
  window.addEventListener("load", () => {
    document.body.classList.add("loaded");
    resolve(true);
  });
});

/** Load page and data then go
 */
export async function start() {
  let editing = true;
  if (window.location.search) {
    const params = new URLSearchParams(window.location.search);
    // Feature 10: ?preview=1 shows only the user-mode board (no toolbar/designer)
    if (params.get("preview") !== null) {
      editing = false;
    }
    const fetch = params.get("fetch");
    if (fetch) {
      await pleaseWait(
        db.readDesignFromURL(fetch, window.location.hash.slice(1)),
      );
      editing = params.get("edit") !== null;
      window.history.replaceState(
        {},
        document.title,
        window.location.origin + window.location.pathname + "#" + db.designName,
      );
    }
  }
  let name = window.location.hash.slice(1);
  if (!name) {
    // No board selected — show the home screen instead of auto-creating a design
    await pageLoaded;
    const { mountReact } = await import("./react/main.jsx");
    mountReact({ mode: "home" });
    return;
  }
  db.setDesignName(name);
  const dataArray = await db.read("content", []);
  const noteArray = await db.read("notes", []);
  await pageLoaded;

  Globals.data = new Data(dataArray);
  Globals.data.setNoteRows(noteArray);
  // take any picture that fails the safety check off the board's words
  removeUnsafePictures(dataArray).then(async (cleaned) => {
    if (!cleaned || Globals.data.contentRows !== dataArray) return;
    Globals.data.setContent(cleaned);
    await db.write("content", cleaned);
    Globals.state?.update();
  });
  const layout = await Layout.load(Layout);
  Globals.layout = layout;
  Globals.state = new State(`UIState`);
  Globals.actions = await Actions.load(Actions);
  Globals.content = /** @type {Content} */ (
    Content.fromObject({
      className: "Content",
      props: {},
      children: [],
    })
  );
  Globals.cues = await CueList.load(CueList);
  Globals.patterns = await PatternList.load(PatternList);
  Globals.methods = await MethodChooser.load(MethodChooser);
  Globals.restart = async () => {
    // tear down any existing event handlers before restarting
    Globals.methods.stop();
    start();
  };
  Globals.error = new Messages();

  /** @param {() => void} f */
  function debounce(f) {
    let timeout = null;
    return () => {
      if (timeout) window.cancelAnimationFrame(timeout);
      timeout = window.requestAnimationFrame(f);
    };
  }

  /* Designer */
  Globals.state.define("editing", editing); // for now
  // The Home screen's "Generate with AI" choice lands here on a fresh
  // board: open the designer on the Content panel, whose generator is
  // already expanded (the Content instance consumed the same flag).
  if (localStorage.getItem("osdpi-open-ai-generator")) {
    localStorage.removeItem("osdpi-open-ai-generator");
    Globals.state.define("designerTab", "Content");
  }
  Globals.designer = /** @type {Designer} */ (
    Designer.fromObject({
      className: "Designer",
      props: { tabEdge: "top", stateName: "designerTab" },
      children: [
        layout,
        Globals.actions,
        Globals.content,
        TreeBase.create(ComponentsPanel, null, {
          name: "Components",
          label: "Components",
        }),
        Globals.cues,
        Globals.patterns,
        Globals.methods,
      ],
    })
  );

  /* ToolBar */
  const toolbar = ToolBar.create("ToolBar", null);
  toolbar.init();

  /* Monitor */
  const monitor = Monitor.create("Monitor", null);
  monitor.init();

  /* Speech Suggestions */
  Globals.speechSuggestions = speechSuggestions;
  speechSuggestions._setupDirectSpeech();

  function renderUI() {
    // report the time to draw the frame
    if (location.host.startsWith("localhost")) {
      const startTime = performance.now();
      const timer = document.getElementById("timer");
      if (timer) {
        // I think this makes it wait until all drawing is done.
        requestAnimationFrame(() => {
          setTimeout(() => {
            timer.innerText = `${(performance.now() - startTime).toFixed(0)}ms`;
          });
        });
      }
    }
    // the real update begins here
    const editing = Globals.state.get("editing");
    document.body.classList.toggle("designing", editing);
    const returnControl = document.getElementById("return-to-edit");
    if (returnControl) render(returnControl, !editing && !new URLSearchParams(location.search).has("preview")
      ? html`<button type="button" @click=${() => Globals.state.update({ editing: true })}>Back to editing</button>`
      : html``);

    // Apply per-board font size to the canvas area
    const uiDiv = document.getElementById("UI");
    if (uiDiv) {
      uiDiv.style.fontSize = (Globals.layout.uiScale?.value ?? 0.7) + "vw";
    }
    safeRender("cues", Globals.cues);
    safeRender("UI", Globals.layout.children[0]);
    safeRender("suggestions", speechSuggestions);
    const updateDiv = document.getElementById("app-update");
    if (updateDiv) render(updateDiv, workerUpdateButton());
    if (editing) {
      safeRender("toolbar", toolbar);
      safeRender("tabs", Globals.designer);
      safeRender("monitor", monitor);
      safeRender("errors", Globals.error);
    }
    postRender();
    Globals.methods.refresh();
    // clear the accessed bits for the next cycle
    accessed.clear();
    // clear the updated bits for the next cycle
    Globals.state.clearUpdated();

    workerCheckForUpdate();
    document.dispatchEvent(new Event("rendercomplete"));
  }
  Globals.state.observe(debounce(renderUI));
  callAfterRender(() => Globals.designer.restoreFocus());
  renderUI();

  // Let plain taps drive the board when no access Method is active
  const uiRoot = document.getElementById("UI");
  if (uiRoot) attachTapRouter(uiRoot);

  // Warn before closing if there are unsaved changes
  window.addEventListener("beforeunload", (e) => {
    if (db.hasUnsavedChanges) {
      e.preventDefault();
      // returnValue is required by some browsers to trigger the dialog
      e.returnValue = "";
    }
  });

  // Draggable split handle between canvas (#UI) and designer panel
  const splitHandle = document.getElementById("split-handle");
  if (splitHandle) {
    splitHandle.addEventListener("pointerdown", (/** @type {PointerEvent} */ e) => {
      if (!e.isPrimary) return;
      e.preventDefault();
      splitHandle.classList.add("dragging");
      const onMove = (/** @type {PointerEvent} */ ev) => {
        if (!ev.isPrimary) return;
        const totalWidth = document.body.clientWidth;
        const SPLIT_MIN_PCT = 15;
        const SPLIT_MAX_PCT = 85;
        let pct = (ev.clientX / totalWidth) * 100;
        pct = Math.max(SPLIT_MIN_PCT, Math.min(SPLIT_MAX_PCT, pct));
        document.body.style.setProperty("--split", pct + "%");
      };
      const cleanup = () => {
        splitHandle.classList.remove("dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    });
    splitHandle.addEventListener("dblclick", () => {
      document.body.style.setProperty("--split", "50%");
    });
  }
  const { mountReact } = await import("./react/main.jsx");
  mountReact();
}

/* Watch for updates happening in other tabs */
const channel = new BroadcastChannel("os-dpi");
/** @param {MessageEvent} event */
channel.onmessage = (event) => {
  const message = /** @type {UpdateNotification} */ (event.data);
  if (db.designName == message.name) {
    if (message.action == "update") {
      start();
    } else if (message.action == "rename" && message.newName) {
      window.location.hash = message.newName;
    } else if (message.action == "unload") {
      window.close();
      if (!window.closed) {
        window.location.hash = "new";
      }
    }
  }
};
db.addUpdateListener((message) => {
  channel.postMessage(message);
});

// watch for changes to the hash such as using the browser back button
window.addEventListener("hashchange", async () => {
  sessionStorage.clear();
  if (Globals.restart) await Globals.restart();
  else await start();
});

// watch for window resize and force a redraw
window.addEventListener("resize", () => {
  if (!Globals.state) return;
  Globals.state.update();
});

start();
