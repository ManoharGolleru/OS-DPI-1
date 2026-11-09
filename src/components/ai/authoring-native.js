/** Adapter to OS-DPI's existing registry, renderer, storage, and action language. */
import {render} from "uhtml";
import Globals from "app/globals";
import db from "app/db";
import {Data} from "app/data";
import {compileExpression, Functions} from "app/eval";
import {postRender} from "app/render";
import {TreeBase} from "../treebase";
import * as Props from "../props";
import {blankLayout, blankActions} from "../pieces";
import defaultMethods from "../access/method/defaultMethods";
import defaultPatterns from "../access/pattern/defaultPatterns";
import defaultCues from "../access/cues/defaultCues";
import {AuthoringDocument, SECTIONS, ROOTS, walk, clone, node} from "./authoring-document";

const globalNames={layout:"layout",actions:"actions",method:"methods",pattern:"patterns",cues:"cues"};
let catalog;
export function nativeCatalog() {
  if(catalog)return catalog;
  const result={};
  for(const [name,Constructor] of TreeBase.nameToClass) {
    const instance=new Constructor();
    const props={};
    for(const [key,p] of Object.entries(instance.props)) {
      const type=p instanceof Props.Integer?"integer":p instanceof Props.Float?"number":p instanceof Props.Boolean?"boolean":p instanceof Props.Code?"css":"string";
      const choices=Array.isArray(p.choices)?p.choices:p.choices instanceof Map?[...p.choices.keys()]:[];
      props[key]={type,default:p._value ?? "",...(p.isFormulaByDefault?{expression:true}:{}),
        ...(choices.length?{choices}:{}),...(p.options.min!==undefined?{min:p.options.min}:{}),
        ...(p.options.max!==undefined?{max:p.options.max}:{}),...(p.options.title?{about:p.options.title}:{})};
    }
    const children=[...TreeBase.nameToClass].filter(([child,C])=>(instance.allowedChildren || []).some(p=>child===p || C.prototype instanceof (TreeBase.nameToClass.get(p) || class {}))).map(([n])=>n);
    result[name]={props,children};
  }
  const reachable=new Set(Object.values(ROOTS));
  const visit=name=>{for(const child of result[name]?.children || [])if(!reachable.has(child)){reachable.add(child);visit(child);}};
  for(const name of [...reachable])visit(name);
  catalog=Object.fromEntries([...reachable].map(n=>[n,result[n]]));
  return catalog;
}
export function expressionError(value) {
  const bare=value.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g,"''");
  if(/\b(?:constructor|prototype|__proto__|window|document|globalThis|fetch|eval|Function)\b/.test(bare))return "Use native state expressions, not JavaScript or prototype access.";
  const calls=[...bare.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(x=>x[1]);
  if(calls.some(n=>!Object.hasOwn(Functions,n)))return "Use only OS-DPI's existing expression functions.";
  return compileExpression(value)[1]?.message || null;
}
export function captureNative() {
  return {layout:Globals.layout.toObject({omittedProps:[],includeIds:true}),content:clone(Globals.data.contentRows),
    actions:Globals.actions.toObject({omittedProps:[],includeIds:true}),method:Globals.methods.toObject({omittedProps:[],includeIds:true}),
    pattern:Globals.patterns.toObject({omittedProps:[],includeIds:true}),cues:Globals.cues.toObject({omittedProps:[],includeIds:true})};
}
export function emptyNative() {
  const result=clone({layout:blankLayout,content:[],actions:blankActions,method:defaultMethods,pattern:defaultPatterns,cues:defaultCues});
  const schemas=nativeCatalog(), keys=new Set();
  for(const section of Object.keys(ROOTS))for(const n of walk(result[section])) {
    n.props=Object.fromEntries(Object.entries(n.props).filter(([k])=>schemas[n.className]?.props[k]));
    if(n.props.Key){
      if(keys.has(n.props.Key))n.props.Key="native_"+n.className+"_"+keys.size;
      keys.add(n.props.Key);
    }
  }
  return result;
}
export function documentSession(design, mediaNames=[]) {
  return new AuthoringDocument(design,nativeCatalog(),{expressionCheck:expressionError,mediaNames});
}
export function fingerprint(value) {
  const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).filter(k=>k!=="id"&&k!=="_ref").sort().map(k=>[k,sorted(v[k])])):v;
  return JSON.stringify(sorted(value));
}
export function examples(topic="") {
  const hints={
    keyboard:"Use recipe keyboard to insert native key rows and actions, or assemble custom keyboards with ordinary Grid/content/bind edits. Recipe is optional and every part remains editable.",
    navigation:"TabControl has stateName ($view), children TabPanel with unique name and label. Tabs navigate natively, with no action needed. A Button can bind updates {$view:\"'tab_name'\"}. Nested Stacks control arrangement. Page contains one visible tree.",
    state:"Use Display stateName=$Score and Button name=answer. Bind answer condition '' updates {$Score:'increment(1)'}. Bind init updates {$Score:'0'}. Conditional rules run first-match; put specific conditions before an unconditional rule. Model-written JavaScript is never needed.",
    access:"Methods connect KeyHandler, PointerHandler, TimerHandler or SocketHandler to HandlerResponses. ResponderEmit fires an action whose origin is the enclosing Method.Name. Timer Interval and debounce are seconds. PatternManager.Key is referenced by Method.Pattern; NullPattern for pointer input. PatternSelector > GroupBy #ComponentName then #row scans multiple grids. Cues reference Cue.Key; use DefaultCue to reuse the default. Existing default methods include mouse, dwell and two-switch: inspect and update them instead of rebuilding.",
    speech:"Speech watches stateName ($Speak by default). A Speak button binds {$Speak:'$Display'} with condition '$Display'. Clear binds {$Display:\"''\"}. Character insertion uses add_letter(#label), words use add_word(#label). Backspace uses replace_last_letter(''). Expression string literals must be quoted. Preserve voiceURI, never invent a voice ID.",
    media:"Use only uploaded media filenames. Grid rows use symbol for an image and label for its caption; a Button has symbol. Audio watches its stateName; an ActionUpdate sets that state to a quoted audio filename. Inspect Audio, VSD and their native schemas for other media layouts. Do not invent filenames or URLs.",
  };
  return topic ? hints[topic] || {available:Object.keys(hints)} : hints;
}

/** Optional native fragment; all resulting components remain generically editable. */
export function keyboardRecipe(session,{parent="page",backspace=false,letters=["qwertyuiop","asdfghjkl","zxcvbnm"],color="#dbeafe",displayPosition="top"}={}) {
  if(!Array.isArray(letters)||!letters.length||letters.length>12 || letters.some(s=>typeof s!=="string"||!s.length||[...s].length>40))throw new Error("Keyboard rows must be nonempty character strings.");
  const destination=session.find(parent);
  if(!session.catalog[destination.className].children.includes("Stack"))throw new Error("Choose a layout container for the keyboard.");
  const prefix=session.unique("typing");
  const ref=label=>prefix+"_"+label;
  const make=(cls,props,children=[],name)=>({...node(cls,props,children),...(name?{ref:ref(name)}:{})});
  const controls=make("Stack",{direction:"row",scale:1},[
    make("Display",{stateName:"$Display",Name:"",scale:5,fontSize:2},[],"message"),
    make("Button",{name:ref("speak"),label:"Speak"},[],"speak"),
    make("Button",{name:ref("clear"),label:"Clear"},[],"clear"),
    make("Button",{name:ref("space"),label:"Space"},[],"space"),
    ...(backspace?[make("Button",{name:ref("backspace"),label:"Backspace"},[],"backspace")]:[]),
  ],"controls");
  const grids=letters.map((line,i)=>make("Grid",{name:ref("keys"+i),rows:1,columns:[...line].length,scale:1,fillItems:true,buttonColor:color},[
    make("GridFilter",{field:"#grid",operator:"equals",value:"'"+ref("keys"+i)+"'"})
  ],"keys"+i));
  const keyArea=make("Stack",{direction:"column",scale:4},grids,"keys");
  const insert={op:"insert",parent,nodes:[make("Stack",{direction:"column",scale:6},displayPosition==="bottom"?[keyArea,controls]:[controls,keyArea],"keyboard")]};
  const ops=[insert];
  if(!walk(session.design.layout).some(n=>n.className==="Speech"))ops.unshift({op:"insert",parent:"page",node:make("Speech",{stateName:"$Speak",voiceURI:""},[],"voice")});
  letters.forEach((line,i)=>{
    ops.push({op:"insert",parent:"content",characters:line,defaults:{grid:ref("keys"+i)}});
    ops.push({op:"bind",target:ref("keys"+i),rules:[{updates:{$Display:"add_letter(#label)"}}]});
  });
  const bindings={speak:{$Speak:"$Display"},clear:{$Display:"''"},space:{$Display:"add_letter(' ')"},...(backspace?{backspace:{$Display:"replace_last_letter('')"}}:{})};
  for(const [target,updates] of Object.entries(bindings))ops.push({op:"bind",target:ref(target),rules:[{condition:target==="speak"?"$Display":"",updates}]});
  const result=session.edit(ops);
  return {...result,keyboard:ref("keyboard"),controls:ref("controls"),keys:ref("keys"),note:"Native components inserted; use ordinary edits to customize any part."};
}

/** Use the existing action compiler against temporary state, without external effects. */
export function exercise(session,tests=[]) {
  if(!Array.isArray(tests)||tests.length>12)throw new Error("Provide at most 12 interaction checks.");
  const run=(expression,states,data)=>{
    if(/\b(?:load_design|toggle_speech_suggestions|open_editor)\s*\(/.test(expression))throw new Error("External effects are not executed by interaction tests.");
    const [fn,error]=compileExpression(expression);
    if(error)throw error;
    return fn({states,data});
  };
  return tests.map(test=>{
    try {
      const states={...(test.initial || {})};
      const press=(origin,data={})=>{
        const match=session.design.actions.children.find(a=>[origin,"*"].includes(a.props.origin) && a.children.filter(c=>c.className==="ActionCondition").every(c=>!c.props.Condition || run(c.props.Condition,states,data)));
        if(!match)throw new Error(`No action matched '${origin}'.`);
        const updates=match.children.filter(n=>n.className==="ActionUpdate").map(u=>[u.props.stateName,run(u.props.newValue,states,data)]);
        for(const [key,value] of updates)states[key]=typeof value==="function"?value(states[key]):value;
      };
      if(session.design.actions.children.some(a=>a.props.origin==="init"))press("init");
      for(const step of test.steps || []) {
        const n=session.find(step.target), origin=n.props.name || n.props.Name;
        let data=step.data || {};
        if(step.label!==undefined) {
          const row=session.design.content.find(r=>r.label===step.label && (!r.grid || r.grid===origin));
          if(!row)throw new Error(`No content label '${step.label}' for '${origin}'.`);
          data={...row,...data};
        } else if(n.className==="Button")data={label:n.props.label,...data};
        press(origin,data);
      }
      for(const [key,want] of Object.entries(test.expect || {}))if(states[key]!==want)throw new Error(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(states[key])}.`);
      return {name:test.name || "Interaction",ok:true,states};
    }catch(e){return {name:test.name || "Interaction",ok:false,error:e.message};}
  });
}

function stop(roots) {
  roots.method?.stop();
  for(const root of Object.values(roots))for(const n of walk(root)) {
    n.cancelTimers?.(); n._unsubscribeState?.(); n._abort?.abort();
    if(n._timer!==undefined && n._timer!==null)clearTimeout(n._timer);
  }
}
function nativeDraw() {
  render(document.getElementById("cues"),Globals.cues.template());
  render(document.getElementById("UI"),Globals.layout.children[0].template());
  postRender();
  Globals.methods.refresh();
  Globals.state.clearUpdated();
}
export function installNative(design,{resetState=true}={}) {
  const before=Object.fromEntries(Object.entries(globalNames).map(([s,g])=>[s,Globals[g]]));
  const oldData=Globals.data, oldValues={...Globals.state.values}, panels=Globals.designer?.children;
  const next={};
  stop(before);
  try {
    if(resetState) {
      Globals.state.values=Object.fromEntries(Object.entries(oldValues).filter(([k])=>!k.startsWith("$")));
      Globals.state.clearUpdated();
    }
    Globals.data=new Data(clone(design.content));
    for(const s of ["layout","actions","cues","pattern","method"]) {
      next[s]=TreeBase.fromObject(design[s]);
      Globals[globalNames[s]]=next[s];
    }
    if(panels)Globals.designer.children=panels.map(p=>{
      const s=Object.keys(before).find(s=>p===before[s]);
      const root=s?next[s]:p;
      root.parent=Globals.designer;
      return root;
    });
    for(const root of Object.values(next))root.changeStack?.save(root.toObject({omittedProps:[],includeIds:true}));
    Globals.actions.configure();
    nativeDraw();
    Globals.methods.configure();
    for(const root of Object.values(before))TreeBase.removeFromIdMap(root);
    return captureNative();
  }catch(error){
    stop(next);
    for(const root of Object.values(next))TreeBase.removeFromIdMap(root);
    for(const [s,g] of Object.entries(globalNames))Globals[g]=before[s];
    Globals.data=oldData;Globals.state.values=oldValues;
    if(panels)Globals.designer.children=panels;
    Globals.methods.configure();
    nativeDraw();
    throw error;
  }
}
export async function persistNative(design,{name,sourceName,copy=false}) {
  const database=await db.dbPromise;
  const media=copy?await database.getAllKeys("media"):[];
  const assets=[];
  for(const key of media)if(key[0]===sourceName)assets.push([key[1],await database.get("media",key)]);
  const records=copy?await database.getAllFromIndex("store5","by-name",sourceName):[];
  const tx=database.transaction(["store5","media","saved"],"readwrite");
  for(const r of records)if(!SECTIONS.includes(r.type))tx.objectStore("store5").put({...r,name});
  for(const s of SECTIONS)tx.objectStore("store5").put({name,type:s,data:design[s]});
  for(const [filename,record] of assets)tx.objectStore("media").put(record,[name,filename]);
  tx.objectStore("saved").delete(name);
  await tx.done;
}
export async function acceptNative(design,{sourceName,newCopy=true,title="AI interface"}={}) {
  const previous=captureNative(), oldName=db.designName;
  const name=newCopy?await db.uniqueName(title):oldName;
  let installed;
  try {
    installed=installNative(design);
    await persistNative(installed,{name,sourceName:sourceName || oldName,copy:newCopy});
  }catch(e){
    if(fingerprint(captureNative())!==fingerprint(previous))installNative(previous);
    throw e;
  }
  db.setDesignName(name);db.fileName=name+".osdpi";db.fileHandle=null;db.hasUnsavedChanges=true;
  history.replaceState({},"",location.pathname+location.search+"#"+encodeURIComponent(name));
  db.notify({action:"update",name});
  Globals.state.update({editing:true});
  return {name,before:previous,after:installed};
}
