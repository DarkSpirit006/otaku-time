/* Minimal static server for local development: `npm run serve` */
import { createServer } from "node:http";
import { createGzip } from "node:zlib";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  // Chrome rejects a manifest served as application/octet-stream, which
  // silently disables installability in local runs.
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
    if (!filePath.startsWith(ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    // Compress text the way a production host does (GitHub Pages gzips),
    // so local performance measurements mean something.
    const compressible = /^(text\/|application\/(json|javascript)|image\/svg)/.test(type);
    const accepts = String(req.headers["accept-encoding"] || "").includes("gzip");
    const headers = {
      "content-type": type,
      // Fonts and icons are content-addressed by name; cache them hard.
      "cache-control": /\.(woff2|png|jpg|svg|webp)$/.test(ext) ? "public, max-age=31536000" : "no-cache",
      vary: "accept-encoding",
    };

    if (compressible && accepts) {
      res.writeHead(200, { ...headers, "content-encoding": "gzip" });
      createReadStream(filePath).pipe(createGzip()).pipe(res);
      return;
    }

    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Server error");
  }
}).listen(PORT, HOST, () => {
  console.log(`Otaku Time → http://localhost:${PORT}`);
});
