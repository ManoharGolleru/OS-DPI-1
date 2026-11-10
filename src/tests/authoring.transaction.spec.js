import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.goto('/OS-DPI-1/tests/authoring.html');
  await page.waitForFunction(()=>!!window.fixture);
});

test('a manual edit during unique-name allocation is preserved and rejects the stale copy',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'Draft' } }] }]);
    f.db.uniqueName=async()=>{await Promise.resolve();f.Globals.layout.uiScale.set(3.2);return 'stale-copy';};
    let error;try{await f.acceptNative(s.snapshot());}catch(e){error=e.message;}
    const database=await f.db.dbPromise;
    return {error,name:f.db.designName,scale:f.Globals.layout.uiScale.value,copies:await database.getAllFromIndex('store5','by-name','stale-copy'),inert:document.body.inert};
  });
  expect(result.error).toContain('manual changes were kept');
  expect(result).toMatchObject({name:'original',scale:3.2,copies:[],inert:false});
});

test('commit blocks native pointer and keyboard edits while copying, then restores focus and input',async({page})=>{
  await page.evaluate(async()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'Draft' } }] }]);
    const database=await f.db.dbPromise;
    let release;const gate=new Promise(resolve=>release=resolve);
    window.releaseCommit=release;window.editEvents=0;
    const input=document.querySelector('[data-testid="author-request"]');input.focus();window.previousFocus=input;
    document.addEventListener('keydown',()=>{window.editEvents++;f.Globals.layout.uiScale.set(3.4);});
    document.addEventListener('click',()=>{window.editEvents++;f.Globals.layout.uiScale.set(3.4);});
    let delayed=false;
    f.db.dbPromise=Promise.resolve(new Proxy(database,{get(target,key){
      if(key==='getAllKeys')return async(...args)=>{if(!delayed){delayed=true;window.awaitingCommit=true;await gate;}return target.getAllKeys(...args);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }}));
    window.commit=f.acceptNative(s.snapshot(),{title:'Locked copy'});
  });
  await page.waitForFunction(()=>window.awaitingCommit);
  await expect(page.locator('body')).toHaveAttribute('inert','');
  await page.keyboard.press('Control+z');
  await page.evaluate(()=>document.querySelector('[data-testid="author-request"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
  expect(await page.evaluate(()=>window.editEvents)).toBe(0);
  const result=await page.evaluate(async()=>{
    window.releaseCommit();await window.commit;
    const f=fixture,database=await f.db.dbPromise;
    const source=await database.get('store5',['original','layout']),copy=await database.get('store5',[f.db.designName,'layout']);
    return {events:window.editEvents,inert:document.body.inert,focused:document.activeElement===window.previousFocus,sourceScale:source.data.props.uiScale,sourceChildren:source.data.children[0].children.length,copyLabel:copy.data.children[0].children[0].props.label};
  });
  expect(result).toMatchObject({events:0,inert:false,focused:true,sourceScale:'1.6',sourceChildren:0,copyLabel:'Draft'});
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>window.editEvents)).toBe(1);
});

test('native writes retain their originating board across an asynchronous name change',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,database=await f.db.dbPromise;
    let release;f.db.dbPromise=new Promise(resolve=>release=resolve);
    const pending=f.db.write('notes',[{label:'Original note'}]);
    f.db.setDesignName('other-board');release(database);await pending;await f.db.settleWrites();
    return {source:(await database.get('store5',['original','notes'])).data,other:await database.get('store5',['other-board','notes']),pending:f.db.pendingWrites.size};
  });
  expect(result.source).toEqual([{label:'Original note'}]);
  expect(result.other).toBeUndefined();expect(result.pending).toBe(0);
});

test('native init Notes writes only the working copy after resources have been copied',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,notes=[{label:'Original note',ID:'source-note'}];
    f.Globals.data.setNoteRows(notes);await f.db.write('notes',notes);
    await f.db.addMedia(new Blob(['resource']),'keep.txt');
    const s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Display', props: { stateName: '$NoteID' } }] },
      {op:'bind',target:'init',rules:[{updates:{$NoteID:"Notes('#label', 'Draft note')"}}]}]);
    const result=await f.acceptNative(s.snapshot(),{title:'Notes copy'}),database=await f.db.dbPromise;
    return {source:(await database.get('store5',['original','notes'])).data,target:(await database.get('store5',[result.name,'notes'])).data,live:f.Globals.data.noteRows,resource:!!await database.get('media',[result.name,'keep.txt'])};
  });
  expect(result.source).toEqual([{label:'Original note',ID:'source-note'}]);
  expect(result.target.map(note=>note.label)).toEqual(['Original note','Draft note']);
  expect(result.live).toEqual(result.target);expect(result.resource).toBe(true);
});

for(const newCopy of [true,false])test(`failed native install restores ${newCopy?'new-copy':'existing-copy'} storage and drains init Notes writes`,async({page})=>{
  const result=await page.evaluate(async newCopy=>{
    const f=fixture,database=await f.db.dbPromise,notes=[{label:'Original note',ID:'source-note'}];
    f.Globals.data.setNoteRows(notes);await f.db.write('notes',notes);
    await f.db.write('custom-section',{untouched:true});
    await database.put('saved',{name:'original',etag:'keep-saved-metadata'});
    await f.db.addMedia(new Blob(['original bytes']),'keep.txt');
    const before=f.fingerprint(f.captureNative()),records=await database.getAllFromIndex('store5','by-name','original');
    f.db.uniqueName=async()=> 'failed-copy';
    const s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'Draft' } }] },{op:'bind',target:'init',rules:[{updates:{$NoteID:"Notes('#label', 'Must roll back')"}}]}]);
    const fromObject=f.TreeBase.fromObject;
    f.TreeBase.fromObject=function(...args){const root=fromObject.apply(this,args);if(args[0].className==='MethodChooser')root.configure=()=>{throw new Error('Synthetic activation failure');};return root;};
    let error;
    try{await f.acceptNative(s.snapshot(),{newCopy});}catch(e){error=e.message;}finally{f.TreeBase.fromObject=fromObject;}
    await f.db.settleWrites();
    return {error,name:f.db.designName,before,after:f.fingerprint(f.captureNative()),records,afterRecords:await database.getAllFromIndex('store5','by-name','original'),saved:await database.get('saved','original'),copy:await database.getAllFromIndex('store5','by-name','failed-copy'),media:await database.getAllKeys('media'),notes:f.Globals.data.noteRows,inert:document.body.inert};
  },newCopy);
  expect(result.error).toBe('Synthetic activation failure');
  expect(result.name).toBe('original');expect(result.after).toBe(result.before);
  expect(result.afterRecords).toEqual(result.records);
  expect(result.saved).toEqual({name:'original',etag:'keep-saved-metadata'});
  expect(result.copy).toEqual([]);expect(result.media).toEqual([['original','keep.txt']]);
  expect(result.notes).toEqual([{label:'Original note',ID:'source-note'}]);expect(result.inert).toBe(false);
});

test('a failed storage transaction never installs the draft or runs its init effects',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,database=await f.db.dbPromise,before=f.fingerprint(f.captureNative());
    const s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'Draft' } }] },{op:'bind',target:'init',rules:[{updates:{$NoteID:"Notes('#label', 'Must not run')"}}]}]);
    f.db.dbPromise=Promise.resolve(new Proxy(database,{get(target,key){
      if(key==='transaction')return (stores,mode,...args)=>{if(mode==='readwrite'&&Array.isArray(stores)&&stores.includes('media'))throw new Error('Synthetic storage failure');return target.transaction(stores,mode,...args);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }}));
    let error;try{await f.acceptNative(s.snapshot());}catch(e){error=e.message;}
    return {error,name:f.db.designName,before,after:f.fingerprint(f.captureNative()),notes:f.Globals.data.noteRows,names:await f.db.names(),inert:document.body.inert};
  });
  expect(result.error).toBe('Synthetic storage failure');expect(result.after).toBe(result.before);
  expect(result).toMatchObject({name:'original',notes:[],names:['original'],inert:false});
});

test('commit restores an already inert body without enabling it',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Display' }] }]);
    document.body.setAttribute('inert','original-lock');
    await f.acceptNative(s.snapshot());
    return document.body.getAttribute('inert');
  });
  expect(result).toBe('original-lock');
});

test('failed init persistence restores live state without replaying the original init action',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,database=await f.db.dbPromise,source=f.documentSession(f.emptyNative());
    source.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Display' }] },{op:'bind',target:'init',rules:[{updates:{$SourceNote:"Notes('#label', 'Original startup')"}}]}]);
    f.installNative(source.snapshot());await f.db.settleWrites();
    await f.persistNative(f.captureNative(),{name:'original'});
    const before=f.fingerprint(f.captureNative()),notes=structuredClone(f.Globals.data.noteRows),states=structuredClone(f.Globals.state.values),records=await database.getAllFromIndex('store5','by-name','original');
    const draft=f.documentSession(f.captureNative());
    draft.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'Draft' } }] },{op:'bind',target:'init',mode:'replace',rules:[{updates:{$NewNote:"Notes('#label', 'Failed startup')"}}]}]);
    f.db.uniqueName=async()=> 'failed-notes';
    f.db.dbPromise=Promise.resolve(new Proxy(database,{get(target,key){
      if(key==='transaction')return (stores,mode,...args)=>{if(mode==='readwrite'&&Array.isArray(stores)&&stores.length===2&&stores.includes('store5')&&stores.includes('saved'))throw new Error('Synthetic Notes write failure');return target.transaction(stores,mode,...args);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }}));
    let error;try{await f.acceptNative(draft.snapshot());}catch(e){error=e.message;}
    return {error,name:f.db.designName,before,after:f.fingerprint(f.captureNative()),notes,afterNotes:f.Globals.data.noteRows,states,afterStates:f.Globals.state.values,records,afterRecords:await database.getAllFromIndex('store5','by-name','original'),copy:await database.getAllFromIndex('store5','by-name','failed-notes'),inert:document.body.inert};
  });
  expect(result.error).toBe('Synthetic Notes write failure');expect(result.name).toBe('original');
  expect(result.after).toBe(result.before);expect(result.afterNotes).toEqual(result.notes);
  expect(result.afterStates).toEqual(result.states);expect(result.afterRecords).toEqual(result.records);
  expect(result.copy).toEqual([]);expect(result.inert).toBe(false);
});

test('a storage rollback failure still restores editor identity, state, metadata and input',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,database=await f.db.dbPromise;
    f.Globals.state.update({$Display:'Keep live text'});
    f.Globals.data.setNoteRows([{ID:'original-note',label:'Keep note'}]);
    await f.db.write('notes',f.Globals.data.noteRows);
    f.db.fileName='original-custom.osdpi';f.db.hasUnsavedChanges=false;
    const before=f.fingerprint(f.captureNative()),states=structuredClone(f.Globals.state.values),notes=structuredClone(f.Globals.data.noteRows),records=await database.getAllFromIndex('store5','by-name','original');
    const draft=f.documentSession(f.emptyNative());
    draft.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'Failed draft' } }] },{op:'bind',target:'init',rules:[{updates:{$NewNote:"Notes('#label', 'Must not remain live')"}}]}]);
    f.db.uniqueName=async()=> 'failed-recovery';
    let storageTransactions=0;
    f.db.dbPromise=Promise.resolve(new Proxy(database,{get(target,key){
      if(key==='transaction')return (stores,mode,...args)=>{
        if(mode==='readwrite'&&Array.isArray(stores)) {
          if(stores.length===2&&stores.includes('store5')&&stores.includes('saved'))throw new Error('Synthetic Notes write failure');
          if(stores.includes('media')&&++storageTransactions>1)throw new Error('Synthetic rollback failure');
        }
        return target.transaction(stores,mode,...args);
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }}));
    let error;try{await f.acceptNative(draft.snapshot());}catch(e){error=e.message;}
    return {error,name:f.db.designName,title:document.title,fileName:f.db.fileName,unsaved:f.db.hasUnsavedChanges,before,after:f.fingerprint(f.captureNative()),states,afterStates:f.Globals.state.values,notes,afterNotes:f.Globals.data.noteRows,records,afterRecords:await database.getAllFromIndex('store5','by-name','original'),inert:document.body.inert};
  });
  expect(result.error).toContain('Synthetic Notes write failure');
  expect(result.error).toContain('saved-design recovery failed: Synthetic rollback failure');
  expect(result).toMatchObject({name:'original',title:'original',fileName:'original-custom.osdpi',unsaved:false,inert:false});
  expect(result.after).toBe(result.before);expect(result.afterStates).toEqual(result.states);
  expect(result.afterNotes).toEqual(result.notes);expect(result.afterRecords).toEqual(result.records);
});

for(const redo of [false,true])test(`${redo?'redo':'undo'} drains pending native writes and blocks manual edits throughout its commit`,async({page})=>{
  await page.evaluate(async redo=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'Working draft' } }] }]);
    const applied=await f.acceptNative(s.snapshot(),{title:'Undo workspace'});
    f.panel.workspaceName=applied.name;f.panel.history=[{before:applied.before,after:applied.after,summary:'Test edit'}];f.panel.top=1;
    if(redo)await f.panel.undo();
    const database=await f.db.dbPromise;
    window.originalRecords=await database.getAllFromIndex('store5','by-name','original');
    const notes=[{ID:'latest-note',label:'Latest manual note'}];f.Globals.data.setNoteRows(notes);
    let release;f.db.dbPromise=new Promise(resolve=>release=()=>resolve(database));
    window.releaseHistoryWrite=release;window.manualHistoryEvents=0;
    document.addEventListener('keydown',()=>{window.manualHistoryEvents++;f.Globals.layout.uiScale.set(3.9);});
    document.addEventListener('click',()=>{window.manualHistoryEvents++;f.Globals.layout.uiScale.set(3.9);});
    window.pendingHistoryWrite=f.db.write('notes',notes);
    window.historyChange=f.panel.undo(redo);
  },redo);
  await expect(page.locator('body')).toHaveAttribute('inert','');
  await page.keyboard.press('Control+z');
  await page.evaluate(()=>document.querySelector('[data-testid="author-request"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
  expect(await page.evaluate(()=>window.manualHistoryEvents)).toBe(0);
  const result=await page.evaluate(async()=>{
    window.releaseHistoryWrite();await window.pendingHistoryWrite;await window.historyChange;
    const f=fixture,database=await f.db.dbPromise;
    return {top:f.panel.top,error:f.panel.error,busy:f.panel.busy,inert:document.body.inert,events:window.manualHistoryEvents,children:f.Globals.layout.children[0].children.length,
      liveNotes:f.Globals.data.noteRows,savedNotes:(await database.get('store5',[f.db.designName,'notes'])).data,original:window.originalRecords,afterOriginal:await database.getAllFromIndex('store5','by-name','original')};
  });
  expect(result).toMatchObject({top:redo?1:0,error:'',busy:false,inert:false,events:0,children:redo?1:0});
  expect(result.savedNotes).toEqual([{ID:'latest-note',label:'Latest manual note'}]);
  expect(result.liveNotes).toEqual(result.savedNotes);expect(result.afterOriginal).toEqual(result.original);
});

test('failed undo storage keeps the working draft and its history position intact',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Button', props: { label: 'Keep working draft' } }] }]);
    const applied=await f.acceptNative(s.snapshot(),{title:'Undo failure workspace'});
    f.panel.workspaceName=applied.name;f.panel.history=[{before:applied.before,after:applied.after,summary:'Test edit'}];f.panel.top=1;
    const database=await f.db.dbPromise,before=f.fingerprint(f.captureNative()),records=await database.getAllFromIndex('store5','by-name',applied.name);
    f.db.dbPromise=Promise.resolve(new Proxy(database,{get(target,key){
      if(key==='transaction')return (stores,mode,...args)=>{if(mode==='readwrite'&&Array.isArray(stores)&&stores.includes('media'))throw new Error('Synthetic undo storage failure');return target.transaction(stores,mode,...args);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }}));
    await f.panel.undo();
    return {before,after:f.fingerprint(f.captureNative()),records,afterRecords:await database.getAllFromIndex('store5','by-name',applied.name),top:f.panel.top,error:f.panel.error,busy:f.panel.busy,inert:document.body.inert,name:f.db.designName,expectedName:applied.name};
  });
  expect(result.error).toBe('Synthetic undo storage failure');expect(result.top).toBe(1);
  expect(result.after).toBe(result.before);expect(result.afterRecords).toEqual(result.records);
  expect(result.name).toBe(result.expectedName);expect(result.busy).toBe(false);expect(result.inert).toBe(false);
});
