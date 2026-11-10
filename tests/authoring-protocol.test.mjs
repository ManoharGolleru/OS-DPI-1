import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUTHORING_RESPONSE_FORMAT,decodeAuthoringResponse,toWireMessages} from '../src/components/ai/authoring-protocol.js';
import {AuthoringDocument} from '../src/components/ai/authoring-document.js';

const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const catalog=json('./native-catalog.json'),empty=json('./native-empty.json');
const fields=value=>Object.entries(value).map(([key,value])=>({key,value}));
const insert=(parent,className,ref,props={})=>({op:'insert',parent,className,ref,props:fields(props),index:null});
const edit=operations=>({name:'edit',operations,tests:null,title:null,summary:null});
const decode=command=>decodeAuthoringResponse(JSON.stringify({command}));
const args=command=>JSON.parse(decode(command).tool_calls[0].function.arguments);

test('strict response schema closes all objects, requires every field, resolves refs and stays compact',()=>{
 const format=AUTHORING_RESPONSE_FORMAT,schema=format.json_schema.schema;
 assert.equal(format.type,'json_schema');assert.equal(format.json_schema.strict,true);
 const visit=value=>{
  if(!value||typeof value!=='object')return;
  if(value.type==='object'){
   assert.equal(value.additionalProperties,false);
   assert.deepEqual(value.required,Object.keys(value.properties));
  }
  if(value.$ref)assert.ok(schema.$defs[value.$ref.replace('#/$defs/','')]);
  for(const child of Object.values(value))visit(child);
 };
 visit(schema);assert.ok(JSON.stringify(format).length<6000);
});

test('flat native inserts build arbitrary parent-child trees through the existing atomic editor',()=>{
 const command=edit([
  insert('page','Stack','body',{direction:'column'}),
  insert('body','TabControl','tabs'),
  insert('tabs','TabPanel','food',{name:'Food'}),
  insert('food','Grid','choices',{rows:1,columns:2}),
  insert('choices','GridFilter','filter',{field:'#grid',operator:'equals',value:"'food'"}),
  insert('page','Speech','speech',{stateName:'$Speak'}),
  {op:'rows',rows:[fields({label:'Bread',id:4,className:'data column'})],defaults:fields({grid:'food'}),index:null},
  {op:'bind',target:'choices',mode:'merge',rules:[{condition:'',updates:[{state:'$Display',expression:'add_word(#label)'}]}]},
 ]);
 const native=args(command),session=new AuthoringDocument(empty,catalog);
 assert.equal(native.tests,undefined);assert.equal(native.summary,undefined);
 assert.equal(native.operations[0].nodes.length,1);
 session.edit(native.operations);
 assert.equal(session.find('filter').className,'GridFilter');
 assert.equal(session.parents.get(session.find('filter')._ref).parent,session.find('choices'));
 assert.equal(session.find('speech').props.stateName,'$Speak');
 assert.deepEqual(session.design.content[0].label,'Bread');
 assert.deepEqual(session.check().errors,[]);
});

test('expression updates and literal expectations retain distinct exact values',()=>{
 const command=edit([{op:'bind',target:'init',mode:'merge',rules:[{condition:'',updates:[{state:'$Status',expression:"'Ready'"},{state:'$Count',expression:'0'}]}]}]);
 command.tests=[{name:'Start',initial:[],steps:[],expect:[{state:'$Status',value:'Ready'},{state:'$Count',value:0}]}];
 const native=args(command);
 assert.deepEqual(native.operations[0].rules[0].updates,{$Status:"'Ready'",$Count:'0'});
 assert.deepEqual(native.tests[0].expect,{$Status:'Ready',$Count:0});
 command.operations[0].rules[0].updates[0].expression=0;
 assert.throws(()=>decode(command),/expression has the wrong value type/);
});

test('all remaining native operations retain order and explicit replacement semantics',()=>{
 const command=edit([
  insert('page','Stack','box'),insert('page','Button','choice',{label:'Old'}),
  {op:'move',target:'choice',parent:'box',index:0},
  {op:'update',target:'choice',props:fields({label:'Say “hi” 🗣',scale:2}),unset:[]},
  {op:'bind',target:'choice',mode:'replace',rules:[{condition:'$Display',updates:[{state:'$Speak',expression:'$Display'}]}]},
  {op:'remove',target:'choice'},
 ]);
 const session=new AuthoringDocument(empty,catalog);
 session.edit(args(command).operations);
 assert.equal(session.find('box').children.length,0);
 assert.equal(session.design.actions.children.length,0);
});

test('invalid native properties still roll back the full decoded batch',()=>{
 const session=new AuthoringDocument(empty,catalog),before=session.snapshot();
 const native=args(edit([insert('page','Button','first',{label:'First'}),insert('page','Button','bad',{inventedProperty:true})]));
 assert.throws(()=>session.edit(native.operations),/Nothing in this batch was applied/);
 assert.deepEqual(session.snapshot(),before);
});

test('duplicate and unsafe map keys cannot silently overwrite requested data',()=>{
 for(const props of [
  [{key:'label',value:'One'},{key:'label',value:'Two'}],
  [{key:'__proto__',value:'x'}],
  [{key:'constructor',value:'x'}],
  [{key:'',value:'x'}],
 ])assert.throws(()=>decode(edit([{...insert('page','Button','choice'),props}])),/repeats|unsafe or empty/);
 const command={name:'check',tests:[{name:'Example',initial:[],steps:[],expect:[{state:'$Text',value:'One'},{state:'$Text',value:'Two'}]}]};
 assert.throws(()=>decode(command),/repeats/);
});

test('strict wire rejects malformed JSON, old native maps, extra keys and nested inserts',()=>{
 assert.throws(()=>decodeAuthoringResponse('```json\n{}\n```'),/complete JSON/);
 assert.throws(()=>decodeAuthoringResponse('{"command":'),/complete JSON/);
 assert.throws(()=>decodeAuthoringResponse('{"command":{"name":"unknown"}}'),/unknown name/);
 for(const op of [
  {...insert('page','Button','choice'),props:{label:'Bad'}},
  {...insert('page','Button','choice'),children:[]},
  {op:'insert',parent:'page',nodes:[{className:'Button'}]},
  {...insert('page','Button','choice'),index:1.5},
 ])assert.throws(()=>decode(edit([op])),/Invalid authoring response/);
});

test('inspect, recipe, check and finish decode only their canonical internal arguments',()=>{
 assert.deepEqual(args({name:'inspect',target:'page',classes:['Grid'],example:null,offset:0,limit:10,depth:1}),{target:'page',classes:['Grid'],offset:0,limit:10,depth:1});
 assert.deepEqual(args({name:'recipe',recipe:'keyboard',parent:null,backspace:null,keyRows:null,color:null,displayPosition:null,title:'Typing',summary:'Done'}),{name:'keyboard',title:'Typing',summary:'Done'});
 assert.deepEqual(args({name:'check',tests:null}),{});
 assert.deepEqual(args({name:'check',tests:[]}),{tests:[]});
 assert.deepEqual(args({name:'finish',title:null,summary:'Updated',question:null}),{summary:'Updated'});
 assert.deepEqual(args({name:'finish',title:null,summary:'',question:'Which file?'}),{summary:'',question:'Which file?'});
});

test('state checks preserve event data, false, zero and empty literal values',()=>{
 const command={name:'check',tests:[{name:'Event',initial:[{state:'$Text',value:''}],steps:[{target:'method',label:null,data:fields({Signal:'go',number:0,enabled:false})}],expect:[{state:'$Text',value:''},{state:'$Enabled',value:false}]}]};
 assert.deepEqual(args(command).tests[0],{name:'Event',initial:{$Text:''},steps:[{target:'method',data:{Signal:'go',number:0,enabled:false}}],expect:{$Text:'',$Enabled:false}});
});

test('outbound history preserves exact strict JSON and exposes no tool role or tool-call metadata',()=>{
 const content=JSON.stringify({command:edit([insert('page','Button','choice',{label:'Choose'})])},null,2);
 const assistant=decodeAuthoringResponse(content);
 const wire=toWireMessages([{role:'system',content:'Native instructions'},{role:'user',content:'Create a button'},assistant,{role:'tool',tool_call_id:'authoring-command',content:'{"ok":true,"staged":true}'}]);
 assert.equal(wire[2].content,content);assert.equal(wire[3].role,'user');
 assert.ok(wire.every(message=>Object.keys(message).join(',')==='role,content'));
 assert.throws(()=>toWireMessages([{role:'assistant',content:null,tool_calls:assistant.tool_calls}]),/original JSON/);
});
