import {test,expect} from "@playwright/test";
import {writeFileSync} from "node:fs";
test.beforeAll(async({browser})=>{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8080/OS-DPI-1/tests/authoring.html');
  await page.waitForFunction(()=>!!window.fixture);
  writeFileSync(new URL('../../tests/native-catalog.json',import.meta.url),JSON.stringify(await page.evaluate(()=>fixture.nativeCatalog())));
  writeFileSync(new URL('../../tests/native-empty.json',import.meta.url),JSON.stringify(await page.evaluate(()=>fixture.emptyNative())));
  await page.close();
});

const toolReply=(name,args,id="call")=>({choices:[{finish_reason:"tool_calls",message:{role:"assistant",content:null,tool_calls:[{id,type:"function",function:{name,arguments:JSON.stringify(args)}}]}}],usage:{total_tokens:600}});
async function setup(page,replies=[['recipe',{name:'keyboard',backspace:true}],['finish',{title:'Typing board',summary:'Created a native keyboard.'}]]) {
  const errors=[],requests=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  await page.route('https://api.groq.com/**',async route=>{
    requests.push(route.request().postDataJSON());
    const answer=replies.shift();
    if(!answer){await route.fulfill({status:500,json:{error:{message:'Unexpected extra request'}}});return;}
    if(typeof answer==='function'){await answer(route,requests);return;}
    await route.fulfill({json:toolReply(answer[0],answer[1],`call${requests.length}`),headers:{'x-ratelimit-remaining-tokens':'99999'}});
  });
  await page.goto('/OS-DPI-1/tests/authoring.html');
  await page.waitForFunction(()=>!!window.fixture);
  return {errors,requests};
}
async function generate(page,text='Create a QWERTY keyboard with a display, Speak, Clear, Space and Backspace.') {
  await page.getByTestId('author-request').fill(text);
  await page.getByTestId('author-run').click();
  await page.waitForFunction(()=>!fixture.panel.busy);
  const error=await page.getByTestId('author-error').count() ? await page.getByTestId('author-error').textContent() : null;
  if(error)throw new Error(error);
}
async function buttons(page) {await page.evaluate(()=>fixture.Globals.state.update({editing:false}));await expect(page.locator('#UI button').first()).toBeVisible();}

test('keyboard request uses real local tools, not whole-file JSON',async({page})=>{
  const {errors,requests}=await setup(page);
  const original=await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()));
  await generate(page);
  expect(requests).toHaveLength(2);
  expect(requests[0].model).toBe('openai/gpt-oss-120b');
  expect(requests[0].tools.map(t=>t.function.name)).toContain('inspect');
  expect(requests[0].response_format).toBeUndefined();
  expect(requests[1].messages.some(m=>m.role==='tool')).toBe(true);
  expect(await page.evaluate(()=>fixture.getAIModel('groq'))).toBe('openai/gpt-oss-120b');
  const stored=await page.evaluate(async()=>{
    const database=await fixture.db.dbPromise;
    const records=await database.getAllFromIndex('store5','by-name','original');
    return fixture.fingerprint(Object.fromEntries(records.map(r=>[r.type,r.data])));
  });
  expect(stored).toBe(original);
  expect(await page.evaluate(()=>fixture.Globals.data.contentRows.length)).toBe(26);
  expect(errors).toEqual([]);
});

test('native pointer keyboard types hello world, speaks once, backspaces and clears',async({page})=>{
  const {errors}=await setup(page);await generate(page);await buttons(page);
  for(const c of 'hello')await page.locator('#UI').getByRole('button',{name:c,exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'Space',exact:true}).click();
  for(const c of 'world')await page.locator('#UI').getByRole('button',{name:c,exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Display'))).toBe('hello world');
  await page.locator('#UI').getByRole('button',{name:'Speak',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.spoken || [])).toEqual(['hello world']);
  await page.locator('#UI').getByRole('button',{name:'Backspace',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Display'))).toBe('hello worl');
  await page.locator('#UI').getByRole('button',{name:'Clear',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'Clear',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'Speak',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Display'))).toBe('');
  expect(await page.evaluate(()=>window.spoken)).toEqual(['hello world']);
  expect(errors).toEqual([]);
});

test('arbitrary native score activity works without a keyboard or grid template',async({page})=>{
  const edits=[{op:'insert',parent:'page',nodes:[
    {className:'Display',ref:'score',props:{stateName:'$Score'}},
    {className:'Button',ref:'right',props:{name:'right',label:'Correct'}},
    {className:'Button',ref:'reset',props:{name:'reset',label:'Reset score'}},
  ]},{op:'bind',target:'init',rules:[{updates:{$Score:'0'}}]},
  {op:'bind',target:'right',rules:[{updates:{$Score:'increment(1)'}}]},
  {op:'bind',target:'reset',rules:[{updates:{$Score:'0'}}]}];
  const {errors}=await setup(page,[['edit',{operations:edits}],['check',{tests:[{steps:[{target:'right'},{target:'right'}],expect:{$Score:2}}]}],['finish',{title:'Score activity',summary:'Buttons update the score.'}]]);
  await generate(page,'Make a score display with Correct and Reset buttons. No speech.');await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'Correct',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'Correct',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Score'))).toBe(2);
  await page.locator('#UI').getByRole('button',{name:'Reset score',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Score'))).toBe(0);
  expect(await page.evaluate(()=>fixture.walk(fixture.captureNative().layout).some(n=>n.className==='Speech'))).toBe(false);
  expect(errors).toEqual([]);
});

test('all native schema classes, selection and stable references are exposed',async({page})=>{
  const {errors}=await setup(page,[]);
  const result=await page.evaluate(()=>{
    const s=fixture.documentSession(fixture.emptyNative());
    s.edit([{op:'insert',parent:'page',node:{className:'Stack',ref:'group'}},{op:'insert',parent:'page',node:{className:'Button',ref:'choice',props:{label:'Pick'}}}]);
    s.edit([{op:'move',target:'choice',parent:'group'},{op:'update',target:'choice',props:{label:'Still selected'}}]);
    return {classes:Object.keys(s.catalog),label:s.find('group').children[0].props.label,errors:s.check().errors};
  });
  expect(result.classes).toEqual(expect.arrayContaining(['SocketHandler','ResponderEmit','VSD','ModalDialog','CueCss','Timer']));
  expect(result.label).toBe('Still selected');expect(result.errors).toEqual([]);expect(errors).toEqual([]);
});

test('invalid edit is corrected internally without manual repair',async({page})=>{
  const {errors,requests}=await setup(page,[['edit',{operations:[{op:'update',target:'page',props:{invented:1}}]}],['recipe',{name:'keyboard'}],['finish',{summary:'Keyboard completed.'}]]);
  await generate(page);
  expect(requests).toHaveLength(3);
  expect(requests[1].messages.some(m=>m.role==='tool'&&m.content.includes('Unknown Page property'))).toBe(true);
  expect(await page.evaluate(()=>fixture.Globals.layout.children[0].invented)).toBeUndefined();
  expect(await page.evaluate(()=>fixture.Globals.data.contentRows.length)).toBe(26);expect(errors).toEqual([]);
});

test('manual changes during generation are never overwritten',async({page})=>{
  let release;const wait=new Promise(r=>release=r);
  await setup(page,[async route=>{await wait;await route.fulfill({json:toolReply('recipe',{name:'keyboard'})});},['finish',{summary:'Keyboard.'}]]);
  await page.getByTestId('author-request').fill('Make a keyboard');await page.getByTestId('author-run').click();
  await page.waitForTimeout(100);
  await page.evaluate(()=>fixture.Globals.layout.uiScale.set(2.3));release();
  await page.waitForFunction(()=>!fixture.panel.busy);
  await expect(page.getByTestId('author-error')).toContainText('manual changes');
  expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');
  expect(await page.evaluate(()=>fixture.Globals.layout.uiScale.value)).toBe(2.3);
});

test('cancellation preserves the source and creates no partial board',async({page})=>{
  await setup(page,[async route=>{await new Promise(r=>setTimeout(r,1200));await route.fulfill({json:toolReply('finish',{summary:'No change'})}).catch(()=>{});}]);
  await page.getByTestId('author-request').fill('Make a board');await page.getByTestId('author-run').click();
  await page.getByTestId('author-cancel').click();await page.waitForFunction(()=>!fixture.panel.busy);
  expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');
  expect(await page.evaluate(()=>fixture.Globals.data.contentRows.length)).toBe(0);
});

test('whole AI transactions undo and redo through the normal editor',async({page})=>{
  const {errors}=await setup(page);await generate(page);
  await page.getByTestId('author-undo').click();await page.waitForFunction(()=>!fixture.panel.busy);
  expect(await page.evaluate(()=>fixture.Globals.data.contentRows.length)).toBe(0);
  await page.getByTestId('author-redo').click();await page.waitForFunction(()=>!fixture.panel.busy);
  expect(await page.evaluate(()=>fixture.Globals.data.contentRows.length)).toBe(26);expect(errors).toEqual([]);
});

test('undo refuses to erase subsequent manual changes',async({page})=>{
  await setup(page);await generate(page);
  await page.evaluate(()=>fixture.Globals.layout.uiScale.set(2.2));
  await page.getByTestId('author-undo').click();
  await expect(page.getByTestId('author-error')).toContainText('newer manual changes');
  expect(await page.evaluate(()=>fixture.Globals.layout.uiScale.value)).toBe(2.2);
});

test('native archive export/reopen preserves behavior, optional sections and bytes',async({page})=>{
  const {errors}=await setup(page);await generate(page);
  const result=await page.evaluate(async()=>{
    const f=fixture;
    await f.db.addMedia(new Blob([new Uint8Array([1,2,3,4])]),'assets/spare.bin');
    await f.db.addMedia(new Blob(['{"untouched": true}'],{type:'application/json'}),'extra.json');
    await f.db.write('notes',[{text:'Retained note'}]);
    const blob=await f.db.convertDesignToBlob(),archive=await f.unPackDesign(blob);
    const fresh=new f.DB();await fresh.readDesignFromBlob(blob,'Reopened.osdpi');
    const database=await f.db.dbPromise;
    return {rows:archive.content.length,notes:archive.notes,assets:await Promise.all(archive.media.map(async m=>[m.name,Array.from(new Uint8Array(await m.content.arrayBuffer()))])),
      reopened:(await database.get('store5',[fresh.designName,'content'])).data.length,
      source: f.db.designName};
  });
  expect(result.rows).toBe(26);expect(result.reopened).toBe(26);expect(result.notes).toEqual([{text:'Retained note'}]);
  expect(result.assets).toEqual(expect.arrayContaining([['assets/spare.bin',[1,2,3,4]]]));
  expect(result.assets.find(x=>x[0]==='extra.json')[1]).toHaveLength(19);expect(errors).toEqual([]);
});

test('file input imports a complete native design, without overwriting its source',async({page})=>{
  const {errors}=await setup(page);await generate(page);
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await (await fixture.db.convertDesignToBlob()).arrayBuffer())));
  await page.getByTestId('author-import').setInputFiles({name:'Student.osdpi',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
  await page.waitForFunction(()=>!fixture.panel.busy);
  const names=await page.evaluate(()=>fixture.db.names());
  expect(names).toContain('original');expect(names).toContain('Student');expect(names).toContain('Typing_board');expect(errors).toEqual([]);
});

test('malformed and traversal archives leave storage untouched',async({page})=>{
  await setup(page,[]);
  const result=await page.evaluate(async()=>{
    const f=fixture,storage=new f.DB(),errors=[];
    for(const files of [{'layout.json':f.strToU8('{bad')},{'../escape':new Uint8Array([1])}]){
      try{await storage.readDesignFromBlob(new Blob([f.zipSync(files)]),'Invalid.osdpi');}catch(e){errors.push(e.message);}
    }
    return {errors,name:storage.designName,names:await f.db.names()};
  });
  expect(result.errors).toHaveLength(2);expect(result.name).toBe('');expect(result.names).toEqual(['original']);
});

test('new external service connections require consent before applying',async({page})=>{
  const {errors}=await setup(page,[['inspect',{target:'method'}],async route=>{
    const target=await page.evaluate(()=>fixture.documentSession(fixture.captureNative()).design.method.children[0]._ref);
    await route.fulfill({json:toolReply('edit',{operations:[{op:'insert',parent:target,node:{className:'SocketHandler',props:{URL:'wss://example.invalid/socket'}}}]})});
  },['finish',{summary:'Added an external input connection.'}]]);
  await generate(page,'Add this external input connection');
  await expect(page.getByText('Review before applying')).toBeVisible();
  expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');
  await page.getByRole('button',{name:'Discard',exact:true}).click();
  expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');expect(errors).toEqual([]);
});

test('Qwen selection is per-authoring-request, not the conversational model',async({page})=>{
  const {requests}=await setup(page);
  await page.getByText('Model and checks',{exact:true}).click();
  await page.getByTestId('author-model').selectOption('qwen/qwen3.8-27b');await generate(page);
  expect(requests.every(r=>r.model==='qwen/qwen3.8-27b')).toBe(true);
  expect(await page.evaluate(()=>fixture.getAIModel('groq'))).toBe('openai/gpt-oss-120b');
});

test('generic tabs and vocabulary use the existing native navigation',async({page})=>{
  const ops=[{op:'insert',parent:'page',node:{className:'TabControl',ref:'tabs',props:{stateName:'$view'},children:[
    {className:'TabPanel',props:{name:'food',label:'Food'},children:[{className:'Button',ref:'food',props:{name:'foodword',label:'Bread'}}]},
    {className:'TabPanel',props:{name:'drinks',label:'Drinks'},children:[{className:'Button',ref:'drink',props:{name:'drinkword',label:'Water'}}]},
  ]}},{op:'insert',parent:'page',node:{className:'Display',props:{stateName:'$Display'}}},
  {op:'bind',target:'food',rules:[{updates:{$Display:'add_word(#label)'}}]},
  {op:'bind',target:'drink',rules:[{updates:{$Display:'add_word(#label)'}}]}];
  const {errors}=await setup(page,[['edit',{operations:ops}],['finish',{summary:'Two native tabs with composition.'}]]);await generate(page,'Make Food and Drinks tabs.');await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'Bread',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'Drinks',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'Water',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Display'))).toBe('Bread Water ');expect(errors).toEqual([]);
});

test('native dwell, scanning and cues remain editable, rather than replaced by templates',async({page})=>{
  const {errors}=await setup(page,[]);
  const data=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());f.keyboardRecipe(s,{});
    const methods=s.design.method.children;
    const dwell=methods.find(n=>n.props.Name==='Pointer dwell');
    s.edit([...methods.map(n=>({op:'update',target:n._ref,props:{Active:n===dwell}})),
      {op:'update',target:dwell.children.find(n=>n.className==='Timer')._ref,props:{Interval:0.1}},
      {op:'update',target:s.design.cues.children[0]._ref,props:{Color:'blue'}}]);
    f.installNative(s.snapshot());return s.check();
  });
  expect(data.errors).toEqual([]);await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'h',exact:true}).hover();
  await expect.poll(()=>page.evaluate(()=>fixture.Globals.state.get('$Display'))).toBe('h');
  expect(errors).toEqual([]);
});
