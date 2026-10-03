# 验证层级与本次实测

本项目将历史交付、此次公开源码小样、参数配置和读者自己的成片验收分开。命令/编译成功不能代替模型输出；模型输出不能代替视觉质量；完整解码也不能证明材质或所有拼接都没有伪影。

## 此次公开 base + patch

脱敏回执：[public-nr-smoke.json](evidence/public-nr-smoke.json)。公开 upstream `0ca2deab092fe6f3e331bf4f616271dbc64521d0` 单独归档，59 行 PNG patch 在干净源码上 `git apply --check` 与实际 apply 通过。Swift 编译用时 82.68 秒；为排除复用旧私有入口，随后触碰三个适配文件强制重编，日志显示 DLSSMedia/CLI 模块重新编译，编译输入列表含 `NativeMediaProcessor.swift`、`ProcessPNGSequenceCommand.swift` 和 `main.swift`。实际新二进制 SHA 与旧私有 CLI 不同。仅本地借用 COW build cache 加快依赖构建，缓存、vendor 和二进制不随 repo 发布。

在 M5 Max / macOS 27 / Xcode 27 beta 上，实际完成两条全新链：

| 小样 | 真实捕获 | NR 输入/输出 | 时序 | 后续 |
|---|---|---|---|---|
| 单层 | 绝对帧 1500–1502，320×180 paired PNG | 3 → 3，7.72 秒 | sceneResets 0、估计 flow | 原 GLSL grain → 320×160 HEVC |
| 双层 | 独立重新捕获同三帧 | 第一层 3 → 3，第二层 3 → 3 | 两个独立进程/history/flow，resets均0 | 只在第二层后恢复 grain |

累计 9 个实际小分辨率 NR 输入帧。两组原/增强均为 3 帧、30 fps、hvc1、bf0、BT709 三标签/limited、timebase 1/15360；逐帧 PTS、首帧真实 NAL type20 IDR、原/增强动态 HEVC 头匹配及完整解码通过。这里测的是公开适配链能执行，不是 4K 材质或整镜头时序质量的重新验收，也不把小样时间当性能基准。

另有以下控制：

- 新 CLI intensity0 单帧 bypass：8-bit 输出与输入完全相同。
- 同三帧原 GLSL grain 复原：最大误差 1/255，MAE 约 0.25/255；这是控制误差，不归为 NR 增益。它可能与中间量化、clamp/dither 顺序有关，本次未独立证明每个因素的因果占比。
- 新 CLI 拒绝已有输出目录和不支持的 `--frames`；管线拒绝已有完整工作输出及跨镜头预滚，均在实际调用中验证。
- 以既有小 PNG 重复构造 63 帧，仅作 VideoToolbox 编码控制：0/60 帧均为真实 NAL type20 IDR、PTS/全解码通过。这不是新 NR 时序样本。
- 开源包新 4K HEVC baseline 小样与已验收 4K NR 的 extradata 动态比对相同。合片仍必须针对使用者自己的实际编码器重新比较，不能硬套历史 hash。

S06 44–46 秒白转场保护在历史生产中已做六点同帧检查并获接受；本次 50 秒三帧小样没有重新验证它的视觉过渡。公开配置和执行逻辑保留该修正，不把裸 NR 的原白场问题隐去。

## 公开影片与工具

[film-source-smoke.json](evidence/film-source-smoke.json) 记录源码包的实际 4K 小样：65–65.5 秒、15 帧、8 samples、3840×1920、HEVC VideoToolbox q75，完整解码通过。移除四个未使用 GLSL 助手后，两个 fresh 浏览器在绝对帧 1950 的 4K PNG 对比中，仅 108 / 8294400 像素变化，最大单通道 1/255、RGBA RMSE 0.001804；没有声称像素 exact，也没有对这些小差值断言已确定因果。

render 工具还实际验证了 FFmpeg 早退不会继续等待 ACK：无效 crop 约 1.00 秒非零退出并回收 browser/server，合法 4K 无声三帧约 1.77 秒成功，timebase 1/15360、全解码通过。HEVC baseline 现明确强制每两秒 IDR 与 timescale15360，和 NR export 合片契约一致。

另外修复了音频发送阶段的 ACK 永等：显式 `--audio-wav` 缺失或为目录时约 0.07 秒非零退出，且不启动浏览器；WebSocket close/error 拒绝连接、所有待决和后续 ACK。生产代码的 CPU mock 覆盖这些负例以及正常两帧回压，`node tools/check-sink.mjs` 可独立回归。正常有声 4K 三帧实际导出与完整解码通过，见 [ack-fix.json](evidence/ack-fix.json)。独立窄审复跑 CPU mock 和缺失文件 CLI 负例均通过，没有再次运行全片或 GPU。

## 历史成片

[production-summary.json](evidence/production-summary.json) 是白名单历史摘要：240 秒、7200 帧、3840×1920、30 fps；5910 个未修改视频 packet 与原基线相同，七个接点前/当/后共 21 帧回读，7200 帧全解码；音轨解码时长约 239.998667 秒，AAC 编码一次。历史完整 MP4 和每帧缓存没有随 repo 上传，此摘要不能证明任意 fresh clone 会得到相同 SHA。

历史 NR 三个镜头的完整参数、40.52 分钟包含 I/O+flow 的实际序列阶段，以及视觉收益/限制见 [dlss.md](dlss.md)。音频 CPU 重建/局部补丁另见 [audio.md](audio.md) 与 [audio-reproduction.json](evidence/audio-reproduction.json)。

## 使用者应验什么

[pipeline/validate.py](../pipeline/validate.py) 对实际成品检查尺寸、帧数、30 fps、起始 PTS 与每帧间隔、完整解码、BT709 limited、hvc1/main/yuv420p/bf0/timescale、真实 IDR，以及可选 reference 的 HEVC 头兼容。大视频 SHA 使用 8 MiB 分块读取。它只验证可观察的编码/时序契约，不会自动判断“好看”。

合片后必须看所有切点前后连续画面；NR 镜头看雪岩白边、接触阴影光晕、尘雾形状、假纹理漂移、字幕与片名粒子。帧数或 keyframe 标记通过不等于 temporal reset 无缝，强度数字更高也不等于新增可信结构。源图、清洁输入、各层输出和最终 grain 结果都可由 [reproduction.md](reproduction.md) 的代码重建。
