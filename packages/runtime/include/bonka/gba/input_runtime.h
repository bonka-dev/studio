// SPDX-License-Identifier: Apache-2.0
#ifndef BONKA_GBA_INPUT_RUNTIME_H
#define BONKA_GBA_INPUT_RUNTIME_H

#include "bn_keypad.h"

#include <cstdint>

namespace bonka::gba {

enum class input_trigger : uint8_t {
    held,
    pressed,
    released,
};

enum class gba_control : uint16_t {
    a = uint16_t(bn::keypad::key_type::A),
    b = uint16_t(bn::keypad::key_type::B),
    select = uint16_t(bn::keypad::key_type::SELECT),
    start = uint16_t(bn::keypad::key_type::START),
    right = uint16_t(bn::keypad::key_type::RIGHT),
    left = uint16_t(bn::keypad::key_type::LEFT),
    up = uint16_t(bn::keypad::key_type::UP),
    down = uint16_t(bn::keypad::key_type::DOWN),
    r = uint16_t(bn::keypad::key_type::R),
    l = uint16_t(bn::keypad::key_type::L),
};

struct input_binding_descriptor {
    uint32_t action_mask;
    gba_control control;
    input_trigger trigger;
};

struct gba_input_sample {
    uint16_t held;
    uint16_t pressed;
    uint16_t released;
};

[[nodiscard]] inline gba_input_sample sample_gba_input() {
    gba_input_sample result = {};
    constexpr bn::keypad::key_type keys[] = {
        bn::keypad::key_type::A,
        bn::keypad::key_type::B,
        bn::keypad::key_type::SELECT,
        bn::keypad::key_type::START,
        bn::keypad::key_type::RIGHT,
        bn::keypad::key_type::LEFT,
        bn::keypad::key_type::UP,
        bn::keypad::key_type::DOWN,
        bn::keypad::key_type::R,
        bn::keypad::key_type::L,
    };
    for(bn::keypad::key_type key : keys) {
        const uint16_t bit = uint16_t(key);
        if(bn::keypad::held(key)) result.held |= bit;
        if(bn::keypad::pressed(key)) result.pressed |= bit;
        if(bn::keypad::released(key)) result.released |= bit;
    }
    return result;
}

[[nodiscard]] inline uint32_t resolve_input_state(
        const gba_input_sample& sample, const input_binding_descriptor* bindings, int binding_count) {
    uint32_t result = 0;
    for(int index = 0; index < binding_count; ++index) {
        const input_binding_descriptor& binding = bindings[index];
        const uint16_t control = uint16_t(binding.control);
        const uint16_t state = binding.trigger == input_trigger::held ? sample.held :
                binding.trigger == input_trigger::pressed ? sample.pressed : sample.released;
        if(state & control) {
            result |= binding.action_mask;
        }
    }
    return result;
}

}

#endif
