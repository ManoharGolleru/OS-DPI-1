/** Adapter to OS-DPI's existing registry, renderer, storage, and action language. */
import {render} from "uhtml";
import Globals from "app/globals";
import db from "app/db";
import {Data} from "app/data";
import {State} from "app/state";
import {compileExpression, Functions,nativeFunctionNames,canEvaluateIsolated} from "app/eval";
import {postRender} from "app/render";
import {TreeBase,componentDescriptions} from "../treebase";
import * as Props from "../props";
import {isValidColor} from "../style";
import {blankLayout, blankActions, visualClasses} from "../pieces";
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
    // Construct fields, never call init/configure while reading metadata.
    const instance=new Constructor();
    const props={};
    for(const [key,p] of Object.entries(instance.props)) {
      const type=p instanceof Props.Integer?"integer":p instanceof Props.Float?"number":p instanceof Props.Boolean||p instanceof Props.OneOfGroup?"boolean":p instanceof Props.Code?"css":"string";
      const choices=Array.isArray(p.choices)?p.choices:p.choices instanceof Map?[...p.choices.keys()]:[];
      props[key]={type,kind:p.constructor.name,default:p instanceof Props.UID?"":p._value ?? "",...(p instanceof Props.UID?{generated:true}:{}),
        ...(p instanceof Props.OneOfGroup?{exclusiveGroup:p.options.group}:{}),...(p.isFormulaByDefault?{expression:true}:{}),
        ...(choices.length?{choices}:{}),...(p.options.min!==undefined?{min:p.options.min}:{}),
        ...(p.options.max!==undefined?{max:p.options.max}:{}),...(p.options.title?{about:p.options.title}:{}),
        ...(p instanceof Props.Color?{validate:value=>isValidColor(String(value))?null:"Invalid native color. Use a color name or CSS color without expression quotes; formulas start with =."}:{})};
    }
    const children=[...TreeBase.nameToClass].filter(([child,C])=>(instance.allowedChildren || []).some(p=>child===p || C.prototype instanceof (TreeBase.nameToClass.get(p) || class {}))).map(([n])=>n);
    result[name]={props,children,description:componentDescriptions[name] || name};
  }
  // Only types reachable from native design roots, not editor panels or error UI.
  const reachable=new Set(Object.values(ROOTS));
  const visit=name=>{for(const child of result[name]?.children || [])if(!reachable.has(child)){reachable.add(child);visit(child);}};
  for(const name of [...reachable])visit(name);
  catalog=Object.fromEntries([...reachable].map(n=>[n,result[n]]));
  return catalog;
}
export function expressionError(value) {
  if(/^[A-Za-z_]\w*$/.test(value.trim()) && !["true","false","null","undefined"].includes(value.trim()) && !(value.trim() in Functions))return "Unknown expression name. Quote literal text, e.g. 'Ready'; use $State or #field for values.";
  const bare=value.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g,"''");
  if(/\b(?:constructor|prototype|__proto__|window|document|globalThis|fetch|eval|Function)\b/.test(bare))return "Use native state expressions, not JavaScript or prototype access.";
  const calls=[...bare.matchAll(/([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g)].map(x=>x[1].replace(/\s/g,""));
  const registered=new Set(nativeFunctionNames());
  if(calls.some(n=>!registered.has(n)))return "Use only OS-DPI's existing expression functions. Inspect functions for their exact names.";
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
    // Use this build's current property definitions for new boards.
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
  const sorted=(v,scope="data")=>Array.isArray(v)?v.map(x=>sorted(x,scope)):v&&typeof v==="object"?Object.fromEntries(
    Object.keys(v).filter(k=>scope!=="tree"||!["id","_ref"].includes(k)).sort().map(k=>[k,sorted(v[k],
      scope==="document"&&Object.hasOwn(ROOTS,k)||scope==="tree"&&k==="children"?"tree":"data")])):v;
  return JSON.stringify(sorted(value,"document"));
}

/** Optional reference material, not a gate on what the generic editor accepts. */
export function examples(topic="") {
  const hints={
    keyboard:"Use recipe keyboard to insert native key rows and actions, or assemble custom keyboards with ordinary Grid/content/bind edits. Recipe is optional and every part remains editable.",
    navigation:"TabControl has stateName ($view), children TabPanel with unique name and label. Tabs navigate natively, with no action needed. A Button can bind updates {$view:\"'tab_name'\"}. Nested Stacks control arrangement. Page contains one visible tree.",
    state:"Use Display stateName=$Score and Button ref answer; its native name is generated. Bind target answer. increment(delta) returns a state updater: increment(1) adds one; increment(-1) subtracts one. OS-DPI supplies the current state. Direct formulas $Score+1 and $Score>0 ? $Score-1 : 0 also work. Bind init updates $Score expression 0. Conditional rules run first-match; put specific conditions before an unconditional rule.",
    access:"Methods connect KeyHandler, PointerHandler, TimerHandler or SocketHandler to HandlerResponses. ResponderEmit fires an action whose origin is the enclosing Method.Name. Timer Interval and debounce are seconds. PatternManager.Key is referenced by Method.Pattern; NullPattern for pointer input. PatternSelector > GroupBy #ComponentName then #row scans multiple grids. Cues reference Cue.Key; use DefaultCue to reuse the default. Existing default methods include mouse, dwell and two-switch: inspect and update them instead of rebuilding.",
    timer:{note:"Generic wiring under the method section. Adapt key, seconds and state; use unique refs. Condition and responder are siblings. TimerName uses generated Timer.Key. bind creates Actions separately. Timer preserves the starting event fields.",command:{name:"edit",operations:[
      {op:"insert",parent:"method",className:"Method",ref:"timerMethod",props:[{key:"Active",value:true},{key:"Pattern",value:"NullPattern"}],index:null},
      {op:"insert",parent:"timerMethod",className:"Timer",ref:"delay",props:[{key:"Interval",value:2}],index:null},
      {op:"insert",parent:"timerMethod",className:"KeyHandler",ref:"startTimer",props:[{key:"Signal",value:"keyup"}],index:null},
      {op:"insert",parent:"startTimer",className:"HandlerKeyCondition",ref:null,props:[{key:"Key",value:"t"}],index:null},
      {op:"insert",parent:"startTimer",className:"ResponderStartTimer",ref:null,props:[{key:"TimerName",value:"@delay.Key"}],index:null},
      {op:"insert",parent:"timerMethod",className:"TimerHandler",ref:"timerDone",props:[{key:"Signal",value:"timer"},{key:"TimerName",value:"@delay.Key"}],index:null},
      {op:"insert",parent:"timerDone",className:"ResponderEmit",ref:null,props:[],index:null},
      {op:"bind",target:"timerMethod",mode:"merge",rules:[{condition:"",updates:[{state:"$Status",expression:"'Time up'"}]}]},
      {op:"bind",target:"init",mode:"merge",rules:[{condition:"",updates:[{state:"$Status",expression:"'Ready'"}]}]},
    ],tests:null,title:null,summary:null}},
    speech:"Speech watches stateName ($Speak by default). A Speak button binds {$Speak:'$Display'} with condition '$Display'. Clear binds {$Display:\"''\"}. Character insertion uses add_letter(#label), add_word(#label) appends the word AND one space; add_letter adds exactly its argument. Return one update per state expression; never chain update helpers with semicolons. Backspace uses replace_last_letter(''). Expression string literals must be quoted. Preserve voiceURI, never invent a voice ID.",
    media:"Use only uploaded media filenames. Grid rows use symbol for an image and label for its caption; a Button has symbol. Audio watches its stateName; an ActionUpdate sets that state to a quoted audio filename. Inspect Audio, VSD and their native schemas for other media layouts. Do not invent filenames or URLs.",
  };
  if(!topic)return hints;
  const matched=Object.entries(hints).filter(([key])=>new RegExp(`\\b${key}\\b`,"i").test(String(topic)));
  return matched.length===1?matched[0][1]:matched.length?Object.fromEntries(matched):{available:Object.keys(hints)};
}

/** A native keyboard fragment reuses the existing action helper and evaluator.
 * This saves 26 repetitive model outputs, without restricting generic edits.
 */
export function keyboardRecipe(session,{parent="page",backspace=false,keyRows=["qwertyuiop","asdfghjkl","zxcvbnm"],color="#dbeafe",displayPosition="top"}={}) {
  if(!Array.isArray(keyRows)||!keyRows.length||keyRows.length>12 || keyRows.some(s=>typeof s!=="string"||!s.length||[...s].length>40))throw new Error('keyRows must contain whole row strings, e.g. ["qwertyuiop","asdfghjkl","zxcvbnm"], not individual letters. Omit keyRows for standard QWERTY.');
  const destination=session.find(parent);
  if(!session.catalog[destination.className].children.includes("Stack"))throw new Error("Choose a layout container for the keyboard.");
  const prefix=session.unique("typing");
  const existingSpeech=walk(session.design.layout).find(n=>n.className==="Speech");
  const speechState=existingSpeech?.props.stateName || "$Speak";
  const ref=label=>prefix+"_"+label;
  const make=(cls,props,children=[],name)=>({...node(cls,props,children),...(name?{ref:ref(name)}:{})});
  const controls=make("Stack",{direction:"row",scale:1},[
    make("Display",{stateName:"$Display",Name:"",scale:5,fontSize:2},[],"message"),
    make("Button",{name:ref("speak"),label:"Speak"},[],"speak"),
    make("Button",{name:ref("clear"),label:"Clear"},[],"clear"),
    make("Button",{name:ref("space"),label:"Space"},[],"space"),
    ...(backspace?[make("Button",{name:ref("backspace"),label:"Backspace"},[],"backspace")]:[]),
  ],"controls");
  const grids=keyRows.map((line,i)=>make("Grid",{name:ref("keys"+i),rows:1,columns:[...line].length,scale:1,fillItems:true,buttonColor:color},[
    make("GridFilter",{field:"#grid",operator:"equals",value:"'"+ref("keys"+i)+"'"})
  ],"keys"+i));
  const keyArea=make("Stack",{direction:"column",scale:4},grids,"keys");
  const insert={op:"insert",parent,nodes:[make("Stack",{direction:"column",scale:6},displayPosition==="bottom"?[keyArea,controls]:[controls,keyArea],"keyboard")]};
  const ops=[insert];
  if(!walk(session.design.layout).some(n=>n.className==="Speech"))ops.unshift({ op: "insert", parent: "page", nodes: [make("Speech", { stateName: "$Speak", voiceURI: "" }, [], "voice")] });
  keyRows.forEach((line,i)=>{
    ops.push({ op: "rows", rows: Array.from(line, label => ({ label })), defaults: { grid: ref("keys" + i) } });
    ops.push({op:"bind",target:ref("keys"+i),rules:[{updates:{$Display:"add_letter(#label)"}}]});
  });
  const bindings={speak:{[speechState]:"$Display"},clear:{$Display:"''"},space:{$Display:"add_letter(' ')"},...(backspace?{backspace:{$Display:"replace_last_letter('')"}}:{})};
  for(const [target,updates] of Object.entries(bindings))ops.push({op:"bind",target:ref(target),rules:[{condition:target==="speak"?"$Display":"",updates}]});
  const result=session.edit(ops);
  const letter=c=>({target:ref("keys"+keyRows.findIndex(row=>row.includes(c))),label:c});
  if(keyRows.join("")==="qwertyuiopasdfghjklzxcvbnm") {
    session.nativeTests=[...(session.nativeTests||[]),
      {name:"Keyboard composition",initial:{[speechState]:""},steps:[{target:ref("clear")},...[..."hello world"].map(c=>c===" "?{target:ref("space")}:letter(c))],expect:{$Display:"hello world",[speechState]:""}},
      {name:"Keyboard speak",steps:[{target:ref("clear")},letter("h"),letter("i"),{target:ref("speak")}],expect:{[speechState]:"hi"}},
      {name:"Keyboard clear",steps:[{target:ref("clear")},{target:ref("clear")},{target:ref("speak")}],expect:{$Display:""}},
      ...(backspace?[{name:"Keyboard backspace",steps:[{target:ref("clear")},letter("h"),letter("i"),{target:ref("backspace")}],expect:{$Display:"h"}}]:[]),
    ];
  }
  return {...result,keyboard:ref("keyboard"),controls:ref("controls"),keys:ref("keys"),note:"Native components inserted; use ordinary edits to customize any part."};
}

/** Compact reference to the actual expression registry, available on demand. */
export function nativeExpressionReference() {
  const available=nativeFunctionNames();
  return {available,previewOnly:available.filter(name=>!canEvaluateIsolated(name)),examples:{
    text:"add_word(#label) appends a word plus one space; add_letter(text) appends exactly text. These return state updaters, not immediate commands; return one, never chain them with semicolons. replace_last_letter('') removes the last character.",
    state:"increment(1), min($Score + 1, 10), if($Score > 0, 'Ready', 'Start')",
    navigation:"Set a TabControl state to a quoted TabPanel name: {$view: \"'food'\"}. No navigation function is needed.",
    effects:"load_design('https://…'), open_editor(), toggle_speech_suggestions() have external or live effects; local checks never execute them.",
    literals:"Quote literal text: 'food'. State and row fields: $Category, #category.",
  }};
}

function evaluateIsolated(expression,states,data={}) {
  const [fn,error]=compileExpression(expression);
  if(error)throw error;
  return fn({states,data,isolated:true});
}

function nativeValue(session,item,key,states) {
  const schema=session.catalog[item.className]?.props[key];
  const value=item.props[key] ?? schema?.default;
  return schema?.expression || typeof value==="string"&&value.startsWith("=")
    ? evaluateIsolated(String(value),states) : value;
}

// Mirror TabControl.template: the visible first panel and an explicitly empty
// navigation state are different; define must not overwrite the latter.
function selectedNativeTab(session,tabs,state) {
  const key=nativeValue(session,tabs,"stateName",state.values);
  const name=panel=>state.interpolate(String(nativeValue(session,panel,"name",state.values)||""));
  let active=state.get(key);
  if(!active&&tabs.children.length){active=name(tabs.children[0]);state.define(key,active);}
  return tabs.children.find(panel=>tabs.children.length===1||name(panel)===active);
}
function initializeNativeTabs(session,item,state) {
  if(item.className==="ModalDialog"&&!state.get(nativeValue(session,item,"stateName",state.values))&&![true,"true"].includes(nativeValue(session,item,"open",state.values)))return;
  if(item.className==="TabControl"){
    const panel=selectedNativeTab(session,item,state);
    if(panel)initializeNativeTabs(session,panel,state);
  }else for(const child of item.children||[])initializeNativeTabs(session,child,state);
}

/** Use the runtime's real filtering operators without installing a board. */
function nativeFilters(session,grid,states) {
  return (grid.children||[]).filter(n=>n.className==="GridFilter").map(n=>({
    field:{value:nativeValue(session,n,"field",states) || ""},
    operator:{value:nativeValue(session,n,"operator",states) || ""},
    value:{get value(){return nativeValue(session,n,"value",states);},valueInContext:()=>nativeValue(session,n,"value",states)},
  }));
}
export function matchingNativeRows(session,grid,states={}) {
  return new Data(session.design.content).getMatchingRows(nativeFilters(session,grid,states),false);
}

/** Match the existing Layout panel's definition of an empty board. */
export function hasNativeLayoutPieces(design) {
  return !!design.layout?.children?.[0]?.children?.some(n=>visualClasses.has(n.className));
}

/** Check the initial native surface without rendering or starting listeners.
 * This is a smoke check, not a replacement for normal Preview. Existing-board
 * edits do not re-run unrelated initial actions or require a new visible UI.
 */
export function reviewNativePresentation(session,{requireVisible=true}={}) {
  const summary={controls:0,buttons:0,populatedGrids:0,displays:0,radioOptions:0,tabButtons:0,indicators:0};
  if(!requireVisible)return {ok:true,errors:[],summary,skipped:true};
  const page=session.design.layout?.children?.[0];
  if(!page || page.className!=="Page")return {ok:false,errors:["The design has no Page to preview."],summary};
  const initial=exercise(session,[{steps:[],expect:{}}])[0];
  if(!initial.ok)return {ok:false,errors:[initial.error],summary};
  const state=new State();state.values=initial.states;
  const observedGrids=[];
  const value=(item,key)=>nativeValue(session,item,key,state.values);
  const visit=(item,parent)=>{
    // Stack's flex layout gives zero-scale children no room. Matrix children
    // are not controlled by a scale value.
    if(parent && ["Page","Stack","TabPanel","ModalDialog"].includes(parent.className) && !Number(value(parent,"columns")) && !(Number(value(item,"scale"))>0))return;
    if(item.className==="ModalDialog") {
      if(!state.get(value(item,"stateName")) && ![true,"true"].includes(value(item,"open")))return;
    }
    if(item.className==="TabControl") {
      const panels=item.children || [];
      if(value(item,"tabEdge")!=="none")summary.tabButtons+=panels.filter(p=>value(p,"label")!=="UNLABELED").length;
      const selected=selectedNativeTab(session,item,state);
      if(selected)visit(selected,item);
      return;
    }
    if(item.className==="Radio") {
      const stateName=value(item,"stateName"),options=(item.children || []).filter(n=>n.className==="Option");
      const filtered=(item.children || []).some(n=>n.className==="GridFilter");
      for(const option of options) {
        const optionValue=value(option,"value");
        if(filtered&&!new Data(session.design.content).hasMatchingRows(nativeFilters(session,item,{...state.values,[stateName]:optionValue}),{}))continue;
        summary.radioOptions++;
        if(stateName&&!state.get(stateName)&&optionValue)state.define(stateName,optionValue);
      }
      return;
    }
    if(item.className==="Indicator" && (["on","starting","reconnecting"].includes(state.get("$asr_status")) || state.get("$locationTracking")===1 || ["connected","reconnecting"].includes(state.get("$socketStatus"))))summary.indicators++;
    if(item.className==="Logger" && state.get(value(item,"stateName")) && value(item,"logUntil") && new Date()<new Date(value(item,"logUntil")))summary.indicators++;
    // Prediction publishes data for Grid/Display and Customize emits CSS;
    // neither is a visible surface by itself.
    if(item.className==="Button" && (value(item,"label") || value(item,"symbol")))summary.buttons++;
    if(item.className==="Display")summary.displays++;
    if(item.className==="Grid") {
      const rows=matchingNativeRows(session,item,state.values);
      if(rows.some(row=>row.label || row.symbol))summary.populatedGrids++;
      if(observedGrids.length<12)observedGrids.push({ref:item._ref,name:value(item,"name"),matchingRows:rows.length,labels:rows.slice(0,12).map(row=>String(row.label||"").slice(0,100))});
    }
    if(item.className==="VSD" && matchingNativeRows(session,item,state.values).some(row=>row.image))summary.controls++;
    for(const child of item.children || [])visit(child,item);
  };
  try {visit(page,null);}catch(error){return {ok:false,errors:[error.message],summary};}
  summary.controls+=summary.buttons+summary.populatedGrids+summary.displays+summary.radioOptions+summary.tabButtons+summary.indicators;
  const errors=summary.controls?[]:["The draft has no visible native output or controls. Add a Display, buttons, populated Grid, Radio options, tabs or visual scene, and verify it in Preview."];
  const nodes=walk(page);
  if(nodes.some(n=>n.className==="Button"&&String(n.props.label||"").toLowerCase()==="speak")&&!nodes.some(n=>n.className==="Speech"))errors.push("The Speak control has no native Speech listener. Add Speech on Page and bind the control to its stateName; setting a state alone cannot produce speech.");
  return {ok:!errors.length,errors,summary,observed:{initialVisibleGrids:observedGrids}};
}

/** Intent checks use the same expression functions and data filters as Preview. */
export function keyboardIntentTests(session,request) {
  if(!/\bqwerty\b/i.test(request)||!/\bkeyboard\b/i.test(request)||!/\bspace\b/i.test(request)||!/\b(display|message)\b/i.test(request))return [];
  const layout=walk(session.design.layout),buttons=layout.filter(n=>n.className==="Button");
  const control=label=>buttons.find(n=>String(n.props.label).toLowerCase()===label);
  const clear=control("clear"),speak=control("speak"),space=control("space"),backspace=control("backspace");
  const displays=layout.filter(n=>n.className==="Display");
  const displayState=displays.find(n=>n.props.stateName==="$Display")?.props.stateName || displays[0]?.props.stateName || "$Display";
  const initial=exercise(session,[{steps:[],expect:{}}])[0];
  if(!initial.ok)throw new Error(initial.error);
  const grids=layout.filter(n=>n.className==="Grid").map(n=>({node:n,rows:matchingNativeRows(session,n,initial.states)}));
  const letter=c=>{
    const button=buttons.find(n=>String(n.props.label).toLowerCase()===c);
    if(button)return {target:button._ref};
    const grid=grids.find(g=>g.rows.some(r=>String(r.label).toLowerCase()===c));
    if(!grid)throw new Error(`The keyboard has no visible letter ${c}.`);
    return {target:grid.node._ref,label:grid.rows.find(r=>String(r.label).toLowerCase()===c).label};
  };
  const steps=[...(clear?[{target:clear._ref}]:[]),...[..."hello world"].map(c=>c===" "?space?{target:space._ref}:null:letter(c))];
  if(steps.some(s=>!s))throw new Error("The requested keyboard needs a functioning Space control.");
  const tests=[{name:"Requested keyboard composition",steps,expect:{[displayState]:"hello world"}}];
  if(/\bbackspace\b/i.test(request)&&backspace)tests.push({name:"Requested Backspace behavior",steps:[...steps,{target:backspace._ref}],expect:{[displayState]:"hello worl"}});
  if(/\bclear\b/i.test(request)&&clear)tests.push({name:"Requested Clear behavior",steps:[...steps,{target:clear._ref},{target:clear._ref}],expect:{[displayState]:""}});
  if(/\bspeak\b/i.test(request)&&speak) {
    const speech=layout.find(n=>n.className==="Speech"&&session.design.actions.children.some(a=>a.props.origin===speak.props.name&&a.children.some(u=>u.className==="ActionUpdate"&&u.props.stateName===(n.props.stateName||"$Speak"))));
    if(!speech)throw new Error(`Speak control ${speak._ref} (${speak.props.name}) has no matching Speech listener. Bind THIS Button ref to update the stateName of a Speech component; inspect or remove an unused duplicate Speak control from this staged draft.`);
    tests.push({name:"Requested Speak binding",steps:[...steps,{target:speak._ref}],expect:{[speech.props.stateName||"$Speak"]:"hello world"}});
  }
  return tests;
}

/** Exercise action rules with the native state updater and expression functions.
 * Tab activation updates the native navigation state; ordinary Preview still
 * verifies rendered visibility. Radio activation remains a Preview check.
 */
export function exercise(session,tests=[]) {
  if(!Array.isArray(tests)||tests.length>24)throw new Error("Provide at most 24 interaction checks.");
  return tests.map(test=>{
    try {
      const state=new State();state.values=clone(test.initial || {});
      const run=(expression,data)=>evaluateIsolated(expression,state.values,data);
      const press=(origin,data={})=>{
        const match=session.design.actions.children.find(a=>[origin,"*"].includes(a.props.origin) && a.children.filter(c=>c.className==="ActionCondition").every(c=>!c.props.Condition || run(c.props.Condition,data)));
        if(!match)return; // Native conditional rules may deliberately do nothing.
        // Like Actions.applyRules, evaluate all values before applying one patch;
        // repeated state names keep the final update, and native reducers merge.
        state.update(Object.fromEntries(match.children.filter(n=>n.className==="ActionUpdate").map(u=>[u.props.stateName,run(u.props.newValue,data)])));
      };
      press("init"); // Native configure also permits a wildcard startup rule.
      initializeNativeTabs(session,session.design.layout,state);
      for(const step of test.steps || []) {
        const n=session.find(step.target),origin=n.props.name || n.props.Name;
        if(n.className==="TabControl" || n.className==="TabPanel") {
          const tabs=n.className==="TabControl"?n:session.parents.get(n._ref)?.parent;
          if(tabs?.className!=="TabControl")throw new Error("TabPanel must belong to a TabControl.");
          const panel=n.className==="TabPanel"?n:tabs.children.find(panel=>step.label===state.interpolate(String(nativeValue(session,panel,"label",state.values)||nativeValue(session,panel,"name",state.values)))||step.label===state.interpolate(String(nativeValue(session,panel,"name",state.values))));
          if(!panel)throw new Error("Choose an actual TabPanel ref or a TabControl target with its tab label.");
          state.update({[nativeValue(session,tabs,"stateName",state.values)]:state.interpolate(String(nativeValue(session,panel,"name",state.values)))});
          initializeNativeTabs(session,session.design.layout,state);
          continue;
        }
        if(["Radio","Option"].includes(n.className))throw new Error(`${n.className} activates directly in the native interface. Verify its navigation/selection in Preview; local checks only exercise action rules.`);
        if(!origin)throw new Error(`${n.className} has no named action origin. Verify this component in Preview.`);
        let data={...(["Button","Grid","VSD","Display"].includes(n.className)?{ComponentName:origin,ComponentType:n.className}:{}),...(step.data || {})};
        if(n.className==="Button") {
          const label=nativeValue(session,n,"label",state.values);
          if(step.label!==undefined&&step.label!==label)throw new Error(`Button '${origin}' has label '${label}', not '${step.label}'.`);
          data={name:origin,label,...data};
        } else if(step.label!==undefined) {
          if(!["Grid","VSD"].includes(n.className))throw new Error("A content label requires a Grid or VSD target; use data for other action-rule checks.");
          const row=matchingNativeRows(session,n,state.values).find(r=>r.label===step.label);
          if(!row)throw new Error(`No content label '${step.label}' for '${origin}'.`);
          data={...row,...data};
        }
        if(n.className==="Display")data.name=origin;
        if(n.className==="Grid")data.GridTone=nativeValue(session,n,"tone",state.values) || "";
        if(["Button","Grid","VSD","Display"].includes(n.className))data=Object.fromEntries(Object.entries(data).filter(([,value])=>value!=null).map(([key,value])=>[key,String(value)]));
        press(origin,data);
        initializeNativeTabs(session,session.design.layout,state);
      }
      for(const [key,want] of Object.entries(test.expect || {})) {
        const actual=state.get(key) ?? "";
        if(actual!==want)throw new Error(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}.`);
      }
      return {name:test.name || "Interaction",ok:true,states:state.values};
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
/** Install into the NORMAL editor. There is no alternative canvas or preview runtime. */
export function installNative(design,{resetState=true,runInit=true}={}) {
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
    Globals.data.setNoteRows(clone(oldData.noteRows));
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
    if(runInit)Globals.actions.configure();
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

/** Save all six sections together and copy resources without touching the source. */
export async function persistNative(design,{name,sourceName,copy=false,beforeWrite=()=>{}}) {
  const database=await db.dbPromise;
  const media=copy?await database.getAllKeys("media"):[];
  const assets=[];
  for(const key of media)if(key[0]===sourceName)assets.push([key[1],await database.get("media",key)]);
  const records=copy?await database.getAllFromIndex("store5","by-name",sourceName):[];
  beforeWrite();
  const tx=database.transaction(["store5","media","saved"],"readwrite");
  for(const r of records)if(!SECTIONS.includes(r.type))tx.objectStore("store5").put({...r,name});
  for(const s of SECTIONS)tx.objectStore("store5").put({name,type:s,data:design[s]});
  for(const [filename,record] of assets)tx.objectStore("media").put(record,[name,filename]);
  tx.objectStore("saved").delete(name);
  await tx.done;
}
let committing=false;
/** Only the short local commit is locked; generation remains cancellable and editable. */
function lockNativeCommit() {
  if(committing)throw new Error("A native design change is already being saved.");
  committing=true;
  const body=document.body,inert=body.getAttribute("inert"),focused=document.activeElement;
  const events=["keydown","keyup","keypress","pointerdown","pointerup","click","dblclick","beforeinput","input","change","drop","paste","cut","submit"];
  const block=event=>{event.preventDefault();event.stopImmediatePropagation();};
  for(const event of events)window.addEventListener(event,block,{capture:true,passive:false});
  body.inert=true;
  return ()=>{
    for(const event of events)window.removeEventListener(event,block,true);
    if(inert===null)body.removeAttribute("inert");else body.setAttribute("inert",inert);
    committing=false;
    if(focused instanceof HTMLElement && focused.isConnected && !focused.closest("[inert]"))focused.focus({preventScroll:true});
  };
}

async function captureStoredDesign(database,name,includeMedia) {
  const records=await database.getAllFromIndex("store5","by-name",name);
  const saved=await database.get("saved",name),media=[];
  if(includeMedia)for(const key of await database.getAllKeys("media"))if(key[0]===name)media.push([key,await database.get("media",key)]);
  return {records,saved,media};
}
async function restoreStoredDesign(database,name,before,includeMedia) {
  const tx=database.transaction(["store5","media","saved"],"readwrite"),store=tx.objectStore("store5");
  for(const key of await store.index("by-name").getAllKeys(name))await store.delete(key);
  for(const record of before.records)store.put(record);
  if(before.saved)tx.objectStore("saved").put(before.saved);else tx.objectStore("saved").delete(name);
  if(includeMedia) {
    const media=tx.objectStore("media");
    for(const key of await media.getAllKeys())if(key[0]===name)await media.delete(key);
    for(const [key,record] of before.media)media.put(record,key);
  }
  await tx.done;
}

export async function acceptNative(design,{sourceName,newCopy=true,title="AI interface"}={}) {
  const previous=captureNative(),oldName=db.designName,version=fingerprint(previous);
  const previousState=clone(Globals.state.values),previousNotes=clone(Globals.data.noteRows);
  const metadata={fileName:db.fileName,fileHandle:db.fileHandle,hasUnsavedChanges:db.hasUnsavedChanges};
  const assertCurrent=()=>{
    if(db.designName!==oldName || fingerprint(captureNative())!==version)throw new Error("You changed the board while this copy was being prepared. Your manual changes were kept; run the request against the updated board.");
  };
  const name=newCopy?await db.uniqueName(title):oldName;
  assertCurrent();
  const unlock=lockNativeCommit();
  let database,stored,persisted=false,installed;
  try {
    // Native editor onUpdate/doUpdate starts writes synchronously. Finish them
    // before copying optional sections such as Notes from the source board.
    await db.settleWrites();
    database=await db.dbPromise;
    stored=await captureStoredDesign(database,name,newCopy);
    assertCurrent();
    // Copy first so rendering and init see media/Notes on the target. The live
    // original remains intact if this transaction fails.
    await persistNative(design,{name,sourceName:sourceName || oldName,copy:newCopy,beforeWrite:assertCurrent});
    persisted=true;
    assertCurrent();
    db.setDesignName(name);
    installed=installNative(design);
    // Init may call native Notes(). It belongs to this working copy, and must
    // finish before either reporting success or restoring a failed commit.
    await db.settleWrites();
    db.fileName=name+".osdpi";db.fileHandle=null;db.hasUnsavedChanges=true;
    history.replaceState({},"",location.pathname+location.search+"#"+encodeURIComponent(name));
    db.notify({action:"update",name});
    Globals.state.update({editing:true});
    return {name,before:previous,after:installed};
  }catch(error){
    // installNative itself restores the previous roots on a render failure.
    // A failed init write occurs after installation and needs live rollback too.
    let storageError;
    try {
      await db.settleWrites().catch(()=>{});
      if(persisted && stored)await restoreStoredDesign(database,name,stored,newCopy);
    }catch(rollbackError){storageError=rollbackError;}
    finally {
      // Storage recovery can itself fail. Never leave the editor attributed
      // to the failed target, or retain its live state, because of that error.
      db.setDesignName(oldName);Object.assign(db,metadata);
      if(installed) {
        Globals.state.values=previousState;Globals.state.clearUpdated();
        Globals.data.setNoteRows(previousNotes);
        installNative(previous,{resetState:false,runInit:false});
      }
    }
    if(storageError)throw new Error(`${error.message} The previous editor was restored, but saved-design recovery failed: ${storageError.message}`,{cause:error});
    throw error;
  }finally{unlock();}
}
