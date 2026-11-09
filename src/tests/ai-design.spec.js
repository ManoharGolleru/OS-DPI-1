import {test, expect} from "@playwright/test";

async function setup(page, editCommands=[{op:"create_keyboard",target:"pointer",text:null,value:false,items:[]}]) {
  const errors=[],calls=[];
  page.on("pageerror",e=>{errors.push(e.message); console.error("Browser:",e.stack||e.message);});
  page.on("console",m=>{if(m.type()==="error")console.error("Console:",m.text());});
  await page.route("https://api.groq.com/**",async route=>{
    calls.push(route.request().postDataJSON());
    await route.fulfill({json:{choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      summary:"Prepared a native keyboard",operations:editCommands,
    })}}],usage:{total_tokens:850}}});
  });
  await page.goto("/OS-DPI-1/tests/ai-design-browser.html");
  try{await page.waitForFunction(()=>!!window.fixture,null,{timeout:12000});}
  catch{throw new Error("Fixture unavailable: "+errors.join("; "));}
  return {errors,calls};
}

async function makeKeyboard(page) {
  await page.getByTestId("design-keyboard").click();
  await expect(page.getByTestId("design-draft")).toBeVisible();
  await expect(page.frameLocator('[data-testid="design-preview"]').locator("#UI button").first()).toBeVisible();
}

test("local QWERTY keyboard creates native draft without API use",async({page})=>{
  const {calls,errors}=await setup(page);
  const original=await page.evaluate(()=>JSON.stringify(fixture.captureDesign()));
  await makeKeyboard(page);
  const output=await page.evaluate(()=>({
    letters:fixture.panel.draft.design.content.map(x=>x.label).join(""),
    label:fixture.panel.draft.title,
    original:JSON.stringify(fixture.captureDesign()),
  }));
  expect(output.letters).toBe("QWERTYUIOPASDFGHJKLZXCVBNM");
  expect(output.original).toBe(original);
  expect(calls).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("native keyboard preview types and clears a complete message",async({page})=>{
  const {errors}=await setup(page);
  await makeKeyboard(page);
  const frame=page.frameLocator('[data-testid="design-preview"]');
  for(const c of "HELLO"){
    await frame.getByRole("button",{name:c,exact:true}).click();
  }
  await frame.getByRole("button",{name:"Space",exact:true}).click();
  for(const c of "WORLD"){
    await frame.getByRole("button",{name:c,exact:true}).click();
  }
  await expect(page.getByTestId("design-preview-text")).toContainText("hello world");
  await frame.getByRole("button",{name:"Speak",exact:true}).click();
  await expect(page.getByTestId("design-preview-text")).toContainText("Last speech: hello world");
  await frame.getByRole("button",{name:"Clear",exact:true}).click();
  await expect(page.getByTestId("design-preview-text")).toContainText("Preview display: .");
  expect(errors).toEqual([]);
});

test("Groq chooses strict editing operations and does not alter the open board",async({page})=>{
  const {calls,errors}=await setup(page);
  const original=await page.evaluate(()=>JSON.stringify(fixture.captureDesign()));
  await page.getByTestId("design-prompt").fill("Create a QWERTY keyboard.");
  await page.getByTestId("design-generate").click();
  await expect(page.getByTestId("design-draft")).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].model).toBe("qwen/qwen3.8-27b");
  expect(calls[0].response_format).toMatchObject({
    type:"json_schema",json_schema:{strict:true,name:"osdpi_edit_commands"},
  });
  expect(calls[0].messages[0].role).toBe("system");
  expect(await page.evaluate(()=>fixture.getAIModel("groq"))).toBe("openai/gpt-oss-120b");
  expect(await page.evaluate(()=>JSON.stringify(fixture.captureDesign()))).toBe(original);
  expect(errors).toEqual([]);
});

test("manual editing is atomic, undoable, and preserves unrelated access settings",async({page})=>{
  const {errors}=await setup(page);
  await makeKeyboard(page);
  const before=await page.evaluate(()=>JSON.stringify({
    method:fixture.panel.draft.design.method,pattern:fixture.panel.draft.design.pattern,cues:fixture.panel.draft.design.cues,
  }));
  await page.evaluate(()=>fixture.panel.manual("set_button_color","keyboard_0",null,"#aabbcc"));
  expect(await page.evaluate(()=>fixture.panel.draft.design.layout.children[0].children[2].children[0].props.buttonColor)).toBe("#aabbcc");
  await page.getByTestId("design-undo").click();
  expect(await page.evaluate(()=>fixture.panel.draft.design.layout.children[0].children[2].children[0].props.buttonColor)).not.toBe("#aabbcc");
  expect(await page.evaluate(()=>JSON.stringify({
    method:fixture.panel.draft.design.method,pattern:fixture.panel.draft.design.pattern,cues:fixture.panel.draft.design.cues,
  }))).toBe(before);
  expect(errors).toEqual([]);
});

test("native archive round-trip, imported file, and separate copy preserve source",async({page})=>{
  const {errors}=await setup(page);
  await makeKeyboard(page);
  const result=await page.evaluate(async()=>{
    const f=fixture,p=f.panel;
    const original=JSON.stringify(f.captureDesign());
    const blob=await f.packDesign(p.draft.design,"original");
    const unpacked=await f.unPackDesign(blob);
    const saved=await f.saveDesignCopy(p.draft,"original");
    const db=await f.db.dbPromise;
    return {
      match:JSON.stringify(unpacked)===JSON.stringify(p.draft.design),
      sections:Object.keys(unpacked).sort(),
      savedRows:(await db.getAllFromIndex("store5","by-name",saved)).length,
      originalRows:(await db.getAllFromIndex("store5","by-name","original")).length,
      unchanged:JSON.stringify(f.captureDesign())===original,
    };
  });
  expect(result).toMatchObject({match:true,savedRows:6,originalRows:6,unchanged:true});
  expect(result.sections).toEqual(["actions","content","cues","layout","method","pattern"]);
  expect(errors).toEqual([]);
});

test("unsupported Groq command returns an error without a draft or repair loop",async({page})=>{
  const {errors}=await setup(page,[{op:"invalid_op",target:null,text:null,value:null,items:[]}]);
  await page.getByTestId("design-prompt").fill("Make a board");
  await page.getByTestId("design-generate").click();
  await expect(page.getByRole("alert")).toContainText("Unsupported edit");
  await expect(page.getByTestId("design-draft")).toHaveCount(0);
  expect(errors).toEqual([]);
});


test("file-picker import and edit preserve embedded media and the original",async({page})=>{
  const {errors}=await setup(page);
  await makeKeyboard(page);
  const bytes=await page.evaluate(async()=>{
    const p=fixture.panel;
    const content=p.draft.design.content;
    content[0].symbol="key.png";
    p.media.set("key.png",new Blob([137,80,78,71,1,2,3,4],{type:"image/png"}));
    const blob=await fixture.packDesign(p.draft.design,p.sourceName,p.media);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.evaluate(()=>Object.defineProperty(window,"showOpenFilePicker",{configurable:true,value:undefined}));
  const picker=page.waitForEvent("filechooser");
  await page.getByTestId("design-import").click();
  const chooser=await picker;
  await chooser.setFiles({name:"student-keyboard.osdpi",mimeType:"application/zip",buffer:Buffer.from(bytes)});
  await expect(page.getByTestId("design-draft")).toContainText("student-keyboard");
  const result=await page.evaluate(async()=>{
    const p=fixture.panel;
    p.manual("rename_word","index:1","Letter W");
    const file=await fixture.packDesign(p.draft.design,p.sourceName,p.media);
    const read=await fixture.unPackDesign(file);
    return {
      modified:read.content[1].label,
      originalSymbol:read.content[0].symbol,
      assetName:read.media?.[0]?.name,
      assetBytes:read.media?.[0]?.content?.size,
      original:fixture.Globals.data.contentRows[1].label,
    };
  });
  expect(result).toEqual({modified:"Letter W",originalSymbol:"key.png",assetName:"key.png",assetBytes:8,original:"I would like"});
  expect(errors).toEqual([]);
});

test("new AI keyboard honors selected two-switch access even if model omits it",async({page})=>{
  const {errors}=await setup(page,[{op:"create_keyboard",target:null,text:null,value:false,items:[]}]);
  await page.getByTestId("design-access").selectOption("two-switch");
  await page.getByTestId("design-prompt").fill("Build a QWERTY keyboard that scans with two switches.");
  await page.getByTestId("design-generate").click();
  await expect(page.getByTestId("design-draft")).toBeVisible();
  const method=await page.evaluate(()=>fixture.panel.draft.design.method.children[0]);
  expect(method.props.Pattern).toBe("scan");
  expect(method.children.filter(n=>n.className==="KeyHandler")).toHaveLength(2);
  expect(errors).toEqual([]);
});
