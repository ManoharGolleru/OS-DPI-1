# AI authoring for OS-DPI: open-ended native design

**Status:** Architecture proposal, not an implemented feature. Start from the voice-fixed source snapshot, not either experimental AI generator. The live `main` branch has been restored to that baseline. No code is merged from this proposal without end-to-end real-provider tests.

## Goal

A person unfamiliar with programming should describe an AAC interface, watch it appear in OS-DPI, try it, and refine it in plain language. They may start from a blank board, an existing board, or an imported `.osdpi` file.

Examples must all be supported by the same authoring mechanism:
- "Create a QWERTY keyboard with a display, Space, Backspace, Clear and Speak."
- "Make a restaurant board with Food and Drinks tabs; tapping a word adds it to the message."
- "Keep this imported scanning board. Increase dwell time and make the highlight blue."
- "Add two switch controls with a row-column scan and auditory cues."
- "Make this board fit a tablet, move the display below the vocabulary and preserve the speech voice."
- "Create a button-operated guessing game with a timer and a score."

If OS-DPI already offers the necessary components and behavior, users should not need technical knowledge of JSON, actions, state expressions or cross-references. For unsupported external integrations, the assistant should explain what is missing and request only the essential configuration.

## Why the two prototypes failed

1. A single full six-section JSON response had to recreate layout, content, actions, methods, patterns and cues. A small edit could break unrelated functionality, and repairs repeated the same expensive task.
2. The restricted command set solved the QWERTY test but only expressed features that developers preselected. The model was not free to combine OS-DPI's broader capabilities. It also introduced a second editing/preview system rather than taking advantage of the existing one.
3. Mocked provider replies, schema compliance and successful builds do not establish that **actual Groq model outputs** produce useful working interfaces.

The new design must not be another full-rewrite generator or another finite list of specific interface templates.

## One native editing surface

Reuse OS-DPI's existing `Layout`, `Content`, `Actions`, `Methods`, `Patterns`, `Cues`, `TreeBase`, `Props`, `Globals`, `DB`, and the existing Edit/Preview toggle.

- **New:** create a new named working board in IndexedDB.
- **Edit:** copy the current board to a new working board before modifications.
- **Import:** use the existing `.osdpi` archive parser and persist an imported copy, retaining native JSON sections and media.
- **Refine:** keep an assistant panel open inside the normal designer. The user may select a piece on the board and say "change this", using `Globals.layout.selected` as the target.
- **Preview:** use OS-DPI's existing preview mode on the working board, not a competing simulated renderer or a second state engine.
- **Save:** use existing native `.osdpi` export. The source board remains unchanged. Each accepted AI request is one undoable design transaction.

The working board is the single source of truth for manual and AI changes. AI is a new way of invoking native authoring behavior, not a different design format.

## A small general-purpose AI tool surface

Groq models use **local function/tool calling** with tools executed by OS-DPI. Use a small number of general tools, not one tool per potential design feature:

1. `inspect`: read a compact board outline, selected component, related actions/content/access objects, component schemas or relevant examples.
2. `insert`: create any registered native component, content row or action subtree using its valid properties and parent, with a stable temporary reference.
3. `update`: change properties or rows, including supported OS-DPI expressions and action/method/cue properties.
4. `rearrange`: move, reorder or delete an existing object.
5. `check`: validate the proposed document and return targeted structural/reference/runtime diagnostics.
6. `finish`: report the completed changes, test status and any unsupported requirements.

These are **generic document edits** across all native OS-DPI sections. They do not enumerate layouts, activities, buttons or behaviors. A model may inspect more of the board before making a change.

Use canonical *examples/helpers*, not constraints, for familiar patterns:
- word or letter grids; message composition; Speak/Clear/Backspace
- tabs, category filters, navigation and multi-page boards
- pointer, dwell, two-switch, scanning order and cues
- existing sound/image media and state-driven actions

Prefer calling an existing OS-DPI authoring helper where available, or extracting one small shared helper from current designer logic. The model does not need to compose boilerplate for each of 26 keyboard letters. It still has access to generic edits for less common interfaces.

## Native schema and references

- Derive available classes, properties, allowed children and value types from the **runtime `TreeBase.nameToClass` and `Props` instances**. Do not maintain a hand-written limited component allowlist.
- Keep stable **session-only object references** for selecting, moving and editing nodes and content rows. Do not use ambiguous display labels or array indices after moves. Preserve the original file format on export.
- Generate unique native keys and connect references (action origins, method-to-pattern, cue and timer) in the application. Show the model friendly aliases; resolve them to real keys locally.
- Use native OS-DPI expressions, existing `add_letter`/`add_word` functions, action evaluation and supported method/event handlers. Compile/check expressions before committing. Do not execute arbitrary model-supplied JavaScript.
- Preserve unmodified subtrees and media from imported designs byte-for-byte where practical. Allow advanced existing components even when no helper example has been written for them.
- Present explicit consent for external WebSocket/API actions or resource sharing, rather than silently starting an external connection.

## Model request loop

1. **Understand:** send the user request, selected object, compact board outline, relevant property catalog and targeted reference examples.
2. **Inspect as needed:** the model asks for more details via the `inspect` tool. Avoid sending an entire large board unless essential.
3. **Edit a working snapshot:** locally execute generic tool calls against a copy of the draft. Tool arguments are validated and errors returned to the model.
4. **Check:** run structural validation, cross-reference validation and basic native rendering checks. For the described user intent, include targeted interaction checks when possible.
5. **Repair locally when needed:** let the model correct only failing objects, with a small bounded number of tool turns. Stop on rate-limit/authentication errors without changing the draft.
6. **Accept or roll back:** commit only a coherent checked transaction to the working board. Report real changes and incomplete features. Keep the prior draft if checks fail.
7. **Iterate:** the user previews, clicks a component and describes the next change. No manual "repair" button or full regeneration.

Groq's current documentation lists `qwen/qwen3.8-27b` and `openai/gpt-oss-120b` as supporting local tool calling. **Do not combine `response_format:json_schema` with `tools` in the same request:** Groq documents that structured output mode does not support tool use. Use tool-call argument schemas plus local validation; use strict structured output only in separate non-tool requests if needed. Prefer sequential edits where later steps depend on IDs created by earlier steps, regardless of model support for parallel calls.

Keep the model selection explicit until real-task evidence favors one model. Set bounded request and tool-call budgets; respect actual provider `429` and `retry-after` values. Use the existing Groq key without including it in prompts, export or logs.

## First end-to-end acceptance test

Prompt: "Create a QWERTY keyboard with a display at the top, Space, Backspace, Speak and Clear. Large buttons, blue letters on white, mouse/touch access."

Acceptance:
- Actual 3 QWERTY letter rows (26 letters), with no missing or duplicated keys.
- Typing `hello world` displays exactly that string. Space inserts one space. Backspace removes the final character.
- Speak reads the full message once, and Clear empties it. Repeated Clear and empty Speak do not error.
- Letter presses do not individually trigger speech unless requested.
- The board is visibly usable in native Preview, with no significant clipping at representative desktop/tablet widths.
- `.osdpi` export opens back into OS-DPI with the same content, actions, methods, cues, media and behavior.
- A follow-up request "move the display below the keys and make them green" changes those details while preserving all other parts.
- Original board remains unchanged. No manual repair clicks.

Test *actual* Qwen and GPT-OSS responses through the existing Groq integration, using a user-controlled key and recording redacted diagnostics. A prepared mocked response is useful for regression testing but is not an acceptance result.

## Broader acceptance matrix

After the keyboard, validate with:
1. Restaurant board using two tabs, explicit vocabulary, Speak/Clear and no unintended tab switching.
2. Existing `.osdpi` with images or audio. Change one color and export without losing resources.
3. A board using pointer dwell. Change dwell duration and cues while preserving other actions.
4. Two-switch row-column scan with active method, valid pattern/cue keys and working selection.
5. A multi-page interactive board using state-based conditions, navigation, a timer and score.
6. A request that needs an unavailable outside service. Respond with a clear missing-requirement explanation; never fabricate integration.
7. A user selects one item and says "make this larger." Only the selected target changes.
8. A failed model request or browser cancellation leaves the saved board and previous draft intact.

Track success per task: first-attempt functional success, after-internal-correction success, tool calls/tokens, latency, number of preserved original sections, and human-rated usefulness. Do not claim "working" from a schema/build test alone.

## Implementation order

**Phase A: prove the generic editor.** Build a pure, tested native document editing API with registry-derived validation and working-draft copy. Apply a multi-section QWERTY edit by calling the same API manually. Confirm the real Preview and export round trip.

**Phase B: connect Groq tool use.** Extend only the existing Groq request layer with messages/tools/tool results. Support targeted inspection, insertion, updates and checking. Keep other AI speech/suggestion features unchanged. Run real Groq requests before expanding.

**Phase C: simplify novice workflow.** Provide one assistant panel reachable from Home and the existing editor, natural-language refinement, component selection, progress, Undo and clear errors. No second designer or renderer.

**Phase D: extend through examples and tests.** Test imported files, tabs, alternative access, cues, conditional actions, timers, games and media. Add an example only when a real task fails; do not create a rigid taxonomy of all possible boards.

No third-party agent framework, vector database, new backend, custom compatibility layer or new serialization format. Use native browser APIs and the dependencies OS-DPI already has. Remove the old hardcoded `_generateWithAI` implementation only when the new end-to-end flow has passed real-provider acceptance.

## Risks and limits

This is an **OS-DPI interface authoring assistant**, not an unrestricted code generator. It should handle any design expressible using the registered native components and existing behavior primitives. Requests requiring capabilities absent from OS-DPI need honest explanation or explicit extension work.

Some imported files contain existing custom components/media, invalid external references or code. The assistant must preserve unchanged parts, reject changes that break native integrity, and never silently delete user data. A successful structural check is distinct from validating usability for an AAC user.

Sources:
- https://console.groq.com/docs/tool-use/local-tool-calling
- https://console.groq.com/docs/tool-use/overview
- https://console.groq.com/docs/structured-outputs
- https://console.groq.com/docs/rate-limits
