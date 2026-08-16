# Machine output and post-processors

Canonical movements are the authoritative, controller-independent result of image/vector conversion, placement, optimization, coordinate transformation, and depth-pass generation. A post-processor translates those completed movements into machine syntax; it never reorders, resamples, clamps, or otherwise changes their geometry.

The bundled processors are:

* **Custom / Generic G-code** — backwards-compatible custom header, footer, tool-on, and tool-off strings.
* **GRBL Pen Plotter** — GRBL unit/absolute/feed modes with explicit user-configured pen-up and pen-down commands.
* **GRBL / FluidNC Laser** — GRBL-family motion with explicit configured laser-on and laser-off commands. No power value is invented.
* **Marlin Pen Plotter** — conservative Marlin-compatible linear motion without assuming GRBL feed-mode support.
* **Generic CNC** — linear XYZ motion with required safe-Z retraction. It does not automatically enable a spindle.

A machine profile describes the user's machine and command configuration and references one trusted post-processor ID. Profiles saved before this architecture are reconstructed field-by-field; custom or malformed processor selections migrate to Generic during loading. Active serialization never silently falls back if its selected processor is unavailable.

Post-processors explicitly set supported units and absolute positioning before generated movement, establish a configured inactive tool state, avoid redundant state commands, reassert modal state after arbitrary tool commands, and finish with a conservative configured off state. Generic CNC rejects XY rapid serialization unless both endpoints are at safe Z. Custom commands remain powerful and are not fully interpreted by preflight.

Opening the UI's Advanced settings disclosure does not alter job identity or restart processing. Changing only a post-processor or command block invalidates preflight and serialized G-code while retaining completed canonical geometry; changes to machine kind or CNC pass depth regenerate canonical movements.

Machine-aware post-processing improves controller-specific output and validation but does not guarantee safe real-machine operation. Verify controller dialect, configured commands, units, coordinate convention, physical machine position, workholding, clearances, feeds, and the complete exported program before use.
