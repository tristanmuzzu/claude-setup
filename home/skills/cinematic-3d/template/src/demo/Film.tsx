// The demo film: one set, twelve shots, cut to the voice. Every frame is a
// pure function of the frame number.
import { ThreeCanvas } from "@remotion/three";
import { Audio } from "@remotion/media";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useMemo } from "react";
import { getJson, useAssets, SANS, MONO } from "../kit/assets";
import { Camera, camAt, type CamState, type Shot } from "../kit/camera";
import { CodeTag, FrameCounter, Grain, PassLabel, RED, Shutter, Tag, Weave } from "../kit/film";
import { Bars, CodeStack, MotionPath, usePaperPlaneGeometry } from "../kit/extras";
import { land, linear, glide, whip, prog, ticker, mix, rand, type V3 } from "../kit/motion";
import { Pass, Solid, type PassName } from "../kit/pass";
import { Look, Warmup } from "../kit/post";
import { DESK_Y, usePage, useTerminal, type TermLine } from "../kit/props";
import { Extruded } from "../kit/text3d";
import { AT, SUN_DIR, World } from "./World";
import { SKILL_PAGE } from "./copy";
import timing from "./timing.json";

type LineId = keyof typeof timing.lines;
const L = timing.lines;
/** Frame a word starts (index into the line's words). */
const w = (id: LineId, i = 0) => L[id].words[Math.min(i, L[id].words.length - 1)][1] as number;
const from = (id: LineId) => L[id].from;

export const FILM_FRAMES = timing.total;

const FONTS = {
  sans: "fonts/inter-800.typeface.json",
  mono: "fonts/courier-700.typeface.json",
};

const SCREEN: V3 = [0.247, 1.01, 0.02];
const HOOK_TEXT: V3 = [-0.3, DESK_Y + 0.075, 0.4];
const VOID: V3 = [20, 1, 0];
const CTA: V3 = [-0.2, DESK_Y, 0.04];

// Cut points.
const C = {
  hook: 0,
  blender: from("blender"),
  code: from("code"),
  ask: from("ask"),
  askMove: w("ask", 5),
  give: from("give"),
  camera: from("camera"),
  light: from("light"),
  motion: from("motion"),
  sound: from("sound"),
  one: from("one"),
  writes: from("writes"),
  crt: from("writes") + 48,
  cta: from("cta"),
  ctaWire: from("cta") + 62,
  end: timing.total,
};

const SHOTS: Shot[] = [
  // 1. Split beauty / wire, slow push on the whole set.
  { from: C.hook, to: C.blender, a: { pos: [0.92, 1.16, 1.5], target: [-0.02, 0.9, 0.08], mm: 35 }, b: { pos: [0.74, 1.1, 1.24], target: [-0.04, 0.89, 0.06], mm: 35 }, ease: glide },
  // 2. The computer in the stripes, slow orbit.
  { from: C.blender, to: C.code, a: { pos: [-0.2, 1.06, 0.74], target: [0.24, 0.98, -0.1], mm: 50 }, b: { pos: [-0.05, 1.04, 0.74], target: [0.24, 0.98, -0.1], mm: 50 } },
  // 3. Push into the screen.
  { from: C.code, to: C.ask, a: { pos: [0.02, 1.06, 0.7], target: [0.18, 1.0, 0.0], mm: 40 }, b: { pos: [0.16, 1.02, 0.4], target: SCREEN, mm: 50 }, ease: land },
  // 4. Flat pass: stiff frontal wide, then a robotic linear move.
  { from: C.ask, to: C.askMove, a: { pos: [0.1, 1.16, 1.3], target: [0.06, 0.96, -0.1], mm: 35 }, drift: 0 },
  { from: C.askMove, to: C.give, a: { pos: [-0.55, 1.22, 0.7], target: AT.paper, mm: 35 }, b: { pos: [-0.1, 1.28, 0.62], target: AT.paper, mm: 35 }, ease: linear, drift: 0 },
  // 5. Same paper, the sun comes in; push to the page.
  { from: C.give, to: C.camera, a: { pos: [-0.5, 1.13, 0.5], target: AT.paper, mm: 50 }, b: { pos: [-0.3, 1.0, 0.34], target: [-0.19, DESK_Y, 0.09], mm: 50 }, ease: land },
  // 6. CAMERA: low across the desk, rack focus mug -> computer.
  { from: C.camera, to: C.light, a: { pos: [-0.86, 0.84, 0.7], target: [-0.12, 0.86, -0.06], mm: 40 }, b: { pos: [-0.82, 0.84, 0.66], target: [-0.1, 0.87, -0.06], mm: 46 } },
  // 7. LIGHT: whip to the back wall, then hold on the moving stripes.
  { from: C.light, to: C.light + 9, a: { pos: [-0.82, 0.84, 0.66], target: [-0.1, 0.87, -0.06], mm: 46 }, b: { pos: [0.22, 1.16, 0.62], target: [-0.45, 1.22, -0.5], mm: 35 }, ease: whip, drift: 0.1 },
  { from: C.light + 9, to: C.motion, a: { pos: [0.22, 1.16, 0.62], target: [-0.45, 1.22, -0.5], mm: 35 }, b: { pos: [0.16, 1.14, 0.5], target: [-0.45, 1.2, -0.5], mm: 35 } },
  // 8. MOTION: wire pass, wide, the paper plane flies its path.
  { from: C.motion, to: C.sound, a: { pos: [0.75, 1.32, 1.12], target: [-0.18, 0.98, -0.08], mm: 35 }, b: { pos: [0.62, 1.3, 1.16], target: [-0.18, 0.98, -0.08], mm: 35 }, ease: glide },
  // 9. SOUND: low across the desk to bars driven by the voice.
  { from: C.sound, to: C.one, a: { pos: [-0.9, 0.85, 0.74], target: [-0.15, 0.8, 0.3], mm: 35 }, b: { pos: [-0.84, 0.84, 0.66], target: [-0.15, 0.8, 0.3], mm: 40 } },
  // 10. One skill file: top-down onto the page.
  { from: C.one, to: C.writes, a: { pos: [-0.24, 1.36, 0.36], target: AT.paper, mm: 50 }, b: { pos: [-0.22, 1.1, 0.24], target: AT.paper, mm: 50 } },
  // 11a. The code: travel along the fanned stack of real source files.
  { from: C.writes, to: C.crt, a: { pos: [VOID[0] + 0.95, VOID[1] + 0.2, 1.45], target: [VOID[0] - 0.05, VOID[1] - 0.05, -0.1], mm: 35 }, b: { pos: [VOID[0] + 0.7, VOID[1] + 0.1, 1.2], target: [VOID[0] - 0.08, VOID[1] - 0.05, -0.12], mm: 38 }, ease: glide },
  // 11b. Back to the computer, Claude typing.
  { from: C.crt, to: C.cta, a: { pos: [-0.04, 1.07, 0.7], target: SCREEN, mm: 40 }, b: { pos: [0.08, 1.04, 0.5], target: SCREEN, mm: 45 } },
  // 12. CTA: the type stands in the sun on the desk.
  { from: C.cta, to: C.end, a: { pos: [-0.26, 1.0, 1.0], target: [-0.2, 0.87, 0.04], mm: 50 }, b: { pos: [-0.23, 0.97, 0.84], target: [-0.2, 0.87, 0.04], mm: 50 }, ease: glide },
];

const passAt = (f: number): PassName => {
  if (f >= C.ask && f < C.give) return "flat";
  if (f >= C.motion && f < C.sound) return "wire";
  if (f >= C.ctaWire) return "wire";
  return "beauty";
};

const TERM_TITLE = "SKILL/3D  -  film/cams.ts";
const CAMS: TermLine[] = [
  { text: "camera.push(0.8, 0.64)" },
  { text: "camera.orbit(25)" },
  { text: "camera.dolly(0.76, 0.42)" },
  { text: "// every frame of it.", color: "#9fd8b8" },
];
const PROMPT: TermLine = { text: "> make a cinematic 3D desk scene", color: "#9fd8b8" };
const NOSKILL: TermLine[] = [{ text: "> make a" }, { text: "cinematic" }, { text: "3D desk scene" }];

const chars = (lines: TermLine[]) => lines.reduce((n, l) => n + l.text.length, 0);

/** What the computer screen shows on frame f. */
const screenAt = (f: number, fps: number) => {
  const blink = Math.floor(f / 9) % 2 === 0;
  if (f >= C.ask && f < C.give) {
    return { title: "CLAUDE  -  NO SKILL", lines: NOSKILL, chars: 99, cursorOn: blink, size: 92, highlight: -1 };
  }
  if (f >= C.crt) {
    const lines = [PROMPT, ...CAMS.slice(0, 3)];
    const n = Math.floor(((f - C.crt - 4) / fps) * 46);
    return { title: TERM_TITLE, lines, chars: Math.max(0, n), cursorOn: true, size: 46, highlight: -1 };
  }
  const typeStart = C.code + 8;
  const lines = [PROMPT, ...CAMS];
  const n = PROMPT.text.length + Math.max(0, Math.floor(((f - typeStart) / fps) * 40));
  const hl = f >= typeStart ? Math.min(3, 1 + Math.floor(((f - typeStart) / fps) * 40 / 22)) : -1;
  return { title: TERM_TITLE, lines, chars: f < C.code ? PROMPT.text.length : n, cursorOn: blink || f < typeStart + 60, size: 46, highlight: hl };
};

const Sfx: React.FC<{ at: number; src: string; volume?: number; dur?: number }> = ({ at, src, volume = 1, dur = 120 }) => (
  <Sequence from={Math.max(0, Math.round(at))} durationInFrames={dur} layout="none">
    <Audio src={staticFile(`sfx/${src}`)} volume={volume} />
  </Sequence>
);

/** Every sound under the picture. Each cut gets a hit; typing gets ticks. */
const SoundTrack: React.FC<{ music?: boolean }> = () => {
  const ticks: number[] = [];
  for (let f = C.code + 8; f < C.code + 8 + (chars(CAMS) / 40) * 30; f += 2) ticks.push(f + Math.round(rand(f, 1)));
  for (let f = C.crt + 4; f < C.crt + 4 + (chars([PROMPT, ...CAMS.slice(0, 3)]) / 46) * 30 && f < C.cta; f += 2) ticks.push(f + Math.round(rand(f, 2)));
  return (
    <>
      <Audio src={staticFile("demo/vo.wav")} volume={1} />
      <Sequence layout="none">
        <Audio src={staticFile("sfx/room.wav")} volume={0.12} loop />
      </Sequence>
      <Sfx at={0} src="boom.wav" volume={0.55} dur={90} />
      <Sfx at={C.blender} src="hit.wav" volume={0.5} />
      <Sfx at={C.code} src="hit.wav" volume={0.35} />
      <Sfx at={C.ask} src="blip.wav" volume={0.35} />
      <Sfx at={C.give - 36} src="riser.wav" volume={0.35} dur={40} />
      <Sfx at={C.give} src="boom.wav" volume={0.6} />
      <Sfx at={C.give + 4} src="pad.wav" volume={0.32} dur={100} />
      {[C.camera, C.light, C.motion, C.sound].map((f, i) => (
        <Sfx key={f} at={f} src="hit.wav" volume={0.42 + i * 0.03} />
      ))}
      {[C.camera, C.light, C.motion, C.sound].map((f) => (
        <Sfx key={`b${f}`} at={f + 2} src="blip.wav" volume={0.18} dur={10} />
      ))}
      <Sfx at={C.light - 2} src="whoosh.wav" volume={0.5} dur={20} />
      <Sfx at={C.writes} src="hit.wav" volume={0.45} />
      <Sfx at={C.writes + 2} src="pad_hi.wav" volume={0.28} dur={100} />
      <Sfx at={C.crt - 3} src="whoosh.wav" volume={0.35} dur={20} />
      {ticks.map((f, i) => (
        <Sfx key={`t${f}`} at={f} src={`tick${(i % 4) + 1}.wav`} volume={0.22 + rand(i, 5) * 0.12} dur={4} />
      ))}
      <Sfx at={C.cta} src="boom.wav" volume={0.62} />
      <Sfx at={C.cta + 4} src="pad.wav" volume={0.3} dur={90} />
      <Sfx at={C.ctaWire} src="whoosh.wav" volume={0.3} dur={20} />
    </>
  );
};

/** Everything inside the 3D world for one pass. */
const Scene: React.FC<{ pass: PassName; cam: CamState; frame: number; fps: number; levels: number[] }> = ({ pass, cam, frame, fps, levels }) => {
  const s = screenAt(frame, fps);
  const screen = useTerminal(s);
  const page = usePage(SKILL_PAGE, "skill");
  const plane = usePaperPlaneGeometry();
  const code = getJson<{ lines: number; files: { name: string; text: string }[] }>("demo/code.json");
  const files = useMemo(() => code.files.filter((f) => f.name.includes("kit/") || f.name.includes("Film")).slice(0, 9), [code]);

  // Sun: off in the flat pass, rises on "give", and slides during LIGHT.
  const sun = frame < C.give ? 1 : mix(0.0, 1, prog(frame, C.give, C.give + 26, land));
  const yaw = frame >= C.light && frame < C.motion ? mix(-0.05, 0.06, prog(frame, C.light, C.motion, glide)) : 0;
  const sunDir: V3 = [SUN_DIR[0] * Math.cos(yaw) - SUN_DIR[2] * Math.sin(yaw), SUN_DIR[1], SUN_DIR[0] * Math.sin(yaw) + SUN_DIR[2] * Math.cos(yaw)];

  // Focus: the shot target, except the CAMERA rack focus.
  let focus = cam.target;
  if (frame < C.blender) focus = HOOK_TEXT;
  if (frame >= C.writes && frame < C.crt) focus = [VOID[0], VOID[1], 0];
  if (frame >= C.camera && frame < C.light) {
    const k = prog(frame, C.camera + 8, C.camera + 28, land);
    focus = [mix(AT.mug[0], 0.2, k), mix(0.8, 0.98, k), mix(AT.mug[2], -0.08, k)];
  }
  if (frame >= C.cta) focus = [-0.2, 0.86, 0.04];

  const inCta = frame >= C.cta;
  const planeT = prog(frame, C.motion + 2, C.sound - 2, land);
  const pathPts: V3[] = [
    [0.42, DESK_Y + 0.03, 0.4],
    [0.12, 1.05, 0.36],
    [-0.22, 1.24, 0.12],
    [-0.5, 1.12, -0.12],
    [-0.62, 0.98, -0.3],
  ];

  return (
    <Pass name={pass}>
      <Camera state={cam} frame={frame} fps={fps} />
      <World frame={frame} fps={fps} screen={screen} page={page} sun={sun} sunDir={sunDir}>
        {/* 1. "This isn't footage." standing on the desk */}
        {frame < C.blender && (
          <Extruded
            text={"This isn't\nfootage."}
            font={FONTS.sans}
            size={0.075}
            position={HOOK_TEXT}
            rotation={[0, 0.84, 0]}
            color="#efe6d8"
            rough={0.45}
            frame={frame}
            reveal={{ start: w("hook", 0) - 2, stagger: 1.2, dur: 16 }}
          />
        )}
        {/* 3. "It's code." */}
        {frame >= C.code && frame < C.ask && (
          <Extruded
            text={"It's\ncode."}
            font={FONTS.sans}
            size={0.05}
            position={[-0.06, DESK_Y + 0.062, 0.14]}
            rotation={[0, 0.38, 0]}
            color="#efe6d8"
            rough={0.45}
            frame={frame}
            reveal={{ start: w("code", 0), stagger: 1.4, dur: 14, style: "drop" }}
          />
        )}
        {/* 8. MOTION: the plane and its path */}
        {frame >= C.motion && frame < C.sound && (
          <MotionPath points={pathPts} t={planeT} drawn={Math.min(1, prog(frame, C.motion, C.motion + 14, land) + 0.02)}>
            <group scale={1.8}><Solid geometry={plane} color="#f4efe6" side="double" rough={0.7} edgeAngle={1} noHull /></group>
          </MotionPath>
        )}
        {/* 9. SOUND: bars on the desk */}
        {frame >= C.sound && frame < C.one && <Bars levels={levels} position={[-0.32, DESK_Y, 0.36]} width={0.62} maxH={0.2} rotationY={0.12} />}
        {/* 12. CTA type on the desk */}
        {inCta && (
          <group position={CTA}>
            <Extruded text="Comment" font={FONTS.sans} size={0.038} position={[0, 0.2, -0.02]} color="#d6c9b4" rough={0.45} frame={frame} reveal={{ start: w("cta", 0) - 1, stagger: 1.2 }} />
            <Extruded text="skill" font={FONTS.mono} size={0.11} depth={0.03} position={[0, 0.088, 0]} color="#cdbfa9" rough={0.4} frame={frame} reveal={{ start: w("cta", 1), stagger: 2.2, dur: 18, style: "drop" }} />
            <Extruded text="I'll send you the file." font={FONTS.mono} size={0.027} depth={0.008} bevel={0.0008} position={[0, 0.04, 0.04]} color="#f0e4d2" emissive="#ffcf9a" emissiveIntensity={0.18} rough={0.5} frame={frame} reveal={{ start: w("cta", 3), stagger: 0.7, dur: 12 }} />
          </group>
        )}
      </World>
      {/* 11. The code, far away from the set in its own void */}
      {frame >= C.writes && frame < C.crt && (
        <group>
          <CodeStack files={files} position={VOID} open={prog(frame, C.writes, C.writes + 30, land)} />
          <pointLight position={[VOID[0] + 0.6, VOID[1] + 0.6, 1]} intensity={0.6} color="#ffb070" />
        </group>
      )}
      <Look focus={focus} bokeh={frame >= C.writes && frame < C.crt ? 1.2 : 3} focusRange={frame >= C.camera && frame < C.light ? 0.12 : 0.3} />
      <Warmup />
    </Pass>
  );
};

const Canvas3D: React.FC<{ pass: PassName; cam: CamState; levels: number[] }> = ({ pass, cam, levels }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} shadows gl={{ antialias: false, powerPreference: "high-performance" }}>
      <Scene pass={pass} cam={cam} frame={frame} fps={fps} levels={levels} />
    </ThreeCanvas>
  );
};

/** 2D title for the flat "no skill" shot, in the plain style a default prompt gets. */
const FlatTitle: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < C.ask || frame >= C.give) return null;
  const out = interpolate(frame, [C.askMove + 6, C.askMove + 14], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const a = (frame >= w("ask", 0) ? 1 : 0) * out;
  const b = (frame >= w("ask", 5) - 2 ? 1 : 0) * out;
  return (
    <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center", fontFamily: SANS, fontWeight: 800, fontSize: 92, lineHeight: 1.05, color: "#111", letterSpacing: -2 }}>
      <div style={{ opacity: a }}>Ask Claude for 3D</div>
      <div style={{ opacity: b }}>you get this.</div>
    </div>
  );
};

/** The lines-of-code counter over the code stack. */
const CodeCounter: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < C.writes || frame >= C.crt) return null;
  const code = getJson<{ lines: number }>("demo/code.json");
  const n = ticker(frame, C.writes + 2, C.writes + 38, 0, code.lines, land);
  return (
    <div style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", fontFamily: MONO, color: RED }}>
      <div style={{ fontSize: 30, letterSpacing: 6, fontWeight: 500 }}>LINES OF CODE BY CLAUDE</div>
      <div style={{ fontSize: 132, fontWeight: 700, lineHeight: 1.1, textShadow: `0 0 40px ${RED}66` }}>{n.toLocaleString("en-US")}</div>
    </div>
  );
};

/** Lens readout for the CAMERA shot. */
const LensHud: React.FC<{ cam: CamState }> = ({ cam }) => {
  const frame = useCurrentFrame();
  if (frame < C.camera || frame >= C.light) return null;
  const k = prog(frame, C.camera + 8, C.camera + 28, land);
  const dist = mix(0.62, 1.08, k);
  return (
    <div style={{ position: "absolute", left: 120, top: 210, fontFamily: MONO, fontSize: 26, letterSpacing: 3, color: "#f1e4d0", opacity: 0.85 }}>
      {Math.round(cam.mm)} MM · f/1.4 · FOCUS {dist.toFixed(2)} m
    </div>
  );
};

export const Film: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const ready = useAssets({ typefaces: Object.values(FONTS), json: ["demo/code.json"] });
  const audio = useAudioData(staticFile("demo/vo.wav"));
  const levels = useMemo(() => {
    if (!audio) return new Array(28).fill(0);
    const v = visualizeAudio({ fps, frame, audioData: audio, numberOfSamples: 64, smoothing: true });
    return v.slice(2, 30).map((x, i) => Math.min(1, Math.pow(x * (6 + i * 0.6), 0.75)));
  }, [audio, frame, fps]);
  const cam = camAt(frame, SHOTS);
  const pass = passAt(frame);
  if (!ready) return null;

  // Shot 1 is split: beauty on the left, the wire pass on the right.
  const split = frame < C.blender ? interpolate(frame, [0, 8, C.blender - 12, C.blender], [1, 0.56, 0.5, 1.0], { extrapolateRight: "clamp", easing: land }) : 1;
  const splitPx = split * width;

  const tag = (id: LineId, text: string, end: number, dark = false) => (
    <Tag text={text} start={from(id)} end={end} x={120} y={110} size={66} color={dark ? RED : RED} />
  );

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <SoundTrack />
      <Weave>
        <Shutter speed={cam.speed} id="shutter">
          {/* A fresh canvas per pass: swapping the effect composer inside a live canvas leaves it stale. */}
          <Canvas3D key={pass} pass={pass} cam={cam} levels={levels} />
        </Shutter>
        {split < 1 && (
          <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${splitPx}px)` }}>
            <Canvas3D pass="wire" cam={cam} levels={levels} />
            <PassLabel pass="wire" x={splitPx + 28} y={36} />
            <CodeTag code="camera.push(0.8, 0.64)" at={[0.3, 1.32, -0.3]} cam={cam} start={6} size={28} />
            <CodeTag code="crt.glass({ r: 0.011 })" at={[0.45, 1.12, -0.05]} cam={cam} start={10} size={28} />
            <CodeTag code={'caption("This isn\'t footage.")'} at={[-0.2, 0.97, 0.44]} cam={cam} start={14} size={28} color={RED} />
            <CodeTag code="keyboard({ keys: 70 })" at={[0.45, 0.8, 0.3]} cam={cam} start={18} size={28} />
          </AbsoluteFill>
        )}
        {split < 1 && <div style={{ position: "absolute", left: splitPx - 1, top: 0, bottom: 0, width: 2, background: RED, opacity: 0.8 }} />}
      </Weave>
      {pass === "beauty" && <Grain amount={0.11} />}
      <FlatTitle />
      {frame >= w("blender", 3) - 2 && frame < C.code && <Tag text="NOT BLENDER" start={w("blender", 3) - 2} x={120} y={110} size={66} cps={30} />}
      {tag("camera", "CAMERA", C.light)}
      {tag("light", "LIGHT", C.motion)}
      {tag("motion", "MOTION", C.sound, true)}
      {tag("sound", "SOUND", C.one)}
      {frame >= C.light && frame < C.motion && (
        <CodeTag code={'sun.through("blinds")'} at={[-0.62, 1.12, -0.49]} cam={cam} start={C.light + 10} size={54} color="#f6e7cf" />
      )}
      <LensHud cam={cam} />
      <CodeCounter />
      {pass === "wire" && <PassLabel pass="wire" />}
      <FrameCounter total={durationInFrames} />
    </AbsoluteFill>
  );
};
