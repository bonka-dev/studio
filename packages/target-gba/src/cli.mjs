#!/usr/bin/env node

import { generateGbaProject } from "./index.mjs";

function projectFileFromArgs(argv) {
    if(argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
        return null;
    }
    if(! argv.length) {
        return "bonka.config.json";
    }
    if(argv.length === 2 && argv[0] === "--project") {
        return argv[1];
    }
    throw new Error("Usage: node packages/target-gba/src/cli.mjs [--project bonka.config.json]");
}

try {
    const projectFile = projectFileFromArgs(process.argv.slice(2));
    if(projectFile === null) {
        process.stdout.write("Usage: node packages/target-gba/src/cli.mjs [--project bonka.config.json]\n");
        process.exitCode = 0;
    } else {
        const result = await generateGbaProject(projectFile);
        process.stdout.write(`Generated ${result.files.length} GBA build inputs in ${result.project.generatedDir}\n`);
    }
} catch(error) {
    process.stderr.write(`Bonka GBA generation failed: ${error.message}\n`);
    process.exitCode = 1;
}
