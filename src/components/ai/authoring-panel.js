import {html} from "uhtml";
import Globals from "app/globals";
import db, {DB, unPackDesign} from "app/db";
import {SECTIONS,walk} from "./authoring-document";
import {captureNative,emptyNative,documentSession,fingerprint,acceptNative,installNative,persistNative} from "./authoring-native";
import {authorInterface,MODELS} from "./authoring-agent";
import "css/authoring.css";

/** The assistant uses the existing native designer and working board. */
export class AuthoringPanel {
  open=!!localStorage.getItem("osdpi-open-ai-generator");
  description="";
  mode="edit";
  model=localStorage.getItem("osdpi-authoring-model") || MODELS[0][0];
  busy=false;
  status="";
  error="";
  summaries=[];
  history=[];
  top=0;
  workspaceName="";
  originalName="";
  pending=null;
  abort=null;
  usage=null;
  audit=[];
  update(){Globals.state?.update();}
  async run() {
    if(this.busy)return;
    if(!this.description.trim()){this.error="Describe the interface or the change you need.";this.update();return;}
    const original=captureNative(),name=db.designName, version=fingerprint(original);
    const selected=this.mode==="edit"?Globals.layout.selected?.id || null:null;
    this.open=true;this.busy=true;this.error="";this.pending=null;this.usage=null;
    const controller=this.abort=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),240000);
    this.update();
    try {
      const session=documentSession(this.mode==="new"?emptyNative():original,await db.listMedia());
      const result=await authorInterface({session,request:this.description.trim(),selected,model:this.model,signal:controller.signal,history:this.summaries,
        onProgress:message=>{this.status=message;this.update();}});
      if(controller.signal.aborted)throw new DOMException("Cancelled","AbortError");
      this.usage=result.usage;this.audit=result.audit;
      if(result.question){this.status=result.question;return;}
      if(db.designName!==name || fingerprint(captureNative())!==version)throw new Error("You changed the board while Groq was working. Your manual changes were kept; run the request against this updated board.");
      const voice=walk(original.layout).find(n=>n.className==="Speech")?.props.voiceURI;
      if(voice)for(const n of walk(result.design.layout))if(n.className==="Speech"&&!n.props.voiceURI)n.props.voiceURI=voice;
      const proposal={...result,name,version,request:this.description.trim()};
      if(result.checked.effects.length){
        this.pending=proposal;
        this.status="Review the external connections or device effects below before applying this design.";
      }else await this.apply(proposal);
    }catch(e){
      this.error=controller.signal.aborted?"Stopped. Your board is unchanged.":e.message || "No changes were applied.";
      this.status="";
    }finally{clearTimeout(timeout);this.busy=false;this.abort=null;this.update();}
  }
  async apply(proposal) {
    if(db.designName!==proposal.name || fingerprint(captureNative())!==proposal.version)throw new Error("This proposal is out of date. Your newer manual changes were kept.");
    const first=this.workspaceName!==db.designName;
    if(first)this.originalName=db.designName;
    const result=await acceptNative(proposal.design,{sourceName:db.designName,newCopy:first,title:proposal.title});
    this.workspaceName=result.name;
    this.history.splice(this.top);
    this.history.push({before:result.before,after:result.after,summary:proposal.summary});
    if(this.history.length>12)this.history.shift();
    this.top=this.history.length;
    this.summaries.push({request:proposal.request,changes:proposal.summary});
    if(this.summaries.length>6)this.summaries.shift();
    this.pending=null;this.mode="edit";
    this.status=proposal.summary+" Test it with Preview; manual edits use the normal Layout and Content controls.";
    this.description="";
    this.update();
  }
  async confirm() {
    if(!this.pending||this.busy)return;
    this.busy=true;this.update();
    try{await this.apply(this.pending);}catch(e){this.error=e.message;}finally{this.busy=false;this.update();}
  }
  async undo(redo=false) {
    if(this.busy)return;
    const entry=this.history[redo?this.top:this.top-1];
    if(!entry || db.designName!==this.workspaceName)return;
    const expected=redo?entry.before:entry.after;
    if(fingerprint(captureNative())!==fingerprint(expected)){
      this.error="There are newer manual changes. Use the normal editor's Undo for those first, so they are not overwritten.";this.update();return;
    }
    this.busy=true;this.update();
    const target=redo?entry.after:entry.before;
    try{
      const installed=installNative(target);
      try{await persistNative(installed,{name:db.designName});}catch(e){installNative(expected);throw e;}
      this.top+=redo?1:-1;this.error="";this.status=redo?"Redid the AI changes.":"Undid the AI changes.";
      db.notify({action:"update",name:db.designName});
    }catch(e){this.error=e.message;}finally{this.busy=false;this.update();}
  }
  async importFile(file) {
    if(!file||this.busy)return;
    this.busy=true;this.error="";this.update();
    try{
      const archive=await unPackDesign(file);
      if(SECTIONS.some(s=>!(s in archive)))throw new Error("Import a complete .osdpi design containing Layout, Content, Actions, Methods, Patterns, and Cues.");
      const design=Object.fromEntries(SECTIONS.map(s=>[s,archive[s]]));
      const inspected=documentSession(design,(archive.media || []).map(r=>r.name)).diagnose();
      if(inspected.errors.some(e=>/Unregistered|Missing native/.test(e.message)))throw new Error("This file uses components that are not installed in this OS-DPI version. The original file was not changed.");
      if(inspected.effects.length && !window.confirm("This design includes external connections or device effects:\n"+inspected.effects.map(e=>e.message).join("\n")+"\nImport only if you trust the file. Continue?"))return;
      const storage=new DB();
      await storage.readDesignFromBlob(file,file.name);
      localStorage.setItem("osdpi-open-ai-generator","1");
      window.location.hash=storage.designName;
    }catch(e){this.error=e.message || "Import failed.";}finally{this.busy=false;this.update();}
  }
  template() {
    const selected=Globals.layout?.selected;
    return html`<details class="ai-section ai-authoring" ?open=${this.open} @toggle=${e=>{this.open=e.target.open;}}>
      <summary>Generate or edit with AI</summary>
      <div class="ai-body">
        <p>Describe an interface, activity, or change. AI uses the same native OS-DPI components as the manual editor.</p>
        ${this.workspaceName===db.designName?html`<p class="ai-copy-status">Working copy: ${db.designName}. Original: ${this.originalName}, unchanged.</p>`:html`<p class="ai-key-note">The first accepted request opens a separate working copy. Your current board stays safe.</p>`}
        <label>Start from
          <select data-testid="author-mode" .value=${this.mode} ?disabled=${this.busy} @change=${e=>{this.mode=e.target.value;this.update();}}>
            <option value="edit">The current board</option><option value="new">A new blank interface</option>
          </select>
        </label>
        <label class="ai-import">Or import an .osdpi file
          <input type="file" accept=".osdpi,.zip" data-testid="author-import" ?disabled=${this.busy} @change=${e=>{const f=e.target.files?.[0];e.target.value="";this.importFile(f);}}/>
        </label>
        ${selected&&this.mode==="edit"?html`<p class="ai-key-note">Selected: ${selected.className} ${selected["name"]?.value || selected["Name"]?.value || ""}. Say “this” to target it.</p>`:html``}
        <label>What should the interface do?
          <textarea class="ai-input ai-textarea" data-testid="author-request" rows="4" maxlength="6000"
            placeholder="Create a QWERTY keyboard with a display, Speak and Clear. Or: add a quiz with a score and a timer."
            .value=${this.description} @input=${e=>{this.description=e.target.value;}}
            @keydown=${e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();this.run();}}}></textarea>
        </label>
        <div class="ai-author-actions">
          <button type="button" class="ai-generate-btn" data-testid="author-run" ?disabled=${this.busy} @click=${()=>this.run()}>${this.busy?"Working…":"Build / change interface"}</button>
          ${this.busy?html`<button type="button" data-testid="author-cancel" @click=${()=>this.abort?.abort()}>Stop</button>`:html``}
          <button type="button" data-testid="author-preview" ?disabled=${this.busy} @click=${()=>Globals.state.update({editing:false})}>Preview</button>
          <button type="button" data-testid="author-download" ?disabled=${this.busy} @click=${()=>db.saveDesign()}>Download .osdpi</button>
        </div>
        <p class="ai-key-note">Uses the Groq key saved below. Relevant board text and configuration are sent to Groq. Account keys and audio are not included in the prompt.</p>
        ${this.status?html`<p role="status" data-testid="author-status">${this.status}</p>`:html``}
        ${this.error?html`<p class="ai-error" role="alert" data-testid="author-error">${this.error}</p>`:html``}
        ${this.pending?html`<section class="ai-review"><h3>Review before applying</h3>
          <p>${this.pending.summary}</p>
          ${this.pending.checked.effects.map(e=>html`<p>${e.message}</p>`)}
          <button type="button" ?disabled=${this.busy} @click=${()=>this.confirm()}>Allow these effects and apply</button>
          <button type="button" ?disabled=${this.busy} @click=${()=>{this.pending=null;this.status="Proposal discarded. Your board is unchanged.";this.update();}}>Discard</button>
        </section>`:html``}
        ${this.history.length?html`<div class="ai-author-actions">
          <button type="button" data-testid="author-undo" ?disabled=${this.busy||this.top===0} @click=${()=>this.undo()}>Undo AI change</button>
          <button type="button" data-testid="author-redo" ?disabled=${this.busy||this.top===this.history.length} @click=${()=>this.undo(true)}>Redo AI change</button>
        </div>`:html``}
        <details><summary>Model and request details</summary>
          <label>Groq model
            <select data-testid="author-model" .value=${this.model} ?disabled=${this.busy} @change=${e=>{this.model=e.target.value;localStorage.setItem("osdpi-authoring-model",this.model);}}>
              ${MODELS.map(([id,label])=>html`<option value=${id}>${label}</option>`)}
            </select>
          </label>
          ${this.usage?html`<p>${this.usage.calls} model calls; ${this.usage.total_tokens} tokens reported.</p>`:html``}
          ${this.audit.length?html`<p>${this.audit.map(a=>a.tool+": "+(a.ok?"completed":"needs correction")).join("; ")}</p>`:html``}
          <p>Model availability and free-tier quotas depend on your Groq account. Both models use the same native editing tools.</p>
        </details>
      </div>
    </details>`;
  }
}
