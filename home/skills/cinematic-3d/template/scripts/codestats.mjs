// Count the lines of code that make the film and save them for the
// "lines of code" shot: node scripts/codestats.mjs <out.json> <dir>...
import fs from "node:fs";
import path from "node:path";
const [out, ...dirs] = process.argv.slice(2);
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|mjs|py)$/.test(e.name)) files.push(p);
  }
};
dirs.forEach(walk);
const list = files.map((f) => ({ name: f, text: fs.readFileSync(f, "utf8") }));
const lines = list.reduce((n, f) => n + f.text.split("\n").filter((l) => l.trim()).length, 0);
fs.writeFileSync(out, JSON.stringify({ lines, files: list.map((f) => ({ name: f.name, text: f.text.split("\n").slice(0, 80).join("\n") })) }));
console.log(`${out}: ${list.length} files, ${lines} non-blank lines`);
