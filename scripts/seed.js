'use strict';

/**
 * 演示数据：一个账号、一份已发布问卷、几份不同路径的答卷。
 * 账号：demo / demo123
 */
const config = require('../src/config');
const { connect, ensureSchema, close } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { generateSlug } = require('../src/services/survey');
const { computePath } = require('../src/services/jump');

const QUESTIONS = [
  {
    qid: 'q1',
    type: 'single',
    title: '你现在读大几？',
    required: true,
    options: [
      { key: 'A', label: '大一' },
      { key: 'B', label: '大二' },
      { key: 'C', label: '大三' },
      { key: 'D', label: '大四' },
    ],
    constraints: {},
    jumps: [{ when: { option: 'D' }, to: 'q4' }],
  },
  {
    qid: 'q2',
    type: 'multiple',
    title: '你平时主要用哪些方式学习？',
    required: true,
    options: [
      { key: 'A', label: '看视频' },
      { key: 'B', label: '读文档' },
      { key: 'C', label: '写代码练习' },
      { key: 'D', label: '和同学讨论' },
    ],
    constraints: { minSelect: 1, maxSelect: 3 },
    jumps: [{ when: { includes: 'A' }, to: 'q4' }],
  },
  {
    qid: 'q3',
    type: 'number',
    title: '你平均每周自学多少小时？',
    required: true,
    options: [],
    constraints: { min: 0, max: 60, integer: true },
    jumps: [],
  },
  {
    qid: 'q4',
    type: 'text',
    title: '对这门课有什么建议？',
    required: false,
    options: [],
    constraints: { minLength: 5, maxLength: 200 },
    jumps: [],
  },
];

const DRAFT_QUESTIONS = [
  {
    qid: 'q1',
    type: 'single',
    title: '你想加入哪个部门？',
    required: true,
    options: [
      { key: 'A', label: '技术部' },
      { key: 'B', label: '宣传部' },
      { key: 'C', label: '外联部' },
    ],
    constraints: {},
    jumps: [{ when: { option: 'C' }, to: 'q3' }],
  },
  {
    qid: 'q2',
    type: 'multiple',
    title: '你擅长哪些技能？',
    required: true,
    options: [
      { key: 'A', label: '写代码' },
      { key: 'B', label: '做设计' },
      { key: 'C', label: '写文案' },
    ],
    constraints: { minSelect: 1, maxSelect: 2 },
    jumps: [],
  },
  {
    qid: 'q3',
    type: 'text',
    title: '简单介绍一下自己',
    required: false,
    options: [],
    constraints: { minLength: 10, maxLength: 200 },
    jumps: [],
  },
];

async function main() {
  const db = await connect({ uri: config.mongoUri, dbName: config.dbName });
  await ensureSchema();

  const users = db.collection('users');
  const surveys = db.collection('surveys');
  const responses = db.collection('responses');

  let user = await users.findOne({ usernameLower: 'demo' });
  if (!user) {
    const { salt, hash } = hashPassword('demo123');
    const result = await users.insertOne({
      username: 'demo',
      usernameLower: 'demo',
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date(),
    });
    user = { _id: result.insertedId };
    console.log('已创建演示账号：demo / demo123');
  }

  let survey = await surveys.findOne({ ownerId: user._id });
  if (!survey) {
    const now = new Date();
    const doc = {
      ownerId: user._id,
      slug: generateSlug(),
      title: '课程学习体验调查',
      description: '几道小题，了解一下大家的学习习惯，大约一分钟。',
      anonymous: false,
      allowMultiple: true,
      status: 'published',
      deadline: null,
      questions: QUESTIONS,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    };
    const result = await surveys.insertOne(doc);
    survey = { ...doc, _id: result.insertedId };
    console.log(`已创建演示问卷：/survey/${survey.slug}`);
  }

  let draft = await surveys.findOne({ ownerId: user._id, status: 'draft' });
  if (!draft) {
    const now = new Date();
    const doc = {
      ownerId: user._id,
      slug: generateSlug(),
      title: '社团招新报名（草稿示例）',
      description: '这份还是草稿，用来演示题目编辑和跳转配置。',
      anonymous: false,
      allowMultiple: true,
      status: 'draft',
      deadline: null,
      questions: DRAFT_QUESTIONS,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    const result = await surveys.insertOne(doc);
    draft = { ...doc, _id: result.insertedId };
    console.log('已创建草稿问卷（用于演示编辑页）。');
  }

  const existing = await responses.countDocuments({ surveyId: survey._id });
  if (existing === 0) {    const samples = [
      ['B', ['A', 'C'], 8, '希望多讲一些实际项目里的例子。'],
      ['A', ['B', 'C', 'D'], 12, ''],
      ['D', null, null, '作业量有点大，但能学到东西。'],
      ['C', ['A'], null, '视频质量不错，就是有点长。'],
      ['B', ['B'], 5, ''],
    ];

    for (const [grade, styles, hours, advice] of samples) {
      const answerMap = new Map();
      answerMap.set('q1', grade);
      if (styles) answerMap.set('q2', styles);
      if (hours != null) answerMap.set('q3', hours);
      if (advice) answerMap.set('q4', advice);

      const path = computePath(QUESTIONS, answerMap);
      const answers = path
        .filter((qid) => answerMap.has(qid))
        .map((qid) => ({ qid, value: answerMap.get(qid) }));

      await responses.insertOne({
        surveyId: survey._id,
        respondentId: user._id,
        anonymous: false,
        answers,
        path,
        submittedAt: new Date(Date.now() - Math.random() * 86400000),
      });
    }
    console.log('已写入 5 份演示答卷。');
  }

  await close();
  console.log('演示数据准备完成。');
}

main().catch(async (err) => {
  console.error('写入演示数据失败：', err.message);
  await close();
  process.exit(1);
});
