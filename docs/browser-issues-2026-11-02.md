# Five browser issues — local fixes and verification

The existing dirty working tree from the repository audit was preserved. These fixes are local and uncommitted; the live site was not changed or verified. No dependencies, browsers, global tools, or system packages were installed. No privilege escalation, commit, push, or deployment was performed.

## Issue evidence, fixes, and regressions

| Issue | Cause established in the source | Fix | Regression evidence |
| --- | --- | --- | --- |
| Mobile/tablet horizontal overflow | App/workspace grids had implicit `auto` columns; preview flex wrappers lacked explicit shrink constraints, while the canvas has 1100px intrinsic width. Loaded drop zones also retained padding. The supplied 390px/768px measurements could not be repeated here. | Explicit `minmax(0, 1fr)` app/workspace columns; zero minimum widths and bounded preview wrappers; remove loaded-preview padding. Remove body/app global overflow suppression. G-code retains whitespace and scrolls within its own `pre` panel. Existing control minimum widths and responsive breakpoints were reviewed. | CSS constraint review by primary and independent React reviewer. **No real layout or visual verification**; JSDOM cannot establish page width. |
| Misleading inspector search | The current dirty tree already had a no-match message from the earlier audit, but the match summary still advertised a fixed upper bound, and splitting a terminal newline could count a fictitious extra line. The unchanged live implementation may still have the original label. | Extract a bounded search-window utility; use actual returned line counts and an explicit no-results summary. Preserve case-insensitive matching, first-match line numbers, limits of 200 matching-window / 2000 initial lines, and recomputation after regeneration. | `gcodeSearch.test.ts`: unmatched, matching, cleared, final-line, bounded-window and trailing-newline cases. `App.test.tsx`: text G-code searches and regeneration with retained search text. |
| Footer warning flood | The overflow is real for default A4 placement: source text near the top of a 297mm-high page maps to machine Y above 270mm, outside a 200mm-high work area. Each stroke emitted separate start/extent warnings, multiplied in the visible footer. Canonical Y bounds are not incorrectly calculated. | Aggregate unique affected paths, start/extent counts and a bounded set of path-ID examples. Show one polite footer summary with affected-path count and native collapsed warning details. Preserve all canonical coordinates and preflight blocking; do not resize, reposition, clip, or weaken validation. | `textBounds.test.ts`: two-line text exceeds Y=270 and remains export-blocked; a 300×320mm envelope fits; deliberate X offset remains outside. `JobWarnings.test.tsx`: one accessible summary, counts, collapsed/expandable details. |
| Numeric decimal tails and unit drift | Converting by a reciprocal factor and back uses rounded floating-point results as the next source; controls and preflight rendered raw numbers. Repeated conversions could retain long tails or accumulate representation error. | Interactive conversion retains each field's authored value/unit anchor and detects edits independently. Untouched fields restore their exact anchors even after unrelated settings edits. Numeric inputs format only the unfocused display while preserving an editing draft; formatting never commits rounded values. Preflight scalar settings use the same display formatter. Export/coordinate precision is unchanged. | `units.test.ts`: 1000 mm/in round trips with unrelated changes, edited inch values, tiny offsets and independent field anchors. `NumberInput.test.tsx`: float-tail display, no commit on focus/blur, empty drafts, small and full-precision edited values. `App.test.tsx`: repeated switches, stored Safe Z exactly 5, clean preflight. |
| Stale playback after switching/clearing | Workflow switching cleared preview timing but did not reset elapsed state/ref or stop playback; callbacks could retain an obsolete animation closure. | One reset operation cancels the frame, invalidates its generation, stops playback and resets elapsed refs/state. Reset on job-key invalidation, workflow changes and text edits/clear. Callback guards check cancellation, generation and job identity; existing worker revision checks remain in force. Without current timing the clock displays zero. | `App.test.tsx`: switch during playback, switch after completion, and clear text; deliberately invoke obsolete RAF callbacks and old worker result/preview handlers afterward. Clock stays `0:00 / 0:00`, playback stays disabled. |

The unit converter's anchors are session-local. Settings persist as full JavaScript numbers in the existing schema; loading an existing value does not round or rewrite it merely to clean its presentation. Display formatting uses significant digits, so tiny valid values are not forced to zero. Numeric editing still passes finite authored values into existing validation.

## Second review pass

Two independent read-only reviewers inspected the implementations and surrounding code. One applied the installed ECC TypeScript reviewer definition to units, canonical warning generation/preflight, search and playback. The other applied the React reviewer definition to numeric input drafts, hooks/callback cleanup, warning accessibility and CSS layout constraints. Neither found a confirmed remaining regression. No reviewer edited files.

## Verification

- `npm test`: 42 files, 304 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Focused utility/component/App/preflight tests also passed. App tests mock worker transport, decoding and canvas; they establish orchestration behavior, not visual or native-browser behavior.
- Local source scan for console logs, dynamic execution, unsafe HTML rendering and obvious key patterns returned no matches. No third-party scanner or coverage provider was installed or claimed to run.

## Browser evidence and outstanding checks

ECC Chrome DevTools `new_page` was attempted against `http://127.0.0.1:5173` in an isolated context. It failed before navigation: the configured executable `/opt/google/chrome/chrome` is absent. `npm run dev -- --host 127.0.0.1` independently failed with sandbox `listen EPERM` on port 5173. No escalation or browser installation was attempted because AGENTS.md prohibits them.

Therefore the following remain **unverified in a real browser**:

- Page `scrollWidth` versus viewport width at 390px, 768px and desktop widths, plus 200% browser zoom; preview visibility, control reachability, nested scrolling and G-code panel scrolling.
- Native-browser matching/unmatched/cleared searches after regeneration; warning disclosure and screen-reader announcements; numeric editing/preflight after unit switching; playback during/after workflow changes and source clearing.
- Image/SVG uploads, DOCX/PDF imports, native workers/canvas rendering, clipboard behavior and successful downloads. These previous browser-audit coverage gaps remain open despite automated parser/geometry/orchestration tests.

When a browser and permitted local server are available, repeat the supplied scenarios against the updated **local** build. For overflow, record `window.innerWidth`, `document.documentElement.scrollWidth`, and bounding boxes of elements extending beyond the viewport before and after source loading and inspector generation. Use actual browser zoom for the 200% check; CSS zoom or JSDOM does not substitute. Keep any live-site result separate because these changes have not been deployed.

## ECC capabilities actually used

Read and applied installed `production-audit`, `react-testing`, `browser-qa`, and `verification-loop` skill guidance, plus `agents/react-reviewer.md` and `agents/typescript-reviewer.md`. Discovered their local definitions/workflow files. Independent Codex reviewers applied these definitions; a named ECC agent dispatcher or slash command was not invoked. ECC Chrome DevTools was called but failed before browser navigation. No axe, screenshot, visual comparison, Core Web Vitals, or browser download test is claimed.
