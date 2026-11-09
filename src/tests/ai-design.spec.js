import {test, expect} from "@playwright/test";

async function setup(page, mutate = null) {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const calls = [];
  await page.route("https://api.groq.com/**", async route => {
    calls.push(route.request().postDataJSON());
    const design = await page.evaluate(() => fixture.starterDesign());
    if (mutate) mutate(design);
    await route.fulfill({json:{choices:[{finish_reason:"stop",message:{content:JSON.stringify({title:"Restaurant",summary:"Test native design",design})}}],usage:{total_tokens:1234}}});
  });
  await page.goto("/OS-DPI-1/tests/ai-design-browser.html");
  await page.waitForFunction(() => !!window.fixture);
  return {errors, calls};
}
async function generate(page) {
  await page.getByTestId("design-prompt").fill("Create a small restaurant board.");
  await page.getByTestId("design-generate").click();
  await page.waitForFunction(() => !fixture.panel.busy);
}

test("draft is native, request-scoped, and leaves the current board alone", async ({page}) => {
  const {errors,calls} = await setup(page);
  const before = await page.evaluate(() => JSON.stringify(fixture.captureDesign()));
  await generate(page);
  await expect(page.getByTestId("design-draft")).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({model:"qwen/qwen3.8-27b",reasoning_effort:"none",max_completion_tokens:3600,response_format:{type:"json_object"}});
  expect(calls[0].messages[0].role).toBe("system");
  expect(await page.evaluate(() => fixture.getAIModel("groq"))).toBe("openai/gpt-oss-120b");
  expect(await page.evaluate(() => JSON.stringify(fixture.captureDesign()))).toBe(before);
  expect(errors).toEqual([]);
});

test("native archive round trip and transactional separate board save", async ({page}) => {
  const {errors} = await setup(page);
  await generate(page);
  const result = await page.evaluate(async () => {
    const f=fixture, before=JSON.stringify(f.captureDesign());
    const blob=await f.packDesign(f.panel.draft.design,"original");
    const unpacked=await f.unPackDesign(blob);
    const name=await f.saveDesignCopy(f.panel.draft,"original");
    const db=await f.db.dbPromise;
    const copy=await db.getAllFromIndex("store5","by-name",name);
    const original=await db.getAllFromIndex("store5","by-name","original");
    return {keys:Object.keys(unpacked),roundTrip:JSON.stringify(unpacked)===JSON.stringify(f.panel.draft.design),copy:copy.length,original:original.length,unchanged:JSON.stringify(f.captureDesign())===before,source:f.db.designName};
  });
  expect(result.keys.sort()).toEqual(["actions","content","cues","layout","method","pattern"]);
  expect(result).toMatchObject({roundTrip:true,copy:6,original:6,unchanged:true,source:"original"});
  expect(errors).toEqual([]);
});

test("unresolved cues block applying invalid AI output", async ({page}) => {
  const {errors}=await setup(page,d=>{d.pattern.children[0].props.Cue="missing";});
  await generate(page);
  await expect(page.getByRole("alert")).toContainText("unknown cue");
  await expect(page.getByTestId("design-draft")).toHaveCount(0);
  expect(await page.evaluate(() => fixture.db.designName)).toBe("original");
  expect(errors).toEqual([]);
});

test("native pointer controls compose, speak and clear", async ({page}) => {
  const {errors}=await setup(page);
  await page.locator("#UI button").filter({hasText:"I would like"}).click();
  await page.locator("#UI button").filter({hasText:"water"}).click();
  await page.locator("#UI button").filter({hasText:"Speak"}).click();
  await expect.poll(()=>page.evaluate(()=>window.lastSpoken?.trim())).toBe("I would like water");
  await page.locator("#UI button").filter({hasText:"Clear"}).click();
  expect(await page.evaluate(()=>fixture.Globals.state.get("$Display"))).toBe("");
  expect(errors).toEqual([]);
});

test("dwell timer and two-switch scan use real native methods", async ({page}) => {
  const {errors}=await setup(page);
  await page.evaluate(()=>{const d=fixture.starterDesign("dwell");d.method.children[0].children.find(n=>n.className==="Timer").props.Interval=.15;fixture.mount(d);});
  await page.locator("#UI button").filter({hasText:"water"}).hover();
  await expect.poll(()=>page.evaluate(()=>String(fixture.Globals.state.get("$Display")||"").trim())).toBe("water");
  await page.evaluate(()=>fixture.mount(fixture.starterDesign("two-switch")));
  await page.locator("body").click({position:{x:2,y:2}});
  for(const key of ["Space","Enter"]){await page.keyboard.down(key);await page.waitForTimeout(140);await page.keyboard.up(key);await page.waitForTimeout(140);}
  expect(await page.locator("#UI [cue]").count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
