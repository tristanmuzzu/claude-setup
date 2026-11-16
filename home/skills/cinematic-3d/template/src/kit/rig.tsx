// Keyframes, the blocky character rig and its wardrobe, ported from the reel
// studio's Blender kit (3d/kit.py Guy) to React Three Fiber.
//
// Everything inside <ZUp> uses Blender's coordinates (Z up, -Y towards the
// camera) and Blender's XYZ Euler order, so the poses and camera moves from a
// Blender shot script carry over number for number. cv() converts a Blender
// point to three.js world space (for the camera and lights outside <ZUp>).
import { useMemo } from "react";
import { CylinderGeometry, SphereGeometry, TorusGeometry, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Solid } from "./pass";
import { rand, type V3 } from "./motion";

export const cv = (p: V3): V3 => [p[0], p[2], -p[1]];
const D = Math.PI / 180;
type E = [number, number, number, "ZYX"];
export const eul = (r: V3): E => [r[0] * D, r[1] * D, r[2] * D, "ZYX"];

export const ZUp: React.FC<{ children: React.ReactNode }> = ({ children }) => <group rotation={[-Math.PI / 2, 0, 0]}>{children}</group>;

// ------------------------------------------------------------------ keyframes

type Key = { f: number; v: number[]; step?: boolean };

/**
 * Keyframes on named channels, sampled like Blender's auto-clamped Bezier:
 * cubic Hermite through the keys, flat at the ends and at every turn-around.
 */
export class Anim {
  keys = new Map<string, Key[]>();
  shows = new Map<string, [number, number][]>();

  set(ch: string, f: number, v: number[], step = false) {
    const ks = this.keys.get(ch) ?? [];
    const i = ks.findIndex((k) => k.f === f);
    if (i >= 0) ks[i] = { f, v, step };
    else {
      ks.push({ f, v, step });
      ks.sort((a, b) => a.f - b.f);
    }
    this.keys.set(ch, ks);
  }

  /** K(ob, frame, rot=, loc=, scale=) from the Blender scripts. Rotations in degrees. `step` holds the value until the next key (a cut). */
  K(name: string, f: number, o: { rot?: V3; loc?: V3; scale?: V3; step?: boolean }) {
    if (o.rot) this.set(`${name}.rot`, f, o.rot, o.step);
    if (o.loc) this.set(`${name}.loc`, f, o.loc, o.step);
    if (o.scale) this.set(`${name}.scale`, f, o.scale, o.step);
  }

  val(ch: string, f: number, def: number[]): number[] {
    const ks = this.keys.get(ch);
    if (!ks || !ks.length) return def;
    if (f <= ks[0].f) return ks[0].v;
    const n = ks.length;
    if (f >= ks[n - 1].f) return ks[n - 1].v;
    let i = 0;
    while (ks[i + 1].f < f) i++;
    const a = ks[i];
    const b = ks[i + 1];
    if (a.step) return a.v;
    const dt = b.f - a.f;
    const t = (f - a.f) / dt;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    const slope = (j: number, c: number) => {
      if (j <= 0 || j >= n - 1) return 0;
      const p = ks[j - 1].v[c];
      const q = ks[j].v[c];
      const r = ks[j + 1].v[c];
      if ((q - p) * (r - q) <= 0) return 0;
      return (r - p) / (ks[j + 1].f - ks[j - 1].f);
    };
    return a.v.map((_, c) => h00 * a.v[c] + h10 * dt * slope(i, c) + h01 * b.v[c] + h11 * dt * slope(i + 1, c));
  }

  rot = (name: string, f: number, def: V3 = [0, 0, 0]) => eul(this.val(`${name}.rot`, f, def) as V3);
  loc = (name: string, f: number, def: V3 = [0, 0, 0]) => this.val(`${name}.loc`, f, def) as V3;
  scale = (name: string, f: number, def: V3 = [1, 1, 1]) => this.val(`${name}.scale`, f, def) as V3;

  /** kit.show_between: visible only in [on, off). Several calls add up. */
  show(name: string, on: number, off: number) {
    const s = this.shows.get(name) ?? [];
    s.push([on, off]);
    this.shows.set(name, s);
  }

  hide(name: string) {
    this.shows.set(name, []);
  }

  visible(name: string, f: number, def = true) {
    const s = this.shows.get(name);
    if (!s) return def;
    return s.some(([a, b]) => f >= a && f < b);
  }
}

// ------------------------------------------------------------------ geometry

const cache = new Map<string, BufferGeometry>();
const memo = (key: string, make: () => BufferGeometry) => {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
};
export const rbox = (s: V3, bevel = 0.03) =>
  memo(`b${s}|${bevel}`, () => new RoundedBoxGeometry(s[0], s[1], s[2], bevel > 0 ? 3 : 1, Math.max(0.0005, Math.min(bevel, Math.min(...s) / 2 - 0.0005))));
export const sph = (r: number) => memo(`s${r}`, () => new SphereGeometry(r, 24, 14));
/** A Blender cylinder: axis along local Z. */
export const cylz = (r: number, h: number, verts = 32) =>
  memo(`c${r}|${h}|${verts}`, () => new CylinderGeometry(r, r, h, verts).rotateX(Math.PI / 2));
export const torus = (R: number, r: number) => memo(`t${R}|${r}`, () => new TorusGeometry(R, r, 12, 40));

type Look = { color: string; rough?: number; metal?: number; emissive?: string; ei?: number; cast?: boolean };

/** kit.box: a rounded box at a local position. */
export const Bx: React.FC<Look & { s: V3; at?: V3; bevel?: number; rot?: V3; scale?: V3; hidden?: boolean }> = ({
  s,
  at = [0, 0, 0],
  bevel = 0.03,
  rot,
  scale,
  hidden,
  color,
  rough = 0.6,
  metal = 0,
  emissive,
  ei = 1,
  cast = true,
}) =>
  hidden ? null : (
    <group position={at} rotation={rot ? eul(rot) : undefined} scale={scale}>
      <Solid geometry={rbox(s, bevel)} color={color} rough={rough} metal={metal} emissive={emissive} emissiveIntensity={ei} castShadow={cast} />
    </group>
  );

export const Sp: React.FC<Look & { r: number; at?: V3; scale?: V3; hidden?: boolean }> = ({ r, at = [0, 0, 0], scale, hidden, color, rough = 0.6, metal = 0, emissive, ei = 1, cast = true }) =>
  hidden ? null : (
    <group position={at} scale={scale}>
      <Solid geometry={sph(r)} color={color} rough={rough} metal={metal} emissive={emissive} emissiveIntensity={ei} castShadow={cast} />
    </group>
  );

export const Cy: React.FC<Look & { r: number; h: number; at?: V3; rot?: V3; verts?: number; scale?: V3; hidden?: boolean }> = ({
  r,
  h,
  at = [0, 0, 0],
  rot,
  verts = 32,
  scale,
  hidden,
  color,
  rough = 0.6,
  metal = 0,
  emissive,
  ei = 1,
  cast = true,
}) =>
  hidden ? null : (
    <group position={at} rotation={rot ? eul(rot) : undefined} scale={scale}>
      <Solid geometry={cylz(r, h, verts)} color={color} rough={rough} metal={metal} emissive={emissive} emissiveIntensity={ei} castShadow={cast} />
    </group>
  );

// ------------------------------------------------------------------ the character

export type Dress = {
  robe: string;
  sash: string;
  skin: string;
  hair: string;
  beard?: boolean;
  bald?: boolean;
  /** Right half of the hair in pieces, so it can be shaved. */
  halves?: boolean;
  wreath?: boolean;
};

export const HAIR = "#2B1D16";
export const STUBBLE = "#A47A5C";

/** Pose channels a Guy reads: `${id}.root`, .pelvis, .chest, .neck, .shR, .shL, .hipR, .hipL, .eyes. */
export const Guy: React.FC<{
  id: string;
  a: Anim;
  f: number;
  loc: V3;
  rotZ?: number;
  dress: Dress;
  rightHand?: React.ReactNode;
}> = ({ id, a, f, loc, rotZ = 0, dress, rightHand }) => {
  const d = dress;
  const n = (p: string) => `${id}.${p}`;
  const eyes = a.val(n("eyes"), f, [1])[0];
  const eye: V3 = [1, 0.5, Math.max(0.08, 1.15 * eyes)];
  const vis = (p: string, def = true) => a.visible(n(p), f, def);
  const sc = (p: string) => a.scale(n(p), f);
  return (
    <group position={a.loc(n("root"), f, loc)} rotation={a.rot(n("root"), f, [0, 0, rotZ])}>
      <group position={a.loc(n("pelvis"), f, [0, 0, 0.62])}>
        <Bx s={[0.6, 0.38, 0.36]} at={[0, 0, -0.12]} bevel={0.07} color={d.robe} rough={0.92} />
        <group rotation={a.rot(n("chest"), f)}>
          <Bx s={[0.56, 0.34, 0.58]} at={[0, 0, 0.29]} bevel={0.09} color={d.robe} rough={0.92} />
          <Bx s={[0.14, 0.37, 0.7]} at={[0.07, 0, 0.3]} rot={[0, -38, 0]} bevel={0.04} color={d.sash} rough={0.85} />
          <group position={[0, 0, 0.58]} rotation={a.rot(n("neck"), f)}>
            <Bx s={[0.52, 0.48, 0.5]} at={[0, 0, 0.27]} bevel={0.13} color={d.skin} rough={0.55} />
            {[-1, 1].map((sx) => (
              <Sp key={sx} r={0.045} at={[sx * 0.11, -0.245, 0.29]} scale={eye} color="#141414" rough={0.25} />
            ))}
            {d.beard && <Bx s={[0.4, 0.1, 0.13]} at={[0, -0.225, 0.05]} bevel={0.045} color={d.hair} rough={0.75} />}
            {d.bald ? (
              <Bx s={[0.54, 0.2, 0.14]} at={[0, 0.17, 0.3]} bevel={0.05} color={d.hair} rough={0.75} />
            ) : (
              <>
                {!d.halves && (
                  <>
                    <Bx s={[0.56, 0.52, 0.18]} at={[0, 0.03, 0.5]} bevel={0.07} color={d.hair} rough={0.75} />
                    <Bx s={[0.56, 0.14, 0.32]} at={[0, 0.2, 0.38]} bevel={0.06} color={d.hair} rough={0.75} />
                    {[-1, 1].map((sx) => (
                      <Bx key={sx} s={[0.05, 0.26, 0.2]} at={[sx * 0.262, 0.08, 0.36]} bevel={0.02} color={d.hair} rough={0.75} />
                    ))}
                  </>
                )}
                {d.halves && <Bx s={[0.29, 0.52, 0.18]} at={[0.135, 0.03, 0.5]} bevel={0.06} color={d.hair} rough={0.75} />}
                {d.halves && <Bx s={[0.29, 0.14, 0.32]} at={[0.135, 0.2, 0.38]} bevel={0.05} color={d.hair} rough={0.75} />}
                {d.halves && <Bx s={[0.05, 0.26, 0.2]} at={[0.262, 0.08, 0.36]} bevel={0.02} color={d.hair} rough={0.75} />}
                {d.halves && [0, 1, 2].map((k) =>
                  vis(`hairR${k}`) ? (
                    <group key={k} position={[-0.135, -0.143 + k * 0.173, 0.41]} scale={sc(`hairR${k}`)}>
                      <Bx s={[0.29, 0.176, 0.18]} at={[0, 0, 0.09]} bevel={0.05} color={d.hair} rough={0.75} />
                    </group>
                  ) : null,
                )}
                {d.halves && vis("hairBackR") && (
                  <group position={[-0.135, 0.2, 0.22]} scale={sc("hairBackR")}>
                    <Bx s={[0.29, 0.14, 0.32]} at={[0, 0, 0.16]} bevel={0.05} color={d.hair} rough={0.75} />
                  </group>
                )}
                {d.halves && vis("hairSideR") && <Bx s={[0.05, 0.26, 0.2]} at={[-0.262, 0.08, 0.36]} bevel={0.02} color={d.hair} rough={0.75} />}
                {d.halves && vis("stubble", false) && <Bx s={[0.27, 0.5, 0.2]} at={[-0.127, 0, 0.432]} bevel={0.09} color={STUBBLE} rough={0.9} />}
                {d.halves && vis("stubbleSide", false) && <Bx s={[0.03, 0.4, 0.22]} at={[-0.252, 0.04, 0.36]} bevel={0.012} color={STUBBLE} rough={0.9} />}
              </>
            )}
            {d.wreath && (
              <group position={[0, 0.02, 0.5]} scale={[1, 0.95, 1]}>
                <Solid geometry={torus(0.29, 0.035)} color="#4F7A2E" rough={0.7} />
              </group>
            )}
          </group>
          {(["R", "L"] as const).map((side) => (
            <group key={side} position={[side === "R" ? -0.34 : 0.34, 0, 0.5]} rotation={a.rot(n(`sh${side}`), f)}>
              <Bx s={[0.16, 0.17, 0.46]} at={[0, 0, -0.21]} bevel={0.07} color={d.robe} rough={0.92} />
              <Sp r={0.085} at={[0, 0, -0.5]} color={d.skin} rough={0.55} />
              {side === "R" && rightHand}
            </group>
          ))}
        </group>
        {(["R", "L"] as const).map((side) => (
          <group key={side} position={[side === "R" ? -0.14 : 0.14, 0, 0]} rotation={a.rot(n(`hip${side}`), f)}>
            <Bx s={[0.21, 0.23, 0.52]} at={[0, 0, -0.27]} bevel={0.06} color={d.skin} rough={0.55} />
            <Bx s={[0.23, 0.34, 0.05]} at={[0, -0.05, -0.56]} bevel={0.02} color="#7A5232" rough={0.7} />
            <Bx s={[0.235, 0.345, 0.03]} at={[0, -0.05, -0.6]} bevel={0.01} color="#3A2618" rough={0.8} />
          </group>
        ))}
      </group>
    </group>
  );
};

// Guy's keyframe helpers ------------------------------------------------------

export const blink = (a: Anim, id: string, f: number) => {
  a.set(`${id}.eyes`, f - 1, [1]);
  a.set(`${id}.eyes`, f + 1, [0.05]);
  a.set(`${id}.eyes`, f + 4, [1]);
};
export const eyesOpen = (a: Anim, id: string, f: number, amount: number) => a.set(`${id}.eyes`, f, [amount]);

export const walk = (a: Anim, id: string, f0: number, f1: number, cycle = 16, amp = 28) => {
  for (let f = f0; f <= f1; f += 2) {
    const ph = (2 * Math.PI * (f - f0)) / cycle;
    const s = Math.sin(ph);
    a.K(`${id}.hipR`, f, { rot: [amp * s, 0, 0] });
    a.K(`${id}.hipL`, f, { rot: [-amp * s, 0, 0] });
    a.K(`${id}.shR`, f, { rot: [-amp * 0.8 * s, 0, -4] });
    a.K(`${id}.shL`, f, { rot: [amp * 0.8 * s, 0, 4] });
    a.K(`${id}.pelvis`, f, { loc: [0, 0, 0.62 + 0.025 * Math.abs(Math.cos(ph))] });
  }
};

/**
 * Shoulder rotation (Blender degrees, XYZ) that puts the hand closest to a
 * point, given the shoulder's world position and the body's Z turn: the
 * studio's reach(), as a grid search.
 */
export const reach = (shoulder: V3, target: V3, prefer: V3 = [-100, 0, 0], bodyZ = 0): V3 => {
  const r = (d: number) => (d * Math.PI) / 180;
  const cz = Math.cos(r(-bodyZ));
  const sz = Math.sin(r(-bodyZ));
  const dx0 = target[0] - shoulder[0];
  const dy0 = target[1] - shoulder[1];
  const d: V3 = [cz * dx0 - sz * dy0, sz * dx0 + cz * dy0, target[2] - shoulder[2]];
  const hand = (x: number, y: number, z: number): V3 => {
    // R = Rz Ry Rx applied to (0, 0, -0.5)
    const [sx, cx, sy, cy, s3, c3] = [Math.sin(r(x)), Math.cos(r(x)), Math.sin(r(y)), Math.cos(r(y)), Math.sin(r(z)), Math.cos(r(z))];
    const v1: V3 = [0, 0.5 * sx, -0.5 * cx];
    const v2: V3 = [cy * v1[0] + sy * v1[2], v1[1], -sy * v1[0] + cy * v1[2]];
    return [c3 * v2[0] - s3 * v2[1], s3 * v2[0] + c3 * v2[1], v2[2]];
  };
  const cost = (x: number, y: number, z: number) => {
    const h = hand(x, y, z);
    return Math.hypot(h[0] - d[0], h[1] - d[1], h[2] - d[2]) + (Math.abs(x - prefer[0]) + Math.abs(y - prefer[1]) + Math.abs(z - prefer[2])) * 1e-4;
  };
  let best: [number, V3] = [Infinity, [0, 0, 0]];
  for (let x = -180; x <= 60; x += 5) for (let y = -90; y <= 90; y += 6) for (let z = -90; z <= 90; z += 6) {
    const c = cost(x, y, z);
    if (c < best[0]) best = [c, [x, y, z]];
  }
  const [bx, by, bz] = best[1];
  for (let x = bx - 5; x <= bx + 5; x++) for (let y = by - 6; y <= by + 6; y++) for (let z = bz - 6; z <= bz + 6; z++) {
    const c = cost(x, y, z);
    if (c < best[0]) best = [c, [x, y, z]];
  }
  return best[1];
};

// ------------------------------------------------------------------ the crowd

const ROBES = ["#D9CFBF", "#C9B48D", "#B5643E", "#7C8A5E", "#8A6E9E", "#CDB79A", "#9C6B4A"];
const SKIN = ["#E9B48A", "#C98E64", "#F0C4A0", "#B07A52", "#E2A97E", "#D49C72", "#F2C9A6"];
const HAIRS = ["#2B1D16", "#5A3A22", "#8C8C8C", "#1A1410", "#6B4A2E", "#3A2A1E", "#BFB7A8"];

export const crowdDress = (i: number): Dress => ({
  robe: ROBES[i % 7],
  sash: ROBES[(i + 3) % 7],
  skin: SKIN[i % 7],
  hair: HAIRS[i % 7],
  beard: i % 3 !== 1,
  bald: i % 4 === 3,
});
export const crowdTurn = (i: number) => (rand(i, 4) * 2 - 1) * 12;

export const useOnce = <T,>(make: () => T) => useMemo(make, []); // eslint-disable-line react-hooks/exhaustive-deps
