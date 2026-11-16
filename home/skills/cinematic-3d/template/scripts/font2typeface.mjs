// Convert a .ttf/.otf/.woff font into three.js typeface JSON for extruded 3D text.
// Usage: node scripts/font2typeface.mjs <font file> <out.json>
import fs from "node:fs";
import opentype from "opentype.js";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: font2typeface.mjs <font.(ttf|otf|woff)> <out.typeface.json>");
  process.exit(1);
}
const buf = fs.readFileSync(src);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const scale = 1000 / font.unitsPerEm;
const r = (n) => Math.round(n * scale);
const glyphs = {};
for (let i = 0; i < font.glyphs.length; i++) {
  const g = font.glyphs.get(i);
  const codes = g.unicodes?.length ? g.unicodes : g.unicode !== undefined ? [g.unicode] : [];
  if (!codes.length) continue;
  const o = [];
  for (const c of g.path.commands) {
    if (c.type === "M") o.push("m", r(c.x), r(c.y));
    else if (c.type === "L") o.push("l", r(c.x), r(c.y));
    else if (c.type === "Q") o.push("q", r(c.x), r(c.y), r(c.x1), r(c.y1));
    else if (c.type === "C") o.push("b", r(c.x), r(c.y), r(c.x1), r(c.y1), r(c.x2), r(c.y2));
  }
  const bb = g.getBoundingBox();
  const data = { ha: r(g.advanceWidth ?? 0), x_min: r(bb.x1), x_max: r(bb.x2), o: o.join(" ") };
  for (const code of codes) glyphs[String.fromCodePoint(code)] = data;
}
const head = font.tables.head;
const json = {
  glyphs,
  familyName: font.names.fontFamily?.en ?? "font",
  ascender: r(font.ascender),
  descender: r(font.descender),
  underlinePosition: r(font.tables.post?.underlinePosition ?? -100),
  underlineThickness: r(font.tables.post?.underlineThickness ?? 50),
  boundingBox: { xMin: r(head.xMin), yMin: r(head.yMin), xMax: r(head.xMax), yMax: r(head.yMax) },
  resolution: 1000,
  original_font_information: font.tables.name ?? {},
};
fs.writeFileSync(out, JSON.stringify(json));
console.log(`${out}: ${Object.keys(glyphs).length} glyphs`);
