# THIS IS CURRENTLY BROKEN DO NOT USE


# image-to-gcode

A browser-based image-to-G-code utility for CNC routers, pen plotters, and generic XY laser-style machines. Images remain local to the browser; there is no account or backend.

## Features

- PNG, JPEG, and WebP import with drag/drop
- Raster scanline, contour/outline, and grayscale engraving conversions
- Interactive 2D toolpath preview with work-area boundary, travel vs working moves, zoom, and playback
- Configurable dimensions, origins, offsets, axis inversion, feeds, Z depths, passes, scan spacing, and image filters
- Editable/persisted machine profiles for generic CNC, pen, and laser-style workflows
- G-code inspector with line numbers, search, copy, and `.gcode` download
- Bounds and configuration warnings plus generated movement/time statistics

## Getting started

```bash
npm install
npm run dev
```

Run quality checks with `npm test`, `npm run typecheck`, `npm run lint`, and create an optimized bundle with `npm run build`.

## Architecture

`src/core/image.ts` processes pixels, `conversion.ts` converts processed images to typed geometry, `geometry.ts` performs coordinate transforms, and `gcode.ts` serializes typed moves to machine commands. React UI code in `main.tsx` only orchestrates state and rendering.

## Machine profiles and export

Profiles intentionally do not assume spindle, laser, servo, or homing commands. Their header, footer, tool-on, and tool-off fields are designed to be configured for the actual machine. Custom profiles and settings persist in localStorage. Exports use `source-name-mode.gcode`.

## Safety

**Generated G-code must be inspected and machine configuration verified before use.** Toolpath visualization cannot account for workholding, fixtures, firmware behavior, tool selection, or machine limits. Incorrect commands can damage equipment or cause injury. Never run unreviewed output on a real machine.

## Limitations and roadmap

Contour extraction is intentionally lightweight pixel-boundary tracing; future work could add connected contour following, SVG import/export, image-processing workers, rotary support, and richer machine post-processors.

## Contributing

Please keep conversion geometry, machine transformation, and G-code serialization separate, add deterministic tests for behavioral changes, and run all checks before opening a pull request.
