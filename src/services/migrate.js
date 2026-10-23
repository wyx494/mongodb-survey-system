'use strict';

/**
 * 第一阶段 → 第二阶段迁移。
 *
 * 把问卷里内嵌的题目变成题库里的“题目 + v1”，问卷改为引用，
 * 并给历史答卷补上 questionId/version，保证跨问卷统计能用。
 */
const { createQuestion } = require('./questions');

async function migrateV2(db) {
  const surveys = db.collection('surveys');
  const responses = db.collection('responses');

  let surveyCount = 0;
  let questionCount = 0;
  let responseCount = 0;

  const cursor = surveys.find({
    $or: [{ schemaVersion: { $ne: 2 } }, { schemaVersion: { $exists: false } }],
  });

  while (await cursor.hasNext()) {
    const survey = await cursor.next();
    const updatedQuestions = [];

    for (const question of survey.questions || []) {
      if (question.questionId) {
        updatedQuestions.push(question);
        continue;
      }
      const created = await createQuestion(
        db,
        survey.ownerId,
        {
          type: question.type,
          title: question.title,
          options: question.options || [],
          constraints: question.constraints || {},
        },
        { note: '从第一阶段问卷迁移', inBank: true }
      );
      updatedQuestions.push({
        ...question,
        questionId: created.question._id,
        version: 1,
      });
      questionCount += 1;
    }

    await surveys.updateOne(
      { _id: survey._id },
      { $set: { questions: updatedQuestions, schemaVersion: 2 } }
    );
    surveyCount += 1;
  }

  const allResponses = await responses.find({}).toArray();
  for (const response of allResponses) {
    const survey = await surveys.findOne({ _id: response.surveyId });
    if (!survey) continue;
    const byQid = new Map((survey.questions || []).map((q) => [q.qid, q]));
    let changed = false;
    const answers = (response.answers || []).map((answer) => {
      if (answer.questionId) return answer;
      const source = byQid.get(answer.qid);
      if (!source || !source.questionId) return answer;
      changed = true;
      return { ...answer, questionId: source.questionId, version: source.version };
    });
    if (changed) {
      await responses.updateOne({ _id: response._id }, { $set: { answers } });
      responseCount += 1;
    }
  }

  return { surveyCount, questionCount, responseCount };
}

module.exports = { migrateV2 };
