import { html } from "uhtml";
import Globals from "app/globals";
import db from "app/db";
import { fileSave } from "browser-fs-access";
import { DESIGN_MODELS, SECTION_NAMES, walk } from "./design-format";
import { captureDesign, selectedVoice, generateDesign, packDesign, saveDesignCopy } from "./design-engine";

/** Draft state is local to this editor. Rendering performs no network or DB writes. */
export class InterfaceDesigner {
  description = "";
  mode = "create";
  access = "pointer";
  model = localStorage.getItem("osdpi-design-model") || DESIGN_MODELS[0][0];
  open = !!localStorage.getItem("osdpi-open-ai-generator");
  busy = false;
  status = "";
  error = "";
  draft = null;
  rejected = null;
  sourceName = "";
  usage = null;
  abort = null;

  update() { Globals.state?.update(); }

  async generate(repair = false) {
    if (this.busy) return;
    if (!this.description.trim()) { this.error = "Describe the interface or changes you need."; this.update(); return; }
    this.open = true;
    this.busy = true;
    this.error = "";
    this.usage = null;
    this.status = "Generating a native draft. Your current board is unchanged.";
    const abort = this.abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 120000);
    this.update();
    try {
      this.sourceName = db.designName;
      const mediaNames = await db.listMedia();
      const baseDesign = repair ? this.rejected?.design
        : this.mode === "refine" ? this.draft?.design
        : this.mode === "edit" ? captureDesign() : null;
      if (this.mode === "refine" && !baseDesign) throw new Error("Generate a draft before refining it.");
      const instruction = repair
        ? `${this.description}\nRepair the rejected draft. Keep the intended interface. Fix these validation errors:\n${this.rejected?.errors || "invalid native JSON"}`
        : this.description;
      const draft = await generateDesign({
        description: instruction, model: this.model, mode: baseDesign ? "edit" : "create",
        baseDesign, access: this.access, mediaNames, voiceURI: selectedVoice(), signal: abort.signal,
        onUsage: usage => { this.usage = usage; },
      });
      if (abort.signal.aborted) return;
      this.draft = draft;
      this.rejected = null;
      this.status = "Draft validated. Review all six sections below, then open a separate copy or download it.";
    } catch (error) {
      if (error.name === "AbortError" || abort.signal.aborted) {
        this.error = timedOut ? "Generation timed out. No board was changed." : "Generation cancelled. No board was changed.";
      } else {
        this.error = error.message || "Generation failed. No board was changed.";
        this.rejected = error.draft ? {...error.draft, errors: this.error} : null;
      }
      this.status = this.draft ? "The previous validated draft is still available." : "";
    } finally {
      clearTimeout(timer);
      this.busy = false;
      this.abort = null;
      this.update();
    }
  }

  async openCopy() {
    if (!this.draft || this.busy) return;
    this.busy = true;
    this.update();
    try {
      const name = await saveDesignCopy(this.draft, this.sourceName);
      window.location.hash = name;
    } catch (error) { this.error = `Could not save the copy: ${error.message}`; }
    finally { this.busy = false; this.update(); }
  }

  async download() {
    if (!this.draft || this.busy) return;
    try {
      // Pass the Promise immediately so browser-fs-access retains the user gesture.
      await fileSave(packDesign(this.draft.design, this.sourceName), {
        fileName: this.draft.title.replace(/[^A-Za-z0-9_-]/g, "_") + ".osdpi", extensions: [".osdpi"],
      });
    } catch (error) {
      if (error.name !== "AbortError") { this.error = `Export failed: ${error.message}`; this.update(); }
    }
  }

  template() {
    const draft = this.draft;
    const layout = draft ? walk(draft.design.layout) : [];
    return html`<details class="ai-section" ?open=${this.open}
      @toggle=${e => { this.open = e.target.open; }}>
      <summary>Generate interface with AI</summary>
      <div class="ai-body">
        <p>Create or edit a complete OS-DPI design: Layout, Content, Actions, Methods, Patterns and Cues.
          Your current board is never overwritten.</p>
        <label>Design model (Groq)
          <select data-testid="design-model" ?disabled=${this.busy} @change=${e => {
            this.model = e.target.value; localStorage.setItem("osdpi-design-model", this.model);
          }}>
            ${DESIGN_MODELS.map(([id, name]) => html`<option value=${id} ?selected=${this.model === id}>${name}</option>`)}
          </select>
        </label>
        <label>Task
          <select data-testid="design-mode" ?disabled=${this.busy} @change=${e => { this.mode = e.target.value; this.access = this.mode === "create" ? "pointer" : "preserve"; this.update(); }}>
            <option value="create" ?selected=${this.mode === "create"}>Create a new interface</option>
            <option value="edit" ?selected=${this.mode === "edit"}>Edit a copy of this board</option>
            <option value="refine" ?selected=${this.mode === "refine"} ?disabled=${!draft}>Refine the generated draft</option>
          </select>
        </label>
        <label>Access method
          <select data-testid="design-access" ?disabled=${this.busy} @change=${e => { this.access = e.target.value; }}>
            <option value="pointer" ?selected=${this.access === "pointer"}>Mouse / touch</option>
            <option value="two-switch" ?selected=${this.access === "two-switch"}>Two-switch: Space advances, Enter selects</option>
            <option value="dwell" ?selected=${this.access === "dwell"}>Pointer dwell</option>
            <option value="preserve" ?selected=${this.access === "preserve"}>Keep the existing access settings when editing</option>
          </select>
        </label>
        <label>Interface requirements
          <textarea class="ai-input ai-textarea" data-testid="design-prompt" rows="5" maxlength="3000"
            placeholder="Example: 18 restaurant phrases across Food and Drinks tabs, three columns, message bar, Speak and Clear, blue focus cue."
            .value=${this.description} ?disabled=${this.busy}
            @input=${e => { this.description = e.target.value; }}
            @keydown=${e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); this.generate(); } }}></textarea>
        </label>
        <p class="ai-key-note">Uses your saved Groq key. Qwen is selected for this feature only.
          Editing sends this board's design and vocabulary to Groq, not API keys, logs or audio.
          Start with a small board to stay within free-tier limits.</p>
        <button type="button" class="ai-generate-btn" data-testid="design-generate" ?disabled=${this.busy}
          @click=${() => this.generate()}>${this.busy ? "Generating..." : "Generate draft"}</button>
        ${this.busy && this.abort ? html`<button type="button" @click=${() => this.abort.abort()}>Cancel</button>` : html``}
        ${this.status ? html`<p role="status">${this.status}</p>` : html``}
        ${this.error ? html`<pre class="ai-error" role="alert" style="white-space:pre-wrap">${this.error}</pre>` : html``}
        ${this.rejected ? html`<button type="button" ?disabled=${this.busy} @click=${() => this.generate(true)}>Repair rejected draft (one more request)</button>` : html``}
        ${draft ? html`<section data-testid="design-draft">
          <h3>${draft.title}</h3><p>${draft.summary}</p>
          <p>${draft.design.content.length} content rows; ${layout.filter(n => n.className === "Grid").length} grids;
            ${layout.filter(n => n.className === "TabPanel").length} tabs;
            ${draft.design.actions.children.length} action rules;
            ${draft.design.method.children.length} methods;
            ${draft.design.pattern.children.length} patterns;
            ${draft.design.cues.children.length} cues.</p>
          <p>${draft.design.content.map(row => row.label).join(" | ")}</p>
          ${draft.warnings.map(text => html`<p class="ai-key-note">${text}</p>`)}
          <button type="button" data-testid="design-open" ?disabled=${this.busy} @click=${() => this.openCopy()}>Open as a new board</button>
          <button type="button" data-testid="design-download" ?disabled=${this.busy} @click=${() => this.download()}>Download .osdpi</button>
          <p class="ai-key-note">Open the copy, then use OS-DPI's Preview to test its controls and scanning before use.</p>
          <details><summary>Inspect the six native sections</summary>
            ${SECTION_NAMES.map(name => html`<details><summary>${name}.json</summary><pre style="white-space:pre-wrap;max-height:20rem;overflow:auto">${JSON.stringify(draft.design[name], null, 2)}</pre></details>`)}
          </details>
        </section>` : html``}
        ${this.usage ? html`<p class="ai-key-note">Request usage: ${this.usage.total_tokens ?? "unknown"} tokens.</p>` : html``}
      </div>
    </details>`;
  }
}
