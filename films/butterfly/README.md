# 梦蝶 / The Dream of the Butterfly

一部以《庄子·齐物论》“庄周梦蝶”为创意起点的四分钟动画：水墨中的工位、地铁与人群，和草叶、露水、蝴蝶所在的彩色世界彼此照见。画面由 Three.js 程序化 3D 渲染，配乐、环境声和音效由代码合成；创作与修订使用了 AI 编程协作。

![梦蝶封面](assets/cover-bilibili.png)

上图及[竖版封面](assets/cover-douyin.png)使用 AI 图像工具参考成片重新构图，并非成片截图。

## 运行

从仓库根目录进入本片工程。GRAIN 的根目录入口保持原样，两部影片分别安装自己的依赖。

```bash
cd films/butterfly
npm ci
npm run serve
```

需要 Node.js 22.12+。打开终端显示的本地地址，点击播放；空格暂停，左右方向键跳转，`f` 全屏，`h` 显示状态。浏览器需要硬件 WebGL2；实时声音在播放后才启用。

```bash
npm run build
# 生成 dist/film.html，包含 Three.js、影片代码与许可声明
```

单文件 HTML 使用系统字体；不同系统、浏览器和 GPU 可能产生画面或字体差异。源码和锁文件可用于复现影片逻辑，不保证逐字节重建历史 MP4。

## 离线导出

需要本机 Chrome/Chromium，以及 PATH 中的 FFmpeg 和 ffprobe。可以用 `CHROME_PATH` 指定浏览器、`FFMPEG` 指定编码工具。macOS 默认使用 ANGLE Metal；其他系统采用浏览器默认后端，必要时通过 `ANGLE_BACKEND` 指定。跨平台启动配置已提供，历史完整导出实测在 Apple Silicon 上完成。

```bash
node tools/render.mjs --start 63 --end 73 --scale 0.5 \
  --no-audio --samples 2 --out out/flower-preview.mp4
```

Apple Silicon 上的完整 4K 导出命令：

```bash
node tools/render.mjs --scale 1.7777777777777777 --samples 8 \
  --encoder hevc_videotoolbox --quality 70 \
  --out out/butterfly-4k.mp4
```

输出为 **3840×1920、18:9、30 fps、240 秒、7200 帧**，画面本身无固定黑边；HEVC Main / hvc1、BT.709 SDR、AAC 48 kHz 双声道 320 kbps。VideoToolbox 路径明确禁止软件回退。其他平台可以省略硬件编码参数，使用工具默认的 `libx264`；本仓库不宣称已完成所有平台的完整导出验证。

内部基准画布为 2160×1080，按比例导出即可；本片不使用 GRAIN 的上下裁切参数。音轨按源码哈希缓存在 `out/.cache/`，源码变化会使用新缓存。

```bash
node tools/still.mjs 68 124 228 --scale 0.5
node tools/score.mjs --start 119 --end 130 --out out/rain.wav
```

音频工具仍先合成完整配乐，再裁指定时间段。生成的音视频、单帧、缓存、构建包和依赖目录不纳入 Git。

## 阅读

- [制作经验](docs/lessons.md)：花朵、局部音色修订、保留声层的增益与验收边界。
- [发布文案与原文出处](docs/发布文案.txt)：齐物论引文、改编思路和封面说明。
- [剧本与镜头规格](SCRIPT.md)、[引擎契约](ENGINE.md)：原创作规划与接口设计，含早期协作说明；不作为逐项实现验收记录。

本片借用了同库 GRAIN 的程序景观、噪声和部分渲染基础设施，保留在本片目录中的运行库可独立构建。最终版本包含珊瑚桃粉层瓣花、两组古琴局部微调、出蛹纸壳声和雨滴主体修订；未应用 DLSS。

原创代码、文档与示例图遵循仓库根目录 [MIT License](../../LICENSE)；第三方组件保留各自许可与署名，详见 [THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES.md)。古籍原文引用不构成本项目原创内容。
