// Everything the scene needs before frame 0 can be drawn: web fonts for
// canvas textures and the HUD, typeface JSON for extruded 3D text, and any
// JSON data. The composition mounts its ThreeCanvas only once this is ready,
// so no frame is ever drawn with a fallback font.
import { useEffect, useState } from "react";
import { staticFile, useDelayRender } from "remotion";
import { Font, FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadSans } from "@remotion/google-fonts/Inter";

const mono = loadMono("normal", { weights: ["400", "500", "700"], subsets: ["latin"] });
const sans = loadSans("normal", { weights: ["500", "700", "800"], subsets: ["latin"] });
export const MONO = `${mono.fontFamily}, monospace`;
export const SANS = `${sans.fontFamily}, sans-serif`;

const typefaces = new Map<string, Font>();
const json = new Map<string, unknown>();

export const getTypeface = (path: string) => {
  const f = typefaces.get(path);
  if (!f) throw new Error(`Typeface ${path} was not listed in useAssets()`);
  return f;
};
export const getJson = <T,>(path: string) => {
  if (!json.has(path)) throw new Error(`JSON ${path} was not listed in useAssets()`);
  return json.get(path) as T;
};

const loadTypeface = async (path: string) => {
  if (typefaces.has(path)) return;
  const r = await fetch(staticFile(path));
  typefaces.set(path, new FontLoader().parse((await r.json()) as never));
};
const loadJson = async (path: string) => {
  if (json.has(path)) return;
  const r = await fetch(staticFile(path));
  json.set(path, await r.json());
};

/** Hold the render until fonts, typefaces and data are in memory. */
export const useAssets = (opts: { typefaces?: string[]; json?: string[] }) => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading fonts, typefaces and data"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([
      mono.waitUntilDone(),
      sans.waitUntilDone(),
      ...(opts.typefaces ?? []).map(loadTypeface),
      ...(opts.json ?? []).map(loadJson),
    ])
      .then(() => document.fonts.ready)
      .then(() => setReady(true))
      .catch((e) => cancelRender(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Release only after the commit that mounts the canvas, so its own hold is already in place.
  useEffect(() => {
    if (ready) continueRender(handle);
  }, [ready, handle, continueRender]);
  return ready;
};
