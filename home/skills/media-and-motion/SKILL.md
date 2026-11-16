---
name: media-and-motion
description: "Record the screen, read a recording back as a contact sheet with a stutter measurement, and render with ffmpeg, ImageMagick, Blender, Manim or Remotion. Use for animation, transition, scroll, jank, hover state, 'is it smooth', render, 3D, gif, mp4, screen recording; never judge motion from a still."
---

# Media and motion

## The rule this skill exists for

**Stills cannot show motion.** If the thing being judged moves (an animation, a
transition, a scroll, a stutter, a hover state), record it and look at frames.
Do not reason about it from a screenshot, from the source, or from a
description. Bursting screenshots tops out near 5 fps and tears; that is not a
substitute.

Tools this needs: `ffmpeg` and `ffprobe` (Windows: `winget install --id Gyan.FFmpeg -e`;
macOS: `brew install ffmpeg`). Optional: ImageMagick (`magick`), tesseract.

## Record the screen

Record 3 to 8 seconds; the loop worth judging is usually short.

**Windows** (gdigrab, built into ffmpeg):

```bash
ffmpeg -y -f gdigrab -framerate 30 -t 8 -i desktop -pix_fmt yuv420p cast.mp4
ffmpeg -y -f gdigrab -framerate 30 -t 5 -i title="Exact Window Title" -pix_fmt yuv420p win.mp4
```

**macOS** (avfoundation). The app running the command needs Screen Recording
permission (System Settings, Privacy & Security, Screen Recording); the person
grants it once. Find the screen's device index first:

```bash
ffmpeg -f avfoundation -list_devices true -i ""
ffmpeg -y -f avfoundation -framerate 30 -capture_cursor 1 -t 8 -i "<screen index>:none" -pix_fmt yuv420p cast.mp4
```

**A web page only:** a browser recording is cleaner than the whole screen.
Playwright's `recordVideo` context option, or the Claude in Chrome GIF
recorder, both capture just the page.

Recording the real screen shows whatever the person has open. Say so before
you start, and record only what the task needs.

## Read the recording back (the half that matters)

**You cannot decode an mp4. Never Read one.** A recording is worthless until it
becomes stills.

```bash
python3 ~/.claude/bin/frames.py cast.mp4 outdir                                  # 12 frames, whole clip
python3 ~/.claude/bin/frames.py cast.mp4 outdir --from-frame 55 --to-frame 66    # a 0.4 s slice
```

(`python` instead of `python3` on Windows.) It writes ONE PNG with the frames
tiled in order: Read that PNG. One image of the whole sequence beats a dozen
separate frames, because the progression is visible in a single look.

Two passes is the working method:

1. An overview sheet across the whole clip, to find roughly where the
   interesting moment is.
2. `--from-frame`/`--to-frame` around it, for consecutive frames 33 ms apart,
   which is enough to name the exact frame where a counter ticks or an easing
   breaks.

It also prints a **motion measurement**: a per-frame difference sparkline and
the share of duplicate frames. If a source repaints slower than the capture
rate, every Nth frame is identical and this reports it. No amount of eyeballing
gets that number. Caveat to state whenever you report it: duplicate frames
measure what was painted on screen, not the quality of a file being rendered to
disk. Preview throttling is normal and is not evidence the output is bad.

## Render 3D: Blender, headless

```bash
blender -b --factory-startup -noaudio -P scene.py -- /absolute/output/dir
```

- The EEVEE engine id is `BLENDER_EEVEE` in Blender 4.2 and later.
- `scene.render.filepath` must be **absolute**. With no .blend loaded a relative
  path resolves nowhere; the render "succeeds" and then fails at save.
- `bpy` from PyPI rarely matches the system Python, so drive Blender's own
  interpreter with `-P` rather than `import bpy` in a plain script.

## Render 2D and maths animation: Manim

```bash
manim -ql --media_dir ./media scene.py SceneName
```

Without LaTeX installed, use `Text()`; `Tex()` and `MathTex()` will fail. `-ql`
is a 480p draft; `-qh` for 1080p when the draft looks right.

## Render from React: Remotion

The Remotion plugin's skills carry the detail. In short:

```bash
npx create-video@latest --yes --blank --no-tailwind my-video
npx remotion render MyComp out/video.mp4
```

The first render downloads a headless Chrome. For cinematic 3D in code, use the
`cinematic-3d` skill.

## Check a render is not empty

ImageMagick 7's command is `magick`; v7 dropped `convert`.

```bash
magick frame.png -format '%[fx:standard_deviation]' info:
```

Near zero means a flat or black frame. A real scene is well above 0.02. Run
this before reporting a render as successful. For timing questions,
`ffprobe -v error -select_streams v:0 -show_entries stream=nb_frames,avg_frame_rate cast.mp4`
tells you whether frames were produced or silently dropped.
