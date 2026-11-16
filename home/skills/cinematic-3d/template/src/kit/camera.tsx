// A camera you direct like a DP: lenses in millimetres, shots that move from
// A to B with an ease that lands on the beat, and a hold that never locks.
import { useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { fbm, land, mix, mix3, clamp01, type Ease, type V3 } from "./motion";

/**
 * Vertical field of view for a full-frame lens at this focal length. The
 * sensor's long side is 36 mm whichever way the frame is held, so a 26 mm
 * lens on a 9:16 frame looks like a phone held upright, not an ultra-wide.
 */
export const fovFor = (mm: number, aspect = 16 / 9) => {
  const sensorH = aspect >= 1 ? 36 / aspect : 36;
  return (2 * Math.atan(sensorH / 2 / mm) * 180) / Math.PI;
};

export type CamPose = { pos: V3; target: V3; mm: number; roll?: number };
export type Shot = {
  from: number;
  to: number;
  a: CamPose;
  /** Omit for a held shot (still drifts). */
  b?: CamPose;
  ease?: Ease;
  /** Handheld amount in degrees of wander. 0.15-0.4 reads as a person holding still. */
  drift?: number;
  /** Shutter: 0..1 of how much this move should smear (read by MotionBlur overlays). */
  name?: string;
};

export type CamState = CamPose & { shot: number; t: number; speed: number; drift: number };

const pose = (s: Shot, t: number): CamPose => {
  if (!s.b) return s.a;
  return {
    pos: mix3(s.a.pos, s.b.pos, t),
    target: mix3(s.a.target, s.b.target, t),
    mm: mix(s.a.mm, s.b.mm, t),
    roll: mix(s.a.roll ?? 0, s.b.roll ?? 0, t),
  };
};

/** Where the camera is on this frame. Shots are cut back to back; a frame past the last shot holds it. */
export const camAt = (frame: number, shots: Shot[]): CamState => {
  let i = shots.findIndex((s) => frame >= s.from && frame < s.to);
  if (i < 0) i = frame < shots[0].from ? 0 : shots.length - 1;
  const s = shots[i];
  const raw = clamp01((frame - s.from) / Math.max(1, s.to - s.from));
  const e = s.ease ?? land;
  const t = e(raw);
  const p = pose(s, t);
  const p2 = pose(s, e(clamp01(raw + 1 / Math.max(1, s.to - s.from))));
  const speed = Math.hypot(p2.pos[0] - p.pos[0], p2.pos[1] - p.pos[1], p2.pos[2] - p.pos[2]);
  return { ...p, shot: i, t: raw, speed, drift: s.drift ?? 0.25 };
};

const tmp = new Vector3();

/** Drives the default R3F camera from a CamState. Put it inside the ThreeCanvas. */
export const Camera: React.FC<{ state: CamState; frame: number; fps: number; near?: number; far?: number }> = ({
  state,
  frame,
  fps,
  near = 0.01,
  far = 60,
}) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  // Runs during the R3F commit, before @remotion/three advances the renderer.
  useLayoutEffect(() => {
    const aspect = size.width / size.height;
    camera.fov = fovFor(state.mm, aspect);
    camera.aspect = aspect;
    camera.near = near;
    camera.far = far;
    camera.position.set(...state.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(tmp.set(...state.target));
    const t = frame / fps;
    const d = (state.drift * Math.PI) / 180;
    camera.rotateY(fbm(t * 0.45, 1) * d);
    camera.rotateX(fbm(t * 0.38, 2) * d * 0.8);
    camera.rotateZ(((state.roll ?? 0) * Math.PI) / 180 + fbm(t * 0.3, 3) * d * 0.4);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  });
  return null;
};
