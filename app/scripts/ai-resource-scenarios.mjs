// Resource integration exercises the shipped Windows UI against a local provider.
// DOM observations are read-only; every business action uses a visible control.
import path from 'node:path';
import { startAiFixture, AI_FIXTURE_TEXT } from './ai-fixture-server.mjs';

export async function runResourceScenario(h) {
  const {
    out, assert, fs, click, clickText, fill, text, observe, all, until,
    expectText, capture, check, settings, candidates, selectKnowledge,
    localSearch, selectCandidate,
  } = h;
  const fixture = await startAiFixture();
  const title = 'AI 资料整合验收学习笔记';
  const linkTitle = 'AI 资料整合验收外部链接';
  const sourceFile = path.resolve(out, 'resource-learning-source.md');
  const sourceName = path.basename(sourceFile);
  const resourceRow = `//article[@aria-label='学习资料：${title}']`;
  const resourceAction = label => `${resourceRow}//button[normalize-space(.)='${label}']`;
  // Only this newly-created fixture may be unlinked. Managed copies are accessed
  // exclusively through the application and are never removed by the harness.
  assert.equal(path.dirname(sourceFile), path.resolve(out));

  async function previewSavedResource() {
    await click(resourceAction('查看资料'), 'xpath');
    await expectText('dialog h2', title);
    await expectText('.text-preview', AI_FIXTURE_TEXT);
  }

  async function importSavedText(duplicate = false) {
    await clickText('资料库');
    await click(resourceAction('导入知识'), 'xpath');
    await expectText('.ai-context-banner', title);
    await clickText('读取这份文本');
    await until(
      async () => await observe('return document.querySelector("[data-testid=ai-source]").value;') === AI_FIXTURE_TEXT,
      'managed Markdown is read into the visible AI input',
    );
    await click('[data-testid="ai-extract"]');
    assert.equal(await candidates(), duplicate ? 0 : 3);
  }

  try {
    await settings(fixture.baseUrl('good'), 'fixture-only-key');

    await check('a Markdown resource is copied through the UI and remains readable after the original is removed', async () => {
      await fs.writeFile(sourceFile, AI_FIXTURE_TEXT, { encoding: 'utf8', flag: 'wx' });
      await clickText('资料库');
      await clickText('添加资料');
      await fill('[aria-label="资料文件路径"]', sourceFile);
      await fill('[aria-label="资料名称"]', title);
      await clickText('保存资料');
      await until(async () => !(await all('.resource-add-form')).length, 'native resource copy and record finish');
      await expectText('.library-list', title);
      await expectText('.library-list', '就绪');
      await fs.unlink(sourceFile);
      await assert.rejects(fs.access(sourceFile), { code: 'ENOENT' });
      await previewSavedResource();
      await capture('07-managed-markdown-copy');
      await clickText('关闭预览');
      return { sourceRemoved: true, managedCopyReadable: true, sourceName };
    });

    await check('resource-originated AI extraction exposes evidence and preserves the default source on adopted knowledge', async () => {
      await importSavedText();
      await selectCandidate('进入容器终端');
      await expectText('.ai-evidence', '来自原文');
      await expectText('.ai-evidence', '进入容器终端');
      const associated = await observe(`
        const fieldset = [...document.querySelectorAll('.ai-candidate-topics')]
          .find(element => element.querySelector('legend')?.textContent.trim() === '关联资料');
        const label = [...(fieldset?.querySelectorAll('label') || [])]
          .find(element => element.textContent.trim() === arguments[0]);
        return Boolean(label?.querySelector('input')?.checked);
      `, [title]);
      assert.equal(associated, true, 'the source resource is selected on the candidate');
      await capture('08-resource-candidates');
      await click('[data-testid="ai-adopt"]');
      await expectText('[data-testid="ai-adopted"]', '知识已保存到本机');
      await selectKnowledge('进入容器终端');
      await expectText('[data-testid="knowledge-details"]', 'docker exec');
      await expectText('[data-testid="knowledge-details"] .resources-column', title);
      await click('[data-testid="knowledge-details"] .resource-row');
      await expectText('.text-preview', AI_FIXTURE_TEXT);
      await capture('09-adopted-resource-preview');
      await clickText('关闭预览');
      return { candidates: 3, evidenceVisible: true, defaultSourceOpenable: true };
    });

    await check('grounded UI answering allows selected text context and exposes a valid knowledge citation', async () => {
      await clickText('知识图谱');
      await click('[data-testid="ai-search-mode"]');
      await clickText('回答问题');
      await click('.ai-text-context summary');
      await click(`//details[contains(@class,'ai-text-context')]//label[normalize-space(.)='${title}']/input`, 'xpath');
      const allowedTextSelected = await observe(`
        const label = [...document.querySelectorAll('.ai-text-context label')]
          .find(element => element.textContent.trim() === arguments[0]);
        return Boolean(label?.querySelector('input')?.checked);
      `, [title]);
      assert.equal(allowedTextSelected, true);
      await fill('[data-testid="ai-question"]', '根据我的知识和选中的学习笔记，怎样进入容器终端？');
      await click('[data-testid="ai-submit"]');
      await until(
        async () => (await all('[data-testid="ai-output"]')).length || (await all('[data-testid="ai-error"]')).length,
        'answer completes or reports an explicit provider failure',
        30000,
      );
      assert.equal((await all('[data-testid="ai-error"]')).length, 0);
      await expectText('[data-testid="ai-output"]', 'docker exec');
      assert.ok((await all('[data-testid="ai-output"] .ai-source')).length > 0);
      assert.equal(await observe('return document.querySelector("[data-testid=ai-output] .ai-source").disabled;'), false);
      await click('[data-testid="ai-output"] .ai-source');
      await expectText('[data-testid="knowledge-details"]', '进入容器终端');
      await expectText('[data-testid="knowledge-details"]', 'docker exec');
      await capture('10-resource-grounded-answer');
      return { selectedTextContext: true, groundedAnswer: true, citationNavigable: true };
    });

    await check('deleting adopted knowledge keeps its saved resource readable', async () => {
      await selectKnowledge('进入容器终端');
      await click('[data-testid="point-menu"]');
      await click('[data-testid="delete-point"]');
      await expectText('dialog', '将删除');
      await expectText('dialog', '将保留');
      await expectText('dialog', '资料及其文件均保留');
      await expectText('dialog', '删除后无法撤销');
      await click("//dialog//button[starts-with(normalize-space(.),'确认删除')]", 'xpath');
      await until(async () => !(await all('dialog')).length, 'confirmed knowledge deletion completes');
      await localSearch('进入容器终端');
      assert.equal((await all('.result-list .result-item')).length, 0);
      await clickText('资料库');
      await previewSavedResource();
      await expectText('.text-preview', 'docker exec');
      await clickText('关闭预览');
      return { knowledgeDeleted: true, resourceRetained: true };
    });

    await check('repeating the same resource text reports prior adoption without reviving deleted knowledge or exposing IDs', async () => {
      const requestsBeforeRepeat = fixture.requests.length;
      await importSavedText(true);
      assert.equal(fixture.requests.length, requestsBeforeRepeat, 'known repeat is resolved locally without another provider request');
      await expectText('[aria-label="AI 候选预览"]', '这份输入已经处理过');
      await click('[data-testid="ai-adopt"]');
      await expectText('[data-testid="ai-adopted"]', '这份输入已经采用');
      await localSearch('进入容器终端');
      assert.equal((await all('.result-list .result-item')).length, 0);
      await clickText('导入记录');
      await expectText('.ai-record-details', sourceName);
      await expectText('.ai-record-contributions', '知识点已移除');
      assert.equal((await all('.ai-record-list button')).length, 1, 'exact repeat reuses the same import record');
      const recordText = await text('.ai-record-details');
      assert.doesNotMatch(recordText, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'visible record never falls back to internal identity');
      assert.equal(await observe(`return [...document.querySelectorAll('.ai-record-contributions button')].some(element => element.textContent.includes('知识点已移除') && element.disabled);`), true);
      await capture('11-resource-repeat-after-delete');
      return { exactRepeat: true, deletedKnowledgeRemainsAbsent: true, removedContributionLabel: true };
    });

    await check('a link resource enters AI import as an association without pretending to convert its content', async () => {
      await clickText('资料库');
      await clickText('添加资料');
      await clickText('网页链接');
      await fill('[aria-label="资料名称"]', linkTitle);
      await fill('[aria-label="网页地址"]', 'https://example.com/noterion-resource-fixture');
      await clickText('保存资料');
      await until(async () => !(await all('.resource-add-form')).length, 'link resource record is saved');
      await click(`//article[@aria-label='学习资料：${linkTitle}']//button[normalize-space(.)='导入知识']`, 'xpath');
      await expectText('.ai-context-banner', linkTitle);
      await expectText('.ai-context-banner', '仅作为关联来源');
      await expectText('.ai-context-banner', '转文字');
      assert.equal(await observe('return document.querySelector("[data-testid=ai-source]").value;'), '');
      assert.equal(await observe(`return [...document.querySelectorAll('.ai-context-banner button')].some(element => element.textContent.trim() === '读取这份文本');`), false);
      await capture('12-link-association-only');
      return { linkWasNotOpened: true, bodyWasNotFetched: true, pureTextBoundaryVisible: true };
    });

    await fs.writeFile(path.join(out, 'resource-fixture-requests.json'), JSON.stringify(fixture.requests, null, 2));
  } finally {
    await fixture.close();
  }
}
