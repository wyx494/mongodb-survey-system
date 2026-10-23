'use strict';

const express = require('express');
const { requireAuth, toObjectId } = require('../auth');
const { generateSlug, prepareQuestions, validateForPublish } = require('../services/survey');

module.exports = function surveyRoutes(db) {
  const router = express.Router();
  const surveys = db.collection('surveys');

  async function findOwned(id, userId) {
    const objectId = toObjectId(id);
    if (!objectId) return null;
    return surveys.findOne({ _id: objectId, ownerId: userId });
  }

  function parseDeadline(input) {
    if (input === undefined) return undefined;
    if (input === null || input === '') return null;
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) throw new Error('截止时间格式不正确');
    return date;
  }

  router.use(requireAuth);

  // 我的问卷列表
  router.get('/', async (req, res, next) => {
    try {
      const list = await surveys
        .find({ ownerId: req.user._id })
        .project({ title: 1, status: 1, slug: 1, createdAt: 1, updatedAt: 1, deadline: 1 })
        .sort({ updatedAt: -1 })
        .toArray();
      res.json({ surveys: list });
    } catch (err) {
      next(err);
    }
  });

  // 新建（草稿）
  router.post('/', async (req, res, next) => {
    try {
      const now = new Date();
      let inserted = null;
      for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
        try {
          const doc = {
            ownerId: req.user._id,
            slug: generateSlug(),
            title: String(req.body.title || '未命名问卷').trim() || '未命名问卷',
            description: String(req.body.description || '').trim(),
            anonymous: req.body.anonymous === true,
            allowMultiple: req.body.allowMultiple === false ? false : true,
            status: 'draft',
            deadline: parseDeadline(req.body.deadline) ?? null,
            questions: [],
            schemaVersion: 2,
            createdAt: now,
            updatedAt: now,
          };
          const result = await surveys.insertOne(doc);
          inserted = { ...doc, _id: result.insertedId };
        } catch (err) {
          if (!(err && err.code === 11000)) throw err;
        }
      }
      if (!inserted) return res.status(500).json({ error: '生成问卷短链失败，请重试' });
      res.status(201).json({ survey: inserted });
    } catch (err) {
      next(err);
    }
  });

  // 问卷详情（含题目，仅创建者可见）
  router.get('/:id', async (req, res, next) => {
    try {
      const survey = await findOwned(req.params.id, req.user._id);
      if (!survey) return res.status(404).json({ error: '问卷不存在' });
      res.json({ survey });
    } catch (err) {
      next(err);
    }
  });

  // 修改问卷
  router.patch('/:id', async (req, res, next) => {
    try {
      const survey = await findOwned(req.params.id, req.user._id);
      if (!survey) return res.status(404).json({ error: '问卷不存在' });

      const update = { updatedAt: new Date() };

      if (req.body.title !== undefined) {
        const title = String(req.body.title).trim();
        if (!title) return res.status(400).json({ error: '标题不能为空' });
        update.title = title.slice(0, 120);
      }
      if (req.body.description !== undefined) {
        update.description = String(req.body.description).slice(0, 2000);
      }
      if (req.body.anonymous !== undefined) {
        update.anonymous = req.body.anonymous === true;
      }
      if (req.body.allowMultiple !== undefined) {
        update.allowMultiple = req.body.allowMultiple === true;
      }
      if (req.body.deadline !== undefined) {
        update.deadline = parseDeadline(req.body.deadline);
      }

      if (req.body.questions !== undefined) {
        if (survey.status !== 'draft') {
          return res.status(409).json({ error: '问卷发布后不能再修改题目，请先关闭后重新创建' });
        }
        update.questions = await prepareQuestions(db, req.user._id, req.body.questions);
      }

      await surveys.updateOne({ _id: survey._id }, { $set: update });
      const fresh = await surveys.findOne({ _id: survey._id });
      res.json({ survey: fresh });
    } catch (err) {
      if (err.message && /第 \d+ 题|questions|题号|选项|跳转/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  });

  // 发布
  router.post('/:id/publish', async (req, res, next) => {
    try {
      const survey = await findOwned(req.params.id, req.user._id);
      if (!survey) return res.status(404).json({ error: '问卷不存在' });
      if (survey.status === 'published') return res.status(409).json({ error: '问卷已经发布' });
      if (survey.status === 'closed') return res.status(409).json({ error: '问卷已关闭，不能重新发布' });

      const errors = validateForPublish(survey);
      if (errors.length > 0) return res.status(400).json({ error: '无法发布', details: errors });

      await surveys.updateOne(
        { _id: survey._id },
        { $set: { status: 'published', publishedAt: new Date(), updatedAt: new Date() } }
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // 关闭
  router.post('/:id/close', async (req, res, next) => {
    try {
      const survey = await findOwned(req.params.id, req.user._id);
      if (!survey) return res.status(404).json({ error: '问卷不存在' });
      if (survey.status === 'closed') return res.status(409).json({ error: '问卷已经关闭' });

      await surveys.updateOne(
        { _id: survey._id },
        { $set: { status: 'closed', closedAt: new Date(), updatedAt: new Date() } }
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // 删除（只能删草稿）
  router.delete('/:id', async (req, res, next) => {
    try {
      const survey = await findOwned(req.params.id, req.user._id);
      if (!survey) return res.status(404).json({ error: '问卷不存在' });
      if (survey.status !== 'draft') {
        return res.status(409).json({ error: '只能删除草稿' });
      }
      await surveys.deleteOne({ _id: survey._id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
