import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {keyboardDesign,applyDesignOperations,wordBoardDesign} from "../src/components/ai/design-operations.js";
import {validateDesign,walk} from "../src/components/ai/design-format.js";
const catalog=JSON.parse(readFileSync(new URL("./design-catalog.json",import.meta.url),"utf8"));

test("QWERTY keyboard is native and complete",()=>{
  const d=keyboardDesign();
  const rows=d.content;
  assert.equal(rows.length,26);
  assert.equal(rows.slice(0,10).map(x=>x.label).join(""),"QWERTYUIOP");
  assert.equal(rows.slice(10,19).map(x=>x.label).join(""),"ASDFGHJKL");
  assert.equal(rows.slice(19).map(x=>x.label).join(""),"ZXCVBNM");
  assert.equal(rows.find(x=>x.label==="Q").character,"q");
  const gridNames=walk(d.layout).filter(n=>n.className==="Grid").map(x=>x.props.name);
  assert.deepEqual(gridNames,["keyboard_0","keyboard_1","keyboard_2"]);
  assert.ok(walk(d.actions).some(n=>n.props.newValue==="add_letter(#character)"));
  assert.ok(walk(d.actions).some(n=>n.props.newValue==="add_letter(' ')"));
  assert.deepEqual(validateDesign(d,catalog).errors,[]);
});
for(const access of ["pointer","dwell","two-switch"])test(`native keyboard ${access}`,()=>{
  const d=keyboardDesign({access,backspace:true});
  assert.ok(walk(d.layout).some(n=>n.className==="Button"&&n.props.name==="backspace"));
  assert.deepEqual(validateDesign(d,catalog).errors,[]);
});
test("new board builds with existing speech and method rules",()=>{
  const d=wordBoardDesign(["I need","water","please"],"pointer",3);
  assert.equal(d.content.length,3);
  assert.deepEqual(validateDesign(d,catalog).errors,[]);
});
test("targeted grid edit does not modify methods, cues or actions",()=>{
  const d=keyboardDesign("pointer");
  const before=JSON.stringify({method:d.method,cues:d.cues,pattern:d.pattern,actions:d.actions});
  const after=applyDesignOperations(d,[{op:"set_button_color",target:"keyboard_0",value:"#aaccee"}]);
  assert.equal(after.layout.children[0].children[2].children[0].props.buttonColor,"#aaccee");
  assert.equal(JSON.stringify({method:after.method,cues:after.cues,pattern:after.pattern,actions:after.actions}),before);
  assert.deepEqual(validateDesign(after,catalog).errors,[]);
});
test("rename and remove are targeted",()=>{
  const d=keyboardDesign();
  const after=applyDesignOperations(d,[{op:"rename_word",target:"index:0",text:"Letter Q"},{op:"remove_word",target:"X"}]);
  assert.equal(d.content[0].label,"Q");
  assert.equal(after.content[0].label,"Letter Q");
  assert.equal(after.content.length,25);
});
test("invalid batch never modifies source",()=>{
  const d=keyboardDesign(),before=JSON.stringify(d);
  assert.throws(()=>applyDesignOperations(d,[
    {op:"set_button_color",target:"keyboard_0",value:"#ff0000"},
    {op:"delete_everything"},
  ]),/Unsupported edit/);
  assert.equal(JSON.stringify(d),before);
});
test("simple board gains a native second tab",()=>{
  const d=wordBoardDesign(["Hello","Goodbye"],"pointer",2);
  const out=applyDesignOperations(d,[{op:"add_tab",text:"Food",items:["Water","Tea"]}]);
  assert.equal(walk(out.layout).filter(n=>n.className==="TabPanel").length,2);
  assert.equal(out.content.length,4);
  assert.deepEqual(validateDesign(out,catalog).errors,[]);
});
test("access changes use a registered native method and cues",()=>{
  const d=keyboardDesign();
  const out=applyDesignOperations(d,[{op:"set_access",value:"two-switch"}]);
  assert.equal(out.method.children[0].props.Pattern,"scan");
  assert.deepEqual(validateDesign(out,catalog).errors,[]);
});
