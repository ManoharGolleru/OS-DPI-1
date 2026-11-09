import {html} from "uhtml";
import Globals from "app/globals";
import db, {unPackDesign} from "app/db";
import {fileSave} from "browser-fs-access";
import {DESIGN_MODELS, SECTION_NAMES, starterDesign, walk} from "./design-format";
import {keyboardDesign} from "./design-operations";
import {captureDesign, selectedVoice, checkDraft, updateDraft, generateEdits,
  collectMedia, packDesign, saveDesignCopy, preserveVoice} from "./design-engine";

const duplicate=x=>JSON.parse(JSON.stringify(x));

export class InterfaceDesigner {
  constructor() {
    this.model=localStorage.getItem("osdpi-design-model") || DESIGN_MODELS[0][0];
    this.open=!!localStorage.getItem("osdpi-open-ai-generator");
    this.description="";
    this.access="pointer";
    this.draft=null;
    this.baseline=null;
    this.sourceName="";
    this.media=new Map();
    this.history=[];
    this.future=[];
    this.revision=0;
    this.busy=false;
    this.status="";
    this.error="";
    this.usage=null;
    this.abort=null;
    this.frame=null;
    this.gridName="";
    this.rowIndex=0;
    this.previewText="";
    this.previewSpoken="";
    this.frameReady=false;
    window.addEventListener("message",event=>{
      if (event.origin!==location.origin || event.source!==this.frame?.contentWindow) return;
      if (event.data?.type==="osdpi-preview-ready") {
        this.frameReady=true;
        this.sendPreview();
      } else if (event.data?.type==="osdpi-preview-state") {
        const text=String(event.data.display||"");
        const spoken=String(event.data.speak||"");
        if (text!==this.previewText || spoken!==this.previewSpoken) {this.previewText=text;this.previewSpoken=spoken;this.update();}
      } else if (event.data?.type==="osdpi-preview-error") {
        this.error="Preview error: "+event.data.message;
        this.update();
      }
    });
  }
  update() {Globals.state?.update();}
  setDraft(design,title,summary,sourceName="",media=new Map()) {
    this.draft={title,summary,design,warnings:[]};
    this.baseline=duplicate(design);
    this.sourceName=sourceName;
    this.media=new Map(media);
    this.history=[];this.future=[];
    this.revision++;
    this.error="";
    this.status="Draft ready. Edit or test it below, then save a separate copy.";
    this.rowIndex=0;
    this.gridName="";
    this.previewText="";
    this.previewSpoken="";
    this.update();
    this.sendPreview();
  }
  createKeyboard() {
    if(this.draft && !window.confirm("Replace the current unsaved draft with a new keyboard?"))return;
    try {
      const design=preserveVoice(keyboardDesign({access:this.access}),selectedVoice());
      const checked=checkDraft(design,null,[]);
      if(checked.errors.length)throw new Error(checked.errors.join("\n"));
      this.setDraft(design,"QWERTY Keyboard","Typing board with a display, Space, Speak and Clear.");
    }catch(error){this.error=error.message;this.update();}
  }
  async useCurrent() {
    if(this.busy)return;
    try {
      const design=captureDesign();
      const media=await collectMedia(db.designName);
      this.setDraft(design,db.designName+" edited","Copy of the current board.",db.designName,media);
    }catch(error){this.error=error.message;this.update();}
  }
  async importFile(file) {
    if(this.busy || !file)return;
    try {
      if(file.size > 100*1024*1024)throw new Error("The archive exceeds the 100 MB import limit.");
      const archive=await unPackDesign(file);
      for(const part of SECTION_NAMES)if(!(part in archive))throw new Error("Imported file has no "+part+".json section.");
      const design=Object.fromEntries(SECTION_NAMES.map(name=>[name,archive[name]]));
      const assets=new Map((archive.media||[]).map(item=>[item.name,item.content]));
      const name=file.name.replace(/\.(osdpi|zip)$/i,"")||"Imported board";
      this.setDraft(design,name+" edited","Imported design. Unchanged advanced components are preserved.","",assets);
      this.status="Imported. Test it before saving changes.";
      this.update();
    }catch(error){
      if(error.name!=="AbortError" && error.name!=="NotFoundError") {
        this.error=error.message||"Import failed.";
        this.update();
      }
    }
  }
  edited(operations,summary) {
    const source=this.draft?.design||starterDesign(this.access);
    const names=[...this.media.keys()];
    const result=updateDraft(source,operations,{baseline:this.baseline,mediaNames:names});
    if(!this.draft) preserveVoice(result.design,selectedVoice());
    if(this.draft){
      this.history.push(duplicate(this.draft));
      if(this.history.length>25)this.history.shift();
    }
    this.future=[];
    this.draft={title:this.draft?.title||"AI Board",summary,design:result.design,warnings:result.warnings};
    this.revision++;
    this.error="";
    this.status=summary+". Test the draft below.";
    this.update();
    this.sendPreview();
  }
  manual(op,target=null,text=null,value=null,items=[]) {
    try {this.edited([{op,target,text,value,items}],"Updated "+op.replace(/_/g," "));}
    catch(error){this.error=error.message;this.update();}
  }
  undo() {
    if(!this.history.length||this.busy)return;
    this.future.push(duplicate(this.draft));
    this.draft=this.history.pop();
    this.revision++;
    this.error="";
    this.status="Undid the last change.";
    this.update();
    this.sendPreview();
  }
  redo() {
    if(!this.future.length||this.busy)return;
    this.history.push(duplicate(this.draft));
    this.draft=this.future.pop();
    this.revision++;
    this.error="";
    this.status="Redid the change.";
    this.update();
    this.sendPreview();
  }
  async generate() {
    if(this.busy)return;
    if(!this.description.trim()){this.error="Describe the interface or change you need.";this.update();return;}
    const base=this.draft?.design||starterDesign(this.access);
    const version=this.revision;
    this.busy=true;
    this.error="";
    this.status="Asking Groq for native editing commands. The saved board is unchanged.";
    this.usage=null;
    const controller=this.abort=new AbortController();
    this.update();
    try {
      const response=await generateEdits({
        description:this.description,model:this.model,
        mode:this.draft?"edit":"create",design:base,access:this.access,signal:controller.signal,
        onUsage:usage=>{this.usage=usage;},
      });
      if(controller.signal.aborted)return;
      if(version!==this.revision)throw new Error("The draft changed while Groq responded. Run the instruction again.");
      const operations=this.draft?response.operations:response.operations.map(op=>
        ["create_keyboard","create_board"].includes(op.op)?{...op,target:this.access}:op
      );
      this.edited(operations,response.summary);
    }catch(error){
      if(controller.signal.aborted)this.error="Request cancelled. The draft is unchanged.";
      else this.error=error.message||"No changes made.";
    }finally{
      this.busy=false;
      this.abort=null;
      this.update();
    }
  }
  async sendPreview() {
    if(!this.frameReady||!this.frame?.contentWindow||!this.draft)return;
    const version=this.revision;
    try{
      const media=await collectMedia(this.sourceName,this.media);
      if(version!==this.revision)return;
      this.frame.contentWindow.postMessage({
        type:"osdpi-preview-load",design:this.draft.design,media:[...media],
      },location.origin);
    }catch(error){this.error="Preview assets: "+error.message;this.update();}
  }
  async openCopy() {
    if(!this.draft||this.busy)return;
    this.busy=true;this.update();
    try{
      const name=await saveDesignCopy(this.draft,this.sourceName,this.media);
      window.location.hash=name;
    }catch(error){this.error="Could not save the board: "+error.message;}
    finally{this.busy=false;this.update();}
  }
  async download() {
    if(!this.draft||this.busy)return;
    try{
      await fileSave(packDesign(this.draft.design,this.sourceName,this.media),{
        fileName:this.draft.title.replace(/[^A-Za-z0-9_-]/g,"_")+".osdpi",
        extensions:[".osdpi"],
      });
    }catch(error){
      if(error.name!=="AbortError"){this.error="Export failed: "+error.message;this.update();}
    }
  }
  template() {
    const draft=this.draft;
    const grids=draft?walk(draft.design.layout).filter(n=>n.className==="Grid"):[];
    const grid=grids.find(g=>g.props.name===this.gridName)||grids[0];
    const rows=draft?.design.content||[];
    const idx=Math.min(this.rowIndex,Math.max(0,rows.length-1));
    const row=rows[idx];
    return html`<details class="ai-section" ?open=${this.open}
      @toggle=${e=>{this.open=e.target.open;}}>
      <summary>Create or edit an interface</summary>
      <div class="ai-body">
        <p>Build a native OS-DPI board, edit the current board, or import an .osdpi file.
          Test a separate draft before saving. Your original board stays untouched.</p>
        <div class="ai-key-actions">
          <button type="button" data-testid="design-keyboard" ?disabled=${this.busy}
            @click=${()=>this.createKeyboard()}>New QWERTY keyboard</button>
          <button type="button" data-testid="design-current" ?disabled=${this.busy}
            @click=${()=>this.useCurrent()}>Edit current board</button>
          <label>Import .osdpi
            <input type="file" data-testid="design-import" accept=".osdpi,.zip" ?disabled=${this.busy}
              @change=${e=>{const file=e.target.files?.[0];e.target.value="";this.importFile(file);}}/>
          </label>
          <button type="button" ?disabled=${this.busy}
            @click=${()=>{
              if(this.draft && !window.confirm("Discard the current unsaved draft?"))return;
              this.draft=null;this.baseline=null;this.media=new Map();
              this.sourceName="";this.history=[];this.future=[];this.revision++;this.update();
            }}>New blank draft</button>
        </div>
        <label>Groq model
          <select data-testid="design-model" ?disabled=${this.busy}
            @change=${e=>{this.model=e.target.value;localStorage.setItem("osdpi-design-model",this.model);}}>
            ${DESIGN_MODELS.map(([id,name])=>html`<option value=${id} ?selected=${this.model===id}>${name}</option>`)}
          </select>
        </label>
        <label>Access method for new boards
          <select data-testid="design-access" ?disabled=${this.busy}
            @change=${e=>{this.access=e.target.value;}}>
            <option value="pointer" ?selected=${this.access==="pointer"}>Mouse / touch</option>
            <option value="dwell" ?selected=${this.access==="dwell"}>Pointer dwell</option>
            <option value="two-switch" ?selected=${this.access==="two-switch"}>Two-switch scanning</option>
          </select>
        </label>
        <label>Describe a new board or a change to this draft
          <textarea data-testid="design-prompt" class="ai-input ai-textarea" rows="4" maxlength="2500"
            placeholder="Make a QWERTY keyboard with Speak and Clear, or: make the keyboard buttons blue."
            .value=${this.description} ?disabled=${this.busy}
            @input=${e=>{this.description=e.target.value;}}
            @keydown=${e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();this.generate();}}}
          ></textarea>
        </label>
        <p class="ai-key-note">Groq selects small editing commands. It does not rewrite the six design files.
          No API key is included in exported boards.</p>
        <button type="button" data-testid="design-generate" class="ai-generate-btn"
          ?disabled=${this.busy} @click=${()=>this.generate()}>
          ${this.busy?"Applying instructions…":"Apply AI instructions to draft"}
        </button>
        ${this.busy&&this.abort?html`<button type="button" @click=${()=>this.abort.abort()}>Cancel</button>`:html``}
        ${this.status?html`<p role="status">${this.status}</p>`:html``}
        ${this.error?html`<pre class="ai-error" role="alert" style="white-space:pre-wrap">${this.error}</pre>`:html``}
        ${draft?html`<section data-testid="design-draft">
          <h3>${draft.title}</h3><p>${draft.summary}</p>
          <div class="ai-key-actions">
            <button type="button" data-testid="design-undo" ?disabled=${this.busy||!this.history.length}
              @click=${()=>this.undo()}>Undo</button>
            <button type="button" data-testid="design-redo" ?disabled=${this.busy||!this.future.length}
              @click=${()=>this.redo()}>Redo</button>
            <button type="button" data-testid="design-open" ?disabled=${this.busy}
              @click=${()=>this.openCopy()}>Open as new board</button>
            <button type="button" data-testid="design-download" ?disabled=${this.busy}
              @click=${()=>this.download()}>Download .osdpi</button>
          </div>
          <p class="ai-key-note">For advanced manual changes, open a copy and use OS-DPI's full
            Layout, Content, Actions, Methods, Patterns and Cues editors.</p>
          ${grid?html`<fieldset class="ai-key-steps">
            <legend>Quick layout edit</legend>
            <label>Grid
              <select @change=${e=>{this.gridName=e.target.value;this.update();}}>
                ${grids.map(g=>html`<option value=${g.props.name} ?selected=${grid===g}>${g.props.name}</option>`)}
              </select>
            </label>
            <label>Columns
              <input type="number" min="1" max="12" .value=${String(grid.props.columns)}
                @change=${e=>this.manual("set_columns",grid.props.name,null,Number(e.target.value))}/>
            </label>
            <label>Button color
              <input type="text" .value=${String(grid.props.buttonColor||"#e9f2fb")}
                @change=${e=>this.manual("set_button_color",grid.props.name,null,e.target.value.trim())}/>
            </label>
          </fieldset>`:html``}
          ${row?html`<fieldset class="ai-key-steps">
            <legend>Quick content edit</legend>
            <label>Item
              <select @change=${e=>{this.rowIndex=Number(e.target.value);this.update();}}>
                ${rows.map((r,i)=>html`<option value=${String(i)} ?selected=${i===idx}>${i+1}. ${r.label}</option>`)}
              </select>
            </label>
            <label>Button label
              <input type="text" .value=${String(row.label)}
                @change=${e=>this.manual("rename_word","index:"+idx,e.target.value.trim())}/>
            </label>
          </fieldset>`:html``}
          <h4>Interactive test preview</h4>
          <p class="ai-key-note">Press keys to test composition and navigation. Preview uses browser speech,
            not the saved ElevenLabs voice. External socket methods are disabled.</p>
          <iframe title="OS-DPI native preview" data-testid="design-preview" sandbox="allow-same-origin allow-scripts"
            style="display:block;width:100%;height:450px;border:1px solid #aaa;border-radius:6px"
            src=${import.meta.env.BASE_URL+"ai-preview.html"}
            ref=${frame=>{if(frame&&frame!==this.frame){this.frame=frame;this.frameReady=false;}}}></iframe>
          <p class="ai-key-note" data-testid="design-preview-text">Preview display: ${this.previewText}. Last speech: ${this.previewSpoken}</p>
          ${draft.warnings?.slice(0,5).map(w=>html`<p class="ai-key-note">${w}</p>`)}
          <details><summary>Inspect native sections</summary>
            ${SECTION_NAMES.map(name=>html`<details><summary>${name}.json</summary>
              <pre style="white-space:pre-wrap;max-height:15rem;overflow:auto">${JSON.stringify(draft.design[name],null,2)}</pre>
            </details>`)}
          </details>
        </section>`:html``}
        ${this.usage?html`<p class="ai-key-note">Groq tokens: ${this.usage.total_tokens??"not reported"}</p>`:html``}
      </div>
    </details>`;
  }
}
