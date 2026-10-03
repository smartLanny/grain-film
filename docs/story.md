# 《一粒》：一座山怎样成为一棵树

影片把一万年压缩成四分钟，用两轮昼夜承载时间。一粒种子先被冰保护，再被流水释放；山体的风化把石粒变成承载生命的土层。种子在灾害与埋藏中等待，直到树生长起来，其树冠与初始山脊重合。最后树把种子交还给风和雪，开场的冰中星光获得新的含义。

叙事不是地质过程的科学模拟。山脊/树冠的同形、种子的微弱暖光和水/颗粒的方向，是贯穿镜头的视觉约束。共享时间表和轮廓见 `src/lib/story.js`，中英文字幕见 `src/cards.js`。

| 时间 | 段落 | 作用 |
|---|---|---|
| 0–44 秒 | 冰 | 星光被识别为空气泡，种子与第一道光相遇 |
| 44–82 秒 | 水 | 山谷显露、融雪汇流，种子被留在石上 |
| 82–140 秒 | 石 | 崩落、洪水与土层累积，生命在埋藏中等待 |
| 140–194 秒 | 种子与树 | 发芽穿过土层，树冠重演山脊，金线显示这段关系 |
| 194–240 秒 | 风与归还 | 种子、雪、星光回到冰中，进入结尾字幕 |

这份源码是 18:9 修订后的具体实现。65–74 秒融雪改为裂隙逐渐下切、冰舌与残冰持续变薄，水纹沿汇流展开；声音相应克制，没有强配突然折断脆响。原始剧本中的镜头数量、同形设计、两个昼夜和反复回到开场的构思保留，局部实施会与早期逐项计划不同。

## 原始创作与镜头设计

以下保存最初的完整设计文档，包括故事处理、场景参数、镜头表、字幕、声音和实施要求。它是创作过程记录，出现的 2.39 初版取景、作者/模型署名、计划里的声效时刻等不能替代当前代码或最终交付说明。

# 一粒 / GRAIN

A short film generated entirely by code. Script, shot plan, title design and audio cue sheet.

| | |
|---|---|
| Runtime | **04:00.0** (240.0 s, 7,200 frames at 30 fps) |
| Picture | 1920x1080 container, 2.39:1 picture area (1920x804, black bars 138 px top and bottom) |
| Sound | Stereo, fully synthesized, no dialogue, no voice-over |
| Text | 7 cards in total: 1 diegetic credit, 1 title, 4 story cards, 1 end-credit block |

---

## 1. Title, logline, theme

**Title:** 《一粒》 / **GRAIN**

The Chinese measure word 粒 counts a seed (一粒种子) and a grain of sand (一粒沙) with the same word. English "grain" does the same. The whole film lives inside that coincidence, and every image in it is literally built from grains: one shared particle system renders the bubbles, the snow, the sand, the seeds and the stars.

**Logline (EN):** At the end of the last ice age a single seed falls out of a melting glacier onto bare gravel where nothing can grow. It waits ten thousand years, until the river has carried the mountain down to it, one grain at a time.

**一句话梗概：** 冰期结束时，一粒冻在冰川里的种子落在山脚寸草不生的砾石滩上。它等了一万年，等河把整座山一粒一粒地送到它身边。

**Theme.** Three things share one valley and keep three different clocks. Water travels fast. A mountain travels slowly. A seed does not travel at all; it waits. For most of the film the mountain's erosion reads as loss and the seed's stillness reads as helplessness, and the film lets the audience believe both. Then the two are revealed to be one event seen from two ends: the mountain was not being destroyed, it was being delivered, and the seed was not stranded, it was keeping an appointment. When the tree finally stands, its crown fills exactly the outline the summit used to fill. 山没有倒下，它只是换了一种站法 (the mountain did not fall; it found another way of standing). The coda turns the gift around: the tree sends its seeds back up to the mountain on the wind, the snow takes them in, and the opening image, which first looked like a dead cosmos, is understood to be the mountain holding something precious for as long as it takes. Waiting is not the absence of action. It is the slowest form of trust.

---

## 2. Treatment

The whole ten thousand years is lit as **two days**. Day one runs from the pre-dawn of the ice to the night of the seed's burial. Day two begins with the dawn of germination and ends in the night the seeds fly home.

### Prologue: ICE (00:00 to 00:44). Emotion: awe, cold, a held breath.

Black. A deep field of faint points of light drifts toward us. It reads as a starfield, as deep space. For a few seconds, from exactly one place on the camera's path, several thousand of those points line up into the words **Produced by Fable 5.5**; a soft band of light passes through them as if reading the line, and then parallax pulls the words apart into scattered points again. The camera keeps travelling and the "space" gives itself away: a fracture plane catches the light, a caustic ripple crosses from above. We are inside a glacier, and the stars are air bubbles. Suspended in the blue is a single seed, a dark teardrop with its silk frozen open around it like a starburst, and a faint amber pulse at its core, slow as breathing. Silence. Then the ice cracks. A hairline of light runs across the frame, sunlight pours along it, a bead of meltwater slides down the fracture, and the amber pulse answers. The camera turns toward the light and the frame burns to white.

### Act I: WATER (00:44 to 01:22). Emotion: release, speed, joy; then the first doubt.

The white resolves into snow glare, and then into the film's **master frame**: a sharp glacial horn at dawn, its valley packed with ice, not one living thing. Alpenglow walks down the summit. Snow blown from the ridge streams across the sky and, where it passes through the shapes of the letters, catches the sun: **一粒 / GRAIN**.

At the foot of the glacier a first drop falls on dry stone. Then another. The drops quicken into a thread, the thread into a stream, and the film takes off backward down the valley as a river is born and overtakes us, braiding silver across grey gravel while the glacier shrinks toward the mountain behind it. *Water travels fast.*

In the river's wake a stranded lump of ice melts on the gravel bar and sets the seed down on a pebble. The river hurries past. The seed lies on bare stone with no soil anywhere. Focus drifts from the seed to the mountain behind it: the smallest thing in the valley looking at the largest.

### Act II: STONE (01:22 to 02:20). Emotion: elegy, endurance, descent into dark.

The master frame again, and now time runs. Clouds pour. The snowline breathes. The glacier withdraws into the summit and vanishes. The river swings back and forth across the valley floor like a slow whip. On a low drum that strikes once a "century", slabs break from the horn and the peak grows visibly lower and softer. *A mountain travels slowly.* We read this as ruin.

A slab shears off in close-up; its dust becomes sand; the sand arrives, in a split-level flood shot, tumbling golden through brown water past the seed, which holds on between two stones with its silk streaming in the current. Then the trials, one after another in a locked macro frame: frost, rain, drought that cracks the silt into tiles, a fire that passes as a sweep of orange light and embers, ash falling like grey snow. After each, the amber pulse is a little dimmer, and still there. *A seed does not travel.* A beat. *It waits.*

The camera sinks through the ground into a cross-section of the earth. Flood by flood, thin bands of sediment settle on top of the seed (ochre, grey, rust, a black line of ash) while far behind the ground line the blurred shape of the mountain shrinks at exactly the rate the layers thicken. The mountain is being poured into the ground. The seed sinks to the bottom of the frame. The strip of sky at the top goes dark. The music thins to one note, then to a pulse. For six seconds the film sits in near darkness with a light that is almost out.

### Act III: SEED (02:20 to 03:14). Emotion: tenderness, exultation, recognition.

The pulse steadies and swells, and for the first time the music turns major. The husk splits. A root goes down; a pale shoot goes up, crossing the layers one by one, each band lighting briefly as the shoot passes through it, as though it were climbing back through ten thousand years. It breaks the surface into dawn and opens two leaves. Focus drifts from the seedling to the mountain, and we see for the first time how low and round it has become.

The master frame, one last time. The valley is green now. In the foreground the tree rises in time-lapse; its shadow sweeps the meadow like the hand of a sundial; its crown turns green, gold, bare, white, green, again and again, and comes to rest in the gold of a late-summer dusk. A gust lifts the first seeds from its crown. Catching the low sun, they hang for a moment in a thin golden line across the sky, and the line is the old ridge of the mountain as it stood ten thousand years ago. It lies exactly on the outline of the tree. A tiny human figure stands under the tree with a lantern, having arrived in the last second of the story. *It was waiting for a mountain.*

### Coda: WIND (03:14 to 03:46). Emotion: gratitude, peace, wonder.

Inside the crown the seeds let go by the hundreds. The camera rises with them out of the top of the tree and flies up the valley in the dusk, the river below now a silver road leading back the way everything came. Night falls. Stars come out. The first snow mixes with the seeds until snow, seeds and stars cannot be told apart, and the frame is points of light on blue-black: the first image of the film. One mote with an amber core drifts to the centre. The points slow, and stop. Caustic light ripples over them. The seed is in the ice again, pulsing, in precisely the frame where we first found it. What looked like a void at the beginning is now legible as a keeping. Cut to black on a pulse.

End credits: the title, and two lines.

---

## 3. Scene worlds

Six worlds plus one shared particle system. Every world is a pure function of film time `t` (seconds). All randomness is seeded hashing; no particle or simulation state may depend on previous frames, so that live playback and offline frame-by-frame rendering are identical.

### 3.0 Shared building blocks (used by several worlds)

| Name | What it is | Where it appears |
|---|---|---|
| **GRAINS** | One GPU point/sprite system with switchable "skins": ice bubble, spindrift snow, sand, silt, ash, ember, seed tuft, snowflake, star. Each grain's position is a closed-form function of (seed id, t). Rendered additively with depth-of-field bokeh (oval, anamorphic). | Every shot of the film |
| **P0, the ridge profile** | One 1D silhouette function used for the year-0 mountain skyline **and** for the envelope of the tree's crown. Normalised control points (u across, v up): (-1.00, 0.00) (-0.72, 0.22) (-0.50, 0.52) (-0.38, 0.60 = left shoulder) (-0.28, 0.55) (-0.10, 0.86) (0.04, 1.00 = summit) (0.16, 0.82) (0.34, 0.50) (0.62, 0.24) (1.00, 0.00), smoothed, plus fractal jitter of at most 0.03. Steep right face, longer left ridge with one shoulder. | S06, S10, S17, S18 |
| **LINE, the branching curve** | One meandering, branching curve generator (a main stem with side branches, parameterised by growth 0 to 1). The same generator draws the crack in the ice, the course of the river, the roots, and the branch skeleton of the tree. Motif: a line of light crossing darkness. | S04, S08, S10, S15, S17, S19 |
| **The seed** | A teardrop 1.2 cm long. Husk #2A1B12 with fine longitudinal ridges and a small dorsal bump so that in side view it rhymes with P0. Around its blunt end, 48 hair-fine silk filaments (#DCEFFA). Inside, an amber core #FFB347 whose brightness is `seedGlow` multiplied by a pulse (period 3.0 s, soft rise 0.4 s, decay 1.6 s). Pulse peak times are fixed per shot in the shot list (00:25.0 onward in the prologue; 02:14.0, 02:17.0, 02:20.0 in the burial; 03:40.0, 03:43.0, 03:46.0 at the end). | S03 to S05, S07, S09, S12 to S15, S21 |
| **Story clock** | `year(t)`, piecewise: 0 until 01:05; 0 to 300 across S08; 300 in S09; 300 to 3,000 across S10; 3,000 in S11; 3,500 in S12; 3,500 to 6,000 across S13; 6,000 to 9,900 across S14 (02:03 to 02:14); 9,900 in S15 and S16; 9,900 to 10,000 across S17 (02:43 to 02:57); 10,000 afterwards. | Drives W2, W3, W4 |

### W1. ICE (inside the glacier)

- **Used in:** S01 to S05, and as the destination of S21.
- **Scale:** 1 unit = 1 seed length (about 1 cm). The seed sits at the origin.
- **Ingredients:** a dark volumetric gradient with slow 3D noise cloudiness; GRAINS in "bubble" skin, about 60,000 points in a box 60 x 30 x 80 units, sizes log-distributed, the nearest ones as large soft bokeh discs; 6 to 8 huge translucent fracture planes at random tilts that are invisible until their angle to the light makes them flash (this is what tells the eye "ice, not space"); faint animated caustics projected from above; the seed with its frozen silk; the crack (LINE curve, emissive, growth-driven); a volumetric blade of sunlight entering along the crack.
- **Palette:** void #02040A, deep ice #06162B, mid ice #0E3A5C, lit ice / cyan glow #6FD3E8, bubble white #DCEFFA, seed amber #FFB347, sun blade #FFE2B0.
- **Parameters:** `lightLevel` 0..1 (navy to cyan lift), `causticAmount`, `fractureFlash`, `creditAlign` 0..1 (brightness envelope of the text grains), `creditSweep` 0..1 (position of the reading light), `crackGrowth` 0..1, `bladeIntensity` 0..1, `seedGlow` 0..1, `focusDistance`, `aperture`, `whiteOut` 0..1.

### W2. VALLEY (the master landscape)

- **Used in:** S06, S08, S10, S11, S17, S18, S20; also rendered as the blurred backplate of W3 and W4.
- **Scale and layout:** 1 unit = 100 m. X right, Y up, the camera looks toward -Z, which is west. Year-0 summit at (2.5, 30, -160). The seed's spot, later the base of the tree, at (0, 0, -1.5). At year 0 the glacier's front stands at z = -1.4, so the seed's spot lies just inside the ice. The river leaves the foot of the mountain, runs toward the camera in an S-curve, passes to the right of the seed's spot and exits bottom right.
- **MASTER FRAME (strictly locked, identical in S06, S10, S17, S18):** camera at (0, 0.02, 0), pitched up 5 degrees, vertical field of view 20 degrees measured on the 2.39:1 picture area (horizontal about 46 degrees). The horizon sits 25% up the picture; the year-0 summit sits 78% up, at 52% across. No push, no drift: these four shots must overlay to the pixel.
- **Ingredients:** heightfield terrain (ridged multifractal noise shaped so that its central skyline equals P0 at year 0); an `erosion` control that lowers and rounds the peak and raises the valley floor; glacier (blue-white ice with crevasse striping, extent-driven); river ribbon along the LINE curve with sky reflection and sun glitter, braided in early years, a single meander later, with meander phase that migrates with `year`; vegetation as a colour mask creeping outward from the river (grey gravel, then moss, then grass; no trees other than the one); analytic sky with sun disc, moon, stars; two layers of noise cloud that cast moving shadows; height fog and valley haze; screen-space light shafts from the sun; spindrift GRAINS off the ridge; rockfall events (a slab offset plus a dust plume of GRAINS); the tree from W5 placed at the seed's spot; "the Witness", a single human silhouette 1.7 m tall beside the trunk with a cloak edge that moves in the wind and an amber lantern point.
- **Palette, year 0 dawn:** sky top #0B1630, horizon #F2A65A to #F7D9B0, snow in shadow #5E7FA8, snow lit #FFD9C2, alpenglow #FF9E7A, rock #3A3F4A, glacier ice #9FD4E6.
- **Palette, time-lapse day (years 300 to 6,000):** sky #6FA3C8, cloud #E9EEF2, rock #6B6257, scree #8C8172, river clear #BFD9DE, river silty #A89F7F, moss #6E7B3C.
- **Palette, year 10,000 dusk:** sky top #1B2440, sky mid #C4553A, horizon #FFB25E, foliage lit #E9B44C, foliage shadow #2E3B1F, grass #5C6B2E, far mountain haze #7A6C8F, river reflection #FFD08A.
- **Palette, night (S20):** sky #050A18, moonlit ridge #2A3550, river silver #C9D6E8.
- **Parameters driven by `year`:**

| year | peak height (units) | ridge sharpness | glacier extent | valley fill | river | vegetation |
|---|---|---|---|---|---|---|
| 0 | 30 | 1.00 | 1.00 (snout at z = -1.4, covering the seed's spot) | 0.00 | none | 0.00 |
| 300 | 29.5 | 0.97 | 0.80 (snout at z = -30) | 0.03 | 4 to 5 thin braids | 0.00 |
| 3,000 | 24 | 0.70 | 0.15 (summit cirque only) | 0.30 | one channel, strong meanders | 0.25 |
| 6,000 | 19 | 0.45 | 0.00 | 0.60 | wide lazy meanders | 0.50 |
| 9,900 | 14.5 | 0.25 | 0.00 | 0.95 | mature, slow | 0.85 |
| 10,000 | 14 | 0.25 | 0.00, small seasonal snow cap | 1.00 | mature, slow | 0.90 |

- **Other parameters:** `timeOfDay`, `sunAzimuth`, `sunElevation`, `season` 0..1 (0 winter, 0.5 summer), `snowline`, `cloudCover`, `cloudSpeed`, `fog`, `spindrift`, `rockfall[i]` (event times), `treeGrowth` 0..1, `treeSeason`, `ridgeLine` 0..1 (the golden seed line of S18), `witness` 0 or 1.

### W3. BED (the seed's spot, macro)

- **Used in:** S07, S09, S12, S13, S16.
- **Scale:** 1 unit = 1 cm; the frame is about 30 cm wide. Long-lens macro feel, very shallow depth of field.
- **Ingredients:** a bed of 300 to 600 instanced rounded pebbles; the seed; an overhanging lip of glacier ice (S07) and a fist-sized lump of ice that shrinks (S09); a film of water and a rivulet with ripple normals and sparkle; a waterline for the split-level shot with a darker, amber-lit underwater half and light shafts; GRAINS in sand, silt, ash and ember skins; a silt layer whose depth rises; frost that creeps over surfaces by thresholded noise; raindrops with ring ripples and small crown splashes; drying cracks (cell-edge pattern) in the silt; a fire pass (moving orange key light, ember streaks, a smoke shadow); the seedling (stem and two cotyledons, growth-driven, with dew sparkles); and behind everything a **backplate**: the W2 master frame at the current `year`, rendered soft, so that the blurred triangle of the mountain is always the seed's horizon. A rack focus can bring that backplate sharp.
- **Palette:** wet stone #2B2F36, dry stone #7D776C, silt #B49B6E, water highlight #E8F6FF, flood water #6B5633, ice #BFE6F2, frost #EAF4FF, ash #55504C, ember #FF6A1F, husk #2A1B12, amber #FFB347, shoot #BFE08A, cotyledon #7FB84A, loam (year 9,900) #2E2218.
- **Parameters:** `iceLip`, `iceBlock` 1..0, `wetness`, `waterLevel`, `flowSpeed`, `siltDepth` 0..1, `frost`, `rain`, `dryCrack`, `fireLight`, `ashDepth`, `seedGlow`, `sprout` 0..1, `keyLightAngle`, `keyLightColour`, `focusDistance` (near = seed, far = backplate), `year` (for the backplate).

### W4. STRATA (the cross-section clock)

- **Used in:** S14, S15.
- **Scale:** macro. The frame is 10 cm tall at its tightest and 44 cm at its widest. Side-on view of a clean vertical cut through the ground.
- **Ingredients:** 14 sediment laminae, each with its own thickness (1.5 to 4 cm), colour, speckle of visible grains (coarse bands show small pebbles), and slight waviness; band 1 to 3 exist at the start; each later band arrives as a brief fall of GRAINS that settles and fills from left to right; the ground line; above it a strip of sky showing the soft-focus W2 backplate, in which the mountain's blurred shape lowers as `year` advances; the seed embedded at the top of band 3, its amber glow lighting the grains around it like a lamp in fog; roots (LINE curve, growing downward, ivory); the shoot (a pale line with a glowing tip, growing upward); a horizontal pulse of light that runs along a band at the instant the shoot crosses it.
- **Band colours, bottom to top (bands 1 to 14):** gravel #3B3A3C, ochre silt #B08A4F, pale sand #D2BE94 (the seed lies at the top of this third band), **ash black #1E1B1A** (band 4, the ash of S13, the first band to settle in S14), grey clay #7E8791, ochre #B08A4F, rust #8F4A2B, pale sand #D2BE94, grey clay #7E8791, ochre #B08A4F, rust #8F4A2B, pale sand #D2BE94, loam #4A3423, topsoil #2E2218.
- **Other colours:** amber #FFB347, shoot #E9F2C2, root #F4EAD5, night sky strip #070B16, dawn sky strip #F6D7A8.
- **Parameters:** `bandCount` 3..14 (fractional = band in the act of settling), `frameHeight` (zoom), `cameraY`, `skyLight` 0..1, `seedGlow`, `germination` 0..1, `rootGrowth` 0..1, `shootHeight` 0..1, `bandPulse[k]`, `year` (for the backplate).

### W5. TREE and CANOPY

- **Used in:** inside W2 for S17, S18, S20; on its own for S19.
- **Ingredients:** a branch skeleton grown from the LINE generator (trunk plus 5 to 6 levels, tapered); about 40,000 instanced leaves with back-lit translucency and wind sway; the crown **clipped to the envelope P0** as seen from the master camera, so that from that one position the tree's outline is the year-0 skyline (crown base at the height where the year-10,000 mountain top appears, crown top where the year-0 summit appeared; trunk below, standing in front of the lowered mountain). Guide dimensions: total height 30 m, trunk 15 m, crown about 24 m wide. Season colours on the leaves; bare branches and a dusting of snow in winter; seed tufts (GRAINS, "seed" skin: a bright core, a soft halo, six fine rays) that appear at branch tips and release on the wind; light shafts through the crown.
- **Palette:** bark #2B211B, leaf summer #4F7A2A, leaf lit #A9C94F, leaf gold #E9B44C and #D98324, backlight #FFE3A3, seed tuft #FFF4DC with amber core #FFB347.
- **Parameters:** `treeGrowth` 0..1 (sapling to full envelope), `treeSeason`, `wind`, `leafDensity`, `seedRelease` 0..1, `sunAngle`.

### W6. NIGHT WIND (the return)

- **Used in:** S20, S21.
- **Ingredients:** the W2 terrain at night as a near-silhouette with the river as a silver ribbon and a small snow cap on the rounded summit; moon glow and thin cloud; GRAINS in three skins at once: seed tufts (about 6,000, warm, travelling on a curl-noise wind whose mean direction is up-valley), snowflakes (about 30,000, cool, falling and swirling), stars (about 25,000, fixed far shell, faint twinkle). A `freeze` control blends every grain's position from its wind position to the exact bubble position it holds in W1, drops its speed to zero, and cross-fades the sky into ice (caustics and fracture planes fade in). When `freeze` = 1 the picture is W1.
- **Palette:** night sky #050A18, moonlit ridge #2A3550, river silver #C9D6E8, snow #E8F0FA, star #FFFFFF, seed amber #FFB347, then the W1 palette.
- **Parameters:** `wind`, `seedCount`, `snowAmount`, `starVisibility`, `moonElevation`, `freeze` 0..1, `seedGlow`.

---

## 4. Shot list

Timecodes are mm:ss.s, continuous, no gaps. Field-of-view figures are vertical, measured on the 2.39:1 picture area. "Lens feel" gives the 35 mm-equivalent look to aim for.

| # | In to Out | Dur | World | Camera | What happens | Key parameters | Transition out |
|---|---|---|---|---|---|---|---|
| **PROLOGUE: ICE** | | | | | | | |
| S01 | 00:00.0 to 00:07.0 | 7.0 | W1 | Slow dolly forward from (-16, 4, 52) toward (-13, 3.4, 44), looking at (-10, 2, 0). 35 mm feel, wide open, deep bokeh. | Black for 2.0 s, then points of light fade up over 4 s. Reads as deep space. | `lightLevel` 0.05; no caustics; no fracture flashes; `seedGlow` 0 | Continuous take (no cut) |
| S02 | 00:07.0 to 00:19.0 | 12.0 | W1 | Same move continues through (-9, 2.5, 34) at 00:15.0 to (-7, 2, 29). About 1.2 units per second. | The credit **Produced by Fable 5.5** assembles by parallax, is read by a passing band of light, and disperses. See card C0. | `creditAlign` 0 to 1 to 0, peak 00:15.0; `creditSweep` 0 to 1 from 00:13.0 to 00:15.5 | Continuous take |
| S03 | 00:19.0 to 00:31.0 | 12.0 | W1 | The move accelerates then eases out to (0.8, 0.3, 3.4) looking at the origin. Rack focus from far field to the seed at 00:24.0. Ends as a macro close-up, seed slightly right of centre. | A fracture plane flashes at 00:20.5 and caustics ripple in at 00:22.0: this is ice. The seed is discovered, silk frozen open, first amber pulse at 00:25.0, then every 3.0 s. | `lightLevel` 0.05 to 0.2; `causticAmount` 0 to 0.4; `seedGlow` 0.35 | Continuous take. **The final pose of S03 is the pose S21 must end on.** |
| S04 | 00:31.0 to 00:38.0 | 7.0 | W1 | Locked close-up; a tiny 0.5 degree shudder at the crack, then still. | 00:31.0 a hairline crack shoots from upper right to lower left in 0.4 s, passing just behind the seed; five side branches grow over 2 s. 00:32 to 00:36 a blade of warm sunlight enters along it and the ice lifts from navy to cyan. 00:35.0 a bead of meltwater slides down the crack. The seed pulses brighter in answer. | `crackGrowth` 0 to 1; `bladeIntensity` 0 to 0.8; `lightLevel` 0.2 to 0.7; `seedGlow` 0.35 to 0.8 | Continuous take |
| S05 | 00:38.0 to 00:44.0 | 6.0 | W1 | Tilt up along the crack and push into the light, 35 mm feel. | The frame blooms. Full warm white by 00:43.0; white held for 1.0 s. | `whiteOut` 0 to 1; `bladeIntensity` 0.8 to 1 | **Match on white** into S06 |
| **ACT I: WATER** | | | | | | | |
| S06 | 00:44.0 to 00:58.0 | 14.0 | W2 | **MASTER FRAME**, locked. 50 mm feel. | Year 0, dawn, sun behind camera. White settles into snow glare, then the vista (exposure normal by 00:46.0). Alpenglow descends from the summit to the glacier. Last stars fade. Spindrift streams right from the summit. Title appears in the spindrift (card C1). | `year` 0; `sunElevation` -2 to +4 degrees; `spindrift` 1; `cloudCover` 0.1 | Hard cut |
| S07 | 00:58.0 to 01:05.0 | 7.0 | W3 | Locked macro at the glacier snout: lit ice lip across the top third, dry pebbles in shadow below. 100 mm macro feel. The seed is visible as a dark fleck with an amber glint inside the ice lip. | A first drop lets go at 00:58.4 and lands at **00:59.0**. More drops at 01:00.5, 01:01.5, 01:02.0, 01:02.5, 01:03.0, then every 0.5 s, then every 0.25 s. Wet spots join into a film; by 01:04.0 a thread of water runs out of frame right and catches the sun. | `iceLip` 1; `wetness` 0 to 0.8; `waterLevel` 0 to 0.1 | Hard cut on the downbeat |
| S08 | 01:05.0 to 01:14.0 | 9.0 | W2 | Backward-flying crane: from (0.05, 0.03, -1.3), low and just in front of the ice wall, back and up to (0.6, 2.5, 6), always looking up-valley at the snout and the mountain. 24 mm feel. | Time-lapse, years 0 to 300. The river thread chases the camera, overtakes it underneath, and splits into silver braids. The snout retreats from z = -1.4 to z = -30. Cloud shadows race. Card C2. | `year` 0 to 300; `timeOfDay` morning; `cloudSpeed` high | Hard cut |
| S09 | 01:14.0 to 01:22.0 | 8.0 | W3 | Low macro, slow lateral slide of 3 cm left to right. Seed at centre-right. | A stranded lump of ice melts (01:14 to 01:19) and sets the seed down on a pebble with a tiny tick at 01:19.0. Its silk slumps, wet. River glints pass in the background bokeh. Hold on the seed on bare stone, pulsing. 01:21.0 to 01:22.0 rack focus to the backplate: the mountain. | `iceBlock` 1 to 0; `wetness` 0.6; `seedGlow` 0.8; `year` 300 | **Rack-focus match cut**: the now-sharp backplate is the master frame of S10 |
| **ACT II: STONE** | | | | | | | |
| S10 | 01:22.0 to 01:36.0 | 14.0 | W2 | **MASTER FRAME**, locked. | Time-lapse, years 300 to 3,000, lit as one long day from morning to late afternoon (shadows rotate once). Clouds pour as streaks. Snowline breathes 7 times. Glacier withdraws to the cirque. River meanders migrate. Rockfalls with dust plumes at 01:24.0, 01:28.0, 01:32.0; after each the summit is visibly lower. Moss tint appears along the river. Card C3. | `year` 300 to 3,000; `timeOfDay` 09:00 to 17:00; `rockfall` events; `cloudSpeed` very high | Hard cut on the drum at 01:36.0 |
| S11 | 01:36.0 to 01:42.0 | 6.0 | W2 | Telephoto on the horn from the master position, field of view 4 degrees (400 mm feel), slow float of 0.05 degrees. | Near real time, heavy. At 01:36.0 a slab shears from the right face, drops, bursts into dust. Streams of grains pour down the scree, lit warm from the side. | `year` 3,000; `rockfall` close event; `timeOfDay` 17:30 | **Match on motion**: falling grains, moving down-left, cut to tumbling grains |
| S12 | 01:42.0 to 01:50.0 | 8.0 | W3 | **Split-level** shot, waterline wavering at 55% of frame height. Locked. | Flood. Above the line: storm sky #4A5560, rain, the blurred mountain; lightning at 01:44.0. Below: brown-gold water, light shafts, about 2,000 sand grains tumbling left to right and settling. The seed, wedged between two pebbles lower centre-right, holds, silk streaming like a comet tail. | `waterLevel` 1; `flowSpeed` 1 to 0.4; `siltDepth` 0 to 0.35; `rain` 1; `year` 3,500 | Hard cut |
| S13 | 01:50.0 to 02:02.0 | 12.0 | W3 | Locked macro on the seed, centre-right. | Six trials, 2.0 s each: (1) flood drains, wet silt, clear noon; (2) frost creeps over seed and silt, blue light; (3) thaw and rain; (4) drought, hard light, silt cracks into tiles; (5) fire: orange light sweeps left to right, embers streak, smoke shadow; (6) ash falls like grey snow and half covers the seed as the light fails to dusk. The pulse dims at every step. Card C4. | `siltDepth` 0.35 to 0.6; `frost`, `rain`, `dryCrack`, `fireLight`, `ashDepth` in turn; `seedGlow` 0.8 to 0.3; `year` 3,500 to 6,000 | **Ground-line wipe**: the camera sinks, the soil surface rises through frame (02:02.0 to 02:03.0) |
| S14 | 02:02.0 to 02:20.0 | 18.0 | W4 | Side-on. Slow pull-back from frame height 10 cm to 44 cm (02:03 to 02:14) keeping the seed 12% from the bottom while the ground line climbs to 82%. Then a slow push-in to 30 cm (02:14 to 02:20). | Bands 4 to 14 settle one per second, 02:03.0 to 02:13.0, beginning with the black ash band of S13's fire at 02:03.0. In the sky strip the blurred mountain lowers in step. By 02:14 the seed is a spark at the bottom of a tall column of layers. The sky strip goes to night. 02:14 to 02:20: near darkness, the glow almost out, one pulse every 3 s. | `bandCount` 3 to 14; `year` 6,000 to 9,900; `skyLight` 1 to 0.05; `seedGlow` 0.3 to 0.08 | Continuous take |
| **ACT III: SEED** | | | | | | | |
| S15 | 02:20.0 to 02:34.0 | 14.0 | W4 | Holds, then cranes up with the tip of the shoot (tip kept at 60% of frame height), frame height 30 cm. Rises above the ground line at 02:33. | **02:20.0** the glow steadies and swells (2 s). 02:22.0 the husk splits. 02:22 to 02:26 a root descends and branches. 02:24.5 to 02:32.5 the shoot climbs through 11 bands, one every 0.8 s, each band flashing a line of light as it is crossed. The sky strip warms to dawn. 02:33.0 the shoot breaks the surface into light. | `seedGlow` 0.08 to 1; `germination`, `rootGrowth`, `shootHeight` 0 to 1; `bandPulse[k]`; `skyLight` 0.05 to 1 | Cut on the burst of light |
| S16 | 02:34.0 to 02:42.0 | 8.0 | W3 | Ground-level macro, seedling centre, backlit. 100 mm feel. Slow 2 cm rise. | Year 9,900, dawn. Two cotyledons unfold (02:34 to 02:36). Dew sparkles. Dark loam and moss where there was gravel. 02:39.5 to 02:41.5 rack focus to the backplate: the mountain, low and rounded. First clear sight of how much it has given. | `sprout` 0.6 to 1; `year` 9,900; `keyLightColour` warm | **Rack-focus match cut** into the master frame, seedling in the position of the tree's base |
| S17 | 02:42.0 to 03:00.0 | 18.0 | W2 + W5 | **MASTER FRAME**, locked. | Time-lapse, years 9,900 to 10,000. The tree rises from seedling to full crown (02:43 to 02:57). Nine annual cycles pass over its leaves (green, gold, bare, snow), each 1.55 s. Its shadow sweeps the meadow like a sundial hand, once per cycle. Clouds stream. Motion eases to rest at 02:57 in late-summer gold as the sun lowers behind the tree. | `treeGrowth` 0 to 1; `treeSeason` 9 cycles; `year` 9,900 to 10,000; `timeOfDay` 14:00 to 18:30 | Continuous (time-lapse settles into real time) |
| S18 | 03:00.0 to 03:14.0 | 14.0 | W2 + W5 | **MASTER FRAME**, locked. | Real time, dusk, sun behind the crown, rim light and shafts. The Witness stands by the trunk with a lantern. 03:01.5 a gust: the first seed tufts leave the crown and, lit by the low sun, draw a thin golden line left to right across the sky. It is the year-0 ridge (P0) and it lands exactly on the crown's outline, complete at **03:04.0**. Line holds to 03:07, gone by 03:09. Card C5. | `ridgeLine` 0 to 1 (03:01.5 to 03:04.0), 1 to 0 (03:07 to 03:09); `witness` 1; `wind` 0.3 to 0.6; `treeSeason` late summer | Axial cut in toward the sun in the crown |
| **CODA: WIND** | | | | | | | |
| S19 | 03:14.0 to 03:22.0 | 8.0 | W5 | Inside the crown near the main fork, looking up and west into the sun; 28 mm feel; rises 12 m through the branches and out of the top. | Leaves back-lit, shafts of light. Seed tufts detach by the hundreds and drift up past the lens as soft bokeh. Branches against the sky echo the braided river of S08. | `seedRelease` 0 to 1; `wind` 0.6 to 0.9; `sunAngle` low | **Match on motion**: rising with the seeds into open sky |
| S20 | 03:22.0 to 03:32.0 | 10.0 | W6 over W2 | Flying forward (west, up-valley) with the seeds, climbing from 0.5 to 6 units, then tilting up until the land leaves the bottom of frame at 03:31. 24 mm feel. | Dusk falls to night across the shot. Below, the river is a silver line leading to the low mountain and its small snow cap. Stars appear from 03:25. Snow begins at 03:28 and mixes with the seeds. | `timeOfDay` 19:00 to 23:00; `starVisibility` 0 to 1; `snowAmount` 0 to 0.7; `wind` 0.9 to 0.5 | Continuous take |
| S21 | 03:32.0 to 03:46.0 | 14.0 | W6 into W1 | Drift that eases, by 03:42.0, into exactly the final pose of S03: (0.8, 0.3, 3.4) looking at the origin. | Only points of light on blue-black: seeds, snow and stars are indistinguishable. One amber-cored tuft drifts to centre. 03:36 to 03:42 everything slows and stops; the tuft's silk splays and freezes; night sky becomes ice; caustics return. Amber pulses at 03:40.0, 03:43.0, 03:46.0. It is the frame of S03. | `freeze` 0 to 1 (03:36 to 03:42); `wind` 0.5 to 0; `causticAmount` 0 to 0.4; `seedGlow` 0.35 | **Cut to black at 03:46.0, on the peak of a pulse** |
| S22 | 03:46.0 to 04:00.0 | 14.0 | Black | None. A few dozen W1 bubble grains keep drifting at 6% brightness behind the text. | End credits (cards E1, E2). Fade to full black and silence 03:58.5 to 04:00.0. | | End |

**Duration check:** 7 + 12 + 12 + 7 + 6 + 14 + 7 + 9 + 8 + 14 + 6 + 8 + 12 + 18 + 14 + 8 + 18 + 14 + 8 + 10 + 14 + 14 = 240.0 s.

### Motifs and match cuts, at a glance

| Motif | Occurrences |
|---|---|
| **The grain** (one particle system, many meanings) | bubbles (S01 to S05), spindrift title (S06), drops (S07), sand (S11, S12), silt, ash, embers (S13, S14), seeds (S18 to S21), snow and stars (S20, S21) |
| **The amber point** | seed core (S03 onward), sun blade (S04), alpenglow on the summit (S06), fire that threatens it (S13), sun through the crown at the summit's old position (S18), the Witness's lantern (S18), final pulse (S21) |
| **The line of light** (LINE curve) | crack in the ice (S04), river (S08, S10), roots and shoot (S15), trunk and branches (S17, S19), river as silver road home (S20) |
| **The profile** (P0) | year-0 skyline (S06), the seed's own outline (S09), the tree's crown and the golden line that names it (S18) |
| **The master frame** | S06 (ice), S10 (erosion), S17 (growth), S18 (recognition) |
| **Seed looks at mountain** (rack focus) | S09 to S10, S16 to S17 |
| **Down, then up** | 11 bands descend on the seed (S14); the shoot climbs the same 11 bands (S15); the river brings the mountain down (Acts I and II); the wind takes the seeds up (Coda) |
| **Bookends** | S01 to S03 and S21 share the same grains, the same camera pose and the same pulse |

---

## 5. Title cards

**General typography (all cards except C0 and C1's grain layer).** Chinese: system serif stack "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif; regular weight; letter-spacing 0.14 em; full-width punctuation. English: "Baskerville", "Didot", "Times New Roman", serif; regular; letter-spacing 0.08 em; sentence case. Colour #F2EDE4 at 92% opacity with a soft shadow (blur 12 px, black at 55%). Text is drawn to a canvas and composited **inside the rendered frame, before grain and vignette**, so that it takes the film's grain and appears in the offline render. Chinese line above, English below, always.

**Story cards C2 to C5** share one position so that they read as a ritual: left-aligned at x = 160 px; Chinese baseline at y = 800 px, 44 px type; English baseline at y = 842 px, 22 px type (coordinates in the 1920x1080 frame; the picture area spans y = 138 to 942). In: 1.2 s fade with a 6 px upward drift. Out: 1.2 s fade.

| Card | Timecode (in, full, out) | Text | Placement | How it appears and disappears |
|---|---|---|---|---|
| **C0. Production credit** | Recognisable 00:12.5; fully legible 00:13.7 to 00:16.2; perfect alignment 00:15.0; dispersed by 00:17.5 | `Produced by Fable 5.5` (exactly this string, one line; English only, because it is a verbatim credit; its bilingual form is in the end credits) | Centre of frame, text width 58% of picture width | **Diegetic, made of ice bubbles.** About 6,000 GRAINS are positioned along the sight-lines from the camera's position at 00:15.0 through the pixels of the rasterised text (serif, letter-spacing 0.12 em), each at a random depth between 14 and 40 units. From anywhere else on the path they are scattered bubbles; at 00:15.0 they coincide into the words. A soft vertical band of caustic light travels through the ice from the first letter to the last between 00:13.0 and 00:15.5, raising the brightness of the text bubbles by up to 2.5 times as it passes, as if the light were reading the line. After 00:15.0 the continuing dolly shears the words apart radially and the brightness returns to that of ordinary bubbles. Nothing fades in or out; nothing is overlaid. |
| **C1. Film title** | In 00:48.0; full 00:50.0 to 00:54.5; out by 00:56.0 | `一粒` over `GRAIN` | In the sky to the right of the summit: block centred at x = 72% of picture width, y = 26% of picture height measured from the top of the picture area. 一粒 at 120 px, letter-spacing 0.5 em. GRAIN at 30 px, uppercase, letter-spacing 0.6 em, 26 px below. | **Made of lit snow.** The spindrift streaming off the summit crosses this part of the sky. Grains that pass inside the letter shapes are lit gold (#FFD9A0, then white at the core) by the rising sun; grains outside stay dim blue. The Chinese characters catch first (00:48.0), the English 0.8 s later. Beneath the grains a solid version of the text rises to 85% opacity (00:49.0 to 00:50.5) to guarantee legibility. Out: the solid text fades (00:54.5 to 00:56.0) while the lit grains simply blow out of the letter shapes to the right and go dim. |
| **C2** | In 01:07.0; out by 01:12.0 | `水，走得快。` over `Water travels fast.` | Story-card position | Standard fade. Timed to sit over the river overtaking the camera. |
| **C3** | In 01:27.0; out by 01:33.5 | `山，走得慢。` over `A mountain travels slowly.` | Story-card position | Standard fade, but slower: 1.8 s in, 1.8 s out. Spans two rockfalls. |
| **C4** | First sentence in 01:53.0; second sentence in 01:55.0; all out by 02:00.0 | `种子不走。它等。` over `A seed does not travel. It waits.` | Story-card position | Two beats. `种子不走。` and `A seed does not travel.` fade in together at 01:53.0. After two seconds of nothing, `它等。` and `It waits.` are added on the same lines at 01:55.0. The pause is the point. Everything fades together 01:58.8 to 02:00.0, under the falling ash. |
| **C5** | In 03:05.5; out by 03:12.0 | `它等的，是一座山。` over `It was waiting for a mountain.` | Story-card position (lower left, clear of the trunk and the Witness) | Standard fade, entering 1.5 s after the golden ridge line completes, so the image lands first and the words confirm it. |
| **E1. End title** | In 03:47.0; out by 03:52.0 | `一粒` over `GRAIN` | Centre of frame, on black. 一粒 at 96 px, GRAIN at 26 px, spacing as C1. | 1.0 s fade in on the bell; 1.0 s fade out. |
| **E2. End credits** | In 03:52.5; out by 03:58.5 | Line pair 1: `出品　Fable 5.5` over `Produced by Fable 5.5`. Line pair 2: `全片的光与声，皆由代码写成。` over `Every frame and every sound was written in code.` | Centre of frame, on black. Chinese 34 px, English 20 px; 64 px between the two pairs. | 1.0 s fade in; hold; 1.0 s fade out. Black and silence from 03:58.5 to 04:00.0. |

C0 through E2 are the only text in the film: one credit, one title, four story cards, one end-credit block (E1 and E2).

---

## 6. Audio cue sheet

**Global.** Tonal centre D. Tempo grid 60 BPM throughout (1 beat = 1.0 s, 1 bar of 4/4 = 4.0 s, bar n begins at (n - 1) x 4 s), so every cue below lands on a whole or half second. Stereo. Target loudness about -16 LUFS integrated, true peak below -1 dBFS. Two synthesized reverbs (decaying filtered noise as impulse response): "ice hall", 5 s tail, for the prologue and S21; "valley", 2.2 s tail, elsewhere.

**The theme** is four notes: A4, D5, E5, and a fourth note that is **F5 (D minor) for the first two thirds of the film and F sharp 5 (D major) from the moment of germination**. In the final statement the fourth note is withheld and only arrives over the end title.

### Instruments (all synthesized)

| Name | Recipe |
|---|---|
| SUB | Two sine pairs on D1 (36.7 Hz) and A1 (55 Hz), each pair detuned 0.15 Hz for slow beating; gentle low-pass. |
| GLASS | FM bell (ratio about 1 : 3.5, modulation index decaying), 4 to 6 s decay, long reverb. Pitches from the pentatonic set of the current mode, octaves 6 and 7. |
| STRINGS | Seven detuned saw voices per note (plus or minus 12 cents) through a low-pass that opens with the envelope; attack 1.5 to 3 s; 5 Hz vibrato; a breath of band-passed noise for bow. |
| HORN | Triangle plus filtered saw, low-pass at 900 Hz, 0.3 s attack. Carries the theme. |
| KALIMBA | Short FM pluck (ratio 1 : 7), 0.4 s decay, alternating left and right. The voice of water. |
| CENTURY DRUM | Sine swept 90 to 45 Hz in 0.25 s plus a low-passed noise thump, big reverb. |
| PIANO | Additive tone, 8 slightly inharmonic partials, instant attack, 3 s decay, upper partials dying first. |
| HEART | Two 55 Hz sine thumps 160 ms apart, the second 6 dB quieter. The seed's pulse, heard only when the film is quiet. |
| AIR, WATER, FIRE, ICE, ROCK | Filtered noise families described in the effects list. |

### Music structure

| Cue | Time | Key / harmony | Instrumentation | Dynamics and notes |
|---|---|---|---|---|
| M1 Void | 00:00.0 to 00:31.0 | D, open fifth (no third) | SUB fades in from 00:01; sparse GLASS (D minor pentatonic: D F G A C) from 00:04, one note every 2 to 4 s. At the credit, a STRINGS cluster D4 E4 A4 swells 00:12.0 to 00:17.5 with its peak at **00:15.0**, and a run of tiny GLASS pings pans left to right with the reading light, 00:13.0 to 00:15.5. | ppp to p. All audio drops to silence at 00:30.5 for half a second. |
| M2 Crack | 00:31.0 to 00:44.0 | Dsus4 rising | After the crack transient: high STRINGS tremolo and a rising noise shimmer, crescendo; SUB grows. A reversed-cymbal noise swell 00:41 to 00:44. | p to ff, peaking into the white at 00:43.0; the swell cuts off at 00:44.0. |
| M3 Mountain | 00:44.0 to 00:58.0 | D minor add 9 (D2 A2 F3 E4) | STRINGS chord enters softly out of the white. HORN states the theme: A4 at 00:48.0, D5 at 00:50.0, E5 at 00:52.0, F5 at 00:54.0 (the title is fully formed on the second note). | mp, wide and still. Fades to almost nothing by 00:57.5. |
| M4 River | 00:58.0 to 01:22.0 | D minor pentatonic; bass D2, F2, C2, G2, two bars each | GLASS/KALIMBA "drop" on A5 at **00:59.0**, then at 01:00.5, 01:01.5, 01:02.0, 01:02.5, 01:03.0, then 8ths, then 16ths from 01:04.0, becoming a running KALIMBA arpeggio at 01:05.0. Light STRINGS above. At 01:14.0 the arpeggio thins to single notes and stops at 01:19.0 (the seed touches stone); then PIANO alone: A4 at 01:19.0, D5 at 01:21.0. | p to mf to p. The film's only passage of speed. |
| M5 Erosion | 01:22.0 to 01:50.0 | B flat major 7, then G minor, 4 bars each; D pedal | CENTURY DRUM on every bar line: 01:24.0, 01:28.0, 01:32.0, 01:36.0, 01:40.0, 01:44.0, 01:48.0. Low STRINGS play the theme in long notes (A2, D3, E3, F3, one per bar from 01:24). | mf, heavy, patient. The drum at 01:36.0 is the loudest (the slab). |
| M6 Waiting | 01:50.0 to 02:02.0 | D minor, bare | PIANO alone states the theme, one note after each of the first four trials: A4 at 01:52.0, D5 at 01:54.0, E5 at 01:56.0, F5 at 01:58.0. A held STRINGS D3 underneath. | p to pp. The F5 lands as the fire arrives. |
| M7 Strata | 02:02.0 to 02:20.0 | D natural minor, descending | One soft low KALIMBA/PIANO note per settling band, on each second from 02:03.0 to 02:13.0, descending: D4, C4, B flat 3, A3, G3, F3, E3, D3, C3, B flat 2, A2. STRINGS decay to a single D3. From 02:14.0 only SUB and HEART (02:14.0, 02:17.0). | pp to ppp. The quietest passage of the film. |
| M8 Germination | 02:20.0 to 02:34.0 | **D major** | **02:20.0: GLASS bell on F sharp 5, the first major third in the film**, over a warm STRINGS D major chord fading in. Then one ascending note per band crossed, every 0.8 s from 02:24.5 to 02:32.5, mirroring M7: A2, B2, D3, E3, F sharp 3, A3, B3, D4, E4, F sharp 4, A4. Full D major add 9 at 02:33.0. | ppp to f. One long crescendo. |
| M9 Seedling | 02:34.0 to 02:42.0 | D major, then G over D | Soft STRINGS; two GLASS notes; first birdsong-like chirps. | p. A breath. |
| M10 Growth | 02:42.0 to 03:00.0 | D, B minor, G, A (4 s each), then A sus 4 to A (2 s) | KALIMBA arpeggio returns (the river is in the tree now); CENTURY DRUM every 2 s from 02:46, every 1 s from 02:54; full STRINGS; HORN doubles the bass line. | mp to ff. Arrives on D major at 03:00.0. |
| M11 Recognition | 03:00.0 to 03:14.0 | D major | HORN and octave STRINGS give the theme in full with the major ending: A4 at 03:01.0, D5 at 03:02.0, E5 at 03:03.0, **F sharp 5 at 03:04.0 with a deep CENTURY DRUM and a GLASS bell**. Then a long decrescendo over a held chord. | ff at 03:04.0, down to p by 03:12. |
| M12 Wind | 03:14.0 to 03:32.0 | G major 9 over D, then D open fifth | Airy high STRINGS; GLASS notes at random from D major pentatonic (D E F sharp A B), the warm twin of M1's sparse bells; AIR bed. STRINGS thin out across S20. | p to pp. |
| M13 Return | 03:32.0 to 03:46.0 | D, open fifth (no third) | M1's SUB returns. PIANO states the theme one last time: A4 at 03:37.0, D5 at 03:39.0, E5 at 03:41.0, **and no fourth note**. HEART at 03:43.0 and 03:46.0. | ppp. All sound cuts with the picture at 03:46.0. |
| M14 Credits | 03:46.0 to 04:00.0 | D major | 1.0 s of silence. The withheld note arrives: GLASS F sharp 5 at 03:47.0 with the end title, over the softest STRINGS D and A. Fade out complete by 03:58.5. | pp to silence. |

### Sound effects, by shot

| Shot | Effects |
|---|---|
| S01 to S03 | Deep ice ambience: very low filtered noise with slow swells. Occasional ice creaks (pitch-gliding FM groans, band-pass sweeps, long reverb) at 00:05, 00:10, 00:21, 00:27. Faint crystalline ticks for individual bubbles near the lens. At 00:20.5 a soft glassy "sheet" resonance as the fracture plane flashes. HEART barely audible from 00:25.0. |
| S04 | 00:30.5 silence. **00:31.0 the crack**: a sharp broadband transient with a fast descending pitch and a long splintering tail of high clicks running left to right, ice-hall reverb. 00:32 to 00:36 high sizzling shimmer as light enters. 00:35.0 one small water bead: a single sine "bloop" with upward chirp. |
| S05 | Rising wind-like noise; the first hint of open air; swell to white. |
| S06 | Abrupt openness: wide high-altitude wind (band-passed noise, slow gusts), hiss of spindrift, enormous quiet. Distant glacier groan at 00:51. |
| S07 | Close and dry. Each drop: a short pitched tick plus the musical bell (first at 00:59.0). Trickle noise grows from 01:02. |
| S08 | Rushing water (layered band-passed noise with fast modulation, many small sine chirps), growing and spreading in stereo as the braids multiply; wind of flight; distant ice calving thud at 01:10. |
| S09 | Small trickle, melt drips. 01:19.0 a tiny dry tick as the seed touches the pebble. HEART audible in the hold. |
| S10 | Time-lapse wind (fast whooshing swells with each cloud band). Rockfall rumbles (low-passed noise bursts, debris clatter) on 01:24.0, 01:28.0, 01:32.0, each with the drum. |
| S11 | 01:36.0 a deep crack of stone, then a long avalanche roar with gravel hiss, tailing into pouring sand. |
| S12 | Cut to underwater: muffled low roar, bubbling, sand hiss. Above-water rain as a filtered layer. Thunder: lightning flash at 01:44.0, rolling low-passed thunder from 01:44.5. |
| S13 | Per trial: (1) draining trickle; (2) frost crackle, fine high ticks; (3) rain patter and drips; (4) dry wind, a few brittle cracks of drying mud; (5) fire roar and crackle (random impulses through band-pass, low rumble) sweeping left to right; (6) soft ash fall, near silence, low wind. |
| S14 | 02:02.0 a muffled "going under" (low-pass closes over all ambience). Each band: a soft hiss of settling grains with its note. From 02:14.0 only a low earth tone and HEART. |
| S15 | 02:22.0 the husk splits: a small, soft echo of the ice crack (same gesture, one tenth the size). Fine fibrous creaks as root and shoot extend. A tiny glassy ping with each band crossed. 02:33.0 the low-pass opens in one breath: air, light, morning. |
| S16 | Dawn ambience: light breeze, a dew drip, and at 02:36.5 the first birdsong-like chirp of the film (fast sine sweeps), a second voice answering at 02:38.5. Distant slow river. |
| S17 | Time-lapse wind again, but now with leaf rustle (high-passed noise shaped by the wind) rising and falling with each season; a soft wooden creak of growth; river far off. |
| S18 | Real time: wind in a great crown of leaves, evening birds, river. 03:01.5 a gust. The golden line makes a faint rising shimmer, ending on the drum at 03:04.0. |
| S19 | Inside the leaves: close rustle all around, soft pops and whispers as tufts release, wind rising. |
| S20 | Open-air wind of flight, the river far below, leaf sound falling away behind. Air grows colder and thinner (high frequencies roll off). Snow hush from 03:28. |
| S21 | Wind dies to nothing between 03:36 and 03:42. As the points stop, the ice ambience of S01 fades in underneath, with one ice creak at 03:42.0. HEART at 03:43.0 and 03:46.0. Hard cut to silence. |
| S22 | Silence, bell, fade. |

### The four sync points that must be frame-accurate

| | Time | Picture | Sound |
|---|---|---|---|
| ★1 | **00:15.0** | The bubbles coincide into "Produced by Fable 5.5"; the reading light is on the final letters | Peak of the string cluster; the glass run reaches the right speaker |
| ★2 | **00:31.0** | First frame of the crack, after 0.5 s of stillness | Crack transient, after 0.5 s of total silence |
| ★3 | **02:20.0** | The seed's glow turns and begins to swell | The F sharp bell: the theme's fourth note becomes major |
| ★4 | **03:04.0** | The golden ridge line completes on the crown of the tree | F sharp 5 of the full theme, century drum, bell |

Secondary sync points: 00:59.0 (first drop and first bell), 01:36.0 (slab and drum), 02:33.0 (shoot breaks the surface and the filter opens), 03:46.0 (cut to black on pulse and heartbeat).

---

## 7. Colour and look

**Format and lens character.** 2.39:1 with an anamorphic feel throughout: oval bokeh (1 : 1.5, taller than wide); faint horizontal blue streaks on the very brightest points only (sun blade, sun through the crown, lantern); mild barrel distortion (about 1.5%); chromatic aberration of 0.15% of frame width toward the edges; a vignette of about 0.6 stop at the corners, heavier (1 stop) in W1 and W4. Warm halation (#FF7A3A, small radius) around strong highlights. Bloom is soft and wide, with a high threshold so that only light sources and specular water bloom.

**Depth of field.** Macro worlds (W1 close, W3, W4): extremely shallow, focus is a storytelling tool (the two rack focuses). W2 master frame: deep focus, everything sharp, like a large-format landscape plate. S19: shallow, seeds as foreground bokeh.

**Motion.** Real-time shots use a 180-degree shutter look (offline render: accumulate 4 or more sub-frames; live playback may skip this). Time-lapse shots (S08, S10, S17) use a long-shutter look: clouds and water smear into streaks, the land stays sharp. The master frame never moves. Elsewhere, camera moves are slow and eased, never handheld, with the one exception of the 0.5-degree shudder at the crack.

**Grain.** Fine 35 mm-style grain, luminance-weighted (strongest in mid-shadows, almost none in pure white or black), re-seeded every frame from the frame number. Intensity: 0.5 in the prologue and S21 (the dark carries it), 0.3 in Acts I and III, 0.4 in Act II, 0.6 in the near-dark of S14. The grain goes over the title cards as well.

**Grade by act.**

| Section | Grade | Key colours |
|---|---|---|
| Prologue: ICE | Near-monochrome blue-black, crushed but not clipped blacks, highlights cool white. The only warm colour in the frame is the seed's amber, until the sun blade arrives. Low saturation, high local contrast in the bokeh. | #02040A, #06162B, #6FD3E8, amber #FFB347 |
| Act I: WATER | Clean and cold with one warm accent: blue shadows, rose-gold light. Higher contrast, crisp. Saturation moderate. The river is pure silver, never blue. | #0B1630, #5E7FA8, #FF9E7A, #F7D9B0 |
| Act II: STONE | The colour drains: bleach-bypass feel, desaturated earth and slate, slightly lifted blacks in the time-lapse, then progressively darker and browner. The flood is ochre and storm grey; the fire is the only saturated moment (orange, briefly, and it reads as danger because nothing else has colour). S14 ends almost black with a single amber point. | #6B6257, #8C8172, #4A5560, #B08A4F, #1E1B1A, ember #FF6A1F |
| Act III: SEED | Colour returns as an event. S15 warms band by band as the shoot climbs. S16 is the first fresh green in the film and should feel almost startling. S17 and S18 build to full, rich golden hour: warm highlights, deep green-black shadows, soft contrast, glowing air. | #7FB84A, #A9C94F, #E9B44C, #FFB25E, #C4553A, #2E3B1F |
| Coda: WIND | Dusk cools to moonlit blue; warm survives only in the seeds' cores. By the end of S21 the grade is exactly the prologue's again, so that the last frame and the frame at 00:30 are interchangeable. | #1B2440, #050A18, #C9D6E8, amber #FFB347 |
| Credits | Pure black, text #F2EDE4. | |

**Continuity rule for the amber.** #FFB347 is reserved. It appears only on the seed's core, on light that the film equates with it (the sun blade, alpenglow on the summit, the sun in the crown, the golden ridge line, the lantern), and on the final pulse. Fire is deliberately a different, redder orange (#FF6A1F) so that it reads as the amber's rival, not its kin.

---

## 8. Notes for the implementers

- **Three images carry the film and must not be compromised:** the parallax credit (S02), the cross-section descent and climb (S14 to S15), and the master-frame recognition (S17 to S18, including the P0 match between skyline and crown). If time runs short, protect these.
- **Safe simplifications, in order:** drop the Witness; reduce S13 from six trials to four (keep frost, drought, fire, ash); render S11 as a tighter crop of the S10 setup; simplify S19 to leaves, light shafts and seed grains without a full branch climb.
- **The bookend is exact.** S21 must finish on the same grain positions, camera pose, grade and pulse phase as the end of S03. Build S21's end state by reusing W1, not by imitating it.
- **Everything is a function of `t`.** No frame may depend on the frame before it. Grain positions, deposits, growth, weather and text are all evaluated from the timecode alone, so the film can be scrubbed, played live, or rendered offline frame by frame with identical results.
