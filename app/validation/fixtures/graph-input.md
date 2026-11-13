import_id: docker-resources-v1
default_resource_ids: docker-doc

# Docker 资源管理

## 容器资源限制 {#container-resources}
is_theme: true
topic_ids: docker
resource_ids: 

将 CPU、内存、进程数与文件系统约束归在一个主题下，记录配置及观察结果。

## CPU 配额 {#cpu-quota}
is_theme: false
topic_ids: container-resources;linux
resource_ids: terminal-demo

限制容器可使用的 CPU 时间预算。先记录业务负载，再比较限制前后的运行表现。

## 命令
```sh
docker run --cpus=1.5 nginx
# CSV 示例也应保留逗号与双引号
printf 'CPU, "quota"\n'
```

## 个人理解
配置值与宿主机负载需要一起观察。

## 内存上限 {#memory-limit}
is_theme: false
topic_ids: container-resources
resource_ids: 

为容器记录内存预算，并在调整前保存当前配置。

```sh
docker run --memory=512m nginx
```

## 只读文件系统 {#readonly-filesystem}
is_theme: false
topic_ids: container-resources
resource_ids: troubleshooting-guide

记录只读根文件系统与临时写入目录的配置，验证应用实际需要写入的位置。

```sh
docker run --read-only --tmpfs /tmp nginx
```

## 容器排障 {#container-troubleshoot}
is_theme: false
topic_ids: container-resources
resource_ids: 

先记录症状，再结合资源限制、日志与宿主机状态排查。此段用于展示同 ID 内容差异，请在预览中明确选择保留已有或采用导入。

## 健康检查 {#container-healthcheck}
is_theme: false
topic_ids: container-resources
resource_ids: docker-doc

将探测命令、超时和结果记录在一起，区分应用响应异常与资源不足。

```sh
# 标题外观只作为代码，不应生成知识点
## 不是新条目 {#inside-code}
docker inspect --format='{{json .State.Health}}' <容器名>
```
