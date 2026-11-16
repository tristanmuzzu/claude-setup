// Motion math for code-driven cinematography. Everything is a pure function
// of the frame number: no clocks, no randomness, no useFrame.
import { Easing } from "remotion";

export type V3 = [number, number, number];
export type Ease = (t: number) => number;

/** Land on the beat: fast start, long soft settle. The default for every move. */
export const land: Ease = Easing.bezier(0.2, 0.8, 0.2, 1);
/** Whip: hold, snap through the middle, settle. Pair with motion blur. */
export const whip: Ease = Easing.bezier(0.7, 0, 0.2, 1);
/** Slow drift in and out, for long holds that must still breathe. */
export const glide: Ease = Easing.bezier(0.45, 0, 0.55, 1);
export const linear: Ease = (t) => t;

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix3 = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Progress through [from, to] in frames, eased. */
export const prog = (frame: number, from: number, to: number, ease: Ease = land) =>
  ease(clamp01((frame - from) / Math.max(1, to - from)));

// Deterministic value noise. Same frame, same value, on every render worker.
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
export const noise1 = (t: number, seed = 0) => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return mix(hash(i + seed * 17.13), hash(i + 1 + seed * 17.13), u) * 2 - 1;
};
/** Layered noise in [-1, 1]: handheld breathing, flicker, gate weave. */
export const fbm = (t: number, seed = 0) =>
  noise1(t, seed) * 0.62 + noise1(t * 2.13, seed + 3.1) * 0.27 + noise1(t * 4.37, seed + 7.7) * 0.11;
/** Stable pseudo-random in [0, 1) for index i. */
export const rand = (i: number, seed = 0) => hash(i * 1.618 + seed * 9.73);

/**
 * Damped spring that overshoots a little (1-2 % by default) and settles.
 * Analytic, so any frame can be rendered alone.
 */
export const springy = (frame: number, start: number, dur = 18, overshoot = 0.018) => {
  const t = (frame - start) / dur;
  if (t <= 0) return 0;
  if (t >= 3) return 1;
  // underdamped oscillator tuned so the first peak is 1 + overshoot
  const zeta = Math.sqrt(Math.log(overshoot) ** 2 / (Math.PI ** 2 + Math.log(overshoot) ** 2));
  const wn = 4.2;
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  const x = t * 1.0;
  return 1 - Math.exp(-zeta * wn * x) * (Math.cos(wd * x) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * x));
};

/** Count up like a ticker, landing exactly on `to`. */
export const ticker = (frame: number, from: number, to: number, a: number, b: number, ease: Ease = land) =>
  Math.round(mix(a, b, prog(frame, from, to, ease)));

/** Typewriter: how many characters of `text` are visible. `cps` is characters per second. */
export const typed = (frame: number, start: number, text: string, cps = 28, fps = 30) =>
  text.slice(0, Math.max(0, Math.floor(((frame - start) / fps) * cps)));
