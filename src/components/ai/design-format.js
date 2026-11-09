/** Native OS-DPI design contract. No DOM, API calls, or live-board mutations. */
export const SECTION_ROOTS = {
  layout: "Layout", actions: "Actions", method: "MethodChooser",
  pattern: "PatternList", cues: "CueList",
};
export const SECTION_NAMES = ["layout", "content", "actions", "method", "pattern", "cues"];
export const DESIGN_MODELS = [
  ["qwen/qwen3.8-27b", "Qwen 3.8 27B (preview)"],
  ["openai/gpt-oss-120b", "GPT-OSS 120B"],
];
export const DESIGN_CLASSES = new Set([
  "Layout", "Page", "Stack", "Grid", "GridFilter", "Display", "Button", "Gap",
  "TabControl", "TabPanel", "Radio", "Option", "Speech", "Prediction",
  "Actions", "Action", "ActionCondition", "ActionUpdate",
  "MethodChooser", "Method", "Timer", "KeyHandler", "PointerHandler", "TimerHandler",
  "HandlerKeyCondition", "HandlerCondition", "ResponderNext", "ResponderActivate",
  "ResponderCue", "ResponderClearCue", "ResponderStartTimer",
  "PatternList", "PatternManager", "PatternGroup", "PatternSelector", "Filter", "OrderBy", "GroupBy",
  "CueList", "CueOverlay", "CueFill", "CueCircle",
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const scalar = (x) => typeof x === "string" || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x));
const object = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const enabled = (x) => x === true || x === "true";
export const node = (className, props = {}, children = []) => ({ className, props, children });
export const walk = (root) => [root, ...(root.children || []).flatMap(walk)];

/** A real, editable native example, also used in regression tests. */
export function starterDesign(access = "pointer") {
  const n = node;
  const rule = (origin, condition, updates) => n("Action", {origin}, [
    n("ActionCondition", {Condition: condition}),
    ...Object.entries(updates).map(([stateName, newValue]) => n("ActionUpdate", {stateName, newValue})),
  ]);
  const respond = (type, props = {}) => n(type, {Response: type, ...props});
  const pointer = (signal, children) => n("PointerHandler", {Signal: signal}, children);
  const key = (keyName, type) => n("KeyHandler", {Signal: "keyup"}, [
    n("HandlerKeyCondition", {Key: keyName}), respond(type),
  ]);
  const handlers = access === "two-switch" ? [key(" ", "ResponderNext"), key("Enter", "ResponderActivate")]
    : access === "dwell" ? [
      pointer("pointerover", [respond("ResponderCue", {Cue: "focus"}), respond("ResponderStartTimer", {TimerName: "dwell-timer"})]),
      pointer("pointerout", [respond("ResponderClearCue")]),
      n("Timer", {Name: "Dwell", Key: "dwell-timer", Interval: 1.2}),
      n("TimerHandler", {Signal: "timer", TimerName: "dwell-timer"}, [respond("ResponderActivate")]),
    ] : [
      pointer("pointerup", [respond("ResponderActivate")]),
      pointer("pointerover", [respond("ResponderCue", {Cue: "focus"})]),
      pointer("pointerout", [respond("ResponderClearCue")]),
    ];
  return {
    layout: n("Layout", {name: "Layout", uiScale: 1.4}, [n("Page", {direction: "column", background: "#ffffff"}, [
      n("Speech", {stateName: "$Speak", voiceURI: ""}),
      n("Stack", {direction: "row", scale: 1}, [
        n("Display", {Name: "message", stateName: "$Display", scale: 5, fontSize: 2}),
        n("Button", {name: "speak", label: "Speak", scale: 1}),
        n("Button", {name: "clear", label: "Clear", scale: 1}),
      ]),
      n("Grid", {name: "words", rows: 2, columns: 3, scale: 5, background: "#ffffff", fillItems: true}, [
        n("GridFilter", {field: "#grid", operator: "equals", value: "'words'"}),
      ]),
    ])]),
    content: [
      {label: "Hello", say: "Hello!", kind: "phrase", grid: "words"},
      {label: "I would like", say: "I would like", kind: "word", grid: "words"},
      {label: "water", say: "water", kind: "word", grid: "words"},
    ],
    actions: n("Actions", {}, [
      rule("words", "#kind='phrase'", {$Speak: "#say", $Display: "#say"}),
      rule("words", "", {$Display: "add_word(#label)"}),
      rule("speak", "$Display", {$Speak: "$Display"}),
      rule("message", "$Display", {$Speak: "$Display"}),
      rule("clear", "", {$Display: "''"}),
    ]),
    method: n("MethodChooser", {}, [n("Method", {
      Name: access, Key: "input", Active: true, Pattern: access === "two-switch" ? "scan" : "NullPattern",
      KeyDebounce: 0.1, PointerEnterDebounce: 0, PointerDownDebounce: 0,
    }, handlers)]),
    pattern: n("PatternList", {}, [n("PatternManager", {
      Name: "Row column", Key: "scan", Active: true, StartVisible: false, Cue: "focus",
    }, [n("PatternSelector", {}, [n("GroupBy", {GroupBy: "#row", Name: "Row #row", Cue: "focus", Cycles: 2})])])]),
    cues: n("CueList", {}, [n("CueOverlay", {
      Name: "Focus", Key: "focus", CueType: "CueOverlay", Default: true, Color: "#2563eb", Opacity: 0.3,
    })]),
  };
}

/** Validate without executing model-generated expressions or constructing live components.
 * catalog is derived from this build's registered components, not an invented file format.
 */
export function validateDesign(design, catalog, {checkExpression = () => true, mediaNames = []} = {}) {
  const errors = [], warnings = [], media = new Set(mediaNames);
  const fail = (path, text) => { if (errors.length < 30) errors.push(`${path}: ${text}`); };
  if (!object(design)) return {errors: ["design must be an object"], warnings};
  for (const name of SECTION_NAMES) if (!(name in design)) fail(name, "missing native section");
  for (const key of Object.keys(design)) if (!SECTION_NAMES.includes(key)) fail(key, "unknown section");
  let count = 0;
  const nodes = [];
  function expression(value, path) {
    if (typeof value !== "string") { fail(path, "expression must be a string"); return; }
    // The expression parser is not a security boundary. Restrict callable identifiers first.
    const bare = value.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
    const calls = [...bare.matchAll(/([\w$]+)\s*\(/g)].map(x => x[1]);
    const allowed = new Set(["increment", "add_word", "add_letter", "complete", "replace_last", "replace_last_letter", "max", "min", "if", "abs"]);
    const identifiers = bare.replace(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, "").match(/[$#]?[A-Za-z_]\w*/g) || [];
    if (identifiers.some(t => !t.startsWith("$") && !t.startsWith("#") && !allowed.has(t) && !["true", "false", "null", "undefined"].includes(t))) { fail(path, "literal text must be quoted; variables need $ or #"); return; }
    if (calls.some(c => !allowed.has(c)) || /[;{}\[\]]|\b(?:constructor|prototype|__proto__|window|document|fetch|eval|load_design)\b|\.[A-Za-z_$]/.test(bare)) {
      fail(path, "unsupported or unsafe expression"); return;
    }
    if (!checkExpression(value)) fail(path, "invalid OS-DPI expression");
  }
  function inspect(item, path, depth = 0, parent = null) {
    if (++count > 260 || depth > 16) { fail(path, "design is too large or deeply nested"); return; }
    if (!object(item) || !DESIGN_CLASSES.has(item.className) || !catalog[item.className]) { fail(path, "unsupported component"); return; }
    if (Object.keys(item).some(k => !["className", "props", "children"].includes(k))) fail(path, "unexpected component fields");
    if (!object(item.props) || !Array.isArray(item.children)) { fail(path, "requires props object and children array"); return; }
    const spec = catalog[item.className];
    if (parent && !catalog[parent].children.includes(item.className)) fail(path, `${item.className} is not allowed inside ${parent}`);
    nodes.push(item);
    for (const [key, value] of Object.entries(item.props)) {
      const prop = Object.hasOwn(spec.props, key) ? spec.props[key] : null;
      const p = `${path}.props.${key}`;
      if (FORBIDDEN_KEYS.has(key) || !prop) { fail(p, "unknown property"); continue; }
      if (!scalar(value) || (typeof value === "string" && value.length > 1600)) { fail(p, "invalid scalar or excessive text"); continue; }
      if (prop.expression || (typeof value === "string" && value.startsWith("="))) expression(value, p);
      else if (["Float", "Integer"].includes(prop.type)) {
        const num = Number(value);
        if (typeof value === "boolean" || value === "" || !Number.isFinite(num) || (prop.type === "Integer" && !Number.isInteger(num)) || num < (prop.min ?? 0) || num > (prop.max ?? 1000)) fail(p, "number outside supported range");
      } else if (["Boolean", "OneOfGroup"].includes(prop.type) && ![true, false, "true", "false"].includes(value)) fail(p, "expected boolean");
      else if (prop.choices && value !== "" && !prop.choices.includes(String(value))) fail(p, "unsupported selection");
      if (key === "Opacity" && !(+value >= 0 && +value <= 1)) fail(p, "opacity must be 0 to 1");
      if (item.className === "Speech" && key === "volume" && !(+value >= 0 && +value <= 1)) fail(p, "volume must be 0 to 1");
      if (item.className === "Speech" && key === "pitch" && !(+value >= 0 && +value <= 2)) fail(p, "pitch must be 0 to 2");
      if (["stateName", "learnFrom"].includes(key) && value && !/^\$[A-Za-z]\w*$/.test(String(value))) fail(p, "use a $state name");
      if (key === "symbol" && value && !media.has(value)) fail(p, "reference an existing media filename, not an invented URL");
      if (prop.type === "Color" && value && !/^(#[0-9a-fA-F]{3,8}|[A-Za-z]+)$/.test(String(value))) fail(p, "use a color name or hex color");
    }
    for (let i = 0; i < item.children.length; i++) inspect(item.children[i], `${path}.children[${i}]`, depth + 1, item.className);
  }
  for (const [section, root] of Object.entries(SECTION_ROOTS)) {
    if (design[section]?.className !== root) fail(section, `root must be ${root}`);
    inspect(design[section], section);
  }
  if (!Array.isArray(design.content) || design.content.length > 100) fail("content", "expected at most 100 rows per request");
  else design.content.forEach((row, i) => {
    if (!object(row)) { fail(`content[${i}]`, "expected an object"); return; }
    for (const [key, value] of Object.entries(row)) {
      if (FORBIDDEN_KEYS.has(key) || !/^[A-Za-z_]\w*$/.test(key) || !scalar(value) || String(value).length > 1600) fail(`content[${i}].${key}`, "invalid content field");
      if (key === "symbol" && value && !media.has(value)) fail(`content[${i}].symbol`, "unknown media filename");
    }
    if (!row.label || typeof row.label !== "string") fail(`content[${i}]`, "label is required");
  });
  if (errors.length) return {errors, warnings};

  const inSection = (section, cls) => walk(design[section]).filter(n => n.className === cls);
  function keys(section, cls) {
    const values = inSection(section, cls).map(n => String(n.props.Key || ""));
    if (values.some(x => !x) || new Set(values).size !== values.length) fail(section, `${cls} keys must be present and unique`);
    return new Set(values);
  }
  const cueKeys = new Set(design.cues.children.map(n => n.props.Key));
  if (cueKeys.size !== design.cues.children.length || cueKeys.has(undefined) || cueKeys.has("")) fail("cues", "cue keys must be present and unique");
  const patternKeys = keys("pattern", "PatternManager");
  const methods = inSection("method", "Method");
  keys("method", "Method");
  if (!methods.some(n => enabled(n.props.Active))) fail("method", "at least one access method must be active");
  if (!design.cues.children.length) fail("cues", "provide a focus cue");
  if (!design.pattern.children.length) fail("pattern", "provide a scan pattern");
  if (inSection("pattern", "PatternManager").filter(n => enabled(n.props.Active)).length > 1) fail("pattern", "only one default pattern is allowed");
  if (design.cues.children.filter(n => enabled(n.props.Default)).length > 1) fail("cues", "only one default cue is allowed");
  for (const n of nodes) {
    if (n.props.Cue && n.props.Cue !== "DefaultCue" && !cueKeys.has(n.props.Cue)) fail(n.className, `unknown cue ${n.props.Cue}`);
    if (n.className === "Method" && n.props.Pattern && !["DefaultPattern", "NullPattern"].includes(n.props.Pattern) && !patternKeys.has(n.props.Pattern)) fail("method", `unknown pattern ${n.props.Pattern}`);
    if (n.className === "Grid" && (!(+n.props.rows >= 1) || !(+n.props.columns >= 1) || +n.props.rows * +n.props.columns > 100)) fail("layout.Grid", "specify rows and columns, at most 100 cells");
    if (n.className === "Timer" && !(+n.props.Interval >= 0.1 && +n.props.Interval <= 60)) fail("method.Timer", "interval must be 0.1 to 60 seconds");
    if (n.className === "Prediction" && n.props.predictor === "ai") fail("layout.Prediction", "use adaptive prediction; AI prediction requires separate explicit setup");
  }
  for (const method of methods) {
    const timers = new Set(method.children.filter(n => n.className === "Timer").map(n => n.props.Key));
    for (const n of walk(method)) {
      if (["TimerHandler", "ResponderStartTimer"].includes(n.className) && !timers.has(n.props.TimerName)) fail("method", `unknown local timer ${n.props.TimerName}`);
      if (n.className === "KeyHandler" && !n.children.some(c => c.className === "HandlerKeyCondition")) fail("method", "a key handler needs an explicit key");
      if (n.className.endsWith("Handler") && !n.children.some(c => c.className.startsWith("Responder"))) fail("method", "a handler needs a response");
    }
  }
  const layoutNodes = walk(design.layout);
  if (design.layout.children.length !== 1 || design.layout.children[0].className !== "Page") fail("layout", "use exactly one Page with nested TabPanels for multiple boards");
  const speech = layoutNodes.filter(n => n.className === "Speech");
  if (!speech.length) fail("layout", "include a Speech component");
  const origins = new Set(layoutNodes.flatMap(n => [n.props.name, n.props.Name]).filter(Boolean));
  const rules = design.actions.children;
  const targets = new Set(rules.map(n => n.props.origin));
  for (const [i, rule] of rules.entries()) {
    if (!origins.has(rule.props.origin) && !["init", "*"].includes(rule.props.origin)) fail(`actions[${i}]`, `unknown origin ${rule.props.origin}`);
    if (rule.props.origin === "*" && i !== rules.length - 1) fail(`actions[${i}]`, "wildcard rule must come last");
    if (!rule.children.some(n => n.className === "ActionUpdate")) fail(`actions[${i}]`, "needs an update");
  }
  for (const n of layoutNodes.filter(n => ["Button", "Grid", "Display"].includes(n.className))) {
    const name = n.props.name || n.props.Name;
    if (n.className === "Display" && !name) continue;
    if (!name || (!targets.has(name) && !targets.has("*"))) fail(`layout.${n.className}`, `missing action for ${name || "unnamed control"}`);
  }
  const updates = walk(design.actions).filter(n => n.className === "ActionUpdate");
  if (!speech.some(s => updates.some(u => u.props.stateName === (s.props.stateName || "$Speak")))) fail("actions", "nothing writes to the Speech state");
  const grids = layoutNodes.filter(n => n.className === "Grid");
  const fields = new Set(design.content.flatMap(r => Object.keys(r).map(k => "#" + k)));
  for (const f of nodes.filter(n => n.className === "GridFilter")) {
    if (!f.props.operator) fail("layout.GridFilter", "operator is required");
    if (!String(f.props.operator || "").startsWith("only") && !fields.has(f.props.field) && !["#prediction", "#suggestion"].includes(f.props.field)) fail("layout.GridFilter", `unknown content field ${f.props.field}`);
  }
  for (const row of design.content) if (row.grid && !grids.some(g => g.props.name === row.grid)) fail("content", `unknown grid ${row.grid}`);
  const tabControls = layoutNodes.filter(n => n.className === "TabControl");
  for (const tab of tabControls) {
    const names = tab.children.map(n => n.props.name);
    if (new Set(names).size !== names.length || names.some(n => !n)) fail("layout.TabControl", "tab names must be unique and nonempty");
    for (const update of updates.filter(n => n.props.stateName === tab.props.stateName)) {
      const literal = /^['"]([^'"]*)['"]$/.exec(update.props.newValue);
      if (literal && !names.includes(literal[1])) fail("actions", `navigation points to missing tab ${literal[1]}`);
    }
  }
  if (design.content.length > 36) warnings.push("This draft contains over 36 vocabulary buttons. Check target size and navigation before use.");
  if (methods.filter(m => enabled(m.props.Active)).length > 1) warnings.push("Multiple access methods are active. Check for double activation.");
  if (!errors.length) warnings.push("Structural checks passed. Test speech, navigation, target size, and the selected access method in Preview.");
  return {errors, warnings};
}
