'use strict';

const express = require('express');
const config = require('./config');
const { attachUser } = require('./auth');

const authRoutes = require('./routes/auth');
const surveyRoutes = require('./routes/surveys');
const statsRoutes = require('./routes/stats');
const publicRoutes = require('./routes/public');
const pageRoutes = require('./routes/pages');

/**
 * 组装 Express 应用。把 db 作为参数传进来，测试时可以换一个测试库。
 */
function createApp(db) {
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', config.viewsDir);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(config.publicDir));
  app.use(attachUser(db));

  // 统计路由要放在问卷路由前面，否则 /:id 会先匹配掉 /:id/stats
  app.use('/api/auth', authRoutes(db));
  app.use('/api/surveys', statsRoutes(db));
  app.use('/api/surveys', surveyRoutes(db));
  app.use('/api/public', publicRoutes(db));
  app.use('/', pageRoutes(db));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: '接口不存在' });
    }
    return res.status(404).render('error', { title: '页面不存在', message: '你访问的页面不存在。' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[server error]', err);
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) {
      return res.status(500).json({ error: '服务器内部错误' });
    }
    return res.status(500).render('error', { title: '出错了', message: '服务器内部错误，请稍后再试。' });
  });

  return app;
}

module.exports = createApp;
