# Film engine: contract for scene and audio agents (《梦蝶》 / The Dream of the Butterfly)

> 这是影片的创作规格与引擎契约，保留了早期脚手架和协作分工说明；它不作为逐项实现验收记录。当前运行、最终修改范围与 4K 导出方式见 [README.md](README.md) 和 [制作经验](docs/lessons.md)。文中早期 `../film/` 指同库根目录的 GRAIN 工程。

The film is a **pure function of time `t`** (seconds). Picture: Three.js (WebGL2) → HDR post chain → **2160×1080 (18:9, 2:1), the whole frame is picture, no black bars**, 30 fps. Sound: one AudioBuffer synthesized with an `OfflineAudioContext` (48 kHz stereo). Live playback derives `t` from the audio clock. Offline rendering sets `t = frame / 30`.

The story, shots and look are in `SCRIPT.md`. This file is the engine contract. Section "Who owns what" at the end lists the four groups' files (SCRIPT.md 8.4).

## Format (read this first)

- Frame **2160×1080**, `src/config.js` `WIDTH = 2160`, `HEIGHT = 1080`, `REF_HEIGHT = 1080`. `LOOK.letterbox = 0` (`timeline.js`): no matte. SCRIPT.md was written for a 2.39 picture inside 16:9; **wherever it says "(% across, % up) of the picture area", read: of the full 2:1 frame.** `src/lib/story.js` gives every screen position as a fraction of the full frame (x left→right, y bottom→top).
- SCRIPT.md's card positions are pixels in a 1920×1080 frame whose picture spans y = 138..942. They are converted once in `src/shots/_card.js` (`CARD_LAYOUT`, `scriptX(x) = x / 1920`, `scriptY(y) = (y − 138) / 804` from the top). Type sizes stay in px at 1080p.
- `--scale 0.5` → 1080×540, `--scale 2` → 4320×2160 (all satisfy the width % 8, height % 4 rule of the yuv420p capture).
- A camera `lens` sets the horizontal FOV across the full frame width; the vertical FOV follows from the 2:1 aspect. GRAIN's `createLandscape` was laid out for GRAIN's 2.39 master frame: with that old master camera a 2:1 frame shows a sliver below the near ground at the bottom edge, so FIELD must frame its own camera (pitch/lens) accordingly.

## Commands (run from `butterfly/`)

| Task | Command |
|---|---|
| Live dev server | `node tools/serve.mjs` then open http://127.0.0.1:8123/ (`?t=95`, `?shot=<id>`, `?hud=1`, `?mute=1`, `?scale=0.5`) |
| Stills (PNG) | `node tools/still.mjs 12.5 47 130 --out stills/` · `--frames 375` · `--shot <id>` (5 frames across a shot) · `--scale 0.5` |
| Cost per frame | `node tools/bench.mjs 12.5 47` · `--shot <id>` |
| Preview MP4 | `node tools/render.mjs --start 40 --end 45` → `out/preview_40-45.mp4` (add `--scale 0.5 --preset veryfast` for speed) |
| Full film | `node tools/render.mjs` → `out/film.mp4` (2160×1080) |
| Motion blur | add `--samples 8` to `still.mjs` / `render.mjs` (shutter accumulation, default 1 = off; `--shutter 0.5` default = 180°) |
| **Final** | `node tools/render.mjs --samples 8` → `out/film.mp4`, **2160×1080** (x264 CRF 16, AAC 320 k) |
| **Final 2×** | `node tools/render.mjs --scale 2 --samples 8 --encoder hevc_videotoolbox` → `out/film_2160p_hevc.mp4` (4320×2160, Apple hardware HEVC, `hvc1`; verified to encode) |
| Encoders | `--encoder x264` (default; `--crf`, `--preset`) · `hevc_videotoolbox` · `h264_videotoolbox` (`--quality 70` 1–100, or `--bitrate 70M`) |
| Single file | `node tools/build-html.mjs` → `dist/film.html` (self-contained, no network) |

Live keys: click to start, **space** pause, **← / →** ±5 s (shift ±1 s), **, / .** frame step while paused, **f** fullscreen, **h** HUD, **Home** restart. Live mode creates and warms every world and renders the score before "click to begin". The player fits the 2:1 canvas to the window (no bars inside the picture; the page background is black around it).

## Files

```
index.html              live player (import map → node_modules/three), 2:1 canvas fit
src/config.js           FPS, WIDTH 2160 / HEIGHT 1080, REF_HEIGHT, SAMPLE_RATE, FILM_SEED
src/main.js             player UI + offline API (window.__film)
src/engine.js           renderer, world registry/lifecycle, scheduler, transitions (dissolve, SHEEN, fades), portals
src/post.js             post chain, DEFAULT_POST, FX_LAYER, look pass (cards on paper, INK, in-shot SHEEN), capture
src/titles.js           title-card layers + sampleTextPoints / fitPointsToCount
src/timeline.js         merges src/shots/*: shots, LOOK, DURATION (240)
src/cards.js            merges src/shots/*: cards
src/shots/_shot.js      helpers: shot(id, world), lookPost(id) (SCRIPT.md 7.3 → post.ink), abs(), sheen()
src/shots/_card.js      card helpers: CARD_LAYOUT (script positions converted), lineCard, twoBeat, OVER_PICTURE, ON_PAPER
src/shots/city.js       Group C shots   S01 S02 S04a S08 S09 S10 S11 S14 S15 S16 S17 S18 S19
src/shots/macro.js      Group B shots   S03 S04b S05 S06 S07 S12 S13 S21 S22
src/shots/field.js      Group A shot    S20
src/shots/paper.js      Group A shots   S23 S24 + cards L1, L2, E
src/worlds/registry.js  one line per world: city, interior, scale, grass, field, paper
src/worlds/<name>.js    one file per world (each starts as `export { create } from './_stub.js'`: black)
src/lib/story.js        THE shared constants: SHOT, breath, PALETTE, LOOK, LAMP_SUN, SLEEPER_OUTLINE, SPECK, SEVEN, HERO_BLADE ...
src/lib/ink.js          the INK pass shader + paper texture (interface below)
src/lib/thinfilm.js     THINFILM GLSL: thinFilm(cosTheta, thickness) + JS mirror
src/lib/butterfly.js    createButterfly (stub)      src/lib/flock.js   createFlock (stub)
src/lib/figure.js       createFigure (stub)         src/lib/drop.js    createDrop (stub)
src/lib/…               GRAIN libraries (below)
src/audio/score.js      THE SCORE (Group D)
tools/                  serve, still, bench, render, build-html
```

**Reused from GRAIN, as libraries** (they keep working; not registered as worlds): `worlds/valley.js` (`createLandscape(ctx, opts)`; pass `year: 10000`, otherwise it follows GRAIN's clock), `worlds/meadow.js` (the meadow grass, tree and sky; its world `create`), `worlds/bed.js` (macro lighting, raindrops, `createBackplate`), `lib/tree.js`, `lib/sky.js`, `lib/grains.js`, `lib/particles.js`, `lib/line.js`, `lib/noise.js`, `lib/camera.js`, `lib/random.js`, `lib/easing.js`. They import GRAIN's constants from **`lib/valley-story.js`** (GRAIN's old `story.js`, renamed; don't use it for new work). Reference only (delete at the end): `worlds/ice.js` (no longer importable: its choreography lived in GRAIN's deleted `shots/ice.js`, kept in `../film/`), `worlds/strata.js`, `worlds/canopy.js`, `worlds/placeholder.js`, `lib/seed.js` (still imported by `bed.js`).

## Determinism rules (hard)

- No `Math.random()`, `Date.now()`, `performance.now()` or `new Date()` in anything that affects picture or sound. `render.mjs` warns if it finds them in `src/worlds`, `src/lib`, `score.js`, `synth.js`, `timeline.js` or `cards.js`. Use `createRng(seed)`, `hash1/2/3`, the GLSL `hash*` / `pcg*` functions, and the seeded audio helpers.
- `update(t, …)` must set **all** state from its arguments. Never integrate over frames or rely on the previous frame. Frames are rendered in any order: stills, seeking, `?shot=` loops, partial renders, portals.
- A world can be updated **twice in one frame** with different shots (a dissolve or SHEEN between two shots of the same world), and again inside a portal. Render happens right after each update, so this is safe as long as `update` is pure.
- The INK pass's paper is static (generated once, in paper space): nothing in it is re-seeded per frame.

## Adding a world

Replace the stub line in `src/worlds/<name>.js`:

```js
import * as THREE from 'three';
export async function create(ctx) {
  // ctx: { THREE, name, seed, rng, renderer, width, height, aspect (2), fps, shots (this world's shots), engine }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, ctx.aspect, 0.1, 5000);
  return {
    scene, camera,
    post: { bloom: 0.06 },     // optional static or (t, localT, shot) => ({...}); may include ink: { pools, paperScroll, ... }
    update(t, localT, shot, params) {   // params = shot.params with keyframes evaluated
      // 1. portals first (engine.portal may re-enter your own world), 2. then all your state
    },
    // optional: render(renderer, target, camera) for multi-pass worlds; async warmup(renderer)
    dispose() {},
  };
}
```

- `create` may be async. The engine imports the world lazily, waits for the worlds its shots show through portals, runs `update` at its first shot, `compileAsync`s and draws once **before** the world is first needed. Offline mode prefetches worlds 8 s ahead.
- The camera aspect is the full frame (2:1). The engine applies the shot's camera rig **before** `update`, so the world can still override the camera.
- Draw linear HDR radiance (daylight surfaces ~0.1–2, sky ~0.3–3). No tone mapping, no sRGB conversion: the post chain does both.
- Additive particles and glows that don't write depth go on `FX_LAYER` (`import { FX_LAYER } from '../post.js'`), so DOF doesn't blur them with what is behind.
- Expensive fragment shaders need `addDepthPrepass(mesh)` (`src/lib/prepass.js`).
- **Depth matters now:** the INK pass reads the scene depth buffer (mist, bleed). Worlds with a custom `render()` should leave a depth buffer in the target (or keep `ink.mist` at 0).

## Timeline (`src/timeline.js` merges `src/shots/*.js`)

```js
import { shot, lookPost, abs, sheen } from './_shot.js';
export const shots = [
  shot('S04b', 'grass', {                         // id, start/end from story.SHOT, world
    transitionIn: sheen(3),                       // { type: 'sheen', duration: 3, angle: 18, width: 0.12, dir: 1 }
    params: { pupaSplit: abs([[44, 0], [44.6, 1]]) },   // free-form, per world
    post: lookPost('S04b', { exposure: 0.2 }),    // SCRIPT.md 7.3 LOOK as post.ink, + yours
    shutter: 0.8,
  }),
];
export const cards = [];
```

**Keyframes.** Any value in `params`, `post` or `camera`, including nested objects (`dof`, `ink`, `sheen`) and **arrays of objects (`ink.pools`, element by element)**, may be `{ keys: [[t, v], …], ease, time: 'local' | 'seconds' | 'absolute' }` (per-key easing `[t, v, 'outCubic']`) or a pure function `(localT, t, shot) => value`. Easings in `src/lib/easing.js`.

**Transitions.**
- `cut` is the default.
- `dissolve`: the incoming shot's **first `duration` seconds** cross-dissolve with the previous shot, which keeps rendering past its `end` (`localT` > 1). The two shots' `post.ink` blocks are **interpolated** and both layers use the result (`ink: 'own'` on the transition keeps each shot's own).
- **`sheen`** (`{ type: 'sheen', duration, angle: 18, width: 0.12, dir: 1, ease: 'inOutSine', gain: 1.5, thickness: 1 }`): the film's crossing device. In time it behaves like a dissolve (the previous shot keeps rendering for `duration`). In space a soft band `width` frame widths wide, tilted `angle` degrees from vertical (top leaning right), sweeps left→right (`dir: 1`) or right→left (`-1`): behind the band the incoming shot, ahead of it the outgoing, and inside it the image is multiplied by the THINFILM colour ramp (normal incidence at the band's middle, grazing at its edges), × `gain`. Each layer keeps its own ink: the band *is* the change. Used: S04b (3 s), S20 (0.5 s).
- `fadeFromBlack | fadeFromWhite | fadeFrom` (`color: [r,g,b]`), `dipToBlack | dipToWhite | dip`, `transitionOut: fadeToBlack | fadeToWhite | fadeTo`. All take `ease` (a name or a function: S08 uses `fadeFromWhite` 0.065 s with `ease: () => 0` for exactly two white frames).

Gaps render black; the engine warns about gaps and overlaps.

**Portal declarations.** A shot that shows another through `engine.portal` declares it so the engine loads that world first: `params.portal: { shot: 'S14', t: 129.0 }` (or `params.portals`, or `shot.portals: ['S14']`). Keyframed values are not scanned.

**Camera rig** (`src/lib/camera.js`): `position | path`, `target`, `rotation`, `ease`, `range`, `lens` (mm, Super-35 → horizontal FOV across the full 2:1 frame) or `fov` (three's vertical FOV), `roll`, `near`, `far`, `shake`.

## Post (`src/post.js` → `DEFAULT_POST`)

Order **per shot**: scene (HDR RGBA16F, MSAA×4) → DOF → [`--samples N`: repeat scene → DOF per sub-frame, average in RGBA32F] → bloom → grade (graded alpha = linear view depth) → **look pass**: on-paper title cards → **INK** → in-shot **SHEEN** (skipped entirely, an exact passthrough, when none of the three applies). **Per frame**: dissolve or SHEEN-transition mix → fade → over-picture title cards → grain → (letterbox matte, off) → dither.

| key | default | meaning |
|---|---|---|
| `exposure`, `temperature`, `tintGM`, `tint`, `lift`, `gamma`, `gain`, `contrast`, `saturation`, `split*` | GRAIN's | grade (unchanged) |
| `bloom`, `bloomScatter`, `halation`, `vignette`, `vignetteSoftness`, `chromaticAberration` | GRAIN's | vignette and CA are laid out on the picture area = the full 2:1 frame |
| `grain`, `grainSize` | 0.035, 1.3 | `lookPost` lowers grain to 0.015 where ink > 0.7 (SCRIPT.md 7.1) |
| `letterbox` | **0** | 0 = full frame (this film). A number (e.g. 2.39) mattes to that aspect |
| `dof` | null | `{ focus, aperture, maxBlur }` |
| **`ink`** | null | the INK pass, below |
| **`sheen`** | null | in-shot SHEEN pass: `{ x 0..1, angle 18, width 0.12, dir 1, amount 1, mode 'ink' \| 'multiply', gain 1, thickness 1 }` |

Merge order: `DEFAULT_POST` ← `LOOK` ← `world.post` ← `shot.post`. Every key is replaced whole **except `ink` and `sheen`, which merge key by key** (so a world supplies `ink.pools` / `ink.paperScroll` while the shot list supplies `ink.amount` / `ink.chroma`; `ink: null` at a later level switches it off). During a dissolve, frame-level values (grain, letterbox) and `ink` interpolate between the shots.

### INK (`post.ink`, shader in `src/lib/ink.js`, SCRIPT.md 7.1)

```js
post: { ink: {
  amount: 1,              // 0..1: how much of the image is ink. 0 everywhere = the pass is skipped (exact passthrough)
  chroma: 0,              // 0..1: how much of the frame's colour survives as a wash under the ink
  mist: 0.6, mistRange: [100, 2000],   // far depth dilutes to bare paper (world units of view depth; default [0.05, 0.6] x camera.far)
  paperScroll: [x, y],    // paper offset in frame widths (y up): follow your scroll so the image doesn't swim under its paper
  scrollDepth: 110,       // parallax scrolls: view depth of the plane that moves exactly with paperScroll (see below)
  paper: [r, g, b],       // display colour of bare paper (default #EFE8DA)
  wet: 1, line: 1, dry: 0.3, rake: 0.3, rakeAngle: 144,   // the hand: bleed/bloom/wobble · contour on depth edges · dry brush · raking light
  pools: [{ x: 0.38, y: 0.40, r: 0.09, soft: 0.03, amount: 1, chroma: 1, rim: 1 }],   // up to 4
} }
```

- **What it does.** It repaints the graded frame as ink on xuan paper. Each pixel is read as a layer over paper and split into *ink* (a density on the palette's own curve) and *wash* (its hue; only saturated colour counts, so a pure hue carries no ink and greys are ink alone). The ink is pulled to the five tones through soft steps whose edges follow the sheet and leave a tide line; every edge gets a darker wet rim on its dense side and a pale bloom on the paper side (sharp minus a 6 px blur); thin dark things stay brush lines; near things get an ink contour on their depth edges; distance dilutes to bare paper and softens; every edge is wobbled by a slow hand and feathered along the fibres; a gradient that is soft in the source (a glow, mist, something out of focus) stays a graded wash with no tide line; thin washes granulate in the tooth, 焦 does not; then paper (colour, cloud, relief under a raking light) × wash × ink. As `amount` → 0 every step vanishes.
- **Painting for it.** Paint flat shapes in `linear(PALETTE.<tone>)`: under the default grade a surface painted `linear(PALETTE.zhong)` comes out exactly 重 (the reading curve is calibrated through `DEFAULT_POST`'s grade; each tone's plateau holds about a third of a stop of exposure either way). `linear(PALETTE.paper)` or brighter (white, lights) is bare paper; nothing is brighter than paper afterwards; black is 焦 #0D0C0E, never darker. Draw a background (mist = white): undrawn pixels are black and count as ink. A shot with an ink block is graded without its vignette; the look pass lays it back over the sheet.
- **The line** (final pass, 2026-10-03). The contour and the drawn line stand at full strength from `amount` 0.3 up, are ink-coloured over any wash, and are drawn only where the picture is crisp: never on anything out of focus (the pass reads the shot's `post.dof` and gates by circle of confusion, about 2 px), never on shutter smear, never where the picture shows no edge. `lineWidth` (default 1; 0.5..3) sets its breadth. **The merged look of S19–S22 is one shared block, `MERGED_INK` in `shots/_shot.js`** (`{ line: 1, lineWidth: 1.8, dry: 0.45, rake: 0.6, wet: 0.4 }`): use `lookPost('S21', { ink: { ...MERGED_INK } })` with the table's own amounts (0.5: it no longer bands a sky). S20 uses it.
- **Black is one value**: ink at density 1 = #0D0C0E (SCRIPT.md 7.4 rule 3). S23 holds exactly that from 216.0 (no #000, no lighting ramp), so S22 must end on ink black too (a frame-filling ink pool over a black source gives it), and S03's unlit scales should sit at #0D0C0E to match S02's last frame.
- **Colour is continuous.** The five tones, their tide lines and granulation apply to ink (greys, and the darkest masses of a coloured picture). A saturated wash (a sky, a field, a wing) is never stepped or stippled; chroma below 1 makes it paler, not grey.
- **Exempting a subject** (a hero butterfly that must keep its own shading): put a pool over it with a low `amount` (≈ 0.1) and `chroma: 1`; the contour line scales with `amount`, so it goes too. Pools are soft and fibre-edged by construction (`soft` ≥ 0.3 r reads as soaked in; a hard edge comes only from a tiny `soft`).
- **S18's wave needs no pool.** Colour arrives per instance: each wing is blue in the source, and the shot's chroma (0.6 → 0.9) lets it through at full strength. A disc pool growing with the ring shows its own edge; if one is ever wanted, give it `soft` ≥ 0.35 r and `rim: 0`.
- **Pools**: screen-space regions with their own knobs. `x, y` in frame fractions (y **up**), `r` and `soft` in frame widths, `amount`/`chroma` inside (default: the block's own), `rim` = wet-rim strength. Edges follow the paper's fibres and cloud; later pools win. The same grey is the same tone inside and outside a pool; only saturated colour changes.
- **Stability.** Paper, fibre and the hand's wobble are static fields in paper space (frame + `paperScroll`): locked frames and flat scrolls do not shimmer. In a **parallax** scroll, set `scrollDepth` to the view depth of the plane that moves with `paperScroll`: the wobble is then carried per depth (each plane keeps its own edge as it slides over the sheet) and a far wash never repaints a nearer silhouette. Things that move on their own across the sheet (figures, umbrellas, rain) pass under a fixed wobble of about ±2 px: fine at walking pace; for crowds of small shapes and for free cameras lower `wet` (0.3–0.5).
- **Interface** (`lib/ink.js`): `normalizeInk`, `inkActive`, `mixInk`, `inkUniforms`, `setInkUniforms`, `getPaperTexture(renderer)`, `INK_GLSL` (expects `lookSource`, `lookCard`, `uRes`, `uPicFrac`, `uRefScale`, and `tInkBlur` filled by post.js), `PAPER_GLSL` (`paperSample`, `paperMottle`, `inkDensity`, `inkDensityOf`, `inkValueOf`, `inkQuantise`, `inkToneRel`, `inkTone`, `inkPaint`), `DRYBRUSH_GLSL`, `DILUTE_GLSL`, `gradeDefault(lin)`. The reading curve (the palette through `gradeDefault`) is frozen: CITY paints through its exact inverse.
- **Cost** (M5 Max, 2160×1080, measured with `bench`): about 1 ms per inked layer (two half-res blur passes + one full-res pass of 7 frame taps and 6 paper taps; S23's whole frame, sheet + ink + cards, is 1.4 ms); 0 where amount is 0 everywhere. A dissolve or SHEEN inks two layers.

### LOOK group: interface additions (fixed 2026-10-03; the insides land during the day)

Everything above keeps working unchanged. These are additions; build against them now.

**Painting for the INK pass**: see "INK" above (palette identity through the default grade, bare paper, `scrollDepth`, `wet`/`line`/`dry`/`rake`). Smooth gradients become layered washes with soft tide lines: use them on purpose (sky, mist). Thin dark things (≤ 3 px: rain, antennae, mullions, rails) stay brush lines; large dark things are washes.

**Painting in ink density** (`PAPER_GLSL` in `lib/ink.js`): `vec3 inkPaint(float d)` is the linear HDR colour to paint, under the default grade, for the pass to read density `d` (white at 0, the palette's linear tones at .12 .30 .55 .78 .95, black at 1). `lookPost` drops bloom and halation to a third in shots with ink above 0.7 (on a pale sheet the default bloom lifts thin black lines to grey before the pass reads them); a lamp that must glow sets its own.

**The dilution** (`DILUTE_GLSL`): `float inkDilute(vec2 p, vec2 centre, float wash)` = the density of a black wash at paper-space `p` (frame widths, y up) while water spreads from `centre`; `wash` 1 = black sheet, 0 = clear. It is how S23 opens onto the white paper (from `REST_POINT`); S01's "black diluted from the centre" should be the same gesture: `density = 1.0 - (1.0 - yours) * (1.0 - inkDilute(p, centre, wash))`.

**Dry brush (飞白) for tagged strokes**: `import { DRYBRUSH_GLSL } from '../lib/ink.js'` → `float dryBrush(vec2 st, float load, float seed)` in your fragment shader. `st.x` 0..1 along the stroke (0 = where the brush lands, loaded; 1 = where it runs out), `st.y` −1..1 across it; `load` 0..1 (1 = wet, solid; 0.3 = mostly streaks); returns coverage 0..1 (multiply your alpha, or `discard` below 0.5). The streaks live in stroke space, so a moving stroke does not flicker. Use it for rain, zebra bands, traffic and tunnel streaks, rails.

**Text on paper (`layer: 'paper'` cards)** now *soaks*: glyphs grow outward from their stroke centres through the fibre noise over `fadeIn`, darkest first, and leave by lightening evenly over `fadeOut`. Two more card fields: `mode: 'ink'` (default) | `'resist'` (the wash draws back from the strokes and leaves bare paper: T1), and `anchor: [x, y]` = the `ink.paperScroll` value at which the card sits at its `position`; the card then scrolls with the paper.
- **T1 for CITY**: `import { inscriptionT1 } from './_card.js'` and `export const cards = [...inscriptionT1({ anchor: [sx, sy] })]` in `shots/city.js` (text, sizes, position and the 5.5–7.0 / 11.0–12.5 timing of SCRIPT.md section 5 are inside; `anchor` = your S01 `paperScroll` at the moment the block should stand at 93% across, e.g. at t = 9.0). Draw nothing for the title in the world: the resist removes whatever wash is there, so the night wash must simply be present behind it.

**FLOCK** (`lib/flock.js`), final interface (the stub's signature plus options):

```js
const f = createFlock({ count, seed, positions?, radius?, velocities?, openAt?, foldAt? });
//   positions   Float32Array [x, z] per instance, metres (default: seeded disc of `radius`)
//   velocities  Float32Array [vx, vz] m/s on the walk clock (default 0)
//   openAt / foldAt  Float32Array, film seconds: the umbrella fans open from a line in 5 frames at
//               openAt (default: always open) and folds disc → line → gone at foldAt (default: never)
f.set({
  morphWave: { centre: [x, z], t0, speed: 30, jitter: 0.03 } | null,  // the ring: instance i morphs for 0.8 s from t0 + dist / speed (+ a seeded 0..jitter s)
  rise: 9, goal: [x, y, z], flow: 0..1, scale: 10,      // after the morph: spiral up, then the curl-noise river to goal
  walk: seconds, walkRate: 1,  // the crowd's walk clock: ground = positions + velocities * walk (an instance stops when its morph starts; walkRate = d(walk)/dt during the wave)
  lean: radians,            // umbrellas bowed into the rain, toward their velocity (S10)
  river: { from: [x, y, z], to: [x, y, z], width, height: [lo, hi], speed, meander: 1, taper, bend } | null,   // all instances airborne as a river (S19, S20)
  clear: 1.5,               // nothing nearer the lens than this many metres (S18's last 2 s: 0)
  sun: [x, y, z], sunColor: [r, g, b], ambient: [r, g, b],   // direction TO the light
  sheen: 1, minPx: 2,       // sky on the wet canopy · minimum on-screen size
  shadow: { ground: 0.02, dir?, strength, soft },   // S18: each butterfly's shadow on the ground (direction from `sun`); add `f.shadow` (a second mesh) to your scene
  spread, smear,            // optional: scatter around the goal · motion smear along the path
});
f.setPositions(float32);    // optional: move the crowd yourself (re-uploads; must be a pure function of t)
f.update(t);
```
`morph` 0 is a real umbrella (an 8-gore canopy with a scalloped rim, ferrule and shaft: an ink octagon 1.1 m wide from above, a shallow dome from the side). Call `set()` before `update(t)`. Smear is automatic (an instance that moves more than 1.5 px within a sub-frame integrates its wing over it, so 8 samples join into one smear) and the clear cone is enforced (instances fade between `clear` and 2×`clear`, and above about 40% of frame height; `clear: 0` disables both). Notes from its tests (`tools/dev/scenes/flocktest.js`, sheets in `stills/flock/`): `scale` now defaults to 10 (the script's 6 read as dust in a 300 m frame); the lens storm of S18's last seconds wants `rise` ≈ 18, `clear: 0`, and a gentle depth of field (`aperture` ≈ 0.02, `maxBlur` ≈ 14: 0.075 / 40 turns near wings into blobs); keep a river within about 2 m/s of the camera's own speed or near wings ghost at 8 samples; for a vertical river `height` runs along z; `FLOCK_TIMING` exports the morph's beats. The INK pass no longer outlines marks a few pixels across or anything soft (blurred, smeared), and with chroma below 1 colour goes pale, not grey: the flock keeps its blue without `line: 0`. Metres, y up; `f.mesh.scale` may be set by the host (FIELD uses 0.01). One instanced draw; wingbeat 5–7 Hz, random phase; sprites never smaller than 2 px (area-scaled alpha). Render with `shutter: 1`.

**FIELD backplate for GRASS** (`worlds/field.js`): the real FIELD scene (landscape, flowers, city on the horizon, sky, lights) seen from the meadow in *your* camera's direction and field of view.

```js
import { createFieldBackplate } from '../worlds/field.js';
const plate = await createFieldBackplate(ctx);     // shares FIELD's scene (built once per renderer)
scene.add(plate.mesh);                              // a background triangle: renderOrder -100, at the far plane, linear HDR
// in update(), after your camera is set (portals first, as always):
plate.set({ sunElevation, sunAzimuth, cloudCover, cityLights, defocus, lightsOut, heading, inkCloud });
plate.update(t, camera);                            // renders the plate; restores the renderer's target
```
`defocus` 0..1 turns flowers and city windows into the same oval discs (1 : 1.5); `lightsOut` 0..1 puts the discs out from the right edge leftward (S22, 03:29); `heading` (degrees) turns the plate so the city or the sun sits where you need it; `inkCloud` 0..1 greys the sky for S12/S13. `plate.texture` is the plate itself if you would rather sample it. **Final pass:** `set()` now replaces the whole state (omitted keys reset to defaults: pass everything each update); new keys `discs`, `discLayer`, `grade` (your shot's own exposure/contrast/saturation, so the plate lands in your grade); `plate.discs` is a second mesh (the X11 light discs as analytic soft ovals) to add beside `plate.mesh`. Dusk for S21/S22 (clean at 1:1, sheet `stills/field/sheet_backplate_coda_1to1.png`, example `tools/dev/scenes/fieldcoda.js`): `{ sunElevation: -2 → -5 (202–212), sunAzimuth: -12, cloudCover: 0.2, cityLights: 1, defocus: 1, heading: 14, lightsOut: 0 → 1 (209–212.2), discs: 1, discLayer: true, grade: { exposure: 0.2, contrast: 1.04, saturation: 1.1 } }`; out-of-focus blades in front of it need `depthWrite: false` and premultiplied alpha (recipe in `createFieldBackplate`'s header). Also optional in `set`: `exposure`, `bokeh`, `flowers`, `eye`, `spot`. The mesh sits at the far plane, so keep `ink.mist` at 0 in shots that show it (or the INK pass dilutes the whole plate to paper). Sheets: `stills/field/sheet_backplate_dawn_rain_dusk.png`.

### Title cards: over picture, on paper

Schema in `src/titles.js` (`zh`/`en` or `lines`, `position`, `frame`, `align`, fades, `shadow`, **`shadowBlur`** (px @1080p), **`layer`**). With no matte, `frame: 'picture'` = `'full'`: positions are fractions of the 2160×1080 frame (y from the top).
- **Over picture** (default `layer: 'picture'`): composited over the mixed frame, before grain. L1 (`_card.js` `OVER_PICTURE`: #F2EDE4 at 92%, shadow blur 12 px).
- **On paper** (`layer: 'paper'`): laid into each shot **before its INK pass**, so the glyphs take the paper's tooth, wet edge and the in-shot SHEEN (S24's flash of blue on black ink). L2, E (`ON_PAPER`: ink #0D0C0E, no shadow). Not drawn into portals.
- `sampleTextPoints` (diegetic text as points/scales/light) is resolution-independent (em units); size your world from the frame, e.g. C0 at 58% of frame width.
- `_card.js` holds SCRIPT.md section 5's positions converted to full-frame fractions (`CARD_LAYOUT`: T1, L1, L2, E), `lineCard` (one line by baseline), `twoBeat` (L1's sentence in two beats on one fixed line; the first clause has `riseIn: 6`), `inscriptionT1` (the resist). On-paper cards are not repainted by the INK pass (type is never wobbled or bled): the pass lays them into the sheet as 焦 with the paper's tooth, at their true place.
- **SHEEN** transition defaults are now width 0.18, gain 1.15 (the script's 12% read as a hard blue bar).
- **SHEEN colours** (transition and in-shot): cyan where the band arrives, wing blue in its middle, violet where it leaves; bright things take its colour and black lights up (the dark angle turning).
- **Dev harness** (LOOK group, usable by anyone): `node tools/dev/look.mjs <scene> <t…> [--scale 0.5] [--samples 8] [--range t0 t1 --step n] [--bench]` runs a scene module from `tools/dev/scenes/<scene>.js` (a world's `create(ctx)` plus its own `shots`/`cards`) through the real engine without touching the timeline; `film` as the scene name runs the film's own timeline.

## Portals: `engine.portal(shotId, t, opts) → THREE.Texture`

```js
// in world.update(t, localT, shot, p) — FIRST, before setting any of your own state
const tex = ctx.engine.portal(p.portal.shot, p.portal.t, { scale: 0.5 });   // static: rendered once, cached
drop.set({ portal: tex, fill });
```

- Renders shot `shotId` at film time `t` through its own world, camera rig and per-shot post (bloom, grade, INK, in-shot SHEEN) **without title cards, grain or matte**. Display-referred RGBA16F (sRGB-encoded values, as the graded frame); alpha = linear view depth. `texture.userData = { shot, t, post, stage }`.
- `opts`: `scale` (1 = frame size) or `width`/`height` (rendered at full size, then box-filtered down) · `stage: 'hdr'` = the linear scene after DOF, before bloom/grade (draw it in your HDR scene; with your post equal to `userData.post` the hand-off is exact) · `live: true` (re-rendered whenever `t` changes; one target per `key`) · `mipmaps`.
- Static portals are cached per (shot, t, size, stage), 16 entries LRU (live ones count).
- **Declare it** in the shot (`params.portal: { shot, t }`), so the engine loads that world first: then it works during warm-up, offline and in stills. Undeclared portals are black for their first frames, with a warning naming the shot.
- **Re-entry:** if the portal's world is your own world, it is updated for the portal shot in between; the engine restores your camera rig, and you set everything else from your arguments anyway (hence "portals first").
- **No recursion:** nested portals work up to depth 3 (S13 → S14 → S20 is depth 2); a portal of a shot already being rendered as a portal is refused (cached or black texture, one warning).
- **Exact hand-off (X6, S13 → S14):** request `stage: 'hdr'`, show it at `fill: 1` mapped to the screen, and blend your post to `userData.post` by the cut. Verified: a drop filling the frame matches the source frame within 2 code values (dither only). Under `--samples N`, make that portal `live` with `t` following your own sub-frame time, so it accumulates the same sub-frames (a static portal is not motion-blurred). The INK pass's mist and bleed read the caller's depth, so keep `mist` at 0 at the hand-off.

## Shared library (`src/lib/`)

- **`story.js`** (Group A): `SHOT` (25 timeline entries; S04 = `S04a` INTERIOR 40–41 + `S04b` GRASS 41–52; `SHOT.S04` is the scene, not an entry; iterate `SHOT_ORDER`), `SYNC` (★1–★7 and secondary sync times), `breath(t)` / `breathInfo(t)` (period 4.0 s, inhale 1.6 s ease-out, exhale 2.4 s ease-in-out; peaks at 4k, at 4k+1 in S06–S07, and four slowing breaths 195.0/199.5/204.5/210.0 at 100/60/30/10% in S21–S22), `PALETTE` (reserved wing blues, the five ink tones, paper, per-world palettes), `INK_TONES`, `rgb()`, `linear()`, `LOOK` (7.3 table) + `lookInk(id)`, `INK_GRAIN`, `FRAME`, `LAMP_SUN [0.62, 0.58]`, `DESK_EDGE_Y 0.34`, `SLEEPER_HUMP`, `BUTTERFLY_ON_GLASS [0.38, 0.40]`, `BUTTERFLY_POOL_R`, `SLEEPER_OUTLINE` + `sleeperOutline(b)`, `SPECK`, `DUST` + `dustDiscs()`, `SEVEN` + `sway(t, i)`, `HERO_BLADE` + `bladeBow`, `bladeSpring`, `bladePoint`, `bladeScreen`, `S07_SPRING`, `S23_SPRING`, `REST_POINT [0.56, 0.54]`. Units in its header; **PLACEHOLDER** values are the named groups' to refine (keep names and units, tell the other side).
- **`thinfilm.js`** (Group B): `THINFILM` GLSL, `vec3 thinFilm(float cosTheta, float thickness)` (linear reflectance; 6-wavelength interference sum, n = 1.56, 190 nm × thickness, normal-incidence peak at 465 nm ≈ #1761FF, violet toward grazing, black outside the lobe), `thinFilmJS`. A real film blue-shifts with angle: the script's cyan comes from a thicker film (thickness ≈ 1.045), not from the angle.
- **Interface stubs** (working minimal placeholders; the signatures are the contract, the insides are the owners'):
  - `createButterfly({ lod: 'hero' | 'mid', seed }) → { group, set({ open, flap, crumple, wear, notch, barePatch, proboscis, lightDir, lightColor, dof }), update(t), dispose() }` — group in **cm** (wingspan 7), body along +Z, dorsal +Y; `open` 0 = closed over the back, 1 = flat; `flap` = null or wingbeat phase in cycles.
  - `createFlock({ count, seed, positions?, radius? }) → { mesh, set({ morphWave: { centre, t0, speed }, rise, goal, flow, scale }), update(t), dispose() }` — metres; one instanced draw; closed-form on the GPU.
  - `createFigure({ seed }) → { mesh, set({ pose: { name: weight }, breath, lean, speck, turn }), dispose() }` — metres, 1.7 m, feet at origin, facing +X; poses `asleepAtDesk upright strapHang strapNod climb walk topDown shadow`.
  - `createDrop({ radius }) → { mesh, set({ portal, fill, wobble, lightDir }), dispose() }` — the portal inverted and barrel-distorted, relaxing to the screen at `fill` 1; decodes 'graded' portals, shows 'hdr' ones as they are.
- GRAIN's GLSL (`glsl/noise.js` NOISE/HASH/COMMON, `glsl/sky.js` SKY/FOG) and JS (`random.js`, `easing.js`, `noise.js`, `camera.js`, `sky.js`, `particles.js`, `prepass.js`, `line.js`, `grains.js`, `tree.js`) are unchanged; see their file headers.

## Motion blur (shutter accumulation, offline)

`--samples N` renders each frame as the average of N sub-frames at `t = (i + shutter · k / N) / 30`. Scene + DOF per sub-frame, summed in RGBA32F; bloom + grade **and the look pass (INK)** run once on the average at the nominal time; mix, fade, cards, grain, dither once. `shot.shutter` (0..1, keyframable) overrides the default 0.5. Sub-frames never cross a cut; during a dissolve or SHEEN each layer uses its own shutter. N identical sub-frames reproduce the single-sample frame bit for bit. Portals are rendered single-sample (see the hand-off note above).

## Performance (Apple M5 Max, Chrome)

- **Live budget:** under ~12 ms/frame for 60 Hz headroom, under 25 ms for a solid 30. Dissolves and SHEENs render two shots; each inked layer adds its INK pass (≈0.1 ms at 2160×1080, up to ~1 ms in low-power GPU states).
- **Offline:** up to ~150 ms/frame is acceptable. A 2 s half-size preview of the stub timeline captured at 119 fps.
- Capture path unchanged: RGBA8 → GPU yuv420p pack → async PBO readback → WebSocket → ffmpeg. 2160×1080, 1080×540 and 4320×2160 all satisfy width % 8 / height % 4.

## Gotchas found while building this

1. **MSAA resolve honours the scissor** (only relevant with a matte): `post.js` re-resolves unscissored. Don't remove that.
2. **WebSocket for frames**, async PBO readback, `setparams` colour tags for ffmpeg ≥ 7: as GRAIN.
3. **Additive particles + DOF:** use `FX_LAYER`. **Overdraw:** `addDepthPrepass`.
4. **Camera orientation must be absolute every frame.**
5. **`scene.background`** set to a colour clears the target; prefer a background mesh.
6. **Low sun + haze is very bright:** expose down rather than weaken the sky model.
7. **Three's `WebGLRenderTarget` has no `userData`**; the post chain keeps per-target depth info in a `WeakMap`. Reading back a half-float target needs a `Uint16Array` (a `Float32Array` silently reads nothing).
8. **Timing single passes on Apple GPUs:** passes whose output is overwritten unread can be elided, and GPU clocks vary a lot. Time a dependent chain and read back from its last target.
9. **zsh** doesn't word-split `$VAR`: `node tools/still.mjs ${=TIMES}`.

## Audio (`src/audio/`, Group D)

`export async function renderScore(ctx, duration)` in `score.js` (unchanged interface). Import times from `src/lib/story.js` (`SHOT`, `SYNC`, `breath`). `render.mjs` caches the WAV keyed by `src/audio/*`, `timeline.js` and `config.js`.

## Who owns what (SCRIPT.md 8.4)

| Group | Owns | Builds |
|---|---|---|
| **A. LOOK, PAPER, FIELD** | `src/post.js` (INK pass plumbing), `src/engine.js` (SHEEN, portal), `src/lib/ink.js`, `src/lib/story.js`, `src/lib/flock.js`, `src/worlds/paper.js`, `src/worlds/field.js`, `src/shots/paper.js`, `src/shots/field.js`, `src/shots/_card.js`, `src/shots/_shot.js` | S20, S23, S24; cards L1, L2, E; the T1 resist helper (for CITY); FIELD backplate for GRASS; S20 portal frame for S14 |
| **B. BUTTERFLY and MACRO** | `src/lib/butterfly.js`, `src/lib/thinfilm.js`, `src/lib/drop.js`, `src/worlds/scale.js`, `src/worlds/grass.js`, `src/shots/macro.js` | S03 (C0), S04b, S05, S06, S07, S12, S13, S21, S22 |
| **C. CITY and FIGURES** | `src/lib/figure.js`, `src/worlds/city.js`, `src/worlds/interior.js`, `src/shots/city.js` | S01 (T1), S02, S04a, S08–S11, S14–S19 |
| **D. SCORE** | `src/audio/score.js`, `kit.js`, `dsp.js`, `assets.js` (+ `voices.js`) | SCRIPT.md section 6 |

Shared data files (`timeline.js`, `cards.js`, `registry.js`) only merge per-group exports. Joins between groups are numbers in `story.js` (SCRIPT.md 8.4 "Agreements"): X1/X2 `BUTTERFLY_ON_GLASS`, `dustDiscs`; X3 `SLEEPER_OUTLINE`, `LAMP_SUN`, `DESK_EDGE_Y`; X5 `SEVEN`, `sway`; X6 `engine.portal('S14', 129.0)` (C keeps S14's first frame independent of anything before 129.0); X8/X9 FLOCK `morph` 0 = CITY's umbrellas; S22→S23 `HERO_BLADE`, `REST_POINT`, black #000 at 214.0–217.5.
