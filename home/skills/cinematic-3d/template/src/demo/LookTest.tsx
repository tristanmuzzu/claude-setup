// Look development: one frame of the set in each pass from a few angles.
import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { useAssets } from "../kit/assets";
import { Camera, camAt, type Shot } from "../kit/camera";
import { Grain, FrameCounter } from "../kit/film";
import { Pass, type PassName } from "../kit/pass";
import { Look, Warmup } from "../kit/post";
import { useTerminal, usePage } from "../kit/props";
import { AT, World } from "./World";
import { SKILL_PAGE } from "./copy";

const SHOTS: Shot[] = [
  { from: 0, to: 10, a: { pos: [0.9, 1.25, 1.35], target: [0.0, 0.92, -0.1], mm: 35 } },
  { from: 10, to: 20, a: { pos: [0.42, 1.0, 0.45], target: AT.screen, mm: 50 } },
  { from: 20, to: 30, a: { pos: [-0.05, 1.12, 0.62], target: AT.paper, mm: 50 } },
  { from: 30, to: 40, a: { pos: [-0.3, 0.86, 0.75], target: [0.1, 0.9, -0.2], mm: 35 } },
];

export const LookTest: React.FC<{ pass: PassName; post?: boolean }> = ({ pass, post = true }) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const ready = useAssets({});
  const cam = camAt(frame, SHOTS);
  const screen = useTerminal({
    title: "SKILL/3D  -  film/cams.ts",
    lines: [{ text: "> make a cinematic 3D desk scene", color: "#9fd8b8" }, { text: "camera.push(0.8, 0.64)" }, { text: "camera.orbit(25)" }, { text: "camera.dolly(0.76, 0.42)" }],
    chars: 999,
    cursorOn: true,
    size: 46,
  });
  const page = usePage(SKILL_PAGE, "skill");
  if (!ready) return null;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: false, powerPreference: "high-performance" }}>
        <Pass name={pass}>
          <Camera state={cam} frame={frame} fps={fps} />
          <World frame={frame} fps={fps} screen={screen} page={page} />
          {post && <Look focus={cam.target} />}
          <Warmup />
        </Pass>
      </ThreeCanvas>
      {pass === "beauty" && <Grain />}
      <FrameCounter total={durationInFrames} />
    </AbsoluteFill>
  );
};
