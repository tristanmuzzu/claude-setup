// Live 2D textures for screens, paper and code pages. The canvas is redrawn
// whenever `key` changes (usually the frame or the typed character count),
// during render, so the texture is current before the frame is drawn.
import { useMemo } from "react";
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";

export const useCanvasTexture = (
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  key: unknown,
) => {
  const { canvas, tex } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    return { canvas, tex };
  }, [w, h]);
  useMemo(() => {
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    tex.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, tex, key]);
  return tex;
};

/** Wrap text to a width on a 2D canvas. */
export const wrap = (g: CanvasRenderingContext2D, text: string, maxW: number) => {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
};
