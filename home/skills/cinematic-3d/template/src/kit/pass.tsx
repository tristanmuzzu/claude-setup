// Render passes. The same world renders as the finished "beauty" image, as a
// line-art "wire" pass on paper, or as the flat untextured look you get from a
// plain prompt ("flat"). Cutting between passes is the signature move: it
// shows the audience that the shot is made of code.
import { createContext, useContext, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import {
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  FrontSide,
  ShaderMaterial,
  type Side,
  type Texture,
} from "three";

export type PassName = "beauty" | "wire" | "flat";
export const PassContext = createContext<PassName>("beauty");
export const usePass = () => useContext(PassContext);

export const PAPER = "#ecebe6";
export const INK = "#2b2a28";

// Silhouette lines for the wire pass: an inverted hull pushed out along the
// normals by a constant number of pixels, so smooth (rounded) objects get an
// outline even where they have no crease edges.
const hullMaterial = (() => {
  let m: ShaderMaterial | null = null;
  return () => {
    if (m) return m;
    m = new ShaderMaterial({
      uniforms: { uPx: { value: 1.6 }, uRes: { value: [1920, 1080] }, uColor: { value: new Color(INK) } },
      vertexShader: `
        uniform float uPx; uniform vec2 uRes;
        void main() {
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          vec2 d = (projectionMatrix * vec4(n, 0.0)).xy;
          float l = length(d);
          if (l > 1e-5) clip.xy += d / l * uPx * 2.0 / uRes * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
      side: BackSide,
    });
    return m;
  };
})();

export const useHull = () => {
  const size = useThree((s) => s.size);
  const m = hullMaterial();
  m.uniforms.uRes.value = [size.width, size.height];
  m.uniforms.uPx.value = Math.max(1, size.height / 700);
  return m;
};

export type SolidProps = {
  geometry: BufferGeometry;
  color?: string;
  /** Colour in the flat pass: default-prompt colours are louder and cleaner. */
  flat?: string;
  rough?: number;
  metal?: number;
  emissive?: string;
  emissiveIntensity?: number;
  map?: Texture | null;
  emissiveMap?: Texture | null;
  roughMap?: Texture | null;
  /** Keep the texture visible in the wire pass (paper text, screens). */
  mapInWire?: boolean;
  edgeAngle?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: "front" | "double";
  /** Hide the solid in the wire pass but keep its lines. */
  wireOnly?: boolean;
  /** Draw nothing in the wire pass. */
  noWire?: boolean;
  /** No silhouette outline in the wire pass (flat cards, planes). */
  noHull?: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  physical?: { clearcoat?: number; transmission?: number; ior?: number; thickness?: number };
};

/** One mesh that knows how to draw itself in every pass. */
export const Solid: React.FC<SolidProps> = ({
  geometry,
  color = "#d9d2c3",
  flat,
  rough = 0.6,
  metal = 0,
  emissive,
  emissiveIntensity = 1,
  map,
  emissiveMap,
  roughMap,
  mapInWire,
  edgeAngle = 24,
  castShadow = true,
  receiveShadow = true,
  transparent,
  opacity = 1,
  side = "front",
  wireOnly,
  noWire,
  noHull,
  position,
  rotation,
  scale,
  physical,
}) => {
  const pass = usePass();
  const hull = useHull();
  const edges = useMemo(() => new EdgesGeometry(geometry, edgeAngle), [geometry, edgeAngle]);
  const s: Side = side === "double" ? DoubleSide : FrontSide;

  if (pass === "wire") {
    if (noWire) return null;
    return (
      <group position={position} rotation={rotation} scale={scale}>
        {!wireOnly && (
          <mesh geometry={geometry}>
            <meshBasicMaterial
              color={mapInWire && map ? "#ffffff" : PAPER}
              map={mapInWire ? map ?? emissiveMap ?? null : null}
              toneMapped={false}
              side={s}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
            />
          </mesh>
        )}
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={INK} toneMapped={false} />
        </lineSegments>
        {!noHull && geometry.getAttribute("normal") && <mesh geometry={geometry} material={hull} />}
      </group>
    );
  }

  if (pass === "flat") {
    return (
      <mesh geometry={geometry} position={position} rotation={rotation} scale={scale}>
        <meshStandardMaterial
          color={flat ?? color}
          roughness={0.85}
          map={mapInWire && map && !emissiveMap ? map : null}
          emissive={emissive ?? "#000000"}
          emissiveMap={emissiveMap ?? null}
          emissiveIntensity={emissive ? 1 : 0}
          side={s}
          transparent={transparent}
          opacity={opacity}
        />
      </mesh>
    );
  }

  return (
    <mesh
      geometry={geometry}
      position={position}
      rotation={rotation}
      scale={scale}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      {physical ? (
        <meshPhysicalMaterial
          color={color}
          roughness={rough}
          metalness={metal}
          map={map ?? null}
          side={s}
          transparent={transparent}
          opacity={opacity}
          clearcoat={physical.clearcoat ?? 0}
          transmission={physical.transmission ?? 0}
          ior={physical.ior ?? 1.5}
          thickness={physical.thickness ?? 0}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          roughness={rough}
          metalness={metal}
          map={map ?? null}
          roughnessMap={roughMap ?? null}
          emissive={emissive ?? "#000000"}
          emissiveMap={emissiveMap ?? null}
          emissiveIntensity={emissive ? emissiveIntensity : 0}
          side={s}
          transparent={transparent}
          opacity={opacity}
        />
      )}
    </mesh>
  );
};

/** Render children in a given pass. Nest it to override the pass for one object. */
export const Pass: React.FC<{ name: PassName; children: React.ReactNode }> = ({ name, children }) => (
  <PassContext.Provider value={name}>{children}</PassContext.Provider>
);
