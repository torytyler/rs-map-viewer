#!/usr/bin/env node
// Zero-dependency static server for the RS map viewer build + RuneScape caches.
//
// It exists because the viewer needs:
//   - cross-origin isolation (COOP/COEP) for SharedArrayBuffer + workers
//   - HTTP Range support, the cache loader resumes partial downloads
//   - a real http:// origin; file:// does not work for workers/WASM
//
//   node scripts/serve.mjs [--port 3100] [--root build] [--caches caches]
//
// The macOS screen saver ships an equivalent server in Swift (see macos/).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = parseInt(arg("port", "3100"), 10);
const HOST = arg("host", "127.0.0.1");
function resolveDir(value, fallback) {
    const candidate = path.resolve(process.cwd(), value ?? fallback);
    if (fs.existsSync(candidate)) {
        return candidate;
    }
    return path.resolve(projectRoot, value ?? fallback);
}

const ROOT = resolveDir(arg("root", undefined), "build");
const CACHES = resolveDir(arg("caches", undefined), "caches");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".dat": "application/octet-stream",
    ".dat2": "application/octet-stream",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
};

function mimeType(filePath) {
    // main_file_cache.dat2 / .idx255 have no useful extension suffix
    const base = path.basename(filePath);
    if (base.startsWith("main_file_cache.")) {
        return "application/octet-stream";
    }
    return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function safeJoin(base, requestPath) {
    const decoded = decodeURIComponent(requestPath);
    const resolved = path.resolve(base, "." + path.posix.normalize("/" + decoded));
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        return undefined;
    }
    return resolved;
}

function send(res, status, headers, body) {
    res.writeHead(status, {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Access-Control-Allow-Origin": "*",
        ...headers,
    });
    if (!body) {
        res.end();
    } else if (typeof body.pipe === "function") {
        body.on("error", () => res.destroy());
        body.pipe(res);
    } else {
        res.end(body);
    }
}

function parseRange(rangeHeader, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
        return undefined;
    }
    let start;
    let end;
    if (match[1] === "") {
        // suffix range: bytes=-500
        const suffix = parseInt(match[2], 10);
        if (!Number.isFinite(suffix) || suffix <= 0) {
            return undefined;
        }
        start = Math.max(size - suffix, 0);
        end = size - 1;
    } else {
        start = parseInt(match[1], 10);
        end = match[2] === "" ? size - 1 : parseInt(match[2], 10);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        return null; // unsatisfiable
    }
    return { start, end: Math.min(end, size - 1) };
}

function serveFile(req, res, filePath, { immutable = false } = {}) {
    const wantBody = req.method !== "HEAD";
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        return false;
    }
    if (stat.isDirectory()) {
        return false;
    }

    const headers = {
        "Content-Type": mimeType(filePath),
        "Accept-Ranges": "bytes",
        "Last-Modified": stat.mtime.toUTCString(),
        "Cache-Control": immutable
            ? "public, max-age=31536000, immutable"
            : "no-cache, must-revalidate",
    };

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
        const range = parseRange(rangeHeader, stat.size);
        if (range === null) {
            send(res, 416, { "Content-Range": `bytes */${stat.size}` });
            return true;
        }
        if (range) {
            const { start, end } = range;
            send(
                res,
                206,
                {
                    ...headers,
                    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
                    "Content-Length": String(end - start + 1),
                },
                wantBody ? fs.createReadStream(filePath, { start, end }) : undefined,
            );
            return true;
        }
    }

    send(
        res,
        200,
        { ...headers, "Content-Length": String(stat.size) },
        wantBody ? fs.createReadStream(filePath) : undefined,
    );
    return true;
}

const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, { Allow: "GET, HEAD" });
        return;
    }

    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    try {
        if (pathname.startsWith("/caches/")) {
            const filePath = safeJoin(CACHES, pathname.slice("/caches".length));
            if (filePath && serveFile(req, res, filePath)) {
                return;
            }
            send(res, 404, { "Content-Type": "text/plain" }, "Not found");
            return;
        }

        const filePath = safeJoin(ROOT, pathname === "/" ? "/index.html" : pathname);
        if (filePath && serveFile(req, res, filePath, { immutable: pathname.startsWith("/static/") })) {
            return;
        }

        // SPA fallback (BrowserRouter)
        if (serveFile(req, res, path.join(ROOT, "index.html"))) {
            return;
        }

        send(res, 404, { "Content-Type": "text/plain" }, "Not found: " + pathname);
    } catch (err) {
        console.error(err);
        send(res, 500, { "Content-Type": "text/plain" }, "Internal error");
    }
});

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
    console.error(`Warning: no index.html in ${ROOT}. Run "npm run build" first.`);
}

server.listen(PORT, HOST, () => {
    const { port } = server.address();
    console.log(`Serving ${ROOT}`);
    console.log(`Caches  ${CACHES}`);
    console.log(`Listening on http://${HOST}:${port}/`);
});
