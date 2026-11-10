import {test,expect,chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,basename} from 'node:path';

// Generation provenance is beside the untouched fixture. This test makes no model calls.
test('recorded real Qwen score/timer works through physical input and native roundtrip',async({},testInfo)=>{
  const archive=new URL('../../tests/fixtures/qwen-score-timer.osdpi',import.meta.url).pathname,out=testInfo.outputPath('real-qwen-activity');mkdirSync(out,{recursive:true});

  const provenance=JSON.parse(readFileSync(new URL('../../tests/fixtures/qwen-score-timer-provenance.json',import.meta.url),'utf8'));
  expect(createHash('sha256').update(readFileSync(archive)).digest('hex')).toBe(provenance.archiveSHA256);
  // Physical keys and observed Display values are the oracle.
  const browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors=[],bounds=[],timings=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.addInitScript(()=>{
   localStorage.setItem('osdpi-open-ai-generator','1');window.spoken=[];
   speechSynthesis.getVoices=()=>[{voiceURI:'test',name:'Test',lang:'en-US',default:true}];
   speechSynthesis.speak=u=>window.spoken.push(u.text);
  });
  const stored=()=>page.evaluate(async()=>{const db=(await import('/OS-DPI-1/db.js')).default;await db.settleWrites();return {name:db.designName,records:await (await db.dbPromise).getAllFromIndex('store5','by-name',db.designName)};});
  const fingerprint=()=>page.evaluate(async()=>{const n=await import('/OS-DPI-1/components/ai/authoring-native.js');return n.fingerprint(n.captureNative());});
  const ui=page.locator('#UI'),button=name=>ui.getByRole('button',{name:name==='Add 1'?/^(Add 1|Add|\+1)$/:name==='Remove 1'?/^(Remove 1|Remove|-1)$/:name,exact:true});
  const rememberMethods=()=>page.evaluate(async()=>{window.previousMethods=(await import('/OS-DPI-1/globals.js')).default.methods;});
  const waitImported=()=>page.waitForFunction(async()=>(await import('/OS-DPI-1/globals.js')).default.methods!==window.previousMethods);
  const inspectBounds=async view=>{
   // Measure layout after the pointer leaves the choice; native hover scaling
   // intentionally expands its border. Text clipping is still checked below.
   await page.getByRole('button',{name:'Back to editing',exact:true}).hover();
   let failures;
   await expect.poll(async()=>{
    failures=await ui.locator('button').evaluateAll(els=>els.flatMap(e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return [];const clipped=e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2,outside=r.x < -1||r.y < -1||r.right>innerWidth+1||r.bottom>innerHeight+1;return clipped||outside?[{label:e.textContent.trim(),clipped,outside}]:[];}));
    return failures;
   },{message:view+' layout and text bounds after hover animation'}).toEqual([]);
   bounds.push({view,failures});
  };
  async function interact(prefix){
   await page.evaluate(()=>window.spoken=[]);
   const displayTexts=async()=>(await ui.locator('.display').allTextContents()).map(s=>s.trim());
   const score=n=>expect.poll(displayTexts).toContain(String(n));
   const status=s=>expect.poll(displayTexts,{timeout:5000}).toContain(s);
   await status('Ready');await score(0);
   await button('Remove 1').click();await score(0);
   for(let n=1;n<=3;n++){await button('Add 1').click();await score(n);}
   await button('Remove 1').click();await score(2);
   await page.evaluate(()=>{
    window.timerObservation={};
    const keydown=e=>{if(e.key==='t'){window.timerObservation.started=performance.now();removeEventListener('keydown',keydown);}};
    addEventListener('keydown',keydown);
    const observer=new MutationObserver(()=>{if([...document.querySelectorAll('#UI .display')].some(e=>e.textContent.trim()==='Time up')){window.timerObservation.elapsed=performance.now()-window.timerObservation.started;observer.disconnect();}});
    observer.observe(document.querySelector('#UI'),{childList:true,subtree:true,characterData:true});
   });
   await page.keyboard.down('t');await page.waitForTimeout(150);await page.keyboard.up('t');
   await page.waitForTimeout(800);await status('Ready');await score(2);
   await status('Time up');await score(2);
   const elapsed=await page.evaluate(()=>window.timerObservation.elapsed);expect(elapsed).toBeGreaterThanOrEqual(1900);expect(elapsed).toBeLessThan(3300);timings.push({view:prefix||'roundtrip',physicalKeydownToStatusMs:elapsed});
   expect(await page.evaluate(()=>window.spoken)).toEqual([]);
   if(prefix){await inspectBounds(prefix);await page.screenshot({path:resolve(out,prefix+'.png')});}
   await button('Reset').click();await button('Reset').click();await score(0);await status('Ready');
  }
  const report={source:'Unmodified actual-model archive; ordinary full app Preview, no generation during this replay',archive:basename(archive),outcome:'running',speechObservation:'Native speech dispatch recorded; audible playback not independently measured.'};
  try{
   await page.goto('http://127.0.0.1:8080/OS-DPI-1/#real-activity-original');await expect(page.getByTestId('author-import')).toBeVisible();
   const original=await stored();await rememberMethods();await page.getByTestId('author-import').setInputFiles(archive);await page.waitForURL(u=>u.hash!=='#real-activity-original');await waitImported();
   await expect(page.getByTestId('author-preview')).toBeVisible();const imported=await stored(),before=await fingerprint();
   await page.setViewportSize({width:1440,height:900});await page.getByTestId('author-preview').click();await interact('desktop');
   await page.setViewportSize({width:1024,height:768});await interact('tablet');
   await page.getByRole('button',{name:'Back to editing',exact:true}).click();
   const downloaded=page.waitForEvent('download');await page.getByTestId('author-download').click();const bytes=readFileSync(await (await downloaded).path());writeFileSync(resolve(out,'roundtrip.osdpi'),bytes);
   expect(bytes.includes(Buffer.from('gsk_'))).toBe(false);
   await rememberMethods();await page.getByTestId('author-import').setInputFiles({name:'Activity-roundtrip.osdpi',mimeType:'application/zip',buffer:bytes});await page.waitForURL(/#Activity_roundtrip$/);await waitImported();
   expect(await fingerprint()).toBe(before);
   const originals=await page.evaluate(async names=>{const db=(await import('/OS-DPI-1/db.js')).default,d=await db.dbPromise;return Promise.all(names.map(n=>d.getAllFromIndex('store5','by-name',n)));},[original.name,imported.name]);
   expect(originals).toEqual([original.records,imported.records]);
   await page.getByTestId('author-preview').click();await interact();expect(errors).toEqual([]);
   Object.assign(report,{outcome:'pass',scoreTransitions:[0,0,1,2,3,2,0],timer:'Ready before expiration, Time up after two seconds, score unchanged',statusTransitions:['Ready','Time up','Ready'],silent:true,repeatedReset:true,timings,nativeExportReimportEqual:true,originalBoardsUnchanged:true,bounds,pageErrors:errors});
  }catch(error){Object.assign(report,{outcome:'failed',error:error.message,bounds,pageErrors:errors});await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});throw error;}
  finally{writeFileSync(resolve(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
  console.log(JSON.stringify(report));
});
