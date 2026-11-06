#!/usr/bin/env node
/* ============================================================
   Otaku Time — asset and precache integrity check

   The service worker installs with `try/catch` around every precache
   entry, so a 404 there is invisible: the app silently degrades to a
   shell that cannot boot offline. Nothing in the browser reports it.
   This script is the guard.

   It checks, with no dependencies and no network:
     1. every path referenced by index.html exists on disk
     2. every module reachable from the entry points exists
     3. every stylesheet and module in the app is precached by sw.js
     4. every file listed in sw.js actually exists
     5. every url(...) inside a stylesheet resolves
     6. every manifest icon exists

   Run: npm run check:assets
   ============================================================ */

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

const rel = (path) => relative(ROOT, path).split(sep).join("/");
const fail = (message) => problems.push(message);
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** Files are addressed as repo-relative POSIX paths everywhere below. */
function exists(path) {
  const absolute = join(ROOT, path.replace(/^\.?\//, ""));
  return existsSync(absolute) && statSync(absolute).isFile();
}

/* ---------------- 1. index.html references ---------------- */

const html = read("index.html");
const htmlRefs = new Set();
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const value = match[1];
  if (!value || value.startsWith("http") || value.startsWith("data:") || value.startsWith("#")) continue;
  if (!/\.(css|js|webmanifest|svg|png|ico|woff2?)$/.test(value)) continue;
  htmlRefs.add(value.replace(/^\.\//, ""));
}
for (const ref of htmlRefs) {
  if (!exists(ref)) fail(`index.html references ${ref}, which does not exist`);
}

/* ---------------- 2. module graph ---------------- */

const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

function importsOf(path) {
  const source = read(path);
  const found = new Set();
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) {
      fail(`${path} imports "${specifier}" — the app ships without node modules, use a relative path`);
      continue;
    }
    found.add(resolve(dirname(join(ROOT, path)), specifier).replace(ROOT + sep, "").split(sep).join("/"));
  }
  return found;
}

const entries = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) =>
  m[1].replace(/^\.\//, "")
);
if (!entries.length) fail("index.html has no module entry point");

const graph = new Set();
const queue = [...entries];
while (queue.length) {
  const path = queue.pop();
  if (graph.has(path)) continue;
  graph.add(path);
  if (!exists(path)) {
    fail(`module ${path} is imported but missing`);
    continue;
  }
  for (const dependency of importsOf(path)) {
    if (!graph.has(dependency)) queue.push(dependency);
  }
}
for (const entry of entries) {
  if (!exists(entry)) fail(`entry module ${entry} is missing`);
}
notes.push(`${graph.size} modules reachable from ${entries.join(", ")}`);

/* ---------------- 3 + 4. service worker precache ---------------- */

const sw = read("sw.js");
const shellMatch = sw.match(/const SHELL = \[([\s\S]*?)\];/);
if (!shellMatch) {
  fail("sw.js has no SHELL precache list");
} else {
  const shell = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/^\.\//, ""));
  const precached = new Set(shell);
  notes.push(`${shell.length} precache entries`);

  for (const path of shell) {
    if (path === "" || path === ".") continue; // "./" is the scope root
    const file = path.replace(/^index\.html$/, "index.html");
    if (!exists(file)) fail(`sw.js precaches ${path}, which does not exist (install would swallow the 404)`);
  }

  for (const module of graph) {
    if (!precached.has(module)) fail(`${module} is imported but not precached — offline boot would fail`);
  }

  const stylesheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) =>
    m[1].replace(/^\.\//, "")
  );
  for (const sheet of stylesheets) {
    if (!precached.has(sheet)) fail(`${sheet} is linked but not precached — offline styling would fail`);
  }

  const unlisted = [...precached].filter((path) => path && !exists(path));
  if (unlisted.length) fail(`sw.js lists ${unlisted.length} unknown entries`);
}

/* ---------------- 5. css url() references ---------------- */

const cssFiles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) =>
  m[1].replace(/^\.\//, "")
);
const seenCss = new Set();
const cssQueue = [...cssFiles];
while (cssQueue.length) {
  const sheet = cssQueue.pop();
  if (seenCss.has(sheet)) continue;
  seenCss.add(sheet);
  if (!exists(sheet)) {
    fail(`stylesheet ${sheet} is missing`);
    continue;
  }
  const source = read(sheet);
  // Quote-aware: an inline SVG data URI can itself contain url(#filter),
  // and a naive pattern reads that inner fragment as a file reference.
  // Matching the whole quoted value keeps it intact, so the data: skip
  // below actually sees it.
  for (const match of source.matchAll(/url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]+))\s*\)/g)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!value || value.startsWith("data:") || value.startsWith("http") || value.startsWith("#")) continue;
    const target = resolve(dirname(join(ROOT, sheet)), value.split(/[?#]/)[0]);
    const path = rel(target);
    if (!exists(path)) fail(`${sheet} references ${value}, which does not exist`);
  }
  for (const match of source.matchAll(/@import\s+["']([^"']+)["']/g)) {
    cssQueue.push(resolve(dirname(join(ROOT, sheet)), match[1]).replace(ROOT + sep, "").split(sep).join("/"));
  }
}
notes.push(`${seenCss.size} stylesheets checked`);

/* ---------------- 6. manifest ---------------- */

try {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  for (const icon of manifest.icons || []) {
    const path = String(icon.src || "").replace(/^\.\//, "");
    if (path && !exists(path)) fail(`manifest icon ${path} does not exist`);
  }
  if (!manifest.start_url) fail("manifest has no start_url");
} catch (error) {
  fail(`manifest.webmanifest is not valid JSON: ${error.message}`);
}

/* ---------------- report ---------------- */

for (const note of notes) console.log(`  ${note}`);

if (problems.length) {
  console.error(`\n${problems.length} asset problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log("\n  ✓ every referenced asset exists and is precached");
