/** Native document transactions. No DOM, persistence, network, or model execution. */
export const SECTIONS = ["layout", "content", "actions", "method", "pattern", "cues"];
export const ROOTS = {layout:"Layout", actions:"Actions", method:"MethodChooser", pattern:"PatternList", cues:"CueList"};
export const clone = value => structuredClone(value);
export const walk = root => root ? [root, ...(root.children || []).flatMap(walk)] : [];
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const scalar = x => typeof x === "string" || typeof x === "boolean" || typeof x === "number" && Number.isFinite(x);
const object = x => x && typeof x === "object" && !Array.isArray(x);
const enabled = x => x === true || x === "true";
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const eventOrigins = new Set(["init", "*", "okSlot"]);
const operationKeys=new Map(Object.entries({insert:["parent","index","nodes"],rows:["index","rows","defaults"],update:["target","props","unset"],move:["target","parent","index"],remove:["target"],bind:["target","mode","rules"]}).map(([op,keys])=>[op,new Set(["op",...keys])]));
// These native controls actually dispatch Actions. Tabs and Radio activate
// their own handlers instead; a name alone does not make an action origin.
const actionNameFields = new Map([["Button","name"],["Grid","name"],["VSD","name"],["Display","Name"],["Method","Name"]]);
const actionOrigin = item => {
  const field=actionNameFields.get(item.className);
  return field ? item.props?.[field] : undefined;
};
const ruleCondition = action => {
  const conditions=action.children.filter(n=>n.className==="ActionCondition");
  return conditions.length<=1 ? String(conditions[0]?.props.Condition || "").trim() : null;
};
function assert(condition, message) { if (!condition) throw new Error(message); }
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "_ref").map(([k,v]) => [k, clean(v)]));
}
export const node = (className, props = {}, children = []) => ({className,props,children});

/** Minimum observable output checks. A valid JSON tree is not necessarily a
 * usable board: content rows without a filtered Grid render nothing. This
 * checks the native document, not an AI-generated self-description.
 */
export function presentationReview(design, request="", {requireVisible=true}={}) {
  const page=design?.layout?.children?.[0];
  const errors=[];
  if(!page || page.className!=="Page") return {ok:false,errors:["The design has no Page to preview."],summary:{controls:0,letters:0}};
  const layout=walk(page);
  const buttons=layout.filter(n=>n.className==="Button" && (n.props?.label || n.props?.symbol));
  const grids=layout.filter(n=>n.className==="Grid");
  const populatedGrids=grids.filter(grid=>{
    const filters=(grid.children||[]).filter(n=>n.className==="GridFilter" && n.props?.field?.startsWith("#"));
    return (design.content||[]).some(row=>filters.every(filter=>{
      if(filter.props.operator!=="equals") return true;
      const field=filter.props.field.slice(1);
      const expected=String(filter.props.value||"").replace(/^['"]|['"]$/g,"");
      return String(row[field]??"")===expected;
    }));
  });
  const displays=layout.filter(n=>n.className==="Display");
  const others=layout.filter(n=>["VSD","Indicator","Prediction","Radio"].includes(n.className));
  const controls=buttons.length+populatedGrids.length+others.length;
  if(requireVisible && !controls) errors.push("The draft has no visible, populated controls. Content rows need a displayed Grid, or add buttons/visual components to the Page before finishing.");
  const keyboard=/\bqwerty\b/i.test(request) && /\bkeyboard\b/i.test(request);
  if(keyboard) {
    const rows=(design.content||[]).filter(r=>/^[a-z]$/i.test(String(r.label||""))).map(r=>r.label.toUpperCase());
    const keys=rows.length?rows:buttons.filter(b=>/^[a-z]$/i.test(String(b.props.label||""))).map(b=>b.props.label.toUpperCase());
    if(keys.join("")!=="QWERTYUIOPASDFGHJKLZXCVBNM") errors.push("The requested QWERTY keyboard needs exactly 26 keys, in QWERTY, ASDFGHJKL, ZXCVBNM order.");
    const displayStates=displays.map(n=>n.props?.stateName || "$Display");
    if(/\b(display|message)\b/i.test(request) && !displays.length) errors.push("The requested keyboard message display is missing.");
    const updates=walk(design.actions||{}).filter(n=>n.className==="ActionUpdate");
    if(!updates.some(n=>/\badd_letter\s*\(/.test(n.props?.newValue||""))) errors.push("The keyboard keys are missing a native add_letter action.");
    const linked=(label,state)=>{
      const matching=buttons.filter(b=>String(b.props.label).toLowerCase()===label.toLowerCase());
      const origins=new Set(matching.map(b=>b.props.name));
      return (design.actions?.children||[]).some(a=>origins.has(a.props.origin) && walk(a).some(n=>n.className==="ActionUpdate" && n.props.stateName===state));
    };
    const speechStates=layout.filter(n=>n.className==="Speech").map(n=>n.props.stateName || "$Speak");
    if(/\bspeak\b/i.test(request) && !speechStates.some(state=>linked("Speak",state))) errors.push("The requested Speak button is missing its speech action or Speech listener.");
    if(/\bclear\b/i.test(request) && !displayStates.some(state=>linked("Clear",state))) errors.push("The requested Clear button is missing its display action.");
    if(/\bbackspace\b/i.test(request) && !buttons.some(b=>/backspace/i.test(b.props.label||""))) errors.push("The requested Backspace button is missing.");
  }
  return {ok:!errors.length,errors,summary:{controls,buttons:buttons.length,populatedGrids:populatedGrids.length,displays:displays.length,letters:(design.content||[]).filter(r=>/^[a-z]$/i.test(r.label||"")).length}};
}


/** Stable references last for the entire model request, including moves and edits. */
export class AuthoringDocument {
  constructor(design, catalog, {expressionCheck = () => null, mediaNames = []} = {}) {
    this.design = clone(design);
    this.catalog = catalog;
    this.expressionCheck = expressionCheck;
    this.mediaNames = new Set(mediaNames);
    this.sequence = 0;
    this.changes = [];
    this.refresh();
    this.baseline = this.diagnose();
  }
  nextRef(occupied=this.refs) {
    let ref;do{ref=`n${++this.sequence}`;}while(occupied.has(ref));return ref;
  }
  refresh() {
    const records=[];
    const visit=(item,parent,section,depth=0)=>{
      assert(depth<80&&records.length<6000,"The design exceeds the native editor safety limit.");
      assert(object(item),"A native component or content row must be an object.");
      records.push({item,parent,section});
      if(section!=="content")for(const child of item.children||[])visit(child,item,section,depth+1);
    };
    for(const section of SECTIONS){
      if(section==="content")for(const row of this.design.content||[])visit(row,null,section);
      else if(this.design[section])visit(this.design[section],null,section);
    }
    // Reserve imported identities before allocating any anonymous reference.
    const occupied=new Set(records.map(({item})=>item._ref||item.id).filter(Boolean));
    this.refs=new Map();this.parents=new Map();
    for(const {item,parent,section}of records){
      if(!item._ref)item._ref=item.id||this.nextRef(occupied);
      assert(!this.refs.has(item._ref),`Duplicate editing reference: ${item._ref}`);
      this.refs.set(item._ref,item);this.parents.set(item._ref,{parent,section});
    }
  }
  find(ref) {
    if (own(ROOTS,ref)) return this.design[ref];
    if (ref === "page") return this.design.layout.children[0];
    const found = this.refs.get(ref);
    if(!found && typeof ref==="string" && ref.startsWith("@") && (this.refs.has(ref.slice(1)) || own(ROOTS,ref.slice(1)) || ref.slice(1)==="page"))
      throw new Error(`Unknown reference ${ref}. Use target ${ref.slice(1)} without @; @ref.property is only for scalar values.`);
    if(!found){
      const named=[...this.refs.values()].filter(n=>n.props?.name===ref || n.props?.Name===ref);
      if(named.length===1)throw new Error(`Unknown reference ${ref}. That is a native name; use target "${named[0]._ref}" (${named[0].className}). References and native names are different.`);
    }
    assert(found, `Unknown reference ${ref}. Use inspect to read the current document.`);
    return found;
  }
  resolve(value) {
    if (typeof value === "string") return value.replace(/@([\w-]+)\.([A-Za-z_]\w*)/g, (_m,ref,key) => {
      const item = this.find(ref);
      const v = (item.props || item)[key];
      assert(scalar(v), `Reference @${ref}.${key} does not identify a scalar property.`);
      return String(v);
    });
    if (Array.isArray(value)) return value.map(v => this.resolve(v));
    if (object(value)) {
      assert(!Object.keys(value).some(k => forbidden.has(k)), "Unsafe object key.");
      return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.resolve(v)]));
    }
    return value;
  }
  unique(base) {
    const values = new Set([...this.refs.values()].flatMap(n => [n.props?.name,n.props?.Name,n.props?.Key]));
    const slug = String(base).replace(/[^a-zA-Z0-9_]/g,"_") || "item";
    let name=slug, i=2;
    while(values.has(name)) name=slug+ i++;
    return name;
  }
  prepare(spec) {
    assert(object(spec) && this.catalog[spec.className], `Unknown native component: ${spec?.className}. Inspect the catalog.`);
    assert(!Object.keys(spec).some(k=>!["className","props","children","ref"].includes(k)), "A component accepts className, props, children, and optional ref only.");
    assert(spec.props===undefined || object(spec.props),"Native properties belong in a props object; do not JSON-encode it as a string.");
    assert(spec.children===undefined || Array.isArray(spec.children),"Native children must be an array of component nodes.");
    const result=node(spec.className, this.resolve(spec.props || {}));
    const fields=this.catalog[spec.className].props;
    if(fields.Key?.generated && !result.props.Key) result.props.Key=this.unique("key_"+ (++this.sequence));
    if(fields.name && !own(result.props,"name")) result.props.name=this.unique(spec.ref || spec.className.toLowerCase());
    if(spec.className==="TabControl" && !own(result.props,"stateName")) {
      const used=new Set([...this.refs.values()].map(n=>n.props?.stateName ?? this.catalog[n.className]?.props.stateName?.default));
      const base="$"+String(result.props.name || "tabs").replace(/[^a-zA-Z0-9_]/g,"_");
      let stateName=base,index=2;
      while(used.has(stateName))stateName=base+index++;
      result.props.stateName=stateName;
    }
    if(fields.Response) result.props.Response=spec.className;
    if(fields.CueType) result.props.CueType=spec.className;
    result._ref=spec.ref || this.nextRef();
    assert(/^[A-Za-z][\w-]{0,80}$/.test(result._ref) && ![...SECTIONS,"page"].includes(result._ref), "Use a short unique reference, not a section name.");
    const existing=this.refs.get(result._ref);
    assert(!existing,`Reference already exists: ${result._ref} (${existing?.className || "data row"} ${existing?.props?.name || existing?.props?.Name || ""}). Change it with update target "${result._ref}". For a genuinely NEW component use another meaningful ref or omit ref. Do not reinsert successful batches or guess n-numbers.`);
    this.refs.set(result._ref,result); // children may refer to the new parent
    result.children=(spec.children || []).map(child=>this.prepare(child));
    return result;
  }
  /** Every generic edit batch is atomic; cross-reference checks run after the entire request. */
  edit(operations) {
    assert(Array.isArray(operations) && operations.length && operations.length<=80,"Provide between 1 and 80 edits in a batch.");
    const previous=clone(this.design), seq=this.sequence;
    const before=this.diagnose().errors,removedRules=new Set();
    let operationIndex=-1;
    try {
      for(const [index,op] of operations.entries()) {
        operationIndex=index;
        assert(object(op) && typeof op.op==="string", "Each edit needs an op.");
        const allowed=operationKeys.get(op.op);
        assert(allowed,`Unknown edit '${op.op}'. Use insert, rows, update, move, remove or bind.`);
        const extra=Object.keys(op).filter(key=>!allowed.has(key));
        assert(!extra.length,`${op.op} does not accept ${extra.join(", ")}. Allowed fields: ${[...allowed].join(", ")}. Native components use insert with nodes; vocabulary/data records use rows.`);
        if(op.op==="insert") {
            assert(op.parent!=="content","insert creates native components under page or another native container. Use {op:'rows',rows:[{label:'Bread'}]} for vocabulary/data records.");
            const parent=this.find(op.parent);
            assert(parent.children,"The insertion parent is not a native container.");
            const specs=op.nodes;
            assert(Array.isArray(specs)&&specs.length>0,'insert needs nodes, e.g. {op:"insert",parent:"page",nodes:[{className:"Button",ref:"choice",props:{label:"Choose"}}]}.');
            const created=specs.map(spec=>this.prepare(spec));
            parent.children.splice(this.index(op.index,parent.children.length),0,...created);
        } else if(op.op==="rows") {
            assert(Array.isArray(op.rows)&&op.rows.length&&op.rows.length<=1000,"rows needs 1–1000 vocabulary/data records, e.g. [{label:'Bread',grid:'food'}]. It does not create interface components or initialize states.");
            assert(op.defaults===undefined || object(op.defaults),"Data defaults must be an object of shared field values.");
            const inserted=op.rows.map(row=>{
              assert(object(row),"Each data row must be an object of scalar fields.");
              return {...this.resolve(op.defaults || {}),...this.resolve(row),_ref:this.nextRef()};
            });
            this.design.content.splice(this.index(op.index,this.design.content.length),0,...inserted);
        } else if(op.op==="update") {
          const target=this.find(op.target),isRow=this.parents.get(target._ref)?.section==="content", props=isRow?target:target.props;
          const changes=this.resolve(op.props || {});
          assert(object(changes),"Update properties must be an object.");
          for(const [key,value] of Object.entries(changes)) {
            assert(!(isRow?["_ref"]:["_ref","id","className","children"]).includes(key) && !forbidden.has(key),"Update cannot replace structure or editing identifiers.");
            props[key]=value;
          }
          for(const key of op.unset || []) {
            assert(!(isRow?["_ref"]:["_ref","id","className","children"]).includes(key),"Cannot remove an editing identifier.");
            delete props[key];
          }
        } else if(op.op==="move" || op.op==="remove") {
          const target=this.find(op.target);
          const {parent,section}=this.parents.get(target._ref);
          assert(parent || section==="content","Section roots cannot be removed or moved.");
          const list=parent ? parent.children : this.design.content;
          if(op.op==="move") {
            const next=this.find(op.parent);
            assert(parent && next.children && !walk(target).includes(next),"Cannot move a row, or move a component inside itself.");
            assert(this.parents.get(next._ref).section===section,"Move within a native section, not between unrelated sections.");
            list.splice(list.indexOf(target),1);
            next.children.splice(this.index(op.index,next.children.length),0,target);
          } else {
            if(section==="layout") {
              const origins=new Set(walk(target).map(actionOrigin).filter(Boolean));
              for(const action of this.design.actions.children)if(origins.has(action.props.origin)&&!eventOrigins.has(action.props.origin))removedRules.add(action);
            }
            list.splice(list.indexOf(target),1);
          }
        } else if(op.op==="bind") {
          const mode=op.mode===undefined ? "merge" : op.mode;
          assert(["merge","replace"].includes(mode), "bind mode must be merge or replace.");
          const target=eventOrigins.has(op.target) ? null : this.find(op.target);
          if(target) {
            const nameField=actionNameFields.get(target.className);
            const initialization='For startup initialization use {op:"bind",target:"init",rules:[{updates:{$Score:"0"}}]}; do not create a Method for initialization.';
            let enclosing=this.parents.get(target._ref)?.parent;
            while(enclosing && enclosing.className!=="Method")enclosing=this.parents.get(enclosing._ref)?.parent;
            assert(nameField, ["Page","Stack"].includes(target.className)
              ? `${target.className} is a layout container, not an action event. ${initialization}`
              : ["Speech","Audio"].includes(target.className)
              ? `${target.className} listens to state ${target.props.stateName || this.catalog[target.className]?.props.stateName?.default}; it does not dispatch actions. Bind the input Button/Grid to update that state instead.`
              : enclosing
              ? `${target.className} does not dispatch native Actions. ResponderEmit dispatches its enclosing Method; use bind target "${enclosing._ref}".`
              : `${target.className} does not dispatch native Actions. Tabs and Radio navigate/select directly; bind a Button, Grid, VSD, Display or Method instead. ${initialization}`);
            if(!String(target.props[nameField] || "").trim())target.props[nameField]=this.unique(target._ref || target.className.toLowerCase());
          }
          const origin=target ? actionOrigin(target) : op.target;
          assert(origin,"This target needs a native name before attaching an action.");
          assert(Array.isArray(op.rules)&&op.rules.length,"bind needs rules with condition and updates.");
          const rules=op.rules.map(rule=>{
            assert(object(rule)&&Object.keys(rule).every(key=>["condition","updates"].includes(key)),"Each bind rule accepts condition and updates only.");
            assert(rule.condition===undefined || typeof rule.condition==="string","A rule condition must be an expression string.");
            assert(object(rule.updates)&&Object.keys(rule.updates).length,"Each bind rule needs a nonempty updates object.");
            const condition=this.resolve(rule.condition || "").trim();
            const updates=Object.entries(rule.updates).map(([state,value])=>[this.resolve(state),this.resolve(value)]);
            assert(new Set(updates.map(([state])=>state)).size===updates.length,"Each resolved state may appear only once in a bind rule.");
            return node("Action",{origin},[node("ActionCondition",{Condition:condition}),...updates.map(([stateName,newValue])=>node("ActionUpdate",{stateName,newValue}))]);
          });
          const actions=this.design.actions.children;
          if(mode==="replace") {
            let index=actions.findIndex(action=>action.props.origin===origin);
            if(index<0)index=actions.findIndex(action=>action.props.origin==="*");
            if(index<0)index=actions.length;
            this.design.actions.children=actions.filter(action=>action.props.origin!==origin);
            this.design.actions.children.splice(index,0,...rules);
          } else for(const rule of rules) {
            const condition=ruleCondition(rule);
            const existing=actions.find(action=>action.props.origin===origin&&ruleCondition(action)===condition);
            if(existing) {
              // Native Actions evaluates one patch; the last duplicate state
              // wins. Keep all unrelated updates and the existing rule's ref.
              for(const update of rule.children.filter(n=>n.className==="ActionUpdate")) {
                const previous=existing.children.filter(n=>n.className==="ActionUpdate"&&n.props.stateName===update.props.stateName).at(-1);
                if(previous)previous.props.newValue=update.props.newValue;
                else existing.children.push(update);
              }
            } else {
              // Preserve first-match order: a new specific condition precedes
              // its fallback, and a new fallback follows existing conditions.
              let index=condition ? actions.findIndex(action=>action.props.origin===origin&&ruleCondition(action)==="") : -1;
              if(index<0) {
                const last=actions.map(action=>action.props.origin).lastIndexOf(origin);
                index=last>=0 ? last+1 : actions.findIndex(action=>action.props.origin==="*");
              }
              if(index<0)index=actions.length;
              actions.splice(index,0,rule);
            }
          }
        }
        this.refresh();
        assert(this.refs.size<6000,"The working document exceeds the 6,000-object safety limit.");
      }
      operationIndex=-1;
      if(removedRules.size) {
        const surviving=new Set([...walk(this.design.layout),...(this.design.method?.children || [])].map(actionOrigin).filter(Boolean));
        this.design.actions.children=this.design.actions.children.filter(action=>!removedRules.has(action)||surviving.has(action.props.origin));
        this.refresh();
      }
      const structural=this.diagnose().errors.filter(e=>!e.deferred && !before.some(old=>old.key===e.key && old.message===e.message));
      assert(!structural.length, structural.map(e=>`${e.ref}: ${e.message}`).join("\n"));
      this.changes.push(...operations.map(x=>`${x.op} ${x.target || x.parent || ""}`));
      return {ok:true, outline:this.outline(), pending:this.check().errors};
    } catch(error) {
      this.design=previous;this.sequence=seq;this.refresh();
      throw new Error(`${operationIndex>=0?`operations[${operationIndex}] ${operations[operationIndex]?.op}: `:"Batch validation: "}${error.message} Nothing in this batch was applied.`);
    }
  }
  index(value,length) {
    if(value===undefined || value===null || value===-1)return length;
    assert(Number.isInteger(value)&&value>=0&&value<=length,"index must identify an insertion position, or -1 for the end.");
    return value;
  }
  snapshot(){return clean(this.design);}
  describe(item,depth=1) {
    if(Array.isArray(item))return item.map(n=>this.describe(n,depth));
    if(!item.className || this.parents.get(item._ref)?.section==="content")return {ref:item._ref,fields:clean(item)};
    const result={ref:item._ref,className:item.className,props:item.props};
    if(depth>0)result.children=item.children.map(n=>this.describe(n,depth-1));
    else result.children=item.children.map(n=>({ref:n._ref,className:n.className,name:n.props.name || n.props.Name || n.props.origin || "",...(n.props.Key?{key:n.props.Key}:{})}));
    return result;
  }
  outline() {
    return Object.fromEntries(SECTIONS.map(s=>[s,s==="content"
      ? {count:this.design.content.length,rows:this.design.content.slice(0,15).map(r=>({ref:r._ref,label:r.label,grid:r.grid}))}
      : this.describe(this.design[s],s==="layout"?2:0)]));
  }
  diagnose() {
    const errors=[], warnings=[], effects=[];
    const issue=(item,key,message,deferred=false)=>errors.push({ref:item?._ref || "document",key:`${item?._ref || "document"}.${key}`,message,deferred});
    const prop=(n,k)=>n.props[k] ?? this.catalog[n.className]?.props[k]?.default;
    const nodes=[];
    const visit=(n,parent,section)=>{
      if(!object(n)||!this.catalog[n.className]){issue(n,"className",`Unregistered component ${n?.className}.`);return;}
      nodes.push(n);
      const spec=this.catalog[n.className];
      if(parent && !this.catalog[parent.className]?.children.includes(n.className)){
        const roots=Object.entries(ROOTS).filter(([,root])=>this.catalog[root]?.children.includes(n.className)).map(([section])=>section);
        issue(n,"parent",`${n.className} is not a child of ${parent.className}.`+(roots.length?` Insert ${n.className} with parent ${roots.map(root=>JSON.stringify(root)).join(" or ")}.`:""));
      }
      for(const [key,value] of Object.entries(n.props || {})) {
        const p=spec.props[key];
        if(!p){issue(n,key,`Unknown ${n.className} property '${key}'. Inspect its schema.`);continue;}
        if(p.expression && typeof value!=="string") {
          issue(n,key,`Expression '${key}' must be a string containing native formula text. Use "0" for a number, "true" for a boolean, or "'Ready'" for literal text.`);
          continue;
        }
        if(!scalar(value)){issue(n,key,`Property '${key}' must be a string, number, or boolean.`);continue;}
        const formula=p.expression || typeof value==="string"&&value.startsWith("=");
        if(formula) {
          const error=this.expressionCheck(String(value));
          if(error)issue(n,key,`Invalid expression: ${error}`);
          if(/\b(load_design|toggle_speech_suggestions)\s*\(/.test(value))effects.push({ref:n._ref,message:"An action loads an external design or activates cloud conversation services."});
        } else if(p.type==="number" || p.type==="integer") {
          const v=Number(value);
          if(!Number.isFinite(v) || p.type==="integer"&&!Number.isInteger(v))issue(n,key,`${key} must be ${p.type}.`);
          if(p.min!==undefined && v<p.min || p.max!==undefined&&v>p.max)issue(n,key,`${key} is outside its native allowed range.`);
        } else if(p.type==="boolean" && ![true,false,"true","false"].includes(value)) issue(n,key,`${key} must be true or false.`);
        else if(p.choices?.length && value!=="" && !p.choices.includes(String(value)))issue(n,key,`Use a native ${key} option: ${p.choices.join(", ")}.`);
        if(!formula && p.validate){const error=p.validate(value);if(error)issue(n,key,error);}
        if(["URL","url","Address"].includes(key) && value)effects.push({ref:n._ref,message:`External address: ${String(value).replace(/([?&](?:key|token|secret)=)[^&]*/gi,"$1[redacted]")}`});
        if(p.type==="css" && /(?:url\s*\(|@import|<\/style)/i.test(String(value)))effects.push({ref:n._ref,message:"Custom CSS contains an external resource or style boundary."});
      }
      if(n.className==="HeadMouse") effects.push({ref:n._ref,message:"Head-mouse input requests camera access."});
      if(n.className==="Prediction" && ["ai","groq"].includes(String(prop(n,"predictor"))))effects.push({ref:n._ref,message:"Cloud predictions send text to an AI service."});
      for(const child of n.children || [])visit(child,n,section);
      const groups=new Map();
      for(const child of n.children || [])for(const [key,p] of Object.entries(this.catalog[child.className]?.props || {})) {
        if(!p.exclusiveGroup || !enabled(prop(child,key)))continue;
        if(groups.has(p.exclusiveGroup))issue(child,key,`Only one sibling may enable ${p.exclusiveGroup}. Disable the other selection explicitly.`);
        else groups.set(p.exclusiveGroup,child);
      }
    };
    for(const [section,root] of Object.entries(ROOTS)) {
      if(this.design[section]?.className!==root)issue(null,section,`Missing native ${root} root.`);
      else visit(this.design[section],null,section);
    }
    if(this.design.layout?.children?.length!==1)issue(this.design.layout,"children","Layout needs exactly one Page. Use tabs or nested containers for more views.");
    for(const row of this.design.content || []) {
      for(const [key,value] of Object.entries(row))if(key!=="_ref" && (forbidden.has(key)||!scalar(value)))issue(row,key,"Content fields must contain scalar values and safe field names.");
    }
    for(const n of [...nodes,...(this.design.content || [])]) {
      const symbol=n.props?.symbol ?? n.symbol;
      if(!symbol)continue;
      if(/^(?:https?:|data:)/i.test(String(symbol)))effects.push({ref:n._ref,message:"An image or media reference loads an external or embedded resource."});
      else if(!this.mediaNames.has(symbol))issue(n,"symbol",`Media '${symbol}' has not been uploaded.`,true);
    }
    const keys=new Map();
    for(const n of nodes)if(this.catalog[n.className]?.props.Key?.generated && n.props.Key){
      const key=n.props.Key;
      if(keys.has(key))issue(n,"Key",`Duplicate native key '${key}'.`);
      else keys.set(key,n);
    }
    for(const n of nodes) {
      for(const [key,type] of [["Cue","cue"],["Pattern","pattern"]]) {
        const value=prop(n,key);
        if(!value || ["DefaultCue","DefaultPattern","NullPattern"].includes(value))continue;
        if(!this.catalog[n.className].props[key])continue;
        const target=keys.get(value);
        if(!target || (type==="pattern"?target.className!=="PatternManager":!this.design.cues.children.includes(target)))issue(n,key,`Unknown ${type} '${value}'.`,true);
      }
      if(n.className==="TimerHandler" || n.className==="ResponderStartTimer") {
        let parent=this.parents.get(n._ref)?.parent;
        while(parent && parent.className!=="Method")parent=this.parents.get(parent._ref)?.parent;
        if(!parent?.children.some(c=>c.className==="Timer"&&c.props.Key===prop(n,"TimerName")))issue(n,"TimerName","TimerName must reference a Timer in the same Method.",true);
      }
      if(n.className==="Timer" && Number(prop(n,"Interval"))<=0)issue(n,"Interval","Timer interval must be positive seconds.");
      if(n.className==="ActionUpdate" && !/^\$[\w]+(?:\.[\w]+)*$/.test(String(prop(n,"stateName"))))issue(n,"stateName","ActionUpdate needs a $state variable.");
    }
    const origins=new Set([...walk(this.design.layout),...(this.design.method?.children || [])].map(actionOrigin).filter(Boolean));
    for(const action of this.design.actions?.children || []) {
      if(!eventOrigins.has(action.props.origin)&&!origins.has(action.props.origin))issue(action,"origin",`Action '${action.props.origin}' has no matching named layout component or method. Bind the component ref or use its actual name.`,true);
    }
    if(!this.design.method?.children?.some(n=>enabled(prop(n,"Active"))))warnings.push("No access method is active. Check the intended input behavior in Preview.");
    return {errors,warnings,effects};
  }
  check() {
    const result=this.diagnose();
    const baseline=this.baseline || {errors:[],effects:[]};
    const matches=(list,e)=>list.some(b=>b.key===e.key&&b.message===e.message);
    return {
      errors:result.errors.filter(e=>!matches(baseline.errors,e)),
      existing:result.errors.filter(e=>matches(baseline.errors,e)),
      warnings:result.warnings,
      effects:result.effects.filter(e=>!baseline.effects.some(b=>b.ref===e.ref&&b.message===e.message)),
    };
  }
}
