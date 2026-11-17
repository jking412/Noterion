// Synthetic v2 database only: never reads or opens the user's normal data root.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function createLegacyFixture(config) {
  const root = path.join(config, 'data');
  await fs.mkdir(path.join(root, 'files'), { recursive: true });
  const database = path.join(root, 'noterion.sqlite3');
  try { await fs.access(database); throw new Error('Fixture destination already contains a database'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const themeId = '00000000-0000-4000-8000-000000000001';
  const pointId = '00000000-0000-4000-8000-000000000002';
  const resourceId = '00000000-0000-4000-8000-000000000003';
  const source = '旧版学习笔记：Docker 容器使用独立的文件系统。';
  await fs.writeFile(path.join(root, 'files', resourceId + '.txt'), source);
  const facts = {
    points: [
      { id: themeId, name: 'Docker', description: '旧版主题内容', topicIds: [], resourceIds: [resourceId], isTheme: true, color: '#123456' },
      { id: pointId, name: '共享知识', description: '默认空间的个人理解', topicIds: [themeId], resourceIds: [resourceId], isTheme: false, color: '#a14f32' },
    ],
    resources: [{ id: resourceId, title: '旧版学习资料', kind: 'text', filename: '旧版笔记.txt', mime: 'text/plain; charset=utf-8', size: Buffer.byteLength(source) }],
    positions: { [themeId]: { x: -160, y: 40 }, [pointId]: { x: 180, y: 90 } },
  };
  const record = { id: 'legacy-record', sourceName: '旧版笔记.txt', createdAt: 1700000000, pointIds: [pointId], added: 1, updated: 0, reused: 0, sourceResourceIds: [resourceId], fingerprint: 'legacy-input', mappings: { old: pointId } };
  const db = new DatabaseSync(database);
  try {
    db.exec(`PRAGMA application_id=1313821765; PRAGMA user_version=2;
      CREATE TABLE noterion_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0),facts TEXT NOT NULL);
      CREATE TABLE ai_import_records(id TEXT PRIMARY KEY NOT NULL,record_json TEXT NOT NULL);
      CREATE TABLE ai_adoption_receipts(operation_id TEXT PRIMARY KEY NOT NULL,payload_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,record_json TEXT NOT NULL);
      CREATE INDEX ai_receipts_fingerprint ON ai_adoption_receipts(fingerprint);`);
    db.prepare('INSERT INTO noterion_state VALUES(1,7,?)').run(JSON.stringify(facts));
    db.prepare('INSERT INTO ai_import_records VALUES(?,?)').run(record.id, JSON.stringify(record));
    db.prepare('INSERT INTO ai_adoption_receipts VALUES(?,?,?,?)').run('legacy-operation', 'legacy-payload', record.fingerprint, JSON.stringify(record));
  } finally { db.close(); }
  return { root, facts, record, source, themeId, pointId, resourceId };
}
