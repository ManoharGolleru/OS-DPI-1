import {html} from "uhtml";
import {fileSaveLegacy as downloadFile} from "browser-fs-access";
import Globals from "app/globals";
import db, {DB, unPackDesign} from "app/db";
import {SECTIONS,walk} from "./authoring-document";
import {captureNative,emptyNative,documentSession,fingerprint,acceptNative,hasNativeLayoutPieces,nativeCatalog} from "./authoring-native";
import {authorInterface,MODELS} from "./authoring-agent";
import {createDiagnostics,diagnosticFingerprint} from "./authoring-diagnostics";
import "css/authoring.css";

/** Voice selection belongs to the user, including distinct speech/cue voices. */
export function preserveNativeVoices(original,draft,request="") {
  const changeVoice=request.split(/[.!?;,\n]|\b(?:and|but)\b/i).some(part=>
    !/\b(?:keep|preserve|retain|unchanged|same|never)\b|\bdo not\b|\bdon['’]t\b/i.test(part) &&
    (/\b(?:change|replace|set|switch)\s+(?:(?:the|my|our|its|current|existing|speech|cue)\s+)*(?:voice|accent|speaker)\b(?!\s+(?:rate|speed|pitch|volume)\b)/i.test(part) ||
      /\b(?:choose|select|use|switch to)\b[^.!?;,\n]{0,40}\b(?:voice|accent|speaker)\b/i.test(part) && !/\b(?:rate|speed|pitch|volume)\b/i.test(part)));
  if(changeVoice)return;
  const schema=nativeCatalog();
  const nodes=design=>[...walk(design.layout).filter(n=>n.className==="Speech"),...walk(design.cues).filter(n=>schema[n.className]?.props.voiceURI)];
  const existing=nodes(original),speeches=existing.filter(n=>n.className==="Speech");
  const chosen=speeches.find(n=>n.props.voiceURI)?.props.voiceURI || "";
  for(const n of nodes(draft)) {
    const previous=existing.find(old=>(n.id&&n.id===old.id)||(n.props.Key&&n.props.Key===old.props.Key)) ||
      (n.className==="Speech"?speeches.find(old=>(old.props.stateName || "$Speak")===(n.props.stateName || "$Speak")):null);
    n.props.voiceURI=previous ? previous.props.voiceURI || "" : n.className==="Speech" ? chosen : "";
  }
}

/** The assistant lives in the existing designer. Native manual editing stays available. */
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
  pendingImport=null;
  abort=null;
  usage=null;
  audit=[];
  diagnosticsEnabled=false;
  diagnosticBoardText=false;
  diagnostics=null;

  update(){Globals.state?.update();}
  async run() {
    if(this.busy)return;
    if(!this.description.trim()){this.error="Describe the interface or the change you need.";this.update();return;}
    const original=captureNative(),name=db.designName, version=fingerprint(original),mode=this.mode,request=this.description.trim();
    const selected=mode==="edit"?Globals.layout.selected?.id || null:null;
    this.diagnostics=this.diagnosticsEnabled?createDiagnostics({model:this.model,mode,selected,request,includeBoardText:this.diagnosticBoardText}):null;
    const diagnostic=this.diagnostics;
    diagnostic?.record({stage:"transaction",before:diagnosticFingerprint(version)});
    this.open=true;this.busy=true;this.error="";this.pending=null;this.pendingImport=null;this.usage=null;this.audit=[];
    const controller=this.abort=new AbortController();
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},480000);
    this.update();
    try {
      const session=documentSession(mode==="new"?emptyNative():original,await db.listMedia());
      const result=await authorInterface({session,request,selected,model:this.model,requireVisible:mode==="new" || !hasNativeLayoutPieces(original),signal:controller.signal,history:mode==="new"?[]:this.summaries,
        onProgress:message=>{this.status=message;this.update();},onDiagnostic:event=>diagnostic?.record(event)});
      if(controller.signal.aborted)throw new DOMException("Cancelled","AbortError");
      this.usage=result.usage;this.audit=result.audit;
      if(result.question){this.status=result.question;diagnostic?.finish("needs-input");return;}
      if(db.designName!==name || fingerprint(captureNative())!==version)throw new Error("You changed the board while Groq was working. Your manual changes were kept; run the request against this updated board.");
      preserveNativeVoices(original,result.design,request);
      const proposal={...result,name,version,mode,request};
      if(result.checked.effects.length){
        this.pending=proposal;
        this.status="Review the external connections or device effects below before applying this design.";
        diagnostic?.finish("awaiting-review");
      }else await this.apply(proposal);
    }catch(e){
      diagnostic?.record({stage:"failure",code:timedOut?"timeout":controller.signal.aborted?"cancelled":["auth","no-key","network","rate-limit","daily-limit","request-size","tool-call","bad-response","http"].includes(e.kind)?e.kind:"authoring"});
      diagnostic?.finish(timedOut?"timeout":controller.signal.aborted?"cancelled":"failed");
      this.error=timedOut?"Groq could not finish within eight minutes. Your board and last working copy are unchanged.":controller.signal.aborted?"Stopped. Your board is unchanged.":e.message || "No changes were applied.";
      this.status="";
    }finally{clearTimeout(timeout);this.busy=false;this.abort=null;this.update();}
  }
  async apply(proposal) {
    if(db.designName!==proposal.name || fingerprint(captureNative())!==proposal.version)throw new Error("This proposal is out of date. Your newer manual changes were kept.");
    const first=proposal.mode==="new" || this.workspaceName!==db.designName;
    const result=await acceptNative(proposal.design,{sourceName:db.designName,newCopy:first,title:proposal.title});
    this.diagnostics?.record({stage:"transaction",after:diagnosticFingerprint(fingerprint(result.after)),persisted:true,rendered:true,copied:first,controls:proposal.presentation?.controls || 0});
    this.diagnostics?.finish("applied");
    if(first){this.originalName=proposal.name;this.history=[];this.top=0;this.summaries=[];}
    this.workspaceName=result.name;
    this.history.splice(this.top);
    this.history.push({before:proposal.mode==="new"?emptyNative():result.before,after:result.after,summary:proposal.summary});
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
      const result=await acceptNative(target,{newCopy:false,sourceName:db.designName});
      // Native installation expands defaults (notably a new blank baseline).
      // Compare subsequent history moves with the actual installed document.
      if(redo)entry.after=result.after;else entry.before=result.after;
      this.top+=redo?1:-1;this.error="";this.status=redo?"Redid the AI changes.":"Undid the AI changes.";
    }catch(e){this.error=e.message;}finally{this.busy=false;this.update();}
  }
  async importFile(file) {
    if(!file||this.busy)return;
    this.busy=true;this.error="";this.status="";this.pending=null;this.pendingImport=null;this.update();
    try{
      const archive=await unPackDesign(file);
      if(SECTIONS.some(s=>!(s in archive)))throw new Error("Import a complete .osdpi design containing Layout, Content, Actions, Methods, Patterns, and Cues.");
      const design=Object.fromEntries(SECTIONS.map(s=>[s,archive[s]]));
      const inspected=documentSession(design,(archive.media || []).map(r=>r.name)).diagnose();
      if(inspected.errors.some(e=>/Unregistered|Missing native/.test(e.message)))throw new Error("This file uses components that are not installed in this OS-DPI version. The original file was not changed.");
      if(inspected.effects.length){
        this.pendingImport={file,effects:inspected.effects};
        this.status="Review this file's external connections or device effects before importing.";
      }else await this.finishImport(file);
    }catch(e){this.error=e.message || "Import failed.";}finally{this.busy=false;this.update();}
  }
  async finishImport(file) {
    // Import always allocates a separate native design. Manual edits made while
    // reviewing remain on their source board; finish their writes before leaving.
    await db.settleWrites();
    const storage=new DB();
    await storage.readDesignFromBlob(file,file.name);
    await db.settleWrites();
    this.pendingImport=null;
    this.status="Imported as a separate design.";
    localStorage.setItem("osdpi-open-ai-generator","1");
    window.location.hash=storage.designName;
  }
  async confirmImport() {
    if(!this.pendingImport||this.busy)return;
    this.busy=true;this.error="";this.update();
    try{await this.finishImport(this.pendingImport.file);}
    catch(e){this.error=e.message || "Import failed.";}
    finally{this.busy=false;this.update();}
  }
  async downloadBoard() {
    if(this.busy)return;
    this.busy=true;this.error="";this.update();
    try{await downloadFile(await db.convertDesignToBlob(),{fileName:db.designName+".osdpi"});}
    catch(e){this.error=e.message || "The interface could not be exported.";}
    finally{this.busy=false;this.update();}
  }
  async downloadDiagnostics() {
    if(!this.diagnostics || this.busy)return;
    await downloadFile(new Blob([JSON.stringify(this.diagnostics.report,null,2)],{type:"application/json"}),{fileName:"osdpi-ai-diagnostics.json"});
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
          ${this.busy&&this.abort?html`<button type="button" data-testid="author-cancel" @click=${()=>this.abort.abort()}>Stop</button>`:html``}
          <button type="button" data-testid="author-preview" ?disabled=${this.busy} @click=${()=>Globals.state.update({editing:false})}>Preview</button>
          <button type="button" data-testid="author-download" ?disabled=${this.busy} @click=${()=>this.downloadBoard()}>Download .osdpi</button>
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
        ${this.pendingImport?html`<section class="ai-review" data-testid="author-import-review"><h3>Review before importing</h3>
          <p>${this.pendingImport.file.name}</p>
          ${this.pendingImport.effects.map(e=>html`<p>${e.message}</p>`)}
          <p>Import only if you trust this file. It will open as a separate design.</p>
          <button type="button" data-testid="author-import-confirm" ?disabled=${this.busy} @click=${()=>this.confirmImport()}>Import this design</button>
          <button type="button" data-testid="author-import-cancel" ?disabled=${this.busy} @click=${()=>{this.pendingImport=null;this.status="Import cancelled. Your board is unchanged.";this.update();}}>Cancel import</button>
        </section>`:html``}
        ${this.history.length?html`<div class="ai-author-actions">
          <button type="button" data-testid="author-undo" ?disabled=${this.busy||!this.top} @click=${()=>this.undo()}>Undo AI changes</button>
          <button type="button" data-testid="author-redo" ?disabled=${this.busy||this.top===this.history.length} @click=${()=>this.undo(true)}>Redo AI changes</button>
        </div>`:html``}
        <details><summary>Model and checks</summary>
          <label>Groq model<select data-testid="author-model" ?disabled=${this.busy} @change=${e=>{this.model=e.target.value;localStorage.setItem("osdpi-authoring-model",this.model);}}>
            ${MODELS.map(([id,name])=>html`<option value=${id} ?selected=${id===this.model}>${name}</option>`)}
          </select></label>
          <p>Native schemas and references are checked before applying. Preview is still necessary to judge layout and usability.</p>
          <label><input type="checkbox" data-testid="author-diagnostics" ?checked=${this.diagnosticsEnabled} ?disabled=${this.busy}
            @change=${e=>{this.diagnosticsEnabled=e.target.checked;if(!this.diagnosticsEnabled)this.diagnostics=null;this.update();}}/>Collect diagnostics for the next request</label>
          <p>Metadata stays in memory. Reports exclude prompts, board text, tool arguments, and account keys.</p>
          ${this.diagnosticsEnabled?html`<label><input type="checkbox" data-testid="author-diagnostics-text" ?checked=${this.diagnosticBoardText} ?disabled=${this.busy}
            @change=${e=>{this.diagnosticBoardText=e.target.checked;this.update();}}/>Include tool payloads (contains board text)</label>
            <p>Optional for troubleshooting synthetic test boards. Review this report before sharing; account keys are scrubbed.</p>`:html``}
          ${this.diagnostics&&!this.busy?html`<button type="button" data-testid="author-diagnostics-download" @click=${()=>this.downloadDiagnostics()}>Download diagnostics</button>`:html``}
          ${this.usage?html`<p>${this.usage.calls} requests; ${this.usage.total_tokens} reported tokens.</p>`:html``}
          ${this.audit.length?html`<p>${this.audit.map(a=>a.tool+(a.ok?" OK":" needs correction")).join(" → ")}</p>`:html``}
        </details>
      </div>
    </details>`;
  }
}
