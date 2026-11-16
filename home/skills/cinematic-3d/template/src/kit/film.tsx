// 2D layers over the 3D: film grain, gate weave, shutter smear on whips, and
// the HUD language of "this is code" (red mono section tags, a frame counter,
// a pass label, code annotations pinned to objects).
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { PerspectiveCamera, Vector3 } from "three";
import { fbm, type V3 } from "./motion";
import { fovFor, type CamState } from "./camera";
import { MONO } from "./assets";

export const RED = "#e5483a";

/** 35 mm grain. Deterministic: the seed is the frame. */
export const Grain: React.FC<{ amount?: number }> = ({ amount = 0.1 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ mixBlendMode: "overlay", opacity: amount, pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${frame}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={frame % 997} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${frame})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** Projector gate weave: the whole frame breathes by a pixel or two. */
export const Weave: React.FC<{ children: React.ReactNode; px?: number }> = ({ children, px = 1.2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ transform: `translate(${fbm(t * 1.7, 21) * px}px, ${fbm(t * 1.3, 22) * px}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

/**
 * Shutter smear for whip pans: a directional blur scaled by how fast the
 * camera moves this frame. `speed` is world units per frame from camAt().
 */
export const Shutter: React.FC<{ speed: number; angle?: number; gain?: number; children: React.ReactNode; id: string }> = ({
  speed,
  angle = 0,
  gain = 600,
  children,
  id,
}) => {
  const px = Math.min(60, speed * gain);
  // Below ~12 px a smear reads as soft focus, not motion: only whips get it.
  if (px < 20) return <AbsoluteFill>{children}</AbsoluteFill>;
  return (
    <AbsoluteFill>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation={`${px} ${px * 0.12}`} />
        </filter>
      </svg>
      <AbsoluteFill style={{ filter: `url(#${id})`, transform: `rotate(${angle}deg)` }}>
        <AbsoluteFill style={{ transform: `rotate(${-angle}deg)` }}>{children}</AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Red mono section tag, typed on with a block cursor. */
export const Tag: React.FC<{ text: string; start: number; x: number; y: number; size?: number; cps?: number; end?: number; color?: string }> = ({
  text,
  start,
  x,
  y,
  size = 64,
  cps = 22,
  end,
  color = RED,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < start || (end !== undefined && frame >= end)) return null;
  const n = Math.floor(((frame - start) / fps) * cps);
  const shown = text.slice(0, n);
  const done = n >= text.length;
  const cursor = !done || Math.floor((frame - start) / 8) % 2 === 0;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        fontFamily: MONO,
        fontWeight: 500,
        fontSize: size,
        letterSpacing: size * 0.06,
        color,
        // A soft dark halo keeps red legible over sunlit walls.
        textShadow: `0 0 ${size * 0.5}px rgba(0,0,0,0.55), 0 0 ${size * 0.35}px ${color}55`,
        whiteSpace: "pre",
      }}
    >
      {shown}
      {cursor && (
        <span style={{ display: "inline-block", width: size * 0.55, height: size * 0.9, background: color, marginLeft: 4, verticalAlign: "-8%" }} />
      )}
    </div>
  );
};

/** Bottom-right frame counter: "0288 / 0723". */
export const FrameCounter: React.FC<{ total: number; dark?: boolean }> = ({ total, dark }) => {
  const frame = useCurrentFrame();
  const pad = (n: number) => String(n).padStart(4, "0");
  return (
    <div style={{ position: "absolute", right: 48, bottom: 36, fontFamily: MONO, fontSize: 20, letterSpacing: 2, color: RED, opacity: dark ? 0.9 : 0.8 }}>
      {pad(frame)} <span style={{ opacity: 0.55 }}>/ {pad(total)}</span>
    </div>
  );
};

/** Top-left pass label: "FRAME 0019 · PASS: WIRE". */
export const PassLabel: React.FC<{ pass: string; x?: number; y?: number }> = ({ pass, x = 48, y = 40 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: x, top: y, fontFamily: MONO, fontSize: 18, letterSpacing: 2, color: "#fff", background: RED, padding: "4px 10px" }}>
      FRAME {String(frame).padStart(4, "0")} · PASS: {pass.toUpperCase()}
    </div>
  );
};

const projCam = new PerspectiveCamera();
const pv = new Vector3();
/** Screen position (px) of a world point for this frame's camera, ignoring handheld drift. */
export const project = (p: V3, cam: CamState, width: number, height: number) => {
  projCam.fov = fovFor(cam.mm, width / height);
  projCam.aspect = width / height;
  projCam.position.set(...cam.pos);
  projCam.lookAt(new Vector3(...cam.target));
  projCam.rotateZ(((cam.roll ?? 0) * Math.PI) / 180);
  projCam.updateProjectionMatrix();
  projCam.updateMatrixWorld();
  pv.set(...p).project(projCam);
  return { x: (pv.x * 0.5 + 0.5) * width, y: (-pv.y * 0.5 + 0.5) * height, behind: pv.z > 1 };
};

/** A line of code pinned to a point in the set, typed on. */
export const CodeTag: React.FC<{ code: string; at: V3; cam: CamState; start: number; color?: string; size?: number; dx?: number; dy?: number }> = ({
  code,
  at,
  cam,
  start,
  color = "#1d1c1a",
  size = 26,
  dx = 0,
  dy = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  if (frame < start) return null;
  const s = project(at, cam, width, height);
  if (s.behind) return null;
  const n = Math.floor(((frame - start) / fps) * 40);
  return (
    <div style={{ position: "absolute", left: s.x + dx, top: s.y + dy, fontFamily: MONO, fontSize: size, color, whiteSpace: "pre" }}>
      {code.slice(0, n)}
    </div>
  );
};
