# image-to-gcode

> **Beta:** The main features are working, but bugs, incomplete areas, and performance issues should still be expected.

A browser-based image/vector-to-G-code utility for CNC routers, pen plotters, and generic XY laser-style machines. Sources remain local to the browser; there is no account or backend.

Try it online: https://imagetogcode.ca/

## Features

* PNG, JPEG, WebP, and native SVG import with drag/drop
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

`src/core/image.ts` processes raster pixels and `conversion.ts` converts them to typed geometry. Native SVG follows a separate secure path: `src/vector/parseSvg.ts` copies supported XML geometry into a DOM-free typed model, then `flatten.ts` adaptively converts curves using the physical Toolpath Detail tolerance in the worker. Both sources then share toolpath optimization, coordinate transforms, packed canonical movements, statistics, and preview. Trusted modules in `src/postprocessors/` validate the selected machine capabilities and translate those canonical movements into controller-specific G-code on demand in the worker. React UI code orchestrates state and rendering; uploaded source data is not persisted.

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

SVG text-to-outline conversion, fill hatching, CSS styling, clipping, masks, filters, gradients, referenced symbols, and external resources are not supported. SVG stroke width is retained only as metadata and does not offset centerlines. Other future work could include SVG export, rotary support, and richer machine post-processors. Performance and secondary features are still being improved during beta.

## Contributing

Bug reports, feature requests, and code contributions are welcome. See CONTRIBUTING.md for the beginner-friendly workflow, development checks, and pull request guidance.
