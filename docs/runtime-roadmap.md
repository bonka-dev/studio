# Runtime Roadmap

This document records planned game-side runtime work after the current v0.4
sprite-streaming slice. It is a design roadmap, not part of Project Format v1
and not a promise of a stable API.

## v0.4 Completion

Complete and validate the 8bpp frame-cache path before beginning palette-mode
work:

- Prefetch the next animation frame while the current frame is displayed.
- Prepare multiple frame uploads within a measured VBlank byte budget.
- Keep the staging buffers out of the constrained IWRAM stack.
- Report VBlank use, cache pressure and queued frame requests during the ROM
  stress test.
- Generate screen-foot offsets and dynamically order actors within one shared
  Butano sprite z layer.

The v0.4 runtime remains an opt-in 8bpp streaming helper. It reserves the
complete OBJ palette for dynamically deduplicated colors.

## v0.5: OBJ Graphics Modes

Explore configurable OBJ graphics modes for projects that need different
tradeoffs between per-sprite color count and tile-VRAM density:

| Mode | Intended use | Palette contract |
| --- | --- | --- |
| `4bpp` | Many low-color sprites, effects and UI | Up to 16 fixed OBJ palette banks with 16 indices each. |
| `8bpp` | Color-rich sprites and shared-color actors | One dynamically managed OBJ palette pool. |
| `mixed` | 4bpp supporting sprites plus 8bpp focal sprites | Reserved 4bpp palette banks and a separate 8bpp palette-slot pool. |

The GBA has one shared 32 KB OBJ tile-VRAM region and one shared 256-entry OBJ
palette. It does not expose physically separate 4bpp and 8bpp regions. In
mixed mode, Bonka must therefore enforce logical budgets:

- 4bpp tiles consume 32 bytes per 8x8 tile; 8bpp tiles consume 64 bytes.
- 4bpp OBJ sprites select exactly one 16-color palette bank per OAM sprite.
- 8bpp OBJ sprites address the shared 256-entry palette directly.
- Reserved 4bpp palette banks must not be changed by the 8bpp streaming
  allocator.
- Tile-VRAM and palette budgets are independent. Reserving half the tile VRAM
  for each format does not by itself reserve compatible palette capacity.

### Configuration Direction

Do not add a Project Format v1 field yet. First establish a runtime and target
contract using generated project-local configuration. The future project-facing
setting should select a mode and express explicit budgets rather than assuming
an even hardware split:

```text
OBJ graphics mode: 4bpp | 8bpp | mixed
4bpp palette banks: 0..16
8bpp palette slots: remaining shared entries
4bpp tile budget: bytes
8bpp tile budget: bytes
```

Mixed-mode validation must reject overlapping palette reservations and report
tile-VRAM budgets that cannot accommodate the requested visible frames.

### Runtime Scope

- Keep palette allocation and tile caching generic; no Player, Enemy, movement
  or gameplay roles belong in the runtime.
- Support concurrent 4bpp and 8bpp tile allocations within their declared
  budgets.
- Make cache pressure and palette exhaustion observable to a game and to the
  target generator.
- Preserve the current Apache-2.0 runtime boundary. The GPL target generator
  may generate project-specific descriptors and budget configuration, but the
  runtime must not import Core or generator code.

### Validation Targets

- A 4bpp-only scene uses independent palette banks and has twice the tile
  density of equivalent 8bpp frames.
- An 8bpp-only scene retains the current deduplicated shared-palette behavior.
- A mixed scene displays both formats concurrently without modifying reserved
  4bpp palette entries.
- Exhaustion reports identify whether OBJ tile VRAM, 4bpp palette banks or the
  8bpp palette pool caused the failure.
- Hardware or emulator stress tests remain within VBlank and OAM limits.

## Later: Multi-OAM Actors

GBA hardware limits one OAM sprite to 64x64 pixels. Larger sprites require a
separate future slice that composes multiple OAM sprites under one generic
actor. It must budget all constituent tiles and OAM entries, preserve the
actor's screen-foot depth, and account for the 128 total and 32-per-scanline
OBJ limits. This work is compatible with both 4bpp and 8bpp modes but is not a
prerequisite for v0.5 palette-mode exploration.
