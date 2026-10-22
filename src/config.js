'use strict';

/**
 * 全局配置。所有可变项都从环境变量读取，便于部署和测试。
 */
const path = require('node:path');

module.exports = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  dbName: process.env.DB_NAME || 'survey_system',
  // 会话有效期（默认 7 天）
  sessionTtlMs: Number(process.env.SESSION_TTL_DAYS || 7) * 24 * 60 * 60 * 1000,
  cookieName: 'sid',
  viewsDir: path.join(__dirname, 'views'),
  publicDir: path.join(__dirname, '..', 'public'),
};
