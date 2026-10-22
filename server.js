'use strict';

const config = require('./src/config');
const { connect, ensureSchema } = require('./src/db');
const createApp = require('./src/app');

async function main() {
  const db = await connect({ uri: config.mongoUri, dbName: config.dbName });
  await ensureSchema(db);

  const app = createApp(db);
  app.listen(config.port, () => {
    console.log(`问卷系统已启动：http://localhost:${config.port}`);
    console.log(`数据库：${config.mongoUri}/${config.dbName}`);
  });
}

main().catch((err) => {
  console.error('启动失败：', err.message);
  console.error('请确认 MongoDB 已启动，并且 MONGODB_URI 配置正确。');
  process.exit(1);
});
