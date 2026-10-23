'use strict';

const express = require('express');
const { requireAuthPage, toObjectId } = require('../auth');
const { generateSlug } = require('../services/survey');
const { computeStats } = require('../services/stats');

module.exports = function pageRoutes(db) {
  const router = express.Router();
  const surveys = db.collection('surveys');
  const responses = db.collection('responses');

  async function findOwned(id, userId) {
    const objectId = toObjectId(id);
    if (!objectId) return null;
    return surveys.findOne({ _id: objectId, ownerId: userId });
  }

  router.get('/', (req, res) => {
    res.redirect(req.user ? '/dashboard' : '/login');
  });

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('login', { title: '登录', next: req.query.next || '/dashboard' });
  });

  router.get('/register', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('register', { title: '注册' });
  });

  router.get('/dashboard', requireAuthPage, async (req, res, next) => {
    try {
      const list = await surveys
        .find({ ownerId: req.user._id })
        .sort({ updatedAt: -1 })
        .toArray();

      const withCounts = await Promise.all(
        list.map(async (survey) => ({
          ...survey,
          responseCount: await responses.countDocuments({ surveyId: survey._id }),
        }))
      );

      res.render('dashboard', { title: '我的问卷', surveys: withCounts, user: req.user });
    } catch (err) {
      next(err);
    }
  });

  // 新建后直接进入编辑页
  router.post('/surveys/new', requireAuthPage, async (req, res, next) => {
    try {
      const now = new Date();
      let inserted = null;
      for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
        try {
          const doc = {
            ownerId: req.user._id,
            slug: generateSlug(),
            title: '未命名问卷',
            description: '',
            anonymous: false,
            allowMultiple: true,
            status: 'draft',
            deadline: null,
            questions: [],
            schemaVersion: 2,
            createdAt: now,
            updatedAt: now,
          };
          const result = await surveys.insertOne(doc);
          inserted = result.insertedId;
        } catch (err) {
          if (!(err && err.code === 11000)) throw err;
        }
      }
      if (!inserted) return next(new Error('生成问卷短链失败'));
      res.redirect(`/surveys/${inserted}/edit`);
    } catch (err) {
      next(err);
    }
  });

  router.get('/surveys/:id/edit', requireAuthPage, async (req, res, next) => {
    try {
      const survey = await findOwned(req.params.id, req.user._id);
      if (!survey) return res.status(404).render('error', { title: '找不到问卷', message: '问卷不存在，或不属于你。' });
      res.render('edit', { title: '编辑问卷', survey, user: req.user });
    } catch (err) {
      next(err);
    }
  });

  router.get('/surveys/:id/stats', requireAuthPage, async (req, res, next) => {
    try {
      const survey = await findOwned(req.params.id, req.user._id);
      if (!survey) return res.status(404).render('error', { title: '找不到问卷', message: '问卷不存在，或不属于你。' });
      const stats = await computeStats(db, survey);
      res.render('stats', { title: '统计', survey, stats, user: req.user });
    } catch (err) {
      next(err);
    }
  });

  router.get('/survey/:slug', requireAuthPage, async (req, res, next) => {
    try {
      const survey = await surveys.findOne({ slug: req.params.slug });
      if (!survey || survey.status === 'draft') {
        return res.status(404).render('error', { title: '找不到问卷', message: '问卷不存在，或还没有发布。' });
      }
      const closedReason =
        survey.status === 'closed'
          ? '问卷已关闭'
          : survey.deadline && new Date(survey.deadline).getTime() < Date.now()
            ? '问卷已过截止时间'
            : null;

      res.render('fill', {
        title: survey.title,
        survey,
        closedReason,
        user: req.user,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/survey/:slug/thanks', requireAuthPage, (req, res) => {
    res.render('thanks', { title: '提交成功', user: req.user });
  });

  return router;
};
