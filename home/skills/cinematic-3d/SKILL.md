---
name: cinematic-3d
description: "Make cinematic 3D videos entirely in code (no Blender): React Three Fiber inside Remotion, directed like a film crew would, with lenses in mm, one motivated key light, physical depth of field, springs, sound on every cut, and the beauty / wire / flat render passes that show the audience it is code. Use for any 3D reel, 3D animation, 3D product shot, '3D in code', 'no Blender', 'Claude does your 3D', R3F or three.js video, or a request to recreate a cinematic 3D look. Ships a working kit and a 22-second demo film."
---

# Cinematic 3D in code

A plain prompt for "a cinematic 3D scene" gets flat, even light, default
colours, a locked camera and linear moves. This skill exists to close that
gap. Treat every shot the way a camera operator, a gaffer, an animator and a
sound designer would, and write each decision down as a number.

Everything renders through Remotion, so each frame is a pure function of the
frame number. Renders are deterministic, can run in parallel, and any frame
can be re-rendered on its own.

The kit, the demo film and the scripts live in `template/`. Copy it to a
project folder and run `npm install` there; renders go to `out/`.

## Start a project

```bash
~/.claude/skills/cinematic-3d/scripts/new.sh <dest-dir>
```

It copies the template, installs the pinned packages, builds the 3D fonts and
the sound bank, and type-checks. To add the kit to an existing Remotion
project instead, copy `template/src/kit`, `template/scripts` and
`template/public/fonts`, then add the dependencies listed in
`template/package.json` (three, @react-three/fiber, @react-three/postprocessing,
postprocessing, @remotion/three, @remotion/media-utils).

## The rules

These are the rules printed on the paper in the demo. Each has a kit
component that enforces it.

### Camera (`kit/camera.tsx`)
- **Lenses in millimetres, not field of view.** Use a 35 mm lens for
  establishing shots, 50 mm for subjects and 85 mm for details and rack focus.
  Use 26 mm for a phone POV. `fovFor(mm)` assumes a full-frame sensor.
- **A shot is a move from pose A to pose B with one ease.** Cut shots back to
  back (`Shot[]`, `camAt(frame, shots)`). Don't string keyframes together inside
  a shot. If a move needs two eases, it is two shots.
- **Never lock a hold.** Every shot drifts by 0.15-0.4 degrees of layered noise
  (`drift`). Use 0 only on purpose: the robotic "no skill" shot is the one
  shot that has it.
- **Land on the beat.** Default ease `land` = cubic-bezier(.2,.8,.2,1). Use
  `whip` for whip pans, `glide` for long drifts, `linear` only to look cheap.
- **Focus is a world point.** DOF focuses on the shot's target unless the shot
  says otherwise. A rack focus means animating that point (`focus` in
  `<Look>`); `focusRange` 0.1-0.3 m on a desk set.
- **Shots move toward something.** Push into the subject, or orbit 5-15
  degrees around it. A camera that wanders reads as no decision.

### Light (`kit/light.tsx`)
- **One motivated key.** The sun through a window, a screen, a practical
  lamp. Give it a reason to exist in the set. Here: `<Sun>` through the
  `<BlindsGobo>`. The stripes are real shadows from invisible slats, so they
  wrap over every object.
- **Bounce it.** Add a warm low fill from the lit surface and a cool sky from
  the window (`<Bounce>`), and keep both dim. Keep the shadows dark, not black.
- **Haze in the beam, dust in bokeh.** Use `<Beams>`, additive sheets per gap
  in the blinds, and `<Dust>`, motes lit only while they sit inside a sunlit
  gap. Bloom turns both into god rays.
- **The film stock.** ACES tone mapping, bloom as halation, slight chromatic
  aberration, vignette (`<Look>`), 35 mm grain and gate weave in 2D
  (`<Grain>`, `<Weave>`). Keep it warm and contrasty; avoid an even grey.
- **Light can move.** Slide the sun a few degrees during a hold and the
  stripes travel. That's a cheap way to make a still shot feel alive.

### Motion (`kit/motion.ts`)
- **Analytic, frame-pure.** Everything is computed from `frame`: no
  `useFrame`, no clocks, no `Math.random` (use `rand(i, seed)`, `fbm(t, seed)`).
- **Springs overshoot 1-2 %.** Objects and letters arrive on `springy()` and
  never on a linear ramp. Stagger them 1-2 frames apart.
- **Paths, not positions.** Fly objects along a `MotionPath` (Catmull-Rom),
  aimed along the tangent, with a little banking.
- **Shutter on whips only.** `<Shutter>` smears a directional blur in
  proportion to camera speed. It switches on only above about 20 px a frame,
  because below that a smear just reads as soft focus.

### Sound (`scripts/sfx.py`, the `SoundTrack` in the demo)
- **Every cut has a hit.** Use a sub hit on hard cuts, a boom on the opening
  and the CTA, and a whoosh on whips and pass changes. Lay a room tone under
  everything so silence never sounds dead.
- **Typing makes ticks.** Use one tick per two typed characters and rotate
  between four samples, so typing never sounds like a machine gun.
- **Swells under reveals.** Put a pad under the payoff and a riser that *ends*
  on the cut it leads into.
- **Picture follows the waveform.** Drive objects from the real audio
  (`visualizeAudio` into `<Bars>`). Cut on the voice: every shot starts on a
  line or a word from `timing.json`.

### Passes (`kit/pass.tsx`)
The signature of this format: the same set renders three ways, and cutting
between them proves the shot is code.
- `beauty` is the finished film.
- `wire` is line art on paper: crease edges plus a constant-width silhouette
  hull, screens and paper keep their texture, red `PASS: WIRE` label.
- `flat` is what a default prompt gives: even light, no shadows, loud flat
  colours, a stiff camera.
Build every object from `<Solid>` and it draws itself correctly in all three
passes. Use a split wipe (beauty left, wire right) for the opening, cut to wire
mid-film, and flip to wire on the last beat.

### Edit and graphics
- One set, many shots. Build the world once and only move the camera,
  switch the pass and change what screens and paper show.
- The HUD has its own vocabulary. Use red mono section tags typed on with a
  block cursor (`<Tag>`), a frame counter (`<FrameCounter>`), and code
  annotations pinned to objects in 3D (`<CodeTag>`, projected per frame).
- Type lives in the set. `<Extruded>` 3D text catches the light and casts
  shadows. Put 2D text on top only for the flat look or for the HUD.
- Show real numbers. The "lines of code" counter reads the film's own source
  (`scripts/codestats.mjs`).

## Workflow

1. **Script.** Write the voice lines in `src/<film>/script.json` (see the demo).
   Follow the reel order in `references/reel-format.md`.
2. **Voice.** Run
   `"$REEL_STUDIO/tools/venv/bin/python" scripts/voice.py src/<film>/script.json public/<film>`
   and copy `timing.json` next to the film. It needs a reel studio: a folder
   with a Kokoro TTS venv at `tools/venv` (plus its lexicon and voice cache).
   Point `REEL_STUDIO` at it; the default is `~/reel-studio`. That studio is
   not part of this kit. Without it, skip voice and sound and render the
   films silent, or bring your own `vo.wav` and `timing.json`.
3. **Sound bank.** Run
   `"$REEL_STUDIO/tools/venv/bin/python" scripts/sfx.py public/sfx`.
4. **Set and look development.** Build the world (`demo/World.tsx` is the
   pattern) and check it with `LookTest` stills in all three passes before
   animating anything:
   `node scripts/stills.mjs LookBeauty 0,15,25,35 0.5 out/look`.
5. **Shot list.** Write `Shot[]` with every `from` taken from `timing.json`
   (`w(line, wordIndex)`), plus `passAt(frame)` and the per-shot extras.
6. **One still per shot.** Run
   `node scripts/stills.mjs Film <one frame per shot> 0.4 out/film`, then open
   the sheet and fix framing, focus and exposure. This loop is where the
   quality comes from. Never judge motion from a still: render the clip and
   watch it with the `local-media-and-capture` skill's frames tool.
7. **Render.** Run
   `AGENT_RUN_MEM=5G ~/.claude/bin/agent-run bash -c "cd <dir> && ./node_modules/.bin/remotion render Film out/film.mp4 --gl=angle-egl --concurrency=3 --crf=16"`.
8. **Master and QA.** Run `scripts/master.sh out/film.mp4`. It brings the mix to
   -14 LUFS / -1 dBTP, checks for black frames, and transcribes the voice with
   no prompt so mispronunciations show up.
9. **Vertical.** Re-encode the film as a texture source and render `Reel`:
   `ffmpeg -i out/film.mp4 -c:v libx264 -crf 14 -g 15 -bf 0 -pix_fmt yuv420p -c:a copy public/<film>/film.mp4`.
   A remuxed master with B-frames failed mid-render with "No frame found at
   position". Then render `Reel`
   (1080x1920): a code-built laptop on a desk plays the film as a video
   texture, with the caption in Instagram's safe zone (y 1180-1400).

## Rendering on this machine

- Use `--gl=angle-egl`, which runs on the AMD GPU. Plain `angle` fails to
  create a WebGL context, and `swangle` (CPU) works but is slower.
- Each `remotion still` call re-bundles (about 25 s). Use
  `scripts/stills.mjs`, which bundles once for many frames.
- At 1920x1080 with 4K shadow maps, DOF and bloom, a frame takes about 1-2 s at
  concurrency 3. The 673-frame demo takes about 15 minutes. Run heavy renders
  through `agent-run` and `cd` inside the command, because the scope starts in
  `$HOME`.

## Gotchas (all hit while building the demo)

- **EffectComposer's first frame is black.** @remotion/three advances once per
  frame, and the composer's render targets are not ready on the first one, so
  every render tab's first frame (and every single still) came out black.
  `<Warmup />` holds a delayRender and renders three more times on mount. Put
  it in every canvas that has a `<Look>`.
- **Don't swap the effect stack inside a live canvas.** When the pass changed
  from beauty to flat mid-render, the new composer kept showing its first
  frame, and the whole flat shot froze in the video (stills looked fine). Give
  the canvas `key={pass}` so each pass gets a fresh canvas with its own
  `<Warmup>`. Always check passes in a rendered clip, not only in stills.
- **`useOffthreadVideoTexture` arrives a frame late.** The texture loads
  after @remotion/three has already drawn the frame, so the screen came out
  blank. `Screen` in `demo/Reel.tsx` holds its own delayRender per frame,
  redraws when the new texture lands, and releases one animation frame later.
  Set `colorSpace = SRGBColorSpace` on it, or the film looks washed out.
- **Portrait frames use the sensor's long side.** `fovFor` treats 36 mm as the
  long side either way. Before that fix, a 26 mm lens on 9:16 came out as a
  101-degree ultra-wide.
- **Load fonts and typefaces before the canvas mounts.** Canvas textures are
  drawn during render and @remotion/three only re-renders on frame change, so
  a late font never redraws. `useAssets()` holds the render and the
  composition mounts `ThreeCanvas` only when `ready`.
- **Rounded geometry has no crease edges**, so `EdgesGeometry` alone draws
  rounded boxes as nothing. The wire pass adds an inverted-hull silhouette in
  a constant pixel width. Use `noHull` on flat cards and planes.
- **Wire materials need `toneMapped={false}`.** Otherwise the paper turns grey.
- **The flat pass must not reuse beauty textures** (wood grain and the like).
  Only content textures marked `mapInWire` (screens, paper) carry over.
- **Glossy screens show the bounce light as a hot spot** through bloom. Keep
  screen roughness at 0.6 or more, and keep point lights high and away from
  glossy faces.
- **A phone or screen that is itself the key light** must be unlit glass:
  draw it with `meshBasicMaterial` (brightness as `color`), never a lit
  material. Otherwise its own point light, 5 cm above, blooms in the middle of
  the screen. Keep that point light at 0.05-0.1 intensity with `distance` 1.2.
- **White objects clip in a strong sun.** Under a sun of 8-10 through blinds,
  ACES burns paper-white type to flat white. Make sunlit type mid-grey
  (`#a59f94`) or dark ink; keep white for things in shade or self-lit.
- **Captions own y 1180-1400 in 9:16.** Frame each shot so its subject sits
  above that band: aim the camera a few cm *below* the subject and it rises in
  frame. Check every shot's still with the captions on.
- **Night to day is one set.** Blend the sun's colour and intensity, the sky
  card, the bounce and the dust colour on one `day` 0..1 value; moonlight is
  the same `<Sun>` through the same gobo at 1.5, cool `#7d9be0`.
- **Invisible shadow casters** use `colorWrite={false}` and
  `depthWrite={false}`. They still render into the shadow map.
- **A `Sequence` inside `ThreeCanvas` needs `layout="none"`**, and `useFrame` is
  banned (see the Remotion skill's 3D rules).
- **`toNonIndexed()` warnings** from merged geometry are harmless.

## Porting a Blender shot script (characters, sets, keys)

Done once for a Blender-made reel: the
studio's Blender rig, sets and every key moved over, the reel's edit and head
track still lined up, and the code version rendered 1080x1920 directly.

- `kit/rig.tsx` holds it: `<ZUp>` (Blender coordinates inside), `cv()` for
  points outside it (camera, lights), `Anim` (named channels, Blender-like
  auto-clamped curves, `step` keys for time-lapse cuts, `show()` intervals),
  the blocky `Guy` with a wardrobe (`Dress`), `walk`, `blink`, `reach`.
- **Blender's XYZ Euler is three.js `"ZYX"`.** Blender applies X, then Y, then
  Z (matrix Rz·Ry·Rx); three's order names the matrix product left to right.
  With `<group rotation={[-PI/2,0,0]}>` around the world and `"ZYX"` on every
  rotation, poses copy over number for number.
- Blender frame f (1-based) is composition frame f - 1. Keep the shot's own
  word-frame helper (`wf`) so the keys read like the original script.
- **A light target that is not in the scene never updates.** R3F's
  `attach="target"` child is not added to the graph, so its matrixWorld stays
  at the origin and the light points the wrong way. Use an `Object3D` you
  position and `updateMatrixWorld()` yourself (`useTarget` in
  `demos/sets.tsx`), passed as `target={obj}`.
- **`<Shutter>` is a horizontal smear.** It suits pans, not dollies: on a fast
  push or pull it turned a frame into mush. Lower `gain` (40) for shots that
  move in depth.
- **Metal needs something to reflect.** With no environment map, `metal: 1`
  renders black (a bronze mirror became a black disc). Use 0.5 or add an env.
- **Blender's constant extrapolation bites scale keys:** a scale key at frame
  200 also applies before it. Key the rest value one frame earlier.
- Measured on this reel: the four shots (727 frames) rendered from code in
  170 s at 1080x1920 (0.23 s a frame, concurrency 3, shadows, DOF, bloom).
  The Blender/Eevee versions took 1,051 s at 720x1280 (1.45 s a frame) and
  were upscaled. Code was about 6x faster at 2.25x the pixels.

## Files

| Path | What |
|---|---|
| `template/src/kit/motion.ts` | eases, noise, `springy`, `ticker`, `typed` |
| `template/src/kit/camera.tsx` | `fovFor`, `Shot`, `camAt`, `<Camera>` |
| `template/src/kit/light.tsx` | `<Sun>`, `<BlindsGobo>`, `<Bounce>`, `<Beams>`, `<Dust>`, `<FlatLight>` |
| `template/src/kit/pass.tsx` | `<Pass>`, `<Solid>`, wire hull |
| `template/src/kit/post.tsx` | `<Look>` (DOF, bloom, ACES, CA, vignette), `<Warmup>` |
| `template/src/kit/film.tsx` | `<Grain>`, `<Weave>`, `<Shutter>`, `<Tag>`, `<FrameCounter>`, `<PassLabel>`, `<CodeTag>`, `project()` |
| `template/src/kit/text3d.tsx` | `<Extruded>` per-letter 3D type with spring reveal |
| `template/src/kit/props.tsx` | desk, room with window, blinds, retro computer, live terminal, keyboard, mug, plant, paper, markdown page |
| `template/src/kit/extras.tsx` | `<MotionPath>`, paper plane, `<Bars>`, `<CodeStack>` |
| `template/src/kit/rig.tsx` | `ZUp`, `cv`, `Anim` keyframes, `Guy` character + `Dress`, `walk`, `blink`, `reach`, crowd dresses |
| `template/src/kit/assets.ts` | `useAssets`, `getTypeface`, `getJson`, `MONO`, `SANS` |
| `template/src/demo/` | the demo film (`Film`), the vertical master (`Reel`), `LookTest` |
| `template/scripts/` | `new.sh`, `voice.py`, `sfx.py`, `font2typeface.mjs`, `codestats.mjs`, `stills.mjs`, `master.sh` |
| `references/reel-format.md` | the beat-by-beat structure of the reel this recreates, and how to adapt it |
