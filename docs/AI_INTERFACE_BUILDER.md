# OS-DPI native interface editor

The Content panel has one draft workspace for new interfaces, copies of the current board, and imported `.osdpi` files. The original board is never overwritten. No new production dependencies are required.

## First test: student QWERTY keyboard

1. Open a board, enter **Content > Create or edit an interface**.
2. Select **New QWERTY keyboard**. This is deterministic and works without a Groq API key.
3. In the integrated interactive preview, press H E L L O, Space, W O R L D. Check that the display says `hello world`. Press Speak, then Clear.
4. Edit a key label or grid columns/colors, Undo/Redo, and test again.
5. Choose **Open as new board** to work in OS-DPI's full native editor, or **Download .osdpi**. Reopen the archive and test again.

## Using Groq

Enter a Groq key under Content > Keys. Describe a new board or a change to the current draft. Choose Qwen 3.8 27B or GPT-OSS 120B. The model returns a small list of editing commands using **strict JSON Schema**. The application constructs native components, enforces their relationships, and validates the result. No full six-section model rewrite or repeated manual Repair loop.

Supported edits include:
- Create a QWERTY keyboard or a standard communication grid.
- Add content or a tab, remove/rename content rows, change button labels.
- Adjust grid columns, button colors, spacing, component scale, layout position, and UI scale.
- Change to tested pointer, dwell, or two-switch access, edit dwell time, or adjust cue colors.

A model cannot invent arbitrary components, JavaScript, external sockets, or media. Unsupported commands fail without modifying the working draft. The editor preserves existing advanced components when making targeted changes, but does not pretend to validate every external integration.

## Import, preview, export

Use **Import .osdpi** to load a native archive as a draft. The native layout, content, actions, method, pattern, cues and associated media are retained. Imported resources remain available to the native preview and travel with the exported copy. A regular file input handles the selection.

Preview runs OS-DPI's existing runtime in a separate iframe. It has its own state and never writes to the saved original. It uses browser speech, not the saved ElevenLabs voice, and disables active external socket methods. Imported files should only be obtained from trusted sources: preview isolation is intended for editor state, not as a security boundary against malicious HTML/JS.

Save actions create a different board in one IndexedDB transaction, or export a native ZIP-based `.osdpi` archive. Undo/Redo acts on the draft. Editing in the full Layout/Content/Actions/Methods/Patterns/Cues editor follows **Open as new board**.

## Implementation

- `design-operations.js`: deterministic native constructors and atomic editing operations.
- `design-engine.js`: compact Groq context, schema request, validation, existing-media preservation, archive export and copy save.
- `design-panel.js`: one draft with create/current/import, quick manual edits, Undo/Redo, AI edits, preview and export.
- `ai-preview.js` / `ai-preview.html`: independent native test runtime.
- `design-format.js`: native baseline constructors and validation.
- `ai/index.js`: adds strict response format for edit commands without changing conversational response settings.

The model is never asked to write an entire `.osdpi` archive. Changes that touch methods, patterns or cues use tested native configurations and references.

## Verification and limitations

`node --test tests/*.test.mjs` checks structural invariants, typed characters, atomic updates, and cross-section preservation. The GitHub Actions workflow builds Vite and runs Playwright tests against real OS-DPI controls, IndexedDB, preview and the native archive round trip. Mocked Groq responses verify request shape but **do not establish live Groq output quality**. Do the QWERTY test with a real free Groq key before assessing Qwen versus GPT-OSS.

Free-tier limits vary by account. The editor sends only relevant board summaries and bounded editing commands, not the entire repository or private API keys. Authentication errors, quota errors and unsupported requests stop without changing the draft.
