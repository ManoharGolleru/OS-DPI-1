// Regression for archives captured from REAL Groq runs. No model requests here.
import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {zipSync,strToU8} from 'fflate';

// Native documentation regression; this is not a model reliability test.
test('documented timer responds to physical keys in ordinary Preview and after native roundtrip',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('osdpi-open-ai-generator','1');window.spoken=[];speechSynthesis.speak=u=>window.spoken.push(u.text);});
 await page.goto('/OS-DPI-1/#timer-reference-original');await expect(page.getByTestId('author-import')).toBeVisible();
 const design=await page.evaluate(async()=>{
  const n=await import('/OS-DPI-1/components/ai/authoring-native.js'),p=await import('/OS-DPI-1/components/ai/authoring-protocol.js');
  const session=n.documentSession(n.emptyNative());
  const decoded=p.decodeAuthoringResponse(JSON.stringify({command:n.examples('timer').command}));
  session.edit([...JSON.parse(decoded.tool_calls[0].function.arguments).operations,
   {op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Status'}},{className:'Display',props:{stateName:'$Score'}}]},
   {op:'bind',target:'init',rules:[{updates:{$Score:'7'}}]},
  ]);
  if(session.check().errors.length)throw new Error(JSON.stringify(session.check().errors));
  return session.snapshot();
 });
 const archive=zipSync(Object.fromEntries(Object.entries(design).map(([key,value])=>[key+'.json',strToU8(JSON.stringify(value))])));
 await page.getByTestId('author-import').setInputFiles({name:'Timer-reference.osdpi',mimeType:'application/zip',buffer:Buffer.from(archive)});await page.waitForURL(/#Timer_reference$/);
 const fingerprint=()=>page.evaluate(async()=>{const n=await import('/OS-DPI-1/components/ai/authoring-native.js');return n.fingerprint(n.captureNative());});
 const before=await fingerprint(),ui=page.locator('#UI');
 async function interact(){
  await page.getByTestId('author-preview').click();await expect(ui).toContainText('Ready');await expect(ui).toContainText('7');
  await page.keyboard.down('x');await page.waitForTimeout(150);await page.keyboard.up('x');await page.waitForTimeout(2200);await expect(ui).toContainText('Ready');
  await page.evaluate(()=>{
   window.timerObservation={};
   const keyup=e=>{if(e.key==='t'){window.timerObservation.started=performance.now();removeEventListener('keyup',keyup);}};
   addEventListener('keyup',keyup);
   const observer=new MutationObserver(()=>{if(document.querySelector('#UI').textContent.includes('Time up')){window.timerObservation.elapsed=performance.now()-window.timerObservation.started;observer.disconnect();}});
   observer.observe(document.querySelector('#UI'),{childList:true,subtree:true,characterData:true});
  });
  await page.keyboard.down('t');await page.waitForTimeout(150);await page.keyboard.up('t');
  await page.waitForTimeout(1500);await expect(ui).toContainText('Ready');await expect(ui).toContainText('Time up',{timeout:2500});
  const elapsed=await page.evaluate(()=>window.timerObservation.elapsed);expect(elapsed).toBeGreaterThanOrEqual(1950);expect(elapsed).toBeLessThan(3000);
  await expect(ui).toContainText('7');expect(await page.evaluate(()=>window.spoken)).toEqual([]);
  await page.getByRole('button',{name:'Back to editing',exact:true}).click();
 }
 await interact();
 const downloaded=page.waitForEvent('download');await page.getByTestId('author-download').click();const bytes=readFileSync(await(await downloaded).path());
 await page.getByTestId('author-import').setInputFiles({name:'Timer-roundtrip.osdpi',mimeType:'application/zip',buffer:bytes});await page.waitForURL(/#Timer_roundtrip$/);expect(await fingerprint()).toBe(before);
 await interact();expect(errors).toEqual([]);
});

test('recorded real Qwen archive works in ordinary Preview and after UI export/reimport',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('osdpi-open-ai-generator','1');
    window.spoken=[];
    speechSynthesis.getVoices=()=>[{voiceURI:'test',name:'Test',lang:'en-US',default:true}];
    speechSynthesis.speak=utterance=>{window.spoken.push(utterance.text);};
  });
  await page.goto('/OS-DPI-1/#recorded-original',{waitUntil:'domcontentloaded'});
  await expect(page.getByTestId('author-import')).toBeVisible();
  const archive=process.env.OSDPI_TEST_ARCHIVE || new URL('../../tests/fixtures/qwen-keyboard.osdpi',import.meta.url).pathname;
  await page.getByTestId('author-import').setInputFiles(archive);
  await page.waitForURL(url=>!url.hash.includes('recorded-original'));
  await expect(page.getByTestId('author-preview')).toBeVisible();
  const fingerprint=()=>page.evaluate(async()=>{
    const n=await import('/OS-DPI-1/components/ai/authoring-native.js');
    return n.fingerprint(n.captureNative());
  });
  const before=await fingerprint();
  const state=name=>page.evaluate(async name=>(await import('/OS-DPI-1/globals.js')).default.state.get(name),name);
  const interact=async()=>{
    await page.getByTestId('author-preview').click();
    const ui=page.locator('#UI');
    await expect(ui.getByRole('button',{name:'h',exact:true})).toBeVisible();
    const letters=(await ui.getByRole('button').allTextContents()).map(s=>s.trim()).filter(s=>/^[a-z]$/.test(s));
    expect(letters.join('')).toBe('qwertyuiopasdfghjklzxcvbnm');
    for(const c of 'hello world')await ui.getByRole('button',{name:c===' '?'Space':c,exact:true}).click();
    await expect.poll(()=>state('$Display')).toBe('hello world');
    await expect(ui).toContainText('hello world');
    expect(await page.evaluate(()=>window.spoken)).toEqual([]);
    await ui.getByRole('button',{name:'Speak',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.spoken)).toEqual(['hello world']);
    await ui.getByRole('button',{name:'Backspace',exact:true}).click();
    expect(await state('$Display')).toBe('hello worl');
    await ui.getByRole('button',{name:'Clear',exact:true}).click();
    await ui.getByRole('button',{name:'Clear',exact:true}).click();
    await ui.getByRole('button',{name:'Speak',exact:true}).click();
    expect(await state('$Display')).toBe('');
    expect(await page.evaluate(()=>window.spoken)).toEqual(['hello world']);
  };
  await page.setViewportSize({width:1440,height:900});
  await interact();
  await page.screenshot({path:testInfo.outputPath('real-qwen-desktop.png')});
  await page.setViewportSize({width:1024,height:768});
  await page.screenshot({path:testInfo.outputPath('real-qwen-tablet.png')});
  const clipped=await page.locator('#UI button').evaluateAll(buttons=>buttons.filter(b=>b.scrollWidth>b.clientWidth+2).map(b=>({label:b.textContent.trim(),client:b.clientWidth,scroll:b.scrollWidth})));
  await page.getByRole('button',{name:'Back to editing',exact:true}).click();
  const downloadEvent=page.waitForEvent('download');
  await page.getByTestId('author-download').click();
  const download=await downloadEvent,bytes=readFileSync(await download.path());
  expect(bytes.includes(Buffer.from('gsk_'))).toBe(false);
  await page.getByTestId('author-import').setInputFiles({name:'Recorded-roundtrip.osdpi',mimeType:'application/octet-stream',buffer:bytes});
  await page.waitForURL(/#Recorded_roundtrip/);
  await expect(page.getByTestId('author-preview')).toBeVisible();
  expect(await fingerprint()).toBe(before);
  await page.evaluate(()=>window.spoken=[]);
  await interact();
  expect(errors).toEqual([]);
  expect(clipped,'Native button labels must fit at tablet size').toEqual([]);
});

// Export captured after a real GPT-OSS 120B Groq authoring run. The archive is
// used unchanged: these checks prove its native behavior, not generation rate.
test('recorded real GPT-OSS restaurant archive preserves tabs, composition and speech through native export',async({page},testInfo)=>{
  const errors=[],clipping=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('osdpi-open-ai-generator','1');
    window.spoken=[];
    speechSynthesis.getVoices=()=>[{voiceURI:'test',name:'Test',lang:'en-US',default:true}];
    speechSynthesis.speak=utterance=>{window.spoken.push(utterance.text);};
  });
  await page.goto('/OS-DPI-1/#recorded-restaurant-original',{waitUntil:'domcontentloaded'});
  await expect(page.getByTestId('author-import')).toBeVisible();
  const stored=()=>page.evaluate(async()=>{
    const db=(await import('/OS-DPI-1/db.js')).default;
    await db.settleWrites();const database=await db.dbPromise;
    return {name:db.designName,records:await database.getAllFromIndex('store5','by-name',db.designName)};
  });
  const original=await stored();
  const archive=new URL('../../tests/fixtures/gpt-oss-restaurant.osdpi',import.meta.url).pathname;
  await page.getByTestId('author-import').setInputFiles(archive);
  await page.waitForURL(url=>url.hash!=='#'+original.name);
  await expect(page.getByTestId('author-preview')).toBeVisible();
  const imported=await stored();
  const fingerprint=()=>page.evaluate(async()=>{
    const native=await import('/OS-DPI-1/components/ai/authoring-native.js');
    return native.fingerprint(native.captureNative());
  });
  const before=await fingerprint();
  const state=name=>page.evaluate(async name=>(await import('/OS-DPI-1/globals.js')).default.state.get(name),name);
  const ui=page.locator('#UI');
  const inspectBounds=async label=>{
    const failures=await ui.locator('button').evaluateAll(buttons=>buttons.flatMap(button=>{
      const r=button.getBoundingClientRect();if(!r.width||!r.height)return [];
      const clippedText=button.scrollWidth>button.clientWidth+2 || button.scrollHeight>button.clientHeight+2;
      const outside=r.left < -1 || r.top < -1 || r.right>innerWidth+1 || r.bottom>innerHeight+1;
      return clippedText||outside?[{label:button.textContent.trim(),clippedText,outside}]:[];
    }));
    clipping.push({view:label,failures});
    expect(failures,`Native restaurant controls must fit ${label}`).toEqual([]);
  };
  const interact=async screenshotPrefix=>{
    await page.evaluate(()=>window.spoken=[]);
    await ui.getByRole('button',{name:'Food',exact:true}).click();
    await expect(ui.getByRole('button',{name:'Bread',exact:true})).toBeVisible();
    await expect(ui.getByRole('button',{name:'Water',exact:true})).toHaveCount(0);
    await ui.getByRole('button',{name:'Bread',exact:true}).click();
    await ui.getByRole('button',{name:'Rice',exact:true}).click();
    expect(await state('$Display')).toBe('Bread Rice ');
    expect(await state('$tabControl')).toBe('foodTab');
    expect(await page.evaluate(()=>window.spoken)).toEqual([]);
    await expect(ui.locator('.display')).toContainText('Bread Rice');
    if(screenshotPrefix){await inspectBounds(screenshotPrefix+'-food');await page.screenshot({path:testInfo.outputPath(screenshotPrefix+'-food.png')});}
    await ui.getByRole('button',{name:'Drinks',exact:true}).click();
    await expect(ui.getByRole('button',{name:'Juice',exact:true})).toBeVisible();
    await expect(ui.getByRole('button',{name:'Bread',exact:true})).toHaveCount(0);
    expect(await state('$Display')).toBe('Bread Rice ');
    await ui.getByRole('button',{name:'Juice',exact:true}).click();
    expect(await state('$Display')).toBe('Bread Rice Juice ');
    expect(await state('$tabControl')).toBe('drinksTab');
    expect(await page.evaluate(()=>window.spoken)).toEqual([]);
    await expect(ui.locator('.display')).toContainText('Bread Rice Juice');
    if(screenshotPrefix){await inspectBounds(screenshotPrefix+'-drinks');await page.screenshot({path:testInfo.outputPath(screenshotPrefix+'-drinks.png')});}
    await ui.getByRole('button',{name:'Speak',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.spoken)).toEqual(['Bread Rice Juice ']);
    await ui.getByRole('button',{name:'Clear',exact:true}).click();
    await ui.getByRole('button',{name:'Clear',exact:true}).click();
    await ui.getByRole('button',{name:'Speak',exact:true}).click();
    expect(await state('$Display')).toBe('');
    expect(await page.evaluate(()=>window.spoken)).toEqual(['Bread Rice Juice ']);
  };
  await page.setViewportSize({width:1440,height:900});
  await page.getByTestId('author-preview').click();
  await interact('real-gpt-oss-restaurant-desktop');
  await page.setViewportSize({width:1024,height:768});
  await interact('real-gpt-oss-restaurant-tablet');
  await page.getByRole('button',{name:'Back to editing',exact:true}).click();
  const downloadEvent=page.waitForEvent('download');
  await page.getByTestId('author-download').click();
  const download=await downloadEvent,bytes=readFileSync(await download.path());
  await page.getByTestId('author-import').setInputFiles({name:'Restaurant-roundtrip.osdpi',mimeType:'application/octet-stream',buffer:bytes});
  await page.waitForURL(/#Restaurant_roundtrip/);
  await expect(page.getByTestId('author-preview')).toBeVisible();
  expect(await fingerprint()).toBe(before);
  const retained=await page.evaluate(async names=>{
    const db=(await import('/OS-DPI-1/db.js')).default,database=await db.dbPromise;
    return Promise.all(names.map(name=>database.getAllFromIndex('store5','by-name',name)));
  },[original.name,imported.name]);
  expect(retained).toEqual([original.records,imported.records]);
  await page.getByTestId('author-preview').click();
  await interact();
  expect(errors).toEqual([]);
  writeFileSync(testInfo.outputPath('real-gpt-oss-restaurant-evidence.json'),JSON.stringify({
    source:'Recorded real Groq GPT-OSS 120B output; no provider requests in this regression.',
    fixture:'tests/fixtures/gpt-oss-restaurant.osdpi',viewports:[{width:1440,height:900},{width:1024,height:768}],clipping,
    behavior:{composition:'Bread Rice Juice ',tabsPreserveMessage:true,noAutomaticSpeech:true,speakExactlyOnce:true,repeatedClearAndEmptySpeak:true},
    nativeUIExportReimportEqual:true,originalBoardsUnchanged:true,pageErrors:errors,
  },null,2));
});
