// SPDX-License-Identifier: Apache-2.0
#ifndef BONKA_GBA_DIRECTIONAL_MOVEMENT_H
#define BONKA_GBA_DIRECTIONAL_MOVEMENT_H

#include "bn_assert.h"
#include "bn_fixed.h"

#include <cstdint>

namespace bonka::gba {

enum class movement_space : uint8_t {
    screen,
    isometric,
};

struct directional_movement_config {
    movement_space space = movement_space::screen;
    bn::fixed speed = 1;
    bool normalize_diagonal = true;
};

struct directional_movement_result {
    bn::fixed x_delta;
    bn::fixed y_delta;
    int facing_angle;
    bool moving;
};

[[nodiscard]] inline directional_movement_result resolve_directional_movement(
        const directional_movement_config& config, bool up, bool down, bool left, bool right,
        int previous_facing_angle) {
    BN_ASSERT(config.speed > 0, "Directional movement speed must be positive");
    const int horizontal = int(right) - int(left);
    const int vertical = int(down) - int(up);
    if(! horizontal && ! vertical) {
        return { 0, 0, previous_facing_angle, false };
    }

    bn::fixed horizontal_speed = config.speed * horizontal;
    bn::fixed vertical_speed = config.speed * vertical;
    if(config.normalize_diagonal && horizontal && vertical) {
        constexpr bn::fixed inverse_square_root_two = bn::fixed::from_data(2896);
        horizontal_speed *= inverse_square_root_two;
        vertical_speed *= inverse_square_root_two;
    }

    if(config.space == movement_space::screen) {
        const int angle = vertical < 0 ? (horizontal < 0 ? 315 : horizontal > 0 ? 45 : 0) :
                vertical > 0 ? (horizontal < 0 ? 225 : horizontal > 0 ? 135 : 180) :
                horizontal < 0 ? 270 : 90;
        return { horizontal_speed, vertical_speed, angle, true };
    }

    const int angle = vertical < 0 ? (horizontal < 0 ? 270 : horizontal > 0 ? 0 : 300) :
            vertical > 0 ? (horizontal < 0 ? 180 : horizontal > 0 ? 90 : 120) :
            horizontal < 0 ? 240 : 60;
    return {
        horizontal_speed + vertical_speed,
        (vertical_speed - horizontal_speed) / 2,
        angle,
        true,
    };
}

inline void apply_directional_movement(
        const directional_movement_result& movement, bn::fixed& x, bn::fixed& y) {
    x += movement.x_delta;
    y += movement.y_delta;
}

}

#endif
