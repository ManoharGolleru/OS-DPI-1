import "@ungap/custom-elements";
import {render} from "uhtml";
import {Messages} from "./components/errors.js";
import {Data} from "./data.js";
import {State} from "./state.js";
import "./components/index.js";
import Globals from "./globals.js";
import {TreeBase} from "./components/treebase.js";
import db from "./db.js";
import {postRender} from "./render.js";
import {attachTapRouter} from "./components/tapRouter.js";

let unsubscribe=null;
let urls=[];
const origin=location.origin;
const root=document.getElementById("UI");
const notify=(type,payload={})=>parent.postMessage({type,...payload},origin);
const copy=x=>JSON.parse(JSON.stringify(x));
const originalGetMediaURL=db.getMediaURL.bind(db);
let importMedia=new Map();
db.getMediaURL=async name => {
  if (importMedia.has(name)) {
    const url=URL.createObjectURL(importMedia.get(name));
    urls.push(url);
    return url;
  }
  return originalGetMediaURL(name);
};

function mount(source,assets) {
  Globals.methods?.stop();
  unsubscribe?.();
  urls.forEach(url=>URL.revokeObjectURL(url));
  urls=[];
  importMedia=new Map(assets||[]);
  const design=copy(source);

  // The draft contains voice settings, but preview never sends cloud TTS.
  for (const part of [design.layout,...(design.layout.children||[])]) {
    const nodes=[part];
    while(nodes.length){
      const n=nodes.pop();
      if(n.className==="Speech")n.props.voiceURI="";
      nodes.push(...(n.children||[]));
    }
  }
  // Never activate externally connected access methods during preview.
  for (const method of design.method?.children||[]) {
    const nodes=[method];
    while(nodes.length){
      const n=nodes.pop();
      if (n.className==="SocketHandler" || n.className==="ResponderEmit") method.props.Active=false;
      nodes.push(...(n.children||[]));
    }
  }
  Globals.state=new State();
  Globals.state.define("editing",false);
  Globals.data=new Data(design.content);
  for(const [section,name] of Object.entries({
    layout:"layout",actions:"actions",method:"methods",
    pattern:"patterns",cues:"cues",
  })) Globals[name]=TreeBase.fromObject(design[section]);
  Globals.error=new Messages();

  const draw=()=>{
    render(document.getElementById("cues"),Globals.cues.template());
    render(root,Globals.layout.children[0].template());
    postRender();
    Globals.methods.refresh();
    const display=String(Globals.state.get("$Display")||"");
    notify("osdpi-preview-state",{display});
    Globals.state.clearUpdated();
  };
  unsubscribe=Globals.state.observe(draw);
  Globals.actions.configure();
  Globals.methods.configure();
  draw();
  document.getElementById("preview-error").textContent="";
}
attachTapRouter(root);
window.addEventListener("message",e=>{
  if(e.origin!==origin || e.source!==parent || e.data?.type!=="osdpi-preview-load")return;
  try {mount(e.data.design,e.data.media);} catch(error) {
    document.getElementById("preview-error").textContent=error.message;
    notify("osdpi-preview-error",{message:error.message});
  }
});
notify("osdpi-preview-ready");
