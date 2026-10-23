'use strict';

const config = require('../src/config');
const { connect, ensureSchema, close } = require('../src/db');
const { migrateV2 } = require('../src/services/migrate');

async function main() {
  const db = await connect({ uri: config.mongoUri, dbName: config.dbName });
  await ensureSchema();
  const result = await migrateV2(db);
  console.log(
    `迁移完成：问卷 ${result.surveyCount} 份，题目 ${result.questionCount} 道，答卷 ${result.responseCount} 份。`
  );
  await close();
}

main().catch((err) => {
  console.error('迁移失败：', err.message);
  process.exit(1);
});
