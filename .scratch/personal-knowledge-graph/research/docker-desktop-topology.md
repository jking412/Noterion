# Windows 桌面宿主＋Docker 数据库拓扑核验

核验日期：2026-11-07（Asia/Shanghai）。应用 research 技能，仅核验官方文档和执行一次只读 Docker 状态查询；没有安装、拉取镜像、创建卷或启动容器。用户已明确采用 Tauri＋Neo4j，并接受自己安装配置数据库、愿意配置 Docker。本文按“Windows 本机运行 Tauri/Rust，Compose 管理 PostgreSQL 与 Neo4j”研究，不新增业务数据分工决定，也不决定未来所有开源使用者必须安装 Docker。

## 建议的运行边界

**Tauri 是 Windows 宿主上的桌面程序；Rust 核心通过本机发布端口访问 Compose 中的数据库。Compose 管数据库服务及其持久卷。** Docker 能集中数据库及运行依赖的交付，却不会消除资源占用、服务启动、版本升级和备份恢复工作。这是结合当前个人使用方向的工程建议。

| 调用方与目标 | 地址含义 | 本项目建议 |
| --- | --- | --- |
| Windows 宿主 Rust → PostgreSQL | 宿主地址＋发布端口，例如 `127.0.0.1:5432`；该宿主端口可按冲突情况调整。 | 用应用配置提供连接地址，不在界面中直接暴露数据库账号。 |
| Windows 宿主 Rust → Neo4j | 同样使用宿主发布端口，例如 Bolt 的 `127.0.0.1:7687`；管理页面的 7474 端口是另一用途。 | Rust 数据访问层连接图数据库；是否发布管理页面端口单独确定。 |
| 同一 Compose 网络中的容器互访 | 使用服务名和容器端口，例如 `postgres:5432`、`neo4j:7687`。 | 服务名由容器网络 DNS 解析；不能把它直接当作 Windows 宿主应用的数据库地址。 |

Docker 官方区分 `HOST_PORT` 与 `CONTAINER_PORT`：宿主访问发布端口，容器间访问服务名及容器端口。容器被替换后 IP 可能变化，因此不固定容器 IP。[Compose Networking](https://docs.docker.com/compose/how-tos/networking/)。Neo4j 官方容器示例分别发布 7474 和 7687。[Neo4j Docker Configuration](https://neo4j.com/docs/operations-manual/current/docker/configuration/)。

本机个人使用建议显式绑定回环地址，例如发布形式 `127.0.0.1:5432:5432`、`127.0.0.1:7687:7687`。省略地址时 Docker 默认可能在所有宿主网络接口发布；绑定地址不替代数据库认证。[Docker Publishing Ports](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/)。以上是拓扑示意，不是已经可运行或已确定端口的 Compose 文件。

## 桌面程序不作为 Linux GUI 容器默认交付

Tauri 官方 Windows 交付是 MSI/NSIS 等本机安装包，Windows 界面依赖 WebView2；Docker Desktop 的 Linux 容器则运行在其 Linux 后端。这两个交付边界不同。[Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)、[Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)。

因此本项目建议先把数据库放进 Compose，把 Tauri 编译安装在 Windows；不要把“Compose 启动数据库”描述成“同一 Linux 容器栈已经包含 Windows 桌面 GUI”。这不否认专门配置 GUI 容器的可能性，而是该方式没有被本项目选择、核验或承诺。开发期和最终用户都需要有明确的“启动数据库”和“启动桌面应用”入口；是否由应用代为调用 Compose，仍需后续决定。

## 数据卷：按镜像版本选择挂载位置

| 数据库 | 官方持久化位置与版本差异 | 应用侧边界 |
| --- | --- | --- |
| PostgreSQL 官方镜像 | 18 及以后默认 `PGDATA` 采用主版本子目录，例如 `/var/lib/postgresql/18/docker`，镜像声明的卷根改为 `/var/lib/postgresql`；17 及以前的默认数据卷位置为 `/var/lib/postgresql/data`。应按锁定镜像的说明挂载，不能跨版本照抄路径。[Postgres Official Image](https://hub.docker.com/_/postgres)。 | 具体主版本尚未选定；研究中的路径不是当前部署配置。初始化、账号及后续迁移另行设计。 |
| Neo4j 官方镜像 | 数据库数据保存在 `/data`，需挂载持久存储；`/logs`、`/conf` 等有各自用途。[Neo4j Persisting Data](https://neo4j.com/docs/operations-manual/current/docker/mounting-volumes/)。 | 数据卷与日志、配置、备份输出分别识别，不能把容器文件系统当作持久存储保证。 |

建议为两库分别声明清楚的命名卷，或选择明确的数据目录绑定挂载，不依赖容器可写层或无稳定名称的匿名卷。命名卷独立于容器生命周期；普通 `docker compose down` 默认不删除命名卷，带 `--volumes` 则可删除相应卷。日常停服务与清空数据应是不同操作。[Docker Volumes](https://docs.docker.com/engine/storage/volumes/)、[Compose Down](https://docs.docker.com/reference/cli/docker/compose/down/)。

## 启动检查不等于运行恢复

Compose 的普通 `depends_on` 只规定启动依赖顺序；使用 `condition: service_healthy` 时，会在依赖的 `healthcheck` 通过后启动被依赖服务。这里的 healthy 是检查命令定义的健康条件，并不证明项目的业务初始化、结构迁移和全部查询都已就绪。[Compose Startup Order](https://docs.docker.com/compose/how-tos/startup-order/)。

本拓扑的 Tauri/Rust 在 Compose 外运行，因此不能靠 Compose 的 `depends_on` 自动等待桌面程序；两库也不应仅为排序而互相建立无实际意义的依赖。建议数据库各自配置健康检查，Rust 在启动及重连时检查可达、认证和所需结构，并显示失败原因、提供重试。后续断连、容器重建和查询失败也需要应用处理，不能把首次 healthcheck 通过当成永久业务可用保证。Docker 官方网络文档同样要求客户端在容器更新、旧连接关闭后自行重连。[Compose Networking](https://docs.docker.com/compose/how-tos/networking/)。

## 版本与数据保留边界

- **镜像版本**：建议锁定经过验证的明确数据库版本，避免用 `latest` 无意跨主版本升级。镜像 tag 可被发布者更新；需要完全可复现时进一步固定 digest，并承担主动更新责任。[Docker Image Pinning](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions)。替换镜像或重建容器不是数据库数据格式迁移方案。
- **数据卷与备份**：持久卷解决容器替换时保留数据，不能替代独立备份；活动数据卷与备份输出应分开。PostgreSQL 文件级备份有停库或一致快照等前提；Neo4j 官方 Docker 维护示例也区分 `/data` 与 `/backups`。[PostgreSQL File System Backup](https://www.postgresql.org/docs/17/backup-file.html)、[Neo4j Docker Dump/Load](https://neo4j.com/docs/operations-manual/current/docker/dump-load/)。这里只记录拓扑边界，依照用户当前讨论范围暂缓备份恢复细节，不在本文设计流程或排期。

## 当前环境事实与待确认事项

只读执行 `docker info` 时，Docker Desktop Linux Engine 的命名管道返回 `Access is denied`。本会话因此未能确认引擎运行状态；这不证明 Docker 没安装、引擎停止或用户配置错误，也不阻塞当前技术访谈。没有启动 Docker 或容器。

架构层仍需明确固定数据库版本及启动管理归属；未来开源使用者是否必须安装 Docker 尚未确认。导入导出、备份恢复的详细流程暂缓，不在本报告增加产品范围或版本排期。本报告不引入 Kubernetes、云服务或 NAS，也不把用户愿意配置 Docker 扩大为已经授权应用实现或部署。
