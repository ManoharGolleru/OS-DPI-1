import Globals from "app/globals";
import db from "app/db";
import { TreeBase } from "../treebase";
import * as Props from "../props";
import { compileExpression } from "app/eval";
import { zipSync, strToU8 } from "fflate";
import { aiComplete, getAIKey } from "./index";
import { DESIGN_CLASSES, DESIGN_MODELS, SECTION_NAMES, SECTION_ROOTS, walk, starterDesign, validateDesign } from "./design-format";

let catalogCache;
/** Read the real component/property registry of the running OS-DPI build. */
export function componentCatalog() {
  if (catalogCache) return catalogCache;
  const result = {};
  for (const name of DESIGN_CLASSES) {
    const Constructor = TreeBase.nameToClass.get(name);
    if (!Constructor) throw new Error(`This OS-DPI build does not register ${name}.`);
    const instance = new Constructor();
    const props = {};
    for (const [key, prop] of Object.entries(instance.props)) {
      let type = "String";
      for (const kind of ["OneOfGroup", "Boolean", "Integer", "Float", "Color", "Conditional", "Expression", "Voice", "Select"]) {
        if (prop instanceof Props[kind]) { type = kind; break; }
      }
      let choices;
      if (prop.choices instanceof Map) choices = [...prop.choices.keys()];
      else if (Array.isArray(prop.choices) && prop.choices.length) choices = prop.choices;
      props[key] = {
        type, expression: !!prop.isFormulaByDefault,
        ...(choices?.length ? {choices} : {}),
        ...(prop.options.min !== undefined ? {min: prop.options.min} : {}),
        ...(prop.options.max !== undefined ? {max: prop.options.max} : {}),
      };
    }
    const allowed = name === "Layout" ? ["Page"] : instance.allowedChildren;
    const children = [...DESIGN_CLASSES].filter(child => {
      const Child = TreeBase.nameToClass.get(child);
      return allowed.some(parent => {
        const Parent = TreeBase.nameToClass.get(parent);
        return child === parent || (Parent && Child.prototype instanceof Parent);
      });
    });
    result[name] = {props, children};
  }
  catalogCache = result;
  return result;
}

export function captureDesign() {
  return {
    layout: Globals.layout.toObject(), content: JSON.parse(JSON.stringify(Globals.data.contentRows)),
    actions: Globals.actions.toObject(), method: Globals.methods.toObject(),
    pattern: Globals.patterns.toObject(), cues: Globals.cues.toObject(),
  };
}

export function selectedVoice() {
  return walk(Globals.layout.toObject()).find(n => n.className === "Speech")?.props.voiceURI || "";
}

function compactCatalog(catalog) {
  return Object.entries(catalog).map(([name, spec]) => {
    const fields = Object.entries(spec.props).filter(([key]) => !["Key", "voiceURI"].includes(key)).map(([key, p]) =>
      `${key}:${p.expression ? "expression" : p.choices ? p.choices.join("|") : p.type}`,
    );
    if ("Key" in spec.props) fields.push("Key:unique-id");
    if ("voiceURI" in spec.props) fields.push('voiceURI:""');
    return `${name}{${fields.join(",")}}>${spec.children.join(",") || "leaf"}`;
  }).join("\n");
}

const GUIDE = `You design native OS-DPI AAC interfaces, not websites or vocabulary-only lists.
Return one JSON object {title,summary,design}. design MUST contain exactly layout,content,actions,method,pattern,cues.
All trees use {className,props,children}; content is an array of scalar-valued row objects. Use only the supplied component catalog. Omit unused properties; do not invent properties. Every node has props and children, even if empty.
Use one Page with flexible nested Stacks, TabControls/TabPanels, GridFilters and named controls. Use the requested sizes, positions, colors, vocabulary, navigation and access method. Never force categories or extra phrases contrary to the request. No inferred auto-switching after words.
Use short readable labels, sufficient spacing, a message bar, Speak and Clear controls unless explicitly excluded. Compose words into $Display; speak full phrases directly. Navigation buttons must navigate, not speak their labels. UI controls are separate from vocabulary counts. Keep pages reachable with Back/Home or visible tabs. Use 12-24 vocabulary items by default, at most 36 per initial draft. For exact counts obey the user.
Grid rows/columns must fit content. Give each grid a name and filter by #grid. Use native tabs with stateName $board and TabPanel names for multipage navigation. Actions use origin equal to a control's name (Display uses Name). First matching Action wins; put specific rules first. Use #label/#say for row values, $Display/$Speak/$Tone for state. Literal strings in expressions MUST be quoted: newValue:"'home'". add_word(#label) appends to the destination state. Supply initialized state for conditional filters, except TabControl selects its first tab automatically. Never name an Action after its displayed label unless that is also its name.
Methods must contain real handlers and responses. Use NullPattern for pointer/dwell. Two-switch uses Space=next and Enter=activate with a referenced PatternManager. Row-column scanning uses PatternSelector > GroupBy(#row); group by #ComponentName before rows when multiple grids exist. Keep cue, pattern, method and timer keys unique and references consistent. Debounce and Timer Interval are SECONDS. At least one method active. Exactly one default pattern and cue. No SocketHandlers, external calls, CSS code, JS, HTML, API keys, or invented media URLs. Only use supplied media filenames. A tone-selector Grid uses content rows with sets:"tone" and labels Normal,Calm,Urgent,Angry,Sarcastic; its Action updates $Tone to #label, not $Speak. No automatically enabled microphone or cloud prediction. Predictors must stay local.
Preserve the current voice: leave all voiceURI properties empty; the host attaches the selected voice locally. Never change keys or account settings.
For an edit, preserve unchanged vocabulary and behavior and return the complete updated six sections, not a partial patch. Explain actual changes briefly in summary. No claims about clinical suitability. No commentary outside JSON.`;

/** Pure prompt assembly, tested without spending API credits. */
export function buildDesignPrompt({description, mode = "create", baseDesign = null, access = "pointer", mediaNames = [], catalog}) {
  const context = baseDesign ? JSON.parse(JSON.stringify(baseDesign)) : starterDesign(access);
  function stripVoice(value) {
    if (!value || typeof value !== "object") return;
    if (value.props && typeof value.props === "object") delete value.props.voiceURI;
    for (const child of Object.values(value)) if (child && typeof child === "object") stripVoice(child);
  }
  stripVoice(context);
  const system = `${GUIDE}\nCOMPONENT CATALOG (properties and allowed children):\n${compactCatalog(catalog)}`;
  const prompt = JSON.stringify({
    task: mode === "create" ? "Create a complete new interface" : "Edit the supplied design; preserve unrelated parts",
    request: description, requestedAccess: access,
    availableMedia: mediaNames,
    [baseDesign ? "currentDesign" : "validNativeExample"]: context,
  });
  return {system, prompt};
}

export async function generateDesign({description, model, mode, baseDesign, access, mediaNames, voiceURI, signal, onUsage}) {
  if (!DESIGN_MODELS.some(([id]) => id === model)) throw new Error("Select a supported design model.");
  if (!getAIKey("groq")) throw new Error("Add your Groq key under Content > Keys > AI service (Groq).");
  const {system, prompt} = buildDesignPrompt({description, mode, baseDesign, access, mediaNames, catalog: componentCatalog()});
  // The published free tier is 8K TPM, not the model's 131K context. This is a size
  // guard, not an exact tokenizer or a guarantee of remaining account quota.
  const approximateInput = Math.ceil((system.length + prompt.length) / 3.5);
  const maxTokens = 3600;
  if (approximateInput + maxTokens > 7800) throw new Error(
    "This request is too large for the free-tier design budget. Use a smaller board or edit fewer pages. Nothing was changed.",
  );
  const text = await aiComplete({
    providerId: "groq", model, system, prompt, json: true,
    maxTokens, effort: model.startsWith("qwen/") ? "none" : "low", signal, onUsage,
  });
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error("The model did not return complete JSON. Ask for a smaller design and regenerate. Nothing was changed."); }
  if (!result || typeof result.title !== "string" || typeof result.summary !== "string" || !result.design) throw new Error("The model omitted the title, summary, or native design.");
  const draft = result.design;
  const checked = validateDesign(draft, componentCatalog(), {
    checkExpression: value => !compileExpression(value)[1], mediaNames,
  });
  const active = !checked.errors.length ? draft.method.children.filter(n => n.props.Active === true || n.props.Active === "true") : [];
  const handlers = active.flatMap(walk);
  if (access === "two-switch" && (![" ", "Enter"].every(key => handlers.some(n => n.className === "HandlerKeyCondition" && n.props.Key === key)) || !handlers.some(n => n.className === "ResponderNext"))) checked.errors.push("Use Space=Next and Enter=Activate for the requested two-switch access.");
  if (access === "dwell" && !handlers.some(n => n.className === "ResponderStartTimer")) checked.errors.push("Dwell access requires a timer and its handlers.");
  if (access === "pointer" && !handlers.some(n => n.className === "PointerHandler" && ["pointerup", "pointerdown"].includes(n.props.Signal))) checked.errors.push("Mouse/touch access requires a pointer activation handler.");
  if (checked.errors.length) {
    const error = new Error("Draft rejected. No board was changed.\n" + checked.errors.join("\n"));
    error.name = "DesignValidationError";
    // Keep the rejected draft local for an explicit repair, never auto-apply it.
    error.draft = result;
    throw error;
  }
  for (const n of walk(draft.layout)) if (n.className === "Speech") n.props.voiceURI = voiceURI;
  return {title: result.title.slice(0, 80), summary: result.summary.slice(0, 1200), design: draft, warnings: checked.warnings};
}

/** Pack the exact six native files and only referenced existing media. No logs or keys. */
export async function packDesign(design, sourceName) {
  const files = Object.fromEntries(SECTION_NAMES.map(name => [`${name}.json`, strToU8(JSON.stringify(design[name]))]));
  const references = new Set([
    ...design.content.map(row => row.symbol),
    ...walk(design.layout).map(n => n.props.symbol),
  ].filter(Boolean));
  const database = await db.dbPromise;
  for (const name of references) {
    const record = await database.get("media", [sourceName, name]);
    if (!record) throw new Error(`Media is no longer available: ${name}`);
    if (SECTION_NAMES.some(section => name === `${section}.json`) || /(^\/|\.\.\/)/.test(name)) throw new Error("Unsafe media filename.");
    files[name] = new Uint8Array(await record.content.arrayBuffer());
  }
  return new Blob([zipSync(files)], {type: "application/octet-stream"});
}

/** Save a separate board in one IndexedDB transaction. The current board is untouched. */
export async function saveDesignCopy(draft, sourceName) {
  const name = await db.uniqueName(draft.title || "AI-interface");
  const database = await db.dbPromise;
  const refs = new Set([...draft.design.content.map(r => r.symbol), ...walk(draft.design.layout).map(n => n.props.symbol)].filter(Boolean));
  const media = [];
  for (const file of refs) {
    const record = await database.get("media", [sourceName, file]);
    if (!record) throw new Error(`Media is no longer available: ${file}`);
    media.push([file, record]);
  }
  const tx = database.transaction(["store5", "media"], "readwrite");
  for (const section of SECTION_NAMES) tx.objectStore("store5").put({name, type: section, data: draft.design[section]});
  for (const [file, record] of media) tx.objectStore("media").put({...record, name: file, content: record.content}, [name, file]);
  await tx.done;
  return name;
}
