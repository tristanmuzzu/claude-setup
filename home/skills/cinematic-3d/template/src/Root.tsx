import { Composition } from "remotion";
import { LookTest } from "./demo/LookTest";
import { Film, FILM_FRAMES } from "./demo/Film";
import { Reel } from "./demo/Reel";
export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Film" component={Film} durationInFrames={FILM_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="Reel" component={Reel} durationInFrames={FILM_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="LookBeauty" component={LookTest} durationInFrames={40} fps={30} width={1920} height={1080} defaultProps={{ pass: "beauty" as const }} />
    <Composition id="LookWire" component={LookTest} durationInFrames={40} fps={30} width={1920} height={1080} defaultProps={{ pass: "wire" as const }} />
    <Composition id="LookFlat" component={LookTest} durationInFrames={40} fps={30} width={1920} height={1080} defaultProps={{ pass: "flat" as const }} />
  </>
);
