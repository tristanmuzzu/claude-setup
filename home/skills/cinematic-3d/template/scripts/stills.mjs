// Render several stills of a composition with one bundle, plus a contact sheet.
// node scripts/stills.mjs <CompId> <f1,f2,...> [scale=0.5] [outDir=out/stills]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [id, framesArg, scaleArg = "0.5", outDir = "out/stills"] = process.argv.slice(2);
const frames = framesArg.split(",").map(Number);
fs.mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const chromiumOptions = { gl: "angle-egl" };
const composition = await selectComposition({ serveUrl, id, chromiumOptions });
const files = [];
for (const frame of frames) {
  const output = path.join(outDir, `${id}-${String(frame).padStart(4, "0")}.jpg`);
  await renderStill({ serveUrl, composition, frame, output, imageFormat: "jpeg", jpegQuality: 88, scale: Number(scaleArg), chromiumOptions, overwrite: true });
  files.push(output);
  process.stdout.write(`${frame} `);
}
const cols = Math.min(3, files.length);
const rows = Math.ceil(files.length / cols);
const sheet = path.join(outDir, `${id}-sheet.jpg`);
const inputs = files.flatMap((f) => ["-i", f]);
const layout = files.map((_, i) => `${(i % cols) === 0 ? "0" : Array.from({ length: i % cols }, () => "w0").join("+")}_${Math.floor(i / cols) === 0 ? "0" : Array.from({ length: Math.floor(i / cols) }, () => "h0").join("+")}`).join("|");
if (files.length === 1) fs.copyFileSync(files[0], sheet);
else execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `xstack=inputs=${files.length}:layout=${layout}:fill=black`, sheet]);
console.log(`\n${sheet}`);
// The bundle is ~200 MB in /tmp (RAM on this machine): never leave it behind.
fs.rmSync(serveUrl, { recursive: true, force: true });
