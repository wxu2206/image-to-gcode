# Repository audit — 2026-11-02

Two complete source review passes and a final regression review were completed. The starting working tree was clean. All changes are uncommitted. No dependencies were added, the lockfile is unchanged, and no installation, privilege escalation, commit, push, deployment, or physical-machine operation was performed.

## Coverage checklist

Each row was reviewed in both passes, including unchanged code. Pass 2 used three fresh read-only reviewer contexts, instructed to inspect the updated source independently before prior findings or the diff. The primary reviewer coordinated all edits. Final review covered the complete change set and subsystem interactions.

| First-party surface / workflow | Pass 1 | Pass 2 | Evidence and limits |
| --- | --- | --- | --- |
| `src/main.tsx`, all components, image import | Complete | Complete | Source-to-job/export orchestration, failures, stale uploads, workflow switching, preflight, inspector and persistence |
| `src/core/` | Complete | Complete | Every module and associated tests: image filters/cleanup, raster/contours, detail, optimization, units, transforms, origins, offsets, inversion, bounds, canonical moves, statistics, estimates and safety |
| `src/vector/` | Complete | Complete | XML boundary, path commands, affine transforms, adaptive flattening, complexity, previews, fixtures and tests |
| `src/text/` | Complete | Complete | DOCX/PDF, decompression, fonts, Unicode warnings, whitespace, wrapping, pagination, physical bounds and page export |
| `src/workers/` | Complete | Complete | Requests/responses, revision IDs, cancellation by termination, errors, cleanup, packed movements, bounded previews and lazy serialization |
| `src/visualization/`, `src/utils/` | Complete | Complete | Original/processed/toolpath display, playback timing, viewport math, duration and filenames |
| `src/postprocessors/` | Complete | Complete | All bundled processors, capabilities, tool state, terminal commands, modal restoration, safe-Z rapids, tests and golden G-code |
| All tests and fixtures | Complete | Complete | Baseline plus focused and full regression runs; added App orchestration tests use a deterministic worker boundary |
| HTML/CSS, accessibility, responsive and long content | Complete | Complete | Source/semantic review; live browser verification blocked as described below |
| Package scripts/lockfile, TS/Vite/Vitest/ESLint/PostCSS/Tailwind configuration | Complete | Complete | Existing repository tools used; no dependency or toolchain changes |
| `.github/`, `public/_headers`, relevant documentation/licenses | Complete | Complete | CI permissions/checks, templates, security headers, privacy and supported-feature claims |
| Privacy and untrusted inputs across workflows | Complete | Complete | No upload/network API found; React text rendering, inert SVG model, parser budgets and local workers traced |

Generated `dist/`, dependencies, third-party code and Git internals were excluded from source review. Production output was rebuilt for verification. No application source area was intentionally skipped.

## Confirmed findings and fixes

The regression column names executable tests. Early pass-1 tests for the extraction character limit, astral iteration, import-control semantics and warning announcements were observed failing before their fixes. Later cases were verified against the corrected code and the concrete implementation evidence below; not every case had a separately executed pre-fix red run.

| Location | Trigger and impact before fix | Resolution / regression evidence |
| --- | --- | --- |
| `src/text/import.ts` — `inflate`, `extractDocx` | Highly compressed input was completely buffered before checking expanded size; stored ZIP entries could understate expanded size | Stop/cancel while reading beyond the byte budget; check actual stored bytes. `text.test.ts`: bounded decompression and forged ZIP-directory size |
| `src/text/import.ts` — extraction limits | Import accepted up to 2M characters although editing/layout allow 500k; inserted PDF page markers could push final text beyond that limit | Consistent 500k limit including markers; explicit source-page cap. `text.test.ts`: oversized extraction rejection |
| `src/text/import.ts` — PDF objects, streams and content | All apparent object matches were allocated before checking the object limit; cached streams could be appended repeatedly into an enormous page string | Incremental capped object/reference scanning, cached bounded decompression, aggregate decoded-byte and assembled-content budgets. `text.test.ts`: excessive objects/references and repeated cached content |
| `src/text/import.ts` — PDF tokenization | Content silently stopped at its token cap, potentially dropping text | Explicit per-document token budget and error. `text.test.ts`: token-budget rejection |
| `src/text/import.ts` — Unicode/font maps | Overlapping ranges caused excessive work; aliases without maps consumed unbounded entries; map values could expand extracted text | Aggregate range-operation/font-reference caps and incremental output-length checks. `text.test.ts`: overlapping ranges, excessive aliases and output expansion |
| `src/text/import.ts` — DOCX text boundaries | Trimming/collapsing newlines damaged leading/trailing page delimiters and authored whitespace, plotting the marker label instead | Preserve paragraph text and complete page delimiters. `text.test.ts`: leading/trailing/break-only pages, indentation and blank lines |
| `src/text/layout.ts` | Long unbroken words repeatedly re-measured growing prefixes; tabs/repeated spaces collapsed | Incremental width accounting and preserved whitespace tokens. `text.test.ts`: maximum-length unbroken word, tab/four-space equivalence and distinct single-space placement |
| `src/text/fonts.ts`, `src/text/layout.ts` | Astral characters advanced twice; `$` ascent/descent escaped assumed line metrics; unavailable font IDs silently fell back | Iterate code points, use full bundled font metrics and validate font IDs. `text.test.ts`: astral index, zero-margin glyph bounds and invalid-font rejection |
| `src/text/layout.ts` | Accepted font/page combinations could emit paths far outside paper dimensions even within the machine envelope | Reject unusable glyph height/width and generated points outside the margin bounds. `text.test.ts`: tiny-page rejection and glyph-bound assertions |
| `src/vector/parseSvg.ts` | Zero opacity and transparent/alpha-zero paints became drawing/cutting paths | Track inherited paint opacity/group opacity and explicit transparent color forms. `parseSvg.test.ts`: invisible shapes plus visible sibling |
| `src/vector/parseSvg.ts` | Polygon/polyline point arrays were fully allocated before the segment cap | Bound split/token count before numeric/point allocation. `parseSvg.test.ts`: very large point list with small budget and exactly-at-budget closed polygon |
| `src/postprocessors/common.ts` | Pen/laser footer parking could occur before tool-off; terminal variants could precede final shutdown | Tool-off before nonterminal footer commands, restore authoritative modes, force off after opaque custom footer commands, then terminal commands. `postprocessors.test.ts`: parking, hostile G20/G91 off commands, numbered/commented/M02 endings |
| `src/main.tsx` — uploads | Failed replacement imports cleared the prior usable job; superseded SVG/raster reads still performed expensive synchronous work; import errors appeared twice | Commit replacement only after successful decode/parse/extraction; early stale checks, cleanup and one local import error. `App.test.tsx`: prior raster/text job and inspector survive failure; stale SVG read ignored |
| `src/main.tsx` — workflow switching | Stale progress/processed preview/G-code state remained after switching workflows | Reset affected state with workflow-specific waiting text. `App.test.tsx`: switch while SVG read is pending |
| `src/utils/filename.ts` | `report.docx-page-2` lost the page suffix when removing its extension; long filenames also truncated page identity | Preserve page suffix separately and reserve its filename space. `filename.test.ts`: DOCX/PDF/typed text and long-name distinct pages |
| `index.html`, `src/components/ImageInput.tsx` | Missing viewport/language/title; toolbar import unavailable to normal keyboard focus; preview wrapped in an interactive container | Complete page metadata, native import button, explicit browsing behavior for empty versus loaded preview. `ImageInput.test.tsx`, `App.test.tsx`: button, loaded preview, empty-preview Enter key, MIME-only document drag |
| `src/main.tsx`, `src/components/TextControls.tsx` | Clipboard failure persisted after a successful retry; warnings/search/completion lacked status feedback; textarea accessible name differed from visible label; edited import metadata stayed stale | Copy success status/error recovery, polite notices, described search summary, matching visible label, clear source metadata after edits. `App.test.tsx`, `TextControls.test.tsx` |
| `src/main.tsx` — canvas | Focusable pointer-only canvas advertised actions without keyboard behavior | Remove misleading tab stop and direct accessible descriptions to existing viewport/numeric placement controls |
| `src/components/PreflightDialog.tsx`, `src/core/exportReview.ts` | Precision-7/8 output could show a tiny blocking overrun as zero at six digits | Display up to the supported eight digits. `exportReview.test.ts`: 0.00000004 mm overrun |
| `src/style.css`, README, bug-report template | Two small-text contrast pairs were below AA by source-derived calculation; profile ownership wording was misleading; new source modes absent in bug report | Increase text contrast, clarify output profile versus global job settings and persistence, add SVG/document report choices. Browser/computed-style confirmation remains outstanding |

## Final regression review

The final review caught and corrected issues introduced during implementation: descending/non-finite CMap ranges reducing the work budget, adjacent `bfchar` entries being misread as ranges, internal DOCX indentation trimming, missing mode restoration before footer motion, an explicitly closed polygon incorrectly rejected at the exact budget, page suffix truncation on long filenames, and empty-preview browsing lost when removing the loaded preview's button semantics. Focused regressions cover those boundaries. Subsequent affected checks and the full suite passed.

## Verification

| Command | Baseline | Final |
| --- | --- | --- |
| `npm test` | 35 files, 249 tests passed | 37 files, 290 tests passed |
| `npm run typecheck` | Passed | Passed |
| `npm run lint` | Passed | Passed |
| `npm run build` | Passed | Passed; 1,615 modules transformed |
| `git diff --check` | Clean | Passed |

Focused test commands were also run for text parsing/layout, SVG, post-processors, filename/preflight behavior, components and the new App workflow tests. App tests mock image decoding/canvas and worker transport while using real canonical statistics; they do not establish actual browser rendering or browser-worker execution.

Live-browser checks were attempted through the installed ECC Chrome DevTools MCP. `new_page` failed because `/opt/google/chrome/chrome` was absent. A read-only executable lookup found no `google-chrome`, `chromium`, `chromium-browser` or `firefox` on PATH. `npm run dev -- --host 127.0.0.1` also failed with sandbox `listen EPERM` at `127.0.0.1:5173`. No escalation or installation was attempted, consistent with AGENTS.md.

Consequently, desktop/narrow layouts, 200% browser zoom, overlap and nested scrolling, focus reachability, drag/pointer behavior, actual worker import-to-preview flows, browser clipboard/download behavior, network interception and computed contrast remain unverified in a real browser. JSDOM and CSS review are not visual verification.

## ECC capabilities used

Installed ECC skills, agent definitions and command/workflow files were discovered locally. Relevant instructions read and applied: `ecc:ecc-guide`, `ecc:production-audit`, `ecc:security-review`, `ecc:frontend-a11y`, `ecc:react-testing`, `ecc:browser-qa`, and `ecc:verification-loop`. ECC guidance shaped evidence-backed findings, independent review passes, adversarial tests, accessibility changes and the final verification gates.

Six Codex read-only reviewer contexts were used across the two passes; two performed further regression review. They followed ECC skill guidance. They were not a separately invoked ECC named-agent dispatcher. No unavailable ECC slash command, scanner, axe audit or browser test is claimed to have run. The ECC Chrome DevTools browser attempt failed as recorded above.

## Remaining limitations and suspected issues

- SVG XML is still parsed into a DOM on the main thread before traversal budgets apply. The file limit bounds input size, but node-dense XML and skipped unsupported subtrees need real-browser responsiveness/memory profiling. This remains a suspected resource risk, not a demonstrated exploitable finding in this audit.
- Long toolbar errors and nested panel/footer/modal scrolling need real narrow/short viewport and 200% zoom inspection. No overlap failure was visually confirmed.
- Non-CNC grayscale mode retains its existing explicit warning: varying intensity maps to CNC depth, not laser power or pen pressure. Changing that product behavior was not inferred from this audit request.
- Job speeds/work area/Z limits remain global settings. Output profiles select command/controller behavior and CNC pass depth. Duplicate built-in profiles to persist command edits; built-in edits are session-only. Documentation/UI now explain that ownership instead of silently changing job values on profile selection.
- Full PDF rendering, OCR, legacy DOC parsing, rich document layout and broad Unicode font coverage remain unsupported. The bounded parser handles the documented practical subset; this review does not establish complete PDF/SVG specification support.

No known confirmed actionable finding from the two passes remains intentionally unfixed. Browser-only checks are blocked by the recorded environment constraints. This audit does not establish that the application is bug-free or safe for any particular physical machine.
