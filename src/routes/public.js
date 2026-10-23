'use strict';

const express = require('express');
const { requireAuth } = require('../auth');
const { validateSubmission } = require('../services/validate');

/**
 * 公开侧接口：填写者用短链访问、提交答卷。
 * 虽然叫“公开”，但按需求，填写前仍然需要登录。
 */
module.exports = function publicRoutes(db) {
  const router = express.Router();
  const surveys = db.collection('surveys');
  const responses = db.collection('responses');

  async function findBySlug(slug) {
    return surveys.findOne({ slug });
  }

  function publicShape(survey) {
    return {
      id: survey._id,
      slug: survey.slug,
      title: survey.title,
      description: survey.description,
      anonymous: survey.anonymous,
      allowMultiple: survey.allowMultiple,
      deadline: survey.deadline,
      status: survey.status,
      questions: survey.questions,
    };
  }

  function closedReason(survey) {
    if (survey.status === 'closed') return '问卷已关闭';
    if (survey.deadline && new Date(survey.deadline).getTime() < Date.now()) return '问卷已过截止时间';
    return null;
  }

  router.get('/surveys/:slug', async (req, res, next) => {
    try {
      const survey = await findBySlug(req.params.slug);
      if (!survey || survey.status === 'draft') {
        return res.status(404).json({ error: '问卷不存在' });
      }
      res.json({ survey: publicShape(survey), closedReason: closedReason(survey) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/surveys/:slug/responses', requireAuth, async (req, res, next) => {
    try {
      const survey = await findBySlug(req.params.slug);
      if (!survey || survey.status === 'draft') {
        return res.status(404).json({ error: '问卷不存在' });
      }

      const reason = closedReason(survey);
      if (reason) return res.status(409).json({ error: reason });

      if (!survey.allowMultiple) {
        const existing = await responses.findOne({
          surveyId: survey._id,
          respondentId: req.user._id,
        });
        if (existing) return res.status(409).json({ error: '你已经填写过这份问卷了' });
      }

      const result = validateSubmission(survey, req.body.answers);
      if (!result.ok) {
        return res.status(400).json({ error: '提交的答案不合法', details: result.errors });
      }

      const questionMap = new Map((survey.questions || []).map((q) => [q.qid, q]));
      const answers = result.answers.map((answer) => {
        const source = questionMap.get(answer.qid);
        return {
          ...answer,
          questionId: source ? source.questionId : null,
          version: source ? source.version : null,
        };
      });

      const doc = {
        surveyId: survey._id,
        respondentId: survey.anonymous ? null : req.user._id,
        anonymous: survey.anonymous,
        answers,
        path: result.path,
        submittedAt: new Date(),
      };
      const inserted = await responses.insertOne(doc);

      res.status(201).json({ ok: true, responseId: inserted.insertedId });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
