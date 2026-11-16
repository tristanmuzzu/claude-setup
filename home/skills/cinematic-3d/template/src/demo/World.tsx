// The one set every shot of the demo is filmed in. Shots only move the
// camera, switch the pass and change what the screens and paper show.
import type { Texture } from "three";
import { Beams, BlindsGobo, Bounce, Dust, FlatLight, Sun, type Blinds } from "../kit/light";
import { BlindSlats, Desk, DESK_Y, Keyboard, Mug, Paper, Plant, RetroComputer, Room, Sky } from "../kit/props";
import { usePass } from "../kit/pass";
import type { V3 } from "../kit/motion";

export const WIN = { z: -0.02, y: 1.28, w: 0.9, h: 0.95 };
export const WALL_X = -1.0;
export const BLINDS: Blinds = {
  center: [WALL_X - 0.03, WIN.y, WIN.z],
  w: WIN.w,
  h: WIN.h,
  normal: [-1, 0, 0],
  pitch: 0.05,
  open: 0.42,
  tilt: 0,
};
export const SUN_DIR: V3 = [1, -0.6, -0.42];

// Where things sit (also used to aim the camera and pin code tags).
export const AT = {
  computer: [0.28, DESK_Y, -0.16] as V3,
  screen: [0.28, DESK_Y + 0.27, 0.03] as V3,
  keyboard: [0.3, DESK_Y, 0.24] as V3,
  mug: [-0.56, DESK_Y, 0.2] as V3,
  plant: [-0.62, DESK_Y, -0.3] as V3,
  paper: [-0.2, DESK_Y + 0.001, 0.12] as V3,
};

export const World: React.FC<{
  frame: number;
  fps: number;
  screen: Texture;
  page: Texture;
  /** 0 = sun off (flat world), 1 = full sun. */
  sun?: number;
  sunDir?: V3;
  children?: React.ReactNode;
}> = ({ frame, fps, screen, page, sun = 1, sunDir = SUN_DIR, children }) => {
  const pass = usePass();
  return (
    <>
      <color attach="background" args={[pass === "wire" ? "#ecebe6" : pass === "flat" ? "#dfe3e8" : "#0b0806"]} />
      {pass === "flat" ? (
        <FlatLight />
      ) : pass === "beauty" ? (
        <>
          <Sun dir={sunDir} focus={[-0.1, 0.95, -0.05]} span={1.3} intensity={11 * sun} frame={frame} fps={fps} />
          <Bounce level={0.25 + 0.6 * sun} at={[-0.2, 1.45, 0.6]} />
          <Beams blinds={BLINDS} dir={sunDir} length={2.1} strength={0.035 * sun} frame={frame} fps={fps} />
          <Dust
            count={700}
            box={{ min: [-0.95, DESK_Y + 0.02, -0.45], max: [0.7, 1.7, 0.6] }}
            blinds={BLINDS}
            dir={sunDir}
            frame={frame}
            fps={fps}
          />
          <Sky x={WALL_X - 0.6} y={WIN.y} z={WIN.z} w={3} h={2.4} level={2.6 * sun + 0.2} />
        </>
      ) : null}
      <BlindsGobo blinds={BLINDS} />
      <Room win={WIN} wallX={WALL_X} />
      <BlindSlats x={WALL_X - 0.01} y={WIN.y} z={WIN.z} w={WIN.w} h={WIN.h} />
      <Desk x={0.2} />
      <RetroComputer position={AT.computer} rotationY={-0.18} screen={screen} />
      <Keyboard position={AT.keyboard} rotationY={-0.12} />
      <Mug position={AT.mug} rotationY={0.6} />
      <Plant position={AT.plant} />
      <Paper position={AT.paper} rotationY={0.32} page={page} />
      {children}
    </>
  );
};
