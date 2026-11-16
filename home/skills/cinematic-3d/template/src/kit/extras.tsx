// Set pieces that show the four pillars on screen: a motion path with
// keyframe diamonds and a flying object (MOTION), audio bars standing on the
// set (SOUND), and a fanned stack of the film's real source code (the code
// count shot).
import { useMemo } from "react";
import {
  Object3D,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  OctahedronGeometry,
  PlaneGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { Solid, usePass, INK } from "./pass";
import { useCanvasTexture } from "./canvasTex";
import { MONO } from "./assets";
import { RED } from "./film";
import type { V3 } from "./motion";

const aimer = new Object3D();
const aim = (from: Vector3, to: Vector3) => {
  aimer.position.copy(from);
  aimer.lookAt(to);
  return aimer.quaternion.clone();
};

/** A folded paper plane, nose along +Z. */
export const usePaperPlaneGeometry = () =>
  useMemo(() => {
    const g = new BufferGeometry();
    // nose, left wing tip, keel, right wing tip, tail points
    const v = [
      // left wing
      0, 0, 0.09, -0.045, 0.004, -0.05, 0, 0, -0.05,
      // right wing
      0, 0, 0.09, 0, 0, -0.05, 0.045, 0.004, -0.05,
      // keel
      0, 0, 0.09, 0, -0.018, -0.05, 0, 0, -0.05,
    ];
    g.setAttribute("position", new Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }, []);

/** A curve through points, drawn with keyframe diamonds, plus an object that travels it. */
export const MotionPath: React.FC<{
  points: V3[];
  /** 0..1 progress of the traveller along the path. */
  t: number;
  /** How much of the path is drawn (0..1). */
  drawn?: number;
  children?: React.ReactNode;
}> = ({ points, t, drawn = 1, children }) => {
  const pass = usePass();
  const curve = useMemo(() => new CatmullRomCurve3(points.map((p) => new Vector3(...p)), false, "centripetal"), [points]);
  // The path is a thin tube, not a GL line: lines are 1 px at any resolution.
  const tube = useMemo(() => {
    const n = 160;
    const pts = curve.getSpacedPoints(n).slice(0, Math.max(2, Math.floor(n * drawn) + 1));
    if (pts.length < 2) return null;
    return new TubeGeometry(new CatmullRomCurve3(pts), pts.length * 2, 0.0022, 6, false);
  }, [curve, drawn]);
  const diamond = useMemo(() => new OctahedronGeometry(0.016, 0), []);
  const p = curve.getPointAt(Math.min(0.999, Math.max(0, t)));
  const ahead = curve.getPointAt(Math.min(1, Math.max(0, t) + 0.01));
  const color = pass === "wire" ? INK : "#ffd9a8";
  return (
    <group>
      {tube && (
        <mesh geometry={tube}>
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
      {points.map((q, i) =>
        i / (points.length - 1) <= drawn + 1e-3 ? (
          <group key={i} position={q} scale={[1, 1.5, 1]}>
            <Solid geometry={diamond} color="#ffd9a8" emissive="#ffb070" emissiveIntensity={2} castShadow={false} edgeAngle={1} />
          </group>
        ) : null,
      )}
      <group position={p} quaternion={aim(p, ahead)}>
        <group rotation={[0, 0, Math.sin(t * Math.PI * 2) * 0.5]}>{children}</group>
      </group>
    </group>
  );
};

/** Audio bars standing on the set. `levels` in 0..1, e.g. from visualizeAudio(). */
export const Bars: React.FC<{ levels: number[]; position: V3; width: number; maxH?: number; rotationY?: number }> = ({
  levels,
  position,
  width,
  maxH = 0.16,
  rotationY = 0,
}) => {
  const n = levels.length;
  const pitch = width / n;
  const geo = useMemo(() => {
    const g = new BoxGeometry(pitch * 0.62, 1, pitch * 0.62);
    g.translate(0, 0.5, 0);
    return g;
  }, [pitch]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {levels.map((l, i) => (
        <group key={i} position={[-width / 2 + (i + 0.5) * pitch, 0, 0]} scale={[1, Math.max(0.004, l * maxH), 1]}>
          <Solid geometry={geo} color="#efe4d2" flat="#ffffff" rough={0.35} emissive="#ffb070" emissiveIntensity={0.25 + l * 1.2} edgeAngle={30} />
        </group>
      ))}
    </group>
  );
};

/** One page of source code as a texture. */
const useCodePage = (name: string, text: string) =>
  useCanvasTexture(
    1024,
    1280,
    (g, W, H) => {
      g.fillStyle = "#16130f";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#2a241d";
      g.fillRect(0, 0, W, 70);
      g.font = `500 30px ${MONO}`;
      g.fillStyle = "#e8dcc8";
      g.fillText(name, 30, 46);
      g.font = `400 24px ${MONO}`;
      text.split("\n").slice(0, 46).forEach((ln, i) => {
        g.fillStyle = "#6f655a";
        g.fillText(String(i + 1).padStart(3, " "), 20, 118 + i * 25.5);
        g.fillStyle = /^\s*(\/\/|#|\*|\/\*)/.test(ln) ? "#8a8070" : /\b(const|export|import|return|def|from)\b/.test(ln) ? "#f0c79a" : "#e9e1d4";
        g.fillText(ln.slice(0, 66), 80, 118 + i * 25.5);
      });
      g.fillStyle = RED;
      g.fillRect(0, H - 6, W * 0.4, 6);
    },
    name,
  );

const CodePage: React.FC<{ name: string; text: string; position: V3; rotation: V3 }> = ({ name, text, position, rotation }) => {
  const tex = useCodePage(name, text);
  const geo = useMemo(() => new PlaneGeometry(0.64, 0.8), []);
  return <Solid geometry={geo} position={position} rotation={rotation} color="#000000" emissive="#ffffff" emissiveMap={tex} map={tex} emissiveIntensity={0.85} mapInWire noHull castShadow={false} side="double" />;
};

/** A fanned stack of real source files, fanning open with `open` 0..1. */
export const CodeStack: React.FC<{ files: { name: string; text: string }[]; position: V3; open: number }> = ({ files, position, open }) => (
  <group position={position}>
    {files.map((f, i) => {
      const k = i - (files.length - 1);
      return (
        <CodePage
          key={f.name}
          name={f.name.replace(/^.*src\//, "src/")}
          text={f.text}
          position={[k * 0.1 * open, 0, k * 0.07 * open]}
          rotation={[0, (0.3 + k * 0.05) * open, 0]}
        />
      );
    })}
  </group>
);
