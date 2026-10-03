# 影片结构与引擎

运行入口是 `index.html → src/main.js → src/engine.js`。播放器用 WebAudio 时钟推进时间；离线工具直接请求绝对帧 i，时间为 i/30。所有场景必须能从时间恢复状态，避免“上一帧推进到下一帧”的模拟。

| 位置 | 职责 |
|---|---|
| src/config.js | 1920×1080 参考画布、30 fps、48 kHz、固定 seed |
| src/timeline.js、src/shots/ | 240 秒连续镜头、参数、相机、转场、画幅 LOOK |
| src/lib/story.js | 全片故事时钟、山体侵蚀表、P0 山脊/树冠包络、master camera |
| src/worlds/ | ice、valley、bed、strata、meadow、canopy；注册表延迟加载 |
| src/post.js | HDR 场景、DOF、快门平均、bloom、调色、标题、grain、留边和 YUV 捕获 |
| src/titles.js、src/cards.js | 文字形状采样与中英文字幕/片名 |
| src/audio/ | 乐器、声层、DSP、离线总线、播放时钟、WAV 编码 |
| tools/ | 本地服务、浏览器/GPU 检测、静帧、性能、视频、配乐、单文件打包 |

关键共享约束是：山脊、金线、树冠使用同一 P0 轮廓；相机控制世界空间、标题与后期以原参考画布为基准；捕获阶段才裁出 18:9。最终山体/流水修订保留在 valley 模块，草地前景修订保留在 meadow 模块。素材和模型增强不属于 Three.js 场景的必要依赖，相关实验流程在 pipeline 中。

WebGL2 渲染 HDR RGBA16F，8 快门样本重复场景与景深并在 RGBA32F 中累积，随后进行 bloom/调色。标题、以绝对帧号播种的颗粒、留边与抖动按帧处理。YUV420p 转换与异步像素回读在 GPU 捕获路径中完成；本地 WebSocket 将帧送到 FFmpeg，回压限制在途帧。不同 GPU 的浮点、纹理过滤和字体栅格化仍可能不同。

`tools/lib/browser.mjs` 的 `launchBrowser/openFilmPage` 和 `tools/serve.mjs` 的 `startServer/FILM_ROOT` 是 pipeline 的共享入口。`window.__film` 提供 info、离线帧/范围捕获、静帧与 WAV 导出；不要把仅存在于隔离 NR 副本的 patch 当作影片原 API。

源码中的 simplex 噪声来自 Ashima Arts / Stefan Gustavson，GLSL 与 CPU 镜像均保留 MIT 全文。未被实际场景调用的 noised、erosionFbm、pcg3、hashu33 已从库中移除，没有替換正在使用的算法。HASH 注明 Dave Hoskins，解析高度雾注明 IQ，PCG 与拟合 tone-map 的出处需一并参考根目录第三方说明；这些例程不应被当作影片作者独创。打包不删除 legal comments，并嵌入 Three.js 完整许可证。

## 原始引擎设计记录

下面保留引擎最初的接口与性能设计，作为扩展参考。其中 2.39:1、占位场景、多 Agent 分工和旧导出命令是初版历史；**当前权威运行命令在 film.md，当前画幅为 LOOK=2.0 + 编码前裁切**，当前源代码的具体参数优先。以下的测量和性能数字均为当时记录，不是本次开源包重新验证的结果。原设计中的“deterministic”是时间/seed 约束，不是跨硬件像素一致保证。

<details>
<summary>展开原始 ENGINE 接口与实现说明</summary>

# Film engine: contract for scene and audio agents

The film is a **pure function of time `t`** (seconds). Picture: Three.js (WebGL2) → HDR post chain → 2.39:1 frame at 1920×1080, 30 fps. Sound: one AudioBuffer synthesized with an `OfflineAudioContext` (48 kHz stereo). Live playback derives `t` from the audio clock. Offline rendering sets `t = frame / 30`.



## Commands (run from `film/`)

| Task | Command |
|---|---|
| Live dev server | `node tools/serve.mjs` then open http://127.0.0.1:8123/ (`?t=95`, `?shot=<id>`, `?hud=1`, `?mute=1`, `?scale=0.5`) |
| Stills (PNG) | `node tools/still.mjs 12.5 47 130 --out stills/` · `--frames 375` · `--shot <id>` (5 frames across a shot) · `--scale 0.5` |
| Cost per frame | `node tools/bench.mjs 12.5 47` · `--shot <id>` |
| Preview MP4 | `node tools/render.mjs --start 40 --end 45` → `out/preview_40-45.mp4` (add `--scale 0.5 --preset veryfast` for speed) |
| Full film | `node tools/render.mjs` → `out/film.mp4` |
| Motion blur | add `--samples 8` to `still.mjs` / `render.mjs` (shutter accumulation, default 1 = off; `--shutter 0.5` default = 180°). Stills get an `_s8` suffix, previews `_s8`. See "Motion blur" below |
| **Final 1080p** | `node tools/render.mjs --samples 8` → `out/film.mp4` (x264 CRF 16, AAC 320 k) |
| **Final 4K** | `node tools/render.mjs --scale 2 --samples 8 --encoder hevc_videotoolbox` → `out/film_2160p_hevc.mp4` (3840×2160, Apple hardware HEVC, `-q:v 70`, `hvc1`) |
| Encoders | `--encoder x264` (default; `--crf`, `--preset`) · `hevc_videotoolbox` · `h264_videotoolbox` (`--quality 70` constant quality 1–100, or `--bitrate 70M`) |
| Single file | `node tools/build-html.mjs` → `out/film.html` (self-contained, no network) |

Live keys: click to start, **space** pause, **← / →** ±5 s (shift ±1 s), **, / .** frame step while paused, **f** fullscreen, **h** HUD, **Home** restart. Live mode creates and warms every world and renders the score before the "click to begin" prompt, so there are no hitches mid-film.

## Files

```
index.html              live player (import map → node_modules/three)
src/config.js           FPS, WIDTH/HEIGHT, REF_HEIGHT, SAMPLE_RATE, FILM_SEED
src/main.js             player UI + offline API (window.__film)
src/engine.js           renderer, world registry/lifecycle, scheduler, transitions
src/post.js             post chain, DEFAULT_POST, FX_LAYER, capture (GPU yuv420p pack)
src/titles.js           title-card layer + sampleTextPoints / fitPointsToCount
src/timeline.js         DATA: shots, LOOK, DURATION
src/cards.js            DATA: title cards
src/worlds/registry.js  one line per world
src/worlds/<name>.js    one file per world
src/lib/…               shared GLSL + JS helpers (below)
src/audio/score.js      THE SCORE (audio agent owns this)
src/audio/synth.js      synthesis toolkit; audio.js = playback/clock; wav.js = encoder
tools/                  serve, still, bench, render, build-html
```

Two agents can work in parallel without conflicts. Each owns its own `src/worlds/<name>.js` and adds one line to `registry.js`. The shared files are `timeline.js` and `cards.js` (data only).

## Determinism rules (hard)

- No `Math.random()`, `Date.now()`, `performance.now()` or `new Date()` in anything that affects picture or sound. `render.mjs` warns if it finds them in `src/worlds`, `src/lib`, `score.js`, `synth.js`, `timeline.js` or `cards.js`. Use `createRng(seed)`, `hash1/2/3`, the GLSL `hash*` / `pcg*` functions, and the seeded audio helpers.
- `update(t, …)` must set **all** state from its arguments. Never integrate over frames or rely on the previous frame. Frames are rendered in any order: stills, seeking, `?shot=` loops, partial renders.
- A world can be updated **twice in one frame** with different shots (a dissolve between two shots of the same world). Render happens right after each update, so this is safe as long as `update` is pure.
- Historical record only: the original engine notes described still/render/bundle comparisons and a 41 dB PSNR measurement. Those comparisons were not repeated for this open-source package and are not current validation or cross-machine guarantees.

## Adding a world

`src/worlds/forest.js`:

```js
import * as THREE from 'three';
import { NOISE } from '../lib/glsl/noise.js';
import { SKY, FOG } from '../lib/glsl/sky.js';
import { createSky } from '../lib/sky.js';
import { createParticles } from '../lib/particles.js';

export async function create(ctx) {
  // ctx: { THREE, name, seed, rng, renderer, width, height, aspect, fps, shots (this world's shots), engine }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, ctx.aspect, 0.1, 5000);
  const sky = createSky({ turbidity: 2 });
  scene.add(sky.mesh);
  // ... build meshes from ctx.rng / ctx.seed ...
  return {
    scene, camera,
    post: { bloom: 0.06 },                // optional static or (t, localT, shot) => ({...}) look
    update(t, localT, shot, params) {     // params = shot.params with keyframes evaluated
      sky.set({ sunElevation: params.sunElevation ?? 10, time: t });
      // ...
    },
    // optional: render(renderer, target, camera) for multi-pass worlds (replaces renderer.render)
    // optional: async warmup(renderer)
    dispose() { /* free geometries/materials/targets */ },
  };
}
```

Then add one line to `src/worlds/registry.js`: `forest: () => import('./forest.js'),`.

- `create` may be async. The engine imports the world lazily, creates it, runs `update` at its first shot, `compileAsync`s and draws once (shader compile + upload) **before** the world is first needed. Offline mode prefetches worlds 8 s ahead.
- The camera aspect is set to the full 16:9 frame. The engine applies the shot's camera rig **before** `update`, so the world can still override the camera.
- Draw linear HDR radiance. Daylight surfaces land around 0.1–2 and the sky around 0.3–3. No tone mapping and no sRGB conversion: the post chain does both. Built-in three materials work (lights are physical units). `ShaderMaterial` can write `gl_FragColor`.
- Additive particles and glows that don't write depth should be put on `FX_LAYER` (`import { FX_LAYER } from '../post.js'; mesh.layers.set(FX_LAYER)`). Otherwise depth of field blurs them with whatever is behind them. FX objects are drawn sharp after DOF and are still depth-tested against the scene. Without DOF they render normally.
- Expensive fragment shaders (terrain, raymarching) need `addDepthPrepass(mesh)` from `src/lib/prepass.js`, so each pixel is shaded once instead of once per overlapping layer (~40% saving on the placeholder terrain).
- Keep a JS mirror of any height function you use to place cameras (`src/lib/noise.js` mirrors `snoise/fbm/ridged`; see `terrainHeightJS` in the placeholder).

## Timeline (`src/timeline.js`)

```js
export const LOOK = { letterbox: 2.39 };   // film-wide post overrides
export const shots = [{
  id: 'valley-01', start: 0, end: 5.5,      // film seconds; shots are contiguous, sorted
  world: 'placeholder',
  camera: { ... },                           // rig spec, below (optional)
  params: { sunElevation: { keys: [[0, 5], [1, 3.6]] }, dust: 1 },   // free-form, per world
  post: { exposure: -1.5, dof: { focus: 16, aperture: 0.6 } },        // per-shot post
  transitionIn:  { type: 'dissolve', duration: 2 },
  transitionOut: { type: 'fadeToBlack', duration: 1.5 },
  shutter: 0.5,                              // optional: motion-blur shutter for --samples renders (0 = off, 1 = full-frame smear)
}];
export const DURATION = /* last end */;     // the score renders exactly this long
```

**Keyframes.** Any value in `params`, `post` or `camera`, including nested objects like `dof`, may be:
- `{ keys: [[t, v], …], ease: 'inOutSine' }`, where `t` is shot-local 0..1, or `time: 'seconds'` (since shot start) / `'absolute'` (film time). Values are numbers or arrays. A key may carry its own easing as a third element: `[t, v, 'outCubic']`.
- A pure function `(localT, t, shot) => value`.

Easings are in `src/lib/easing.js` (`Ease`): linear, in/out/inOut × Quad/Cubic/Quart/Sine/Expo/Circ, smooth, smoother, cine, outBack.

**Transitions.**
- `cut` is the default.
- `dissolve`: the incoming shot's **first `duration` seconds** cross-dissolve with the previous shot. The previous shot keeps rendering past its `end`, so its `localT` exceeds 1; clamp if you need to. Each shot is fully graded with its own post before the mix.
- `fadeFromBlack | fadeFromWhite | fadeFrom` (with `color: [r,g,b]`, display space) runs over the shot's first `duration`.
- `dipToBlack | dipToWhite | dip`: the previous shot fades out over d/2, then this shot fades in over d/2.
- `transitionOut: fadeToBlack | fadeToWhite | fadeTo` runs over the last `duration`.

All transitions take an optional `ease`. Gaps between shots render black, and the engine warns about gaps and overlaps.

**Camera rig** (`src/lib/camera.js`):

```js
camera: {
  path: [[x,y,z], ...] | position: [x,y,z],   // centripetal Catmull-Rom, arc-length (even speed)
  target: [x,y,z] | [[x,y,z], ...],           // look-at point or look-at path (same progress)
  rotation: [pitch, yaw, roll],               // OR absolute Euler degrees (no target)
  ease: 'inOutSine', range: [0, 1],           // progress easing; sub-range of localT
  lens: 35,                                   // mm on Super-35 (horizontal FOV); or fov: (three vertical, full frame)
  roll: 0, near, far,
  shake: { amp: 0.02, rot: 0.25, freq: 0.5, seed: 1 },   // deterministic handheld
}
```

The 2.39 picture shows the middle 74% of the 16:9 frame's height. Horizontal FOV is shared, which is why `lens` is the intuitive control.

## Post (`src/post.js` → `DEFAULT_POST`)

Order per shot: scene (HDR RGBA16F, MSAA×4, scissored to the picture area) → DOF → [with `--samples N`: repeat scene → DOF per sub-frame, average in an RGBA32F accumulator] → bloom → grade. Once per frame: dissolve mix → fade → **title cards** → grain → letterbox → dither.

| key | default | meaning |
|---|---|---|
| `exposure` | 0 | EV before tone map |
| `temperature`, `tintGM` | 0, 0 | white balance (−1..1) |
| `tint` | [1,1,1] | linear RGB multiplier (per-shot colour cast) |
| `lift`, `gamma`, `gain` | [.012,.012,.016], 1, 1 | display-space LGG (vec3) |
| `contrast`, `saturation` | 1.04, 0.96 | |
| `splitShadows`, `splitHighlights`, `splitAmount` | cool / warm, 0 | split toning |
| `bloom`, `bloomScatter` | 0.045, 0.68 | energy-conserving mix of a 6-level mip-chain bloom; scatter = width |
| `halation` | 0.12 | red-orange glow around highlights |
| `vignette`, `vignetteSoftness` | 0.32, 0.5 | elliptical, picture-space |
| `chromaticAberration` | 0.6 | px at picture corners |
| `grain`, `grainSize` | 0.035, 1.3 | display-space, luminance-weighted, seeded by **frame index** |
| `letterbox` | 2.39 | picture aspect; `0` = full 16:9 (animatable: opens/closes the matte) |
| `dof` | null | `{ focus: world units, aperture: 0..2, maxBlur: px }`, golden-angle bokeh gather |

Tone mapping is ACES (Hill fit). Pixel sizes are in 1080p pixels and scale with resolution. Merge order: `DEFAULT_POST` ← `LOOK` ← `world.post` ← `shot.post`. During a dissolve, frame-level values (grain, letterbox) interpolate between the two shots.

## Motion blur (shutter accumulation, offline)

`--samples N` (`still.mjs`, `render.mjs`; page query `?samples=N&shutter=S`) renders each frame `i` as the average of N sub-frames at `t = (i + shutter · k / N) / 30`, k = 0..N−1. `shutter` defaults to 0.5 (180°). The live player never accumulates, and `--samples 1` (the default) runs the original code path, which is bit-identical to the engine before this feature.

- **Where:** per shot, the scene + DOF (+ FX layer) stage (`post.renderScene`) runs once per sub-frame and is summed in linear HDR into an RGBA32F accumulator (`post.accumulate`). The average is resolved to RGBA16F, and bloom + grade (`post.gradeShot`) run **once** on it with the nominal-time post settings. Bloom is a linear filter, so blooming the average equals averaging the bloomed sub-frames except for the Karis firefly weights and the halation threshold. Those respond to the integrated exposure, as film does, and the bloom costs 1/N. Dissolve mix, fade, title cards, grain (frame-index seed), letterbox and dither run once, at the nominal time, so cards stay sharp and grain is not averaged away.
- **Per shot:** `shot.shutter` (0..1, may be keyframed) overrides the default. 0 renders that shot single-sample. 1 is a full-frame smear for time-lapse. During a dissolve each layer uses its own value. Sub-frames advance world time only: the scheduler (layers, mix, fade) is evaluated at the nominal time, and sub-frame times are clamped to the shot's visible end, so they never sample across a cut. DOF follows the sub-frame (focus pulls), and the scissor keeps the nominal letterbox.
- **Exactness:** N identical sub-frames reproduce the single-sample frame bit for bit (verified with N = 3 and 8 on 9 frames). The fp16 scene values sum exactly in fp32.
- **Cost (1080p, M5 Max):** about 2.5–5.5 ms per extra sample. 8 samples render at 15–26 fps against 37–45 fps single-sample, so the full film takes about 5–8 min. 16 samples differ from 8 by under 0.5 code values on average, so 8 is enough.
- **Look note:** anything that changes faster than a frame is integrated. Per-frame twinkle on star-filter sparkles (S19) averages into softer, shorter rays. Lower that shot's `shutter` if the crisp rays matter more.

## 4K and encoders

`--scale 2` renders a true 3840×2160. All render targets follow the frame size. Pixel-sized post parameters (grain size, CA, DOF `maxBlur`) and title cards scale with `height / 1080`. Worlds read `uResolution`. Above 1080p the bloom chain gets extra pre-downsample levels (4K: 1920 → 960 … 30, and the grade reads the 960 level), so bloom covers the same fraction of the frame as at 1080p. The DOF gather loop cap is 4096 taps (it was 512, which truncated `maxBlur` 30–46 bokeh at 4K). Neither change has any effect at 1080p or below. Verified: a 4K frame box-downscaled to 1080p matches the 1080p frame (34–42 dB PSNR; card bounding box within 1.5 px; same grain size). At 4K with 8 samples the render runs at 6.5–8.3 fps (≈ 15–20 min for the film), with ~2.0 GB in Chrome's GPU process.

`--encoder hevc_videotoolbox | h264_videotoolbox` uses the Apple media engine (~90 fps at 4K, never the bottleneck): constant quality `-q:v 70` by default (`--quality`), or `--bitrate 70M` (1.5× peak). Both use a 2 s GOP, `hvc1` tag (HEVC Main 8-bit) or High profile (H.264), BT.709 tv-range tags and `+faststart`, with the same AAC 320 k mux. On a grainy 4K test range `-q:v 70` gives ~57 Mb/s at 43.3 dB PSNR against lossless. That beats 60 Mb/s ABR (43.0 dB). `-q:v 65` gives ~30 Mb/s at 41.8 dB. A full-film render with a non-default encoder is named `out/film_<height>p_<codec>.mp4`, so it never overwrites `film.mp4`.

## Title cards (`src/cards.js`, schema in `src/titles.js`)

```js
{ id: 'title', start: 12, end: 18,
  zh: '中文标题', en: 'English Title',            // shorthand: Chinese line above English
  // or lines: [{ text, lang: 'zh'|'zh-sans'|'en'|'en-sans', size: 54 (px@1080), tracking: 0.32 (em),
  //              weight, italic, color: '#efe9df', opacity, gap, case: 'upper'|'lower', font }]
  position: 'center' | 'upper' | 'lower' | 'upperLeft' | … | [x, y] (0..1 in the picture area),
  frame: 'picture' | 'full', align: 'center' | 'left' | 'right',
  fadeIn: 1.4, fadeOut: 1.6, blurIn: 10, blurOut: 6, rise: 8, stagger: 0.35,
  easeIn: 'outCubic', easeOut: 'inOutSine', shadow: 0.3, opacity: 1 }
```

Fonts are system stacks only (no font files). `zh` uses Songti SC → STSong → Source Han Serif / Noto Serif CJK → serif. `zh-sans` uses PingFang SC. `en` uses Cormorant Garamond → EB Garamond → Hoefler Text → Baskerville → Georgia → serif (on this Mac it resolves to Hoefler Text). Cards are drawn into a canvas, composited inside the chain, captured offline, and grained.

**Text as particles / stars / light:**

```js
import { sampleTextPoints, fitPointsToCount } from '../titles.js';
const s = sampleTextPoints('长夜 · LONG NIGHT', { lang: 'en', size: 160, step: 3, seed: ctx.seed });
// s.points: Float32Array [x,y,...] centred, y up, 1 unit ≈ 1 em; s.weights, s.count, s.width, s.height
// Pass an array of line objects for mixed zh/en lines: [{ text: '中文', lang: 'zh' }, { text: 'EN', lang: 'en', size: 80 }]
const targets = fitPointsToCount(s, 20000, { scale: 0.4 });   // Float32Array of vec3, exactly 20000
```

The placeholder world's `textFx` shows the full pattern: particles morph from scatter to targets with per-particle delay, live on `FX_LAYER`, and stay sharp under DOF.

## Shared library (`src/lib/`)

**GLSL** (JS strings, include-guarded, so concatenating duplicates is safe):
- `glsl/noise.js` `NOISE`: `hash11…hash42`, `pcg`, `hashu12` (integer hashes), `snoise(vec2|vec3)`, `vnoise`, `fbm`, `ridged`, `turbulence`, `warp`, `curlNoise(vec3)`, `worley(vec2|vec3)`. `COMMON` gives `PI`, `TAU`, `saturate`, `remap`, `luma`, `rot2`.
- `glsl/sky.js` `SKY`: physically based single scattering (Rayleigh + Mie + ozone, spherical planet, Chapman light paths, Earth shadow), a multiple-scattering boost plus a twilight floor, a limb-darkened sun, a twinkling star field with power-law magnitudes, and a milky way. Functions: `skyRadiance(rd)` (background), `atmosphere(rd, maxDistMeters, out T)`, `atmosphereEx(…, sunDir, sunI, out T)` (e.g. moonlight), `aerialPerspective(col, rd, distWorld)`, `skyFogColor(rd)`, `sunTransmittance(dir)`, `starField(rd, t)`, `starVisibility()`. Uniforms come from `createSky()` / `createSkyUniforms()`. Set `#define SKY_STEPS 8` before the chunk for a cheaper version.
- `glsl/sky.js` `FOG`: `heightFog(ro, rd, dist, density, falloff, baseHeight)`, `fogInscatter(rd, sunDir, fogColor, fogSunColor, power)`, `distanceFog`.

**JS:**
- `random.js`: `createRng(seed)` (`()`, `range`, `int`, `pick`, `gauss`, `onSphere`, `inDisk`, `shuffle`, `fork(label)`), `hash1/2/3`, `hashString`.
- `easing.js`: `Ease`, `ease`, `clamp`, `lerp`, `remap`, `smoothstep`, `segment`, `window01`, `evalKeys`, `evalValue`, `evalParams`.
- `noise.js`: `snoise2`, `snoise3`, `fbm2`, `ridged2`, `noise1` (CPU mirrors).
- `camera.js`: `CameraPath` (centripetal Catmull-Rom, arc-length `.at(s)`, `.tangent(s)`), `applyCameraRig`, `lensToFov`.
- `sky.js`: `createSky(opts)` → `{ mesh, uniforms, set({sunElevation, sunAzimuth, turbidity, stars, milkyWay, time, …}), lighting() }`. `lighting()` returns linear `THREE.Color`s matched to the sky: `sunColor`, `ambient`, `fogColor`, `fogSunColor`, `zenith`, which you can feed to DirectionalLight/HemisphereLight or your own shaders. Also `sunDirection(elev, az)` (az 0 = −Z, 90 = +X) and `atmosphereJS`. Sky options: `sunIntensity` 20, `turbidity` 1–10, `ozone`, `altitude` (m), `multiScatter`, `metersPerUnit` (aerial perspective scale), `rayleigh`, `mieG`, `sunSize` (deg), `stars`, `starDensity`, `twinkle`, `milkyWay`, `exposure`.
- `particles.js`: `createParticles({ count, seed, position: GLSL body, glsl, uniforms, attributes, fragment, blending, sizeUnits, minPixelSize })`. Stateless instanced camera-facing quads. The `position` body receives `id`, `seed` (vec4 of randoms), `t`, plus your attributes, and sets `pos`, `size` (world units), `color` (rgb, a). Sub-pixel particles are clamped to `minPixelSize` with alpha scaled by area, so they don't shimmer. Call `p.setTime(t)` in `update`.
- `prepass.js`: `addDepthPrepass(mesh)`.

## Audio (`src/audio/`)

- **Interface (keep stable):** `export async function renderScore(ctx, duration)` in `score.js`. `ctx` is an `OfflineAudioContext` (48 kHz, stereo, exact film length). Build the graph and connect to `ctx.destination`. Don't call `startRendering`. Nested `OfflineAudioContext`s are fine for stems. It must be deterministic. Import `shots` / `DURATION` from `timeline.js` to hit picture events: the placeholder rings a bell exactly at every shot start.
- **Toolkit** (`synth.js`): `hz('D3')`, `noiseBuffer` / `noiseSource` (seeded white/pink/brown), `adsr`, `smoothCurve`, `impulseResponse` + `createReverb` (generated stereo IR), `createFDN` (4-line feedback delay network), `pad`, `bell` (2-op FM), `wind`, `water`, `masterBus` (glue comp + limiter), `panner`.
- **Engine** (`audio.js`): renders once with progress (suspend/resume checkpoints) and plays from an `AudioBufferSourceNode`. The picture clock comes from `getOutputTimestamp()`. `window.__film.exportWav({ bitDepth: 16|24, format: 'arraybuffer'|'base64', start, end })`.
- **Offline:** `render.mjs` caches the WAV in `out/.cache/score-<hash>.wav`, keyed by `src/audio/*`, `timeline.js` and `config.js`, trims it to the range with `-ss/-t`, and muxes it as AAC 320 k (AudioToolbox encoder) in the same ffmpeg pass. Verified on the placeholder: the bell scheduled at 5.500 s (first dissolve frame) sits at the same position in the WAV and the MP4 (0 ms lag).

## Performance (Apple M5 Max, Chrome 1080p)

- **Live budget:** under ~12 ms/frame for 60 Hz headroom, under 25 ms for a solid 30. Dissolves render two shots, so they cost roughly double. Measure with `node tools/bench.mjs <times>`.
- **Measured costs:** the post chain is ~0.7 ms, the full-screen sky ~0.6 ms, and placeholder shots are 4.5–10.7 ms (dissolve 11.5 ms).
- **Offline:** up to ~150 ms/frame is acceptable (a 4-minute film = 7200 frames ≈ 18 min). Over 30 ms/frame live means stutter, so keep heavy-only effects behind something you can turn down in live mode.
- **Offline render speed (measured):** 52.7 fps capture and 47.8 fps including x264 `medium` for the 1080p placeholder, about 1.6× real time. Half-res previews (`--scale 0.5 --preset veryfast`) are much faster.
- **Capture path:** render to RGBA8 → GPU pack to BT.709 limited yuv420p (1.5 B/px) → async PBO readback pipelined one frame deep → WebSocket → ffmpeg stdin (rawvideo yuv420p, no swscale). The page drives the frame loop (`__film.captureRange`), which still calls `renderFrame(i)` for each frame. Use `--per-frame` for one CDP call per frame, which is slower but handy when debugging.
- **Headless GPU:** works (`ANGLE Metal Renderer: Apple M5 Max`). The launcher checks `WEBGL_debug_renderer_info` and falls back to a headful window if it ever reports SwiftShader.

## Gotchas found while building this

1. **MSAA resolve honours the scissor.** The scene is scissored to the letterbox, so three's `blitFramebuffer` resolve left stale pixels in the bars, and bloom spread them into the picture as a ghost glow. `post.js` re-resolves unscissored. Don't remove that.
2. **Fetching frames out of Chrome:** `fetch` with a `Uint8Array` body takes ~200 ms per 8 MB, `Blob` bodies fail after ~50 frames (blob storage), XHR is the same as Uint8Array, base64 over CDP is ~100 ms. WebSocket is ~20 ms with zero failures, so that's what the pipeline uses.
3. **Sync `readPixels` costs ~13 ms per 1080p frame** in Chrome. Async PBO readback (`readRenderTargetPixelsAsync`) pipelined one frame hides it completely.
4. **Additive particles + DOF:** use `FX_LAYER` (see above).
5. **Overdraw** on self-occluding terrain doubles cost: use `addDepthPrepass`.
6. **Camera orientation must be absolute every frame.** The rig only applies `roll` / rotational shake after `target` or `rotation` has set the orientation, because otherwise the rotation would accumulate across frames.
7. **ffmpeg ≥ 7 takes colour tags from frames, not flags.** `render.mjs` stamps BT.709 with `setparams`.
8. **`scene.background`** set to a colour makes three clear the target. The FX pass temporarily nulls it. Prefer `createSky().mesh` or your own background mesh.
9. **Low sun + haze is very bright.** Mie forward scattering toward a sun under ~5° easily blows out. Expose down (−1 to −2 EV on into-the-sun shots, as the placeholder does) rather than weakening the sky model.
10. **Frame size:** offline sizes are rounded to width % 8 and height % 4 for the GPU yuv420p pack (1920×1080, 960×540 are fine).

</details>
