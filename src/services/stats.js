'use strict';

/**
 * 统计。
 *
 * 全部用 MongoDB 聚合管道算，不把答卷拉到 Node 里遍历。
 * 单选题：按选项分组计数；
 * 多选题：先把答案数组展开，再按选项分组；
 * 填空题：取出全部文本；
 * 数字题：求平均、最大、最小，并保留原始值用于查看。
 */
async function computeStats(db, survey) {
  const responses = db.collection('responses');
  const surveyId = survey._id;

  const total = await responses.countDocuments({ surveyId });
  const questions = [];

  for (const q of survey.questions) {
    const base = { qid: q.qid, title: q.title, type: q.type, totalAnswered: 0 };

    if (q.type === 'single' || q.type === 'multiple') {
      const pipeline = [
        { $match: { surveyId } },
        { $unwind: '$answers' },
        { $match: { 'answers.qid': q.qid } },
      ];
      if (q.type === 'multiple') {
        pipeline.push({ $unwind: '$answers.value' });
      }
      pipeline.push({ $group: { _id: '$answers.value', count: { $sum: 1 } } });

      const rows = await responses.aggregate(pipeline).toArray();
      const counts = new Map(rows.map((r) => [r._id, r.count]));
      const options = (q.options || []).map((o) => ({
        key: o.key,
        label: o.label,
        count: counts.get(o.key) || 0,
      }));
      const answered = await responses.countDocuments({ surveyId, 'answers.qid': q.qid });
      questions.push({ ...base, totalAnswered: answered, options });
      continue;
    }

    if (q.type === 'text') {
      const rows = await responses
        .aggregate([
          { $match: { surveyId } },
          { $unwind: '$answers' },
          { $match: { 'answers.qid': q.qid } },
          { $project: { _id: 0, value: '$answers.value' } },
        ])
        .toArray();
      questions.push({ ...base, totalAnswered: rows.length, values: rows.map((r) => r.value) });
      continue;
    }

    if (q.type === 'number') {
      const [row] = await responses
        .aggregate([
          { $match: { surveyId } },
          { $unwind: '$answers' },
          { $match: { 'answers.qid': q.qid } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              avg: { $avg: '$answers.value' },
              min: { $min: '$answers.value' },
              max: { $max: '$answers.value' },
              values: { $push: '$answers.value' },
            },
          },
        ])
        .toArray();

      questions.push({
        ...base,
        totalAnswered: row ? row.count : 0,
        avg: row ? Number(row.avg.toFixed(2)) : null,
        min: row ? row.min : null,
        max: row ? row.max : null,
        values: row ? row.values : [],
      });
    }
  }

  return { total, generatedAt: new Date(), questions };
}

module.exports = { computeStats };
