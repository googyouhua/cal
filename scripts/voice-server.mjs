#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.ROOT || path.join(HERE, ".."));
const PORT = Number(process.env.PORT || 4174);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8"
};

function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) {
    return null;
  }
  const relative = decoded === "/" ? "/index.html" : decoded;
  const full = path.resolve(ROOT, "." + relative);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    return null;
  }
  return full;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }
  const file = resolveFile(req.url);
  if (!file) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const voiceAsset = file.startsWith(path.join(ROOT, "voice") + path.sep);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": voiceAsset ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`cal-phone voice dev server: http://${HOST}:${PORT}/ (root=${ROOT})`);
});
