import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {starterDesign, validateDesign, node, walk, SECTION_NAMES} from '../src/components/ai/design-format.js';
const catalog=JSON.parse(readFileSync(new URL('./design-catalog.json',import.meta.url),'utf8'));
const inspect=d=>validateDesign(d,catalog);
for(const access of ['pointer','dwell','two-switch']) test(`${access} native example`,()=>{
 const d=starterDesign(access);assert.deepEqual(inspect(d).errors,[]);assert.deepEqual(Object.keys(d).sort(),[...SECTION_NAMES].sort());
});
const mutations={
 'missing section':d=>delete d.cues,
 'wrong root':d=>d.layout.className='Stack',
 'unsupported component':d=>d.layout.children.push(node('SocketHandler')),
 'unknown property':d=>d.layout.props.bogus='x',
 'bad child relationship':d=>d.layout.children[0].children[0].children.push(node('Grid',{rows:1,columns:1})),
 'unknown cue reference':d=>d.pattern.children[0].props.Cue='missing',
 'unknown pattern reference':d=>d.method.children[0].props.Pattern='missing',
 'inactive access':d=>d.method.children[0].props.Active=false,
 'duplicate method key':d=>d.method.children.push(structuredClone(d.method.children[0])),
 'missing cue key':d=>delete d.cues.children[0].props.Key,
 'no cues':d=>d.cues.children=[],
 'no patterns':d=>d.pattern.children=[],
 'no speech':d=>d.layout.children[0].children.shift(),
 'missing control action':d=>d.actions.children=d.actions.children.filter(n=>n.props.origin!=='clear'),
 'unrecognized action origin':d=>d.actions.children[0].props.origin='missing',
 'shadowing wildcard':d=>d.actions.children[0].props.origin='*',
 'bad expression call':d=>d.actions.children[0].children[1].props.newValue="load_design('https://example.invalid')",
 'unquoted expression literal':d=>d.actions.children[0].children[1].props.newValue='home',
 'prototype property expression':d=>d.actions.children[0].children[1].props.newValue="add_word['constructor']('x')",
 'missing speech update':d=>{for(const n of walk(d.actions))if(n.className==='ActionUpdate'&&n.props.stateName==='$Speak')n.props.stateName='$Wrong'},
 'unknown content grid':d=>d.content[0].grid='missing',
 'unavailable media':d=>d.content[0].symbol='https://example.invalid/picture.png',
 'zero size grid':d=>d.layout.children[0].children[2].props.columns=0,
 'bad filter field':d=>d.layout.children[0].children[2].children[0].props.field='#missing',
 'out of range cue opacity':d=>d.cues.children[0].props.Opacity=3,
 'invalid content label':d=>delete d.content[0].label,
 'unsafe content key':d=>Object.defineProperty(d.content[0],'__proto__',{value:'x',enumerable:true}),
};
for(const [label,mutate]of Object.entries(mutations))test(`reject ${label}`,()=>{
 const d=starterDesign();mutate(d);assert.ok(inspect(d).errors.length,JSON.stringify(d));
});
test('dwell references must resolve locally',()=>{
 const d=starterDesign('dwell');walk(d.method).find(n=>n.className==='ResponderStartTimer').props.TimerName='missing';assert.match(inspect(d).errors.join('\n'),/timer/);
});
test('timer interval cannot be zero',()=>{
 const d=starterDesign('dwell');walk(d.method).find(n=>n.className==='Timer').props.Interval=0;assert.match(inspect(d).errors.join('\n'),/interval/);
});
test('key handlers must specify keys',()=>{
 const d=starterDesign('two-switch');d.method.children[0].children[0].children.shift();assert.match(inspect(d).errors.join('\n'),/explicit key/);
});
test('validation does not mutate a valid design',()=>{const d=starterDesign();const before=JSON.stringify(d);inspect(d);assert.equal(JSON.stringify(d),before)});
test('known uploaded media is allowed',()=>{const d=starterDesign();d.content[0].symbol='hello.png';assert.deepEqual(validateDesign(d,catalog,{mediaNames:['hello.png']}).errors,[])});
