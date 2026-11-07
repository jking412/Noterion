# Domain Docs

本项目采用 single-context 布局。

## Before exploring, read these

- 根目录 `CONTEXT.md`：读取领域术语和模型。
- `docs/adr/`：读取与本次工作相关的架构决策记录。

上述文档尚不存在时，直接继续工作。
由 `/domain-modeling` 在术语或决策得到明确后按需创建。

## File structure

```text
/
├── CONTEXT.md
└── docs/
    └── adr/
```

以上是领域文档的约定位置，具体文档按需创建。

## Use the glossary's vocabulary

在工单标题、重构建议、假设和测试名称等输出中，
使用 `CONTEXT.md` 定义的领域术语，
避免使用词汇表明确排除的同义词。

需要的概念尚未出现在词汇表中时，
先判断该用语是否符合项目现有语言；
若确实存在术语缺口，将其记录为 `/domain-modeling` 的待处理内容。

## Flag ADR conflicts

建议与现有 ADR 冲突时，明确指出对应 ADR，
并说明重新讨论该决策的原因。
