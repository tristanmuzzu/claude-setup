// The 9:16 master: the finished film playing on a laptop on a sunny desk,
// framed like a phone POV. The laptop and room are code too; the film is
// mapped onto the screen as a video texture, one decoded frame per frame.
import { ThreeCanvas, useOffthreadVideoTexture } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { Audio } from "@remotion/media";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useDelayRender, useRemotionEnvironment, useVideoConfig } from "remotion";
import { BoxGeometry, PlaneGeometry, SRGBColorSpace, type Texture } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { useAssets, SANS, MONO } from "../kit/assets";
import { Camera, camAt, type Shot } from "../kit/camera";
import { Grain, RED } from "../kit/film";
import { Solid } from "../kit/pass";
import { Look, Warmup } from "../kit/post";
import { glide } from "../kit/motion";

const FILM = "demo/film.mp4";
const TILT = 0.29; // lid leans back this far past vertical, radians

const Laptop: React.FC<{ screen: Texture | null }> = ({ screen }) => {
  const g = useMemo(() => {
    const deck = new RoundedBoxGeometry(0.312, 0.012, 0.218, 4, 0.006);
    deck.translate(0, 0.006, 0);
    const keys = new BoxGeometry(0.27, 0.0012, 0.105);
    keys.translate(0, 0.0129, -0.03);
    const pad = new BoxGeometry(0.115, 0.0008, 0.07);
    pad.translate(0, 0.0126, 0.062);
    const lid = new RoundedBoxGeometry(0.312, 0.21, 0.006, 4, 0.004);
    lid.translate(0, 0.105, -0.003);
    const panel = new PlaneGeometry(0.294, 0.1654); // 16:9 picture on the panel
    panel.translate(0, 0.108, 0.0002);
    return { deck, keys, pad, lid, panel };
  }, []);
  return (
    <group>
      <Solid geometry={g.deck} color="#c9ccd1" rough={0.32} metal={0.75} />
      <Solid geometry={g.keys} color="#16171a" rough={0.6} />
      <Solid geometry={g.pad} color="#b9bcc2" rough={0.25} metal={0.6} />
      <group position={[0, 0.012, -0.108]} rotation={[-TILT, 0, 0]}>
        <Solid geometry={g.lid} color="#0c0c0e" rough={0.3} metal={0.2} />
        {screen ? (
          <mesh geometry={g.panel}>
            <meshBasicMaterial map={screen} toneMapped={false} />
          </mesh>
        ) : (
          <Solid geometry={g.panel} color="#222" emissive="#333" />
        )}
      </group>
    </group>
  );
};

const Room: React.FC = () => {
  const g = useMemo(() => {
    const desk = new BoxGeometry(2.4, 0.03, 1.4);
    desk.translate(0, -0.015, 0);
    const wall = new PlaneGeometry(4, 3);
    wall.translate(0, 1.2, -0.75);
    const win = new PlaneGeometry(1.8, 1.2);
    win.translate(0.1, 0.9, -0.74);
    const mullion = new BoxGeometry(0.04, 1.2, 0.02);
    mullion.translate(-0.25, 0.9, -0.73);
    return { desk, wall, win, mullion };
  }, []);
  return (
    <>
      <Solid geometry={g.desk} color="#cfcac2" rough={0.85} />
      <Solid geometry={g.wall} color="#5d6268" rough={0.95} />
      <Solid geometry={g.mullion} color="#1c1d20" rough={0.6} />
      <mesh geometry={g.win}>
        <meshBasicMaterial color={[1.25, 1.35, 1.45]} />
      </mesh>
    </>
  );
};

const SHOTS = (n: number): Shot[] => [
  { from: 0, to: n, a: { pos: [0, 0.235, 0.33], target: [0, 0.1, -0.13], mm: 26 }, b: { pos: [0.004, 0.232, 0.31], target: [0, 0.1, -0.13], mm: 26 }, ease: glide, drift: 0.35 },
];

/**
 * The film frame arrives asynchronously, after @remotion/three has already
 * drawn this frame. Hold the frame until the new texture is in, draw again,
 * then release.
 */
const Screen: React.FC = () => {
  const tex = useOffthreadVideoTexture({ src: staticFile(FILM) });
  const advance = useThree((s) => s.advance);
  const frame = useCurrentFrame();
  const { delayRender, continueRender } = useDelayRender();
  const hold = useRef<number | null>(null);
  useLayoutEffect(() => {
    hold.current = delayRender(`film frame ${frame} on the laptop`);
    return () => {
      if (hold.current !== null) continueRender(hold.current);
      hold.current = null;
    };
  }, [frame, delayRender, continueRender]);
  useEffect(() => {
    if (!tex) return;
    tex.colorSpace = SRGBColorSpace;
    advance(performance.now());
    if (hold.current !== null) {
      const h = hold.current;
      hold.current = null;
      // one more animation frame so the GPU has presented the draw
      requestAnimationFrame(() => continueRender(h));
    }
  }, [tex, advance, continueRender]);
  return <Laptop screen={tex} />;
};

export const Reel: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const { isRendering } = useRemotionEnvironment();
  const ready = useAssets({});
  const cam = camAt(frame, SHOTS(durationInFrames));
  if (!ready) return null;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Audio src={staticFile(FILM)} />
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: false }}>
        <Camera state={cam} frame={frame} fps={fps} />
        <color attach="background" args={["#5d6268"]} />
        <hemisphereLight args={["#dfe8f2", "#6d655c", 1.0]} />
        <directionalLight position={[0.5, 1.4, -1.0]} intensity={2.0} color="#fff3e2" castShadow shadow-mapSize={[2048, 2048]} shadow-radius={6} shadow-bias={-0.0006} shadow-normalBias={0.02} />
        <Room />
        {isRendering ? <Screen /> : <Laptop screen={null} />}
        <Look focus={[0, 0.115, -0.14]} bokeh={2.4} focusRange={0.12} bloom={0.2} threshold={0.97} vignette={0.4} aberration={0.0004} saturation={0} contrast={0.03} />
        <Warmup />
      </ThreeCanvas>
      <Grain amount={0.05} />
      <div style={{ position: "absolute", top: 230, width: "100%", display: "flex", justifyContent: "center" }}>
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 40, letterSpacing: 4, color: "#fff", background: RED, padding: "10px 22px" }}>
          NO BLENDER · EVERY FRAME IS CODE
        </div>
      </div>
      <div style={{ position: "absolute", top: 1250, width: "100%", textAlign: "center", fontFamily: SANS, fontWeight: 700, fontSize: 56, color: "#fff", textShadow: "0 2px 16px rgba(0,0,0,0.6)" }}>
        POV: Claude does your 3D
      </div>
    </AbsoluteFill>
  );
};
