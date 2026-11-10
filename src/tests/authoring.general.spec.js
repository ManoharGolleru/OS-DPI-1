import {test,expect} from '@playwright/test';

// These are deterministic native-runtime regressions, not provider-quality tests.
test.beforeEach(async({page})=>{
  await page.goto('/OS-DPI-1/tests/authoring.html');
  await page.waitForFunction(()=>!!window.fixture);
});
async function preview(page) {
  await page.evaluate(()=>fixture.Globals.state.update({editing:false}));
  await expect(page.locator('body')).not.toHaveClass(/designing/);
}

test('real local-model quoted color mistake is rejected by the native color validator before staging',async({page})=>{
  const result=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative()),before=f.fingerprint(s.snapshot());
    let error;try{s.edit([{op:'insert',parent:'page',nodes:[{className:'Grid',props:{background:"'lightgreen'"}}]}]);}catch(e){error=e.message;}
    const unchanged=f.fingerprint(s.snapshot())===before;
    s.edit([{op:'insert',parent:'page',nodes:[{className:'Grid',ref:'valid',props:{background:'lightgreen'}}]},{op:'rows',rows:[{label:'Color check'}]}]);
    f.installNative(s.snapshot());return {error,unchanged};
  });
  expect(result.error).toContain('Invalid native color');expect(result.unchanged).toBe(true);
  await preview(page);
  await expect(page.locator('#UI').getByRole('button',{name:'Color check',exact:true})).toHaveCSS('background-color','rgb(144, 238, 144)');
});

test('display-only native authoring produces ordinary Preview output',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    const operations=[
      { op: 'insert', parent: 'page', nodes: [{ className: 'Display', ref: 'welcome', props: { stateName: '$Greeting' } }] },
      {op:'bind',target:'init',rules:[{updates:{$Greeting:"'Welcome to class'"}}]},
    ];
    s.edit(operations);
    const review=f.reviewNativePresentation(s);
    f.installNative(s.snapshot());
    return review;
  });
  expect(result.ok).toBe(true);
  expect(result.summary.displays).toBe(1);
  await preview(page);
  await expect(page.locator('#UI .display')).toContainText('Welcome to class');
});

test('native state filters and conditional action metadata agree with Preview',async({page})=>{
  const result=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([
      {op:'insert',parent:'page',nodes:[
        {className:'Grid',ref:'food',props:{rows:1,columns:2,tone:'Calm'},children:[{className:'GridFilter',props:{field:'#category',operator:'equals',value:'$Category'}}]},
        {className:'Display',props:{stateName:'$Result'}},
      ]},
      { op: "rows", rows: [{ label: 'Bread', category: 'FOOD' }, { label: 'Water', category: 'drink' }] },
      {op:'bind',target:'init',rules:[{updates:{$Category:"'food'",$Result:"''"}}]},
      {op:'bind',target:'food',rules:[
        {condition:"#ComponentName = 'food' && #ComponentType = 'Grid' && #GridTone = 'Calm'",updates:{$Result:'add_word(#label)'}},
        {updates:{$Result:"'Wrong rule'"}},
      ]},
    ]);
    const review=f.reviewNativePresentation(s),checks=f.exercise(s,[{steps:[{target:'food',label:'Bread'}],expect:{$Result:'Bread '}}]);
    f.installNative(s.snapshot());
    return {review,checks};
  });
  expect(result.review.ok).toBe(true);
  expect(result.review.summary.populatedGrids).toBe(1);
  expect(result.checks[0].ok).toBe(true);
  await preview(page);
  await expect(page.locator('#UI').getByRole('button',{name:'Water',exact:true})).toHaveCount(0);
  await page.locator('#UI').getByRole('button',{name:'Bread',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Result'))).toBe('Bread ');
});

test('duplicate updates use native last-value and reducer semantics',async({page})=>{
  const result=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([
      { op: 'insert', parent: 'page', nodes: [{ className: 'Button', ref: 'score', props: { label: 'Score' } }] },
      {op:'bind',target:'init',rules:[{updates:{$Score:'0'}}]},
      { op: 'insert', parent: 'actions', nodes: [{ className: 'Action', props: { origin: 'score' }, children: [
                { className: 'ActionCondition', props: { Condition: "#name = 'score' && #ComponentName = 'score' && #ComponentType = 'Button'" } },
                { className: 'ActionUpdate', props: { stateName: '$Score', newValue: 'increment(1)' } },
                { className: 'ActionUpdate', props: { stateName: '$Score', newValue: 'increment(4)' } },
            ] }] },
    ]);
    const checks=f.exercise(s,[{steps:[{target:'score'},{target:'score'}],expect:{$Score:8}}]);
    const wildcard=f.documentSession(f.emptyNative());
    wildcard.edit([{ op: 'insert', parent: 'actions', nodes: [{ className: 'Action', props: { origin: '*' }, children: [{ className: 'ActionUpdate', props: { stateName: '$Score', newValue: 'increment(2)' } }] }] }]);
    const startup=f.exercise(wildcard,[{steps:[],expect:{$Score:2}}]);
    f.installNative(wildcard.snapshot());
    const nativeStartup=f.Globals.state.get('$Score');
    f.installNative(s.snapshot());
    return {checks,startup,nativeStartup};
  });
  expect(result.checks[0].ok).toBe(true);
  expect(result.startup[0].ok).toBe(true);
  expect(result.nativeStartup).toBe(2);
  await preview(page);
  await page.locator('#UI').getByRole('button',{name:'Score',exact:true}).click();
  await page.locator('#UI').getByRole('button',{name:'Score',exact:true}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get('$Score'))).toBe(8);
});

test('native tabs and Radio activate in Preview and preserve notes and voice',async({page})=>{
  const result=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    f.Globals.data.setNoteRows([{label:'Keep this note',ID:'saved-note'}]);
    s.edit([{op:'insert',parent:'page',nodes:[
      {className:'Speech',props:{stateName:'$ImportedVoice',voiceURI:'saved-device-voice'}},
      {className:'TabControl',ref:'tabs',props:{stateName:'$View'},children:[
        {className:'TabPanel',ref:'choices',props:{name:'choices',label:'Choices'},children:[
          {className:'Radio',ref:'category',props:{stateName:'$Category',label:'Category'},children:[
            {className:'Option',props:{name:'Food',value:'food'}},
            {className:'Option',props:{name:'Drink',value:'drink'}},
          ]},
          {className:'Grid',ref:'words',props:{rows:1,columns:2},children:[{className:'GridFilter',props:{field:'#category',operator:'equals',value:'$Category'}}]},
        ]},
        {className:'TabPanel',ref:'scorePanel',props:{name:'scorePanel',label:'Score'},children:[{className:'Display',props:{stateName:'$Score'}}]},
      ]},
    ]},{ op: "rows", rows: [{ label: 'Bread', category: 'food' }, { label: 'Water', category: 'drink' }] },
    {op:'bind',target:'init',rules:[{updates:{$Score:'7'}}]},
    {op:'bind',target:'words',rules:[{updates:{$ImportedVoice:'#label'}}]}]);
    const review=f.reviewNativePresentation(s);
    const unsupported=f.exercise(s,[{steps:[{target:'tabs',label:'Score'}],expect:{$View:'scorePanel'}},{steps:[{target:'category',label:'Drink'}],expect:{$Category:'drink'}}]);
    f.installNative(s.snapshot());
    // A generic targeted change must leave voice choice and notes intact.
    const edit=f.documentSession(f.captureNative());
    const grid=f.walk(edit.design.layout).find(n=>n.className==='Grid');
    edit.edit([{op:'update',target:grid._ref,props:{buttonColor:'#ddeeff'}}]);
    f.installNative(edit.snapshot());
    return {review,unsupported,notes:f.Globals.data.noteRows,voices:f.walk(f.captureNative().layout).filter(n=>n.className==='Speech').map(n=>n.props)};
  });
  expect(result.review.ok).toBe(true);
  expect(result.review.summary).toMatchObject({radioOptions:2,tabButtons:2,populatedGrids:1,displays:0});
  expect(result.unsupported.every(check=>!check.ok&&check.error.includes('Preview'))).toBe(true);
  expect(result.notes).toEqual([{label:'Keep this note',ID:'saved-note'}]);
  expect(result.voices[0]).toMatchObject({stateName:'$ImportedVoice',voiceURI:'saved-device-voice'});
  await preview(page);
  await expect(page.locator('#UI').getByRole('button',{name:'Bread',exact:true})).toBeVisible();
  await page.locator('#UI').getByRole('button',{name:'Drink',exact:true}).click();
  await expect(page.locator('#UI').getByRole('button',{name:'Water',exact:true})).toBeVisible();
  await page.locator('#UI').getByRole('button',{name:'Water',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.spoken)).toEqual(['Water']);
  await page.locator('#UI').getByRole('button',{name:'Score',exact:true}).click();
  await expect(page.locator('#UI .display')).toContainText('7');
  await expect(page.locator('#UI').getByRole('button',{name:'Water',exact:true})).toHaveCount(0);
});

test('surface checks reject empty, hidden and filtered-away output without replaying imported init on edits',async({page})=>{
  const results=await page.evaluate(()=>{
    const f=fixture;
    const review=nodes=>{const s=f.documentSession(f.emptyNative());s.edit([{op:'insert',parent:'page',nodes}]);return f.reviewNativePresentation(s);};
    const emptyRadio=review([{className:'Radio'}]);
    const hiddenDisplay=review([{className:'Display',props:{scale:0}}]);
    const hiddenTab=review([{className:'TabControl',props:{tabEdge:'none'},children:[{className:'TabPanel',props:{name:'empty'}},{className:'TabPanel',props:{name:'hidden'},children:[{className:'Display'}]}]}]);
    const filtered=f.documentSession(f.emptyNative());
    filtered.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Grid', children: [{ className: 'GridFilter', props: { operator: 'only first', value: '0' } }] }] },{ op: "rows", rows: Array.from(['Hidden'], label => ({ label })) }]);
    const imported=f.emptyNative();
    imported.actions.children.push(f.node('Action',{origin:'init'},[f.node('ActionUpdate',{stateName:'$External',newValue:'open_editor()'})]));
    return {emptyRadio,hiddenDisplay,hiddenTab,filtered:f.reviewNativePresentation(filtered),imported:f.reviewNativePresentation(f.documentSession(imported),{requireVisible:false}),functions:f.nativeExpressionReference()};
  });
  expect(results.emptyRadio.ok).toBe(false);
  expect(results.hiddenDisplay.ok).toBe(false);
  expect(results.hiddenTab.ok).toBe(false);
  expect(results.filtered.ok).toBe(false);
  expect(results.imported.ok).toBe(true);
  expect(results.functions.available).toEqual(expect.arrayContaining(['increment','add_word','replace_last_letter']));
  expect(results.functions.available).not.toContain('remove_last_letter');
});

test('native overlay status pieces are recognized where the layout renders them',async({page})=>{
  const result=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([
      {op:'update',target:'page',props:{columns:1}},
      { op: 'insert', parent: 'page', nodes: [{ className: 'Indicator' }] },
      {op:'bind',target:'init',rules:[{updates:{$asr_status:"'on'",$locationTracking:'1',$socketStatus:"'connected'"}}]},
    ]);
    const review=f.reviewNativePresentation(s);
    f.installNative(s.snapshot());
    return review;
  });
  expect(result.ok).toBe(true);
  expect(result.summary.indicators).toBe(1);
  await preview(page);
  await expect(page.locator('#indicator-bar .asr-indicator')).toBeVisible();
  await expect(page.locator('#indicator-bar .asr-indicator')).toHaveAttribute('active','');
  await expect(page.locator('#indicator-bar .socket-indicator')).toHaveAttribute('connected','');
});

test('independent new TabControls keep their own native selection state in Preview',async({page})=>{
  const states=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative());
    s.edit([{op:'insert',parent:'page',nodes:[
      {className:'TabControl',ref:'leftTabs',children:[
        {className:'TabPanel',props:{name:'leftOne',label:'Left one'},children:[{className:'Button',props:{label:'First left'}}]},
        {className:'TabPanel',props:{name:'leftTwo',label:'Left two'},children:[{className:'Button',props:{label:'Second left'}}]},
      ]},
      {className:'TabControl',ref:'rightTabs',children:[
        {className:'TabPanel',props:{name:'rightOne',label:'Right one'},children:[{className:'Button',props:{label:'First right'}}]},
        {className:'TabPanel',props:{name:'rightTwo',label:'Right two'},children:[{className:'Button',props:{label:'Second right'}}]},
      ]},
    ]}]);
    const states=[s.find('leftTabs').props.stateName,s.find('rightTabs').props.stateName];
    f.installNative(s.snapshot());return states;
  });
  expect(states).toEqual(['$leftTabs','$rightTabs']);
  await preview(page);
  const ui=page.locator('#UI');
  await expect(ui.getByRole('button',{name:'First left',exact:true})).toBeVisible();
  await expect(ui.getByRole('button',{name:'First right',exact:true})).toBeVisible();
  await ui.getByRole('button',{name:'Left two',exact:true}).click();
  await expect(ui.getByRole('button',{name:'Second left',exact:true})).toBeVisible();
  await expect(ui.getByRole('button',{name:'First right',exact:true})).toBeVisible();
  await ui.getByRole('button',{name:'Right two',exact:true}).click();
  await expect(ui.getByRole('button',{name:'Second left',exact:true})).toBeVisible();
  await expect(ui.getByRole('button',{name:'Second right',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>[fixture.Globals.state.get('$leftTabs'),fixture.Globals.state.get('$rightTabs')])).toEqual(['leftTwo','rightTwo']);
});

test('real native expression metadata rejects numeric initialization before accepting any edits',async({page})=>{
  const result=await page.evaluate(()=>{
    const f=fixture,s=f.documentSession(f.emptyNative()),before=f.fingerprint(s.snapshot());
    let error;
    try{s.edit([{ op: 'insert', parent: 'page', nodes: [{ className: 'Display', props: { stateName: '$Score' } }] },{op:'bind',target:'init',rules:[{updates:{$Score:0}}]}]);}
    catch(e){error=e.message;}
    return {error,before,after:f.fingerprint(s.snapshot()),changes:s.changes};
  });
  expect(result.error).toContain("Expression 'newValue' must be a string");
  expect(result.after).toBe(result.before);expect(result.changes).toEqual([]);
});
