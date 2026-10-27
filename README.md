# image-to-gcode

> **Beta:** The main features are working, but bugs, incomplete areas, and performance issues should still be expected.

A browser-based image/vector/document-to-G-code utility for CNC routers, pen plotters, and generic XY laser-style machines. Sources remain local to the browser; there is no account or backend.

Try it online: https://imagetogcode.ca/

## Features

* PNG, JPEG, WebP, and native SVG import with drag/drop
* Dedicated Text / Document workflow with direct typing and local DOCX or text-PDF extraction
* Editable extracted text, explicit imported-page markers, word wrapping, margins, alignment, and separately exported output pages
* Three bundled MIT-licensed, true single-line stroke fonts with direct vector writing paths and unsupported-character warnings
* Raster scanline, contour/outline, grayscale engraving, and SVG centerline conversion
* Interactive 2D toolpath preview with work-area boundary, travel vs working moves, zoom, and playback
* Configurable dimensions, origins, offsets, axis inversion, feeds, Z depths, passes, scan spacing, and image filters
* Capability-driven machine profiles with Generic, GRBL pen, GRBL/FluidNC laser, Marlin pen, and Generic CNC post-processors
* G-code inspector with line numbers, search, copy, and `.gcode` download
* Bounds and configuration warnings plus generated movement/time statistics

## Getting started

```bash
npm install
npm run dev
```

Run quality checks with `npm test`, `npm run typecheck`, `npm run lint`, and create an optimized bundle with `npm run build`.

## Architecture

`src/core/image.ts` processes raster pixels and `conversion.ts` converts them to typed geometry. Native SVG follows a separate secure path: `src/vector/parseSvg.ts` copies supported XML geometry into a DOM-free typed model, then `flatten.ts` adaptively converts curves using the physical Toolpath Detail tolerance in the worker. Text and documents are reduced to bounded plain text in `document.worker.ts`; `src/text/layout.ts` lays out locally bundled stroke-font geometry in the toolpath worker. All sources then share coordinate transforms, packed canonical movements, statistics, preview, safety validation, and post-processing. Text intentionally bypasses path reordering/reversal so character order and authored stroke direction remain intact. Trusted modules in `src/postprocessors/` validate the selected machine capabilities and translate canonical movements into controller-specific G-code on demand in the worker. React UI code orchestrates state and rendering; uploaded source data is not persisted.

### Text and document support

Choose **Text / document** under Source workflow, then type into the editor or import one `.docx` or text-based `.pdf`. Import and decompression happen in a cancellable browser worker; the document is never uploaded. Extracted content is plain text only—document HTML and embedded content are neither rendered nor executed. PDF source-page boundaries appear as `--- DOCUMENT PAGE BREAK ---` markers in the editor and force a new output page.

The selected plotter font replaces fonts from the source document. Exact typography, columns, tables, images, headers/footers, and rich formatting are not preserved. Layout uses physical millimetres for text size, letter spacing, usable area, and margins. Explicit line breaks are retained, words wrap within the usable area, and vertical overflow creates additional output pages instead of clipping, shrinking, or overlapping content. Select, preview, preflight, and export each output page separately so paper can be changed between jobs. Preview and export are generated from the same canonical movements.

The bundled Plotter Simplex, Plotter Script, and Plotter Technical faces are original single-line centerline fonts, not outline fonts labeled as handwriting. Their MIT notice is retained in `public/fonts/LICENSE.txt`. Unsupported characters are reported visibly and occupy their normal advance rather than disappearing and collapsing the surrounding text.

DOCX support extracts the main document body and practical paragraph, tab, line-break, and page-break structure. PDF support handles common text content streams, Unicode maps, inherited resources, and PDF object streams, but it is deliberately not a complete PDF renderer. Scanned/image-only pages require OCR before import. Encrypted documents are rejected, legacy `.doc` files must first be converted to `.docx`, and corrupt, oversized, unsupported-compression, or excessively complex files produce explicit errors. Split documents that exceed the advertised limits.

### Native SVG support

SVG import supports paths (`M/L/H/V/C/S/Q/T/A/Z`, absolute and relative), lines, polylines, polygons, rectangles including rounded corners, circles, ellipses, groups, nested transforms, common `viewBox`/`preserveAspectRatio` behavior, and unitless/px/mm/cm/in/pt/pc dimensions. Stroke geometry is plotted as its centerline. Fill-only geometry is imported as an outline with a visible warning; fills are not hatched.

SVG is treated as untrusted input. Markup is never injected into the page. Scripts, event handlers, external resources and URLs, stylesheets, images, `foreignObject`, text, `use`/`symbol`, clipping, masks, filters, patterns, and gradients are ignored with deduplicated warnings where encountered. File, XML-node, nesting, path-command, parsed-segment, and flattened-point limits bound processing. SVG support is intentionally a practical geometry subset, not full SVG specification compatibility.

Transform order is SVG local geometry → nested SVG/group affine transforms → root `viewBox` mapping → physical output scaling → app placement/rotation → machine origin and axis inversion. For SVG, Toolpath Detail is the maximum adaptive curve-flattening deviation in millimetres; it does not invoke raster resampling.

## Development

This project was built using a combination of human-written code and AI-assisted coding tools. AI-generated or AI-assisted changes were reviewed by a human

## Machine profiles and export

A post-processor defines controller syntax and capabilities; a machine profile supplies the user's work area, feeds, and commands. Built-in processors are trusted bundled code—saved data cannot inject executable plugins. Older custom profiles migrate to the conservative Generic processor while retaining their command strings. Custom profiles and settings persist in localStorage. Exports use `source-name-mode.gcode`. See [Machine output and post-processors](docs/machine-output.md).

Pen and laser processors require explicit user-configured on/off commands. Generic CNC always generates standalone safe-Z retraction before XY rapid travel, but never silently starts a spindle. No processor assumes homing has occurred.

## Safety

**Generated G-code must be inspected and machine configuration verified before use.** Machine-aware post-processing and preflight improve controller-specific output and validation but do not guarantee safe real-machine operation. Toolpath visualization cannot account for workholding, fixtures, firmware behavior, tool selection, or machine limits. Incorrect commands can damage equipment or cause injury. Never run unreviewed output on a real machine.

## Limitations and roadmap

SVG text-to-outline conversion, fill hatching, CSS styling, clipping, masks, filters, gradients, referenced symbols, and external resources are not supported. SVG stroke width is retained only as metadata and does not offset centerlines. Document import does not preserve rich layout and does not perform OCR. The bundled writing fonts currently cover printable ASCII; other characters are warned about before export. Other future work could include wider Unicode stroke-font coverage, SVG export, rotary support, and richer machine post-processors. Performance and secondary features are still being improved during beta.

## Contributing

Bug reports, feature requests, and code contributions are welcome. See CONTRIBUTING.md for the beginner-friendly workflow, development checks, and pull request guidance.
