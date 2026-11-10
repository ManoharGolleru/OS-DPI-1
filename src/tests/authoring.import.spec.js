import {commandReply} from "./structured-reply.js";
import {test,expect} from '@playwright/test';

async function archive(page,label='Imported board',effects=true){
  return Buffer.from(await page.evaluate(({label,effects})=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{op:'insert',parent:'page',nodes:[{className:'Button',ref:'remote',props:{name:'remote',label}}]},
      ...(effects?[{op:'bind',target:'remote',rules:[{updates:{$Remote:"load_design('https://example.invalid/board.osdpi')"}}]}]:[])]);
    const entries=Object.fromEntries(Object.entries(s.snapshot()).map(([section,data])=>[section+'.json',f.strToU8(JSON.stringify(data))]));
    entries['notes.json']=f.strToU8(JSON.stringify([{ID:'imported-note',label:'Imported note'}]));
    entries['resource.txt']=f.strToU8('Imported resource');
    return Array.from(f.zipSync(entries));
  },{label,effects}));
}

test.describe('inline import and new-board transactions',()=>{
  test.beforeEach(async({page})=>{
    await page.goto('/OS-DPI-1/tests/authoring.html');
    await page.waitForFunction(()=>!!window.fixture);
  });

  test('effectful archive is reviewed inline without saving or opening a browser dialog; cancel is inert',async({page})=>{
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    const before=await page.evaluate(async()=>{
      const f=fixture,database=await f.db.dbPromise;
      return {records:await database.getAll('store5'),saved:await database.getAll('saved'),media:await database.getAllKeys('media'),live:f.fingerprint(f.captureNative()),hash:location.hash};
    });
    await page.getByTestId('author-import').setInputFiles({name:'original.osdpi',mimeType:'application/zip',buffer:await archive(page)});
    await expect(page.getByTestId('author-import-review')).toBeVisible();
    const pending=await page.evaluate(async()=>{
      const f=fixture,database=await f.db.dbPromise;
      return {records:await database.getAll('store5'),saved:await database.getAll('saved'),media:await database.getAllKeys('media'),live:f.fingerprint(f.captureNative()),hash:location.hash};
    });
    expect(pending).toEqual(before);expect(dialogs).toEqual([]);
    await page.getByTestId('author-import-cancel').click();
    await expect(page.getByTestId('author-import-review')).toHaveCount(0);
    const after=await page.evaluate(async()=>({name:fixture.db.designName,names:await fixture.db.names(),pending:fixture.panel.pendingImport,hash:location.hash,live:fixture.fingerprint(fixture.captureNative())}));
    expect(after).toMatchObject({name:'original',names:['original'],pending:null,hash:before.hash,live:before.live});
  });

  test('approved import uses a separate name and waits for manual source writes while retaining archive notes and media',async({page})=>{
    await page.getByTestId('author-import').setInputFiles({name:'original.osdpi',mimeType:'application/zip',buffer:await archive(page)});
    await expect(page.getByTestId('author-import-review')).toBeVisible();
    await page.evaluate(async()=>{
      const f=fixture,database=await f.db.dbPromise;
      window.sourceLayout=await database.get('store5',['original','layout']);
      let release;f.db.dbPromise=new Promise(resolve=>release=()=>resolve(database));window.releaseImportWrite=release;
      f.Globals.data.setNoteRows([{ID:'manual-note',label:'Manual note while reviewing'}]);
      window.manualImportWrite=f.db.write('notes',f.Globals.data.noteRows);
    });
    await page.getByTestId('author-import-confirm').click();
    expect(await page.evaluate(()=>({hash:location.hash,busy:fixture.panel.busy}))).toEqual({hash:'',busy:true});
    await page.evaluate(async()=>{window.releaseImportWrite();await window.manualImportWrite;});
    await page.waitForFunction(()=>!fixture.panel.busy);
    const result=await page.evaluate(async()=>{
      const f=fixture,database=await f.db.dbPromise,name=decodeURIComponent(location.hash.slice(1));
      return {name,current:f.db.designName,pending:f.panel.pendingImport,names:await f.db.names(),
        sourceLayout:await database.get('store5',['original','layout']),beforeLayout:window.sourceLayout,
        sourceNotes:(await database.get('store5',['original','notes'])).data,
        importedNotes:(await database.get('store5',[name,'notes'])).data,
        importedLabel:(await database.get('store5',[name,'layout'])).data.children[0].children[0].props.label,
        resource:await (await database.get('media',[name,'resource.txt'])).content.text()};
    });
    expect(result).toMatchObject({name:'original-1',current:'original',pending:null,names:['original','original-1'],importedLabel:'Imported board',resource:'Imported resource'});
    expect(result.sourceLayout).toEqual(result.beforeLayout);
    expect(result.sourceNotes).toEqual([{ID:'manual-note',label:'Manual note while reviewing'}]);
    expect(result.importedNotes).toEqual([{ID:'imported-note',label:'Imported note'}]);
  });

  test('selecting another file replaces the pending review, and a plain native file imports without a dialog',async({page})=>{
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.getByTestId('author-import').setInputFiles({name:'first.osdpi',mimeType:'application/zip',buffer:await archive(page,'First')});
    await expect(page.getByTestId('author-import-review')).toContainText('first.osdpi');
    await page.getByTestId('author-import').setInputFiles({name:'second.osdpi',mimeType:'application/zip',buffer:await archive(page,'Second')});
    await expect(page.getByTestId('author-import-review')).toContainText('second.osdpi');
    await page.getByTestId('author-import-confirm').click();
    await page.waitForFunction(()=>!fixture.panel.busy);
    expect(await page.evaluate(()=>fixture.db.names())).toEqual(['original','second']);
    await page.getByTestId('author-import').setInputFiles({name:'plain.osdpi',mimeType:'application/zip',buffer:await archive(page,'Plain',false)});
    await page.waitForFunction(()=>!fixture.panel.busy);
    expect(await page.evaluate(()=>location.hash)).toBe('#plain');
    await expect(page.getByTestId('author-import-review')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('new blank mode preserves the previous working copy and starts a separate history without sending old requests',async({page})=>{
    const before=await page.evaluate(async()=>{
      const f=fixture,s=f.documentSession(f.emptyNative());
      s.edit([{op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Old'}}]}]);
      const applied=await f.acceptNative(s.snapshot(),{title:'Prior working copy'});
      f.panel.workspaceName=applied.name;f.panel.originalName='original';
      f.panel.history=[{before:applied.before,after:applied.after,summary:'Old board edit'}];f.panel.top=1;
      f.panel.summaries=[{request:'OLD_REQUEST_DO_NOT_SEND',changes:'Previous board only'}];
      await f.db.write('notes',[{ID:'prior-note',label:'Prior board note'}]);
      const database=await f.db.dbPromise;
      return {name:applied.name,records:await database.getAllFromIndex('store5','by-name',applied.name),original:await database.getAllFromIndex('store5','by-name','original')};
    });
    const requests=[];
    // Deterministic protocol fixture only for panel copy/history semantics;
    // this test does not count as real provider acceptance.
    await page.route('https://api.groq.com/**',async route=>{
      requests.push(route.request().postDataJSON());
      await route.fulfill({headers:{'x-ratelimit-remaining-tokens':'99999'},json:commandReply('edit',{operations:[{op:'insert',parent:'page',nodes:[{className:'Display',props:{stateName:'$Fresh'}}]}],title:'Fresh board',summary:'Created a fresh display.'})});
    });
    await page.getByTestId('author-mode').selectOption('new');
    await page.getByTestId('author-request').fill('Create a blank message display.');
    await page.getByTestId('author-run').click();
    await page.waitForFunction(()=>!fixture.panel.busy);
    const result=await page.evaluate(async prior=>{
      const f=fixture,database=await f.db.dbPromise;
      return {name:f.db.designName,originalName:f.panel.originalName,error:f.panel.error,history:f.panel.history.length,top:f.panel.top,summaries:f.panel.summaries,
        undoBaseline:f.fingerprint(f.panel.history[0].before),empty:f.fingerprint(f.emptyNative()),
        previous:await database.getAllFromIndex('store5','by-name',prior),original:await database.getAllFromIndex('store5','by-name','original'),stateName:f.captureNative().layout.children[0].children[0].props.stateName};
    },before.name);
    expect(result.error).toBe('');expect(result.name).not.toBe(before.name);
    expect(result).toMatchObject({originalName:before.name,history:1,top:1,stateName:'$Fresh'});
    expect(result.undoBaseline).toBe(result.empty);
    expect(result.previous).toEqual(before.records);expect(result.original).toEqual(before.original);
    expect(result.summaries).toEqual([{request:'Create a blank message display.',changes:'Created a fresh display.'}]);
    expect(requests).toHaveLength(1);expect(JSON.stringify(requests)).not.toContain('OLD_REQUEST_DO_NOT_SEND');
    await page.getByTestId('author-undo').click();
    await page.waitForFunction(()=>!fixture.panel.busy);
    const undone=await page.evaluate(async prior=>{
      const f=fixture,database=await f.db.dbPromise;
      return {name:f.db.designName,children:f.captureNative().layout.children[0].children.length,
        previous:await database.getAllFromIndex('store5','by-name',prior)};
    },before.name);
    expect(undone.name).toBe(result.name);expect(undone.children).toBe(0);
    expect(undone.previous).toEqual(before.records);
    await page.getByTestId('author-redo').click();
    await page.waitForFunction(()=>!fixture.panel.busy);
    expect(await page.evaluate(()=>fixture.captureNative().layout.children[0].children[0].props.stateName)).toBe('$Fresh');
  });

  test('failed separate-copy acceptance keeps the previous board identity and history',async({page})=>{
    const result=await page.evaluate(async()=>{
      const f=fixture,before=f.captureNative();
      f.panel.workspaceName=f.db.designName;f.panel.originalName='Earlier source';
      f.panel.history=[{before,after:before,summary:'Keep this entry'}];f.panel.top=1;
      f.panel.summaries=[{request:'Keep this request',changes:'Keep these changes'}];
      const history=structuredClone(f.panel.history),summaries=structuredClone(f.panel.summaries);
      f.db.uniqueName=async()=>{throw new Error('Synthetic name allocation failure');};
      let error;try{await f.panel.apply({mode:'new',name:f.db.designName,version:f.fingerprint(before),design:f.emptyNative(),title:'New board'});}catch(e){error=e.message;}
      return {error,name:f.db.designName,workspace:f.panel.workspaceName,original:f.panel.originalName,top:f.panel.top,history,summaries,afterHistory:f.panel.history,afterSummaries:f.panel.summaries};
    });
    expect(result).toMatchObject({error:'Synthetic name allocation failure',name:'original',workspace:'original',original:'Earlier source',top:1});
    expect(result.afterHistory).toEqual(result.history);expect(result.afterSummaries).toEqual(result.summaries);
  });

  test('non-voice edits retain distinct speech and cue voices by identity or replacement state',async({page})=>{
    const result=await page.evaluate(async()=>{
      const {preserveNativeVoices}=await import('/OS-DPI-1/components/ai/authoring-panel.js');
      const f=fixture,original=f.emptyNative();
      original.layout.children[0].children=[
        {className:'Speech',id:'primary',props:{stateName:'$Primary',voiceURI:'voice-alpha'},children:[]},
        {className:'Speech',id:'secondary',props:{stateName:'$Secondary',voiceURI:'voice-beta'},children:[]},
      ];
      original.cues.children[0].props.voiceURI='cue-voice';
      original.cues.children[1].props.voiceURI='';
      const before=f.fingerprint(original),results=[];
      for(const request of ['Change the colors and speech rate.','Change the voice rate to 0.8.','Keep the voice but change the color.','Preserve the voice and increase its rate.','Do not change the voice; make the buttons blue.']){
        const draft=structuredClone(original),speech=draft.layout.children[0].children;
        speech[0].props.stateName='$Renamed'; // Stable native identity wins.
        delete speech[1].id; // Replacement retains the second state's voice.
        speech.push({className:'Speech',props:{stateName:'$New',voiceURI:'invented-new-voice'},children:[]});
        for(const n of speech)n.props.voiceURI='invented-voice';
        for(const n of draft.cues.children)n.props.voiceURI='invented-cue-voice';
        preserveNativeVoices(original,draft,request);
        results.push({speech:speech.map(n=>n.props.voiceURI),cues:draft.cues.children.map(n=>n.props.voiceURI)});
      }
      return {results,before,after:f.fingerprint(original)};
    });
    expect(result.after).toBe(result.before);
    for(const row of result.results){expect(row.speech).toEqual(['voice-alpha','voice-beta','voice-alpha']);expect(row.cues).toEqual(['cue-voice','','','']);}
  });

  test('explicit voice, accent or speaker changes remain permitted',async({page})=>{
    const result=await page.evaluate(async()=>{
      const {preserveNativeVoices}=await import('/OS-DPI-1/components/ai/authoring-panel.js');
      const original=fixture.emptyNative();
      original.layout.children[0].children=[{className:'Speech',id:'speech',props:{stateName:'$Speak',voiceURI:'before'},children:[]}];
      original.cues.children[0].props.voiceURI='cue-before';
      return ['Change the voice to Alice.','Switch to a British voice.','Set the accent to British.','Choose a different speaker.'].map(request=>{
        const draft=structuredClone(original);draft.layout.children[0].children[0].props.voiceURI='requested-voice';draft.cues.children[0].props.voiceURI='requested-cue';
        preserveNativeVoices(original,draft,request);
        return [draft.layout.children[0].children[0].props.voiceURI,draft.cues.children[0].props.voiceURI];
      });
    });
    expect(result).toEqual(Array(4).fill(['requested-voice','requested-cue']));
  });

  test('panel application preserves imported voice choices despite invented nonempty voices in a rate/color edit',async({page})=>{
    const ids=await page.evaluate(async()=>{
      const f=fixture,s=f.documentSession(f.emptyNative());
      s.edit([{op:'insert',parent:'page',nodes:[{className:'Display'},
        {className:'Speech',props:{stateName:'$Primary',voiceURI:'voice-alpha'}},
        {className:'Speech',props:{stateName:'$Secondary',voiceURI:'voice-beta'}}]}]);
      const design=s.snapshot();design.cues.children[0].props.voiceURI='cue-voice';
      f.installNative(design);await f.persistNative(f.captureNative(),{name:'original'});
      const source=f.captureNative();
      return {speeches:source.layout.children[0].children.filter(n=>n.className==='Speech').map(n=>n.id),cue:source.cues.children[0].id};
    });
    await page.route('https://api.groq.com/**',async route=>route.fulfill({headers:{'x-ratelimit-remaining-tokens':'99999'},json:commandReply('edit',{operations:[
        ...ids.speeches.map(target=>({op:'update',target,props:{voiceURI:'invented-voice',rate:0.8}})),
        {op:'update',target:ids.cue,props:{voiceURI:'invented-cue',Color:'blue'}},
        {op:'insert',parent:'page',nodes:[{className:'Speech',props:{stateName:'$Added',voiceURI:'invented-new-voice'}}]},
      ],summary:'Updated colors and rate.'})}));
    await page.getByTestId('author-request').fill('Change the cue color to blue and the speech rate to 0.8. Keep the voice.');
    await page.getByTestId('author-run').click();await page.waitForFunction(()=>!fixture.panel.busy);
    const result=await page.evaluate(()=>{
      const design=fixture.captureNative();return {error:fixture.panel.error,speech:design.layout.children[0].children.filter(n=>n.className==='Speech').map(n=>({voice:n.props.voiceURI,rate:n.props.rate})),cue:design.cues.children[0].props};
    });
    expect(result.error).toBe('');expect(result.speech.map(n=>n.voice)).toEqual(['voice-alpha','voice-beta','voice-alpha']);
    expect(result.speech.slice(0,2).map(n=>Number(n.rate))).toEqual([0.8,0.8]);
    expect(result.cue).toMatchObject({voiceURI:'cue-voice',Color:'blue'});
  });
});

test('development runner loads without storage writes and refuses a write transaction before any real request',async({page})=>{
  // A fresh Playwright context initializes the ordinary application's DB. Do not
  // load authoring-harness here: it deliberately replaces a saved key for tests.
  await page.goto('/OS-DPI-1/');
  await page.evaluate(async()=>{const {default:db}=await import('/OS-DPI-1/db.js');await db.dbPromise;await db.settleWrites();});
  const before=await page.evaluate(async()=>{const {default:db}=await import('/OS-DPI-1/db.js');return (await db.dbPromise).getAll('store5');});
  await page.addInitScript(()=>{
    window.benchmarkStorageWrites=[];
    const setItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(name,value){window.benchmarkStorageWrites.push(name);return setItem.call(this,name,value);};
  });
  const requests=[];page.on('request',request=>{if(request.url().startsWith('https://api.groq.com/'))requests.push(request.url());});
  await page.goto('/OS-DPI-1/tests/live-benchmark/');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#status')).toContainText('Ready.');
  const result=await page.evaluate(async()=>{
    const {default:db}=await import('/OS-DPI-1/db.js'),database=await db.dbPromise;
    let error;try{database.transaction('store5','readwrite');}catch(e){error=e.message;}
    return {error,records:await database.getAll('store5'),storageWrites:window.benchmarkStorageWrites,name:db.designName};
  });
  expect(result.error).toContain('cannot write IndexedDB');expect(result.records).toEqual(before);
  expect(result.storageWrites).toEqual([]);expect(result.name).toBe('');expect(requests).toEqual([]);
});
