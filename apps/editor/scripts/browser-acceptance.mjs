// SPDX-License-Identifier: GPL-3.0-or-later

import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:8000";
const timeout = 15_000;

function assert(condition, message) {
    if(!condition) throw new Error(message);
}

async function exists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function findBrowser() {
    const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : process.platform === "win32" ? [
        join(process.env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
        join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
        join(process.env.PROGRAMFILES || "C:\\Program Files", "Chromium/Application/chrome.exe"),
        join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft/Edge/Application/msedge.exe"),
        join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    ] : process.platform === "darwin" ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ] : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
    ];
    for(const candidate of candidates.filter(Boolean)) {
        if(await exists(candidate)) return candidate;
    }
    return null;
}

async function unusedPort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function poll(action, description, wait = timeout) {
    const started = Date.now();
    let lastError;
    while(Date.now() - started < wait) {
        try {
            const value = await action();
            if(value) return value;
        } catch(error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpClient {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
    }

    async open() {
        await new Promise((resolve, reject) => {
            this.socket.addEventListener("open", resolve, { once: true });
            this.socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools")), { once: true });
        });
        this.socket.addEventListener("message", event => {
            const message = JSON.parse(event.data);
            if(message.id) {
                const pending = this.pending.get(message.id);
                if(!pending) return;
                this.pending.delete(message.id);
                if(message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
                else pending.resolve(message.result);
                return;
            }
            for(const listener of this.listeners.get(message.method) ?? []) listener(message.params);
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { method, resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    on(method, listener) {
        const listeners = this.listeners.get(method) ?? [];
        listeners.push(listener);
        this.listeners.set(method, listeners);
    }

    close() {
        this.socket.close();
    }
}

const mockFileSystemSource = String.raw`
(() => {
    const notFound = name => new DOMException(name + " was not found", "NotFoundError");
    const bytes = async value => {
        if(typeof value === "string") return new TextEncoder().encode(value);
        if(value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
        if(value instanceof ArrayBuffer) return new Uint8Array(value);
        if(ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        if(value && value.type === "write") return bytes(value.data);
        throw new TypeError("Unsupported writable data");
    };

    class MemoryFileHandle {
        constructor(name) {
            this.kind = "file";
            this.name = name;
            this.data = new Uint8Array();
        }
        async getFile() {
            return new File([this.data], this.name, {
                type: this.name.endsWith(".png") ? "image/png" : "application/json",
                lastModified: 1,
            });
        }
        async createWritable() {
            const handle = this;
            let pending = handle.data.slice();
            return {
                async write(value) { pending = await bytes(value); },
                async close() { handle.data = pending.slice(); },
                async abort() {},
            };
        }
    }

    class MemoryDirectoryHandle {
        constructor(name) {
            this.kind = "directory";
            this.name = name;
            this.children = new Map();
        }
        async getDirectoryHandle(name, options = {}) {
            let child = this.children.get(name);
            if(!child && options.create) {
                child = new MemoryDirectoryHandle(name);
                this.children.set(name, child);
            }
            if(!child) throw notFound(name);
            if(child.kind !== "directory") throw new DOMException(name + " is not a directory", "TypeMismatchError");
            return child;
        }
        async getFileHandle(name, options = {}) {
            let child = this.children.get(name);
            if(!child && options.create) {
                child = new MemoryFileHandle(name);
                this.children.set(name, child);
            }
            if(!child) throw notFound(name);
            if(child.kind !== "file") throw new DOMException(name + " is not a file", "TypeMismatchError");
            return child;
        }
        async removeEntry(name) {
            if(!this.children.delete(name)) throw notFound(name);
        }
    }

    const root = new MemoryDirectoryHandle("browser-acceptance");
    globalThis.__mockProjectRoot = root;
    globalThis.showDirectoryPicker = async () => root;
    globalThis.prompt = (_message, fallback) => fallback === "Untitled Project" ? "Browser Acceptance" : fallback;
    globalThis.confirm = () => true;
    globalThis.alert = () => {};
    globalThis.__mockFileText = async path => {
        const parts = path.split("/");
        const fileName = parts.pop();
        let directory = root;
        for(const part of parts) directory = await directory.getDirectoryHandle(part);
        return (await (await directory.getFileHandle(fileName)).getFile()).text();
    };
    globalThis.__mockSceneDocuments = async () => {
        const documents = [];
        const visit = async (directory, prefix = "") => {
            for(const [name, child] of directory.children) {
                const path = prefix ? prefix + "/" + name : name;
                if(child.kind === "directory") await visit(child, path);
                else if(name.endsWith(".scene.json")) documents.push({ path, json: JSON.parse(await (await child.getFile()).text()) });
            }
        };
        await visit(root);
        return documents;
    };
})();`;

function remoteValue(result) {
    if(result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        throw new Error(`Browser evaluation failed: ${detail}`);
    }
    return result.result.value;
}

async function main() {
    const browserPath = await findBrowser();
    if(!browserPath) {
        console.error("Browser acceptance SKIP: Chrome/Chromium was not found. Set CHROME_PATH to its executable.");
        return;
    }

    try {
        const response = await fetch(editorUrl, { signal: AbortSignal.timeout(5_000) });
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch(error) {
        throw new Error(`Editor is not available at ${editorUrl}: ${error.message}`);
    }

    const port = await unusedPort();
    const profile = await mkdtemp(join(tmpdir(), "bonka-browser-acceptance-"));
    const browserOutput = [];
    const chrome = spawn(browserPath, [
        "--headless=new",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-features=Translate",
        "--disable-sync",
        "--no-first-run",
        "--no-sandbox",
        "--remote-allow-origins=*",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", chunk => {
        browserOutput.push(chunk.trim());
        if(browserOutput.length > 30) browserOutput.shift();
    });

    let client;
    const diagnostics = [];
    try {
        const page = await poll(async () => {
            if(chrome.exitCode !== null) throw new Error(`browser exited with code ${chrome.exitCode}`);
            const response = await fetch(`http://127.0.0.1:${port}/json/list`);
            const targets = await response.json();
            return targets.find(target => target.type === "page" && target.webSocketDebuggerUrl);
        }, "Chrome DevTools endpoint");

        client = new CdpClient(page.webSocketDebuggerUrl);
        await client.open();
        client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
            diagnostics.push(`exception: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
        });
        client.on("Runtime.consoleAPICalled", event => {
            if(event.type !== "error") return;
            const text = event.args.map(argument => argument.value ?? argument.description ?? argument.type).join(" ");
            diagnostics.push(`console.error: ${text}`);
        });
        await Promise.all([
            client.send("Page.enable"),
            client.send("Runtime.enable"),
            client.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false }),
        ]);
        await client.send("Page.addScriptToEvaluateOnNewDocument", { source: mockFileSystemSource });
        await client.send("Page.navigate", { url: editorUrl });

        const evaluate = async expression => remoteValue(await client.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        }));
        const waitFor = (expression, description) => poll(() => evaluate(expression), description);
        const click = selector => evaluate(`(() => {
            const element = document.querySelector(${JSON.stringify(selector)});
            if(!element) throw new Error("Missing element: " + ${JSON.stringify(selector)});
            element.click();
            return true;
        })()`);
        const savedPlacementCount = () => evaluate(`(async () => {
            const documents = await __mockSceneDocuments();
            if(documents.length !== 1) throw new Error("Expected one scene document, found " + documents.length);
            const layers = [];
            const visit = items => items.forEach(item => item.type === "group" ? visit(item.layers) : layers.push(item));
            visit(documents[0].json.layers);
            return layers.reduce((count, layer) => count + (layer.placements?.length || 0), 0);
        })()`);

        await waitFor(`document.readyState === "complete" && Boolean(document.querySelector("#newProject"))`, "editor page load");
        await click("#newProject");
        await waitFor(`document.querySelector("#editorShell")?.hidden === false`, "new project creation");
        assert(await evaluate(`document.querySelectorAll("#layerList .layer-row").length === 1 && document.querySelector("#layerList .layer-select")?.textContent.includes("Tile")`), "New project did not contain one default tile layer");
        assert(await evaluate(`document.querySelector("#mapSizeValue")?.textContent === "32×64 tiles" && document.querySelector("#tileSizeValue")?.textContent === "32×32 px" && document.querySelector("#gridSizeValue")?.textContent === "16×8 px"`), "Project panel did not show scene dimensions");
        const editorMetrics = await evaluate(`(() => {
            const help = document.querySelector("#commandsButton").getBoundingClientRect();
            const icon = document.querySelector("#commandsButton svg").getBoundingClientRect();
            const canvas = document.querySelector("#canvasWrap").getBoundingClientRect();
            return { helpWidth: help.width, helpHeight: help.height, iconWidth: icon.width, iconHeight: icon.height, canvasWidth: canvas.width, canvasHeight: canvas.height };
        })()`);
        assert(editorMetrics.helpWidth === 32 && editorMetrics.helpHeight === 32, `Header help button was not 32x32: ${JSON.stringify(editorMetrics)}`);
        assert(editorMetrics.iconWidth === 16 && editorMetrics.iconHeight === 16, `Header help icon was not 16x16: ${JSON.stringify(editorMetrics)}`);
        assert(editorMetrics.canvasWidth === 512 && editorMetrics.canvasHeight === 512, `Canvas wrapper did not use the reference 512x512 size: ${JSON.stringify(editorMetrics)}`);
        await click("#fitViewButton");
        const fitMetrics = await evaluate(`(() => {
            const wrap = document.querySelector("#canvasWrap");
            const canvas = document.querySelector("#mapCanvas");
            const wrapBounds = wrap.getBoundingClientRect();
            const canvasBounds = canvas.getBoundingClientRect();
            return {
                wrapWidth: wrap.clientWidth,
                wrapHeight: wrap.clientHeight,
                canvasWidth: canvasBounds.width,
                canvasHeight: canvasBounds.height,
                left: canvasBounds.left - wrapBounds.left,
                top: canvasBounds.top - wrapBounds.top,
            };
        })()`);
        assert(Math.abs(fitMetrics.canvasWidth - fitMetrics.wrapWidth) < 1 && Math.abs(fitMetrics.canvasHeight - fitMetrics.wrapHeight) < 1 && Math.abs(fitMetrics.left) <= 1 && Math.abs(fitMetrics.top) <= 1, `Fit to viewport left unused canvas space: ${JSON.stringify(fitMetrics)}`);
        await click("#commandsButton");
        await waitFor(`document.querySelector("#commandsDialog")?.open === true`, "commands modal open");
        assert(await evaluate(`document.querySelector("#commandsDialog")?.textContent.includes("Keyboard shortcuts")`), "Commands modal did not include shortcut help");
        assert(await evaluate(`document.querySelectorAll("#commandsDialog .commands-list > div").length === 16 && document.querySelector("#commandsDialog")?.textContent.includes("Entity tool")`), "Commands modal did not preserve individual shortcut rows");
        await click("#commandsCloseButton");
        await waitFor(`document.querySelector("#commandsDialog")?.open === false`, "commands modal close");
        await click("#projectPanelTitle");
        await waitFor(`document.querySelector(".project-panel")?.classList.contains("collapsed")`, "project panel collapse");
        await click("#projectPanelTitle");
        await waitFor(`!document.querySelector(".project-panel")?.classList.contains("collapsed")`, "project panel expand");
        assert(await evaluate(`document.querySelector("#projectNameInput")?.closest(".pill-editor") && !document.querySelector("#projectNameInput")?.closest(".pill-editor").classList.contains("editing")`), "Project fields were not rendered as compact chips");

        await evaluate(`(async () => {
            const canvas = document.createElement("canvas");
            canvas.width = 32;
            canvas.height = 32;
            const context = canvas.getContext("2d");
            context.fillStyle = "rgb(48, 190, 96)";
            context.fillRect(0, 0, 32, 32);
            context.fillStyle = "rgb(224, 160, 48)";
            context.fillRect(8, 8, 16, 16);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
            const transfer = new DataTransfer();
            transfer.items.add(new File([blob], "acceptance-tiles.png", { type: "image/png" }));
            const input = document.querySelector("#tilesetFileInput");
            input.files = transfer.files;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        })()`);
        await waitFor(`document.querySelector("#tilesetCount")?.textContent === "1" && document.querySelectorAll("#tilePalette .tile-preview").length === 16`, "PNG tileset import");
        assert(await evaluate(`getComputedStyle(document.querySelector("#tilePalette .tile-group-grid")).getPropertyValue("--tileset-columns").trim() === "4"`), "Tileset palette did not preserve the imported image column count");
        await click("#tilePalette .tile-preview");
        assert(await evaluate(`document.querySelector("#tilePalette .tile-preview")?.classList.contains("selected")`), "Visual source tile was not selected");

        await evaluate(`(() => {
            document.querySelector("#metatileColumnsInput").value = "4";
            document.querySelector("#metatileRowsInput").value = "4";
            document.querySelector("#metatileNameInput").value = "Acceptance Metatile";
            document.querySelector("#addMetatileButton").click();
        })()`);
        await waitFor(`document.querySelectorAll("#metatileEditor .metatile-cell").length === 16`, "4x4 metatile creation");
        for(let index = 0; index < 16; ++index) {
            await click(`#metatileEditor .metatile-cell:nth-child(${index + 1})`);
        }
        assert(await evaluate(`[...document.querySelectorAll("#metatileEditor .metatile-cell")].every(cell => cell.querySelector("canvas"))`), "Not all 16 metatile cells were filled graphically");

        const point = await evaluate(`(() => {
            document.querySelector("#gridToggle").checked = false;
            document.querySelector("#gridToggle").dispatchEvent(new Event("change", { bubbles: true }));
            const canvas = document.querySelector("#mapCanvas");
            const bounds = canvas.getBoundingClientRect();
             return {
                 x: bounds.left + 80 * bounds.width / canvas.width,
                 y: bounds.top + 48 * bounds.height / canvas.height,
                 dragX: bounds.left + 144 * bounds.width / canvas.width,
                 dragY: bounds.top + 80 * bounds.height / canvas.height,
                 visible: bounds.width > 0 && bounds.height > 0,
            };
        })()`);
        assert(point.visible && point.x >= 0 && point.y >= 0 && point.x < 1600 && point.y < 1100, `Map canvas paint point is outside the viewport: ${JSON.stringify(point)}`);
         await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
         await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
        await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.dragX, y: point.dragY, button: "left", buttons: 1 });
        await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.dragX, y: point.dragY, button: "left", buttons: 0, clickCount: 1 });
        await waitFor(`[...document.querySelectorAll("#historyList .history-row")].some(row => row.textContent.includes("Paint tile stroke"))`, "paint history entry");
        await waitFor(`(() => {
            const data = document.querySelector("#mapCanvas").getContext("2d").getImageData(84, 52, 1, 1).data;
            return data[3] === 255 && data[0] === 48 && data[1] === 190 && data[2] === 96;
        })()`, "painted nontransparent canvas pixel");

        await click("#saveProject");
        await waitFor(`document.querySelector("#status")?.textContent.includes("Saved Project Format v1 project")`, "initial save");
        const paintedPlacementCount = await savedPlacementCount();
        assert(paintedPlacementCount > 1, "Drag painting did not persist multiple interpolated metatile placements");
        const selectedMetatile = await evaluate(`document.querySelector("#metatileList .resource-button.selected span")?.textContent`);
        const savedSelection = await evaluate(`(async () => {
            const [document] = await __mockSceneDocuments();
            const layers = [];
            const visit = items => items.forEach(item => item.type === "group" ? visit(item.layers) : layers.push(item));
            visit(document.json.layers);
            const manifest = JSON.parse(await __mockFileText("bonka.config.json"));
            const metatile = JSON.parse(await __mockFileText(manifest.resources.metatiles[0]));
             return {
                placementMetatile: layers.flatMap(layer => layer.placements || [])[0]?.metatile,
                placements: layers.flatMap(layer => layer.placements || []).map(item => item.cell),
                metatileId: metatile.id,
                metatileName: metatile.name,
            };
        })()`);
        assert(savedSelection.placementMetatile === savedSelection.metatileId, "Saved placement did not reference the selected metatile");
        assert(selectedMetatile === savedSelection.metatileName, "The selected metatile was not preserved in the UI");
        assert(JSON.stringify(savedSelection.placements) === JSON.stringify([
            { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }, { x: 8, y: 8 },
        ]), `Iso drag placement coordinates were not snapped and interpolated as expected: ${JSON.stringify(savedSelection.placements)}`);

        await click("#undoButton");
        await waitFor(`!document.querySelector("#undoButton").disabled && !document.querySelector("#saveProject").disabled`, "undo state");
        await click("#saveProject");
        await waitFor(`document.querySelector("#saveProject").disabled`, "undo save");
        assert(await savedPlacementCount() === 0, "Undo did not remove the placement from saved state");

        await click("#redoButton");
        await waitFor(`!document.querySelector("#saveProject").disabled`, "redo state");
        await click("#saveProject");
        await waitFor(`document.querySelector("#saveProject").disabled`, "redo save");
        assert(await savedPlacementCount() === paintedPlacementCount, "Redo did not restore the full paint stroke to saved state");

        const markerPoints = await evaluate(`(() => {
            const canvas = document.querySelector("#mapCanvas");
            const bounds = canvas.getBoundingClientRect();
            const point = (x, y) => ({
                x: bounds.left + x * bounds.width / canvas.width,
                y: bounds.top + y * bounds.height / canvas.height,
            });
            return { object: point(100, 100), player: point(140, 100) };
        })()`);
        await click('[data-tool="object"]');
        await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...markerPoints.object, button: "left", buttons: 1, clickCount: 1 });
        await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...markerPoints.object, button: "left", buttons: 0, clickCount: 1 });
        await waitFor(`[...document.querySelectorAll("#historyList .history-row")].some(row => row.textContent.includes("Add Object"))`, "object placement");

        await click('[data-tool="player"]');
        await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...markerPoints.player, button: "left", buttons: 1, clickCount: 1 });
        await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...markerPoints.player, button: "left", buttons: 0, clickCount: 1 });
        await waitFor(`document.querySelector("#entityDefinitionSelect option[value=player]") && [...document.querySelectorAll("#historyList .history-row")].some(row => row.textContent.includes("Add Player entity"))`, "Player preset placement");

        await click("#addGroupButton");
        await waitFor(`document.querySelectorAll("#layerList .layer-row").length === 3`, "layer group creation");
        await click("#saveProject");
        await waitFor(`document.querySelector("#saveProject").disabled`, "object and entity save");
        const savedAuthoringState = await evaluate(`(async () => {
            const [document] = await __mockSceneDocuments();
            const layers = [];
            const visit = items => items.forEach(item => item.type === "group" ? (layers.push(item), visit(item.layers)) : layers.push(item));
            visit(document.json.layers);
            const manifest = JSON.parse(await __mockFileText("bonka.config.json"));
            return {
                groups: layers.filter(layer => layer.type === "group").length,
                objects: layers.reduce((count, layer) => count + (layer.objects?.length || 0), 0),
                entities: document.json.entities.length,
                entityResources: manifest.resources.entities.length,
            };
        })()`);
        assert(savedAuthoringState.groups === 1, "Saved scene did not contain the layer group");
        assert(savedAuthoringState.objects === 1, "Saved scene did not contain the generic object");
        assert(savedAuthoringState.entities === 1 && savedAuthoringState.entityResources === 1, "Saved project did not contain the Player-backed generic entity");

        await click("#closeProject");
        await waitFor(`document.querySelector("#projectHub")?.hidden === false && document.querySelector("#editorShell")?.hidden === true`, "project close");
        await click("#openProject");
        await waitFor(`document.querySelector("#editorShell")?.hidden === false && document.querySelector("#tilesetCount")?.textContent === "1"`, "saved project reopen");
        await waitFor(`(() => {
            const data = document.querySelector("#mapCanvas").getContext("2d").getImageData(84, 52, 1, 1).data;
            return data[3] === 255 && data[0] === 48 && data[1] === 190 && data[2] === 96;
        })()`, "reopened painted canvas pixel");
        assert(await evaluate(`document.querySelectorAll("#layerList .layer-row").length === 3 && document.querySelector("#entityDefinitionSelect option[value=player]")`), "Reopened project did not restore layers and entity definitions");

        if(diagnostics.length) throw new Error(`Browser emitted errors:\n${diagnostics.join("\n")}`);
        console.log(`Browser acceptance passed in ${browserPath}`);
    } catch(error) {
        if(client) {
            try {
                const state = remoteValue(await client.send("Runtime.evaluate", {
                    expression: `({
                        url: location.href,
                        status: document.querySelector("#status")?.textContent,
                        hubStatus: document.querySelector("#hubStatus")?.textContent,
                        history: [...document.querySelectorAll("#historyList .history-row")].map(row => row.textContent),
                    })`,
                    returnByValue: true,
                }));
                error.message += `\nPage state: ${JSON.stringify(state)}`;
            } catch {}
        }
        if(diagnostics.length) error.message += `\nBrowser diagnostics:\n${diagnostics.join("\n")}`;
        if(browserOutput.length) error.message += `\nChrome output:\n${browserOutput.join("\n")}`;
        throw error;
    } finally {
        if(client) {
            try { await client.send("Browser.close"); } catch {}
            client.close();
        }
        if(chrome.exitCode === null) {
            chrome.kill();
            await Promise.race([
                new Promise(resolve => chrome.once("exit", resolve)),
                new Promise(resolve => setTimeout(resolve, 2_000)),
            ]);
        }
        await rm(profile, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(`Browser acceptance failed: ${error.stack || error}`);
    process.exitCode = 1;
});
