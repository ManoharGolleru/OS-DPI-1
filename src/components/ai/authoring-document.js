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
function assert(condition, message) { if (!condition) throw new Error(message); }
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "_ref").map(([k,v]) => [k, clean(v)]));
}
export const node = (className, props = {}, children = []) => ({className,props,children});

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
  refresh() {
    this.refs = new Map();
    this.parents = new Map();
    const visit = (item,parent,section,depth=0) => {
      assert(depth<80 && this.refs.size<6000,"The design exceeds the native editor safety limit.");
      assert(object(item), "A native component or content row must be an object.");
      if (!item._ref) item._ref = item.id || `n${++this.sequence}`;
      assert(!this.refs.has(item._ref), `Duplicate editing reference: ${item._ref}`);
      this.refs.set(item._ref,item);
      this.parents.set(item._ref,{parent,section});
      for (const child of item.children || []) visit(child,item,section,depth+1);
    };
    for (const name of SECTIONS) {
      if (name === "content") for (const row of this.design.content || []) visit(row,null,name);
      else if (this.design[name]) visit(this.design[name],null,name);
    }
  }
  find(ref) {
    if (own(ROOTS,ref)) return this.design[ref];
    if (ref === "page") return this.design.layout.children[0];
    const found = this.refs.get(ref);
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
    const result=node(spec.className, this.resolve(spec.props || {}));
    const fields=this.catalog[spec.className].props;
    if(fields.Key && !result.props.Key) result.props.Key=this.unique("key_"+ (++this.sequence));
    if(fields.name && !own(result.props,"name")) result.props.name=this.unique(spec.className.toLowerCase());
    if(fields.Response) result.props.Response=spec.className;
    if(fields.CueType) result.props.CueType=spec.className;
    result._ref=spec.ref || `n${++this.sequence}`;
    assert(/^[A-Za-z][\w-]{0,80}$/.test(result._ref) && ![...SECTIONS,"page"].includes(result._ref), "Use a short unique reference, not a section name.");
    assert(!this.refs.has(result._ref), `Reference already exists: ${result._ref}`);
    this.refs.set(result._ref,result);
    result.children=(spec.children || []).map(child=>this.prepare(child));
    return result;
  }
  /** Every generic edit batch is atomic; cross-reference checks run after the entire request. */
  edit(operations) {
    assert(Array.isArray(operations) && operations.length && operations.length<=80,"Provide between 1 and 80 edits in a batch.");
    const previous=clone(this.design), seq=this.sequence;
    const before=this.diagnose().errors;
    try {
      for(const op of operations) {
        assert(object(op) && typeof op.op==="string", "Each edit needs an op.");
        if(op.op==="insert") {
          if(op.parent === "content") {
            const rows=op.rows || (typeof op.characters==="string" ? [...op.characters].map(label=>({label})) : (op.labels || []).map(label=>({label})));
            assert(Array.isArray(rows) && rows.length && rows.length<=1000,"Content insert needs rows, labels, or characters.");
            const inserted=rows.map(row=>({...this.resolve(op.defaults || {}),...this.resolve(row),_ref:`n${++this.sequence}`}));
            this.design.content.splice(this.index(op.index,this.design.content.length),0,...inserted);
          } else {
            const parent=this.find(op.parent);
            assert(parent.children,"The insertion parent is not a native container.");
            const specs=op.nodes || (op.node ? [op.node] : []);
            assert(specs.length>0,"Insert needs node or nodes.");
            const created=specs.map(spec=>this.prepare(spec));
            parent.children.splice(this.index(op.index,parent.children.length),0,...created);
          }
        } else if(op.op==="update") {
          const target=this.find(op.target), props=target.props || target;
          const changes=this.resolve(op.props || op.fields || {});
          assert(object(changes),"Update properties must be an object.");
          for(const [key,value] of Object.entries(changes)) {
            assert(!["_ref","id","className","children"].includes(key) && !forbidden.has(key),"Update cannot replace structure or editing identifiers.");
            props[key]=value;
          }
          for(const key of op.unset || []) {
            assert(!["_ref","id","className","children"].includes(key),"Cannot remove an editing identifier.");
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
          } else list.splice(list.indexOf(target),1);
        } else if(op.op==="bind") {
          const target=op.target==="init" ? null : this.find(op.target);
          const origin=target ? target.props.name || target.props.Name : "init";
          assert(origin,"This target needs a native name before attaching an action.");
          const rules=op.rules;
          assert(Array.isArray(rules)&&rules.length,"bind needs rules with condition and updates.");
          this.design.actions.children=this.design.actions.children.filter(n=>n.props.origin!==origin);
          const added=rules.map(rule=>node("Action",{origin},[
            node("ActionCondition",{Condition:rule.condition || ""}),
            ...Object.entries(this.resolve(rule.updates || {})).map(([stateName,newValue])=>node("ActionUpdate",{stateName,newValue})),
          ]));
          this.design.actions.children.unshift(...added);
        } else throw new Error(`Unknown edit '${op.op}'. Use insert, update, move, remove, or bind.`);
        this.refresh();
        assert(this.refs.size<6000,"The working document exceeds the 6,000-object safety limit.");
      }
      const structural=this.diagnose().errors.filter(e=>!e.deferred && !before.some(old=>old.key===e.key && old.message===e.message));
      assert(!structural.length, structural.map(e=>`${e.ref}: ${e.message}`).join("\n"));
      this.changes.push(...operations.map(x=>`${x.op} ${x.target || x.parent || ""}`));
      return {ok:true, outline:this.outline(), pending:this.check().errors};
    } catch(error) {
      this.design=previous;this.sequence=seq;this.refresh();throw error;
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
    if(!item.className)return {ref:item._ref,...clean(item)};
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
      if(parent && !this.catalog[parent.className]?.children.includes(n.className))issue(n,"parent",`${n.className} is not a child of ${parent.className}.`);
      for(const [key,value] of Object.entries(n.props || {})) {
        const p=spec.props[key];
        if(!p){issue(n,key,`Unknown ${n.className} property '${key}'. Inspect its schema.`);continue;}
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
        if(["URL","url","Address"].includes(key) && value)effects.push({ref:n._ref,message:`External address: ${String(value).replace(/([?&](?:key|token|secret)=)[^&]*/gi,"$1[redacted]")}`});
        if(p.type==="css" && /(?:url\s*\(|@import|<\/style)/i.test(String(value)))effects.push({ref:n._ref,message:"Custom CSS contains an external resource or style boundary."});
      }
      if(n.className==="HeadMouse") effects.push({ref:n._ref,message:"Head-mouse input requests camera access."});
      if(n.className==="Prediction" && ["ai","groq"].includes(String(prop(n,"predictor"))))effects.push({ref:n._ref,message:"Cloud predictions send text to an AI service."});
      for(const child of n.children || [])visit(child,n,section);
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
    for(const n of nodes)if(n.props.Key){
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
    const origins=new Set(nodes.filter(n=>walk(this.design.layout).includes(n)).map(n=>n.props.name || n.props.Name).filter(Boolean));
    for(const m of this.design.method?.children || [])origins.add(m.props.Name);
    for(const action of this.design.actions?.children || []) {
      if(!["init","*"].includes(action.props.origin)&&!origins.has(action.props.origin))warnings.push(`Action '${action.props.origin}' has no matching named layout component or method.`);
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
