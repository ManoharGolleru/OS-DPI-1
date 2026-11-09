// Explicit opt-in only. These tests send SYNTHETIC requests to the real Groq API.
// No routing mocks, HARs, Playwright traces, or persisted authentication state.
import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseEnv} from 'node:util';

const env=process.env.GROQ_TEST_ENV?parseEnv(await fs.readFile(process.env.GROQ_TEST_ENV,'utf8')):{};
const key=process.env.GROQ_API_KEY || env.GROQ_API_KEY;
const models=process.env.GROQ_TEST_MODEL?[process.env.GROQ_TEST_MODEL]:['qwen/qwen3.8-27b','openai/gpt-oss-120b'];
const attempts=Number(process.env.GROQ_TEST_ATTEMPTS || 5);
const keyboardPrompt='Create a QWERTY keyboard with a message display, Space, Backspace, Speak and Clear. Large readable buttons. Mouse and touch interaction. Do not add other features.';
test.skip(!key,'Set GROQ_API_KEY or GROQ_TEST_ENV securely to opt into live-provider tests.');

async function state(page,name) {
  return page.evaluate(async name=>(await import('/OS-DPI-1/globals.js')).default.state.get(name),name);
}
async function snapshot(page) {
  return page.evaluate(async()=>{
    const n=await import('/OS-DPI-1/components/ai/authoring-native.js');
    return n.captureNative();
  });
}
async function start(page,model) {
  const log=[];
  // Only record sanitized responses from synthetic fixtures. Never request headers.
  const pending=[];
  page.on('response',res=>{
    if(!res.url().startsWith('https://api.groq.com/openai/v1/chat/completions'))return;
    pending.push((async()=>{
      const data=await res.json().catch(()=>({}));
      const choice=data.choices?.[0];
      log.push({status:res.status(),finishReason:choice?.finish_reason,usage:data.usage,
        calls:choice?.message?.tool_calls?.map(c=>({name:c.function?.name,arguments:c.function?.arguments})),
        error:data.error?{code:data.error.code,message:data.error.message}:undefined});
    })());
  });
  await page.addInitScript(({key,model})=>{
    localStorage.setItem('osdpi-open-ai-generator','1');
    localStorage.setItem('os-dpi-groq-key',key);
    localStorage.setItem('osdpi-authoring-model',model);
    window.spoken=[];
    speechSynthesis.speak=utterance=>{window.spoken.push(utterance.text);utterance.onend?.();};
    speechSynthesis.getVoices=()=>[{name:'Test voice',voiceURI:'test-local',lang:'en-US',default:true}];
  },{key,model});
  await page.goto('./#live-acceptance-original',{waitUntil:'domcontentloaded'});
  await expect(page.getByTestId('author-run')).toBeVisible({timeout:20000});
  await page.getByTestId('author-mode').selectOption('new');
  await page.getByText('Model and checks',{exact:true}).click();
  if(await page.getByTestId('author-diagnostics').count())await page.getByTestId('author-diagnostics').check();
  return {log,pending};
}
async function generate(page,prompt) {
  await page.getByTestId('author-request').fill(prompt);
  await page.getByTestId('author-run').click();
  await expect(page.getByTestId('author-run')).toBeEnabled({timeout:250000});
  const error=page.getByTestId('author-error');
  if(await error.count())throw new Error(await error.textContent());
  await expect(page.getByTestId('author-status')).toContainText('Test it with Preview');
}
async function preview(page) {
  await page.getByTestId('author-preview').click();
  await expect(page.getByRole('button',{name:'Back to editing',exact:true})).toBeVisible();
}
async function keyboardInteractions(page) {
  const ui=page.locator('#UI');
  const letters=(await ui.getByRole('button').allTextContents()).map(s=>s.trim()).filter(s=>/^[a-z]$/i.test(s));
  expect(letters.join('').toLowerCase()).toBe('qwertyuiopasdfghjklzxcvbnm');
  for(const c of 'hello world')await ui.getByRole('button',{name:c===' '?'Space':c,exact:true}).click();
  await expect.poll(()=>state(page,'$Display')).toBe('hello world');
  await expect(ui).toContainText('hello world');
  expect(await page.evaluate(()=>window.spoken)).toEqual([]);
  await ui.getByRole('button',{name:'Speak',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.spoken)).toEqual(['hello world']);
  await ui.getByRole('button',{name:'Backspace',exact:true}).click();
  expect(await state(page,'$Display')).toBe('hello worl');
  await ui.getByRole('button',{name:'Clear',exact:true}).click();
  await ui.getByRole('button',{name:'Clear',exact:true}).click();
  await ui.getByRole('button',{name:'Speak',exact:true}).click();
  expect(await state(page,'$Display')).toBe('');
  expect(await page.evaluate(()=>window.spoken)).toEqual(['hello world']);
}
for(const model of models)for(let attempt=1;attempt<=attempts;attempt++) {
  test(`${model} real keyboard ${attempt}`,async({page},testInfo)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const evidence=await start(page,model);
    const original=await snapshot(page);
    let outcome='failed';
    try {
      await generate(page,keyboardPrompt);
      await preview(page);
      await keyboardInteractions(page);
      await page.screenshot({path:testInfo.outputPath('keyboard-desktop.png')});
      await page.setViewportSize({width:1024,height:768});
      await page.screenshot({path:testInfo.outputPath('keyboard-tablet.png')});
      // Round trip the ordinary native archive through the UI file importer.
      await page.getByRole('button',{name:'Back to editing',exact:true}).click();
      const archive=await page.evaluate(async()=>{
        const db=(await import('/OS-DPI-1/db.js')).default;
        return Array.from(new Uint8Array(await(await db.convertDesignToBlob()).arrayBuffer()));
      });
      const before=await snapshot(page);
      await fs.writeFile(testInfo.outputPath('keyboard.osdpi'),Buffer.from(archive));
      await page.getByTestId('author-import').setInputFiles({name:'Live-roundtrip.osdpi',mimeType:'application/octet-stream',buffer:Buffer.from(archive)});
      await page.waitForURL(/#Live-roundtrip/);
      await expect(page.getByTestId('author-run')).toBeVisible();
      const after=await snapshot(page);
      const stripIds=value=>Array.isArray(value)?value.map(stripIds):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='id').map(([k,v])=>[k,stripIds(v)])):value;
      expect(stripIds(after)).toEqual(stripIds(before));
      await page.evaluate(()=>window.spoken=[]);
      await preview(page);
      await keyboardInteractions(page);
      const stored=await page.evaluate(async()=>{
        const db=(await import('/OS-DPI-1/db.js')).default,database=await db.dbPromise;
        return Object.fromEntries((await database.getAllFromIndex('store5','by-name','live-acceptance-original')).map(r=>[r.type,r.data]));
      });
      expect(stripIds(stored)).toEqual(stripIds(original));
      expect(errors).toEqual([]);
      outcome='passed';
    }finally {
      await Promise.allSettled(evidence.pending);
      const data=JSON.stringify({model,attempt,category:'keyboard',outcome,errors,requests:evidence.log},null,2).replaceAll(key,'[redacted]');
      await fs.writeFile(testInfo.outputPath('live-evidence.json'),data);
      await testInfo.attach('live-evidence',{path:testInfo.outputPath('live-evidence.json'),contentType:'application/json'});
    }
  });
}
