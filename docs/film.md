# 《一粒 / GRAIN》影片与运行

这是一部 240 秒、22 个镜头的程序短片。山体、冰川、河流、石粒、土层、草地和树由 Three.js 几何与着色器生成，配乐和音效由 WebAudio 合成。源码包含最终 18:9 重构图、树下前景草覆盖，以及 65–74 秒融雪、汇流的修订。没有外部实拍或预渲染场景资产。

## 本地播放

需要 Node.js 22.12 或更新版本。离线导出还需要系统 Chrome/Chromium、支持 WebGL2 与 float render target 的实际 GPU，以及 FFmpeg。

```sh
npm ci
npm run check
npm run serve
```

打开终端显示的本地地址，点击画面开始。空格暂停，左右箭头跳转 5 秒，Shift 加箭头跳转 1 秒，逗号/句号暂停时逐帧，f 全屏，h 显示状态，Home 回到开头。`?t=65&hud=1` 从融雪镜头开始，`?shot=S08&hud=1` 循环该镜头。可用 `CHROME_PATH` 指定浏览器，`FFMPEG` 指定 FFmpeg 可执行文件，`ANGLE_BACKEND` 覆盖 Chromium 图形后端；macOS 默认 Metal，其他平台保留 Chromium 默认后端。工具拒绝 SwiftShader/llvmpipe 等软件 WebGL，并可能打开可见窗口再尝试。

## 18:9 预览和导出

内部参考画布始终为 **1920×1080**，`LOOK.letterbox = 2.0` 定义其中 1920×960 的画面。不要把内部高度直接改成 960，否则相机、标题和以 1080p 为基准的后期参数都会受影响。`--scale 2` 捕获 3840×2160，`--crop 3840:1920:0:120` 在第一次视频编码前裁去上下留边，不拉伸，也不裁左右。

一秒有声 1920×960 预览：

```sh
npm run preview
```

完整 4K / 18:9，在 Apple Silicon 上使用硬件 HEVC：

```sh
node tools/render.mjs --scale 2 --samples 8 --crop 3840:1920:0:120 --encoder hevc_videotoolbox --quality 75 --out out/grain-4k.mp4
```

在有硬件 WebGL2、没有 VideoToolbox 的机器上使用 CPU H.264 编码：

```sh
node tools/render.mjs --scale 2 --samples 8 --crop 3840:1920:0:120 --encoder x264 --crf 16 --preset slow --out out/grain-4k-h264.mp4
```

`--start 65 --end 66` 只导出指定的绝对影片时段，保持相同的场景时间与粒子种子。8 个快门样本每帧平均，30 fps；完整片为 7200 帧。VideoToolbox 路径使用 `allow_sw=0`、bf=0、60 帧关键帧间隔并强制每 2 秒关键帧、MP4 视频 timebase 1/15360，HEVC 标记 hvc1；画面为 BT.709 limited，音轨为 48 kHz stereo AAC，目标 320 kbit/s。短片可能存在 AAC 静音编码延尾；精确完整交付流程见 pipeline 文档。

## 声音与交付母版的边界

`src/audio/` 保留全部程序配乐、乐器、环境声和 S08 轻细宽频流水。默认导出会重新渲染整条配乐，并按整条修改后混音计算响度和限幅。它可以听、可以重混，但不等同于既有交付母版的局部 PCM 补丁：该母版沿用原 master gain，只在 65–78 秒替换音效并在边缘平滑，窗外 PCM 按原字节保留。精确流程和基线由 `pipeline/` 提供，普通播放器不自动使用该流程。

音轨单独导出：

```sh
node tools/score.mjs --out out/score.wav
node tools/score.mjs --start 65 --end 78 --solo melt --out out/melt-fx.wav
```

## 单文件播放器

```sh
npm run build
```

输出 `out/film.html`，把影片和 Three.js 打包为离线单文件，不需要 CDN、模型或网络请求。打包保留 legal comments、本项目 MIT、Three.js 与根 `licenses/` 全文许可证，以及仓库 `THIRD_PARTY_NOTICES.md`（存在时）的文本；这些许可不是影片自己的许可证。

这个项目以绝对时间和固定 seed 设计，避免依赖逐帧累计状态；浏览器、GPU、浮点、字体和音频实现仍会影响结果。可以复现流程和叙事，不承诺跨机器逐像素或逐采样相同。Linux CI 只检查源码与打包，不代表已通过真实 GPU 导出。

## 本次源码包的实际验证

在 Apple M5 Max / Chromium ANGLE Metal 上，65–65.5 秒、8 快门样本的有声短渲染实际完成：3840×1920，30 fps，15 帧，HEVC hvc1 / BT.709 limited，VideoToolbox 强制硬件、bf=0；AAC 48 kHz stereo，完整短文件解码通过。短片音轨回读 0.512 秒（视频 0.500 秒），存在编码尾静音，不能把这条短测当作完整母版时长证明。

删除四个未使用 GLSL 助手后，在相同机器的两个新页面比较对应绝对帧 1950 的 4K / 8 samples 输出：8,294,400 像素中 108 像素有差异，最大单通道差 1/255，没有宣称字节或跨机器完全一致。语法、240 秒连续镜头、单文件打包与本地 HTTP 边界检查已通过；CI 尚需由公开仓库实际运行。测试产物和运行凭据位于 ignored out，未打包为影片依赖。
