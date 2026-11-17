---
status: accepted
---

# 使用 AI Native 方式解析和使用个人知识

决定日期：2026-11-13（Asia/Shanghai）。本记录于 2026-11-17 整合历史工作区时补录，不将当时未实现的状态当作当前状态。

用户明确选择 AI Native，最初以 DeepSeek 提供自动解析、自动搜索和自动解答；知识解析由模型理解普通学习文本并输出现有业务 Point，不要求用户填写固定模板、CSV 或内部 ID。程序负责真实来源核对、身份和关系校验及明确采用后的正式事务写入，以接受模型配置、联网和失败处理的成本换取自然文本整理与知识使用能力；不能以伪造结果或恢复旧模板来掩盖服务失败。

本决定局部修订 [ADR 0005](0005-use-standalone-local-client.md) 的 AI 服务边界，知识与资料仍由本机保存，不恢复外部数据库或对象服务。[#22](https://github.com/jking412/Noterion/issues/22) 已交付首个 AI 实现，后续 [#31](https://github.com/jking412/Noterion/issues/31) 增加 OpenAI 兼容和 Anthropic 兼容连接；[ADR 0004](0004-space-scoped-local-store.md) 继续要求所有检索、草案和采用绑定当前空间与运行上下文。现行模型配置、来源恢复及采用边界见 [AI 能力说明](../../app/AI.md)，最新修复由 [#34](https://github.com/jking412/Noterion/issues/34) 承接。
