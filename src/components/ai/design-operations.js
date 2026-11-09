import {node, starterDesign, walk} from "./design-format.js";

const clone = value => JSON.parse(JSON.stringify(value));
const rule = (origin, expression) => node("Action", {origin}, [
  node("ActionCondition", {Condition:""}),
  node("ActionUpdate", {stateName:"$Display", newValue:expression}),
]);
const controlRule = (origin, stateName, expression) => node("Action", {origin}, [
  node("ActionCondition", {Condition:origin === "speak" ? "$Display" : ""}),
  node("ActionUpdate", {stateName, newValue:expression}),
]);
const alphabet = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

function check(condition, reason) {
  if (!condition) throw new Error(reason);
}
function safeName(value, label="name") {
  check(typeof value === "string" && value.trim().length && value.length < 65, "Provide a short " + label + ".");
  return value.trim();
}
function grid(name, count, columns, color="#e9f2fb") {
  check(Number.isInteger(columns) && columns >= 1 && columns <= 12, "Grid columns must be between 1 and 12.");
  return node("Grid", {
    name, rows:Math.max(1,Math.ceil(count/columns)), columns,
    scale:3, fillItems:true, background:"#ffffff", buttonColor:color, spacing:5,
  }, [node("GridFilter", {field:"#grid", operator:"equals", value:"'" + name + "'"})]);
}
function buildKeyboard({access="pointer", backspace=false}={}) {
  const design=starterDesign(access);
  const page=design.layout.children[0];
  const controls=page.children[1];
  const keys=[];
  const grids=alphabet.map((line,index) => {
    const name="keyboard_"+index;
    for (const key of line) keys.push({label:key, character:key.toLowerCase(),grid:name});
    return grid(name,line.length,line.length);
  });
  controls.children.push(node("Button",{name:"space",label:"Space",scale:2}));
  if (backspace) controls.children.push(node("Button",{name:"backspace",label:"Backspace",scale:1}));
  page.children=[page.children[0], controls, node("Stack", {direction:"column",scale:7},grids)];
  design.content=keys;
  design.actions.children=[
    ...grids.map(g=>rule(g.props.name,"add_letter(#character)")),
    controlRule("space","$Display","add_letter(' ')"),
    ...(backspace ? [controlRule("backspace","$Display","replace_last_letter('')")] : []),
    controlRule("speak","$Speak","$Display"),
    controlRule("message","$Speak","$Display"),
    controlRule("clear","$Display","''"),
  ];
  return design;
}
function buildWords(items,access="pointer",columns=4) {
  check(Array.isArray(items)&&items.length>=1&&items.length<=60,"Specify 1 to 60 vocabulary items.");
  const words=items.map(x=>safeName(x,"vocabulary label"));
  const d=starterDesign(access);
  const g=walk(d.layout).find(n=>n.className==="Grid");
  Object.assign(g.props,{columns,rows:Math.max(1,Math.ceil(words.length/columns))});
  d.content=words.map(label=>({label,grid:"words"}));
  d.actions.children=d.actions.children.filter(n=>!(n.props.origin==="words" && n.children.some(c=>c.props.Condition==="#kind='phrase'")));
  return d;
}
function locate(design,target,kind) {
  const all=walk(design.layout).filter(n=>(n.props.name===target || n.props.Name===target) && (!kind || n.className===kind));
  check(all.length===1,"Target must match exactly one " + (kind||"component") + ": " + target);
  return all[0];
}
function selectRow(design,target) {
  if (/^index:\d+$/.test(target||"")) {
    const i=Number(target.slice(6));
    check(i < design.content.length,"Unknown content row: " + target);
    return i;
  }
  const matching=design.content.flatMap((r,i)=>r.label===target ? [i]:[]);
  check(matching.length===1,"Word label is missing or ambiguous: " + target + ". Select a row in the editor.");
  return matching[0];
}
function color(value) {
  check(typeof value==="string" && /^(#[0-9a-f]{3}(?:[0-9a-f]{3})?|[a-z]{3,20})$/i.test(value),"Enter a CSS color name or #RRGGBB.");
  return value;
}
function number(value,min,max,label) {
  check(typeof value==="number" && Number.isFinite(value) && value>=min && value<=max, label+" must be between "+min+" and "+max+".");
  return value;
}
function operation(design,change) {
  check(change && typeof change==="object", "Invalid edit command.");
  const {op,target,text,value,items}=change;
  const words=()=>{check(Array.isArray(items) && items.length<=60,"Expected a list of at most 60 words.");return items.map(x=>safeName(x,"word"));};
  switch(op) {
    case "create_keyboard":
      return buildKeyboard({access:target||"pointer",backspace:value===true});
    case "create_board":
      return buildWords(words(),target||"pointer",value===null?4:number(value,1,12,"Columns"));
    case "set_columns": {
      const g=locate(design,target,"Grid");
      g.props.columns=number(value,1,12,"Columns");
      const count=design.content.filter(r=>r.grid===target).length;
      g.props.rows=Math.max(1,Math.ceil(count/g.props.columns));
      break;
    }
    case "set_color":
      locate(design,target).props.background=color(value);
      break;
    case "set_button_color":
      locate(design,target,"Grid").props.buttonColor=color(value);
      break;
    case "set_spacing":
      locate(design,target,"Grid").props.spacing=number(value,0,40,"Spacing");
      break;
    case "set_scale":
      locate(design,target).props.scale=number(value,0.2,12,"Scale");
      break;
    case "set_ui_scale":
      design.layout.props.uiScale=number(value,0.3,4,"UI scale");
      break;
    case "set_cue_color": {
      const cue=walk(design.cues).find(n=>["CueOverlay","CueFill","CueCircle"].includes(n.className));
      check(cue,"There is no editable visual cue.");
      cue.props.Color=color(value);
      break;
    }
    case "set_display_position": {
      check(value==="top"||value==="bottom","Display position must be top or bottom.");
      const page=design.layout.children[0];
      const index=page.children.findIndex(n=>walk(n).some(c=>c.className==="Display"));
      check(index>=0,"No message display found.");
      const [section]=page.children.splice(index,1);
      page.children.splice(value==="top"?1:page.children.length,0,section);
      break;
    }
    case "add_words": {
      const g=locate(design,target,"Grid");
      const labels=words();
      const count=design.content.filter(r=>r.grid===target).length+labels.length;
      check(count<=100,"Grid is limited to 100 items.");
      design.content.push(...labels.map(label=>({label,grid:target})));
      if (g.props.fillItems!==false) g.props.rows=Math.max(Number(g.props.rows||1),Math.ceil(count/Number(g.props.columns)));
      break;
    }
    case "remove_word":
      design.content.splice(selectRow(design,target),1);
      break;
    case "rename_word":
      design.content[selectRow(design,target)].label=safeName(text,"replacement label");
      break;
    case "set_spoken_text":
      design.content[selectRow(design,target)].say=safeName(text,"spoken text");
      break;
    case "set_control_label":
      locate(design,target,"Button").props.label=safeName(text,"button label");
      break;
    case "set_access": {
      check(["pointer","dwell","two-switch"].includes(value),"Unsupported access mode.");
      const template=starterDesign(value);
      for (const section of ["method","pattern","cues"]) design[section]=template[section];
      break;
    }
    case "add_tab": {
      const label=safeName(text,"tab name");
      const page=design.layout.children[0];
      let tabs=walk(page).find(n=>n.className==="TabControl" && n.props.name==="ai_tabs");
      if (!tabs) {
        const index=page.children.findIndex(n=>n.className==="Grid");
        check(index>=0,"To add tabs, the page needs a top-level word grid.");
        const [original]=page.children.splice(index,1);
        tabs=node("TabControl",{name:"ai_tabs",stateName:"$aiTab",scale:6,tabEdge:"top"},[
          node("TabPanel",{name:"Home",label:"Home",direction:"column"},[original]),
        ]);
        page.children.splice(index,0,tabs);
      }
      check(!tabs.children.some(t=>t.props.name===label),"Tab already exists: "+label);
      const used=new Set(walk(design.layout).filter(n=>n.className==="Grid").map(n=>n.props.name));
      let base="tab_"+label.toLowerCase().replace(/[^a-z0-9]+/g,"_"),name=base,n=2;
      while(used.has(name))name=base+"_"+n++;
      const labels=words();
      const g=grid(name,labels.length,Math.min(4,Math.max(1,labels.length)));
      tabs.children.push(node("TabPanel",{name:label,label,direction:"column"},[g]));
      design.content.push(...labels.map(word=>({label:word,grid:name})));
      design.actions.children.unshift(rule(name,"add_word(#label)"));
      break;
    }
    default: throw new Error("Unsupported edit: " + op);
  }
  return design;
}
/** Apply every edit against a copy; an error never alters the source. */
export function applyDesignOperations(source,operations) {
  check(Array.isArray(operations) && operations.length>0 && operations.length<=12,"Expected 1 to 12 editing commands.");
  let result=clone(source);
  for (const cmd of operations) result=operation(result,cmd);
  return result;
}
export const keyboardDesign=buildKeyboard;
export const wordBoardDesign=buildWords;
export const supportedEdits=[
  "create_keyboard","create_board","set_columns","set_color","set_button_color",
  "set_spacing","set_scale","set_ui_scale","set_cue_color","set_display_position",
  "add_words","remove_word","rename_word","set_spoken_text","set_control_label",
  "set_access","add_tab",
];
