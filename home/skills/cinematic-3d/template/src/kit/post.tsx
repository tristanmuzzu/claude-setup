// The lens and the film stock: ACES tone mapping, physical depth of field
// focused on a world point, bloom for halation, a touch of chromatic
// aberration and vignette. Grain and gate weave are 2D (film.tsx) so they stay
// deterministic per frame.
import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  HueSaturation,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { useLayoutEffect, useMemo } from "react";
import { useDelayRender } from "remotion";
import { useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import { usePass } from "./pass";
import type { V3 } from "./motion";

export const Look: React.FC<{
  /** World point in focus. Omit for no depth of field. */
  focus?: V3;
  /** Size of the bokeh. 2-5 reads as a fast prime on a small set. */
  bokeh?: number;
  /** Depth in metres that stays sharp around the focus point. */
  focusRange?: number;
  bloom?: number;
  threshold?: number;
  aberration?: number;
  vignette?: number;
  saturation?: number;
  contrast?: number;
}> = ({
  focus,
  bokeh = 3,
  focusRange = 0.25,
  bloom = 0.9,
  threshold = 0.72,
  aberration = 0.0007,
  vignette = 0.55,
  saturation = -0.05,
  contrast = 0.06,
}) => {
  const pass = usePass();
  const ca = useMemo(() => new Vector2(aberration, aberration * 0.6), [aberration]);
  if (pass === "wire") return null;
  if (pass === "flat") {
    return (
      <EffectComposer multisampling={4}>
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={4}>
      {focus ? (
        <DepthOfField target={focus} worldFocusRange={focusRange} bokehScale={bokeh} />
      ) : (
        <></>
      )}
      <Bloom intensity={bloom} luminanceThreshold={threshold} luminanceSmoothing={0.2} mipmapBlur radius={0.75} />
      <ChromaticAberration offset={ca} radialModulation modulationOffset={0.35} blendFunction={BlendFunction.NORMAL} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={saturation} />
      <BrightnessContrast contrast={contrast} />
      <Vignette offset={0.28} darkness={vignette} />
    </EffectComposer>
  );
};

/**
 * EffectComposer draws black on the first frame after the canvas mounts
 * (its render targets are not ready yet), and @remotion/three advances only
 * once per frame. On mount, hold the frame and render a few more times on
 * animation frames before letting Remotion take the screenshot.
 */
export const Warmup: React.FC<{ renders?: number }> = ({ renders = 3 }) => {
  const advance = useThree((s) => s.advance);
  const { delayRender, continueRender } = useDelayRender();
  useLayoutEffect(() => {
    const h = delayRender("Warming up the effect composer");
    let n = 0;
    let raf = 0;
    const tick = () => {
      advance(performance.now());
      if (++n < renders) raf = requestAnimationFrame(tick);
      else continueRender(h);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      continueRender(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};
