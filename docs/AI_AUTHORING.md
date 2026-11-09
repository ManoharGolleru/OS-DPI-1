# Native AI authoring

This implementation starts from the voice-fixed OS-DPI baseline. It replaces the old vocabulary-only generator, without installing a second designer or requiring a new exported format.

## User workflow

Open **Content > Generate or edit with AI**, describe an interface or modification, and select **Build / change interface**. The assistant stages changes through Groq local tool calls. On success it opens a named working copy in the normal native editor. The original board stays untouched. Use the regular Layout, Content, Actions, Methods, Patterns and Cues panels to make manual changes; subsequent AI instructions read those current changes.

Select a piece in Layout and choose **Ask AI about this piece** to target it. **Preview** uses OS-DPI's normal user mode. **Back to editing** returns without requiring a keyboard shortcut. **Download .osdpi** uses the ordinary native exporter.

Import a complete `.osdpi` with the file field, then describe changes. All native sections, optional notes and associated resources are retained. New external URLs, camera access and network-producing actions require explicit review before application. Imported designs should come from a trusted source; OS-DPI itself is not an untrusted-code sandbox.

## Open-ended design, not a template menu

The runtime registry supplies all reachable native component definitions and supported properties. The AI's general tools inspect, insert, update, move, remove and bind actions across the six native sections. Examples are reference material, not a component allowlist.

A small optional keyboard recipe saves repetitive generation of 26 content rows. It returns ordinary native components and actions and does not restrict later edits. Tabs, visual scenes, radio controls, dialogs, custom cues, counters, conditional actions, timers, scanning and other supported native components use the same generic editor.

The model has no JavaScript execution, terminal access or direct database mutation. Stable temporary references are stripped before storage. Expression checks use OS-DPI's existing compiler and registered functions, including qualified slot functions. Local checks isolate temporary state and block notes, files, network effects and queued live actions. All action-update values are native expression strings. Native updates read the pre-action state and apply together. Generic edit batches are atomic. Invalid references are returned to the model for targeted correction. Authentication and daily-quota failures stop. Per-minute waits respect provider headers and remain cancellable. Where browser CORS hides quota headers, measured uncached prompt/completion usage paces requests conservatively against Groq’s published 8K-token/minute free-tier limit. A request stops after 30,000 reported tokens if unfinished; it never installs a partial board. The tool loop has a bounded request budget rather than a manual Repair loop.

## Original-board and device protection

Changes stage against a captured native snapshot. A manual edit during a request makes its result stale, so the assistant refuses to overwrite it. The first accepted change saves a separate copy; later changes update that copy. A short input lock covers the commit only. Resources and sections save before installation, init writes target the working copy, and a failed install restores storage, notes, state and editor identity. AI Undo/Redo covers complete authoring transactions and refuses to erase newer manual edits. Native panel Undo still handles those manual edits.

Speech voice selection carries forward locally. Groq and ElevenLabs keys remain in device storage and are never added to the exported document. Prompts contain relevant design text and configuration; common secret-shaped fields/strings are redacted. Do not put private credentials into board vocabulary or arbitrary fields.

Imports validate ZIP names and size limits before making storage changes. They save all native sections and resources in one IndexedDB transaction. Unused resources and nonstandard archive entries are preserved rather than discarded.

## Testing

- `node --test tests/authoring.test.mjs` checks generic edits, scope, stable references, atomic rollback and metadata/ref validation.
- Browser checks use the actual native registry, expression evaluator, renderer and IndexedDB, with simulated Groq tool responses and stubbed speech. They exercise QWERTY composition, Speak/Clear/Backspace, arbitrary score activities, tabs, dwell, cancellation, stale-result protection, import/export, resource preservation and undo.
- Recorded real-model archives are replayed through ordinary Preview and native export/reimport, with separate generation provenance. These archive checks do not make new provider requests.
- The production build is checked separately. No new production dependencies were introduced.

These regression tests do not prove how reliably a live model interprets every request. Live Groq quality needs evaluation with a user-controlled key. Neither model is labeled superior. Both choices remain explicit and do not change the conversational-suggestion model.

## Live-provider evaluation

The implementation is under live evaluation; deployment acceptance is not yet complete. Keep every failed and successful run, the tested source revision, request count, reported/cached/reasoning tokens, pacing, normal Preview interactions and archive roundtrip results. Model choice is based on functional success and tokens per successful task, not model size or a mocked tool response.

Run opt-in provider tests with `src/tests/playwright.live.config.js` and a securely configured `GROQ_API_KEY` or `GROQ_TEST_ENV`. The ordinary regression suite uses simulated provider replies; it must not be represented as live model evidence. The app also offers opt-in, memory-only diagnostics. Payload collection is separate and should be enabled only for synthetic boards or a deliberately reviewed report. Keys are excluded from exports and diagnostics.

Groq references: [free-tier limits](https://console.groq.com/docs/rate-limits), [local tool calling](https://console.groq.com/docs/tool-use/local-tool-calling), [reasoning controls](https://console.groq.com/docs/reasoning).
