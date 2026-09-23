import assert from "node:assert/strict";
import { test } from "node:test";

import { BonkaProjectError, validateDocument } from "../src/index.mjs";

test("rejects a project document missing required fields", () => {
    assert.throws(
        () => validateDocument("project", { formatVersion: 1 }, "fixture/project.json"),
        error => error instanceof BonkaProjectError
            && error.message.includes("fixture/project.json/name")
    );
});

test("rejects unknown entity components", () => {
    assert.throws(
        () => validateDocument("entity", {
            formatVersion: 1,
            type: "entity",
            id: "sample-entity",
            name: "Sample Entity",
            components: {
                unknown: {},
            },
        }),
        error => error instanceof BonkaProjectError
            && error.message.includes("additional properties")
    );
});
