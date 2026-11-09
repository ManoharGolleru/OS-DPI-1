# Native AI interface builder

The Content panel now generates all six native OS-DPI design sections rather than vocabulary for three fixed layouts. No production dependencies were added.

## Use

Save a Groq key in Content > Keys. Open Generate interface with AI, choose Qwen 3.8 27B or GPT-OSS 120B, an access method and a concrete request. Generate a draft, inspect its summary and native sections, then Open as a new board or Download .osdpi. Edit and refine operate on copies. The original board is not overwritten. Test controls in OS-DPI Preview before using the copy.

Qwen is the initial selection for this feature only. The shared conversational-model preference and voice settings are unchanged. The selected voice URI is attached locally after validation; no API key is included in the design or export.

## Implementation

- `design-format.js`: native example and side-effect-free validation.
- `design-engine.js`: registry-derived component/property catalog, prompt, explicit Groq request, local validation, archive export and transactional copy save.
- `design-panel.js`: generation/cancellation, review, explicit repair, edit/refine and file download controls.
- `content.js`: uses the new panel; obsolete vocabulary/template/auto-switch generation is removed.
- `ai/index.js`: per-request provider/model/system overrides, token usage and API error reporting.

The catalog is generated from the registered constructors and Props classes of the running build. It is not a copy of the entire repository or an unrestricted coding agent. The model returns ordinary native `{className,props,children}` trees and scalar content rows. No invented intermediate format is exported.

Generation uses JSON object mode, not a guarantee of strict JSON Schema output. Application validation checks all six roots, supported components/props/children, expression syntax, permitted expression calls, cue/pattern/timer references, actions for controls, navigation literals, required speech output, bounded counts/ranges and existing media references. It does not prove useful vocabulary, visual quality, clinical suitability or every possible runtime interaction. It intentionally excludes external socket handlers, arbitrary HTML/JS/CSS and invented external media. Edits involving unsupported custom components require manual work; an invalid generated replacement is rejected.

## Free-tier constraints

Groq lists `qwen/qwen3.8-27b` as a preview model. Both choices had published free limits of 8K tokens/minute and 200K/day on 2026-11-09; actual account quotas apply. A request uses an approximate character-based input-size guard and a 3,600-token completion cap. Start with 12-24 vocabulary items. Oversized, truncated, unauthorized or rate-limited requests stop visibly; no model fallback or automatic retry loop occurs. Repair is a separate explicit request. Qwen uses reasoning_effort=none; GPT-OSS uses low. This is not a benchmark establishing which model produces better AAC boards.

Official references:
- https://console.groq.com/docs/model/qwen/qwen3.8-27b
- https://console.groq.com/docs/reasoning
- https://console.groq.com/docs/rate-limits

## Tests

`node --test tests/ai-design.test.mjs` exercises native examples and rejected malformed designs. `tests/design-catalog.json` is a snapshot from the actual runtime registry, used only in the pure tests. Runtime validation always reads the live registry.

The AI interface checks workflow also builds Vite and runs Playwright against the actual component registry, real IndexedDB, native controls and native pack/unpack functions. Groq responses and speech playback are stubbed. No provider key, API billing, real audio validation or model-quality measurement is involved. The test HTML is not a production Vite build entry.
