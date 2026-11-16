// Extruded 3D type that lives in the set: it catches the blinds, casts
// shadows and draws itself in every pass. Letters arrive one by one on a
// spring with a 1-2 % overshoot.
import { useMemo } from "react";
import { BufferGeometry, ExtrudeGeometry } from "three";
import { getTypeface } from "./assets";
import { Solid, type SolidProps } from "./pass";
import { springy } from "./motion";

type Reveal = {
  start: number;
  /** Frames between letters. */
  stagger?: number;
  /** Frames for one letter to land. */
  dur?: number;
  /** "rise" lifts letters up from the surface; "flip" rotates them up from flat. */
  style?: "rise" | "flip" | "drop";
  /** Frame the text leaves (reverse order). */
  out?: number;
};

export type ExtrudedProps = Omit<SolidProps, "geometry"> & {
  text: string;
  font: string;
  size: number;
  depth?: number;
  bevel?: number;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  tracking?: number;
  frame: number;
  reveal?: Reveal;
};

const cache = new Map<string, BufferGeometry>();
const glyphGeo = (font: string, ch: string, size: number, depth: number, bevel: number) => {
  const key = `${font}|${ch}|${size}|${depth}|${bevel}`;
  let g = cache.get(key);
  if (!g) {
    const shapes = getTypeface(font).generateShapes(ch, size);
    g = new ExtrudeGeometry(shapes, {
      depth,
      curveSegments: 8,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel * 0.55,
      bevelSegments: 3,
    });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    cache.set(key, g);
  }
  return g;
};

export const Extruded: React.FC<ExtrudedProps> = ({
  text,
  font,
  size,
  depth = size * 0.28,
  bevel = size * 0.025,
  align = "center",
  lineHeight = 1.12,
  tracking = 0,
  frame,
  reveal,
  position,
  rotation,
  scale,
  ...mat
}) => {
  const layout = useMemo(() => {
    const tf = getTypeface(font);
    const data = tf.data as unknown as { glyphs: Record<string, { ha: number }>; resolution: number };
    const k = size / data.resolution;
    const lines = text.split("\n");
    const out: { ch: string; x: number; y: number; i: number }[] = [];
    let idx = 0;
    lines.forEach((line, li) => {
      const adv = [...line].map((c) => (data.glyphs[c]?.ha ?? data.glyphs["?"]?.ha ?? 500) * k + tracking);
      const w = adv.reduce((a, b) => a + b, 0) - tracking;
      let x = align === "center" ? -w / 2 : align === "right" ? -w : 0;
      [...line].forEach((c, ci) => {
        if (c.trim()) out.push({ ch: c, x, y: -li * size * lineHeight, i: idx++ });
        x += adv[ci];
      });
    });
    return { glyphs: out, count: idx };
  }, [text, font, size, tracking, align, lineHeight]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {layout.glyphs.map((g) => {
        let s = 1;
        if (reveal) {
          const st = reveal.stagger ?? 1.5;
          const inS = springy(frame, reveal.start + g.i * st, reveal.dur ?? 16, 0.018);
          const outS = reveal.out !== undefined ? 1 - springy(frame, reveal.out + (layout.count - g.i) * st * 0.5, 12, 0.0001) : 1;
          s = Math.min(inS, outS);
        }
        if (s <= 0.001) return null;
        const style = reveal?.style ?? "rise";
        const rotX = style === "flip" ? (1 - s) * -Math.PI / 2 : style === "drop" ? (1 - s) * 0.6 : (1 - s) * 0.5;
        const dy = style === "drop" ? (1 - s) * size * 1.4 : style === "rise" ? (1 - s) * -size * 0.5 : 0;
        const sc = style === "flip" ? 1 : 0.4 + 0.6 * Math.min(1.05, s);
        return (
          <group key={`${g.i}`} position={[g.x, g.y + dy, 0]} rotation={[rotX, 0, 0]} scale={sc}>
            <Solid geometry={glyphGeo(font, g.ch, size, depth, bevel)} edgeAngle={30} {...mat} />
          </group>
        );
      })}
    </group>
  );
};
