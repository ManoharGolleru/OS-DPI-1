import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AuthoringDocument,walk,node,presentationReview} from '../src/components/ai/authoring-document.js';
import {compactFeedback,compactSchemas,describeForModel} from '../src/components/ai/authoring-context.js';
const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const catalog=json('./native-catalog.json'), empty=json('./native-empty.json');
const session=()=>new AuthoringDocument(empty,catalog);
const insert=()=>({ op: 'insert', parent: 'page', nodes: [{ className: 'Button', ref: 'choice', props: { name: 'choice', label: 'Choose' } }] });
test('oversized inspection preserves requested dwell wiring before class schemas',()=>{
 const s=session(),method=s.design.method.children.find(n=>/dwell/i.test(n.props.Name));
 assert.ok(method);
 const object=describeForModel(s,method,{depth:5,limit:100});
 const result=compactFeedback({object,schemas:compactSchemas(catalog,Object.keys(catalog),{help:true})},{catalog});
 assert.ok(JSON.stringify(result).length<=5000);
 assert.deepEqual(result.object,object);
 assert.ok(result.omittedClasses.length>0);
 const nodes=walk(result.object);
 assert.ok(nodes.some(n=>n.className==='Timer'&&n.props.Interval!==undefined));
 assert.ok(nodes.some(n=>n.className==='PointerHandler'&&n.props.Signal));
 assert.ok(nodes.some(n=>n.className==='ResponderStartTimer'&&n.props.TimerName));
});
test('mistyped property notation in an exact reference is rejected with its known target',()=>{
 const s=session();s.edit([insert()]);const before=s.snapshot();
 assert.throws(()=>s.find('@choice'),/Use target choice without @/);
 assert.equal(s.find('choice').className,'Button');
 assert.throws(()=>s.find('@missing'),/Use inspect/);
 assert.deepEqual(s.snapshot(),before);
});
test('wide scalar rows remain inspectable within the response budget with explicit omissions',()=>{
 const fields=Object.fromEntries(Array.from({length:100},(_,i)=>['column'+i,'value'.repeat(16)]));
 const result=compactFeedback({object:{ref:'wideRow',fields}});
 assert.ok(JSON.stringify(result).length<=5000);
 assert.equal(result.object.ref,'wideRow');assert.ok(result.object.omittedProps.length>0);
 for(const [key,value] of Object.entries(result.object.props))assert.equal(value,fields[key]);
 assert.equal(Object.keys(result.object.props).length+result.object.omittedProps.length,100);
});
test('large staged-edit errors retain the actual corrections and native refs within the tool budget',()=>{
 const feedback={ok:false,staged:true,instruction:'Edits are kept; correct the bindings, do not repeat inserts.',
  errors:Array.from({length:30},(_,i)=>({ref:'action'+i,key:'action'+i+'.origin',message:'No matching named layout component. Bind the native component ref.'})),
  pending:Array.from({length:30},()=>({message:'Duplicate detail'.repeat(100)})),
  created:[{ref:'keys',className:'Grid',name:'keyboard'},...Array.from({length:90},(_,i)=>({ref:'update'+i,className:'ActionUpdate'}))]};
 const result=compactFeedback(feedback);
 assert.ok(JSON.stringify(result).length<=5000);
 assert.equal(result.staged,true);assert.equal(result.ok,false);
 assert.equal(result.created[0].ref,'keys');assert.equal(result.errors[0].ref,'action0');
 assert.equal(result.moreErrors,26);assert.match(result.instruction,/do not repeat/);
 assert.equal(result.error,undefined);
});
test('canonical operations reject ambiguous insert forms and ignored fields atomically',()=>{
 for(const invalid of [
  {op:'insert',parent:'content',rows:[{label:'Bread'}]},
  {op:'insert',parent:'page',node:{className:'Button'}},
  {op:'update',target:'page',rows:[{label:'Bread'}]},
  {op:'update',target:'page',fields:{background:'red'}},
  // Actual rejected Groq generations: let native validation give the precise
  // correction rather than accepting these as aliases or ignoring the fields.
  {op:'rows',parent:'page',rows:[{label:'Bread'}],defaults:{grid:'food'}},
  {op:'rows',target:'foodGrid',rows:[{label:'Bread'}]},
  {op:'bind',target:'init',bindings:[{stateName:'$Display',value:"''"}]},
 ]){
  const s=session(),before=s.snapshot();
  assert.throws(()=>s.edit([insert(),invalid]),/operations\[1\].*Nothing in this batch was applied/);
  assert.deepEqual(s.snapshot(),before);
 }
});
test('native property objects and child arrays are checked before preparing nodes',()=>{
 for(const spec of [{className:'Button',props:'{"label":"Bread"}'},{className:'Stack',children:{className:'Button'}}]){
  const s=session(),before=s.snapshot();
  assert.throws(()=>s.edit([{op:'insert',parent:'page',nodes:[spec]}]),/operations\[0\]/);
  assert.deepEqual(s.snapshot(),before);
 }
});
test('data fields cannot masquerade as created native components',()=>{
 const s=session();s.edit([{op:'rows',rows:[{label:'Demo',className:'Button',props:'Example',children:'One',ref:'data-value'}]}]);
 const row=s.design.content[0],ref=row._ref;
 assert.equal(s.find('page').children.length,0);
 assert.deepEqual(s.describe(row),{ref,fields:{label:'Demo',className:'Button',props:'Example',children:'One',ref:'data-value'}});
 s.edit([{op:'update',target:ref,props:{className:'Grid',props:'Updated'}}]);
 assert.equal(s.design.content[0].className,'Grid');
 assert.equal(s.design.content[0].props,'Updated');
 assert.deepEqual(s.check().errors,[]);
});
test('all currently registered native capabilities are exposed',()=>{
 for(const cls of ['VSD','SocketHandler','ResponderEmit','ModalDialog','CueCss','Timer','Prediction'])assert.ok(catalog[cls]);
});
test('new native defaults validate',()=>assert.deepEqual(session().check().errors,[]));
test('generic insertion is not restricted to board templates',()=>{
 const s=session();s.edit([insert(),{op:'bind',target:'choice',rules:[{updates:{$Score:'increment(1)'}}]}]);
 assert.equal(s.find('choice').props.label,'Choose');assert.equal(s.check().errors.length,0);
});
test('native aliases resolve automatically generated names and keys',()=>{
 const s=session();s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Grid', ref: 'words', props: { rows: 1, columns: 2 } }] },{ op: "rows", rows: Array.from(['Yes', 'No'], label => ({ label })), defaults: { grid: '@words.name' } }]);
 assert.equal(s.design.content[0].grid,s.find('words').props.name);
});
test('new action origins must resolve; existing imported diagnostics remain preserved',()=>{
 const s=session();s.edit([{ op: 'insert', parent: 'actions', nodes: [{ className: 'Action', props: { origin: 'missing' }, children: [node('ActionUpdate', { stateName: '$Display', newValue: "''" })] }] }]);
 assert.match(s.check().errors[0].message,/no matching named/);
 const imported=new AuthoringDocument(s.snapshot(),catalog);
 imported.edit([insert()]);assert.deepEqual(imported.check().errors,[]);
});
test('a supplied component alias also names the native action origin by default',()=>{
 const s=session();s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', ref: 'backspace', props: { label: 'Backspace' } }] }]);
 assert.equal(s.find('backspace').props.name,'backspace');
});
test('reference remains valid after structural moves',()=>{
 const s=session();s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Stack', ref: 'box' }] },insert(),{op:'move',target:'choice',parent:'box'},{op:'update',target:'choice',props:{label:'Moved'}}]);
 assert.equal(s.find('box').children[0],s.find('choice'));
});
test('content row references remain valid after deletion before them',()=>{
 const s=session();s.edit([{ op: "rows", rows: Array.from(['One', 'Two'], label => ({ label })) }]);
 const [a,b]=s.design.content;s.edit([{op:'remove',target:a._ref},{ op: 'update', target: b._ref, props: { label: 'Still two' } }]);
 assert.equal(s.design.content[0].label,'Still two');
});
for(const [label,ops]of Object.entries({
 'unknown component':[{ op: 'insert', parent: 'page', nodes: [{ className: 'InventedWidget' }] }],
 'unsupported property':[{op:'update',target:'page',props:{bogus:true}}],
 'invalid numeric property':[{op:'update',target:'page',props:{columns:'many'}}],
 'negative grid dimension':[{ op: 'insert', parent: 'page', nodes: [{ className: 'Grid', props: { rows: 0 } }] }],
 'bad child type':[{ op: 'insert', parent: 'page', nodes: [{ className: 'Grid', children: [node('Button')] }] }],
 'root removal':[{op:'remove',target:'layout'}],
 'invalid index':[{...insert(),index:200}],
 'self containment':[{ op: 'insert', parent: 'page', nodes: [{ className: 'Stack', ref: 'box' }] },{op:'move',target:'box',parent:'box'}],
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
 s.edit([{ op: 'insert', parent: 'pattern', nodes: [{ className: 'PatternManager', props: { Key: 'my_pattern', Name: 'Custom' }, children: [] }] }]);assert.deepEqual(s.check().errors,[]);
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
 const s=session();s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Display', props: { stateName: '$Score' } }] }]);assert.deepEqual(s.check().errors,[]);
});
test('new external connections are flagged for consent',()=>{
 const s=session();s.edit([{ op: 'insert', parent: s.design.method.children[0]._ref, nodes: [{ className: 'SocketHandler', props: { URL: 'wss://example.test/socket' } }] }]);
 assert.ok(s.check().effects.length);
});
test('missing uploaded media is an explicit reference error',()=>{
 const s=session();s.edit([{ op: "rows", rows: [{ label: 'Photo', symbol: 'absent.png' }] }]);assert.match(s.check().errors[0].message,/not been uploaded/);
});
test('pre-existing diagnostics do not conceal a new error',()=>{
 const base=structuredClone(empty);base.layout.props.unknown=1;const s=new AuthoringDocument(base,catalog);
 assert.throws(()=>s.edit([{op:'update',target:'page',props:{anotherUnknown:2}}]));
});

test('content rows without a displayed grid must not count as a finished board',()=>{
 const s=session();s.edit([{ op: "rows", rows: Array.from(['Hello', 'Water'], label => ({ label })) }]);
 assert.deepEqual(s.check().errors,[]); // Valid structure, but empty Preview
 const review=presentationReview(s.snapshot(),'Create a communication board');
 assert.equal(review.ok,false);
 assert.match(review.errors.join(' '),/no visible, populated controls/);
});
test('a displayed populated native grid passes the generic presentation check',()=>{
 const s=session();s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Grid', props: { name: 'words', rows: 1, columns: 2 }, children: [{ className: 'GridFilter', props: { field: '#grid', operator: 'equals', value: "'words'" } }] }] },{ op: "rows", rows: Array.from(['Hello', 'Water'], label => ({ label })), defaults: { grid: 'words' } }]);
 assert.equal(presentationReview(s.snapshot(),'Create a communication board').ok,true);
});
test('a visible but incomplete QWERTY keyboard is not a valid completion',()=>{
 const s=session();s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { name: 'a', label: 'a' } }] }]);
 const review=presentationReview(s.snapshot(),'Create a QWERTY keyboard with display, Speak, Clear and Backspace.');
 assert.equal(review.ok,false);
 assert.match(review.errors.join(' '),/26 keys/);
 assert.match(review.errors.join(' '),/Speak button/);
});

const rule=(origin,condition,updates)=>node('Action',{origin},[
 node('ActionCondition',{Condition:condition}),
 ...Object.entries(updates).map(([stateName,newValue])=>node('ActionUpdate',{stateName,newValue})),
]);
const updates=action=>Object.fromEntries(action.children.filter(n=>n.className==='ActionUpdate').map(n=>[n.props.stateName,n.props.newValue]));
const conditions=actions=>actions.map(a=>a.children.filter(n=>n.className==='ActionCondition').map(c=>c.props.Condition));

test('bind merges init states and preserves other conditional rules and stable refs',()=>{
 const base=structuredClone(empty);
 base.actions.children.push(rule('init','',{$Category:"'food'",$Score:'0'}),rule('init','$Restored',{$Restored:'false'}));
 const s=new AuthoringDocument(base,catalog),[startup,conditional]=s.design.actions.children,untouched=structuredClone(conditional);
 s.edit([{op:'bind',target:'init',rules:[{updates:{$Score:'1',$Greeting:"'Hello'"}}]}]);
 assert.equal(s.design.actions.children.length,2);
 assert.equal(s.design.actions.children[0],startup);
 assert.deepEqual(updates(startup),{$Category:"'food'",$Score:'1',$Greeting:"'Hello'"});
 assert.deepEqual(conditional,untouched);
 assert.deepEqual(s.check().errors,[]);
});

test('bind only changes specified states in a matching condition, including the effective duplicate update',()=>{
 const base=structuredClone(empty);base.layout.children[0].children.push(node('Button',{name:'choice',label:'Choose'}));
 const first=rule('choice','$Ready',{$Score:'1',$Speak:"'Ready'"});
 first.children.push(node('ActionUpdate',{stateName:'$Score',newValue:'2'}));
 base.actions.children.push(first,rule('choice','',{$Speak:"'Wait'"}));
 const s=new AuthoringDocument(base,catalog),button=s.design.layout.children[0].children[0];
 const fallback=structuredClone(s.design.actions.children[1]);
 s.edit([{op:'bind',target:button._ref,rules:[{condition:'  $Ready  ',updates:{$Score:'increment(1)'}}]}]);
 assert.deepEqual(s.design.actions.children[0].children.filter(n=>n.props.stateName==='$Score').map(n=>n.props.newValue),['1','increment(1)']);
 assert.equal(updates(s.design.actions.children[0]).$Speak,"'Ready'");
 assert.deepEqual(s.design.actions.children[1],fallback);
});

test('new bind conditions retain first-match ordering and do not overwrite multi-condition rules',()=>{
 const s=session();s.edit([insert(),{op:'bind',target:'choice',rules:[{updates:{$Speak:"'Fallback'"}}]}]);
 s.edit([{op:'bind',target:'choice',rules:[{condition:'$A',updates:{$Speak:"'A'"}},{condition:'$B',updates:{$Speak:"'B'"}}]}]);
 assert.deepEqual(conditions(s.design.actions.children),[['$A'],['$B'],['']]);
 const multi=rule('choice','$C',{$Speak:"'C and D'"});multi.children.unshift(node('ActionCondition',{Condition:'$D'}));
 s.edit([{ op: 'insert', parent: 'actions', nodes: [multi], index: 0 }]);
 const before=structuredClone(s.design.actions.children[0]);
 s.edit([{op:'bind',target:'choice',rules:[{condition:'$C',updates:{$Speak:"'C'"}}]}]);
 assert.deepEqual(s.design.actions.children[0],before);
 assert.deepEqual(conditions(s.design.actions.children),[['$D','$C'],['$A'],['$B'],['$C'],['']]);
});

test('adding a fallback preserves existing conditions and precedes a global wildcard',()=>{
 const s=session();s.edit([insert(),{op:'bind',target:'*',rules:[{updates:{$Fallback:'1'}}]},
 {op:'bind',target:'choice',rules:[{condition:'$Ready',updates:{$Score:'1'}}]},
 {op:'bind',target:'choice',rules:[{updates:{$Score:'0'}}]}]);
 assert.deepEqual(s.design.actions.children.map(a=>a.props.origin),['choice','choice','*']);
 assert.deepEqual(conditions(s.design.actions.children),[['$Ready'],[''],['']]);
});

test('explicit replace replaces only the requested origin at its existing position',()=>{
 const s=session();s.edit([insert(),{op:'bind',target:'init',rules:[{updates:{$Score:'0'}}]},
 {op:'bind',target:'choice',rules:[{condition:'$A',updates:{$Score:'1'}},{updates:{$Score:'2'}}]},
 {op:'bind',target:'*',rules:[{updates:{$Fallback:'1'}}]}]);
 const init=structuredClone(s.design.actions.children[0]),wildcard=structuredClone(s.design.actions.children.at(-1));
 s.edit([{op:'bind',target:'choice',mode:'replace',rules:[{updates:{$Score:'3'}}]}]);
 assert.deepEqual(s.design.actions.children.map(a=>a.props.origin),['init','choice','*']);
 assert.deepEqual(s.design.actions.children[0],init);assert.deepEqual(s.design.actions.children.at(-1),wildcard);
 assert.deepEqual(updates(s.design.actions.children[1]),{$Score:'3'});
});

test('Display bind generates its native Name and resolves condition and state aliases',()=>{
 const s=session();s.edit([{op:'insert',parent:'page',nodes:[{className:'Button',props:{name:'screen',label:'Other'}},{className:'Display',ref:'screen',props:{Name:'',stateName:'$Message'}}]},
 {op:'bind',target:'screen',rules:[{condition:'@screen.stateName',updates:{'@screen.stateName':"add_word('Hello')"}}]}]);
 assert.equal(s.find('screen').props.Name,'screen2');
 assert.equal(s.design.actions.children[0].props.origin,'screen2');
 assert.deepEqual(conditions(s.design.actions.children),[['$Message']]);
 assert.deepEqual(updates(s.design.actions.children[0]),{$Message:"add_word('Hello')"});
 assert.deepEqual(s.check().errors,[]);
});

test('bind supports actual native wildcard and slot-completion events',()=>{
 const s=session();s.edit([{op:'bind',target:'okSlot',rules:[{updates:{$Finished:'true'}}]},{op:'bind',target:'*',rules:[{updates:{$Last:'#label'}}]}]);
 assert.deepEqual(s.design.actions.children.map(a=>a.props.origin),['okSlot','*']);
 assert.deepEqual(s.check().errors,[]);
});

for(const className of ['TabControl','Radio'])test(`bind rejects direct-activation ${className} without inventing Actions`,()=>{
 const s=session();s.edit([{ op: 'insert', parent: 'page', nodes: [{ className, ref: 'direct' }] }]);
 const before=s.snapshot();
 assert.throws(()=>s.edit([{op:'bind',target:'direct',rules:[{updates:{$View:"'next'"}}]}]),/does not dispatch native Actions/);
 assert.deepEqual(s.snapshot(),before);
});

test('invalid bind modes, shapes and unresolved state aliases roll back the complete batch',()=>{
 for(const op of [
  {mode:'append',rules:[{updates:{$Score:'1'}}]},
  {mode:null,rules:[{updates:{$Score:'1'}}]},
  {rules:[{condition:true,updates:{$Score:'1'}}]},
  {rules:[{updates:{}}]},
  {rules:[{updates:{$Score:'1'},extra:true}]},
  {rules:[{updates:{'@missing.stateName':'1'}}]},
  {rules:[{updates:{notAState:'1'}}]},
 ]) {
  const s=session(),before=s.snapshot();
  assert.throws(()=>s.edit([insert(),{op:'bind',target:'choice',...op}]));
  assert.deepEqual(s.snapshot(),before);
 }
});

test('removing a layout subtree removes only its unique native bindings, retaining content and media references',()=>{
 const s=new AuthoringDocument(empty,catalog,{mediaNames:['photo.png']});
 s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Stack', ref: 'group', children: [{ className: 'Button', ref: 'removed', props: { label: 'Remove' } }] }] },
 insert(),{ op: "rows", rows: [{ label: 'Keep image', symbol: 'photo.png' }] },
 {op:'bind',target:'removed',rules:[{updates:{$Message:"'Removed'"}}]},
 {op:'bind',target:'choice',rules:[{updates:{$Message:"'Kept'"}}]},
 {op:'bind',target:'init',rules:[{updates:{$Message:"''"}}]}]);
 const rows=structuredClone(s.design.content),kept=structuredClone(s.design.actions.children.filter(a=>a.props.origin!=='removed'));
 s.edit([{op:'remove',target:'group'}]);
 assert.deepEqual(s.design.actions.children,kept);assert.deepEqual(s.design.content,rows);
 assert.ok(s.mediaNames.has('photo.png'));assert.deepEqual(s.check().errors,[]);
});

test('deletion retains shared-origin rules and resolves same-batch replacement before cleaning bindings',()=>{
 const s=session();s.edit([{op:'insert',parent:'page',nodes:[{className:'Button',ref:'a',props:{name:'shared'}},{className:'Button',ref:'b',props:{name:'shared'}}]},
 {op:'bind',target:'a',rules:[{updates:{$Count:'increment(1)'}}]}]);
 const action=structuredClone(s.design.actions.children[0]);
 s.edit([{op:'remove',target:'a'}]);assert.deepEqual(s.design.actions.children,[action]);
 s.edit([{op:'remove',target:'b'},{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', ref: 'replacement', props: { name: 'shared' } }] }]);
 assert.deepEqual(s.design.actions.children,[action]);assert.deepEqual(s.check().errors,[]);
});

test('deletion keeps rules shared with a native method and preserves unrelated imported diagnostics',()=>{
 const base=structuredClone(empty);
 base.layout.children[0].children.push(node('Button',{name:'shared',label:'Shared'}));
 base.method.children[0].props.Name='shared';
 base.actions.children.push(rule('shared','',{$Count:'increment(1)'}),rule('missing','',{$Old:'0'}));
 const s=new AuthoringDocument(base,catalog),before=structuredClone(s.design.actions.children);
 s.edit([{op:'remove',target:s.design.layout.children[0].children[0]._ref}]);
 assert.deepEqual(s.design.actions.children,before);
 assert.deepEqual(s.check().errors,[]);assert.match(s.check().existing[0].message,/no matching named/);
});

test('cleanup never hides newly inserted orphan rules after deletion',()=>{
 const s=session();s.edit([insert(),{op:'bind',target:'choice',rules:[{updates:{$Score:'1'}}]}]);
 s.edit([{op:'remove',target:'choice'},{ op: 'insert', parent: 'actions', nodes: [rule('choice', '', { $Score: '2' })] }]);
 assert.equal(s.design.actions.children.length,1);
 assert.match(s.check().errors[0].message,/no matching named/);
});

test('exclusive native sibling selections require an explicit switch and preserve imported conflicts',()=>{
 const s=session(),[first,second]=s.design.pattern.children;
 assert.ok(catalog.PatternManager.props.Active.exclusiveGroup);
 const before=s.snapshot();
 assert.throws(()=>s.edit([{op:'update',target:first._ref,props:{Active:true}}]),/Only one sibling/);
 assert.deepEqual(s.snapshot(),before);
 s.edit([{op:'update',target:first._ref,props:{Active:true}},{op:'update',target:second._ref,props:{Active:false}}]);
 assert.deepEqual(s.check().errors,[]);
 const imported=s.snapshot();imported.pattern.children[1].props.Active=true;
 const existing=new AuthoringDocument(imported,catalog);
 existing.edit([insert()]);assert.deepEqual(existing.check().errors,[]);
 assert.ok(existing.check().existing.some(error=>error.message.includes('Only one sibling')));
});

for(const value of [0,3.5,true,false])test(`native expression value ${JSON.stringify(value)} is rejected atomically instead of coerced`,()=>{
 const s=session(),before=s.snapshot();
 assert.throws(()=>s.edit([insert(),{op:'bind',target:'choice',rules:[{updates:{$Score:value}}]}]),/Expression 'newValue' must be a string.*"0".*"true".*"'Ready'"/);
 assert.deepEqual(s.snapshot(),before);
});

test('numeric and boolean expressions are rejected in conditions, filters and existing updates',()=>{
 for(const operations of [
  [{ op: 'insert', parent: 'actions', nodes: [node('Action', { origin: 'init' }, [node('ActionCondition', { Condition: false }), node('ActionUpdate', { stateName: '$Score', newValue: '0' })])] }],
  [{ op: 'insert', parent: 'page', nodes: [node('Grid', {}, [node('GridFilter', { field: '#grid', operator: 'equals', value: 1 })])] }],
 ]) {
  const s=session(),before=s.snapshot();assert.throws(()=>s.edit(operations),/must be a string containing native formula text/);assert.deepEqual(s.snapshot(),before);
 }
 const s=session();s.edit([{op:'bind',target:'init',rules:[{updates:{$Score:'0'}}]}]);
 const update=s.design.actions.children[0].children.find(n=>n.className==='ActionUpdate'),before=s.snapshot();
 assert.throws(()=>s.edit([{op:'update',target:update._ref,props:{newValue:0}}]),/must be a string containing native formula text/);
 assert.deepEqual(s.snapshot(),before);
});

test('string expression values keep native numeric, boolean and quoted literal syntax',()=>{
 const checked=[];
 const s=new AuthoringDocument(empty,catalog,{expressionCheck:value=>{assert.equal(typeof value,'string');checked.push(value);return null;}});
 s.edit([{op:'bind',target:'init',rules:[{updates:{$Score:'0',$Enabled:'true',$Status:"'Ready'"}}]}]);
 assert.deepEqual(updates(s.design.actions.children[0]),{$Score:'0',$Enabled:'true',$Status:"'Ready'"});
 assert.ok(checked.includes('0'));assert.ok(checked.includes('true'));assert.ok(checked.includes("'Ready'"));
 assert.deepEqual(s.check().errors,[]);
});

test('pre-existing malformed expression diagnostics are preserved without masking new invalid writes',()=>{
 const base=structuredClone(empty);base.actions.children.push(rule('init','',{$Old:0}));
 const s=new AuthoringDocument(base,catalog);
 s.edit([insert()]);assert.deepEqual(s.check().errors,[]);
 assert.ok(s.check().existing.some(error=>error.message.includes('must be a string')));
 const before=s.snapshot();
 assert.throws(()=>s.edit([{op:'bind',target:'choice',rules:[{updates:{$New:false}}]}]),/must be a string/);
 assert.deepEqual(s.snapshot(),before);
});

test('new TabControls receive independent native states derived from their actual names',()=>{
 const s=session();s.edit([{op:'insert',parent:'page',nodes:[
  {className:'TabControl',ref:'foodTabs'},
  {className:'TabControl',ref:'drinkTabs'},
  {className:'TabControl',ref:'explicitName',props:{name:'options'}},
 ]}]);
 assert.equal(s.find('foodTabs').props.stateName,'$foodTabs');
 assert.equal(s.find('drinkTabs').props.stateName,'$drinkTabs');
 assert.equal(s.find('explicitName').props.stateName,'$options');
 assert.equal(new Set(['foodTabs','drinkTabs','explicitName'].map(ref=>s.find(ref).props.stateName)).size,3);
});

test('generated TabControl states avoid existing state writers and implicit native tab defaults',()=>{
 const base=structuredClone(empty);base.layout.children[0].children.push(node('TabControl',{name:'imported'}));
 const s=new AuthoringDocument(base,catalog);
 s.edit([{op:'bind',target:'init',rules:[{updates:{$options:'0'}}]},
 {op:'insert',parent:'page',nodes:[{className:'TabControl',ref:'namedTabs',props:{name:'options'}},{className:'TabControl',ref:'defaultTabs',props:{name:'tabControl'}}]}]);
 assert.equal(s.find('namedTabs').props.stateName,'$options2');
 assert.equal(s.find('defaultTabs').props.stateName,'$tabControl2');
 assert.deepEqual(s.check().errors,[]);
});

test('explicit TabControl state names retain intentional sharing and resolve through aliases',()=>{
 const s=session();s.edit([{op:'insert',parent:'page',nodes:[
  {className:'TabControl',ref:'firstTabs',props:{stateName:'$SharedView'}},
  {className:'TabControl',ref:'secondTabs',props:{stateName:'@firstTabs.stateName'}},
 ]}]);
 assert.equal(s.find('firstTabs').props.stateName,'$SharedView');
 assert.equal(s.find('secondTabs').props.stateName,'$SharedView');
});

for(const className of ['Page','Stack'])test(`binding ${className} directs initialization to the existing init event`,()=>{
 const s=session();let target='page';
 if(className==='Stack'){s.edit([{ op: 'insert', parent: 'page', nodes: [{ className, ref: 'container' }] }]);target='container';}
 const before=s.snapshot();
 assert.throws(()=>s.edit([{op:'bind',target,rules:[{updates:{$Score:'0'}}]}]),/layout container.*target:"init".*do not create a Method for initialization/);
 assert.deepEqual(s.snapshot(),before);
});

for(const [className,nameField,parent] of [['Button','name','page'],['Grid','name','page'],['VSD','name','page'],['Display','Name','page'],['Method','Name','method']])test(`explicit binding generates a unique native ${className}.${nameField} when blank`,()=>{
 const s=session();s.edit([
  { op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { name: 'control', label: 'Existing' } }] },
  { op: 'insert', parent, nodes: [{ className, ref: 'control', props: { [nameField]: ' ' } }] },
  {op:'bind',target:'control',rules:[{updates:{$Result:"'Activated'"}}]},
 ]);
 assert.equal(s.find('control').props[nameField],'control2');
 assert.equal(s.design.actions.children[0].props.origin,'control2');
 assert.deepEqual(s.check().errors,[]);
});

test('Method binding preserves an explicit native name and still enforces its native parent',()=>{
 const s=session();s.edit([{ op: 'insert', parent: 'method', nodes: [{ className: 'Method', ref: 'methodRef', props: { Name: 'Existing method' } }] },
 {op:'bind',target:'methodRef',rules:[{updates:{$Count:'increment(1)'}}]}]);
 assert.equal(s.find('methodRef').props.Name,'Existing method');
 assert.equal(s.design.actions.children[0].props.origin,'Existing method');
 const before=s.snapshot();
 assert.throws(()=>s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Method', ref: 'wrongParent' }] },{op:'bind',target:'wrongParent',rules:[{updates:{$Score:'0'}}]}]),/Method is not a child of Page/);
 assert.deepEqual(s.snapshot(),before);
});

test('generated component and row references skip an existing model alias',()=>{
 const s=session(),alias=`n${s.sequence+2}`;
 s.edit([{op:'insert',parent:'page',nodes:[{className:'Button',ref:alias,props:{label:'Keep'}},{className:'Display'},{className:'Display'}]}]);
 assert.equal(s.find(alias).props.label,'Keep');
 const nextAlias=`n${s.sequence+2}`;
 s.edit([{op:'insert',parent:'page',nodes:[{className:'Button',ref:nextAlias,props:{label:'Preserve'}}]},{op:'rows',rows:[{label:'One'},{label:'Two'},{label:'Three'}]}]);
 assert.equal(s.find(nextAlias).props.label,'Preserve');assert.equal(s.design.content.length,3);assert.deepEqual(s.check().errors,[]);
});
test('imported identities are reserved before anonymous nodes receive editing references',()=>{
 const design=structuredClone(empty);
 design.layout.children[0].children=[node('Display'),{...node('Button',{name:'imported',label:'Keep'}),id:'n3'}];
 const s=new AuthoringDocument(design,catalog);
 assert.equal(s.find('n3').props.label,'Keep');assert.equal(s.find('page').children[0].className,'Display');
 assert.notEqual(s.find('page').children[0]._ref,'n3');assert.deepEqual(s.check().errors,[]);
});
test('colliding new aliases identify the existing object and reject the entire batch with actionable guidance',()=>{
 const s=session(),ref=s.find('page')._ref,before=s.snapshot();
 assert.throws(()=>s.edit([{op:'insert',parent:'page',nodes:[{className:'Button',ref,props:{label:'No'}}]}]),/Reference already exists:.*Page.*meaningful ref.*Nothing in this batch was applied/);
 assert.deepEqual(s.snapshot(),before);
});
