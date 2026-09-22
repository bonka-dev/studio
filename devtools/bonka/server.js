"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const port = Number(process.env.PORT || 8000);
const mimeTypes = {
    ".bmp": "image/bmp",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "text/plain; charset=utf-8",
    ".png": "image/png",
};

function send(response, status, body, contentType) {
    response.writeHead(status, { "Content-Type": contentType });
    response.end(body);
}

http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if(url.pathname === "/") {
        response.writeHead(302, { Location: "/devtools/bonka/index.html" });
        response.end();
        return;
    }
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filePath = path.resolve(projectRoot, relativePath);

    if(path.relative(projectRoot, filePath).startsWith("..")) {
        send(response, 403, "Forbidden\n", "text/plain; charset=utf-8");
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if(error) {
            send(response, error.code === "ENOENT" ? 404 : 500, "Not found\n", "text/plain; charset=utf-8");
            return;
        }

        const contentType = path.basename(filePath) === "manifest.json"
            ? "application/manifest+json; charset=utf-8"
            : mimeTypes[path.extname(filePath)] || "application/octet-stream";
        send(response, 200, data, contentType);
    });
}).listen(port, "0.0.0.0", () => {
    console.log(`Bonka available at http://localhost:${port}/devtools/bonka/index.html`);
});
