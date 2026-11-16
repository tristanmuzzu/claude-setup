// Light like a cinematographer: one motivated key (the sun through blinds),
// a warm bounce off the surfaces it hits, haze in the beam and dust that only
// glows where the beam is. The blinds are real geometry: the stripes are
// real shadows, so they wrap over every object.
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Matrix4,
  Object3D,
  Vector3,
} from "three";
import { usePass } from "./pass";
import { fbm, rand, type V3 } from "./motion";

export type Blinds = {
  /** Window centre (in the wall plane). */
  center: V3;
  /** Window width and height in metres. */
  w: number;
  h: number;
  /** Outward normal of the wall the window is in (pointing out of the room). */
  normal: V3;
  /** Slat pitch and how open they are (0 closed, 1 fully open). */
  pitch?: number;
  open?: number;
  /** Slat tilt in degrees: tilts the stripes on the floor. */
  tilt?: number;
};

const v = (a: V3) => new Vector3(...a);

/** Invisible slats that only exist for the shadow map, so the sun is striped. */
export const BlindsGobo: React.FC<{ blinds: Blinds; visible?: boolean }> = ({ blinds, visible }) => {
  const { center, w, h, normal, pitch = 0.05, open = 0.45, tilt = 0 } = blinds;
  const n = Math.floor(h / pitch);
  const slatH = pitch * (1 - open);
  const yaw = Math.atan2(normal[0], normal[2]);
  return (
    <group position={center} rotation={[0, yaw, 0]}>
      {Array.from({ length: n }, (_, i) => (
        <mesh
          key={i}
          position={[0, -h / 2 + (i + 0.5) * pitch, 0]}
          rotation={[((tilt + 35) * Math.PI) / 180, 0, 0]}
          castShadow
        >
          <boxGeometry args={[w, slatH, 0.004]} />
          {visible ? (
            <meshStandardMaterial color="#e9e2d4" roughness={0.5} />
          ) : (
            <meshBasicMaterial colorWrite={false} depthWrite={false} />
          )}
        </mesh>
      ))}
    </group>
  );
};

/**
 * The key light. A directional "sun" coming through the window, with a tight
 * shadow frustum around the set so the stripes stay crisp.
 */
export const Sun: React.FC<{
  /** Direction the light travels (from the sun into the room). */
  dir: V3;
  /** Point the shadow frustum is centred on. */
  focus: V3;
  intensity?: number;
  color?: string;
  /** Half-size of the shadow frustum in metres. Smaller is sharper. */
  span?: number;
  mapSize?: number;
  /** Soft flicker of passing air / cloud, 0..1. */
  flicker?: number;
  frame: number;
  fps: number;
}> = ({ dir, focus, intensity = 9, color = "#ffb978", span = 1.4, mapSize = 4096, flicker = 0.04, frame, fps }) => {
  const ref = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const d = v(dir).normalize();
  const pos = v(focus).addScaledVector(d, -6);
  useLayoutEffect(() => {
    const l = ref.current;
    if (!l) return;
    target.position.set(...focus);
    target.updateMatrixWorld();
    l.target = target;
    const c = l.shadow.camera;
    c.left = -span;
    c.right = span;
    c.top = span;
    c.bottom = -span;
    c.near = 0.5;
    c.far = 14;
    c.updateProjectionMatrix();
    l.shadow.bias = -0.0002;
    l.shadow.normalBias = 0.015;
    l.shadow.radius = 2;
  }, [focus, span, target]);
  const f = 1 + fbm(frame / fps * 0.7, 9) * flicker;
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={ref}
        position={[pos.x, pos.y, pos.z]}
        color={color}
        intensity={intensity * f}
        castShadow
        shadow-mapSize={[mapSize, mapSize]}
      />
    </>
  );
};

/** Low fill: warm bounce from the lit desk, cool sky from the window. Keep it dim. */
export const Bounce: React.FC<{ warm?: string; cool?: string; level?: number; at?: V3 }> = ({
  warm = "#ff9a5a",
  cool = "#4a5a78",
  level = 1,
  at = [0, 0.9, 0.2],
}) => (
  <>
    <hemisphereLight args={[cool, "#3a2416", 0.18 * level]} />
    <pointLight position={at} color={warm} intensity={0.9 * level} distance={3.2} decay={2} />
  </>
);

/** The "no skill" lighting: even, frontal, shadowless. What a plain prompt gives you. */
export const FlatLight: React.FC = () => (
  <>
    <ambientLight intensity={1.1} />
    <directionalLight position={[2, 4, 3]} intensity={1.6} />
  </>
);

const stripeTexture = (() => {
  let tex: CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 512;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.15, "rgba(255,255,255,1)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 512);
    tex = new CanvasTexture(c);
    return tex;
  };
})();

/**
 * Haze in the beam: thin additive sheets running along the light, one per
 * gap in the blinds. Cheap, deterministic, and bloom turns it into god rays.
 */
export const Beams: React.FC<{ blinds: Blinds; dir: V3; length?: number; color?: string; strength?: number; frame: number; fps: number }> = ({
  blinds,
  dir,
  length = 2.2,
  color = "#ffb070",
  strength = 0.05,
  frame,
  fps,
}) => {
  const pass = usePass();
  const { center, w, h, pitch = 0.05 } = blinds;
  const d = v(dir).normalize();
  const n = Math.floor(h / pitch);
  const tex = stripeTexture();
  if (pass !== "beauty") return null;
  // Orient each sheet so its local +Y runs along the light and its width spans the window.
  const across = new Vector3(...blinds.normal).cross(new Vector3(0, 1, 0)).normalize();
  const x = across.clone().addScaledVector(d, -across.dot(d)).normalize();
  const z = new Vector3().crossVectors(x, d).normalize();
  const q = new Object3D();
  q.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, d, z));
  const breathe = 1 + fbm((frame / fps) * 0.5, 4) * 0.25;
  return (
    <group>
      {Array.from({ length: n }, (_, i) => {
        const y = -h / 2 + (i + 0.5) * pitch;
        const start = v(center).add(new Vector3(0, y, 0));
        const mid = start.clone().addScaledVector(d, length / 2);
        return (
          <mesh key={i} position={mid} quaternion={q.quaternion}>
            <planeGeometry args={[w, length]} />
            <meshBasicMaterial
              color={color}
              map={tex}
              transparent
              opacity={strength * breathe * (0.7 + 0.3 * rand(i, 3))}
              blending={AdditiveBlending}
              depthWrite={false}
              side={2}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
};

/**
 * Dust in the air. Each mote drifts on its own slow noise path and is lit
 * only while it sits inside a sunlit gap of the blinds, so the beam reads
 * as a volume.
 */
export const Dust: React.FC<{
  count?: number;
  box: { min: V3; max: V3 };
  blinds: Blinds;
  dir: V3;
  frame: number;
  fps: number;
  size?: number;
  color?: string;
}> = ({ count = 500, box, blinds, dir, frame, fps, size = 0.006, color = "#ffd2a0" }) => {
  const pass = usePass();
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }, [count]);
  const t = frame / fps;
  const d = v(dir).normalize();
  const nrm = v(blinds.normal);
  const c0 = v(blinds.center);
  const pitch = blinds.pitch ?? 0.05;
  const open = blinds.open ?? 0.45;
  const pos = geo.getAttribute("position") as BufferAttribute;
  const col = geo.getAttribute("color") as BufferAttribute;
  const p = new Vector3();
  for (let i = 0; i < count; i++) {
    const sx = rand(i, 1), sy = rand(i, 2), sz = rand(i, 3);
    p.set(
      box.min[0] + (box.max[0] - box.min[0]) * sx + fbm(t * 0.11 + i, 11) * 0.05,
      box.min[1] + (box.max[1] - box.min[1]) * ((sy + t * 0.006 * (0.5 + sz)) % 1) + fbm(t * 0.13 + i, 12) * 0.03,
      box.min[2] + (box.max[2] - box.min[2]) * sz + fbm(t * 0.09 + i, 13) * 0.05,
    );
    pos.setXYZ(i, p.x, p.y, p.z);
    // Trace back along the light to the window plane: lit if it lands in a gap.
    const denom = d.dot(nrm);
    const s = c0.clone().sub(p).dot(nrm) / (denom || -1e-6);
    const hit = p.clone().addScaledVector(d, s);
    const local = hit.clone().sub(c0);
    const inX = Math.abs(local.dot(new Vector3(nrm.z, 0, -nrm.x))) < blinds.w / 2;
    const inY = Math.abs(local.y) < blinds.h / 2;
    const phase = (((local.y + blinds.h / 2) / pitch) % 1 + 1) % 1;
    const lit = inX && inY && phase > 1 - open ? 1 : 0.06;
    const tw = 0.6 + 0.4 * Math.sin(t * 2 + i);
    col.setXYZ(i, lit * tw, lit * tw * 0.82, lit * tw * 0.6);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  if (pass !== "beauty") return null;
  return (
    <points geometry={geo}>
      <pointsMaterial
        size={size}
        sizeAttenuation
        vertexColors
        color={color}
        transparent
        opacity={0.9}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
};
