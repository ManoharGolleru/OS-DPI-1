/** Strict provider JSON; native documents and action expressions keep their own format. */
const string={type:"string"},integer={type:"integer"},scalar={type:["string","number","boolean"]};
const nullable=schema=>({anyOf:[schema,{type:"null"}]}),array=items=>({type:"array",items});
const ref=name=>({$ref:`#/$defs/${name}`});
const object=properties=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const tag=value=>({type:"string",enum:[value]});
const fields=array(ref("field")),states=array(ref("state"));
const definitions={
  field:object({key:string,value:scalar}),
  state:object({state:string,value:scalar}),
  update:object({state:string,expression:{...string,description:"Native formula; use single quotes for text, e.g. add_word(#label), 'Ready', or ''."}}),
  rule:object({condition:string,updates:array(ref("update"))}),
  step:object({target:string,label:nullable({...string,description:"Grid/VSD content label; null for a Button or TabPanel. Never use click or active."}),data:fields}),
  test:object({name:string,initial:states,steps:array(ref("step")),expect:states}),
};
const operationSchemas={
  insert:object({op:tag("insert"),parent:string,className:string,ref:nullable({...string,description:"NEW meaningful alias such as foodWords. Do not guess numeric refs like n10; they may already exist. null if unused."}),props:fields,index:nullable({...integer,description:"Position among destination children/rows, not the operation number. null appends; use null unless moving to a specific position."})}),
  rows:object({op:tag("rows"),rows:array(fields),defaults:fields,index:nullable({...integer,description:"Position among destination children/rows, not the operation number. null appends; use null unless moving to a specific position."})}),
  update:object({op:tag("update"),target:string,props:fields,unset:array(string)}),
  move:object({op:tag("move"),target:string,parent:string,index:nullable({...integer,description:"Position among destination children/rows, not the operation number. null appends; use null unless moving to a specific position."})}),
  remove:object({op:tag("remove"),target:string}),
  bind:object({op:tag("bind"),target:string,rules:array(ref("rule")),mode:{type:"string",enum:["merge","replace"]}}),
};
export const AUTHORING_EXAMPLE_TOPICS=["keyboard","speech","navigation","state","access","timer","media"];
const commandSchemas={
  inspect:object({name:tag("inspect"),target:nullable({...string,description:"Existing ref or page/layout/actions/method/pattern/cues/content/functions/media. Use classes for class names."}),classes:{...array(string),description:"Registered classes whose native property/child schemas you need."},example:nullable({type:"string",enum:AUTHORING_EXAMPLE_TOPICS,description:"Canonical native wiring notes; choose a topic, never write a tutorial here."}),offset:integer,limit:{...integer,description:"Child count 1–100, not a byte/token limit."},depth:{...integer,description:"Child-tree depth 0–5."}}),
  edit:{description:"Stage native operations; use operations:[] with tests/summary to validate and submit an already staged draft without inventing a new edit.",...object({name:tag("edit"),operations:array(ref("operation")),tests:nullable(array(ref("test"))),title:nullable(string),summary:nullable(string)})},
  recipe:{description:"Complete keyboard fragment: Display, keys, Space, Backspace, Clear, Speak, Speech and actions. Do not add these separately before calling recipe.",...object({name:tag("recipe"),recipe:tag("keyboard"),parent:nullable(string),backspace:nullable({type:"boolean"}),keyRows:nullable(array(string)),color:nullable(string),displayPosition:nullable({type:"string",enum:["top","bottom"]}),title:nullable(string),summary:nullable(string)})},
  check:object({name:tag("check"),tests:nullable(array(ref("test")))}),
  finish:object({name:tag("finish"),title:nullable(string),summary:string,question:nullable(string)}),
};
definitions.operation={anyOf:Object.values(operationSchemas)};
definitions.command={anyOf:Object.values(commandSchemas)};
export const AUTHORING_RESPONSE_FORMAT={type:"json_schema",json_schema:{name:"native_authoring",strict:true,schema:{...object({command:ref("command")}),$defs:definitions}}};
export const AUTHORING_WIRE_GUIDE='Return one JSON command matching the response schema. Insert ONE native node per operation: parent, className, ref, props; insert parents before children and use their refs as parent. props/defaults/rows/data use arrays of {key,value}. Each row is one such array. Bind rules use updates:[{state,expression}]; expression is native formula text, including quotes for literal text. Tests use initial/expect:[{state,value}] with literal runtime values, not formulas. Use index:null to append to a parent, never the overall operation number. Use null for unused optional fields, [] for empty lists. tests:null preserves previous checks; tests:[] clears them. Inspect native wiring with example topic keyboard/speech/navigation/state/access/timer/media; use classes for property schemas and target for actual object refs or sections. No Markdown, tool-call tags, or JSON encoded inside strings.';

const assert=(condition,message)=>{if(!condition)throw new Error(`Invalid authoring response: ${message}`);};
const isObject=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const forbidden=new Set(["__proto__","prototype","constructor"]);
function primitive(value,schema,path){
  if(schema.anyOf){
    if(value===null&&schema.anyOf.some(s=>s.type==="null"))return;
    schema=schema.anyOf.find(s=>s.type!=="null");
  }
  if(schema.type){
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    assert(types.some(type=>type==="integer"?Number.isInteger(value):type==="number"?typeof value==="number"&&Number.isFinite(value):type==="array"?Array.isArray(value):type==="object"?isObject(value):typeof value===type),`${path} has the wrong value type.`);
  }
  if(schema.enum)assert(schema.enum.includes(value),`${path} must be ${schema.enum.join(" or ")}.`);
}
function record(value,schema,path){
  assert(isObject(value),`${path} must be an object.`);
  assert(Object.keys(value).every(key=>Object.hasOwn(schema.properties,key)),`${path} contains an unknown field.`);
  for(const key of schema.required){assert(Object.hasOwn(value,key),`${path}.${key} is required; use null when unused.`);primitive(value[key],schema.properties[key],`${path}.${key}`);}
  return value;
}
function list(value,path){assert(Array.isArray(value),`${path} must be an array.`);return value;}
function strings(value,path){return list(value,path).map((v,i)=>{primitive(v,string,`${path}[${i}]`);return v;});}
function entries(value,kind="field",path=kind){
  const key=kind==="field"?"key":"state",val=kind==="update"?"expression":"value",seen=new Set();
  return Object.fromEntries(list(value,path).map((entry,i)=>{
    record(entry,definitions[kind],`${path}[${i}]`);
    assert(entry[key].length>0&&!forbidden.has(entry[key]),`${path}[${i}] has an unsafe or empty ${key}.`);
    assert(!seen.has(entry[key]),`${path} repeats ${key} '${entry[key]}'.`);seen.add(entry[key]);
    return [entry[key],entry[val]];
  }));
}
function tests(value){
  return list(value,"tests").map((test,i)=>{
    record(test,definitions.test,`tests[${i}]`);
    return {name:test.name,initial:entries(test.initial,"state","initial"),expect:entries(test.expect,"state","expect"),steps:test.steps.map((step,j)=>{
      record(step,definitions.step,`steps[${j}]`);
      return {target:step.target,...(step.label===null?{}:{label:step.label}),data:entries(step.data,"field","data")};
    })};
  });
}
function operation(op,index){
  assert(isObject(op)&&Object.hasOwn(operationSchemas,op.op),`operations[${index}] has an unknown op.`);
  record(op,operationSchemas[op.op],`operations[${index}]`);
  const position=op.index==null?{}:{index:op.index};
  switch(op.op){
    case "insert":return {op:op.op,parent:op.parent,...position,nodes:[{className:op.className,...(op.ref===null?{}:{ref:op.ref}),props:entries(op.props)}]};
    case "rows":return {op:op.op,...position,rows:op.rows.map((row,i)=>entries(row,"field",`rows[${i}]`)),defaults:entries(op.defaults,"field","defaults")};
    case "update":return {op:op.op,target:op.target,props:entries(op.props),unset:strings(op.unset,"unset")};
    case "move":return {op:op.op,target:op.target,parent:op.parent,...position};
    case "remove":return {op:op.op,target:op.target};
    case "bind":return {op:op.op,target:op.target,mode:op.mode,rules:op.rules.map((rule,i)=>{
      record(rule,definitions.rule,`rules[${i}]`);return {condition:rule.condition,updates:entries(rule.updates,"update","updates")};
    })};
  }
}

/** Decode completely before the existing agent can execute any native edit. */
export function decodeAuthoringResponse(content){
  assert(typeof content==="string","content must be JSON text.");
  let root;
  try{root=JSON.parse(content);}catch{throw new Error("Invalid authoring response: expected one complete JSON command.");}
  record(root,AUTHORING_RESPONSE_FORMAT.json_schema.schema,"response");
  const command=root.command;
  assert(isObject(command)&&Object.hasOwn(commandSchemas,command.name),"command has an unknown name.");
  record(command,commandSchemas[command.name],"command");
  const {name,...values}=command;
  const args=Object.fromEntries(Object.entries(values).filter(([,value])=>value!==null));
  if(name==="edit")args.operations=command.operations.map(operation);
  if(name==="inspect")args.classes=strings(command.classes,"classes");
  if(name==="recipe"){
    delete args.recipe;args.name=command.recipe;
    if(command.keyRows!==null)args.keyRows=strings(command.keyRows,"keyRows");
  }
  if((name==="edit"||name==="check")&&command.tests!==null)args.tests=tests(command.tests);
  return {role:"assistant",content,tool_calls:[{id:"authoring-command",type:"function",function:{name,arguments:JSON.stringify(args)}}]};
}

/** Internal tool results become ordinary JSON feedback; no tools reach the provider. */
export function toWireMessages(messages){
  return messages.map(message=>{
    assert(["system","user","assistant","tool"].includes(message.role),"unsupported message role.");
    assert(typeof message.content==="string","wire history requires the original JSON/text content.");
    return {role:message.role==="tool"?"user":message.role,content:message.content};
  });
}
