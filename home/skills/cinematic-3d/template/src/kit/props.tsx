// A small, reusable set built from primitives: desk, room with a blinded
// window, beige retro computer with a live terminal, keyboard, mug, plant and
// a sheet of paper. Every piece is a <Solid>, so it draws in every pass.
import { useMemo } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  PlaneGeometry,
  Shape,
  TorusGeometry,
  Vector2,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Solid } from "./pass";
import { useCanvasTexture, wrap } from "./canvasTex";
import { MONO } from "./assets";
import { rand, type V3 } from "./motion";

export const DESK_Y = 0.74;

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};
const rbox = (w: number, h: number, d: number, r: number, x = 0, y = 0, z = 0) => {
  const g = new RoundedBoxGeometry(w, h, d, 4, r);
  g.translate(x, y, z);
  return g;
};
const merge = (gs: BufferGeometry[]) => mergeGeometries(gs.map((g) => g.toNonIndexed()), false)!;

/** Walnut desk top with procedural grain. */
export const Desk: React.FC<{ w?: number; d?: number; x?: number; z?: number }> = ({ w = 2.4, d = 1.0, x = 0, z = 0.05 }) => {
  const geo = useMemo(() => box(w, 0.04, d, x, DESK_Y - 0.02, z), [w, d, x, z]);
  const grain = useCanvasTexture(
    1024,
    512,
    (g, W, H) => {
      g.fillStyle = "#5b3a24";
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 260; i++) {
        const y = rand(i, 4) * H;
        g.strokeStyle = `rgba(${rand(i, 5) > 0.5 ? "30,16,8" : "140,96,62"},${0.08 + rand(i, 6) * 0.18})`;
        g.lineWidth = 0.6 + rand(i, 7) * 2.2;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 4 * rand(i, 8));
        g.stroke();
      }
    },
    "desk",
  );
  return <Solid geometry={geo} color="#ffffff" map={grain} flat="#a0703f" rough={0.42} edgeAngle={40} />;
};

/**
 * Room: back wall, left wall with a window opening, floor. The walls cast
 * shadows, so the sun only gets in through the window.
 */
export const Room: React.FC<{ win: { z: number; y: number; w: number; h: number }; wallX?: number; backZ?: number }> = ({
  win,
  wallX = -1.0,
  backZ = -0.5,
}) => {
  const geo = useMemo(() => {
    const t = 0.08;
    const H = 2.8;
    const zMin = backZ - t;
    const zMax = 2.5;
    const left = merge([
      // below window
      box(t, win.y - win.h / 2, zMax - zMin, wallX - t / 2, (win.y - win.h / 2) / 2, (zMin + zMax) / 2),
      // above window
      box(t, H - (win.y + win.h / 2), zMax - zMin, wallX - t / 2, (H + win.y + win.h / 2) / 2, (zMin + zMax) / 2),
      // behind window (towards back wall)
      box(t, win.h, win.z - win.w / 2 - zMin, wallX - t / 2, win.y, (zMin + win.z - win.w / 2) / 2),
      // in front of window
      box(t, win.h, zMax - (win.z + win.w / 2), wallX - t / 2, win.y, (zMax + win.z + win.w / 2) / 2),
    ]);
    const back = box(4, H, t, wallX + 2, H / 2, backZ - t / 2);
    const floor = box(4, 0.02, 3.2, wallX + 2, -0.01, 1);
    const sill = box(0.16, 0.03, win.w + 0.08, wallX + 0.02, win.y - win.h / 2 - 0.015, win.z);
    const frame = merge([
      box(0.05, 0.035, win.w, wallX - 0.02, win.y + win.h / 2 - 0.0175, win.z),
      box(0.05, win.h, 0.035, wallX - 0.02, win.y, win.z - win.w / 2 + 0.0175),
      box(0.05, win.h, 0.035, wallX - 0.02, win.y, win.z + win.w / 2 - 0.0175),
    ]);
    return { left, back, floor, sill, frame };
  }, [win, wallX, backZ]);
  return (
    <>
      <Solid geometry={geo.left} color="#b8a48c" flat="#e9e4dc" rough={0.92} edgeAngle={60} />
      <Solid geometry={geo.back} color="#b8a48c" flat="#e9e4dc" rough={0.92} edgeAngle={60} />
      <Solid geometry={geo.floor} color="#3a2a1e" flat="#cdb79a" rough={0.8} noWire />
      <Solid geometry={geo.sill} color="#d8cfbf" flat="#f2efe9" rough={0.6} />
      <Solid geometry={geo.frame} color="#d8cfbf" flat="#f2efe9" rough={0.6} />
    </>
  );
};

/** Bright sky card behind the window: what the camera sees through the blinds. */
export const Sky: React.FC<{ x: number; y: number; z: number; w: number; h: number; level?: number }> = ({ x, y, z, w, h, level = 2.2 }) => (
  <mesh position={[x, y, z]} rotation={[0, Math.PI / 2, 0]}>
    <planeGeometry args={[w, h]} />
    <meshBasicMaterial color={[1.0 * level, 0.78 * level, 0.52 * level]} toneMapped />
  </mesh>
);

/** Visible window blinds (the gobo that makes the stripes is separate and invisible). */
export const BlindSlats: React.FC<{ x: number; y: number; z: number; w: number; h: number; pitch?: number; tiltDeg?: number }> = ({
  x,
  y,
  z,
  w,
  h,
  pitch = 0.05,
  tiltDeg = 35,
}) => {
  const geo = useMemo(() => {
    const n = Math.floor(h / pitch);
    const slats: BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const g = new BoxGeometry(0.04, 0.002, w - 0.01);
      g.rotateZ((tiltDeg * Math.PI) / 180);
      g.translate(0, -h / 2 + (i + 0.5) * pitch, 0);
      slats.push(g);
    }
    slats.push(box(0.05, 0.03, w, 0, h / 2 + 0.015, 0));
    return merge(slats);
  }, [w, h, pitch, tiltDeg]);
  return <Solid geometry={geo} position={[x, y, z]} color="#efe6d6" flat="#ffffff" rough={0.5} castShadow={false} edgeAngle={50} />;
};

export type TermLine = { text: string; color?: string };

/** A terminal drawn to a texture: title bar, typed lines, block cursor. */
export const useTerminal = (opts: {
  title: string;
  lines: TermLine[];
  /** Total characters shown so far across all lines. */
  chars: number;
  cursorOn: boolean;
  size?: number;
  bg?: string;
  fg?: string;
  /** Highlight this line index with a bar. */
  highlight?: number;
  w?: number;
  h?: number;
}) => {
  const { title, lines, chars, cursorOn, size = 54, bg = "#18302f", fg = "#e9f3ea", highlight = -1, w = 1024, h = 768 } = opts;
  return useCanvasTexture(
    w,
    h,
    (g, W, H) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      // title bar
      g.fillStyle = "#e8e2d4";
      g.fillRect(0, 0, W, 64);
      g.fillStyle = "#3a352d";
      g.font = `500 30px ${MONO}`;
      g.textBaseline = "middle";
      g.fillText(title, 26, 33);
      g.fillStyle = "#d2453a";
      g.beginPath();
      g.arc(W - 40, 32, 11, 0, Math.PI * 2);
      g.fill();
      // body
      g.font = `500 ${size}px ${MONO}`;
      g.textBaseline = "alphabetic";
      let left = chars;
      let y = 64 + size * 1.7;
      let cx = 34;
      let cy = y;
      lines.forEach((ln, i) => {
        if (left <= 0 && i > 0) return;
        const shown = ln.text.slice(0, Math.max(0, left));
        left -= ln.text.length;
        if (i === highlight) {
          g.fillStyle = "rgba(255,255,255,0.10)";
          g.fillRect(16, y - size * 0.95, W - 32, size * 1.3);
        }
        g.fillStyle = ln.color ?? fg;
        g.fillText(shown, 34, y);
        cx = 34 + g.measureText(shown).width;
        cy = y;
        y += size * 1.32;
      });
      if (cursorOn) {
        g.fillStyle = fg;
        g.fillRect(cx + 6, cy - size * 0.8, size * 0.55, size * 0.95);
      }
    },
    `${title}|${chars}|${cursorOn}|${highlight}|${lines.map((l) => l.text).join("\n")}`,
  );
};

/**
 * Beige all-in-one retro computer. `screen` is the terminal texture; the
 * glass in front picks up the room in the beauty pass.
 */
export const RetroComputer: React.FC<{ position: V3; rotationY?: number; screen: Texture; glow?: number }> = ({
  position,
  rotationY = 0,
  screen,
  glow = 1.6,
}) => {
  const g = useMemo(() => {
    const W = 0.36;
    const base = rbox(W, 0.09, 0.38, 0.012, 0, 0.045, 0);
    const body = rbox(W, 0.34, 0.36, 0.03, 0, 0.09 + 0.17, -0.01);
    const back = rbox(W * 0.78, 0.26, 0.16, 0.04, 0, 0.09 + 0.15, -0.24);
    const bezel = rbox(0.3, 0.235, 0.02, 0.014, 0, 0.27, 0.172);
    const slot = box(0.12, 0.008, 0.01, 0.06, 0.05, 0.191);
    const led = box(0.012, 0.006, 0.006, -0.13, 0.05, 0.191);
    const vents = merge(Array.from({ length: 7 }, (_, i) => box(0.004, 0.11, 0.004, W / 2 + 0.001, 0.25, -0.12 + i * 0.022)));
    const screenG = new PlaneGeometry(0.248, 0.186);
    screenG.translate(0, 0.27, 0.1835);
    return { base, body: merge([body, back]), bezel, slot, led, vents, screenG };
  }, []);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Solid geometry={g.base} color="#cfc2a6" flat="#efe3c8" rough={0.55} />
      <Solid geometry={g.body} color="#d6caae" flat="#f4ead2" rough={0.5} />
      <Solid geometry={g.bezel} color="#bfb196" flat="#e2d6bc" rough={0.6} />
      <Solid geometry={g.slot} color="#1b1916" rough={0.8} />
      <Solid geometry={g.led} color="#ffb36b" emissive="#ff8a3a" emissiveIntensity={3} rough={0.4} />
      <Solid geometry={g.vents} color="#a99c82" rough={0.7} />
      <Solid
        geometry={g.screenG}
        color="#000000"
        emissive="#ffffff"
        emissiveMap={screen}
        map={screen}
        emissiveIntensity={glow}
        rough={0.65}
        mapInWire
        noHull
        castShadow={false}
      />
    </group>
  );
};

/** Keyboard: base plus 87 keys merged into one mesh. */
export const Keyboard: React.FC<{ position: V3; rotationY?: number }> = ({ position, rotationY = 0 }) => {
  const g = useMemo(() => {
    const base = rbox(0.44, 0.022, 0.16, 0.008, 0, 0.011, 0);
    const keys: BufferGeometry[] = [];
    const pitch = 0.4 / 15;
    [15, 15, 14, 13, 12].forEach((n, r) => {
      for (let i = 0; i < n; i++) {
        keys.push(rbox(pitch * 0.82, 0.012, pitch * 0.82, 0.003, -0.2 + pitch / 2 + i * pitch + r * 0.004, 0.026, -0.06 + r * pitch));
      }
    });
    keys.push(rbox(0.16, 0.012, 0.022, 0.003, 0.02, 0.026, -0.06 + 5 * pitch));
    return { base, keys: merge(keys) };
  }, []);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Solid geometry={g.base} color="#cdbfa2" flat="#efe4cc" rough={0.55} />
      <Solid geometry={g.keys} color="#e2d7bf" flat="#faf3e2" rough={0.48} edgeAngle={60} />
    </group>
  );
};

/** Ceramic mug with coffee. */
export const Mug: React.FC<{ position: V3; rotationY?: number; color?: string }> = ({ position, rotationY = 0, color = "#efe9df" }) => {
  const g = useMemo(() => {
    const pts = [
      [0, 0],
      [0.036, 0],
      [0.04, 0.004],
      [0.042, 0.09],
      [0.044, 0.096],
      [0.039, 0.096],
      [0.037, 0.09],
      [0.035, 0.012],
      [0, 0.012],
    ].map(([x, y]) => new Vector2(x, y));
    const body = new LatheGeometry(pts, 48);
    const handle = new TorusGeometry(0.024, 0.006, 12, 24, Math.PI * 1.25);
    handle.rotateZ(-Math.PI * 0.62);
    handle.translate(0.044, 0.05, 0);
    const coffee = new CylinderGeometry(0.0365, 0.0365, 0.002, 40);
    coffee.translate(0, 0.078, 0);
    return { body: merge([body, handle]), coffee };
  }, []);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Solid geometry={g.body} color={color} flat="#ffffff" rough={0.25} side="double" edgeAngle={35} />
      <Solid geometry={g.coffee} color="#2a160c" flat="#5b3418" rough={0.08} noWire />
    </group>
  );
};

/** Terracotta pot with a spiky plant. */
export const Plant: React.FC<{ position: V3; blades?: number; seed?: number }> = ({ position, blades = 11, seed = 1 }) => {
  const g = useMemo(() => {
    const pot = new LatheGeometry(
      [
        [0, 0],
        [0.05, 0],
        [0.064, 0.11],
        [0.07, 0.11],
        [0.07, 0.125],
        [0.06, 0.125],
        [0, 0.12],
      ].map(([x, y]) => new Vector2(x, y)),
      40,
    );
    const leaves: BufferGeometry[] = [];
    for (let i = 0; i < blades; i++) {
      const len = 0.22 + rand(i, seed) * 0.2;
      const s = new Shape();
      s.moveTo(-0.009, 0);
      s.quadraticCurveTo(-0.014, len * 0.5, 0, len);
      s.quadraticCurveTo(0.014, len * 0.5, 0.009, 0);
      s.lineTo(-0.009, 0);
      const leaf = new ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: false, curveSegments: 6 });
      leaf.translate(0, 0, -0.001);
      leaf.rotateX(-(0.12 + rand(i, seed + 1) * 0.42));
      leaf.rotateY((i / blades) * Math.PI * 2 + rand(i, seed + 2));
      leaf.translate((rand(i, seed + 3) - 0.5) * 0.03, 0.115, (rand(i, seed + 4) - 0.5) * 0.03);
      leaves.push(leaf);
    }
    return { pot, leaves: merge(leaves) };
  }, [blades, seed]);
  return (
    <group position={position}>
      <Solid geometry={g.pot} color="#a2482c" flat="#d0643f" rough={0.85} side="double" />
      <Solid geometry={g.leaves} color="#4f6b34" flat="#3ec43a" rough={0.6} side="double" edgeAngle={70} />
    </group>
  );
};

/** A sheet of A4 lying on the desk, with a markdown page drawn on it. */
export const Paper: React.FC<{ position: V3; rotationY?: number; page: Texture; lift?: number; rotationX?: number }> = ({
  position,
  rotationY = 0,
  rotationX = -Math.PI / 2,
  page,
}) => {
  const geo = useMemo(() => new PlaneGeometry(0.21, 0.297, 1, 1), []);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Solid geometry={geo} rotation={[rotationX, 0, 0]} color="#d9d3c8" map={page} flat="#ffffff" rough={0.9} side="double" mapInWire noHull />
    </group>
  );
};

export type MdBlock = { h1?: string; h2?: string; p?: string; li?: string };

/** Draw a markdown-ish page (h1, h2, bullets) to a texture, like a printed SKILL.md. */
export const usePage = (blocks: MdBlock[], key = "page", w = 1240, h = 1754) =>
  useCanvasTexture(
    w,
    h,
    (g, W, H) => {
      g.fillStyle = "#f4f1ea";
      g.fillRect(0, 0, W, H);
      const m = 120;
      let y = m + 40;
      g.fillStyle = "#1d1b18";
      for (const b of blocks) {
        if (b.h1) {
          g.font = `700 110px ${MONO}`;
          g.fillText(`# ${b.h1}`, m, y + 70);
          y += 150;
        } else if (b.h2) {
          y += 30;
          g.font = `700 52px ${MONO}`;
          g.fillText(`## ${b.h2}`, m, y + 40);
          y += 78;
        } else if (b.p) {
          g.font = `400 40px ${MONO}`;
          for (const line of wrap(g, b.p, W - m * 2)) {
            g.fillText(line, m, y + 34);
            y += 54;
          }
          y += 14;
        } else if (b.li) {
          g.font = `400 40px ${MONO}`;
          wrap(g, b.li, W - m * 2 - 50).forEach((line, i) => {
            g.fillText(i === 0 ? `- ${line}` : `  ${line}`, m, y + 34);
            y += 54;
          });
        }
        if (y > H - m) break;
      }
    },
    key,
  );
