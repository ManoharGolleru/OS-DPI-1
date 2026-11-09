import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AuthoringDocument,walk,node} from '../src/components/ai/authoring-document.js';
const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const catalog=json('./native-catalog.json'), empty=json('./native-empty.json');
const session=()=>new AuthoringDocument(empty,catalog);
const insert=()=>({op:'insert',parent:'page',node:{className:'Button',ref:'choice',props:{name:'choice',label:'Choose'}}});
test('all currently registered native capabilities are exposed',()=>{
 for(const cls of ['VSD','SocketHandler','ResponderEmit','ModalDialog','CueCss','Timer','Prediction'])assert.ok(catalog[cls]);
});
test('new native defaults validate',()=>assert.deepEqual(session().check().errors,[]));
test('generic insertion is not restricted to board templates',()=>{
 const s=session();s.edit([insert(),{op:'bind',target:'choice',rules:[{updates:{$Score:'increment(1)'}}]}]);
 assert.equal(s.find('choice').props.label,'Choose');assert.equal(s.check().errors.length,0);
});
test('native aliases resolve automatically generated names and keys',()=>{
 const s=session();s.edit([{op:'insert',parent:'page',node:{className:'Grid',ref:'words',props:{rows:1,columns:2}}},{op:'insert',parent:'content',labels:['Yes','No'],defaults:{grid:'@words.name'}}]);
 assert.equal(s.design.content[0].grid,s.find('words').props.name);
});
test('reference remains valid after structural moves',()=>{
 const s=session();s.edit([{op:'insert',parent:'page',node:{className:'Stack',ref:'box'}},insert(),{op:'move',target:'choice',parent:'box'},{op:'update',target:'choice',props:{label:'Moved'}}]);
 assert.equal(s.find('box').children[0],s.find('choice'));
});
test('content row references remain valid after deletion before them',()=>{
 const s=session();s.edit([{op:'insert',parent:'content',labels:['One','Two']}]);
 const [a,b]=s.design.content;s.edit([{op:'remove',target:a._ref},{op:'update',target:b._ref,fields:{label:'Still two'}}]);
 assert.equal(s.design.content[0].label,'Still two');
});
for(const [label,ops]of Object.entries({
 'unknown component':[{op:'insert',parent:'page',node:{className:'InventedWidget'}}],
 'unsupported property':[{op:'update',target:'page',props:{bogus:true}}],
 'invalid numeric property':[{op:'update',target:'page',props:{columns:'many'}}],
 'negative grid dimension':[{op:'insert',parent:'page',node:{className:'Grid',props:{rows:0}}}],
 'bad child type':[{op:'insert',parent:'page',node:{className:'Grid',children:[node('Button')]}}],
 'root removal':[{op:'remove',target:'layout'}],
 'invalid index':[{...insert(),index:200}],
 'self containment':[{op:'insert',parent:'page',node:{className:'Stack',ref:'box'}},{op:'move',target:'box',parent:'box'}],
 'duplicate aliases':[insert(),insert()],
 'missing target':[{op:'update',target:'missing',props:{label:'no'}}],
 'injected object key':[{op:'update',target:'page',props:JSON.parse('{"__proto__":{}}')}],
}))test(`reject ${label} atomically`,()=>{
 const s=session(),before=JSON.stringify(s.snapshot());assert.throws(()=>s.edit(ops));assert.equal(JSON.stringify(s.snapshot()),before);
});
test('an error rolls back successful earlier edits in its batch',()=>{
 const s=session(),before=JSON.stringify(s.snapshot());assert.throws(()=>s.edit([insert(),{op:'update',target:'page',props:{fake:1}}]));assert.equal(JSON.stringify(s.snapshot()),before);
});
test('cue references defer until all connected edits are present',()=>{
 const s=session();const method=s.design.method.children[0];
 s.edit([{op:'update',target:method._ref,props:{Pattern:'my_pattern'}}]);assert.match(s.check().errors[0].message,/Unknown pattern/);
 s.edit([{op:'insert',parent:'pattern',node:{className:'PatternManager',props:{Key:'my_pattern',Name:'Custom'},children:[]}}]);assert.deepEqual(s.check().errors,[]);
});
test('imported advanced components survive unrelated edits',()=>{
 const base=structuredClone(empty);base.layout.children[0].children.push(node('Customize',{Code:'button { border-radius: 8px; }'}));
 const s=new AuthoringDocument(base,catalog);const before=JSON.stringify(s.snapshot().layout.children[0].children[0]);s.edit([insert()]);
 assert.equal(JSON.stringify(s.snapshot().layout.children[0].children[0]),before);
});
test('snapshots contain no transient references',()=>{
 const s=session();s.edit([insert()]);assert.ok(!JSON.stringify(s.snapshot()).includes('"_ref"'));
});
test('all six sections remain present after edits',()=>{
 const s=session();s.edit([insert()]);assert.deepEqual(Object.keys(s.snapshot()).sort(),Object.keys(empty).sort());
});
test('passive displays do not require synthetic action rules',()=>{
 const s=session();s.edit([{op:'insert',parent:'page',node:{className:'Display',props:{stateName:'$Score'}}}]);assert.deepEqual(s.check().errors,[]);
});
test('new external connections are flagged for consent',()=>{
 const s=session();s.edit([{op:'insert',parent:s.design.method.children[0]._ref,node:{className:'SocketHandler',props:{URL:'wss://example.test/socket'}}}]);
 assert.ok(s.check().effects.length);
});
test('missing uploaded media is an explicit reference error',()=>{
 const s=session();s.edit([{op:'insert',parent:'content',rows:[{label:'Photo',symbol:'absent.png'}]}]);assert.match(s.check().errors[0].message,/not been uploaded/);
});
test('pre-existing diagnostics do not conceal a new error',()=>{
 const base=structuredClone(empty);base.layout.props.unknown=1;const s=new AuthoringDocument(base,catalog);
 assert.throws(()=>s.edit([{op:'update',target:'page',props:{anotherUnknown:2}}]));
});
