'use strict';

const express = require('express');
const { requireAuth, toObjectId } = require('../auth');
const { computeStats } = require('../services/stats');

module.exports = function statsRoutes(db) {
  const router = express.Router();
  const surveys = db.collection('surveys');

  router.use(requireAuth);

  async function loadOwned(req) {
    const id = toObjectId(req.params.id);
    if (!id) return null;
    return surveys.findOne({ _id: id, ownerId: req.user._id });
  }

  router.get('/:id/stats', async (req, res, next) => {
    try {
      const survey = await loadOwned(req);
      if (!survey) return res.status(404).json({ error: '问卷不存在' });
      const stats = await computeStats(db, survey);
      res.json({ survey: { id: survey._id, title: survey.title, slug: survey.slug }, stats });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/stats/:qid', async (req, res, next) => {
    try {
      const survey = await loadOwned(req);
      if (!survey) return res.status(404).json({ error: '问卷不存在' });
      const stats = await computeStats(db, survey);
      const question = stats.questions.find((q) => q.qid === req.params.qid);
      if (!question) return res.status(404).json({ error: '题目不存在' });
      res.json({ total: stats.total, question });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
