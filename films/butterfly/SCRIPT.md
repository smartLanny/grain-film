# 梦蝶 / THE DREAM OF THE BUTTERFLY

> 这是影片的创作规格与引擎契约，保留了早期脚手架和协作分工说明；它不作为逐项实现验收记录。当前运行、最终修改范围与 4K 导出方式见 [README.md](README.md) 和 [制作经验](docs/lessons.md)。文中早期 `../film/` 指同库根目录的 GRAIN 工程。

A short film generated entirely by code. Script, shot plan, title design, audio cue sheet and build notes.

> **Director's amendment (2026-10-03, from the user): no black bars; 18:9 landscape.**
> The film is delivered at **2160x1080 (2:1), full frame, no letterbox**. This overrides every mention below of a 1920x1080 container, a 2.39:1 picture area or 138 px bars.
> - "(% across, % up) of the picture area" now means the full 2:1 frame. Compose for 2:1: it is a little taller than 2.39:1, so check headroom and the scroll compositions.
> - Card positions given in pixels for a 1920x1080 frame convert as x_frac = x / 1920 and y_frac = (y − 138) / 804 from the top; type sizes stay as written (px at 1080 lines).
> - Fields of view quoted "on the 2.39:1 picture area" are now on the full frame.

| | |
|---|---|
| Runtime | **04:00.0** (240.0 s, 7,200 frames at 30 fps) |
| Picture | 1920x1080 container, 2.39:1 picture area (1920x804, black bars 138 px top and bottom) |
| Sound | Stereo, fully synthesized, no dialogue, no voice-over |
| Text | 5 pieces in total: 1 title inscription, 1 diegetic credit, 2 lines of Zhuangzi (the only story cards), 1 end block |
| Worlds | 6: CITY, INTERIOR, SCALE, GRASS, FIELD, PAPER |

---

## 1. 片名、一句话梗概、主题阐述

**片名：** 《梦蝶》 / **THE DREAM OF THE BUTTERFLY**

英文片名建议用 *The Dream of the Butterfly*，不用单一个 *Butterfly*。理由只有一个：英文的 “of” 天生两读，既是“梦见蝴蝶的那个梦”，也是“蝴蝶做的那个梦”。片名自己就说不清是谁在梦，这正是全片要问的那一句。中文“梦蝶”同样两读：“梦见蝶”，或者“梦里的蝶”。（片尾和文件名可简称 Butterfly。）

**一句话梗概：** 一个伏在案上睡着的人，梦见自己是一只蝴蝶；一只合翅睡在草叶上的蝴蝶，梦见自己是一个人。他们各自醒来一次，各自过完一天，直到分不清是谁梦见了谁。

**Logline (EN):** Someone asleep at a desk dreams of being a butterfly; a butterfly asleep on a blade of grass dreams of being that someone. Each wakes once, each lives out one day, and by dusk there is no telling which of them was the dream.

**主题阐述**

庄子写这个梦，只用了两个词就把两种活法分开了：蝴蝶是“栩栩然”，轻、活、自在；醒来的庄周是“蘧蘧然”，实、沉、一惊。这部片子从这两个词进入。今天每个人都认得“蘧蘧然”：凌晨伏在工位上被闹钟惊醒的那一下，地铁里站着睡着、头一点一点往下坠的那几秒，雨里一座天桥上几百把黑伞朝同一个方向低着头。那就是“重”。而“栩栩然”是我们忘了的东西：翅膀第一次打开时的那口气，一滴露水大得像一盏灯，时间宽裕得像慢镜头。那就是“轻”。观众从“重”里认出自己，再被“轻”打动，这是情感的入口。

但庄子没有说“做蝴蝶更好”。他说的是“不知”：不知是周梦为蝶，还是蝶梦为周。所以这部片子在结构上绝不偏向任何一边。它以“人睡着，蝶落下”开场，以“蝶睡着，人的影子走过”收尾；人的世界里，蝴蝶是唯一的颜色，蝴蝶的世界里，人是唯一的墨。蝴蝶的一生也有它的雨，一滴雨对它是一块巨石；人的一天也有它的光，雨停后湿柏油路上的那一片金。谁也不是谁的出口，每一边都是另一边的梦。

全片的视觉核心是一个物理事实：**蝴蝶翅膀的蓝不是颜料，是角度。** 同一片翅，合上是灰黑的，像墨；打开、转过一个角度，才是通体的蓝。好墨也是如此，浓墨在斜光下泛青紫。所以水墨的人间与彩色的蝶界不是两种东西，是同一种“黑”的两个角度。片中每一次从一个世界进入另一个世界，都是一次“转角”：一道虹彩的光带扫过画面，墨成了色，或色成了墨。这就是“周与胡蝶，则必有分矣。此之谓物化”：有分别，却是一物之化。

片子最后轻轻碰了一下死亡。蝴蝶的一生只有人的一天那么长。黄昏，它合翅睡在一根被它压弯的草叶上，一个人的影子走过，画面黑了；再亮起来的时候，是一张白纸，那根草叶直了，上面什么也没有。它是飞走了，是落下了，还是醒成了刚才走过去的那个人，片子不说。“且有大觉，而后知此其大梦也。”这句话写在那张白纸上。压着的东西没有了，草叶弹起来，这就是“大觉”的全部画面。

---

## 2. 故事大纲

全片是“一只翅膀的两次开合”：合（夜，墨）— 开（晨，彩）— 合（雨，墨）— 开（晴，墨与彩相融）— 合（暮）。人的一天和蝴蝶的一生共用同一个白昼：夜、晨、午后的雨、雨后的金色、黄昏。

### 序 · 夜（00:00–00:40）　情绪：沉、静、一口憋着的气

黑。黑慢慢被水化开，化成一幅夜里的长卷：一座大城，画成了水墨山水。高楼是雾里的群峰，窗是留白的点，高架和河是一道淡墨。镜头像展开手卷一样横移，片名“梦蝶”像题款一样在右上角的湿纸上洇出来，又被水冲淡。

镜头停在一扇亮着的窗前。隔着玻璃，一个人伏在案上睡着了，台灯从背后勾出他的轮廓：一个驼着的、沉沉的黑影，肩膀随呼吸一起一伏，四秒一次。整个画面只有墨。

一点蓝从画外飘进来，忽上忽下，落在窗玻璃上。它一落定就合起翅膀，翅的背面是灰墨色的，它也成了墨。然后，随着那个人的一次吸气，它的翅膀慢慢打开，一小片蓝光洇在玻璃上、案上、那个人的肩上。人的呼吸和蝶的开合是同一个节拍，分不清是谁带着谁。

镜头推进翅膀，推到只剩鳞片：一片挨一片，像屋瓦，像一栋楼的窗格，在灯下是全黑的。一阵气流从左到右拂过，鳞片像被风吹过的麦田一样依次翘起又伏下，其中一些没有伏下去，它们立着，接住了光，亮成蓝色，拼成一行字：**Produced by Fable 5.5**。停留几秒。翅膀一振，这些立着的鳞片脱落，成了一团闪烁的鳞粉，飘散在灯光里。其中一粒，落在了睡着的人的肩上。

### 第一幕 · 栩栩然（00:40–01:22）　情绪：轻、新、喜悦，时间变宽

一道虹彩的光带从左到右扫过画面。它扫过的地方，墨变成了颜色：台灯变成了初升的太阳，案沿变成一根横着的草茎，伏案的黑影变成了伏在草茎上的一枚蛹，轮廓一模一样。

蛹壳裂开。蝴蝶挣出来，皱缩的翅膀一点一点撑开、展平，逆光里是半透明的。它第一次振翅，飞进草丛。从它的高度看，草叶是参天的楼群，每一颗露珠是一盏挂着的灯。镜头跟着它在“楼”间穿行，冲出草尖，天地一下子打开。这里的一切都是慢的，蝴蝶的世界像两倍半的慢镜头：轻，就是时间宽裕。

它落在一朵花上，翅膀在阳光下开合，蓝随角度从青转紫；它展开卷着的口器去饮花蜜。这是“自喻适志”，是全片最亮的一段，它完全“不知周也”。

然后它停在一根草叶上，草叶被它压弯。叶尖挂着一颗露珠。镜头推近露珠：里面倒悬着一个极小的世界，是水墨的，雾里的楼群，有一扇亮着的窗。蝴蝶飞走，草叶一弹，露珠被甩落，下坠，碎开——

### 第二幕 · 蘧蘧然（01:22–01:54）　情绪：一惊，然后是认得出的疲惫

——闹钟。那个人猛地抬起头。还是那扇窗，还是墨，但天已经是灰白的黎明。玻璃上蝴蝶停过的地方，只有一滴雨。他坐直，肩膀随着一口长长的呼气塌下来。台灯灭了。他肩上有一粒极小的蓝，他不知道。

接下来是“重”的一天，全是往下的、低着头的动作。一栋楼的立面像一幅立轴，一格亮着的电梯沿着它一层一层往下沉。雨是一笔一笔的墨。天桥上，一条黑伞的河朝同一个方向流，他在其中，认得出他只因为那一粒蓝。地铁车厢里，一排人拉着吊环，随着车一起晃，一起低着头；他站着，头越垂越低，站着睡着了。

### 第三幕 · 雨（01:54–02:24）　情绪：重落进了轻的世界；眩晕；全片的问题

同一个构图：一排蝴蝶合着翅倒挂在一片叶子下面，一起随风晃，像那排拉着吊环的人。合起的翅是墨色的。墨也进了它们的天空：乌云像墨滴进水里一样在天上洇开。雨来了。在蝴蝶的尺度上，每一滴雨都是一块缓缓坠落的玻璃巨石，砸得草叶猛地一沉；一滴雨擦过它的后翅，留下一个缺口。它缩在叶下，合紧翅膀。

一滴雨挂在叶缘，就在它面前。雨滴里倒悬着地铁车厢。第一句字幕的前半句浮现：**不知周之梦为胡蝶与，** 镜头一边推进这滴雨，一边缓缓翻转半圈，雨滴里倒着的世界正了过来，我们已经在车厢里——

车轮一震，那个人第二次惊醒。字幕的后半句接上：**胡蝶之梦为周与？** 这一次我们是从蝴蝶的睡眠里进来的，所以分不清了：是他刚才梦见了蝴蝶，还是蝴蝶此刻正梦见他。他转头看向车窗。窗玻璃上的一滴雨里，倒悬着一片彩色的草地。列车冲出隧道，开上跨河的大桥。远处，云层底下裂开一道金色，这是人间出现的第一种颜色。

### 第四幕 · 物化（02:24–03:12）　情绪：屏息，释放，辽阔

人群沿着地铁出口的台阶往上走，走向顶上那一方亮光，像从蛹里往外挣。到了出口，一把一把黑伞“噗”地撑开。

俯瞰一个巨大的十字路口：上万把黑伞是上万个墨点，分成几股对流。他走到路口正中，停下了。伞流从他两边分开。雨停了。一道阳光的边缘斜着扫过湿柏油路，路面成了金色，每把伞第一次有了长长的影子。他收起伞，那个墨点合成一条线，没有了。他抬起头。

静了一秒。

他身边的一把伞，沿着直径裂开，成了一对翅膀，蓝色从中心涌出来，它飞了起来。然后是它旁边的一把，再旁边的，像一圈涟漪从他脚下向整个路口荡开：上万把黑伞一把接一把化成蝴蝶，升空。伞下的人都还在，没有消失，他们站在原地，一个一个抬起头，身上轻了。蝶群掠过镜头，从楼群的峡谷里向上涌，楼的窗格在斜阳里像鳞片一样一排排闪过虹彩。墨线还在，颜色回来了，从这里开始两种画法合成了一种。

蝶群飞出城，沿着河，飞过一片开满花的原野，朝着落日。城在地平线上，仍是雾里的墨色群峰，灯一盏一盏亮起来。原野的小路上有一个很小的人影，朝同一个方向走，他下了班，走路回家。天暗下去，焦点松开，脚下的花和远处的灯化成了一模一样的光斑，分不出哪些是花，哪些是窗。那只后翅有缺口的蝴蝶离开蝶群，向草丛落下去。

### 尾声 · 暮，与大觉（03:12–04:00）　情绪：安宁，一点点怕，然后是空和亮

一根草叶横过画面。它落上去，草叶弯了。翅膀开合了几次，一次比一次慢，一次比一次小，合上了，成了墨色。虫鸣。它睡了。

草丛里有脚步声走近。一个长长的影子从右边扫过来，影子里的一切都是水墨。影子盖住了蝴蝶，盖住了整个画面。黑。无声。

黑被水化开，这一次化成的是一张白纸。纸上只有一笔：那根草叶，已经直了，轻轻颤了两下，停住。上面什么也没有。一声很高、很清的钟。

第二句字幕像墨一样洇进纸里：**且有大觉，而后知此其大梦也。**

片名和出品信息落在同一张纸上。最后，一道光带斜斜扫过纸面，扫到墨迹的地方，那黑色闪了一下蝴蝶的蓝，又回到黑。

---

## 3. Scene worlds

Six worlds and seven shared modules. Every world is a pure function of film time `t` (seconds); all randomness is seeded hashing; no state may depend on the previous frame (ENGINE.md, "Determinism rules").

### 3.0 Shared building blocks

| Name | What it is | Where it appears |
|---|---|---|
| **INK** (`lib/ink.js` + a pass in `post.js`) | The ink-wash renderer: a per-shot post pass that turns the graded frame into ink on xuan paper. Two film-wide knobs, `ink` 0..1 (how much of the image is tone-quantised ink, wet edges, dry brush and bare paper) and `chroma` 0..1 (how much colour survives as wash), plus up to 4 **pools**: screen-space blobs with wet, fibre-wobbled edges inside which the knobs take other values. The butterfly carries a colour pool through the ink world; the walker's shadow carries an ink pool through the colour world. Method in section 7. | Every shot |
| **SHEEN** (transition in `engine.js`/`post.js`) | The film's one crossing device: a soft band, 12% of picture width, tilted 18° from vertical, sweeps the frame; the outgoing shot is on one side, the incoming on the other, and inside the band the image is multiplied by thin-film colours (the THINFILM ramp). It reads as a surface being tilted through its iridescent angle. | S04 (3 s); the cut from S19 into S20 (0.5 s); S24 (as a pass over paper) |
| **THINFILM** (`lib/thinfilm.js`, GLSL) | Structural colour as a function of angle: `thinFilm(cosTheta, thickness)` returns reflectance RGB from a 6-wavelength interference sum (n = 1.56, base thickness 190 nm, so normal incidence peaks at #1F5BFF, shifts through cyan #19C8F0 off-normal, violet #6A3CFF at grazing, and falls to black outside the lobe). | Wings, scales, scale dust, the speck, tower windows in S19, ink sheen in S24 |
| **THE BUTTERFLY** (`lib/butterfly.js`) | A fictional large blue, wingspan 7 cm. Four wings as curved membranes with procedural venation; **upper side** structural blue (THINFILM over melanin black #0D0C0E) with a 3 mm ink-black margin and a white fringe #F4F1EA; **underside** warm ink-grey #8E867A with a row of seven ink dots ringed pale #EDE6D6, drawn so that closed wings already look like brushwork. Body #2A2622 with fine hair (shell fins), clubbed antennae, six simple legs, a proboscis as a spiral curve (`proboscis` 0..1 uncoils). Controls: `open` 0..1 (0 = wings closed over the back, 1 = flat), `flap` phase, `crumple` 1..0 (emergence), `wear` 0..1 (tattered fringe), `notch` 0/1 (a bite out of the right hindwing, acquired in S13; this is how we know our butterfly afterwards), `barePatch` 0/1 (a dull scale-less patch on the left forewing, where the credit's scales were shed). Three levels of detail: hero (S02, S04 to S07, S13, S21, S22), mid (S12 roost), far (two bent quads, used by FLOCK). | S02 to S07, S12, S13, S18 to S22 |
| **BREATH** (`story.breath(t)`) | The one rhythm shared by both protagonists: period 4.0 s (one bar at 60 BPM), inhale 1.6 s (ease-out), exhale 2.4 s (ease-in-out). The sleeper's shoulders rise 1.2% of frame height with it; a resting butterfly's wings open with the inhale and close with the exhale. Peaks are fixed per shot in the shot list. | S02, S06, S08, S11, S14, S21, S22 |
| **FIGURE** (`lib/figure.js`) | Human beings as back-lit silhouettes only: a signed-distance figure built from 11 capsules, drawn flat and filled with ink. Poses (blendable): `asleepAtDesk`, `upright`, `strapHang`, `strapNod`, `climb` (two-key walk cycle seen from behind), `walk` (side), `topDown` (a dot with a shoulder ellipse), `shadow` (the `walk` pose sheared and stretched along the ground). No faces, no hands, never larger than 24% of picture height. | S02, S04, S08 to S11, S14, S16 to S18, S20, S22 |
| **FLOCK** (`lib/flock.js`) | Up to 48,000 instances. Each instance has a ground position, a state `morph` 0..1 (0 = umbrella: a black ink disc 1.1 m wide; 0.5 = disc notched into two lobes; 1 = a far-LOD butterfly, scaled up 6x for legibility from altitude) and a closed-form flight path (rise, then join a curl-noise river toward a goal). Wingbeat 5 to 7 Hz with random phase. | S10, S17 to S20 |
| **DROP** (`lib/drop.js`) | A water drop as a lens: analytic sphere refraction of a **portal texture** (a frame of another shot rendered to a target, shown inverted and barrel-distorted), plus a specular window highlight and a caustic under it. `fill` 0..1 relaxes the distortion to identity as the drop fills the frame, so a push into a drop ends exactly on the portal image. | S07, S08, S13, S14 |
| **Story constants** (`lib/story.js`) | Shot times, BREATH, the reserved palette, the `ink`/`chroma` table of section 7, the hero blade's curve (used by GRASS and PAPER), the sleeper/pupa outline (used by INTERIOR and GRASS), the sun/lamp screen position for the S04 match (62% across, 58% up). | All |

**Reserved colour.** The wing blue #1F5BFF (with its cyan and violet shifts) appears only on wings, on the scales and their dust, on the speck that rides the sleeper's shoulder, and in the last sheen over the ink in S24. No sky, flower or light in the film may use it. Skies are warm, pale or grey; the cornflowers are pinker (#7A6BE0).

### W1. CITY (the human world as an ink landscape)

- **Used in:** S01, S09, S10, S15, S17, S18, S19; its skyline is the horizon layer of FIELD (S20).
- **Scale:** 1 unit = 1 m. Built as a multi-plane scroll: 7 depth planes of tower silhouettes (60 to 420 m tall; setbacks, water tanks, antennae, cranes), each plane separated by mist, which is bare paper. The planes move with slight parallax; the paper texture is anchored to the nearest plane, so a lateral or vertical pan behaves like a handscroll or a hanging scroll being unrolled.
- **Sets (all from one generator):** `scroll` (the night panorama: river, a long bridge with an elevated railway, towers as peaks; S01, S15); `facade` (one tower face as a window grid, 44 floors by 18 bays, with an elevator shaft line; S09); `footbridge` (a pedestrian bridge across frame, traffic below as dry-brush streaks; S10); `crossing` (a scramble crossing seen from 120 m straight above, zebra bands as dry-brush strokes, 300 m across at its widest framing; S17, S18); `canyon` (looking straight up between four tower faces; S19).
- **Ingredients:** tower planes with window grids (cells lit by hash; unlit = mid ink, lit = reserved paper); mist as bare paper; rain as ink strokes (instanced tapered quads, 8° off vertical, three depth layers); umbrellas and crowd from FLOCK and FIGURE; the elevator cell; train as a row of pale window dots; sun edge (S17) as a moving light boundary with wet-asphalt reflection and long cast shadows; window rows that take THINFILM colour in S19.
- **Palette (ink):** paper #EFE8DA, paper in shadow #D9D0BE, and the five tones of ink: 焦 #0D0C0E, 浓 #1E1D21, 重 #3A393D, 淡 #77757A, 清 #B9B5B0. **Palette (colour entering, from S15):** sun gold #FFB84D, wet-asphalt gold #F2A65A, sky slot #F6C177, tower wash (cool) #5C6B8A, window light #FFD9A0.
- **Parameters:** `set`, `scrollX`, `scrollY`, `night` 0..1, `mist` 0..1, `rain` 0..1, `litWindows` 0..1, `elevatorY` (floor), `crowdFlow` 0..1, `stopAt` (time the hero stops), `sunEdge` 0..1 (position of the light boundary across the crossing), `shadowLength`, `morphWave` (centre, start time, speed 30 m/s), `windowSheen` 0..1, `title` 0..1 (the inscription, S01), plus `ink`, `chroma`, `pools`.
- **Reuses from GRAIN:** `lib/particles.js` (rain strokes, mist motes), `lib/line.js` (river and rail curves), `lib/noise.js`, `lib/sky.js` only for the gold sky slot in S15 and S19.

### W2. INTERIOR (three planar stages for the human figure)

- **Used in:** S02, S04 (first half), S08 (set `desk`); S11, S14 (set `train`); S16 (set `stairs`).
- **Scale:** 1 unit = 1 m. Each set is a shallow stage of flat layers, lit from behind, viewed square-on.
- **`desk`:** seen from outside through a window pane. Layers front to back: the glass (reflections of far towers at 6%, raindrops from DROP in S08), the butterfly on the glass at lower left-centre (38% across, 40% up), the window frame, the desk edge as a horizontal line at 34% up, the sleeper (FIGURE `asleepAtDesk`, facing left, the hump of the shoulders at 52% across and 56% up; outline from `story.js`), two stacks of paper, the desk lamp whose shade is a bright disc at 62% across, 58% up, the back wall as a pale wash.
- **`train`:** inside a subway car, side-on. A band of windows across the upper middle with tunnel lights streaming as dry-brush streaks; a row of 7 standing figures (`strapHang`) swaying with `sin` phase-delayed by position; grab handles; in S14 a tighter framing with the glass in the foreground, rain running diagonally across it, one large drop (DROP) at 55% across, 50% up.
- **`stairs`:** from the bottom of a subway exit looking up a flight of 30 steps to a bright rectangle; 14 figures (`climb`) seen from behind; umbrellas open at the top as ink discs (FLOCK instances, `morph` 0).
- **Palette:** as W1 ink. Lamp and exit light are reserved paper with bloom. From S14: the drop holds full colour; from S16: the exit light is gold #FFB84D.
- **Parameters:** `set`, `breath` (from BREATH), `pose` blends, `jolt` (time of the start), `lamp` 0..1, `dawn` 0..1, `sway`, `tunnel` 1..0 (S14: the car leaves the tunnel and daylight floods it), `speck` 0..1 (the blue grain on the left shoulder), `dust` 0..1 (scale dust in the lamplight, S04), `umbrellaPops` (times), plus `ink`, `chroma`, `pools`, `dof`.
- **Reuses from GRAIN:** water drops and running-drop code from `worlds/bed.js`, bokeh skins from `lib/grains.js` for the dust.

### W3. SCALE (the wing in extreme macro)

- **Used in:** S03.
- **Scale:** 1 unit = one scale pitch (45 µm). The frame is 480 units wide: a 21.6 mm field on the left forewing.
- **Ingredients:** 115,000 instanced scales in staggered rows (pitch 1.0 across, 0.88 between rows), each a rounded shingle 1.15 x 2.3 units with 9 longitudinal ridges in the shader, a slight cup, and a random tilt of ±2°; each rotates about its root (`lift` 0..35°); shading is THINFILM over melanin black, so a flat scale under this raking light is black and a lifted one is blue. Three wing veins as raised ridges crossing the field. A warm raking key (the desk lamp) from upper right at 14° elevation. Detached scales become tumbling particles with real two-sided shading (they flash as they turn) and thin-lens bokeh.
- **Palette:** scale black #0D0C0E with a faint brown #2A211C at the roots, lit blue #1F5BFF, cyan edge #19C8F0, violet grazing #6A3CFF, lamp key #FFE2B0, void behind the dust #050507.
- **Parameters:** `wingTilt` (degrees; the breathing of the wing), `gust` 0..1 (position of the ruffle wave, left to right), `hold` 0..1 (how far the letter scales stay lifted: 23°), `shed` 0..1 (letter scales detach), `dustDrift`, `focusDistance`, `aperture`.
- **Reuses from GRAIN:** `titles.sampleTextPoints` (the text mask), `lib/particles.js`, bokeh from `lib/grains.js`, the ice world's thin-lens grain bokeh (`worlds/ice.js`).

### W4. GRASS (the meadow at a butterfly's eye level)

- **Used in:** S04 (second half) to S07, S12, S13, S21, S22.
- **Scale:** 1 unit = 1 cm. Macro, shallow depth of field. A patch 3 m across, populated densely only inside the view.
- **Ingredients:** grass blades as instanced curved ribbons 15 to 60 cm tall with a midrib, back-lit translucency and a waxy sheen; **the hero blade** (curve from `story.js`: 34 cm long, bending to a 38° bow under 0.5 g at its tip); clover, buttercups and daisies as instanced petals; **the hero flower** (a buttercup 3 cm across, S06); dew (DROP instances along blade edges, 1.5 to 6 mm, the large one at the hero blade's tip); the pupa (jade #7FC8A0 shell with gold points, girdled on top of a near-horizontal stem, its outline equal to the sleeper's; `split` 0..1, then an empty translucent case); a broad dock leaf for the roost (S12, S13) with 7 mid-LOD butterflies hanging beneath; rain at this scale (slow glass spheres 4 to 7 mm, each a DROP, with crown splashes and a blade that whips down when struck); **ink clouds** (a sky layer in which black wash unfurls like ink in water: domain-warped noise advected along curl flow, thresholded with a wet edge); the walker's shadow (FIGURE `shadow` projected on the grass, carrying an ink pool); a **backplate**: FIELD rendered soft behind everything (same approach as GRAIN's `createBackplate`), its lights and flowers arriving as oval bokeh.
- **Palette, dawn:** sky #F7C99A to #9CC7E8, sun #FFE2B0, grass lit #A9D65C, grass shadow #2F4A1E, dew #F2FBFF, buttercup #FFD23F, clover #E78AC3, daisy #FFF7E8, cornflower #7A6BE0. **Rain:** sky #A7B4BE, ink cloud #1E1D21, wet leaf #3E6B3A. **Dusk:** sky #2A2F55, horizon #E0785A, grass #3F5A2A, bokeh #FFD9A0.
- **Parameters:** `timeOfDay`, `sunElevation`, `sunAzimuth`, `wind`, `dew` 0..1, `pupaSplit`, `emerge` 0..1 (drives the butterfly's `crumple`), `inkCloud` 0..1, `rain` 0..1, `rainSlowMo` (time scale, 0.25), `strike` (times and blades), `bladeLoad` (grams on the hero blade; the bow follows it with a damped spring written in closed form), `shadowX` (position of the walker's shadow), `portal` (shot id and time for DROP), `focusDistance`, `aperture`, plus `ink`, `chroma`, `pools`.
- **Reuses from GRAIN:** `worlds/meadow.js` grass blades (fixing the dithering noted in REVIEW item 6: alpha-to-coverage, jittered rows), `worlds/bed.js` macro lighting, depth of field, raindrops, ripples and the seedling's leaf shader, `lib/grains.js` bokeh and tuft skins (pollen, dandelion fluff in the air), `lib/sky.js`.

### W5. FIELD (the wide meadow, the migration, the merged look)

- **Used in:** S20; as the backplate of GRASS; as the portal image in the train-window drop (S14).
- **Scale:** 1 unit = 100 m (GRAIN's W2 convention). Camera flies; the only free-flying wide shot in the film.
- **Ingredients:** GRAIN's landscape at its year-10,000 state (green valley floor, the low rounded mountain, the mature river) from `createLandscape`; the meadow grass; **the tree** from `lib/tree.js` with the crown clip softened as REVIEW item 7 asks (it is only a tree here); a flower field (220,000 instanced sprites in drifts of buttercup, clover and daisy, soft discs at distance); a footpath; the walker (FIGURE `walk`, 1.7 m, with the speck); FLOCK as a river of 40,000 butterflies 6 to 40 m above the ground, flowing west; on the northern horizon the CITY skyline as three ink planes in mist, its windows lighting one by one at dusk; sky from `lib/sky.js` with a low western sun, shafts under cloud; night bokeh.
- **Palette, golden hour:** sky top #1B2440, sky mid #C4553A, horizon #FFB25E, sun #FFB84D, grass lit #E9B44C, grass shadow #2E3B1F, river #FFD08A, city ink #3A393D on mist #D9D0BE, city lights #FFD9A0. **Dusk:** sky #2A2F55, horizon #E0785A.
- **Parameters:** `sunElevation` (6° to -3°), `sunAzimuth`, `cloudCover`, `flock` 0..1, `flockGoal`, `walker` 0/1, `walkerX`, `cityLights` 0..1, `flowerDensity`, `focusDistance`, `aperture`, plus `ink`, `chroma`.
- **Reuses from GRAIN:** `worlds/valley.js` `createLandscape`, `worlds/meadow.js`, `lib/tree.js`, `lib/sky.js`, `lib/grains.js`.

### W6. PAPER (the blank sheet)

- **Used in:** S23, S24; its paper function is also the substrate of INK in every shot.
- **Ingredients:** xuan paper (long fibres, cloud mottling, a faint laid pattern, raking light with slow drift); a wash layer that can cover the sheet in black and be diluted away from a centre; **the blade stroke** (the hero blade's curve drawn as one brush stroke: loaded at the root, dry-brush at the tip; `spring` drives its angle); ink text (a glyph mask that soaks outward from stroke centres through fibre noise); the SHEEN pass over ink.
- **Palette:** paper #EFE8DA, paper lit #F7F2E6, ink #0D0C0E, dry-brush grey #77757A, sheen #1F5BFF to #19C8F0.
- **Parameters:** `wash` 1..0, `washCentre`, `spring` (blade angle), `soak[k]` 0..1 per text block, `sheenX` 0..1, `lampOff` 0..1.

---

## 4. Shot list

Timecodes are mm:ss.s, continuous, no gaps. "Lens feel" is the 35 mm-equivalent look. Positions on screen are given as (% across, % up) of the 2.39:1 picture area.

**Camera grammar (a directing rule, not a suggestion).** The two worlds are shot in two languages, and the languages bleed exactly as the renderings do.

- **The human world is a scroll.** Locked frames, or flat lateral and vertical scrolls with the paper moving with the pan; square-on, planar staging; deep focus; no perspective moves. Time runs at 1.0x (1.25x for the crowds of S10 and S17). Weight is the camera refusing to lift.
- **The butterfly's world is flight.** A free, floating camera; parallax; very shallow depth of field; back light. Time runs at 0.4x (a 2.5x slow motion; wingbeat 4 Hz on screen): to be light is to have more time.
- **The bleed.** The butterfly brings shallow focus into S02; S07 is the first planar, locked frame in the colour world; S14 racks focus inside the train; S19 is the first free, rolling camera in the city; S21 and S22, the butterfly's last shots, are a locked planar scroll composition in colour. By the end each world is being filmed in the other's language.

| # | In to Out | Dur | World | Camera | What happens | Key parameters | Transition out |
|---|---|---|---|---|---|---|---|
| **PROLOGUE: NIGHT (ink)** | | | | | | | |
| S01 | 00:00.0 to 00:14.0 | 14.0 | CITY `scroll` | Planar lateral scroll, right to left (the way a handscroll is read), easing to a stop at 00:13.0 with one tower centred. 50 mm feel, deep focus. | Black for 2.0 s. 00:02.0 to 00:06.0 the black is diluted from the centre into a night city painted as an ink landscape: towers as peaks in mist, windows as reserved dots of paper, the river a pale wash. A train of pale dots crosses the bridge 00:07 to 00:13. Title inscription (card T1) 00:05.5 to 00:12.5. The scroll stops on one window brighter than the rest. | `night` 1; `mist` 0.6; `litWindows` 0.12; `ink` 1, `chroma` 0 | Axial cut in to the bright window |
| S02 | 00:14.0 to 00:26.0 | 12.0 | INTERIOR `desk` | Locked, square-on, through the glass. 85 mm feel. Deep focus until 00:20.0; then the butterfly brings depth of field with it: rack to the glass 00:20.0 to 00:21.5, sleeper goes soft. Last second: fast push toward the wing. | The sleeper, a hump of ink against the lamp, breathing: inhale peaks at 00:16.0, 00:20.0, **00:24.0**. 00:17.0 a fleck of blue enters upper left on an erratic path, the only colour in the film so far. 00:20.0 it lands on the glass (38%, 40%) and shuts its wings: grey underside, it is ink. 00:22.4 to 00:24.0 the wings open with the sleeper's inhale; a pool of blue soaks into the glass, the desk edge and the shoulder (pool radius 9% of picture width). 00:24.0 to 00:26.0 exhale: the wings close toward the dark angle while the camera pushes in until the black of the wing fills the frame. | `breath`; butterfly `open` 0 to 1 to 0.1; colour pool r 0 to 0.09 to 0.03; `lamp` 1 | **Match on black**: the closing wing fills the frame and is the scale field of S03 |
| S03 | 00:26.0 to 00:40.0 | 14.0 | SCALE | Slow drift left to right, 40 units over the shot; 100 mm macro feel; the wing plane is tilted, so the top and bottom edges of frame are soft. | Black scales in rows like roof tiles under raking lamplight. 00:28.0 to 00:30.5 **the gust**: a ruffle travels left to right; every scale lifts and falls in 0.5 s, flashing blue at the top of its lift; behind the wave the scales inside the letters stay lifted and lit. The credit is left standing word by word: "Produced" by 00:29.2, "by" 00:29.6, "Fable" 00:30.1, "5.5" 00:30.5 (card C0). 00:30.5 to 00:35.5 it holds; the wing breathes under it (peak **00:32.0**) and the letters run cyan, blue, violet. **00:35.5** the wing beats: the letter scales let go, left to right in 0.4 s, and tumble up at the lens as flashing dust. 00:38.0 to 00:40.0 only dust, as large oval bokeh, on black. | `gust` 0 to 1 (00:28.0 to 00:30.5); `hold` 1; `wingTilt` ±3° on BREATH; `shed` 0 to 1 (00:35.5 to 00:35.9) | **Match on the dust**: the same bokeh, at the same screen positions, hangs in the lamplight of S04 |
| **ACT I: 栩栩然 (colour)** | | | | | | | |
| S04 | 00:40.0 to 00:52.0 | 12.0 | INTERIOR `desk`, then GRASS | Locked: the S02 frame. In GRASS the same lock, 100 mm macro; from 00:46 a 2 mm float. | The S02 frame; the glass is bare; scale dust glitters in the lamplight. 00:41.0 one grain settles on the sleeper's left shoulder and stays lit: **the speck**. 00:41.0 to 00:44.0 **SHEEN** sweeps left to right. Behind it the same picture in colour: the lamp is the rising sun (62%, 58%), the desk edge is a grass stem, the sleeper's hump is a jade pupa with the same outline, the dust is pollen and dew bokeh. **00:44.0** (the next inhale) the pupa splits along its back. 00:44 to 00:48 the butterfly pulls free and hangs beneath the stem. 00:48 to 00:51 its wings fill and flatten, back-lit, translucent. 00:51 to 00:52 the first slow opening: blue. | `dust` 1; `speck` 0 to 1; SHEEN 00:41.0 to 00:44.0; `pupaSplit` 0 to 1; `emerge` 0 to 1; `ink` 1 to 0, `chroma` 0 to 1 across the band | Cut on the first wingbeat |
| S05 | 00:52.0 to 01:03.0 | 11.0 | GRASS | Free: follows 18 cm behind and a little below the butterfly on a weaving path between the blades; 24 mm feel; 35 cm/s; bobs 1.5 cm with each beat. At 01:00 it breaks out through the grass tops and tilts up. | First flight. From here grass blades are towers and every dew drop is a hanging lamp; dandelion fluff drifts through the shafts; two other butterflies cross. 01:00 to 01:03 out above the grass: sun, flowers to the horizon, the valley (backplate 60% sharp). | wingbeat 4 Hz; `dew` 1; `wind` 0.2; `shutter` 0.8 | Cut on the rise |
| S06 | 01:03.0 to 01:13.0 | 10.0 | GRASS | Slow 40° orbit around the hero flower at 14 cm; 100 mm macro; focus on the near wing. | The showpiece close-up. It lands on a buttercup at 01:03.5. Wings open and close on BREATH (open at 01:05.0, 01:09.0, 01:13.0); as the camera orbits the blue runs from cyan through blue to violet and, at the dark angle, to ink black. 01:06 to 01:08 the proboscis uncoils and probes. Sun through the wings; pollen in the air. | `open` on BREATH; `proboscis` 0 to 1; `sunElevation` 14° | Hard cut |
| S07 | 01:13.0 to 01:22.0 | 9.0 | GRASS | Locked, side-on, planar, on the hero blade (the first scroll composition in the colour world). 01:15.0 to 01:20.5 push toward the drop at the blade's tip: it grows from 10% to 55% of picture height. Then tilt down with the falling drop. | The butterfly rests mid-blade; the blade bows 38° under it. Rack focus to the dew drop, 01:14.5. Inside the drop, upside down and very small: a city in ink, towers in mist, one window brighter than the rest (the first ink in the colour world). 01:20.5 the butterfly leaves; **the blade springs up** and flings the drop. 01:20.9 to 01:22.0 the drop falls in slow motion and strikes a lower leaf at exactly **01:22.0**. | `bladeLoad` 0.5 g to 0; `portal` S01 at t = 10; DROP `fill` 0 to 0.55 | **Cut on the impact**, 2 frames of white, into the alarm |
| **ACT II: 蘧蘧然 (ink)** | | | | | | | |
| S08 | 01:22.0 to 01:30.0 | 8.0 | INTERIOR `desk` | Locked, the S02 frame exactly. Deep focus again. | **01:22.0** the head snaps up (4 frames, slight overshoot). Alarm beeps at 01:22.0, 22.5, 23.0, 23.5. Grey dawn in the window. On the glass where the butterfly sat there is one raindrop; at 01:25 it starts to run. 01:24 to 01:27 the figure comes upright and the shoulders drop through one long exhale. The speck is on the left shoulder. 01:28.0 the lamp goes off; the room is flat grey; rain begins outside. | `jolt` 82.0; `dawn` 1; `lamp` 1 to 0 at 01:28.0; `speck` 1 (pool r 0.012); `ink` 1, `chroma` 0 | Hard cut |
| S09 | 01:30.0 to 01:38.0 | 8.0 | CITY `facade` | Vertical scroll down, 44 floors in 7 s, the paper moving with it; planar. | A tower face as a hanging scroll. One lit elevator cell with a tiny standing figure holds at mid-frame while the window grid streams upward past it; neighbouring towers slip by in parallax; rain as ink strokes. The street arrives at 01:37: umbrellas. | `elevatorY` 44 to 0; `rain` 0.7 | Hard cut |
| S10 | 01:38.0 to 01:46.0 | 8.0 | CITY `footbridge` | Lateral scroll right to left at walking pace, hero held at 42% across; planar. | Sixty black umbrellas cross a footbridge in the same direction, bowed into the rain, almost in step. Traffic below as dry-brush streaks. One blue speck under one rim. | `rain` 1; `crowdFlow` 1; time 1.25x | Hard cut |
| S11 | 01:46.0 to 01:54.0 | 8.0 | INTERIOR `train` | Locked, side-on, planar. | Seven figures hang from the rail, heads bowed, swaying in a travelling wave (period 2 s). Tunnel lights streak the windows. The hero, third from the right: the head sinks, 01:49 to 01:53; asleep on their feet. At 01:53.5 all seven lean left together. | `sway` 1; `pose` strapHang to strapNod; `tunnel` 1 | **Match cut on silhouette** at 01:54.0 |
| **ACT III: RAIN (ink enters colour; the question)** | | | | | | | |
| S12 | 01:54.0 to 02:01.0 | 7.0 | GRASS | Locked, planar: the train composition. | A dock leaf lies across the top of frame where the grab rail was. Seven butterflies hang beneath it at the seven figures' positions, wings shut (ink undersides), swaying the same way. In the sky black wash unfurls from the right like ink let into water. The light falls. 01:58.5 and 02:00.0 the first drops come down in slow motion, each a glass sphere holding the meadow upside down; a blade whips under one. | `inkCloud` 0 to 0.7; `rain` 0 to 0.4; `rainSlowMo` 0.25; `ink` 0.2 to 0.35, `chroma` 1 to 0.8; ink pools on the seven | Hard cut |
| S13 | 02:01.0 to 02:09.0 | 8.0 | GRASS | Medium close on our butterfly under the leaf edge, 100 mm macro. From 02:04.5 a push into the hanging drop with a **180° roll** (a slow corkscrew, the only one in the film), complete at 02:09.0. | To a butterfly each raindrop is a boulder. 02:02.0 one clips the right hindwing: **the notch**. The wings clamp shut. A drop gathers on the leaf edge 6 cm in front of it and hangs. Inside it, upside down: the subway car, in ink. 02:03.0 card L1, first clause. As the camera pushes in and turns over, the world in the drop comes upright and fills the frame. | `rain` 0.8; `notch` 0 to 1 at 02:02.0; `portal` S14 at 02:09.0; DROP `fill` 0 to 1 (02:04.5 to 02:09.0); `ink` 0.35 | **Invisible cut**: with `fill` = 1 the last frame is the first frame of S14 |
| S14 | 02:09.0 to 02:18.0 | 9.0 | INTERIOR `train` | Locked, closer; the window glass is the foreground plane. Shallow focus has arrived in the ink world: focus on the hero, then a rack to the drop on the glass, 02:13.0 to 02:14.0. | **02:09.0** a rail joint; the car jolts; the hero's head snaps up, the second waking. 02:10.0 card L1, second clause. 02:11.0 to 02:12.5 the head turns to the window. 02:12.0 the train leaves the tunnel: grey daylight, rain running diagonally across the glass. In the largest drop, upside down and in full colour: a flowering meadow at golden hour. 02:16.0 the drop lets go and runs down the glass. | `jolt` 129.0; `tunnel` 1 to 0 (02:12.0 to 02:12.6); `portal` S20 at 03:00; `ink` 1, `chroma` 0.15 (1 inside the drop) | Hard cut |
| S15 | 02:18.0 to 02:24.0 | 6.0 | CITY `scroll` | Locked wide, deep focus. | The train, a row of pale dots, crosses the long bridge. The rain thins. **02:22.0** a slit of gold opens under the cloud at the horizon and lays one gold stroke along the river: the first colour of the human world's own. | `rain` 0.6 to 0.2; `night` 0; `mist` 0.5; `chroma` 0 to 0.3; `ink` 0.9 | Hard cut |
| **ACT IV: 物化 (the two renderings become one)** | | | | | | | |
| S16 | 02:24.0 to 02:32.0 | 8.0 | INTERIOR `stairs` | Locked, low, looking up the flight. | Figures climb toward a rectangle of gold light, as out of a pupa. Drips at the exit. At the top the umbrellas open, each a line fanning into a black disc in 5 frames: 02:28.0, 02:29.0, 02:30.0, and at **02:31.0** the hero's, with the speck, at (50%, 72%). | `umbrellaPops` [148, 149, 150, 151]; `ink` 0.8, `chroma` 0.45 | **Match cut on the open umbrella**: side-on disc to top-down disc, same position and size |
| S17 | 02:32.0 to 02:42.0 | 10.0 | CITY `crossing` | Straight down from 120 m; slow push from 120 m to 60 m of frame width, centred on the hero; no rotation. | A scramble crossing. Nine thousand umbrellas in four counter-flowing streams; the zebra bands are dry-brush strokes. 02:35.0 the hero stops in the middle; the streams part around them. 02:36.0 to 02:37.5 the rain strokes cease. 02:36.0 to 02:40.0 the edge of the sun crosses the asphalt from lower left: behind it the wet road is gold and every umbrella casts a long shadow, the first cast shadows in the ink world. 02:38.5 the hero's umbrella folds: disc, line, gone. 02:40.0 a paler dot: the face tipped up. 02:41.0 to 02:42.0 the nearest umbrellas slow. Nothing moves that does not have to. | `stopAt` 155.0; `rain` 1 to 0; `sunEdge` 0 to 1; `shadowLength` 6 m; time 1.25x easing to 1.0x by 02:40; `ink` 0.75, `chroma` 0.5 to 0.6 | Continuous take |
| S18 | 02:42.0 to 02:50.0 | 8.0 | CITY `crossing` | Straight down; pull back from 60 m to 300 m of frame width, 02:42.0 to 02:48.0, easing out. | **02:42.0** the umbrella 1.6 m to the hero's right splits along its diameter into two wings; blue floods out from the centre; it lifts. Then its neighbours: a ring spreads from the hero at 30 m/s through forty thousand umbrellas. Each one takes 0.8 s: notch, lobes and colour, first beat and lift. Under every umbrella the person is still there; 0.6 s after their umbrella leaves they stop and a pale dot tips up. The butterflies rise on a spiral at 9 m/s. 02:48.0 to 02:50.0 they reach the lens: a storm of blue bokeh. | `morphWave` centre = hero, t0 162.0, 30 m/s; `shutter` 1; `ink` 0.7 to 0.55, `chroma` 0.6 to 0.9 | **Match on motion** through the wings |
| S19 | 02:50.0 to 02:58.0 | 8.0 | CITY `canyon` | Street level, straight up; 18 mm feel; a slow 20° roll and a 6 m rise: the first free camera in the human world. | A river of butterflies pours up between four tower faces into a gold sky. As it passes, the window rows flash structural colour floor by floor, 02:51 to 02:55: windows are scales. The towers keep their ink line and take a cool wash; the top floors are gold. | `windowSheen` 0 to 1; `shutter` 1; `ink` 0.55, `chroma` 0.9 | Match on the upward stream, with a 0.5 s SHEEN |
| S20 | 02:58.0 to 03:12.0 | 14.0 | FIELD | Free flight west at 12 m/s, 3 m above the meadow rising to 12 m, down to 2 m at the end; 28 mm feel. Focus pull to 1 m at 03:08.0 to 03:10.5. Final tilt down into the grass. | The migration. Forty thousand butterflies in a river above and ahead, into the low sun; the flower field, the gold river, the tree; on the right horizon the city as ink peaks in mist. 03:01 to 03:06 a small ink figure on the footpath below, walking the same way (the speck on its shoulder). 03:05 to 03:10 the sun goes (6° to -2°) and the city's windows light one by one. 03:08.0 to 03:10.5 focus comes close: flowers below and windows beyond turn into the same oval discs. 03:10.0 our butterfly, notched, comes into focus by the lens and peels away downward. | `flock` 1; `walker` 1; `sunElevation` 6 to -2; `cityLights` 0 to 1; `shutter` 0.8; `ink` 0.5 to 0.45, `chroma` 1 | Cut on the descent |
| **CODA: DUSK, AND THE GREAT AWAKENING** | | | | | | | |
| S21 | 03:12.0 to 03:22.0 | 10.0 | GRASS | Locked, side-on, planar; 100 mm macro; the hero blade from lower left to upper right of centre, the butterfly's place at (56%, 54%). | 03:13.5 it alights. The blade bows 38° and bounces twice. Worn fringe, the notch, a dull bare patch on the forewing. Two wing-breaths: fully open at 03:15.0, 60% at 03:19.5. Between them the wings are shut and it is ink. Behind, flowers and city lights are one field of discs. | `bladeLoad` 0 to 0.5 g at 195.5; `open` peaks as listed; `wear` 1; ink pool on the butterfly when shut; `ink` 0.5, `chroma` 0.9 | Continuous take |
| S22 | 03:22.0 to 03:36.0 | 14.0 | GRASS | The same locked frame. | Wing-breaths at 03:24.5 (30%) and 03:30.0 (10%, a tremor), then none. The last light goes. 03:26 footsteps in grass, from the right. 03:29.0 the discs at the right edge go out one by one. 03:30.0 the shadow of a head enters at the right and travels left at 22% of picture width per second; everything inside it is ink. 03:31.5 it lies over the butterfly: an ink butterfly on an ink stroke. 03:32.0 to 03:34.0 the body of the shadow covers the frame. **03:34.0** black and silence. | `shadowX` 1.05 to -0.3; ink pool = the shadow (`ink` 1, `chroma` 0, wet edge); `sunElevation` -2 to -5 | Continuous: the black is the black of S23 |
| S23 | 03:36.0 to 03:50.0 | 14.0 | PAPER | Locked: the framing of S21. | Black until 03:37.5. Then the black is diluted outward from where the butterfly slept (56%, 54%) and by **03:40.5** it is a sheet of white paper. One brush stroke is left on it: the blade, upright, bare. It was swinging when the wash cleared (+14° at 03:38.6, -7° at 03:39.2, +3° at 03:39.8) and comes to rest at 03:40.5. 03:42.5 card L2 soaks into the paper; it lightens away 03:48.5 to 03:49.5. | `wash` 1 to 0 (03:37.5 to 03:40.5); `spring` as listed; `soak[L2]` | Continuous |
| S24 | 03:50.0 to 04:00.0 | 10.0 | PAPER | Locked. | The end title and credits soak in beside the blade (card E). **03:53.0** to 03:54.5 a SHEEN band crosses the sheet: where it passes over ink, the blade and then the characters, the black flashes wing blue and returns to black. 03:58.5 to 04:00.0 the paper dims to black. | `soak[E]`; `sheenX` 0 to 1; `lampOff` 0 to 1 | End |

**Duration check:** 14 + 12 + 14 + 12 + 11 + 10 + 9 + 8 + 8 + 8 + 8 + 7 + 8 + 9 + 6 + 8 + 10 + 8 + 8 + 14 + 10 + 14 + 14 + 10 = 240.0 s.

### Crossings, morphs and match cuts

| # | Where | Type | What matches |
|---|---|---|---|
| X1 | S02 to S03, 00:26.0 | Match on black | The wing closing to its dark angle fills the frame; that black is the unlit scale field. Ink black and wing black are declared to be one material in the film's first crossing. |
| X2 | S03 to S04, 00:40.0 | Match on bokeh | The shed scales as oval discs keep their screen positions and become dust in the lamplight. |
| X3 | inside S04, 00:41.0 to 00:44.0 | SHEEN sweep, triple match | Lamp = sun at (62%, 58%). Desk edge = grass stem at 34% up. Sleeper's hump = pupa, one outline from `story.js`. Dust = pollen and dew bokeh. The pupa splits on the sleeper's next inhale. |
| X4 | S07 to S08, 01:22.0 | Portal, then cut on impact | The ink city hangs upside down in a dew drop; the drop's impact is the alarm's first beep and the sleeper's jolt, on one frame. |
| X5 | S11 to S12, 01:54.0 | Silhouette match | Seven strap-hangers under a rail = seven shut butterflies under a leaf: same positions, same sway, same bowed weight. |
| X6 | S13 to S14, 02:09.0 | Portal with corkscrew, invisible cut | The camera turns over as it enters the raindrop, so the inverted car comes upright; the card stays on screen while the world under it changes. |
| X7 | inside S14, 02:13.0 | Portal, mirrored | The reverse of X4: a raindrop on the train window holds the meadow, upside down, in colour. Each world is a small inverted image inside a drop of the other. |
| X8 | S16 to S17, 02:32.0 | Shape match | An umbrella opening seen from the side becomes the same umbrella as a disc from above. |
| X9 | S18, 02:42.0 onward | Morph, forty thousand times | Umbrella disc to notched disc to a pair of wings. Closed, the wing was ink; open, it is colour. |
| X10 | S18 to S19 to S20 | Match on motion | Rising wings carry two cuts; the second has a half-second SHEEN. |
| X11 | inside S20, 03:08.0 | Shared bokeh | Flowers and lit windows are drawn from one set of discs once focus is pulled; neither can be told from the other. |
| X12 | S22 to S23, 03:34.0 to 03:40.5 | Shadow to black to paper | The human's shadow is the last ink wash; diluted, it leaves the page the whole film was painted on. |

### Motifs, at a glance

| Motif | Occurrences |
|---|---|
| **One black, two angles** | Wing shut = ink, wing open = colour (S02, S06, S12, S21); scales (S03); SHEEN (S04, S19, S24); umbrellas (S18); the ink of the end title (S24) |
| **Each carries its world with it** | The butterfly's pool of colour and shallow focus in the ink room (S02); the speck on the shoulder (S04 to S20); the walker's shadow as a pool of ink in the meadow (S22) |
| **The breath** (4.0 s) | Sleeper (S02, S08, S11), wings (S02, S03, S06, S21, S22, slowing 4.0, 4.5, 5.0, 5.5 s and stopping) |
| **Bowed, then sprung** | The sleeper over the desk; the strap-hangers; the umbrellas into the rain; the blade under the butterfly (S07, S21); a blade struck by rain (S12); the blade springing up when the weight leaves (S07, planted; S23, paid) |
| **Drops are doors** | Dew holding the city (S07); the same spot on the glass, now a raindrop (S08); the raindrop holding the train (S13); the raindrop holding the meadow (S14) |
| **The multitude of small tiles** | Windows (S01, S09), scales (S03), umbrellas (S10, S17), wings (S18 to S20), flowers and lights (S20 to S22) |
| **Grass is towers, towers are peaks** | S01 and S15 (towers as mountains), S05 (blades as towers), S19 (towers as a canyon of scales), S20 (the city as a range on the horizon) |
| **Waking** | The pupa splits (00:44.0); the alarm (01:22.0); the rail joint (02:09.0); the white paper (03:40.5) |
| **Bookends** | S02: a human asleep, a butterfly arrives, colour soaks into ink. S22: a butterfly asleep, a human passes, ink soaks into colour. |

---

## 5. Title cards

The film contains five pieces of text and no others: the title inscription (T1), the production credit (C0), the two lines of Zhuangzi (L1, L2), and one end block (E). There are no explanatory cards.

**Typography.** Chinese: the engine's `zh` stack (Songti SC, STSong, Source Han Serif, serif), regular weight. English: the `en` stack (resolves to Hoefler Text on the render machine), regular, sentence case unless stated. Chinese above English, always. Over picture (L1): #F2EDE4 at 92% with a soft shadow (blur 12 px, black at 55%), composited before grain. On paper (L2, E): ink #0D0C0E, no shadow, drawn through the PAPER world's soak so that the characters have wet edges and take the paper's fibre.

| Card | Timecode | Text (exact) | Placement | How it appears and disappears |
|---|---|---|---|---|
| **T1. Title inscription** | Begins 00:05.5; full 00:07.0 to 00:11.0; gone by 00:12.5 | `梦` over `蝶` (stacked, one character per line), then `THE DREAM OF THE BUTTERFLY` | Upper right, like the inscription on a scroll: block right-aligned at 93% across; top of 梦 at 12% from the top of the picture. Characters 104 px with an 18 px gap. English 20 px, uppercase, letter-spacing 0.42 em, 30 px below, right-aligned. | **Reserved paper, by resist.** In a night scene the title cannot be ink on ink, so it is the opposite: the dark wash draws back from the strokes as if they had been written in alum (the traditional resist), leaving the characters as bare, pale paper #EFE8DA, exactly as the lit windows are. The wash retreats outward from the stroke centres through fibre noise, 00:05.5 to 00:07.0; it floods back over them 00:11.0 to 00:12.5. The inscription scrolls with the paper. Nothing fades. |
| **C0. Production credit** | First word standing 00:29.2; complete 00:30.5; legible 00:30.5 to 00:35.5 (5.0 s); brightest 00:32.0; shed 00:35.5 to 00:35.9 | `Produced by Fable 5.5` (exactly this string, one line, English only; its bilingual form is in the end block) | Centre of frame. Text width 58% of picture width (1,114 px); cap height about 84 px, which is 24 rows of scales; semibold, letter-spacing 0.10 em, so every stroke is at least 3 scales wide. | **Diegetic, made of wing scales.** A scale belongs to the text if its root falls inside the rasterised glyphs (about 9,500 scales). Before the gust all 115,000 scales lie flat and are black under the raking light. The ruffle wave lifts every scale in turn; the text scales alone stay lifted at 23° and, at that angle, return the lamp as blue. Their brightness is the THINFILM response to their angle and nothing else: there is no opacity, no emissive term, no overlay. They leave physically too: at 00:35.5 the wing beats and they detach, left to right, and tumble toward the lens as dust, flashing as they turn. One of them becomes the speck on the sleeper's shoulder. |
| **L1. The question** | First clause in 02:03.0; second clause in 02:10.0; all out 02:15.3 to 02:16.5 | `不知周之梦为胡蝶与，` then `胡蝶之梦为周与？` over `There is no knowing whether Zhou dreamed he was a butterfly,` then `or a butterfly is dreaming it is Zhou.` | Centred. Chinese 44 px, letter-spacing 0.14 em, baseline y = 800 px. English 22 px, letter-spacing 0.06 em, baseline y = 842 px (1920x1080 frame; picture spans y = 138 to 942). The whole line is laid out once so that nothing shifts when the second clause arrives. | Two beats across a crossing. The first clause (both languages) fades in over the butterfly sheltering from the rain: 1.2 s, with a 6 px rise. It stays on screen, unmoved, through the corkscrew into the raindrop and the invisible cut at 02:09.0. One second after the human jolts awake the second clause fades in on the same lines (1.2 s, no rise). The words about Zhou dreaming arrive over the butterfly; the words about the butterfly dreaming arrive over the human; the sentence is the only thing that does not change when the world does. |
| **L2. The great awakening** | In 03:42.5 to 03:44.0; out 03:48.5 to 03:49.5 | `且有大觉，而后知此其大梦也。` over `And there is a great awakening; only then do we know that this was the great dream.` | On the paper, right of the blade: block centred at 64% across (x = 1,229 px). Chinese 44 px, baseline y = 520 px. English 22 px, baseline y = 562 px. | **Ink soaking into paper.** The glyphs grow outward from their stroke centres through the fibre noise over 1.5 s, darkest first, with a wet edge that dries. It leaves as ink leaves: lightening evenly into the paper. It comes two seconds after the bell, on the blank sheet, the way a colophon comes after a scroll has ended: the text says we know only afterwards, so it is read afterwards. |
| **E. End block** | In 03:50.0 to 03:51.5; sheen 03:53.0 to 03:54.5; out with the paper 03:58.5 to 04:00.0 | Title: `梦` over `蝶`, then `THE DREAM OF THE BUTTERFLY`. Pair 1: `出品　Fable 5.5` over `Produced by Fable 5.5`. Pair 2: `语出《庄子·齐物论》` over `After Zhuangzi, "On the Equality of Things"`. Pair 3: `全片的画面与声音，皆由代码生成。` over `Every frame and every sound was generated in code.` | Title at the inscription position of T1 (right-aligned at 93%, top at 14%), characters 80 px, English 18 px. The three pairs right-aligned at 93%, last baseline at y = 880 px; Chinese 28 px, English 17 px, 44 px between pairs. The blade stands alone in the left third. | Soaks in as L2. The SHEEN band then crosses the page; the ink it passes over (the blade stroke at 03:53.3, the credits, the title last at 03:54.3) flashes #1F5BFF to #19C8F0 for about 0.4 s each and is black again. |

**Translation notes.** (1) Classical 不知 has no subject: it is not "he did not know", which would make the man the knower and tip the balance the film refuses to tip. "There is no knowing" keeps it subjectless. The shift from "dreamed" to "is dreaming" follows the Chinese situation (the speaker has just woken, so the first dream is past and the second, if it is one, is now). (2) 且有大觉 asserts that the awakening exists, not that it will come to us in particular; "And there is" keeps that. 此其大梦 is "this, its great dream": "this was the great dream".

---

## 6. Audio cue sheet

**Global.** Tempo grid 60 BPM throughout (1 beat = 1.0 s; BREATH is one bar of four), so every cue lands on a whole or half second. Stereo, 48 kHz. Integrated loudness -16 LUFS; true peak at or below -1.5 dBFS; loudness range 14 to 16 LU.

**Two lessons from GRAIN, as rules.** (1) *Small speakers:* in every passage below -24 LUFS short-term (M1, M2, M9, M10) at least 70% of the energy sits above 150 Hz. No cue may rest on a sub tone alone; the lowest sustained fundamental in those passages is A3 (220 Hz). (2) *Headroom:* nothing before 02:42.0 exceeds -20 LUFS short-term, and 02:41.0 to 02:42.0 is the quietest second of Act IV. The peak of the film is 02:46 to 02:52 at about -9 LUFS short-term.

**One scale, two tonics.** The whole score uses one pentatonic collection, D E F♯ A B. Heard from B it is the minor-coloured yu mode (羽): the human world. Heard from D it is the major-coloured gong mode (宫): the butterfly's. They are the same five notes at two angles, as the wing is.

**One theme, two directions.** Four notes. The butterfly's form rises: **A4, B4, D5, F♯5**. The human's form is the same notes backwards and lower: **F♯4, D4, B3, A3**. Each is the other's retrograde, as the film's ending is its opening reversed. In Act IV they sound together in contrary motion.

**One note withheld.** E is used in no melody, no chord and no bell until 03:40.5, where it sounds alone. At 03:53.0 all five notes sound together for the only time.

**Two rooms.** "Concrete": a 0.9 s dark reverb, for the ink world. "Open air": 3.2 s, bright, for the colour world. In Act IV both run.

### Instruments (all synthesized)

| Name | World | Recipe |
|---|---|---|
| QIN | Human | Karplus-Strong plucked string computed in JS (`dsp.js`): noise burst into a delay line with a one-pole low-pass in the loop (decay 3 to 5 s); pluck position comb at 1/7; body as three resonant peaks (180, 320, 540 Hz); a pitch slide of 1 to 2 semitones after the attack (delay-length glide) and a slow 4.5 Hz wobble on held notes, as on a guqin. Harmonics (pure sines an octave and a twelfth up, 6 s decay) for the dusk. Range A3 to F♯5; a lower octave is doubled only above -20 LUFS. |
| FELT | Human | Soft additive piano: 8 slightly inharmonic partials, low-passed at 1.2 kHz, 3 s decay. Chords of Bm, G, D, F♯m only (none contains E). |
| XIAO | Butterfly | Breath flute: sine plus weak 2nd and 3rd partials, a band of breath noise centred on the pitch, 80 ms attack, vibrato 5 Hz entering after 0.4 s; ornaments are flutter-tongued (11 Hz tremolo, the wing). Range A4 to B6. |
| GLASS | Butterfly | FM bell (ratio 1 : 3.5, decaying index), 4 to 6 s. Dew, drops, the final bell. |
| WINGS | Butterfly | Soft paper-like flaps: band-passed noise (1.5 to 4 kHz), 2 ms attack, 40 ms decay, in triplets against the beat (12/8 over the human 4/4). For the flock: a granular cloud of 400 to 3,000 flaps per second, a sound like dry rain or distant applause. |
| STRINGS | Both, from Act III | Seven detuned saws per note through an opening low-pass, 1.5 to 3 s attack (GRAIN's recipe). |
| DRUM | Act IV | Sine swept 110 to 70 Hz in 0.2 s plus a noise thump and a 220 Hz partial for small speakers, open-air reverb. |
| BREATH | Human | Band-passed noise, 400 to 900 Hz: 1.6 s in, 2.4 s out, very quiet. |
| Effects | | Filtered-noise and FM families described per shot. |

### Music structure

| Cue | Time | Mode / harmony | Instrumentation | Dynamics and notes |
|---|---|---|---|---|
| M1 Night | 00:00.0 to 00:26.0 | B yu, bare | A room tone (band noise 180 to 600 Hz) fades in from 00:01. QIN alone, the human theme, one note per bar: F♯4 at 00:04.0, D4 at 00:08.0, B3 at 00:12.0, A3 at 00:16.0, each with a slide. BREATH from 00:14.0. XIAO enters for the first time as the wings open: one note, A4, swelling 00:22.4 to its peak at **00:24.0**. | ppp to p. The xiao's A4 answers the qin's last note, A3, an octave above it: the theme turns round on that note and will come back up as the butterfly's. |
| M2 Scales | 00:26.0 to 00:40.0 | No harmony; a held A4 on XIAO thinning to air | The gust: a run of tiny GLASS ticks panned left to right with the ruffle, 00:28.0 to 00:30.5, over a rising sine shimmer (cluster above 3 kHz). At **00:32.0** a soft STRINGS dyad A4, B4 peaks and falls. **00:35.5** one WINGS flap, loud and close, then a spray of 9,500 grains scattering to both speakers and thinning to nothing by 00:40. | pp, one accent at 00:35.5. |
| M3 Emergence and flight | 00:40.0 to 01:13.0 | D gong; 12/8 over the beat | SHEEN: a slow upward glissando of GLASS partials, 00:41.0 to 00:44.0. XIAO states the butterfly theme: A4 at 00:44.0 (the split), B4 at 00:46.0, D5 at 00:48.0, F♯5 at 00:51.0 (the first opening). From 00:52.0 WINGS in triplets, GLASS arpeggios on D, F♯, A, B, light STRINGS on D and A; XIAO plays freely above. Fullest at 01:05.0 (first opening on the flower). | p to mf. This is the brightest music in the film but not the loudest. |
| M4 The drop | 01:13.0 to 01:22.0 | D, thinning | Everything falls away to one GLASS note per second on F♯6 from 01:15.0, slowing. 01:20.5 the blade's spring: a short upward QIN slide, the human instrument heard in the meadow for the first time. Silence from 01:20.9, 1.1 s, while the drop falls. | mp to nothing. |
| M5 Weight | 01:22.0 to 01:54.0 | B yu; Bm, G, Bm, F♯m, 8 s each | The alarm: four hard FM beeps on B5 at **01:22.0**, 22.5, 23.0, 23.5 (the dew's glass note, made ugly). Then QIN with FELT chords: the human theme, falling, one note at the head of each scene: F♯4 at 01:26.0 (the exhale), D4 at 01:30.0 (the elevator starts down), B3 at 01:38.0 (the footbridge), A3 at 01:46.0 (the train). A walking pulse of muffled steps on every beat from 01:38. In the train the wheels take over the pulse, in two. | p to mp, close and dry. |
| M6 Rain | 01:54.0 to 02:24.0 | Ambiguous: bass alternates B and D every 4 s | XIAO fragments, broken off by the drops; QIN single notes placed like drops. Low STRINGS on B3 and D4 from 02:01. 02:04.5 to 02:09.0, the corkscrew: a reversed swell of STRINGS and noise, rising, cut off by the rail joint at **02:09.0**. Then the train pulse alone under a held D4 and B4. **02:22.0** the gold: FELT and STRINGS place D, F♯, A, B together, softly: the chord that is both Bm7 and D6, heard here for the first time. | pp to mp to p. |
| M7 Gathering | 02:24.0 to 02:42.0 | B and D together | Steps in two (the stairs, the crossing) against WINGS in three, very soft at first. QIN ostinato A3, B3, D4. STRINGS grow but are held under -20 LUFS. Umbrella openings as soft DRUM taps at 02:28.0, 02:29.0, 02:30.0, 02:31.0. At 02:36.0 the rain's noise stops and the mix opens. 02:38.5 the fold: everything drops to one high STRINGS harmonic (F♯6). 02:41.0 to 02:42.0 that note alone, nearly silence. | p to mp, then ppp. The held breath. |
| M8 物化 | 02:42.0 to 02:58.0 | D6 = Bm7, full | **02:42.0** DRUM, and both themes at once, in contrary motion, a note every 2 s: XIAO and high STRINGS rise A4, B4, D5, F♯5 at 02:42.0, 02:44.0, 02:46.0, 02:48.0 while QIN and low STRINGS fall F♯4, D4, B3, A3 at the same instants. DRUM every 2 s. The WINGS cloud swells from 400 to 3,000 grains per second, 02:42 to 02:50, and passes over the listener at 02:48 to 02:50. S19: the window sheen as a rising run of GLASS, 02:51 to 02:55. | ff. The loudest passage of the film; 3 to 4 dB above anything before it. |
| M9 Migration | 02:58.0 to 03:12.0 | D, then B | The instruments exchange themes: QIN plays the rising form (A3, B3, D4, F♯4 at 02:59, 03:01, 03:03, 03:05), XIAO the falling form above it (F♯5, D5, B4, A4 at 03:00, 03:02, 03:04, 03:06). WINGS cloud recedes. STRINGS thin to a held A. | f down to p. |
| M10 Dusk | 03:12.0 to 03:34.0 | B, bare | XIAO, one breathy A4 with each wing-breath: 03:15.0, 03:19.5, 03:24.5, and at 03:30.0 only breath, no pitch. QIN harmonics on F♯5 and B5 between them. From 03:30.0 a low-pass closes over everything as the shadow crosses (cutoff 8 kHz to 200 Hz by 03:33.5). **03:34.0** digital silence. | pp to nothing. |
| M11 Awakening | 03:34.0 to 04:00.0 | The fifth note | Silence, 6.5 s. **03:40.5** GLASS: **E6**, alone, open-air reverb, the first E in the film. Under L2 only air (a band of noise at 2 to 5 kHz at the threshold of hearing). 03:50.0 QIN and XIAO in unison for the first time, two notes: A4, B4. **03:53.0** with the sheen, one soft chord of all five notes (D4, A4, B4, E5, F♯5; FELT and STRINGS). It decays; silence from 03:58.5. | ppp. |

### Sound effects, by shot

| Shot | Effects |
|---|---|
| S01 | Night city from far off: a steady air-conditioning band (220 to 500 Hz), a distant train as a slow filtered-noise swell 00:07 to 00:13 with soft clacks. Wet-paper hiss as the wash dilutes, 00:02 to 00:06. |
| S02 | Close and dry. BREATH. The lamp's faint hum (a 240 Hz and 480 Hz pair). The butterfly's flight: WINGS flaps, tiny, panning from left; a soft tick on the glass at 00:20.0. |
| S03 | The ruffle as a run of ticks and a breath of noise crossing left to right. Shimmer while the letters hold. 00:35.5 the wingbeat and the scatter of grains. |
| S04 | Lamp hum bends upward into morning air during the SHEEN; first bird (fast sine chirps) at 00:44.5. The pupa: a dry papery split at 00:44.0, small creaks; wet, soft unfolding sounds 00:48 to 00:51. |
| S05 | WINGS close to the microphone; grass passing as soft whooshes left and right; dew pings; open air above the grass from 01:00. |
| S06 | Near silence under the music: the flaps of slow wings, an insect hum far off, the minute click of the proboscis at 01:06. |
| S07 | The drop quivers: a glassy wobble. 01:20.5 take-off, and the blade's spring: a short fibrous twang. The falling drop is silent. |
| S08 | **01:22.0** the splash and the first alarm beep on the same sample. Chair creak, cloth, one long exhale 01:24 to 01:27. 01:28.0 the lamp's click; rain begins on the glass (dry, grey, close). |
| S09 | Elevator hum descending in pitch by a fifth across the shot; floor ticks every 0.16 s; rain outside. |
| S10 | Rain on sixty umbrellas (a dense patter, band 1 to 6 kHz); footsteps in near-unison on the beat; traffic hiss below. |
| S11 | Train interior: a low-mid rumble (with a 180 Hz component), wheel clacks in pairs on every beat, the creak of handles; it thins as the hero's head drops. |
| S12 | The cut takes the rumble away: wind in leaves, the first thunder far off (a soft low-passed roll with a 200 Hz body). Each slow drop: a deep downward "bloop" and a leaf slap. |
| S13 | Slow-motion rain all round, each impact distinct. 02:02.0 the strike on the wing: a small tearing tick. The gathering drop hums faintly with the train's rumble, which grows through the corkscrew. |
| S14 | **02:09.0** the rail joint: a hard double clack and a lurch. Rumble, then at 02:12.0 the tunnel's roar opens out into rain and air. 02:16.0 the drop running: a tiny descending slide. |
| S15 | Wide and distant: the train on the bridge, thinning rain, a gull-like cry (two sine sweeps) at 02:20. |
| S16 | Steps on stairs, on the beat, many. Drips. Each umbrella: a soft thump and a whisper of cloth. |
| S17 | The crossing: thousands of steps as a granular wash, rain on umbrellas. 02:36.0 to 02:37.5 the rain stops and its noise falls away; drips; the hero's umbrella folds at 02:38.5 with a click and a rustle. By 02:41 the steps nearest have stopped. |
| S18 | Each transformation is one WINGS flap; the ring becomes a roar. No voices; a great soft exhalation (band noise 300 to 1,200 Hz) rises with the wave. |
| S19 | The cloud passing up between walls with a slap-back echo; GLASS run for the windows. |
| S20 | Flight: air over the microphone, the cloud ahead, the river far below. It thins; evening birds; from 03:06 crickets (sine chirps above 2 kHz). |
| S21 | Crickets, a little wind in the grass. 03:13.5 the landing: no sound but the blade's small creak as it bows. |
| S22 | Crickets. From 03:26.0 footsteps in grass from the right, a human walking pace (0.58 s per step, deliberately off the grid: the only rhythm in the film that is not on it), cloth, a bag strap. The crickets near the path stop as the steps pass. The low-pass closes from 03:30.0. Silence at 03:34.0. |
| S23, S24 | Wet-paper hiss as the wash clears, 03:37.5 to 03:40.5 (very quiet, above 1 kHz). The bell. Air. The chord. |

### Sync points that must be frame-accurate

| | Time | Picture | Sound |
|---|---|---|---|
| ★1 | **00:24.0** | The wings reach fully open on the sleeper's inhale; the pool of blue is at its widest | Peak of the first XIAO note |
| ★2 | **00:35.5** | The wing beats and the letter scales let go | The single loud flap and the scatter |
| ★3 | **01:22.0** | The drop strikes; the cut; the head snaps up | Splash and first alarm beep on one sample, after 1.1 s of silence |
| ★4 | **02:09.0** | The drop fills the frame; the invisible cut; the second jolt | Rail-joint clack cuts off the reversed swell |
| ★5 | **02:42.0** | The first umbrella splits into wings | Drum, and both themes begin together |
| ★6 | **03:34.0** | The shadow has covered the frame: black | Digital silence |
| ★7 | **03:40.5** | The wash has cleared; white paper; the blade comes to rest | The E6 bell |

Secondary sync points: 00:20.0 (landing on the glass, tick), 00:44.0 (the pupa splits on the first note of the butterfly theme), 02:22.0 (the gold slit and the first both-ways chord), 02:28.0 to 02:31.0 (four umbrellas, four taps), 02:38.5 (the fold), 03:53.0 (the sheen and the five-note chord).

---

## 7. Colour and look

The film has two renderings and one material. The design question for every shot is not "which look" but "which angle": how much of the frame is at the ink angle and how much at the colour angle.

### 7.1 The ink-wash method (INK pass)

A post pass per shot, after bloom and grade and before the dissolve/SHEEN mix, title cards and film grain. Inputs: the graded frame, linear depth, and the paper function. It is a model of how ink behaves on absorbent paper, in this order:

1. **Five tones.** Luminance becomes ink density `d = 1 - L^0.8`, then is pulled toward five plateaus, the traditional 墨分五色: 焦 0.95, 浓 0.78, 重 0.55, 淡 0.30, 清 0.12, through smooth steps 0.06 wide. `ink` blends from the continuous image (0) to the plateaus (1).
2. **Mist is bare paper (留白).** Density is multiplied by `1 - mist(depth)`. Distant planes dilute; nothing is ever painted white. Lights, lit windows, the lamp and the sun are places where the paper was left alone.
3. **Wet edge.** Pigment gathers at the boundary of a wash: add `0.35 * |grad(blur(d, 6 px))|` on the dark side of every edge, a rim 2 to 3 px wide.
4. **Bleed.** Sample positions are displaced along a fibre field (anisotropic noise, long axis horizontal) by 3 px on near planes and up to 9 px on far ones, so edges feather along the fibres and distant things look wetter.
5. **Dry brush (飞白).** Elements tagged as strokes (rain, zebra bands, traffic and tunnel streaks, the blade stroke in PAPER) are thresholded against paper tooth stretched along the stroke direction, breaking up toward the stroke's end.
6. **Granulation.** `d *= 0.85 + 0.3 * tooth(x)`.
7. **Colour under line (设色).** The frame's own chroma, flattened with a 4 px edge-preserving blur and scaled by `chroma`, is laid on the paper as a transparent wash; the ink goes over it subtractively: `out = paper * wash * exp(-d * k * inkAbsorb)`, with `inkAbsorb` slightly warm so that dense ink is #0D0C0E and thin ink is a warm grey.
8. **Pools.** Up to four screen-space regions, each a centre, radius, softness and its own `ink`/`chroma`, with an edge wobbled by the fibre field and given a wet rim, so that colour arriving in ink (or ink in colour) looks soaked in, not masked.

**Stability rules.** All paper and fibre fields live in paper space and are static; nothing in the ink pass is re-seeded per frame. In scroll shots the paper offset follows the scroll (`paperScroll`), so the image does not swim under its own texture. This is why the human world's camera only locks or scrolls: the grammar of section 4 is also what keeps the ink from boiling. Film grain is reduced to 0.015 in shots with `ink` above 0.7 (the paper has its own tooth).

### 7.2 The colour method

Linear HDR, lit from behind wherever possible: translucent wings, leaves and petals; rim light on hair and blade edges; dew and rain as lenses; THINFILM for everything iridescent (it is the only saturated blue allowed). Anamorphic character as in GRAIN: oval bokeh 1 : 1.5, bloom soft and wide with a high threshold, warm halation, chromatic aberration 0.6 px at the corners, a 0.5 stop vignette. Depth of field is extreme (aperture 1.2 to 2 in engine units) and is a storytelling tool: the racks at 00:20.0, 01:14.5, 02:13.0 and 03:08.0. Motion: 8-sample accumulation at a 180° shutter, `shutter` 0.8 to 1 for S05 and the flock so that wings smear and never strobe; wingbeats are 4 Hz on screen for the hero, 5 to 7 Hz with random phase for the flock (at 30 fps a real 10 Hz beat would alias).

### 7.3 How the two bleed into each other

| Shot | `ink` | `chroma` | What has crossed over |
|---|---|---|---|
| S01 | 1 | 0 | Nothing. Pure ink. |
| S02 | 1 | 0, pool to 1 | The butterfly: a pool of colour and shallow focus in the ink room |
| S03 | 0 (the scale field is its own black) | 1 | Black that turns blue with angle: the hinge of the film |
| S04 | 1 to 0 across the band | 0 to 1 | SHEEN |
| S05, S06 | 0 | 1 | Nothing. Pure colour. |
| S07 | 0, the drop's image at 1 | 1, the drop's image at 0 | An ink city inside a dew drop; a planar, locked frame |
| S08 to S11 | 1 | 0, speck pool at 1 | The speck on the shoulder |
| S12, S13 | 0.2 to 0.35 | 1 to 0.8 | Ink clouds in the sky; shut wings drawn as ink; the far rain as ink strokes |
| S14 | 1 | 0.15, the drop at 1 | Shallow focus; a colour meadow inside a raindrop |
| S15 | 0.9 | 0 to 0.3 | The human world's own first colour: gold at the horizon |
| S16 | 0.8 | 0.45 | Gold light at the exit |
| S17 | 0.75 | 0.5 to 0.6 | Sunlight, wet gold, cast shadows |
| S18 | 0.7 to 0.55 | 0.6 to 0.9 | The wave |
| S19 | 0.55 | 0.9 | A free camera; windows as scales |
| S20 | 0.5 to 0.45 | 1 | The merged look: ink line, full colour wash, in equal measure |
| S21, S22 | 0.5, shadow pool at 1 | 0.9, shadow pool at 0 | The walker's shadow: a pool of ink in the meadow; a scroll composition |
| S23, S24 | paper | paper | Only paper, one stroke, and one flash of blue in the black |

The curve is the film's structure: ink, colour, ink, and then neither. From S20 on, the picture is a single thing with an ink line and a colour wash, the manner of Chinese painting that has always held both.

### 7.4 Grade by act

| Section | Grade | Key colours |
|---|---|---|
| Prologue (S01, S02) | Paper dimmed for night: the sheet reads #8D887E at its brightest, dense warm blacks, windows and lamp as the only full paper white. The butterfly's pool is the first saturated pixel in the film. | #0D0C0E, #3A393D, #EFE8DA, #1F5BFF |
| S03 | Black on black with a warm raking key; blue only where a scale is lifted. Vignette 1 stop. | #0D0C0E, #FFE2B0, #1F5BFF, #6A3CFF |
| Act I (S04 to S07) | Dawn to mid-morning: warm highlights, clean greens, soft contrast, saturation 1.1, bloom 0.07. It should feel almost too bright after the ink. | #F7C99A, #A9D65C, #FFD23F, #F2FBFF |
| Act II (S08 to S11) | Daylight paper, full #EFE8DA, greys only, contrast 1.08. Flat and weightless in tone, heavy in composition. | the five ink tones |
| Act III (S12 to S15) | The colour world cools and greys under ink cloud (saturation 0.8); the ink world is at its darkest in the tunnel and lifts on the bridge; one stroke of gold. | #A7B4BE, #1E1D21, #3E6B3A, #F6C177 |
| Act IV (S16 to S20) | Golden hour arriving in ink: warm gold over cool ink-blue washes, long shadows, saturation rising to 1.05, bloom 0.06; then dusk. | #FFB84D, #F2A65A, #5C6B8A, #C4553A, #2A2F55 |
| Coda (S21 to S24) | Dusk, low contrast, warm bokeh on blue-violet; then black; then paper at full white with raking light. | #2A2F55, #E0785A, #FFD9A0, #EFE8DA |

**Continuity rules.** (1) The wing blue is reserved, as in 3.0. (2) Pure paper white appears only as paper: mist, lights, the last sheet. (3) The only full blacks in the film are ink, the shut wing, the unlit scales and the shadow of S22: they are the same value, #0D0C0E, everywhere, because they are the same thing. (4) The speck is 2 to 3 px across at every shot scale, always on the left shoulder.

---

## 8. Notes for the implementers

### 8.1 Five images that must not be compromised

1. **S02, the thesis in one frame.** The sleeper and the butterfly breathing on the same four-second beat, and the pool of blue soaking into ink as the wings open. If this frame is right, the film's idea is legible before any text.
2. **S03, the credit.** It must be made by lifted scales and unmade by shed ones. No opacity ramp anywhere (GRAIN's credit faded in; REVIEW item 3).
3. **S13 to S14, the corkscrew into the raindrop**, with the sentence held over the cut.
4. **S17 to S18, the crossing.** The stop, the fold, the second of stillness, and the ring of forty thousand umbrellas opening into wings while the people beneath them remain.
5. **S22 to S23, the shadow, the black, the white, the bare blade.** The blade's spring must match the spring planted in S07.

Beneath all five: the INK pass. If it looks like a filter, the film fails. Judge it on S01 and S10 first.

### 8.2 Safe simplifications, in order

1. S09: lock the frame and let only the elevator cell descend (no vertical scroll).
2. S19: drop the roll; keep the window sheen.
3. S16: replace with 8 more seconds divided between S15 (4 s) and S17 (4 s); the umbrellas then open in S17's first seconds.
4. S05: a straight slow dolly through the blades instead of the weaving follow.
5. S12: five butterflies and five strap-hangers instead of seven (change S11 to match).
6. S20: drop the walker (the footsteps of S22 still explain the shadow).
7. S04: begin with the pupa already split and show only the wings filling.

Do not simplify: the breath sync, the speck, the notch, the blade's spring in S07.

### 8.3 Technical risks and fallbacks

| Risk | Why | Fallback |
|---|---|---|
| The INK pass shimmers or swims | Screen-anchored texture under a moving image | Hold to the camera grammar (lock or scroll, paper moving with the scroll). If it still boils, drop step 4 (bleed) and keep tones, wet edge, granulation and paper. |
| The credit is not legible on scales | Strokes only 3 scales wide; iridescence varies with tilt | In order: raise `hold` to 28° and narrow `wingTilt` to ±1.5°; make text scales "cover scales" with a pale pigment tip (albedo +15%), which is still a property of the scales; enlarge the text to 66% of picture width. Never add a solid text layer. |
| The butterfly looks like a toy in close-up | Body, legs, eyes and hair need modelling the engine is weak at | Keep focus on the wing plane; keep the body back-lit and inside the bokeh; S06 frames the body at most 12% of picture width; give the thorax shell-fin hair and nothing more. |
| The emergence (S04) looks mechanical | Soft-body motion | Play it mostly in silhouette against the sun; drive the wings with `crumple` only (noise displacement fading to zero while the area grows); if needed use simplification 7. |
| Portals (S07, S13, S14) | Need a frame of another shot as a texture | `engine.portal(shotId, t)` renders that shot once into a target at warm-up. If cross-world rendering is not ready: `ink.js` exports `inkImpression(uv, kind)` (a cheap ink city or train interior) and GRASS exports a flat meadow impression; S13 to S14 then uses a 10-frame dissolve at `fill` = 1 instead of the invisible cut. |
| The umbrella-to-butterfly morph reads as a pop | 0.8 s is short | Three states with real geometry (disc, disc with a V notch, two lobes hinged on the diameter), colour arriving from the hinge outward, and the first wingbeat before lift. Cut the count to 16,000 and the widest frame to 180 m before cutting the stages. |
| Strobing flock (GRAIN's S19 was a flurry; REVIEW item 8) | Fast small wings at 30 fps | Random phase, 5 to 7 Hz, `shutter` 1 with 8 samples, minimum sprite size 2 px with area-scaled alpha, nothing within 1.5 m of the lens except in S18's last 2 s, where it is intended and fully blurred. |
| Figures look stiff | Procedural silhouettes | They are never more than 24% of picture height, always back-lit, mostly still. The only moving bodies are small (stairs, crossing, footpath) or a shadow. If `climb` looks wrong, show the stairs figures as a slowly rising row with a bob. |
| The shadow in S22 does not read as a person | A shadow on grass is broken up | Project it on the bokeh backplate as well as the grass; give it a clear head-and-shoulder leading edge and one swinging arm; lead it with the footsteps by 4 s. If it still fails, add the cast shadow of two legs scissoring across the blade at 03:31. |
| Rack-focus and backplate joins (REVIEW items 2, 4) | Low-resolution or mismatched backplates | GRASS renders its FIELD backplate at full resolution with the same sun, cloud and grade state as S20; composite with premultiplied alpha; never leave an uncovered pixel. |
| Score has no headroom at the climax (REVIEW item 10) | Bed too loud before the hit | Enforce the -20 LUFS cap before 02:42.0 in `score.js` with a measured assert; thin the bed for the second before the drum. |
| Quiet passages vanish on laptops (REVIEW item 11) | Sub-heavy beds | No fundamental under 220 Hz in M1, M2, M10, M11; measure and assert 70% of energy above 150 Hz. |

### 8.4 Division of work

Four groups. Each owns its files outright; shared data files (`timeline.js`, `cards.js`, `registry.js`) only merge per-group exports, as in GRAIN.

**Before the groups start (one short pass, Group A's first task):**

- Rename GRAIN's `src/lib/story.js` to `src/lib/valley-story.js` and re-point the imports in `worlds/valley.js`, `worlds/meadow.js`, `worlds/bed.js`, `lib/tree.js` (they need its master frame and ridge profile to keep working). Remove GRAIN's worlds from `registry.js`; `valley.js`, `meadow.js`, `bed.js`, `tree.js`, `grains.js`, `particles.js`, `sky.js`, `line.js` stay as libraries; `ice.js`, `strata.js`, `canopy.js`, `seed.js` and the old `shots/*` are reference only and are deleted at the end.
- Write the new `src/lib/story.js`: `SHOT` (the 24 time ranges of section 4; S04 is two timeline entries, `S04a` INTERIOR 40.0 to 41.0 and `S04b` GRASS 41.0 to 52.0 with `transitionIn: { type: 'sheen', duration: 3 }`), `breath(t)`, `PALETTE`, `LOOK[shot] = { ink, chroma }` from 7.3, `HERO_BLADE`, `SLEEPER_OUTLINE`, `LAMP_SUN = [0.62, 0.58]`, `SPECK`.
- Publish these interfaces as stubs so every group can build against them on day one:
  - `post.ink = { amount, chroma, mist, paperScroll: [x, y], pools: [{ x, y, r, soft, amount, chroma }] }` (per shot, keyframable; worlds may also return it from `world.post`).
  - `transitionIn: { type: 'sheen', duration, angle: 18, width: 0.12, dir: 1 }`.
  - `engine.portal(shotId, t) -> THREE.Texture`.
  - `createButterfly({ lod: 'hero' | 'mid', seed }) -> { group, set({ open, flap, crumple, wear, notch, barePatch, proboscis, lightDir, lightColor, dof }), update(t), dispose() }`.
  - `createFlock({ count, seed }) -> { mesh, set({ morphWave: { centre, t0, speed }, rise, goal, flow, scale }), update(t), dispose() }`.
  - `createFigure({ seed }) -> { mesh, set({ pose: { name: weight }, breath, lean, speck, turn }), dispose() }`.
  - `createDrop({ radius }) -> { mesh, set({ portal, fill, wobble, lightDir }), dispose() }`.
  - Every world file begins as a re-export of `_stub.js`, so the whole timeline renders (black) from the first hour.

| Group | Owns (files) | Builds (shots) | Depends on |
|---|---|---|---|
| **A. LOOK, PAPER, FIELD** | `src/post.js` (INK pass), `src/engine.js` (SHEEN, portal), `src/lib/ink.js`, `src/lib/story.js`, `src/lib/flock.js`, `src/worlds/paper.js`, `src/worlds/field.js`, `src/shots/paper.js`, `src/shots/field.js`, `src/shots/_card.js` | S20, S23, S24; cards L1, L2, E; the T1 resist helper (used by CITY); the FIELD backplate export for GRASS and the S20 portal frame for S14 | GRAIN's `valley.js`, `meadow.js`, `tree.js`, `sky.js` |
| **B. BUTTERFLY and MACRO** | `src/lib/butterfly.js`, `src/lib/thinfilm.js`, `src/lib/drop.js`, `src/worlds/scale.js`, `src/worlds/grass.js`, `src/shots/macro.js` | S03 (with card C0), S04b, S05, S06, S07, S12, S13, S21, S22 | A: INK pass, portal, FIELD backplate. C: FIGURE `shadow` for S22 (stub: a soft wedge) |
| **C. CITY and FIGURES** | `src/lib/figure.js`, `src/worlds/city.js`, `src/worlds/interior.js`, `src/shots/city.js` | S01 (with card T1), S02, S04a, S08, S09, S10, S11, S14, S15, S16, S17, S18, S19 | A: INK pass, FLOCK. B: `createButterfly` (S02), `createDrop` (S08, S14), THINFILM (S19) |
| **D. SCORE** | `src/audio/score.js`, `src/audio/kit.js`, `src/audio/dsp.js`, `src/audio/assets.js` | Section 6 in full | `story.js` times only |

**Agreements between groups (the joins).**

- **X1, X2 (B and C):** the screen position of the butterfly on the glass (38%, 40%), and the dust's screen positions at 00:40.0, come from `story.js`; SCALE's last frame and INTERIOR's first S04a frame share one seeded set of bokeh discs.
- **X3 (B and C):** `SLEEPER_OUTLINE`, `LAMP_SUN` and the 34% line are the only numbers either side may use for the hump, the light and the edge.
- **X5 (B and C):** seven positions and one sway function, in `story.js`.
- **X6 (B and C):** the first frame of S14 is defined by C; B consumes it through `engine.portal('S14', 129.0)`. C must make S14's first frame independent of anything before 129.0.
- **X8, X9 (C and A):** CITY places FLOCK instances; `morph` 0 must look identical to CITY's own umbrellas in S10 and S16.
- **S22 to S23 (B and A):** black is #000 on both sides at 03:34.0 to 03:37.5; the blade's root, length and rest angle come from `HERO_BLADE`; the dilution centre is (56%, 54%).

### 8.5 Checks before calling it finished

- Overlay the last frame of S02's hold and the first frame of S08: identical apart from the butterfly, the dawn and the head.
- Step through 00:28.0 to 00:30.5 and 00:35.5 to 00:36.0 frame by frame: no letter may appear or vanish except by a scale changing angle or leaving.
- Difference the frames either side of 02:09.0: under 2 code values outside the card.
- Render S17 to S20 with `--samples 8` and watch at full speed for strobing; plot mean luminance for single-frame steps.
- Measure the blade: its bow in S07 and S21 and its rest angle in S23 must agree with `HERO_BLADE`.
- Check ★1 to ★7 at sample accuracy against the frames listed in section 6.
- Meter the score: integrated -16 LUFS, range 14 to 16 LU, the -20 LUFS cap before 02:42.0, the 150 Hz rule in M1, M2, M10, M11.
- Read all five pieces of text against section 5, character by character. The credit string is `Produced by Fable 5.5` and nothing else.
- **Everything is a function of `t`.** No frame may depend on the frame before it: the breath, the gust, the ring wave, the blade's spring, the dilution of the wash and every particle are closed-form in time.
