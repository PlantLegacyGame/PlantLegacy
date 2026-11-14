#!/usr/bin/env node
/**
 * Documentation guardrail.
 *
 * Checks the four things that silently rot in this repo:
 *   1. every relative markdown link resolves;
 *   2. the config count/population quoted in docs/tunables.md matches config/;
 *   3. docs/protocol.md lists exactly the message types in MESSAGE_TYPE;
 *   4. the same long prose line does not live in two documents.
 *
 * Exit 1 on any failure. Warnings never fail the run.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];
const warnings = [];

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
};

const docs = walk(root);
const rel = (p) => path.relative(root, p).replaceAll("\\", "/");

// 1 — links
let links = 0;
for (const doc of docs) {
  const text = fs.readFileSync(doc, "utf8");
  for (const match of text.matchAll(/\]\(([^)\s]+\.md)(#[^)]*)?\)/g)) {
    const target = match[1];
    if (/^[a-z]+:/i.test(target)) continue;
    links++;
    if (!fs.existsSync(path.resolve(path.dirname(doc), target))) {
      errors.push(`broken link: ${rel(doc)} -> ${target}`);
    }
  }
}

// 2 — config counts
const configFiles = fs
  .readdirSync(path.join(root, "config"))
  .filter((f) => f.endsWith(".json"));
let populated = 0;
for (const file of configFiles) {
  const json = JSON.parse(fs.readFileSync(path.join(root, "config", file), "utf8"));
  if (json.values && Object.keys(json.values).length > 0) populated++;
}
const tunables = fs.readFileSync(path.join(root, "docs", "tunables.md"), "utf8");
const claimed = tunables.match(/Total: \*\*(\d+) files\*\*; (\d+) populated and (\d+) stubs/);
if (!claimed) errors.push("docs/tunables.md: count line not found");
else {
  const [files, pop, stubs] = claimed.slice(1).map(Number);
  if (files !== configFiles.length)
    errors.push(`tunables says ${files} files, config/ has ${configFiles.length}`);
  if (pop !== populated)
    errors.push(`tunables says ${pop} populated, config/ has ${populated}`);
  if (stubs !== configFiles.length - populated)
    errors.push(`tunables says ${stubs} stubs, config/ has ${configFiles.length - populated}`);
  const rows = (tunables.match(/^\| `[a-z_]+` \|/gm) ?? []).length;
  if (rows !== configFiles.length)
    errors.push(`tunables index has ${rows} file rows, config/ has ${configFiles.length}`);
}

// 3 — protocol table
const net = fs.readFileSync(path.join(root, "apps/server/src/ops/net.ts"), "utf8");
const enumStart = net.indexOf("export const MESSAGE_TYPE");
const enumBlock = net.slice(enumStart, net.indexOf("} as const", enumStart));
const codeTypes = new Map(
  [...enumBlock.matchAll(/^\s*([A-Z_]+):\s*(\d+)/gm)].map((m) => [m[1], Number(m[2])]),
);
const protocol = fs.readFileSync(path.join(root, "docs/protocol.md"), "utf8");
const docTypes = new Map(
  [...protocol.matchAll(/^\|\s*(\d+)\s*\|\s*`([A-Z_]+)`/gm)].map((m) => [m[2], Number(m[1])]),
);
for (const [name, id] of codeTypes) {
  if (!docTypes.has(name)) errors.push(`protocol.md missing ${name} (${id})`);
  else if (docTypes.get(name) !== id) errors.push(`protocol.md: ${name} is ${docTypes.get(name)}, code says ${id}`);
}
for (const name of docTypes.keys())
  if (!codeTypes.has(name)) errors.push(`protocol.md documents ${name}, not in MESSAGE_TYPE`);

// 4 — duplicated long prose
const seen = new Map();
for (const doc of docs) {
  const text = fs.readFileSync(doc, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length < 100 || t.startsWith("|") || t.startsWith("#") || t.startsWith("```")) continue;
    const key = t.toLowerCase();
    const where = seen.get(key);
    if (where && where !== rel(doc)) warnings.push(`duplicated prose: ${rel(doc)} and ${where}`);
    else if (!where) seen.set(key, rel(doc));
  }
}

console.log(`docs: ${docs.length} files, ${links} relative links`);
console.log(`config: ${configFiles.length} files, ${populated} populated, ${configFiles.length - populated} stubs`);
console.log(`protocol: ${codeTypes.size} message types, ${docTypes.size} documented rows`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 20)) console.log(`  ~ ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log(`  x ${e}`);
  process.exit(1);
}
console.log("\ndocs:check OK");
