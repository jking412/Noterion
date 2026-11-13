import terminalDemo from './materials/container-terminal.txt?raw'
import troubleshootingGuide from './materials/troubleshooting-guide.md?raw'
import linuxChecklist from './materials/linux-checklist.html?raw'
import concurrencyNotes from './materials/concurrency-notes.md?raw'
import { cloneData, composeDescription } from '../domain/logic'
import type { DemoData, KnowledgePoint, ResourceItem, ThemeColor } from '../domain/types'

function knowledge(
  id: string,
  name: string,
  color: ThemeColor,
  topicIds: string[],
  description: string,
  command: string,
  understanding: string,
  resourceIds: string[],
  isTheme = false,
): KnowledgePoint {
  return {
    id,
    name,
    color,
    topicIds,
    resourceIds,
    isTheme,
    description: composeDescription({ description, command, understanding }),
  }
}

const resources: ResourceItem[] = [
  { id: 'terminal-demo', title: '容器操作演示.txt', kind: 'text', content: terminalDemo, filename: '容器操作演示.txt' },
  { id: 'docker-doc', title: 'Docker exec 文档', kind: 'link', url: 'https://docs.docker.com/reference/cli/docker/container/exec/' },
  { id: 'troubleshooting-guide', title: '容器排障速查.md', kind: 'markdown', content: troubleshootingGuide, filename: '容器排障速查.md' },
  { id: 'linux-checklist', title: 'Linux 日常巡检.html', kind: 'html', content: linuxChecklist, filename: 'Linux 日常巡检.html' },
  { id: 'mysql-doc', title: 'MySQL 并发控制参考', kind: 'link', url: 'https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html' },
  { id: 'concurrency-notes', title: '并发编程学习笔记.md', kind: 'markdown', content: concurrencyNotes, filename: '并发编程学习笔记.md' },
]

const points: KnowledgePoint[] = [
  knowledge('docker', 'Docker', 'docker', [],
    '保存和复用应用的运行环境，把镜像、网络与日常操作组织在一起。', '',
    '把运行环境也作为可记录、可重建的知识，而不只记住一条命令。', ['docker-doc', 'terminal-demo'], true),
  knowledge('linux', 'Linux 运维', 'linux', [],
    '记录主机资源检查、进程管理与服务排查的方法。', '',
    '先观察系统的当前状态，再根据证据做判断。', ['linux-checklist'], true),
  knowledge('mysql', 'MySQL', 'mysql', [],
    '整理数据库查询、索引和事务实践，理解数据如何被读取与修改。', '',
    '把执行计划与业务访问方式放在一起理解。', ['mysql-doc'], true),
  knowledge('concurrency', '并发编程', 'concurrency', [],
    '梳理线程、共享状态与任务调度的方法，关注原子性、可见性与执行顺序。', '',
    '先说清楚共享了什么，再决定怎样协调访问。', ['concurrency-notes'], true),
  knowledge('container-ops', '容器操作', 'docker', ['docker'],
    '整理运行实例的日常操作，包括终端、状态和输出信息的检查。', '',
    '先确认目标实例及其状态，再选择相应的操作。', ['terminal-demo'], true),
  knowledge('docker-shell', '进入容器终端', 'docker', ['container-ops'],
    '在运行中的容器内开启交互式终端，用于检查环境与执行排障命令。',
    'docker exec -it <容器名> /bin/bash',
    'exec 在已有容器中启动新进程。若镜像没有 Bash，可将最后的程序替换为 /bin/sh。',
    ['terminal-demo', 'docker-doc']),
  knowledge('container-troubleshoot', '容器排障', 'docker', ['docker', 'linux'],
    '从日志、进程和网络定位容器问题，同时检查宿主机资源与运行实例的状态。',
    'docker ps -a\ndocker logs --tail 100 <容器名>\ndocker inspect <容器名>',
    '问题可能来自应用本身，也可能来自主机环境。两条主题入口共用这一份记录。',
    ['troubleshooting-guide', 'linux-checklist']),
  knowledge('docker-logs', '查看容器日志', 'docker', ['docker'],
    '使用 docker logs 查看容器运行日志，将异常时间与具体操作对应起来。',
    'docker logs --tail 100 -f <容器名>',
    '先缩小时间范围，再保存能解释问题的上下文。', ['troubleshooting-guide', 'docker-doc']),
  knowledge('docker-network', '网络连通检查', 'docker', ['docker'],
    '检查应用监听地址、端口映射和网络配置，逐层确认请求到达的位置。',
    'docker port <容器名>\ndocker inspect <容器名>',
    '把服务内部地址与外部访问地址分开记录。', ['troubleshooting-guide']),
  knowledge('linux-process', '进程管理', 'linux', ['linux'],
    '通过进程列表观察程序是否存在、占用多少资源，以及由谁启动。',
    'ps aux\nps -ef',
    '进程存在不代表服务正常，还需要结合输出与监听情况判断。', ['linux-checklist', 'troubleshooting-guide']),
  knowledge('linux-disk', '磁盘空间', 'linux', ['linux'],
    '同时检查文件系统容量与 inode 使用情况，识别空间不足的不同原因。',
    'df -h\ndf -i',
    '容量和文件数量是两个维度，检查时都要保留。', ['linux-checklist']),
  knowledge('linux-service', '服务状态', 'linux', ['linux'],
    '检查 systemd 服务的运行状态和最近输出，区分启动失败与运行后退出。',
    'systemctl status <服务名>\njournalctl -u <服务名> -n 100 --no-pager',
    '把退出原因、发生时间和启动配置一起记录。', ['linux-checklist']),
  knowledge('mysql-lock', '锁', 'mysql', ['mysql'],
    'MySQL 中协调并发事务访问数据的机制。理解记录锁、间隙与等待关系，有助于定位事务阻塞。',
    'SHOW ENGINE INNODB STATUS;',
    '这里关注事务访问哪些数据、需要等待谁，以及事务何时结束。', ['mysql-doc']),
  knowledge('mysql-index', '索引', 'mysql', ['mysql'],
    '通过有序的数据结构减少查询扫描范围，需要结合过滤条件与排序方式判断效果。',
    'EXPLAIN SELECT * FROM orders WHERE user_id = 42;',
    '先观察实际扫描与访问方式，再决定是否增加新的索引。', ['mysql-doc']),
  knowledge('mysql-transaction', '事务', 'mysql', ['mysql'],
    '把一组相关数据库操作作为一个整体完成，明确开始、提交和回滚边界。',
    'START TRANSACTION;\nSELECT * FROM orders WHERE id = 42;\nCOMMIT;',
    '业务上的一次完整动作，应有清楚的数据一致性边界。', ['mysql-doc']),
  knowledge('concurrency-lock', '锁', 'concurrency', ['concurrency'],
    '并发编程中保护共享状态的互斥机制，让同一时刻只有符合约定的线程进入临界区。',
    'synchronized (monitor) {\n    updateSharedState();\n}',
    '这里保护的是临界区与共享变量，不是数据库事务。所有参与者需要遵守同一同步约定。', ['concurrency-notes']),
  knowledge('thread-pool', '线程池', 'concurrency', ['concurrency'],
    '复用工作线程执行任务，显式管理并发数量、排队方式和任务被拒绝时的行为。', '',
    '同时关注执行时间、队列长度和任务来源，不能只看线程数量。', ['concurrency-notes']),
  knowledge('cas', 'CAS', 'concurrency', ['concurrency'],
    '通过比较并交换更新共享值，失败时重新判断当前状态。',
    '读取当前值\n比较当前值与预期值\n相等则替换，否则重新判断',
    '一次操作成功不代表整个业务流程自动具有原子性，还要考虑重试和 ABA 问题。', ['concurrency-notes']),
  knowledge('learning-review', '知识复盘', 'neutral', [],
    '给每次学习保留一句自己的理解，将结论与下一次实践联系起来。', '',
    '能复述、能举例、能再次执行，比收藏更多链接更能帮助找回知识。', []),
  knowledge('incident-template', '排障记录模板', 'neutral', [],
    '按现象、证据、判断和结论记录一次排查。这是一个未归属主题的独立知识点。',
    '现象：\n检查：\n证据：\n结论：',
    '独立记录可以保留，等理解更清楚后再归入合适的主题。', ['troubleshooting-guide']),
]

const seed: DemoData = {
  points,
  resources,
  positions: {
    docker: { x: 180, y: 155 },
    linux: { x: 780, y: 165 },
    mysql: { x: 230, y: 455 },
    concurrency: { x: 800, y: 460 },
    'container-ops': { x: 315, y: 82 },
    'docker-shell': { x: 500, y: 50 },
    'container-troubleshoot': { x: 475, y: 198 },
    'docker-logs': { x: 295, y: 280 },
    'docker-network': { x: 425, y: 320 },
    'linux-process': { x: 950, y: 80 },
    'linux-disk': { x: 1040, y: 260 },
    'linux-service': { x: 830, y: 310 },
    'mysql-lock': { x: 365, y: 385 },
    'mysql-index': { x: 410, y: 500 },
    'mysql-transaction': { x: 255, y: 575 },
    'concurrency-lock': { x: 1000, y: 375 },
    'thread-pool': { x: 1040, y: 505 },
    cas: { x: 900, y: 580 },
    'learning-review': { x: 615, y: 420 },
    'incident-template': { x: 610, y: 560 },
  },
}

export function createSeedData(): DemoData {
  return cloneData(seed)
}

/** The app opens empty; historical fixtures stay available for regression tests. */
export function createEmptyData(): DemoData {
  return { points: [], resources: [], positions: {} }
}
