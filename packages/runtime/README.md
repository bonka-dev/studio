# Bonka Game-Side Runtime

This Apache-2.0 package contains the public, game-side C++ helpers used by
generated GBA projects. It depends on Butano but does not import Bonka Core,
the editor, or the GPL target generator.

## Initial API

`bonka/gba/sprite_runtime.h` provides:

- `sprite_clip`: a Butano sprite item, frame durations, frame count and loop
  setting, plus generated tile-byte metadata.
- `directional_sprite_set`: maps arbitrary authored angles to clips and selects
  the nearest clip for a requested angle.
- `sprite_actor`: owns one `bn::sprite_ptr`, advances its active clip and can
  change to another clip.
- `sprite_bank_manager`: queues clip changes and applies at most one per
  update. It can request either a direct clip or a clip selected from a
  directional set. Call `update()` before `bn::core::update()`.

The initial manager deliberately does not implement VRAM budgets, LRU eviction,
prefetching, compression or gameplay behavior. Those need a separate public API
design after measuring real project asset sizes and Butano allocation behavior.

GBA hardware has one shared OBJ palette for 8bpp sprites. When an actor changes
between 8bpp clips, the runtime updates that palette in place before switching
tiles. Concurrent 8bpp actors therefore require a shared palette contract; use
4bpp assets when independently colored concurrent sprites are required.

## Streamed 8bpp Clips

`bonka/gba/streamed_sprite_runtime.h` provides the opt-in streamed path for
projects that reserve the complete OBJ palette for 8bpp sprites:

- `streamed_sprite_bank_manager` deduplicates GBA RGB555 colors into stable
  global palette slots and caches remapped animation frames, not complete clips,
  in allocated OBJ tiles. It uses two EWRAM staging slots and a 2KB default
  VBlank byte budget; a first frame larger than that budget stages alone. Call
  `commit_vblank()` from the application's Butano VBlank callback to transfer
  every pending slot safely with `vram_safe_copy`.
- `sprite_bank_priority` prioritizes interactive actor changes over normal
  requests and background prefetches. Within each priority, the oldest queued
  request is staged first. `sprite_bank_state` reports whether a frame is
  queued, blocked by OBJ-VRAM pressure, or resident.
- It evicts only unreferenced, non-pending cached frames when OBJ-VRAM is
  needed. `pending_transfer_count()` and `pending_transfer_bytes()` expose
  lightweight pipeline diagnostics.
- `streamed_sprite_actor` retains its displayed frame and prefetches the next
  animation frame while it is visible. A missing frame is held until available;
  explicit clip or direction changes cancel that prefetch and remain interactive.
  Fixed-point position accessors allow movement before or after its first frame
  becomes resident. `put_above()` is safe while loading and supports dynamic
  ordering among actors in one shared Butano sprite layer. Use `detach()` before
  discarding an actor to release its frame references.

The existing `sprite_actor` and `sprite_bank_manager` remain the small,
conventional API. The streamed path is intentionally separate because a full
8bpp palette allocator has different residency and upload constraints.

GBA hardware can display 4bpp and 8bpp OBJ sprites together. The current
streamed allocator merely reserves all 256 shared OBJ palette entries, so it
cannot safely coexist with 4bpp palette banks until explicit mixed-mode palette
budgets are implemented.

## Input and Movement

`bonka/gba/input_runtime.h` defines generic GBA control, trigger and binding
descriptors. `sample_gba_input()` captures Butano's held, pressed and released
keypad states once per frame; `resolve_input_state()` combines matching bindings
into a `uint32_t` action mask.

`bonka/gba/directional_movement.h` converts four directional booleans and a
positive `bn::fixed` speed into a fixed-point delta, moving flag and facing
angle. It supports screen and 2:1 isometric projection plus optional diagonal
normalization. `apply_directional_movement()` only adds the returned delta; it
does not implement collision, entities, input action names or behavior IDs.
