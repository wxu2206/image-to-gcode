# Repository guidance

## Development environment

- The development machine runs Bazzite, an immutable Fedora-based Linux distribution.
- The repository is `/var/home/will/image-to-gcode`.
- Use the existing NVM-managed Node/npm environment and repository-level tools only.
- Never use `sudo`, `dnf`, `rpm-ostree`, system package installation, host OS modifications, or privilege escalation.
- If a required system dependency is missing, report it as a blocker instead of installing it.

## Dependencies and installations

- Inspect existing dependencies and browser/platform APIs before adding anything. Do not install unnecessary packages, tools, extensions, services, or dependencies.
- Add a dependency only for a concrete requirement that simpler existing capabilities cannot meet. Keep additions minimal, maintained, appropriately licensed, and repository-scoped.
- Explain every necessary dependency addition in the final summary.
- Do not install global npm packages, replace the toolchain, perform unrelated dependency upgrades, or add dependencies merely to edit documentation.
- Avoid unnecessary `package-lock.json` changes.

## Project purpose and architecture

This is a local-first React/Vite application that converts raster images, native SVG geometry, and editable text/documents into previewable machine movements and G-code for CNC, pen-plotter, and laser-style profiles.

- `src/main.tsx` and `src/components/` manage the UI, source selection, previews, preflight, and export orchestration.
- `src/core/` owns raster conversion, geometry, transforms, optimization, machine validation, canonical movement generation, statistics, and runtime estimates.
- `src/vector/` securely parses supported SVG geometry and adaptively flattens curves at physical tolerances.
- `src/text/` extracts bounded plain text from DOCX/text PDFs and creates direct vector paths from bundled single-line stroke-font data. Text preserves character/stroke order rather than applying geometry reordering that would alter writing semantics.
- `src/workers/document.worker.ts` performs cancellable document extraction. `src/workers/toolpath.worker.ts` performs expensive geometry work, packs canonical movements, prepares previews, and serializes G-code on demand.
- `src/visualization/` renders and plays back the exact canonical movement stream used by export.
- `src/postprocessors/` validates machine capabilities and converts canonical movements into controller-specific G-code.

Reuse the existing geometry pipeline, packed canonical movements, worker processing, preview, and post-processors. Preserve image/SVG behavior, machine safety validation, and safe travel behavior. Uploaded images and documents must remain local to the browser.

Implemented document support is plain-text DOCX and common text-PDF extraction, editable text, visible page boundaries, physical layout, bundled ASCII stroke fonts, per-page preview/export, and unsupported-character warnings. It does not provide OCR, legacy `.doc` parsing, complete PDF rendering, rich-document formatting, or broad Unicode font coverage; do not describe those as available.

## Working practices

- Respect unrelated work and avoid destructive Git commands.
- Keep changes focused on the requested task; avoid unrelated refactoring or formatting.
- For application changes, run relevant tests plus `npm run typecheck`, `npm run lint`, and `npm run build`.
- Documentation-only changes do not require rerunning application checks.
- Do not commit, push, or deploy unless explicitly requested.
- Report what changed, verification results, necessary dependency additions, and remaining limitations.
