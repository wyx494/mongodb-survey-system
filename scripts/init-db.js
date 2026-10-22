'use strict';

/**
 * 初始化数据库：建集合、建索引、装 JSON Schema 校验器。
 * 重复执行安全。
 */
const config = require('../src/config');
const { connect, ensureSchema, close } = require('../src/db');

async function main() {
  const db = await connect({ uri: config.mongoUri, dbName: config.dbName });
  await ensureSchema();
  console.log(`数据库 ${config.dbName} 初始化完成。`);

  const collections = await db.listCollections().toArray();
  for (const info of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    const indexes = await db.collection(info.name).indexes();
    console.log(`- ${info.name}: ${indexes.map((i) => i.name).join(', ')}`);
  }
  await close();
}

main().catch((err) => {
  console.error('初始化失败：', err.message);
  process.exit(1);
});
