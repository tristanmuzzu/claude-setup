import type { MdBlock } from "../kit/props";

/** The page shown on the desk: the skill's own rules, printed. */
export const SKILL_PAGE: MdBlock[] = [
  { h1: "skill" },
  { p: "Cinematic 3D rules for Claude." },
  { h2: "camera" },
  { li: "lenses 35 / 50 / 85 mm, real DOF" },
  { li: "never lock a hold: drift 0.2-0.4 deg" },
  { li: "land on the beat: ease(.2,.8,.2,1)" },
  { h2: "light" },
  { li: "one motivated key. bounce it." },
  { li: "haze in the beam, dust in bokeh" },
  { li: "ACES, halation, 35 mm grain" },
  { h2: "motion" },
  { li: "analytic curves, frame-pure" },
  { li: "springs overshoot 1-2 %" },
  { li: "shutter smear on every whip" },
  { h2: "sound" },
  { li: "every cut has a hit" },
  { li: "picture follows the waveform" },
];
