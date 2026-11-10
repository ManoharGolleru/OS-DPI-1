import {test,expect} from "@playwright/test";
import {commandReply as toolReply,feedbackMessages} from "./structured-reply.js";
import {writeFileSync} from "node:fs";
test.beforeAll(async({browser})=>{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8080/OS-DPI-1/tests/authoring.html');
  await page.waitForFunction(()=>!!window.fixture);
  writeFileSync(new URL('../../tests/native-catalog.json',import.meta.url),JSON.stringify(await page.evaluate(()=>fixture.nativeCatalog())));
  writeFileSync(new URL('../../tests/native-empty.json',import.meta.url),JSON.stringify(await page.evaluate(()=>fixture.emptyNative())));
  await page.close();
});


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

test('keyboard commands use strict structured output and native editing',async({page})=>{
  const {errors,requests}=await setup(page);
  const original=await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()));
  await generate(page);
  expect(requests).toHaveLength(2);
  expect(requests[0].model).toBe('openai/gpt-oss-120b');
  expect(requests[0].tools).toBeUndefined();
  expect(requests[0].response_format).toMatchObject({type:'json_schema',json_schema:{strict:true}});
  const task=JSON.parse(requests[1].messages.find(m=>m.role==='user').content);
  expect(feedbackMessages(requests[1]).length>0 || task.lastResults.some(r=>r.tool==='recipe'&&r.ok&&r.instruction.includes('finish'))).toBe(true);
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

test('completed edits submit in one request and run native keyboard behavior checks',async({page})=>{
  const {requests}=await setup(page,[['recipe',{name:'keyboard',backspace:true,title:'Keyboard',summary:'Made the keyboard.'}]]);
  await generate(page);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(()=>fixture.Globals.data.contentRows.length)).toBe(26);
  await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'h',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Display'))).toBe('h');
});

test('real Qwen omission of the Backspace flag is resolved from the requested native keyboard behavior',async({page})=>{
  const {requests}=await setup(page,[['recipe',{name:'keyboard',displayPosition:'top',summary:'Created keyboard.'}]]);
  await generate(page);
  expect(requests).toHaveLength(1);
  await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'h',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'i',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'Backspace',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Display'))).toBe('h');
});

test('recorded Qwen individual-letter recipe error gives row-string guidance and can repair without partial installation',async({page})=>{
  const {requests}=await setup(page,[['recipe',{name:'keyboard',keyRows:[...'QWERTYUIOPASDFGHJKLZXCVBNM'],backspace:true,summary:'Created keyboard.'}],
    ['recipe',{name:'keyboard',backspace:true,summary:'Created keyboard with standard rows.'}]]);
  await generate(page);
  expect(requests).toHaveLength(2);
  expect(JSON.stringify(requests[1].messages)).toContain('Omit keyRows for standard QWERTY');
  await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'h',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Display'))).toBe('h');
});

test('generic native activity can submit its action tests in one request',async({page})=>{
  const {requests}=await setup(page,[['edit',{operations:[
    {op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Score'}},{className:'Button',ref:'add',props:{label:'Add one'}}]},
    {op:'bind',target:'init',rules:[{updates:{$Score:'0'}}]},
    {op:'bind',target:'add',rules:[{updates:{$Score:'increment(1)'}}]},
  ],summary:'Created a score activity.',tests:[{steps:[],expect:{$Score:0}},{steps:[{target:'add'},{target:'add'}],expect:{$Score:2}}]}]]);
  await generate(page,'Create a score activity with an Add one button and a score display.');
  expect(requests).toHaveLength(1);
  await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'Add one',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Score'))).toBe(1);
});

test('inspection combines selectors and retains schema knowledge across later turns',async({page})=>{
  const {requests}=await setup(page,[['inspect',{target:'page',classes:['TabControl'],example:'navigation'}],
    ['inspect',{target:'functions'}],['inspect',{target:'content'}],
    ['recipe',{name:'keyboard',backspace:true,summary:'Created keyboard.'}]]);
  await generate(page);
  const first=JSON.parse(feedbackMessages(requests[1])[0].content);
  expect(first.object.className).toBe('Page');
  expect(first.schemas.TabControl.children).toContain('TabPanel');
  expect(first.example).toContain('TabControl');
  expect(requests[3].messages[0].content).toContain('"TabControl":{');
  expect(feedbackMessages(requests[2]).some(m=>m.content.includes('replace_last_letter'))).toBe(true);
});

test('real activity omission of native init cannot pass the requested opening-state checks',async({page})=>{
  const {requests}=await setup(page,[['edit',{operations:[
    {op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Score'}},{className:'Display',props:{stateName:'$Status'}},{className:'Button',ref:'add',props:{label:'Add point'}}]},
    {op:'bind',target:'add',rules:[{updates:{$Score:'increment(1)',$Status:"'Keep going'"}}]},
  ],summary:'Created counting activity.',tests:[{steps:[],expect:{$Score:0,$Status:'Ready'}},{steps:[{target:'add'}],expect:{$Score:1,$Status:'Keep going'}}]}],
  async(route,requests)=>{
    const feedback=feedbackMessages(requests.at(-1)).map(m=>JSON.parse(m.content));
    expect(feedback.at(-1)).toMatchObject({ok:false,staged:true});
    expect(feedback.at(-1).created.some(n=>n.ref==='add')).toBe(true);
    expect(feedback.at(-1).instruction).toContain('do not repeat');
    expect(JSON.stringify(feedback)).toContain('expected 0');
    expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');
    await route.fulfill({json:toolReply('edit',{operations:[{op:'bind',target:'init',rules:[{updates:{$Score:'0',$Status:"'Ready'"}}]}],summary:'Initialized score and status.'},'fixed-init'),headers:{'x-ratelimit-remaining-tokens':'99999'}});
  }]);
  await generate(page,'Create a counting activity starting with score 0 and status Ready.');
  expect(requests).toHaveLength(2);
  expect(await page.evaluate(()=>[fixture.Globals.state.get('$Score'),fixture.Globals.state.get('$Status')])).toEqual([0,'Ready']);
});

test('quota countdown remains cancellable without changing the current board',async({page})=>{
  const {requests}=await setup(page,[async route=>route.fulfill({status:429,headers:{'retry-after':'2'},json:{error:{message:'Tokens per minute quota. Try again in 2s.'}}})]);
  const before=await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()));
  await page.getByTestId('author-request').fill('Create an activity.');
  await page.getByTestId('author-run').click();
  await expect(page.getByTestId('author-status')).toContainText('Pacing requests');
  await page.getByTestId('author-cancel').click();
  await page.waitForFunction(()=>!fixture.panel.busy);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()))).toBe(before);
  expect(await page.evaluate(()=>fixture.db.names())).toEqual(['original']);
});

test('daily quota exhaustion stops rather than entering a refill loop',async({page})=>{
  const {requests}=await setup(page,[async route=>route.fulfill({status:429,headers:{'retry-after':'3600'},json:{error:{message:'Rate limit reached on tokens per day (TPD).'}}})]);
  await page.getByTestId('author-request').fill('Create an activity.');
  await page.getByTestId('author-run').click();
  await page.waitForFunction(()=>!fixture.panel.busy);
  await expect(page.getByTestId('author-error')).toContainText('daily quota is exhausted');
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(()=>fixture.db.names())).toEqual(['original']);
});

test('local expression tests do not inherit live messages and honor native non-grid filters',async({page})=>{
  await setup(page,[]);
  const checks=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    f.Globals.state.update({$Display:'Private live message'});
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Grid', ref: 'words', props: { name: 'words' }, children: [{ className: 'GridFilter', props: { field: '#category', operator: 'equals', value: "'food'" } }] }] },
      { op: "rows", rows: [{ label: 'Bread', category: 'food' }, { label: 'Water', category: 'drink' }] },
      {op:'bind',target:'words',rules:[{updates:{$Display:'add_word(#label)'}}]}]);
    return f.exercise(s,[{steps:[{target:'words',label:'Bread'}],expect:{$Display:'Bread '}}]);
  });
  expect(checks[0].ok).toBe(true);
});

test('qualified native functions are discoverable and local checks cannot mutate notes or queued actions',async({page})=>{
  await setup(page,[]);
  const result=await page.evaluate(async()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    f.Globals.data.setNoteRows([{label:'Keep my note'}]);
    const native=await import('/OS-DPI-1/components/ai/authoring-native.js');
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', ref: 'test', props: { label: 'Test' } }] },
      {op:'bind',target:'test',rules:[{updates:{$Display:"slots.toString(slots.init('I want bread'))"}}]}]);
    const pure=native.exercise(s,[{steps:[{target:'test'}],expect:{$Display:'I want bread'}}]);
    const queuedBefore=f.Globals.actions.eventQueue.length;
    s.edit([{op:'bind',target:'test',rules:[{updates:{$Display:"Notes('#label', 'Do not write')"}}]}]);
    const notes=native.exercise(s,[{steps:[{target:'test'}],expect:{$Display:'anything'}}]);
    s.edit([{op:'bind',target:'test',rules:[{updates:{$Display:"slots['update']('Do not queue')"}}]}]);
    const slots=native.exercise(s,[{steps:[{target:'test'}],expect:{$Display:'anything'}}]);
    return {names:native.nativeExpressionReference().available,pure,notes,slots,noteRows:f.Globals.data.noteRows,queuedBefore,queuedAfter:f.Globals.actions.eventQueue.length};
  });
  expect(result.names).toContain('slots.init');
  expect(result.pure[0].ok,JSON.stringify(result.pure)).toBe(true);
  expect(result.notes[0].ok).toBe(false);
  expect(result.slots[0].ok).toBe(false);
  expect(result.noteRows).toEqual([{label:'Keep my note'}]);
  expect(result.queuedAfter).toBe(result.queuedBefore);
});

test('action checks use the same string dataset values as rendered native buttons',async({page})=>{
  await setup(page,[]);
  const result=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Grid', ref: 'numbers', props: { rows: 1, columns: 1 } }] },
      { op: "rows", rows: [{ label: 'Two', amount: 2 }] },
      {op:'bind',target:'numbers',rules:[{updates:{$Result:'#amount + 1'}}]}]);
    const checks=f.exercise(s,[{steps:[{target:'numbers',label:'Two'}],expect:{$Result:'21'}}]);
    f.installNative(s.snapshot());return checks;
  });
  expect(result[0].ok).toBe(true);
  await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'Two',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Result'))).toBe('21');
});

test('keyboard recipe preserves an imported speech state and current notes',async({page})=>{
  await setup(page,[]);
  const result=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Speech', props: { stateName: '$ImportedSpeak', voiceURI: 'test-voice' } }] }]);
    f.Globals.data.setNoteRows([{label:'A saved note'}]);
    f.keyboardRecipe(s,{backspace:true});
    const checks=f.exercise(s,s.nativeTests);
    f.installNative(s.snapshot());
    return {checks,notes:f.Globals.data.noteRows,voices:f.walk(s.design.layout).filter(n=>n.className==='Speech').map(n=>n.props)};
  });
  expect(result.checks.every(t=>t.ok)).toBe(true);
  expect(result.notes).toEqual([{label:'A saved note'}]);
  expect(result.voices).toEqual([{stateName:'$ImportedSpeak',voiceURI:'test-voice'}]);
});

test('deleting the selected piece can finish without losing its selection reference',async({page})=>{
  await setup(page,[]);
  const result=await page.evaluate(async()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{op:'insert',parent:'page',nodes:[{className:'Button',ref:'removeMe',props:{label:'Remove'}},{className:'Button',ref:'keepMe',props:{label:'Keep'}}]}]);
    s.changes=[];
    let round=0;
    return f.authorInterface({session:s,request:'Delete this selected button.',selected:'removeMe',turn:async()=>({message:f.decodeAuthoringResponse(f.commandReply(++round===1?'edit':'finish',round===1?{operations:[{op:'remove',target:'removeMe'}]}:{summary:'Deleted the selected button.'}).choices[0].message.content)})});
  });
  expect(result.design.layout.children[0].children.map(n=>n.props.label)).toEqual(['Keep']);
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
  const {errors}=await setup(page,[['edit',{operations:edits}],['check',{tests:[{steps:[],expect:{$Score:0}},{steps:[{target:'right'},{target:'right'}],expect:{$Score:2}}]}],['finish',{title:'Score activity',summary:'Buttons update the score.'}]]);
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
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Stack', ref: 'group' }] },{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', ref: 'choice', props: { label: 'Pick' } }] }]);
    s.edit([{op:'move',target:'choice',parent:'group'},{op:'update',target:'choice',props:{label:'Still selected'}}]);
    return {classes:Object.keys(s.catalog),label:s.find('group').children[0].props.label,errors:s.check().errors};
  });
  expect(result.classes).toEqual(expect.arrayContaining(['SocketHandler','ResponderEmit','VSD','ModalDialog','CueCss','Timer']));
  expect(result.label).toBe('Still selected');expect(result.errors).toEqual([]);expect(errors).toEqual([]);
});

test('invalid edit is corrected internally without manual repair',async({page})=>{
  const {errors,requests}=await setup(page,[['edit',{operations:[{op:'update',target:'page',props:{invented:1}}]}],['recipe',{name:'keyboard',backspace:true}],['finish',{summary:'Keyboard completed.'}]]);
  await generate(page);
  expect(requests).toHaveLength(3);
  expect(feedbackMessages(requests[1]).some(m=>m.content.includes('Unknown Page property'))).toBe(true);
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
    await route.fulfill({json:toolReply('edit',{operations:[{ op: 'insert', parent: target, nodes: [{ className: 'SocketHandler', props: { URL: 'wss://example.invalid/socket' } }] },{ op: 'insert', parent: 'page', nodes: [{ className: 'Display', props: { stateName: '$Listen' } }] }]})});
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
  const ops=[{ op: 'insert', parent: 'page', nodes: [{ className: 'TabControl', ref: 'tabs', props: { stateName: '$view' }, children: [
                { className: 'TabPanel', props: { name: 'food', label: 'Food' }, children: [{ className: 'Button', ref: 'food', props: { name: 'foodword', label: 'Bread' } }] },
                { className: 'TabPanel', props: { name: 'drinks', label: 'Drinks' }, children: [{ className: 'Button', ref: 'drink', props: { name: 'drinkword', label: 'Water' } }] },
            ] }] },{ op: 'insert', parent: 'page', nodes: [{ className: 'Display', props: { stateName: '$Display' } }] },
  {op:'bind',target:'init',rules:[{updates:{$Display:"''"}}]},
  {op:'bind',target:'food',rules:[{updates:{$Display:'add_word(#label)'}}]},
  {op:'bind',target:'drink',rules:[{updates:{$Display:'add_word(#label)'}}]}];
  const {errors}=await setup(page,[['edit',{operations:ops,tests:[{steps:[],expect:{$Display:''}},{steps:[{target:'food'},{target:'drink'}],expect:{$Display:'Bread Water '}}]}],['finish',{summary:'Two native tabs with composition.'}]]);await generate(page,'Make Food and Drinks tabs.');await buttons(page);
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

test('plain model prose cannot claim a finished board without tool calls',async({page})=>{
  const plain=async(route)=>route.fulfill({json:{choices:[{finish_reason:'stop',message:{role:'assistant',content:'I created the keyboard and wired all its buttons.'}}],usage:{total_tokens:40}}});
  const {errors,requests}=await setup(page,[plain,plain,plain]);
  await page.getByTestId('author-request').fill('Make a typing board.');
  await page.getByTestId('author-run').click();
  await page.waitForFunction(()=>!fixture.panel.busy);
  await expect(page.getByTestId('author-error')).toContainText('Invalid structured authoring command');
  expect(requests.length).toBe(3);
  expect(requests.every(r=>r.tools===undefined&&r.tool_choice===undefined&&r.response_format.json_schema.strict)).toBe(true);
  expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');
  expect(await page.evaluate(()=>fixture.Globals.layout.children[0].children.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('observed Groq required-tool failure is classified and repaired internally',async({page})=>{
  const {requests}=await setup(page,[
    async route=>route.fulfill({status:400,json:{error:{code:'tool_use_required',message:'Tool choice is required, but model did not call a tool'}}}),
    ['recipe',{name:'keyboard',backspace:true}],['finish',{summary:'Created keyboard.'}],
  ]);
  await page.getByText('Model and checks',{exact:true}).click();
  await page.getByTestId('author-diagnostics').check();
  await generate(page,'Create a QWERTY keyboard with display, Speak, Clear, Backspace. Private test phrase.');
  expect(requests).toHaveLength(3);
  const report=await page.evaluate(()=>fixture.panel.diagnostics.report);
  expect(report.outcome).toBe('applied');
  expect(report.events).toEqual(expect.arrayContaining([
    expect.objectContaining({stage:'provider',status:400,code:'tool-call'}),
    expect.objectContaining({stage:'transaction',persisted:true,rendered:true,copied:true}),
  ]));
  expect(JSON.stringify(report)).not.toMatch(/Private test phrase|gsk_|Authorization|Created keyboard/);
  expect(await page.evaluate(()=>fixture.panel.usage.calls)).toBe(3);
});

test('opted-in provider failure details preserve malformed endings and scrub credentials',async({page})=>{
  const failed='{"operations":['+' '.repeat(3100)+'BROKEN_END gsk_synthetic_secret_123456789012345';
  await setup(page,[async route=>route.fulfill({status:400,headers:{'x-ratelimit-remaining-tokens':'99999','access-control-expose-headers':'x-ratelimit-remaining-tokens'},json:{error:{type:'invalid_request_error',code:'tool_use_failed',param:'tools',message:'Generated call did not match schema',failed_generation:failed}}}),
    ['recipe',{name:'keyboard',backspace:true,summary:'Created keyboard.'}],
  ]);
  await page.getByText('Model and checks',{exact:true}).click();
  await page.getByTestId('author-diagnostics').check();await page.getByTestId('author-diagnostics-text').check();
  await generate(page,'Create a QWERTY keyboard with Speak, Clear, Space and Backspace.');
  const event=await page.evaluate(()=>fixture.panel.diagnostics.report.events.find(e=>e.stage==='provider'&&e.status===400));
  expect(event.providerCode).toBe('tool_use_failed');
  expect(event.details).toMatchObject({protocol:'strict-json',providerError:{type:'invalid_request_error',code:'tool_use_failed',param:'tools',failedGeneration:{originalLength:failed.length,truncated:true}}});
  expect(event.details.responseSchemaFingerprint).toMatch(/^[a-f0-9]{8}$/);
  expect(event.details.providerError.failedGeneration.tail).toContain('BROKEN_END');
  expect(JSON.stringify(event)).not.toContain('gsk_');
});

test('prose after staged edits asks for finish instead of accepting a claim',async({page})=>{
  const {requests}=await setup(page,[['recipe',{name:'keyboard',backspace:true}],
    async route=>route.fulfill({json:{choices:[{finish_reason:'stop',message:{role:'assistant',content:'Finished your keyboard.'}}]}}),
    ['finish',{summary:'Created keyboard.'}],
  ]);
  await generate(page);
  expect(requests).toHaveLength(3);
  expect(requests[2].messages.some(m=>m.role==='user'&&m.content.includes('Return one JSON command matching the response schema'))).toBe(true);
});

test('failed interaction checks prevent finish until the actual actions are corrected',async({page})=>{
  const {requests}=await setup(page,[['edit',{operations:[
    { op: 'insert', parent: 'page', nodes: [{ className: 'Button', ref: 'scorebutton', props: { label: 'Add', name: 'score' } }] },
    {op:'bind',target:'init',rules:[{updates:{$Score:'0'}}]},
    {op:'bind',target:'scorebutton',rules:[{updates:{$Score:'increment(2)'}}]},
  ]}],['check',{tests:[{steps:[],expect:{$Score:0}},{steps:[{target:'scorebutton'}],expect:{$Score:1}}]}],
  ['finish',{summary:'Score works.'}],
  ['edit',{operations:[{op:'bind',target:'scorebutton',rules:[{updates:{$Score:'increment(1)'}}]}]}],
  ['finish',{summary:'Corrected the score.'}]]);
  await generate(page,'Make a button that adds one to score.');
  expect(requests).toHaveLength(5);
  expect(feedbackMessages(requests[3]).some(m=>m.content.includes('native interaction checks still fail'))).toBe(true);
  await buttons(page);
  await page.locator('#UI').getByRole('button',{name:'Add',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Score'))).toBe(1);
});

test('failed requests retain opt-in diagnostics and leave the original untouched',async({page})=>{
  await setup(page,[async route=>route.fulfill({status:401,json:{error:{message:'Unauthorized'}}})]);
  const before=await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()));
  await page.getByText('Model and checks',{exact:true}).click();
  await page.getByTestId('author-diagnostics').check();
  await page.getByTestId('author-request').fill('Private student vocabulary');
  await page.getByTestId('author-run').click();
  await page.waitForFunction(()=>!fixture.panel.busy);
  const report=await page.evaluate(()=>fixture.panel.diagnostics.report);
  expect(report.outcome).toBe('failed');
  expect(report.events).toContainEqual(expect.objectContaining({stage:'provider',status:401,code:'auth'}));
  expect(JSON.stringify(report)).not.toMatch(/Private student|gsk_|Authorization/);
  expect(await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()))).toBe(before);
  expect(await page.evaluate(()=>fixture.db.names())).toEqual(['original']);
  await page.getByTestId('author-diagnostics').uncheck();
  expect(await page.evaluate(()=>fixture.panel.diagnostics)).toBeNull();
});

test('content-only generation does not report success with empty Preview',async({page})=>{
  const {errors,requests}=await setup(page,[
    ['edit',{operations:[{ op: "rows", rows: Array.from(['Water', 'Help'], label => ({ label })) }]}],
    ['finish',{title:'Finished board',summary:'Created a communication board.'}],
    ['recipe',{name:'keyboard',backspace:true}],
    ['finish',{title:'Typing board',summary:'Built a native QWERTY keyboard with controls.'}],
  ]);
  await generate(page,'Make a communication board with some buttons.');
  expect(requests.length).toBe(4);
  const feedback=feedbackMessages(requests[2]).map(m=>m.content).join(' ');
  expect(feedback).toContain('no visible native output or controls');
  expect(await page.evaluate(()=>fixture.Globals.data.contentRows.length)).toBe(28);
  expect(await page.locator('#UI button').count()).toBeGreaterThan(26);
  expect(errors).toEqual([]);
});

test('incomplete QWERTY output requires repair before finish is accepted',async({page})=>{
  const {errors,requests}=await setup(page,[
    ['edit',{operations:[{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'A', name: 'a' } }] }]}],
    ['finish',{title:'Keyboard',summary:'Finished full keyboard.'}],
    ['recipe',{name:'keyboard',backspace:true}],
    ['finish',{title:'Keyboard',summary:'Finished full keyboard.'}],
  ]);
  await generate(page);
  const feedback=feedbackMessages(requests[2]).map(m=>m.content).join(' ');
  expect(feedback).toContain('26 keys');
  expect(await page.evaluate(()=>fixture.Globals.data.contentRows.length)).toBe(26);
  expect(errors).toEqual([]);
});

test('normal OS-DPI editor displays the accepted keyboard in its actual Preview',async({page})=>{
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  const replies=[['recipe',{name:'keyboard',backspace:true}],['finish',{title:'Class keyboard',summary:'Created the keyboard.'}]];
  await page.route('https://api.groq.com/**',async route=>{
    requests.push(route.request().postDataJSON());
    const next=replies.shift();
    await route.fulfill(next?{json:toolReply(next[0],next[1],`live${requests.length}`)}:{status:500,json:{error:{message:'Unexpected request'}}});
  });
  await page.addInitScript(()=>{localStorage.setItem('osdpi-open-ai-generator','1');localStorage.setItem('os-dpi-groq-key','gsk_fake_authoring_test_key');});
  await page.goto('/OS-DPI-1/#class-keyboard', {waitUntil:'domcontentloaded'});
  await expect(page.getByTestId('author-run')).toBeVisible({timeout:20000});
  await page.getByTestId('author-mode').selectOption('new');
  await page.getByTestId('author-request').fill('Create a QWERTY keyboard with a display, Speak, Clear and Backspace.');
  await page.getByTestId('author-run').click();
  await expect.poll(()=>page.locator('#UI button').count()).toBeGreaterThan(26);
  expect(requests).toHaveLength(2);
  await page.getByTestId('author-preview').click();
  await expect(page.locator('#UI').getByRole('button',{name:'h',exact:true})).toBeVisible({timeout:15000});
  await page.locator('#UI').getByRole('button',{name:'h',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'i',exact:true}).click();
  await expect(page.locator('#UI')).toContainText('hi');
  expect(errors).toEqual([]);
});

test('actual media-rich repository archive retains its sections and resource hashes through a targeted edit',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('osdpi-open-ai-generator','1');localStorage.setItem('os-dpi-groq-key','gsk_fake_authoring_test_key');});
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/OS-DPI-1/#import-original',{waitUntil:'domcontentloaded'});
  await expect(page.getByTestId('author-import')).toBeVisible();
  await page.getByTestId('author-import').setInputFiles(new URL('../../examples/DEAN.osdpi',import.meta.url).pathname);
  await page.getByRole('button',{name:'Import this design',exact:true}).click();
  await page.waitForURL(/#DEAN$/);
  await expect(page.getByTestId('author-run')).toBeVisible();
  const before=await page.evaluate(async()=>{
    const n=await import('/OS-DPI-1/components/ai/authoring-native.js');
    const Globals=(await import('/OS-DPI-1/globals.js')).default;
    const db=(await import('/OS-DPI-1/db.js')).default,database=await db.dbPromise;
    const records=await database.getAllFromIndex('store5','by-name',db.designName);
    const nodes=root=>[root,...root.children.flatMap(nodes)];
    const grid=nodes(Globals.layout).find(n=>n.className==='Grid');
    Globals.layout.select(grid);Globals.state.update({designerTab:'Content'});
    return {design:n.captureNative(),target:grid.id,records,name:db.designName};
  });
  let count=0;
  await page.route('https://api.groq.com/**',route=>route.fulfill({json:++count===1
    ?toolReply('edit',{operations:[{op:'update',target:before.target,props:{buttonColor:'lightgreen'}}]},'import-edit')
    :toolReply('finish',{summary:'Changed the selected grid color.'},'import-finish')}));
  await page.getByTestId('author-request').fill('Make this grid’s buttons light green. Preserve everything else.');
  await page.getByTestId('author-run').click();
  await expect(page.getByTestId('author-run')).toBeEnabled();
  await expect(page.getByTestId('author-error')).toHaveCount(0);
  const after=await page.evaluate(async({target,name})=>{
    const n=await import('/OS-DPI-1/components/ai/authoring-native.js');
    const {default:db,unPackDesign}=await import('/OS-DPI-1/db.js'),database=await db.dbPromise;
    const design=n.captureNative();
    const archive=await unPackDesign(await db.convertDesignToBlob());
    const hashes=async media=>Promise.all(media.map(async m=>[m.name,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await m.content.arrayBuffer())))]));
    const sourceMedia=await database.getAll('media');
    const sourceKeys=await database.getAllKeys('media');
    const originalMedia=sourceMedia.filter((_,i)=>sourceKeys[i][0]===name);
    return {design,records:await database.getAllFromIndex('store5','by-name',name),originalHashes:await hashes(originalMedia),exportHashes:await hashes(archive.media),name:db.designName};
  },before);
  const expected=structuredClone(before.design);
  const walk=root=>[root,...(root.children||[]).flatMap(walk)];
  walk(expected.layout).find(n=>n.id===before.target).props.buttonColor='lightgreen';
  // Native IDs are deliberately regenerated when installing a working copy.
  const strip=v=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='id').map(([k,x])=>[k,strip(x)])):v;
  expect(strip(after.design)).toEqual(strip(expected));
  expect(after.records).toEqual(before.records);
  expect(after.exportHashes.sort()).toEqual(after.originalHashes.sort());
  expect(after.exportHashes).toHaveLength(11);
  expect(after.name).not.toBe(before.name);
});


test('strict-schema provider rejection gives precise bounded repair feedback without executing rejected JSON',async({page})=>{
  const failed=JSON.stringify({command:{name:'edit',operations:[{op:'insert',parent:null,className:'Button',ref:'mustNotExist',props:[],index:null}],tests:null,title:null,summary:null}});
  const {requests}=await setup(page,[async route=>route.fulfill({status:400,headers:{'x-ratelimit-remaining-tokens':'99999','access-control-expose-headers':'x-ratelimit-remaining-tokens'},json:{error:{code:'json_validate_failed',message:'Union inspect branch does not match',failed_generation:failed}}}),['recipe',{name:'keyboard',backspace:true,summary:'Created keyboard.'}]]);
  await generate(page);
  expect(requests).toHaveLength(2);expect(JSON.stringify(requests[1].messages)).toContain('operations[0].parent has the wrong value type');
  expect(await page.evaluate(()=>fixture.walk(fixture.captureNative().layout).some(n=>n.props?.name==='mustNotExist'))).toBe(false);
});

test('charged truncated structured responses count toward the request budget',async({page})=>{
  const {requests}=await setup(page,[async route=>route.fulfill({json:{choices:[{finish_reason:'length',message:{role:'assistant',content:'{"command":'}}],usage:{prompt_tokens:56000,completion_tokens:4000,total_tokens:60000}}})]);
  const before=await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()));
  await page.getByTestId('author-request').fill('Create an activity.');await page.getByTestId('author-run').click();await page.waitForFunction(()=>!fixture.panel.busy);
  expect(requests).toHaveLength(1);await expect(page.getByTestId('author-error')).toContainText('token budget');
  expect(await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()))).toBe(before);
});


test('rejected generations with unknown usage pace conservatively and remain cancellable',async({page})=>{
 const {requests}=await setup(page,[async route=>route.fulfill({status:400,json:{error:{code:'json_validate_failed',message:'Failed JSON',failed_generation:'{"command":'}}})]);
 const before=await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()));
 await page.getByText('Model and checks',{exact:true}).click();await page.getByTestId('author-diagnostics').check();
 await page.getByTestId('author-request').fill('Create a counting activity.');await page.getByTestId('author-run').click();
 await expect(page.getByTestId('author-status')).toContainText('Pacing requests');
 const provider=await page.evaluate(()=>fixture.panel.diagnostics.report.events.find(e=>e.stage==='provider'));
 expect(provider).toMatchObject({promptTokens:0,completionTokens:0,unreportedBudgetTokens:8000,quotaSource:'free-tier-estimated'});
 await page.getByTestId('author-cancel').click();await page.waitForFunction(()=>!fixture.panel.busy);
 expect(requests).toHaveLength(1);expect(await page.evaluate(()=>fixture.fingerprint(fixture.captureNative()))).toBe(before);
});


test('fingerprints preserve user data identities and omit only native tree identities',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{
  const f=fixture,original=f.emptyNative();original.content=[{id:'row-id',className:'Display',label:'Keep'}];original.extra={id:'extra-id'};original.layout.props.id='property-id';
  const before=f.fingerprint(original),nodeOnly=structuredClone(original);nodeOnly.layout.id='other-node';nodeOnly.layout.children[0]._ref='other-ref';
  return {nodeIdentityIgnored:f.fingerprint(nodeOnly)===before,changes:[['content',0,'id'],['extra','id'],['layout','props','id']].map(path=>{const changed=structuredClone(original);let target=changed;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)]='manual-id';return f.fingerprint(changed)!==before;}),topics:Object.keys(f.examples()).sort(),wireTopics:[...f.AUTHORING_EXAMPLE_TOPICS].sort()};
 });
 expect(result.nodeIdentityIgnored).toBe(true);expect(result.changes).toEqual([true,true,true]);expect(result.topics).toEqual(result.wireTopics);
});

test('manual content id changes during generation are kept in memory and storage',async({page})=>{
 let release,requested;const wait=new Promise(r=>release=r),seen=new Promise(r=>requested=r);
 await setup(page,[async route=>{requested();await wait;await route.fulfill({json:toolReply('recipe',{name:'keyboard',summary:'Created keyboard.'})});}]);
 await page.evaluate(async()=>{const f=fixture;f.Globals.data.contentRows=[{id:'original-id',label:'Keep'}];await f.db.write('content',f.Globals.data.contentRows);});
 await page.getByTestId('author-request').fill('Create a QWERTY keyboard.');await page.getByTestId('author-run').click();await seen;
 await page.evaluate(async()=>{const f=fixture;f.Globals.data.contentRows[0].id='manual-id';await f.db.write('content',f.Globals.data.contentRows);f.Globals.state.update();});release();
 await page.waitForFunction(()=>!fixture.panel.busy);await expect(page.getByTestId('author-error')).toContainText('manual changes');
 const after=await page.evaluate(async()=>{const f=fixture,d=await f.db.dbPromise;return {name:f.db.designName,id:f.Globals.data.contentRows[0].id,saved:(await d.getAllFromIndex('store5','by-name','original')).find(r=>r.type==='content').data[0].id};});
 expect(after).toEqual({name:'original',id:'manual-id',saved:'manual-id'});
});

test('AI undo refuses to erase a later manual content id',async({page})=>{
 await setup(page);await generate(page);
 await page.evaluate(async()=>{const f=fixture;f.Globals.data.contentRows[0].id='manual-id';await f.db.write('content',f.Globals.data.contentRows);f.Globals.state.update();});
 await page.getByTestId('author-undo').click();await expect(page.getByTestId('author-error')).toContainText('newer manual changes');
 expect(await page.evaluate(()=>fixture.Globals.data.contentRows[0].id)).toBe('manual-id');
});


test('a staged generic board can supply its final checks and submit without a dummy edit',async({page})=>{
 const {requests}=await setup(page,[['edit',{operations:[
  {op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Score'}},{className:'Button',ref:'add',props:{label:'Add 1'}}]},
  {op:'bind',target:'init',rules:[{updates:{$Score:'0'}}]},
  {op:'bind',target:'add',rules:[{updates:{$Score:'increment(1)'}}]},
 ]}],['edit',{operations:[],summary:'Created the score activity.',tests:[{steps:[],expect:{$Score:0}},{steps:[{target:'add'}],expect:{$Score:1}}]}]]);
 await generate(page,'Create a score activity with Add 1.');expect(requests).toHaveLength(2);await buttons(page);
 await page.locator('#UI').getByRole('button',{name:'Add 1',exact:true}).click();await expect(page.locator('#UI .display')).toContainText('1');
});

test('an empty edit cannot manufacture a completed board',async({page})=>{
 await setup(page,[['edit',{operations:[],summary:'Done.'}],['finish',{summary:'Done.'}],['finish',{summary:'Done.'}]]);
 await page.getByTestId('author-request').fill('Create an activity.');await page.getByTestId('author-run').click();await page.waitForFunction(()=>!fixture.panel.busy);
 expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');expect(await page.evaluate(()=>fixture.Globals.layout.children[0].children.length)).toBe(0);
 await expect(page.getByTestId('author-error')).toBeVisible();
});


test('requested native timer wiring is supplied before the first provider request',async({page})=>{
 const {requests}=await setup(page,[async route=>route.fulfill({status:401,json:{error:{message:'Synthetic authentication stop before model execution'}}})]);
 await page.getByTestId('author-request').fill('Create a score activity with a two-second timer.');await page.getByTestId('author-run').click();await page.waitForFunction(()=>!fixture.panel.busy);
 expect(requests).toHaveLength(1);const guide=requests[0].messages[0].content;
 expect(guide).toContain('RELEVANT NATIVE WIRING');expect(guide).toContain('@delay.Key');expect(guide).toContain('under the method section');expect(guide).toContain('AND one trailing space');
 expect(guide).toContain('increment(1)');expect(guide).toContain('Button ref answer');
});

test('an explicit output-size rejection lowers the command cap and leaves room for Qwen JSON',async({page})=>{
 const {requests}=await setup(page,[async route=>route.fulfill({status:429,json:{error:{message:"Request too large on output tokens per minute (OTPM): Limit 1000, Requested 1758. The request's expected output tokens exceed the enforced limit; reduce max_tokens."}}}),
  ['recipe',{name:'keyboard',backspace:true,summary:'Created native keyboard.'}],
 ]);
 await page.getByText('Model and checks',{exact:true}).click();await page.getByTestId('author-model').selectOption('qwen/qwen3.8-27b');
 await generate(page);
 expect(requests).toHaveLength(2);expect(requests[0].max_completion_tokens).toBeGreaterThan(1000);
 expect(requests[1]).toMatchObject({max_completion_tokens:1000,reasoning_effort:'none'});
 expect(requests[1].messages.some(m=>m.content.includes('Combine related operations in complete commands'))).toBe(true);
 expect(await page.evaluate(()=>fixture.db.designName)).not.toBe('original');
 const databaseOriginal=await page.evaluate(async()=>{const database=await fixture.db.dbPromise;return (await database.get('store5',['original','layout'])).data;});
 expect(databaseOriginal.children[0].children).toEqual([]);
});

test('temporary output quota exhaustion is paced without reducing response size or reasoning',async({page})=>{
 const {requests}=await setup(page,[async route=>route.fulfill({status:429,headers:{'retry-after':'0.1'},json:{error:{message:'Rate limit reached on output tokens per minute (OTPM): Limit 1000, Used 950, Requested 500. Try again in 0.1s.'}}}),
  ['recipe',{name:'keyboard',backspace:true,summary:'Created native keyboard.'}],
 ]);
 await page.getByText('Model and checks',{exact:true}).click();await page.getByTestId('author-model').selectOption('qwen/qwen3.8-27b');await generate(page);
 expect(requests).toHaveLength(2);expect(requests[1].max_completion_tokens).toBeGreaterThan(1000);expect(requests[1].reasoning_effort).toBe('medium');
});

test('repeated or malformed output-size limits stop without altering the current board',async({page})=>{
 for(const limit of ['1000','unknown']){
  const rejection=async route=>route.fulfill({status:429,json:{error:{message:`Request too large on output tokens per minute (OTPM): Limit ${limit}, Requested 1758. The request's expected output tokens exceed the enforced limit; reduce max_tokens.`}}});
  const {requests}=await setup(page,[rejection,rejection]);
  await page.getByText('Model and checks',{exact:true}).click();await page.getByTestId('author-model').selectOption('qwen/qwen3.8-27b');
  await page.getByTestId('author-request').fill('Create a keyboard.');await page.getByTestId('author-run').click();await page.waitForFunction(()=>!fixture.panel.busy);
  await expect(page.getByTestId('author-error')).toBeVisible();expect(requests).toHaveLength(limit==='1000'?2:1);
  expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');expect(await page.evaluate(()=>fixture.Globals.layout.children[0].children)).toEqual([]);
 }
});

test('native validation survives inspections but is invalidated by a successful repair',async({page})=>{
 const method={className:'Method',ref:'customAccess',props:{Name:'Custom access',Active:false,Pattern:'NullPattern'}};
 const checks=[{name:'opening',steps:[],expect:{$Status:'Ready'}},{name:'choose',steps:[{target:'choice'}],expect:{$Status:'Done'}}];
 const {requests}=await setup(page,[
  ['edit',{operations:[{op:'insert',parent:'page',nodes:[method]}]}],
  ['inspect',{classes:['Method']}],
  ['edit',{operations:[{op:'update',target:'page',props:{background:''}}]}],
  ['inspect',{classes:['Method']}],
  ['edit',{operations:[{op:'insert',parent:'method',nodes:[method]}]}],
  ['inspect',{classes:['Method']}],
  ['edit',{operations:[
   {op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Status'}},{className:'Button',ref:'choice',props:{label:'Choose'}}]},
   {op:'bind',target:'init',rules:[{updates:{$Status:"'Ready'"}}]},
   {op:'bind',target:'choice',rules:[{updates:{$Status:"'Done'"}}]},
  ],tests:[{...checks[0],expect:{$Status:'Wrong'}},checks[1]],summary:'Created the activity.'}],
  ['inspect',{classes:['Display']}],
  ['edit',{operations:[],tests:checks,summary:'Created and checked the activity.'}],
 ]);
 await generate(page,'Create a button activity with a custom access method.');
 expect(requests).toHaveLength(9);
 const tasks=requests.map(r=>JSON.parse(r.messages[1].content));
 for(const index of [1,2,3,4])expect(tasks[index].lastValidation.error).toContain('Method is not a child of Page');
 expect(tasks[5].lastValidation).toBeUndefined();expect(tasks[6].lastValidation).toBeUndefined();
 for(const index of [7,8]){
  expect(tasks[index].lastValidation).toMatchObject({round:7,ok:false,interactions:[{name:'opening'}]});
  expect(tasks[index].lastValidation.error).toBeUndefined();
 }
});

test('smaller context retains inactive native access methods and their actual timer refs',async({page})=>{
 const {requests}=await setup(page,[async route=>route.fulfill({status:413,json:{error:{message:'Request too large; reduce context.'}}}),
  async route=>route.fulfill({status:401,json:{error:{message:'Synthetic stop after context capture'}}}),
 ]);
 await page.getByTestId('author-request').fill('Configure pointer dwell for 0.8 seconds.');await page.getByTestId('author-run').click();await page.waitForFunction(()=>!fixture.panel.busy);
 expect(requests).toHaveLength(2);
 const task=JSON.parse(requests[1].messages[1].content),dwell=task.access.find(m=>m.name==='Pointer dwell');
 expect(dwell).toBeDefined();expect([false,'false']).toContain(dwell.active);expect(dwell.ref).toBeTruthy();
 expect(dwell.timers).toHaveLength(1);expect(dwell.timers[0]).toMatchObject({seconds:'1.5'});expect(dwell.timers[0].ref).toBeTruthy();expect(dwell.timers[0].key).toBeTruthy();
 expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');
});

test('provider truncation asks for smaller complete commands with the actual reply allowance',async({page})=>{
 const {requests}=await setup(page,[async route=>route.fulfill({status:400,headers:{'x-ratelimit-remaining-tokens':'99999','access-control-expose-headers':'x-ratelimit-remaining-tokens'},json:{error:{code:'json_validate_failed',message:'max completion tokens reached before generating a valid document: the output was truncated to fit max_completion_tokens and is missing required content.',failed_generation:'{"command":{"name":"edit","operations":[]}}'}}}),
  ['edit',{operations:[{op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Greeting'}}]},{op:'bind',target:'init',rules:[{updates:{$Greeting:"'Hello'"}}]}],summary:'Created the greeting.'}],
 ]);
 await generate(page,'Create a greeting display saying Hello.');
 expect(requests).toHaveLength(2);
 for(const request of requests){const task=JSON.parse(request.messages[1].content);expect(task.commandTokenBudget).toBe(request.max_completion_tokens);expect(task.editBatchHint).toBe(Math.max(1,Math.floor(request.max_completion_tokens/400)));}
 expect(requests[1].messages.some(m=>m.content.includes('command was truncated at')&&m.content.includes('No partial command was applied'))).toBe(true);
 await buttons(page);await expect(page.locator('#UI')).toContainText('Hello');
});

test('a short quota retry after seven minutes uses the actual eight-minute deadline',async({page})=>{
 const {errors}=await setup(page);await page.evaluate(()=>fixture.Globals.methods.stop());await page.clock.install();
 await page.evaluate(()=>{
  const f=fixture,session=f.documentSession(f.emptyNative());let calls=0;
  window.deadlineResult=null;
  f.authorInterface({session,request:'Create a greeting display saying Hello.',turn:async()=>{
   calls++;
   if(calls===8)throw Object.assign(new Error('Temporary TPM exhaustion'),{kind:'rate-limit',retryAfter:'5'});
   const reply=calls<8?f.commandReply('inspect',{classes:['Display']}):f.commandReply('edit',{operations:[{op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Greeting'}}]},{op:'bind',target:'init',rules:[{updates:{$Greeting:"'Hello'"}}]}],summary:'Created the greeting.'});
   return {message:f.decodeAuthoringResponse(reply.choices[0].message.content),usage:{total_tokens:100},...(calls<8?{rate:{remaining:0,reset:'60s',receivedAt:Date.now()}}:{})};
  }}).then(result=>window.deadlineResult={accepted:result.accepted,calls}).catch(e=>window.deadlineResult={error:e.message,calls});
 });
 await page.clock.runFor(427000);
 expect(await page.evaluate(()=>window.deadlineResult)).toEqual({accepted:true,calls:9});
 expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');
 expect(errors).toEqual([]);
});


test('created access inventory survives compact context and four later inspections',async({page})=>{
 const replies=[async route=>route.fulfill({status:413,json:{error:{message:'Request too large; reduce context.'}}}),
  ['edit',{operations:[{op:'insert',parent:'method',nodes:[{className:'Method',ref:'delayMethod',props:{Active:true,Pattern:'NullPattern'},children:[
   {className:'Timer',ref:'delay',props:{Interval:2}},
   {className:'KeyHandler',ref:'start',props:{Signal:'keyup'},children:[{className:'HandlerKeyCondition',ref:'keyT',props:{Key:'t'}},{className:'ResponderStartTimer',ref:'startDelay',props:{TimerName:'@delay.Key'}}]},
   {className:'TimerHandler',ref:'done',props:{Signal:'timer',TimerName:'@delay.Key'},children:[{className:'ResponderEmit',ref:'emit'}]},
  ]}]}]}],
  ...Array.from({length:4},()=>['inspect',{classes:['Display']}]),
  async route=>route.fulfill({status:401,json:{error:{message:'Synthetic stop after inventory capture'}}}),
 ];
 const {requests}=await setup(page,replies.map(reply=>Array.isArray(reply)?async route=>route.fulfill({json:{...toolReply(...reply),usage:{prompt_tokens:1000,total_tokens:1200}},headers:{'x-ratelimit-remaining-tokens':'99999','access-control-expose-headers':'x-ratelimit-remaining-tokens'}}):reply));
 await page.getByTestId('author-request').fill('Create a timing activity.');await page.getByTestId('author-run').click();await page.waitForFunction(()=>!fixture.panel.busy);
 expect(requests).toHaveLength(7);
 const task=JSON.parse(requests.at(-1).messages[1].content),created=Object.fromEntries(task.created.map(n=>[n.ref,n]));
 expect(task.createdCount).toBe(7);expect(Object.keys(created)).toEqual(['delayMethod','delay','start','keyT','startDelay','done','emit']);
 expect(created.delayMethod.props.Active).toBe(true);expect(created.delay).toMatchObject({parent:'delayMethod',props:{Interval:2}});
 expect(created.keyT).toMatchObject({parent:'start',props:{Key:'t'}});expect(created.start.props.Signal).toBe('keyup');
 expect(created.startDelay.props.TimerName).toBe(created.delay.props.Key);expect(created.done.props.TimerName).toBe(created.delay.props.Key);
 expect(created.emit.parent).toBe('done');expect(await page.evaluate(()=>fixture.db.designName)).toBe('original');
});

test('imported CSS guidance scopes a selected unique Grid and preserves other backgrounds',async({page})=>{
 const {requests,errors}=await setup(page,[['edit',{operations:[{op:'insert',parent:'page',nodes:[{className:'Customize',props:{css:'.grid[#ComponentName="selected grid"] button:not(.grid-empty) {background-color: lightgreen;}'}}]}],summary:'Changed the selected grid appearance.'}]]);
 await page.evaluate(()=>{
  const f=fixture,s=f.documentSession(f.emptyNative());
  s.edit([{op:'insert',parent:'page',nodes:[{className:'Grid',ref:'chosen',props:{name:'selected grid',rows:1,columns:1}},{className:'Button',props:{label:'Other'}},{className:'Customize',props:{css:'button {background-color: skyblue;}'}}]},{op:'rows',rows:[{label:'Chosen'}]}]);
  f.installNative(s.snapshot());f.panel.mode='edit';
  f.Globals.layout.select(f.Globals.layout.children[0].children[0]);
  f.draw();
 });
 await generate(page,"Make this grid's buttons light green.");
 const task=JSON.parse(requests[0].messages[1].content);
 expect(task.selection.cssTarget).toBe('.grid[#ComponentName="selected grid"] button:not(.grid-empty)');
 expect(task.selection.parent).toBeTruthy();expect(requests[0].messages[0].content).toContain('automatically scopes rules');
 await buttons(page);await expect(page.locator('#UI').getByRole('button',{name:'Chosen',exact:true})).toHaveCSS('background-color','rgb(144, 238, 144)');
 await expect(page.locator('#UI').getByRole('button',{name:'Other',exact:true})).toHaveCSS('background-color','rgb(135, 206, 235)');
 expect(errors).toEqual([]);
});


test('empty model steps request real progress while retaining the staged document',async({page})=>{
 const {requests}=await setup(page,[['edit',{operations:[{op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Greeting'}}]},{op:'bind',target:'init',rules:[{updates:{$Greeting:"'Hello'"}}]}]}],['edit',{operations:[]}],['finish',{summary:'Created the greeting.'}]]);
 await generate(page,'Create a greeting display saying Hello.');
 expect(requests).toHaveLength(3);const task=JSON.parse(requests[2].messages[1].content);
 expect(task.lastResults.some(r=>!r.ok&&r.error.includes('No edits or new checks'))).toBe(true);
 await buttons(page);await expect(page.locator('#UI .display')).toHaveText('Hello');
});
