# 局部 PCM 音效修复的复现

这条流程重建《一粒》的原配乐与修订配乐，然后只把 **65–78 秒** 的音效补丁合入原母带。输出 240 秒、48 kHz stereo、24-bit PCM；窗口两端各 0.2 秒 smoothstep 淡化。窗外 PCM 按原字节复制，不重新归一化整条音轨，也不从已母带 WAV 中减去未经母带处理的声层。

原基线的 cue sheet、assets，以及其 instrument、DSP、seed 依赖冻结在 `pipeline/audio-baseline/`。它保留旧版 S08 音效与 70 秒落石声。当前 `src/audio/` 是影片修订版：去掉升调气泡、14/22 Hz 调制、夸张飞行风及 70 秒 thud/rock1，改用逐渐变宽、拉远收暗、总体更轻的细碎宽频流水；没有增加冰裂脆响。配乐 strings/keys 内容与调度保留。

## 一条命令

仓库根目录先安装锁定的 Node 依赖；需要 Node ≥22.12、系统 Chrome/Chromium，以及 Python 3 + NumPy。可使用已提供的 pipeline Python 环境；音频本身不需要 FFmpeg、GPU、模型或 NR 二进制。

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install numpy
.venv/bin/python pipeline/audio.py
```

默认输出 `out/audio/`。也可指定另一个**尚不存在**的目录：

```sh
.venv/bin/python pipeline/audio.py --work out/audio-second-run
```

流程拒绝覆盖目录和文件。若某次运行中断，保留其日志，下一次选择新的输出目录。`CHROME_PATH` 可以指定浏览器。

## 输出与检查

| 文件 | 用途 |
|---|---|
| baseline.wav | 当前浏览器从冻结基线源码重新生成的原母带 |
| revised.wav | 修订版整条候选，固定使用本次 baseline 的精确 masterGain |
| patched-240s.wav | 仅合入 65–78 秒补丁的最终完整 WAV |
| original-58-80.wav、patched-58-80.wav | 包含前后剪辑与声尾的连续试听 |
| audio-render-receipt.json | 浏览器、CPU 参数、精确 gain、响度、限幅统计与实际请求模块 |
| audio-patch-receipt.json | 窗外 PCM SHA、接点样本、峰值、区间 RMS、源码与输出 SHA |
| audio.log | CPU WebAudio 运行日志 |
| film/ | 本次音频所需源码的隔离小副本，不修改仓库 src/tools |

Chromium 使用 `--disable-gpu --disable-software-rasterizer`。空白音频宿主页只导入声源，不创建 Three.js/WebGL 场景；两份完整混音通过 OfflineAudioContext 渲染。修订候选继续运行原限幅器，使用**当前基线精确 gain**，不再次追到 -16 LUFS。音效峰值改变可能影响窗口内限幅包络，因此不声称窗内每一份配乐 PCM 完全相同；窗外最终字节则必须完全相同。

补丁工具实际检查格式和长度、窗外字节与 SHA、两端样本变化和跨界步长、全长与窗口峰值，以及 58–80 秒分段 RMS。任何剪裁或窗外差异都会中止。补丁前后的音乐 cue 函数保持原设计，不使用整条有损音轨作为差分材料。

## 历史母版与可移植性的边界

历史 masterGain 为 **1.9004731748496868**。默认流程重新测量本次浏览器基线 gain，并在修订候选中冻结同一数值；历史值只作参考，不强迫不同浏览器产生同一 SHA。当前原始源码、浏览器、CPU WebAudio/DSP 实现若改变，基线 PCM 也可能改变。无论是否重现历史哈希，补丁仍保证相对于**本次新基线**的窗外 PCM 字节不变。

本次在同一 Mac 的 CPU WebAudio 全长复测中，基线 gain 等于上述历史值；生成的 baseline SHA256 为 `546b3e389b8c7424f0dcc8baeac47fb6d4cadff55576911389e617538100c12a`，补丁 WAV SHA256 为 `f935713d10ad86747094faab7944b427538ebc20afe9e3461c31e239ebfc5fa2`，均重现既有母版。两端样本差为 0，窗外 PCM SHA 一致，窗口峰值约 -3.76 dBFS。工具不读取作者旧 cache WAV；该结果是这台机器的一次实际观察，不是跨机器保证，也不是主观试听验收。

普通 `tools/render.mjs` 默认重新归一化整条修订配乐，与此局部 PCM 母版流程不同。要让视频导出使用这条修订母带，显式提供：

```sh
node tools/render.mjs --scale 2 --samples 8 --crop 3840:1920:0:120 --encoder hevc_videotoolbox --quality 75 --audio-wav out/audio/patched-240s.wav --out out/grain-patched-audio.mp4
```

这条命令会进行影片渲染；音频复现本身不需要重新渲染视频。最终 AAC 应只编码一次。严格容器尾静音处理属于成片组装阶段，不应为几毫秒纯静音再有损编码整条配乐。
