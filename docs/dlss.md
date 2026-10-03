# Community RGB NR：本片的实际经验

这里的增强来自 community MLX-DLSS 的 RGB neural rendering 适配，不是官方 DLSS 引擎集成。影片没有把真实 3D depth、normal、albedo、roughness 或引擎 motion vector 送进模型；媒体路径使用常量深度与估计 optical flow，Metal 后端采用 `observedZeroDescriptor`。不要把它宣传成接入了完整游戏渲染信息，也不要把上游软件许可当成模型许可。

本项目只分发原创管线及一个薄 PNG 序列适配 patch，不分发上游模型实现、DLL、权重、模型包、提取器或反汇编内容。用户自行准备合法可用模型。上游文档：[iamwavecut/MLX-DLSS](https://github.com/iamwavecut/MLX-DLSS)。可取得的基线是 [0ca2deab092fe6f3e331bf4f616271dbc64521d0](https://github.com/iamwavecut/MLX-DLSS/commit/0ca2deab092fe6f3e331bf4f616271dbc64521d0)。历史本地 `d1b9978` 不在公开 upstream，不能作为读者的安装 pin；本项目的 [PNG patch](../pipeline/patches/mlx-png-sequence.patch) 在公开基线上补入该序列能力，随附 Apache-2.0 LICENSE/NOTICE。

## 已采用参数与收益

| 镜头 | 范围 | profile / intensity | detail / colour | 层数 | 实际判断 |
|---|---|---|---|---:|---|
| S06 | 44–58 秒 | standard / 1 | 3 / 1.5 | 1 | 石块接触阴影、局部反差更明确；圆石造型与重复横纹仍在 |
| S10 | 82–96 秒 | standard / 1 | 1.8 / 1.1 | 1 | 温和增加岩面反差；保留明亮雪面、云形状及字幕 |
| S11 | 96–102 秒 | standard / 1 | 1 / 1 | 2 | 岩雪边缘反差略增；尘雾/碎屑主体保持，几何仍是原来的多面造型 |

全部使用 scale 1 / float16 / temporal on / automatic motion，无 FG、无 SR。`standard` 是上游 style0 的较强 nominal profile，`natural` 是 style1 较温和 profile；历史前期所谓“标准档”其实使用了 natural，不应混为一套参数。

无空间 mask 时 intensity 的 blend 在 Metal 中钳制至 1；历史同帧 intensity 1 与 1.5 的 8/16-bit 输出相同，不能靠大于 1 的数字宣称更强。detail 与 colour 分别放大网络变化的高/低频分量，双层则重复网络本身，它们是不同操作。三层测试曾偏暖、影圈过重，未得到足够额外结构收益，所以没有采用。

这些收益主要是明暗、局部反差和接触阴影，未证明新增可信的岩层、裂纹或几何。基础塑料感应回到 3D 材质、形状和照明中解决。光滑石块近景的 grain 前置/后置实验变化尤其细微，不能声称大幅材质升级；真实对比及限制见 [经验总结](lessons.md)。

## 颗粒、色彩与转场

顺序是原有 DOF/运动模糊、bloom/CA、ACES→display-sRGB、grade/vignette、转场/字幕，然后 film grain。paired capture 只关闭 `uGrain`，不移除标题粒子、字幕、景深或已有 tone mapping。两层的输入保持无 grain，最后才复用原 GLSL 粒子算法，保留绝对帧号、随机种子、尺寸和 padded `gl_FragCoord`。这里的“颗粒”指 film grain，片名粒子属于场景内容。

历史 grain bypass 的 8-bit MAE 约 0.25、最大 1–2 级，是可能与 PNG 量化、clamp/dither 顺序有关的控制误差，未归为 NR 增益；本次没有独立证明各因素的因果占比。不能把原 on 减 off 的差值简单贴回模型输出：原 grain 的振幅按最终亮度响应。

S06 开场原本近纯白，裸 NR 将它染成黄灰。实际交付保留 44–44.5 秒原 on RGB，44.5–46 秒 smoothstep 进入增强，46 秒起完整 NR；两边均已完成 grain，混合不重推理。该必要修复由配置中的 `white_transition_protection` 实现。

PNG 明确是 display-sRGB；管线不再执行 BT709→sRGB TRC 转换，也不把 linear HDR 直接喂给只接这套 SDR 图像契约的入口。输出 RGB→limited YUV 使用 BT709 矩阵，同时沿用历史成片的 BT709 primaries/transfer/matrix 标签；这保留既有显示契约，不等于 source 像素的 TRC 原本是 BT709。标签/转码差异不能算模型增强。

## 实际时间与硬件边界

历史三个整镜头完成了 1200 个 NR 输入帧，输出 1020 帧、34 秒；序列阶段累计 2431.19 秒（40.52 分钟），进程峰值约 9.10–9.36 GB。这包含 PNG I/O、flow 与模型，**不是纯 GPU 性能**，也不是读者机器的预计耗时。

PNG 由 image I/O 解码；没有硬件视频解码。NR 使用 Metal，回执 motion backend 为 VideoToolbox；导出为 `hevc_videotoolbox`、q75、`allow_sw=0`，软件编码回退被拒绝。不要将硬件编码写成硬件解码。历史成片验证与此次公开源码小样分别列在 [验证说明](validation.md)。
