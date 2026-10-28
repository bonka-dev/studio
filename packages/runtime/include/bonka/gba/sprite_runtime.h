// SPDX-License-Identifier: Apache-2.0
#ifndef BONKA_GBA_SPRITE_RUNTIME_H
#define BONKA_GBA_SPRITE_RUNTIME_H

#include "bn_sprite_item.h"
#include "bn_sprite_palette_ptr.h"
#include "bn_sprite_ptr.h"
#include "bn_sprite_tiles_ptr.h"
#include "bn_vector.h"

namespace bonka::gba {

struct sprite_clip {
    const bn::sprite_item& item;
    const int* frame_durations;
    int frame_count;
    bool loop;
    int tile_bytes;
};

struct directional_sprite_variant {
    int angle;
    const sprite_clip& clip;
};

class directional_sprite_set;

struct directional_sprite_set_descriptor {
    const char* sprite_asset_id;
    const char* set_id;
    const directional_sprite_set& set;
};

class directional_sprite_set {
public:
    constexpr directional_sprite_set(const directional_sprite_variant* variants, int variant_count) :
        _variants(variants),
        _variant_count(variant_count) {
    }

    [[nodiscard]] const directional_sprite_variant& nearest_variant(int angle, int preferred_angle) const {
        const directional_sprite_variant* nearest = _variants;
        int nearest_distance = _distance(nearest->angle, angle);
        int preferred_distance = _distance(nearest->angle, preferred_angle);
        for(int index = 1; index < _variant_count; ++index) {
            const directional_sprite_variant& candidate = _variants[index];
            const int distance = _distance(candidate.angle, angle);
            const int candidate_preferred_distance = _distance(candidate.angle, preferred_angle);
            if(distance < nearest_distance ||
               (distance == nearest_distance && candidate_preferred_distance < preferred_distance)) {
                nearest = &candidate;
                nearest_distance = distance;
                preferred_distance = candidate_preferred_distance;
            }
        }
        return *nearest;
    }

    [[nodiscard]] const directional_sprite_variant& nearest_variant(int angle) const {
        return nearest_variant(angle, angle);
    }

    [[nodiscard]] const sprite_clip& nearest_clip(int angle, int preferred_angle) const {
        return nearest_variant(angle, preferred_angle).clip;
    }

    [[nodiscard]] const sprite_clip& nearest_clip(int angle) const {
        return nearest_variant(angle).clip;
    }

private:
    [[nodiscard]] static constexpr int _distance(int first, int second) {
        int difference = _normalize(first) - _normalize(second);
        if(difference < 0) {
            difference = -difference;
        }
        return difference > 180 ? 360 - difference : difference;
    }

    [[nodiscard]] static constexpr int _normalize(int angle) {
        angle %= 360;
        return angle < 0 ? angle + 360 : angle;
    }

    const directional_sprite_variant* _variants;
    int _variant_count;
};

class sprite_actor {
public:
    sprite_actor(const sprite_clip& clip, int x, int y) :
        _sprite(clip.item.create_sprite(x, y)),
        _clip(&clip) {
    }

    void set_clip(const sprite_clip& clip) {
        if(clip.item.palette_item().bpp() == bn::bpp_mode::BPP_8) {
            // GBA sprites share one 8bpp OBJ palette, so replace its colors in place.
            bn::sprite_palette_ptr palette = _sprite.palette();
            palette.set_colors(clip.item.palette_item());
            _sprite.set_tiles(clip.item.tiles_item(), 0);
        } else {
            _sprite.set_tiles_and_palette(
                    clip.item.tiles_item().create_tiles(), clip.item.palette_item().create_palette());
        }
        _clip = &clip;
        _frame = 0;
        _ticks = 0;
    }

    void update() {
        ++_ticks;
        if(_ticks < _clip->frame_durations[_frame]) {
            return;
        }

        _ticks = 0;
        if(_frame + 1 < _clip->frame_count) {
            ++_frame;
        } else if(_clip->loop) {
            _frame = 0;
        } else {
            return;
        }
        _sprite.set_tiles(_clip->item.tiles_item(), _frame);
    }

private:
    bn::sprite_ptr _sprite;
    const sprite_clip* _clip;
    int _frame = 0;
    int _ticks = 0;
};

class sprite_bank_manager {
private:
    struct pending_request {
        sprite_actor* actor;
        const sprite_clip* clip;
    };

public:
    [[nodiscard]] bool request(sprite_actor& actor, const sprite_clip& clip) {
        for(pending_request& pending : _pending) {
            if(pending.actor == &actor) {
                pending.clip = &clip;
                return true;
            }
        }
        if(_pending.full()) {
            return false;
        }
        _pending.push_back({ &actor, &clip });
        return true;
    }

    [[nodiscard]] bool request(sprite_actor& actor, const directional_sprite_set& set, int angle) {
        return request(actor, set.nearest_clip(angle));
    }

    bool update() {
        if(_pending.empty()) {
            return false;
        }
        pending_request pending = _pending.front();
        _pending.erase(_pending.begin());
        pending.actor->set_clip(*pending.clip);
        return true;
    }

    bn::vector<pending_request, 8> _pending;
};

}

#endif
