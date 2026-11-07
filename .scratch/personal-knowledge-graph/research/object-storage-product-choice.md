# Noterion：本地默认对象存储产品建议

核验日期：2026-11-07（Asia/Shanghai）。只读官方资料研究；未运行服务、拉取镜像或测试性能。只新增本文，不修改规格、领域词汇、技术设计或 ADR。

研究前已读取最新 spec.md 与 CONTEXT.md。项目名称使用 **Noterion**；已确认 Tauri/Rust、PostgreSQL 正式事实源、Neo4j 可重建图副本，以及文件资料本体长期保存。按最新技术访谈，文件本体采用对象存储，本地或云端均可；本文只收敛本地默认产品，不比较云厂商或价格。

## 推荐结论

**有界推荐 RustFS 作为 Noterion 可替换的本地参考候选，Garage 保留为一个对照候选。** 应用侧推荐通过可配置 endpoint 的 S3 兼容接口访问对象，兼容用户提供的云端 endpoint，避免把资料管理绑定到特定产品的管理 API。这是工程建议，尚不视为用户已确认产品与全部接口细节；具体本地产品不阻塞检索等独立分支。

这不是“RustFS 比 Garage 更可靠”的结论。Garage 的稳定发行历史更长，RustFS 的 GA 时间较短；本次资料不能证明二者在本项目中的长期故障率。推荐 RustFS 的具体理由是：当前发行路径明确，对本项目需要的 Range 读取、多段上传、预签名 URL 给出有边界的兼容证据，Rust 客户端文档也更完整。Garage 的官方超大对象上传问题只登记为验证项；没有本项目 1–2GB 等样本及触发阈值证据，不能据此断言 Noterion 的文件会卡住或 Garage 不适用。

## 当前发行与维护事实

| 项目 | 已核验事实 | 对 Noterion 的含义 |
| --- | --- | --- |
| RustFS | 官方在 2026-09-16 宣布 1.0.0 GA；核验时 1.0.4 仍标为 Latest，并有修复记录 | 有当前发行活动，但稳定发行时间较短；GA、Rust 实现和项目热度都不是长期可靠性认证 |
| Garage | 官方发行页列 1.0.0 为 2024-04-10，2.0.0 为 2025-06-14，当前 2.5.0 为 2026-10-24 | 公开稳定发行的时间跨度更长；这是成熟度的一项证据，不能推成实测更稳或故障更少 |
| MinIO 原社区项目 | 官方仓库在 2026-04-25 归档，README 明确不再维护；社区版为源码分发，历史二进制不再更新 | 不作为新项目的默认社区产品；不将 AIStor 产品条件与原社区项目混同 |

来源：[RustFS 当前发行](https://github.com/rustfs/rustfs/releases/tag/1.0.4)、[Garage 官方发行历史](https://garagehq.deuxfleurs.fr/_releases.html)、[MinIO 官方仓库](https://github.com/minio/minio)。RustFS GA 日期的官方公告与此前核验细节见 [已有候选状态记录](./object-storage-candidates.md)。

Garage 同样是 Rust 项目，因此“喜欢 Rust”不能单独区分两者；接口适配与已知运行限制仍然重要。Garage 官方源码编译文档直接说明其为标准 Rust 项目；该文档的一些构建示例仍引用旧版本，不能把示例版本号当作当前发行版本。

## 本地单机 Docker 与文档约束

RustFS 官方仓库提供 `rustfs/rustfs` 镜像、指定版本标签及单机路径；数据需要持久化到卷或主机目录。容器非 root 用户及挂载权限需要在实际 Windows Docker 环境核验。Garage 官方 quickstart 同样提供 `dxflrs/garage:v2.5.0` 与单节点启动选项，但明确其教程配置没有数据冗余，不能当作生产冗余方案；示例临时路径和未挂载数据卷还需要改为持久化位置。

这些事实说明两者都有单机 Docker 路径，不说明已在本机验证，更不自动决定集群或高可用。Noterion 当前个人单机场景不能直接继承任何官网多节点可靠性宣传。

来源：[RustFS 官方仓库的 Docker/单机说明](https://github.com/rustfs/rustfs#quickstart)、[Garage 官方 quickstart](https://garagehq.deuxfleurs.fr/documentation/quick-start/)。

## 本项目接口核验

| 接口或行为 | RustFS 官方资料 | Garage 官方资料 | 本项目结论 |
| --- | --- | --- | --- |
| 常见上传、下载、HEAD、列表、删除 | 兼容矩阵列为已测试的常见对象操作 | 兼容表将对应基本端点列为已实现 | 可作为两个候选的基础；仍需用固定发行版核验实际读写 |
| Range GET | 矩阵明确列出已测试的部分 HTTP Range/条件读取场景 | 本次读取的兼容表只明确 GetObject 已实现，没有单独列 Range 语义；本次未能读取官方源码进一步核验 | RustFS 的文档证据更明确；不能把 Garage 的文档空缺写成不支持。PDF/视频相关读取需要专门验证 |
| 多段上传 | 核心创建、上传分段、完成和取消列为已测试；部分列举和分段查找边缘行为不在默认测试门槛内 | 创建、上传分段、完成、取消、列举等端点列为已实现 | 两者均有接口路径，不能由“兼容”推成全部边界一致 |
| Presigned GET/PUT | 矩阵明确列出选定签名和请求场景已测试 | 兼容表列预签名 URL 和 Signature V4 已实现 | 可以设计临时访问入口，具体有效期、客户端行为和 Range 配合后续验证 |

来源：[RustFS 官方 S3 兼容矩阵](https://docs.rustfs.com/en/reference/s3-compatibility)、[Garage 官方 S3 兼容表](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)。RustFS 矩阵快照注明 2026-08-09；选定发行版的行为还需单独确认。Garage 的比较页也明确提示有些资料可能落后，不能替代实际兼容测试。

Garage 的官方 known issues 另外记录：超大对象的元数据包含大量块引用，上传时可能产生随块数平方增长的处理量，导致较高 I/O、CPU 或上传停滞；其缓解建议涉及 block_size 和分段大小配合。官方同时说明 conditional writes/locking/WORM 存在架构限制。本文没有将这些能力加为 Noterion 当前要求，也没有获得可映射到 Noterion 文件大小的触发阈值或本地样本，故这里只登记验证项，不据此推断本项目会发生卡顿或作性能淘汰。[Garage 官方已知问题](https://garagehq.deuxfleurs.fr/documentation/reference-manual/known-issues/)。

## Rust 接口路径与可替换边界

RustFS 官方并未提供一个必须嵌入应用的第一方 RustFS 客户端 crate，而是示范使用 `aws-sdk-s3`，配置自定义 endpoint、region、访问凭据和 path-style 选项。Garage 的 Rust 集成页当前仍标为 Coming soon，只指向 AWS Rust SDK；不能称其已有完整官方 Rust 集成教程。[RustFS Rust SDK 指南](https://docs.rustfs.com/en/developer/sdk/rust)、[Garage Rust 指南](https://garagehq.deuxfleurs.fr/documentation/build/rust/)。

对 Noterion 的工程推荐如下，均不等于已实现：

- Tauri Rust Core 通过一个面向项目所需 S3 操作的接口访问对象；本地默认配置与将来云端配置复用这一调用边界。
- 配置包含 endpoint、region、bucket、凭据及必要的地址风格；不将“使用 AWS SDK”误解成必须开 AWS 账户或把资料送到 AWS。
- 资料的持久对象标识与临时预签名 URL 分开；URL 可按访问需要生成，不将过期 URL 当作文件本体的唯一定位信息。
- 对象访问为内置查看等上层能力提供流式或 Range 读取路径；不默认先完整缓存大视频才允许查看。具体查看行为由技术主线记录，本文不扩展播放器方案。
- 换 endpoint 不会移动已有对象。将来更换产品仍需迁移本体并验证权限、签名、请求头和兼容差异；不承诺只改一个 URL 就无损迁移。
- 客户端与服务器版本需要固定并验证。文档中的宽松依赖示例和最低 Rust 版本不能替代实际 SDK 版本的兼容检查。

## 默认建议的适用条件

可以向用户建议：“本地先以 RustFS 为参考候选，应用使用可配置的 S3 兼容接口，也能接入用户提供的云端存储。”其依据是当前所需接口与文档适配，而不是声称 RustFS 获得了长期可靠性认证；当前不把具体产品定版当作推进检索讨论的前置条件。

正式把真实学习资料交给该默认实现前，应验证固定版本下的完整上传/下载一致性、应用所需 Range 读取、多段完成/取消、预签名访问，以及容器重建后文件仍在。这里登记的是候选验证边界，本次没有执行这些检查或承诺通过。

Garage 若成为偏好候选，应优先确认单机持久化配置、文件规模及大对象约束，再补 Range 和 SDK 集成验证。它的较长发行历史值得重视，但当前证据不足以单凭这一点把它列为明显更适合 Noterion 的默认。

本报告不选择集群、不设计高可用，不列云厂商价格，不展开 NAS、全量迁移或备份恢复功能；资料长期可靠保存仍需后续工程验证，不能由某个对象存储产品名代替。
