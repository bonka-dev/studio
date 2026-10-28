# Bonka GBA Target

GPL-3.0-or-later Project Format v1 to Butano build-input generator.
It writes disposable, project-specific output only below a project's `.bonka/`
directory.

Every declared sprite animation is emitted as a separate Butano graphics input.
For sprites with directional sets, the generated `*_clips.h` header also emits
the generic runtime descriptors that map authored angles to clips. This keeps
unselected clips, such as a walk set, available to game-side code without
adding game behavior to the generator.

The target also emits three generic lookup surfaces:

- `bonka_selected_input.h` maps the selected input map's action IDs to stable
  `uint32_t` bits and emits compact GBA control/trigger bindings.
- `bonka_sprite_registry.h` lists every generated directional set by sprite
  asset ID and set ID.
- `bonka_start_scene_entities.h` stores each behavior's resolved subscription
  mask and opaque scalar parameters. Numbers are rounded once to signed Q20.12,
  the fixed-point representation used by Butano's `bn::fixed`.

The target does not interpret behavior IDs or parameter names. Applications
choose which descriptors to consume.
