# Third-party notices

本项目原创文件适用根目录 MIT License。以下组件保留各自许可；根许可不改变它们的权利范围。

## 直接依赖

| 组件 | 用途 | 许可 |
| --- | --- | --- |
| [Three.js](https://github.com/mrdoob/three.js) | WebGL 场景与渲染；单文件 HTML 会打包它 | MIT，见 [全文](licenses/three-MIT.txt) |
| [esbuild](https://github.com/evanw/esbuild) | 本地构建工具 | MIT，见 [全文](licenses/esbuild-MIT.txt) |
| [ws](https://github.com/websockets/ws) | 离线图像/音频传输 | MIT，见 [全文](licenses/ws-MIT.txt) |
| [Puppeteer](https://github.com/puppeteer/puppeteer) | 本地浏览器自动渲染 | Apache-2.0；通过 npm 安装，许可随包保留 |

依赖及锁定版本见 package-lock.json。浏览器与 FFmpeg 是外部工具，不随仓库分发；具体许可依用户安装的发行版。

## 程序噪声

`src/lib/glsl/noise.js` 中 simplex noise 及其 `src/lib/noise.js` CPU 镜像基于 Ashima Arts / Stefan Gustavson 的实现。MIT 署名与许可全文见 [webgl-noise-MIT.txt](licenses/webgl-noise-MIT.txt)，来源为 [作者仓库](https://github.com/stegu/webgl-noise)。

### Hash without Sine

`hash11` 至 `hash42` 为 David (Dave) Hoskins 的 Hash without Sine 适配，包括高维版本；不将这些函数称作本项目原创。保留 `Copyright (c)2014 David Hoskins.` 与 [MIT 全文](licenses/Hash-without-Sine-MIT.txt)。[作者原页](https://www.shadertoy.com/view/4djSRW)和[论文作者测试库中的原归属](https://github.com/markjarzynski/HashFunctionsForGPURendering_TestU01/blob/master/random.h)可用于追溯。许可文本按[带作者声明的公开发行副本](https://m.pouet.net/prod_nfo.php?font=3&which=94141)保留；整理本仓库时原页受访问限制，未声称完成对原页的当次回读。

### PCG

颗粒与抖动使用的 scalar `pcg` / `hashu12` 基于 Melissa O'Neill 的 PCG RXS-M-XS 32 位输出及默认常数，采用上游可选的 MIT 许可。[官方实现](https://github.com/imneme/pcg-c/blob/master/include/pcg_variants.h)；[MIT 全文](licenses/PCG-MIT.txt)署 `Copyright (c) 2014-2017 Melissa O'Neill and PCG Project contributors`。未使用的 `pcg3` / `hashu33` 没有随公开源码发布。

### 解析雾

`heightFog` 对指数高度密度沿视线积分，并处理水平视线与基准高度。算法参考 [Inigo Quilez, Fog](https://iquilezles.org/articles/fog/)。该数学说明是算法致谢，不声称取得某个原作者代码副本的新授权。未使用的 `noised` / `erosionFbm` 已从公开源码移除。

## ACES fitted tone mapping

`src/post.js` 的矩阵与 RRT/ODT 拟合适配自 Stephen Hill 的 [BakingLab/ACES.hlsl](https://github.com/TheRealMJP/BakingLab/blob/master/BakingLab/ACES.hlsl)。该文件明确标 MIT，并将拟合与实现归功于 Stephen Hill。仓库许可署 `Copyright (c) 2016 MJP`；全文见 [BakingLab-MIT.txt](licenses/BakingLab-MIT.txt)。这不是 Narkowicz 的另一种五系数近似。

## 可选 MLX-DLSS

[MLX-DLSS](https://github.com/iamwavecut/MLX-DLSS) 是独立的 Apache-2.0 项目。本仓库不包含其完整源码、模型图、提取器、模型权重或 NVIDIA 二进制。PNG 序列薄适配补丁依其 Apache-2.0 条件分发，具体版本、许可及必要署名与补丁一起保存于 pipeline。

NVIDIA 与 DLSS 是其权利人的商标。本片的社区适配实验不代表官方集成或背书。根 MIT License 不授予任何第三方模型或厂商软件的使用权。
