// SPDX-License-Identifier: Apache-2.0
#ifndef BONKA_GBA_STREAMED_SPRITE_RUNTIME_H
#define BONKA_GBA_STREAMED_SPRITE_RUNTIME_H

#include "bonka/gba/sprite_runtime.h"

#include "bn_array.h"
#include "bn_fixed.h"
#include "bn_fixed_point.h"
#include "bn_memory.h"
#include "bn_optional.h"
#include "bn_sprite_palette_item.h"
#include "bn_sprite_palette_ptr.h"
#include "bn_sprite_tiles_ptr.h"

namespace bonka::gba {

enum class sprite_bank_priority : uint8_t {
    prefetch,
    normal,
    interactive,
};

enum class sprite_bank_state : uint8_t {
    missing,
    queued,
    blocked,
    resident,
};

// Each cache entry owns one remapped 8bpp animation frame. The transfer staging
// buffers live in EWRAM so update() never puts frame-sized data on the stack.
template<int MaxCachedFrames = 32, int MaxTilesPerFrame = 128,
         int MaxPendingTransfers = 2, int VblankByteBudget = 2048>
class streamed_sprite_bank_manager {
    static_assert(MaxPendingTransfers >= 2, "Streaming needs at least two pending transfers");
public:
    streamed_sprite_bank_manager() :
        _palette_item(bn::span<const bn::color>(_colors.data(), 256), bn::bpp_mode::BPP_8),
        _palette(_palette_item.create_palette()) {
        for(pending_transfer& pending : _pending) {
            pending.staging = static_cast<bn::tile*>(bn::memory::ewram_calloc(MaxTilesPerFrame, sizeof(bn::tile)));
            BN_ASSERT(pending.staging, "Unable to allocate streamed sprite staging in EWRAM");
        }
    }

    ~streamed_sprite_bank_manager() {
        for(pending_transfer& pending : _pending) {
            bn::memory::ewram_free(pending.staging);
        }
    }

    streamed_sprite_bank_manager(const streamed_sprite_bank_manager&) = delete;
    streamed_sprite_bank_manager& operator=(const streamed_sprite_bank_manager&) = delete;

    [[nodiscard]] bool request(const sprite_clip& clip, int frame_index,
                               sprite_bank_priority priority = sprite_bank_priority::normal) {
        BN_ASSERT(clip.item.palette_item().bpp() == bn::bpp_mode::BPP_8,
                  "Streamed sprite frames require 8bpp clips");
        BN_ASSERT(frame_index >= 0 && frame_index < clip.frame_count, "Invalid clip frame index");
        const int existing_index = _find(clip, frame_index);
        if(existing_index >= 0) {
            frame& existing = _frames[existing_index];
            ++existing.requests;
            if(priority > existing.priority) {
                existing.priority = priority;
            }
            return true;
        }

        // Keep room for an interactive actor to replace its current frame and
        // prefetch its successor instead of filling OBJ VRAM with ambient look-ahead.
        if(priority == sprite_bank_priority::prefetch &&
           _occupied_frame_count() >= MaxCachedFrames - interactive_frame_reserve) {
            return false;
        }

        const int index = _available_frame();
        if(index < 0) {
            return false;
        }
        frame& target = _frames[index];
        _release(target);
        target.clip = &clip;
        target.frame_index = frame_index;
        target.loading = true;
        target.requests = 1;
        target.priority = priority;
        target.queued_at = _next_queue_order++;
        const bn::span<const bn::color>& colors = clip.item.palette_item().colors_ref();
        for(int color_index = 1; color_index < colors.size(); ++color_index) {
            const int palette_index = _acquire_color(colors[color_index]);
            if(palette_index < 0) {
                target.requests = 0;
                _release(target);
                return false;
            }
            target.palette_indices[color_index] = uint8_t(palette_index);
        }
        _palette.set_colors(bn::span<const bn::color>(_colors.data(), 256));
        return true;
    }

    void promote(const sprite_clip& clip, int frame_index, sprite_bank_priority priority) {
        const int index = _find(clip, frame_index);
        if(index >= 0 && priority > _frames[index].priority) {
            _frames[index].priority = priority;
        }
    }

    void cancel_request(const sprite_clip& clip, int frame_index) {
        const int index = _find(clip, frame_index);
        if(index < 0) {
            return;
        }
        frame& target = _frames[index];
        BN_ASSERT(target.requests > 0, "Frame has no pending requests");
        --target.requests;
        if(! target.requests && ! target.users && ! _pending_tiles_for(index)) {
            _release(target);
        }
    }

    // Fill the VBlank pipeline fairly. The first oversized frame is allowed to
    // occupy the pipeline by itself; later frames wait for the next update.
    void update() {
        ++_clock;
        int staged_bytes = pending_transfer_bytes();
        for(int slot_index = 0; slot_index < MaxPendingTransfers; ++slot_index) {
            if(_pending[slot_index].tiles) {
                continue;
            }
            const int selected_index = _next_queued_frame();
            if(selected_index < 0) {
                return;
            }
            frame& target = _frames[selected_index];
            const bn::span<const bn::tile> source = target.clip->item.tiles_item().graphics_tiles_ref(target.frame_index);
            BN_ASSERT(source.size() <= MaxTilesPerFrame,
                      "Frame has too many tiles: ", source.size(), " - ", MaxTilesPerFrame);
            const int byte_count = source.size() * int(sizeof(bn::tile));
            if(staged_bytes && staged_bytes + byte_count > VblankByteBudget) {
                return;
            }
            bn::optional<bn::sprite_tiles_ptr> tiles = bn::sprite_tiles_ptr::allocate_optional(
                    source.size(), bn::bpp_mode::BPP_8);
            if(! tiles) {
                if(! _evict_unused_frame(selected_index)) {
                    target.blocked = true;
                }
                return;
            }
            target.blocked = false;
            pending_transfer& pending = _pending[slot_index];
            const auto* source_bytes = reinterpret_cast<const uint8_t*>(source.data());
            auto* staging_bytes = reinterpret_cast<uint8_t*>(pending.staging);
            for(int byte_index = 0; byte_index < byte_count; ++byte_index) {
                staging_bytes[byte_index] = target.palette_indices[source_bytes[byte_index]];
            }
            pending.frame_index = selected_index;
            pending.byte_count = byte_count;
            pending.tiles = bn::move(*tiles);
            staged_bytes += byte_count;
            // An oversized first frame is deliberately the only staged transfer.
            if(byte_count > VblankByteBudget) {
                return;
            }
        }
    }

    // Call from the application's Butano VBlank callback.
    void commit_vblank() {
        for(pending_transfer& pending : _pending) {
            if(! pending.tiles) {
                continue;
            }
            bn::optional<bn::span<bn::tile>> destination = pending.tiles->vram();
            BN_ASSERT(destination, "Allocated sprite tiles are missing VRAM");
            bn::memory::vram_safe_copy(pending.staging, pending.byte_count, destination->data());
            frame& target = _frames[pending.frame_index];
            target.tiles = bn::move(*pending.tiles);
            target.loading = false;
            target.last_used = _clock;
            pending.tiles.reset();
            pending.frame_index = -1;
            pending.byte_count = 0;
        }
    }

    [[nodiscard]] int pending_transfer_count() const {
        int count = 0;
        for(const pending_transfer& pending : _pending) {
            count += bool(pending.tiles);
        }
        return count;
    }

    [[nodiscard]] int pending_transfer_bytes() const {
        int bytes = 0;
        for(const pending_transfer& pending : _pending) {
            bytes += pending.byte_count;
        }
        return bytes;
    }

    [[nodiscard]] int resident_frame(const sprite_clip& clip, int frame_index) const {
        const int index = _find(clip, frame_index);
        return index >= 0 && ! _frames[index].loading ? index : -1;
    }

    [[nodiscard]] sprite_bank_state state(const sprite_clip& clip, int frame_index) const {
        const int index = _find(clip, frame_index);
        if(index < 0) return sprite_bank_state::missing;
        const frame& target = _frames[index];
        if(! target.loading) return sprite_bank_state::resident;
        return target.blocked ? sprite_bank_state::blocked : sprite_bank_state::queued;
    }

    [[nodiscard]] const bn::sprite_tiles_ptr& frame_tiles(int frame_index) const { return *_frames[frame_index].tiles; }
    [[nodiscard]] const bn::sprite_palette_ptr& palette() const { return _palette; }

    void retain(int frame_index) {
        frame& target = _frames[frame_index];
        BN_ASSERT(target.tiles, "Cannot retain an unloaded frame");
        ++target.users;
        target.last_used = _clock;
    }

    void release(int frame_index) {
        frame& target = _frames[frame_index];
        BN_ASSERT(target.users > 0, "Frame has no users");
        --target.users;
        target.last_used = _clock;
    }

private:
    static constexpr int interactive_frame_reserve = MaxCachedFrames > 2 ? 2 : 0;

    struct frame {
        const sprite_clip* clip = nullptr;
        bn::optional<bn::sprite_tiles_ptr> tiles;
        bn::array<uint8_t, 256> palette_indices = {};
        int frame_index = 0;
        int users = 0;
        int requests = 0;
        int last_used = 0;
        int queued_at = 0;
        sprite_bank_priority priority = sprite_bank_priority::prefetch;
        bool loading = false;
        bool blocked = false;
    };

    struct pending_transfer {
        bn::tile* staging = nullptr;
        bn::optional<bn::sprite_tiles_ptr> tiles;
        int frame_index = -1;
        int byte_count = 0;
    };

    [[nodiscard]] int _find(const sprite_clip& clip, int frame_index) const {
        for(int index = 0; index < MaxCachedFrames; ++index) {
            const frame& candidate = _frames[index];
            if(candidate.clip == &clip && candidate.frame_index == frame_index) return index;
        }
        return -1;
    }

    [[nodiscard]] int _available_frame() const {
        int oldest = -1;
        for(int index = 0; index < MaxCachedFrames; ++index) {
            const frame& candidate = _frames[index];
            if(! candidate.clip) return index;
            if(! candidate.loading && ! candidate.users && ! candidate.requests &&
               (oldest < 0 || candidate.last_used < _frames[oldest].last_used)) oldest = index;
        }
        return oldest;
    }

    [[nodiscard]] int _occupied_frame_count() const {
        int count = 0;
        for(const frame& candidate : _frames) {
            count += candidate.clip != nullptr;
        }
        return count;
    }

    [[nodiscard]] int _next_queued_frame() const {
        int selected = -1;
        for(int index = 0; index < MaxCachedFrames; ++index) {
            const frame& candidate = _frames[index];
            if(! candidate.loading || ! candidate.requests || _pending_tiles_for(index)) continue;
            if(selected < 0 || candidate.priority > _frames[selected].priority ||
               (candidate.priority == _frames[selected].priority && candidate.queued_at < _frames[selected].queued_at)) selected = index;
        }
        return selected;
    }

    [[nodiscard]] bool _pending_tiles_for(int index) const {
        for(const pending_transfer& pending : _pending) {
            if(pending.tiles && pending.frame_index == index) return true;
        }
        return false;
    }

    bool _evict_unused_frame(int excluded_index) {
        int oldest = -1;
        for(int index = 0; index < MaxCachedFrames; ++index) {
            const frame& candidate = _frames[index];
            if(index == excluded_index || ! candidate.clip || candidate.users || candidate.requests ||
               candidate.loading || _pending_tiles_for(index)) continue;
            if(oldest < 0 || candidate.last_used < _frames[oldest].last_used) oldest = index;
        }
        if(oldest < 0) return false;
        _release(_frames[oldest]);
        return true;
    }

    [[nodiscard]] int _acquire_color(bn::color color) {
        for(int index = 1; index < 256; ++index) {
            if(_color_references[index] && _colors[index] == color) {
                ++_color_references[index];
                return index;
            }
        }
        for(int index = 1; index < 256; ++index) {
            if(! _color_references[index]) {
                _colors[index] = color;
                _color_references[index] = 1;
                return index;
            }
        }
        return -1;
    }

    void _release(frame& target) {
        if(! target.clip) return;
        BN_ASSERT(! target.users && ! target.requests && ! _pending_tiles_for(int(&target - _frames.data())),
                  "Cannot evict a referenced frame");
        const int colors_count = target.clip->item.palette_item().colors_ref().size();
        for(int color_index = 1; color_index < colors_count; ++color_index) {
            const int palette_index = target.palette_indices[color_index];
            BN_ASSERT(_color_references[palette_index], "Palette reference is missing");
            --_color_references[palette_index];
        }
        target.tiles.reset();
        target.palette_indices.fill(0);
        target = frame();
    }

    bn::array<frame, MaxCachedFrames> _frames;
    bn::array<pending_transfer, MaxPendingTransfers> _pending;
    alignas(int) bn::array<bn::color, 256> _colors = {};
    bn::array<uint16_t, 256> _color_references = {};
    bn::sprite_palette_item _palette_item;
    bn::sprite_palette_ptr _palette;
    int _clock = 0;
    int _next_queue_order = 0;
};

template<int MaxCachedFrames = 32, int MaxTilesPerFrame = 128, int MaxPendingTransfers = 2, int VblankByteBudget = 2048>
class streamed_sprite_actor {
    using bank_type = streamed_sprite_bank_manager<MaxCachedFrames, MaxTilesPerFrame, MaxPendingTransfers, VblankByteBudget>;
public:
    streamed_sprite_actor(bank_type& banks, const sprite_clip& clip, bn::fixed x, bn::fixed y, int z_order = 0,
                           sprite_bank_priority priority = sprite_bank_priority::normal) :
        _requested(&clip), _x(x), _y(y), _z_order(z_order), _priority(priority) {
        _has_request = banks.request(clip, 0, priority);
    }

    void request(bank_type& banks, const sprite_clip& clip,
                 sprite_bank_priority priority = sprite_bank_priority::normal) {
        if(_requested == &clip && _requested_frame == 0) {
            _priority = priority;
            banks.promote(clip, 0, priority);
            return;
        }
        _cancel_request(banks);
        _cancel_prefetch(banks);
        _requested = &clip;
        _requested_frame = 0;
        _priority = priority;
        _has_request = banks.request(clip, 0, priority);
    }

    void detach(bank_type& banks) {
        _cancel_request(banks);
        _cancel_prefetch(banks);
        if(_frame_cache_index >= 0) banks.release(_frame_cache_index);
        _frame_cache_index = -1;
        _requested = nullptr;
        _active = nullptr;
        _sprite.reset();
    }

    [[nodiscard]] bn::fixed x() const {
        return _x;
    }

    [[nodiscard]] bn::fixed y() const {
        return _y;
    }

    [[nodiscard]] bn::fixed_point position() const {
        return bn::fixed_point(_x, _y);
    }

    void set_position(bn::fixed x, bn::fixed y) {
        _x = x;
        _y = y;
        if(_sprite) {
            _sprite->set_position(x, y);
        }
    }

    // It is safe to call this while the first streamed frame is still loading.
    void put_above() {
        if(_sprite) {
            _sprite->put_above();
        }
    }

    void update(bank_type& banks) {
        if(_has_request) {
            const int index = banks.resident_frame(*_requested, _requested_frame);
            if(index >= 0) _display(banks, index, *_requested, _requested_frame);
        } else if(_requested && _requested != _active) {
            // A full request queue must not leave an already-visible actor on
            // its old clip forever. Keep retrying the requested clip on later frames.
            _has_request = banks.request(*_requested, _requested_frame, _priority);
        }
        if(_requested != _active) {
            // Keep the old frame visible while the desired clip loads, but do
            // not queue or display more frames from the superseded clip.
            return;
        }
        if(! _sprite || ! _active) return;
        _ensure_prefetch(banks);
        ++_ticks;
        if(_ticks < _active->frame_durations[_frame]) return;
        if(_has_prefetch) {
            const int index = banks.resident_frame(*_prefetched, _prefetched_frame);
            if(index >= 0) _display_prefetched(banks, index);
        }
        // If the prefetch has not arrived, keep the current frame visible.
    }

private:
    void _display(bank_type& banks, int index, const sprite_clip& clip, int frame) {
        _cancel_prefetch(banks);
        if(_sprite) {
            _sprite->set_tiles(clip.item.shape_size(), banks.frame_tiles(index));
        } else {
            _sprite.emplace(bn::sprite_ptr::create(_x, _y, clip.item.shape_size(), banks.frame_tiles(index), banks.palette()));
            _sprite->set_z_order(_z_order);
        }
        banks.retain(index);
        _cancel_request(banks);
        if(_frame_cache_index >= 0) banks.release(_frame_cache_index);
        _frame_cache_index = index;
        _active = &clip;
        _frame = frame;
        _ticks = 0;
        _ensure_prefetch(banks);
    }

    void _display_prefetched(bank_type& banks, int index) {
        const sprite_clip* clip = _prefetched;
        const int frame = _prefetched_frame;
        _has_prefetch = false;
        _sprite->set_tiles(clip->item.shape_size(), banks.frame_tiles(index));
        banks.retain(index);
        banks.cancel_request(*clip, frame);
        if(_frame_cache_index >= 0) banks.release(_frame_cache_index);
        _frame_cache_index = index;
        _active = clip;
        _frame = frame;
        _ticks = 0;
        _ensure_prefetch(banks);
    }

    void _ensure_prefetch(bank_type& banks) {
        if(_has_prefetch || ! _active) return;
        int next = _frame + 1;
        if(next == _active->frame_count) {
            if(! _active->loop) return;
            next = 0;
        }
        _prefetched = _active;
        _prefetched_frame = next;
        const sprite_bank_priority priority = _priority == sprite_bank_priority::interactive ?
                sprite_bank_priority::interactive : sprite_bank_priority::prefetch;
        _has_prefetch = banks.request(*_prefetched, next, priority);
    }

    void _cancel_request(bank_type& banks) {
        if(_has_request) {
            banks.cancel_request(*_requested, _requested_frame);
            _has_request = false;
        }
    }

    void _cancel_prefetch(bank_type& banks) {
        if(_has_prefetch) {
            banks.cancel_request(*_prefetched, _prefetched_frame);
            _has_prefetch = false;
        }
    }

    bn::optional<bn::sprite_ptr> _sprite;
    const sprite_clip* _requested;
    const sprite_clip* _active = nullptr;
    const sprite_clip* _prefetched = nullptr;
    bn::fixed _x;
    bn::fixed _y;
    int _z_order;
    int _frame_cache_index = -1;
    int _requested_frame = 0;
    int _prefetched_frame = 0;
    int _frame = 0;
    int _ticks = 0;
    sprite_bank_priority _priority;
    bool _has_request = false;
    bool _has_prefetch = false;
};

}

#endif
