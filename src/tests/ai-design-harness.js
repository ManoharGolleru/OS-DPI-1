import "@ungap/custom-elements";
import "../components/index.js";
import {render} from "uhtml";
import Globals from "../globals.js";
import {TreeBase} from "../components/treebase.js";
import {Messages} from "../components/errors.js";
import {Data} from "../data.js";
import {State} from "../state.js";
import db, {unPackDesign} from "../db.js";
import {InterfaceDesigner} from "../components/ai/design-panel.js";
import {starterDesign, validateDesign} from "../components/ai/design-format.js";
import {componentCatalog, captureDesign, packDesign, saveDesignCopy} from "../components/ai/design-engine.js";
import {getAIModel, setAIKey} from "../components/ai/index.js";
import {postRender} from "../render.js";

function mount(design) {
  Globals.methods?.stop();
  Globals.state = new State();
  Globals.state.define("editing", false);
  Globals.data = new Data(design.content);
  for (const [section, name] of Object.entries({layout:"layout",actions:"actions",method:"methods",pattern:"patterns",cues:"cues"})) {
    Globals[name] = TreeBase.fromObject(design[section]);
  }
  Globals.error = new Messages();
  function draw() {
    render(document.getElementById("cues"), Globals.cues.template());
    render(document.getElementById("UI"), Globals.layout.children[0].template());
    postRender();
    Globals.methods.refresh();
    Globals.state.clearUpdated();
  }
  Globals.state.observe(draw);
  draw();
  Globals.actions.configure();
  Globals.methods.configure();
}

db.setDesignName("original");
setAIKey("gsk_test_not_a_real_key", "groq");
const initial = starterDesign();
for (const [section, value] of Object.entries(initial)) await db.write(section, value);
mount(initial);
const panel = new InterfaceDesigner();
panel.open = true;
const drawPanel = () => render(document.getElementById("test-panel"), panel.template());
Globals.state.observe(drawPanel);
drawPanel();
window.fixture = {panel, mount, starterDesign, validateDesign, componentCatalog, captureDesign, packDesign, saveDesignCopy, unPackDesign, getAIModel, Globals, db};
