import Globals from "app/globals";
import db from "app/db";
import {TreeBase} from "../treebase";
import * as Props from "../props";
import {compileExpression} from "app/eval";
import {zipSync, strToU8} from "fflate";
import {aiComplete, getAIKey} from "./index";
import {DESIGN_CLASSES, DESIGN_MODELS, SECTION_NAMES, walk, validateDesign} from "./design-format";
import {applyDesignOperations, supportedEdits} from "./design-operations";

let catalogCache;
/** Reuse the component registry that the current OS-DPI runtime already owns. */
export function componentCatalog() {
  if (catalogCache) return catalogCache;
  const catalog={};
  for (const name of DESIGN_CLASSES) {
    const Constructor=TreeBase.nameToClass.get(name);
    if (!Constructor) throw new Error("Component not registered: "+name);
    const instance=new Constructor();
    const props={};
    for (const [key,prop] of Object.entries(instance.props)) {
      let type="String";
      for (const kind of ["OneOfGroup","Boolean","Integer","Float","Color","Conditional","Expression","Voice","Select"]) {
        if (prop instanceof Props[kind]) {type=kind;break;}
      }
      const choices=prop.choices instanceof Map ? [...prop.choices.keys()] : Array.isArray(prop.choices) ? prop.choices : null;
      props[key]={type,expression:!!prop.isFormulaByDefault,
        ...(choices?.length?{choices}:{}),
        ...(prop.options.min!==undefined?{min:prop.options.min}:{}),
        ...(prop.options.max!==undefined?{max:prop.options.max}:{})};
    }
    const allowed=name==="Layout"?["Page"]:instance.allowedChildren;
    const children=[...DESIGN_CLASSES].filter(child=>{
      const Child=TreeBase.nameToClass.get(child);
      return allowed.some(parent=>{
        const Parent=TreeBase.nameToClass.get(parent);
        return child===parent || (Parent && Child.prototype instanceof Parent);
      });
    });
    catalog[name]={props,children};
  }
  return catalogCache=catalog;
}
export function captureDesign() {
  return {
    layout:Globals.layout.toObject(),
    content:JSON.parse(JSON.stringify(Globals.data.contentRows)),
    actions:Globals.actions.toObject(),
    method:Globals.methods.toObject(),
    pattern:Globals.patterns.toObject(),
    cues:Globals.cues.toObject(),
  };
}
export function selectedVoice() {
  return walk(Globals.layout.toObject()).find(n=>n.className==="Speech")?.props.voiceURI || "";
}
export function preserveVoice(design,voiceURI) {
  for(const section of walk(design.layout)) if(section.className==="Speech" && !section.props.voiceURI) section.props.voiceURI=voiceURI;
  return design;
}

/** The current model only proposes commands; it never authors methods or expressions. */
export const EDIT_SCHEMA = {
  type:"object", additionalProperties:false,
  properties:{
    summary:{type:"string"},
    operations:{type:"array",items:{
      type:"object",additionalProperties:false,
      properties:{
        op:{type:"string",enum:supportedEdits},
        target:{type:["string","null"]},
        text:{type:["string","null"]},
        value:{type:["string","number","boolean","null"]},
        items:{type:"array",items:{type:"string"}},
      },
      required:["op","target","text","value","items"],
    }},
  },
  required:["summary","operations"],
};

const SYSTEM = [
  "You select commands for the existing OS-DPI AAC interface editor.",
  "Do NOT write components, JSON sections, actions, code, or instructions to call APIs.",
  "Return JSON conforming to the command schema. The application constructs all native components and actions.",
  "Each operation changes only its target. Keep unrelated voice, content, methods, patterns, cues, and media untouched.",
  "For a QWERTY typing keyboard with display/Speak/Clear choose create_keyboard. Add optional Backspace only if requested (value=true), otherwise false. Space is included.",
  "For a new vocabulary board choose create_board with its exact requested labels in items and columns in value. No extra categories or phrases.",
  "For an existing board prefer set_columns, set_button_color, set_all_grid_colors, set_spacing, rename_word, add_words, set_display_position and other targeted operations.",
  "For create_keyboard and create_board use target='pointer', 'dwell', or 'two-switch'. For edits target is the existing grid/control name.",
  "For add_tab use text=tab name and items=words on that tab. Existing tab navigation is handled by OS-DPI.",
  "For rename_word and remove_word target is the current unique label or index:NUMBER; rename_word text is the new label.",
  "For set_color, set_button_color, set_all_grid_colors, set_cue_color, set_dwell_time, set_ui_scale and set_columns put the new setting in value.",
  "For set_display_position value is 'top' or 'bottom'. For set_access value is pointer, dwell or two-switch.",
  "Respect the requestedAccess for create_keyboard and create_board. All unused target/text/value fields must be null. Unused items is []. One to eight operations.",
  "No external URLs, API keys, network actions, CSS, generated program code or unrelated edits.",
  "If user requests unsupported behavior, return an empty operations array and a short explanation in summary.",
].join("\n");

function boardSummary(design) {
  const nodes=walk(design.layout);
  const components=nodes.filter(n=>["Grid","Display","Button","TabControl","TabPanel","Stack"].includes(n.className))
    .slice(0,65).map(n=>({
      type:n.className,
      name:n.props.name||n.props.Name||"",
      label:n.props.label||"",
      ...(n.className==="Grid"?{rows:n.props.rows,columns:n.props.columns,color:n.props.buttonColor,spacing:n.props.spacing}:{}),
    }));
  return {
    components,
    content:design.content.slice(0,90).map((r,index)=>({index,label:r.label,grid:r.grid||"",say:r.say||""})),
    access:design.method?.children?.filter(n=>n.props?.Active===true||n.props?.Active==="true")
      .map(n=>n.props.Name)||[],
    cues:design.cues?.children?.map(n=>({name:n.props.Name,color:n.props.Color}))||[],
  };
}
export function designPrompt({description,mode,design,access="pointer"}) {
  return {system:SYSTEM,prompt:JSON.stringify({
    task:mode==="create"?"Create a new interface":"Change the existing interface",
    request:description,requestedAccess:access,existing:mode==="create"?null:boardSummary(design),
    supportedOperations:supportedEdits,
  })};
}

export function checkDraft(design, baseline=null, mediaNames=[]) {
  const validate=x=>validateDesign(x,componentCatalog(),{
    checkExpression:value=>!compileExpression(value)[1],
    mediaNames,
  });
  const result=validate(design);
  const previous=baseline?validate(baseline).errors:[];
  // Keep counts of pre-existing errors, even if layout positions move.
  // Only safe, locally implemented operations get this preservation rule.
  const reason=e=>e.includes(": ")?e.slice(e.indexOf(": ")+2):e;
  const counts=new Map();
  for(const e of previous) counts.set(reason(e),(counts.get(reason(e))||0)+1);
  const errors=result.errors.filter(e=>{
    const count=counts.get(reason(e))||0;
    if(count){counts.set(reason(e),count-1);return false;}
    return true;
  });
  return {errors,warnings:[...result.warnings,...(previous.length?["The imported file already contains advanced or unverified components. Test them before use."]:[])]};
}
export function updateDraft(source,operations,{baseline=source,mediaNames=[]}={}) {
  const changed=applyDesignOperations(source,operations);
  const checked=checkDraft(changed,baseline,mediaNames);
  if (checked.errors.length) throw new Error("Edit was rejected. The draft is unchanged.\n"+checked.errors.join("\n"));
  return {design:changed,warnings:checked.warnings};
}
export async function generateEdits({description,mode,model,design,access="pointer",signal,onUsage}) {
  if (!DESIGN_MODELS.some(([id])=>id===model)) throw new Error("Select one of the supported Groq models.");
  if (!getAIKey("groq")) throw new Error("Add a Groq API key under Content → Keys.");
  const {system,prompt}=designPrompt({description,mode,design,access});
  const approx=Math.ceil((system.length+prompt.length)/3.5);
  if (approx+1500>7800) throw new Error("This board is too large for the free-tier request. Choose a smaller edit.");
  const response=await aiComplete({
    providerId:"groq",model,system,prompt,schema:EDIT_SCHEMA,
    maxTokens:1500,effort:"low",signal,onUsage,
  });
  let parsed;
  try {parsed=JSON.parse(response);}catch{throw new Error("Groq did not return valid editing commands. Nothing changed.");}
  if (!parsed || !Array.isArray(parsed.operations)) throw new Error("Groq omitted the edit operations.");
  if (!parsed.operations.length) throw new Error(parsed.summary||"Groq did not propose a supported edit.");
  if (parsed.operations.length>12) throw new Error("Too many editing commands. Narrow the request.");
  return {operations:parsed.operations,summary:String(parsed.summary||"Updated interface").slice(0,500)};
}

/** Preserve every associated media entry when exporting, including unused
 * assets present in imported boards. No keys, logs or private settings.
 */
export async function collectMedia(sourceName,importedMedia=new Map()) {
  const all=new Map(importedMedia);
  if (sourceName && !importedMedia.size) {
    const database=await db.dbPromise;
    for (const name of await db.listMedia()) {
      const record=await database.get("media",[sourceName,name]);
      if (record) all.set(name,record.content);
    }
  }
  return all;
}
function safeAsset(name) {
  if(typeof name!=="string" || !name || /^\//.test(name) || /\\/.test(name) || name.split("/").some(part=>!part || part==="." || part==="..") || /[\x00-\x1f]/.test(name) || SECTION_NAMES.some(s=>name===s+".json"))
    throw new Error("Unsafe media filename: "+name);
}
export async function packDesign(design,sourceName,importedMedia=new Map()) {
  const files=Object.fromEntries(SECTION_NAMES.map(s=>[s+".json",strToU8(JSON.stringify(design[s]))]));
  const media=await collectMedia(sourceName,importedMedia);
  for (const [name,blob] of media) {
    safeAsset(name);
    files[name]=new Uint8Array(await blob.arrayBuffer());
  }
  return new Blob([zipSync(files)],{type:"application/octet-stream"});
}
export async function saveDesignCopy(draft,sourceName,importedMedia=new Map()) {
  const name=await db.uniqueName(draft.title||"AI-interface");
  const media=await collectMedia(sourceName,importedMedia);
  const database=await db.dbPromise;
  const tx=database.transaction(["store5","media"],"readwrite");
  for (const section of SECTION_NAMES) tx.objectStore("store5").put({name,type:section,data:draft.design[section]});
  for (const [filename,blob] of media) {
    safeAsset(filename);
    tx.objectStore("media").put({name:filename,content:blob},[name,filename]);
  }
  await tx.done;
  return name;
}
