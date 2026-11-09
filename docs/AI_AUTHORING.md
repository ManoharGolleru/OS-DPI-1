# Native AI authoring

This implementation starts from the voice-fixed OS-DPI baseline. It replaces the old vocabulary-only generator, without installing a second designer or requiring a new exported format.

## User workflow

Open **Content > Generate or edit with AI**, describe an interface or modification, and select **Build / change interface**. The assistant stages changes through Groq local tool calls. On success it opens a named working copy in the normal native editor. The original board stays untouched. Use the regular Layout, Content, Actions, Methods, Patterns and Cues panels to make manual changes; subsequent AI instructions read those current changes.

Select a piece in Layout and choose **Ask AI about this piece** to target it. **Preview** uses OS-DPI's normal user mode. **Back to editing** returns without requiring a keyboard shortcut. **Download .osdpi** uses the ordinary native exporter.

Import a complete `.osdpi` with the file field, then describe changes. All native sections, optional notes and associated resources are retained. New external URLs, camera access and network-producing actions require explicit review before application. Imported designs should come from a trusted source; OS-DPI itself is not an untrusted-code sandbox.

## Open-ended design, not a template menu

The runtime registry supplies all reachable native component definitions and supported properties. The AI's general tools inspect, insert, update, move, remove and bind actions across the six native sections. Examples are reference material, not a component allowlist.

A small optional keyboard recipe saves repetitive generation of 26 content rows. It returns ordinary native components and actions and does not restrict later edits. Tabs, visual scenes, radio controls, dialogs, custom cues, counters, conditional actions, timers, scanning and other supported native components use the same generic editor.

The model has no JavaScript execution, terminal access or direct database mutation. Stable temporary references are stripped before storage. Expression checks use OS-DPI's existing compiler and functions. Generic edit batches are atomic. Invalid references are returned to the model for targeted correction. Authentication failures stop; rate-limit waits respect provider headers and remain cancellable. The tool loop has a bounded request budget rather than a manual Repair loop.

## Original-board and device protection

Changes stage against a captured native snapshot. A manual edit during a request makes its result stale, so the assistant refuses to overwrite it. The first accepted change saves a separate copy; later changes update that copy. AI Undo/Redo covers complete authoring transactions and refuses to erase newer manual edits. Native panel Undo still handles those manual edits.

Speech voice selection carries forward locally. Groq and ElevenLabs keys remain in device storage and are never added to the exported document. Prompts contain relevant design text and configuration; common secret-shaped fields/strings are redacted. Do not put private credentials into board vocabulary or arbitrary fields.

Imports validate ZIP names and size limits before making storage changes. They save all native sections and resources in one IndexedDB transaction. Unused resources and nonstandard archive entries are preserved rather than discarded.

## Testing

- `node --test tests/authoring.test.mjs` checks generic edits, scope, stable references, atomic rollback and metadata/ref validation.
- Browser checks use the actual native registry, expression evaluator, renderer and IndexedDB, with simulated Groq tool responses and stubbed speech. They exercise QWERTY composition, Speak/Clear/Backspace, arbitrary score activities, tabs, dwell, cancellation, stale-result protection, import/export, resource preservation and undo.
- The production build is checked separately. No new production dependencies were introduced.

These regression tests do not prove how reliably a live model interprets every request. Live Groq quality needs evaluation with a user-controlled key. Neither model is labeled superior. Both choices remain explicit and do not change the conversational-suggestion model.
