# 重建与增强

默认影片源码包含最终融雪场景与修订 score。普通 `npm run render` 是从当前源重新生成的基线；它与历史“部分 PCM 保持逐字节不变 + 局部 NR + 无损视频合片”母带流程不同。浏览器、GPU/驱动、浮点舍入和编码器版本也可能变化；不承诺 fresh clone 的 PNG、WAV 或 MP4 与历史交付 SHA 相同。

## 环境与无模型 demo

先按根 README 安装 Node 依赖并设置系统 Chrome；Python 安装 [requirements](../pipeline/requirements.txt)。NR 需要支持上游 MLX/Metal 的 Apple Silicon/macOS 环境，HEVC 导出需要 FFmpeg 的 VideoToolbox encoder。使用自己的虚拟环境，不要求作者的旧 experiments 或 01 片。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r pipeline/requirements.txt
# 只捕获一小段 paired PNG；不需要模型和旧母带。
.venv/bin/python pipeline/run.py --config examples/params/demo.json --work work/demo --stage capture
# 用同一工作目录导出并验证未经 NR 的基线。
.venv/bin/python pipeline/run.py --config examples/params/demo.json --work work/demo --stage export --baseline
.venv/bin/python pipeline/run.py --config examples/params/demo.json --work work/demo --stage verify --baseline
```

捕获在 ignored `work/` 创建独立 film copy，保留源 `src/tools` 不变，仅为恢复 grain 导出已有两个 shader 常量。所有缺失 PNG 均由当前源、绝对时间和配置重建，不依赖私人缓存。demo 为小分辨率/少帧的执行检查，不能代替 4K 时序审片。

## 外部 PNG NR CLI

软件与模型都放在项目之外；本项目不提供模型取得/提取脚本。依 upstream 文档自行准备合法可用的模型包。以下只构建公开软件与本项目原创薄适配：

```sh
git clone https://github.com/iamwavecut/MLX-DLSS.git /your/tools/MLX-DLSS
cd /your/tools/MLX-DLSS
git checkout 0ca2deab092fe6f3e331bf4f616271dbc64521d0
git apply --check /your/grain-film/pipeline/patches/mlx-png-sequence.patch
git apply /your/grain-film/pipeline/patches/mlx-png-sequence.patch
swift build -c release --product mlxdlss
# 按 upstream prepare-mlx-metallib.sh 的依赖要求准备 CMake/Ninja/Xcode。
CC=/usr/bin/clang CXX=/usr/bin/clang++ MLXDLSS_PREPARE_SKIP_SWIFT_BUILD=1 bash scripts/prepare-mlx-metallib.sh
swift build -c release --show-bin-path
```

最后一条给出实际二进制目录，不假定每个 Swift/Xcode 版本都使用相同 `.build` 路径。不要把其他本地 commit 或旧 build 对象当作公开 patch 的测试。保留 upstream 与 patch 的 Apache LICENSE/NOTICE。patch 的 PNG 方法按文件名排序，每次 CLI 进程只有一个 history/flow；NR-only、无 FG/SR，不接受 `--start-frame`/`--frames`，已有输出目录会直接拒绝。

```sh
cd /your/grain-film
.venv/bin/python pipeline/run.py --config examples/params/demo.json \
  --work work/demo-nr --mlx-cli /your/tools/bin/mlxdlss \
  --model /your/models/NeuralRendering.dlssmodel
```

`--check` 只校验本管线配置与外部路径，不会加载模型或预留 GPU。`--stage capture|infer|export|verify` 可分阶段运行；`all` 与已存在输出都会拒绝覆盖。中断推理的 partial 必须另存，从镜头首帧/真实同镜头预滚重新建立完整 history，不能把 partial 与新 history 直接拼接并声称无缝恢复。

## 三个完整镜头

```sh
.venv/bin/python pipeline/run.py --config examples/params/scenes.json --scene S06 \
  --work work/S06 --mlx-cli /your/tools/bin/mlxdlss --model /your/models/NeuralRendering.dlssmodel
# S10、S11 同样选择各自 scene 和新的 work 目录。
```

准确参数见 [scenes.json](../examples/params/scenes.json) 与 [DLSS 说明](dlss.md)。三个完整镜头不跨镜头预滚，首帧重置；短片需要预滚时，`start-preroll_seconds >= shot_start`。S11 的第二层读取第一层全部 PNG，包括预滚；只在最后恢复一次 grain，再裁掉预滚。S06 的同域白转场保护是默认配置的一部分。

4K 捕获 viewport 3840×2160，picture crop 为 `0,120,3840,1920`；恢复 grain 时补回同一 120 像素 y 坐标，最后精确裁掉边框。输出 q75 / hvc1 / main / yuv420p / bf0 / GOP60 / timescale15360 / BT709 limited，每两秒强制 IDR。原/增强视频都从同一 paired 图像导出，基本对照不需要外部母带。

## 合片与音频

先从当前源码生成自己的 240 秒 4K 18:9 HEVC 基线：

```sh
node tools/render.mjs --scale 2 --samples 8 --crop 3840:1920:0:120 \
  --encoder hevc_videotoolbox --quality 75 --out out/your-baseline.mp4
```

HEVC 入口已显式配置 bf0、GOP60、两秒 IDR、timescale15360 与 BT709 limited。再使用 [assemble.py](../pipeline/assemble.py) 将 S06/S10/S11 替换进去。它不是通用剪辑器：仅本片 240 秒、30 fps、三个已定义区间；当前 src 已含 S08 融雪修正，无需旧 01 或额外历史 S08 片。

```sh
.venv/bin/python pipeline/assemble.py --base out/your-baseline.mp4 \
  --s06 work/S06/enhanced.mp4 --s10 work/S10/enhanced.mp4 --s11 work/S11/enhanced.mp4 \
  --work work/assembly --output out/your-enhanced.mp4
```

脚本动态比对当前基线与各段 HEVC extradata、标签/尺寸/帧率/PTS/IDR，头不兼容就停止，不能仅改标签强行 hvc1 拼接。通过时使用视频 stream copy，并核对合片所有视频 packet SHA 与来源一致；音频默认从自己的基线复制。若要历史方法的局部 PCM 修订，使用 [音频重建说明](audio.md) 的入口生成新 WAV，再加 `--audio-wav`，只 AAC 编码一次。最后 1.5 秒须保持本片既有静音；合片只裁 AAC 尾部延包，完整 7200 视频包必须保留。公开源码没有携带历史私人 WAV，算法重建与历史字节相同是不同的验收层级。

每次运行将命令、配置、模型/可执行文件 SHA、native 每层回执、裁切/混合权重、输出 SHA 和验证结果写入对应 ignored work 目录。正式发布前还需看连续画面、文字和拼接边界；完整解码通过不等于材质或时序视觉已通过。
