'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { connect, ensureSchema, close } = require('../src/db');
const { migrateV2 } = require('../src/services/migrate');
const createApp = require('../src/app');

let db;
let server;
let base;

function makeClient() {
  let cookie = '';
  return {
    async req(urlPath, options = {}) {
      const { method = 'GET', body, headers = {} } = options;
      const init = { method, headers: { ...headers }, redirect: 'manual' };
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      if (cookie) init.headers.cookie = cookie;
      const res = await fetch(base + urlPath, init);
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, json, text };
    },
  };
}

async function register(client, username) {
  const res = await client.req('/api/auth/register', {
    method: 'POST',
    body: { username, password: 'secret123' },
  });
  assert.equal(res.status, 201, res.text);
}

const SINGLE = {
  qid: 'q1',
  type: 'single',
  title: '你的年龄',
  required: true,
  options: [
    { key: 'A', label: '18 以下' },
    { key: 'B', label: '18 以上' },
  ],
  constraints: {},
  jumps: [],
};

before(async () => {
  const dbName = `survey_questions_test_${Date.now()}`;
  db = await connect({ uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', dbName });
  await ensureSchema();
  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.dropDatabase();
  await close();
});

test('题库、版本、共享与跨问卷统计', async (t) => {
  const alice = makeClient();
  const bob = makeClient();
  let survey1;
  let survey2;
  let questionId;
  let version1;

  await t.test('注册两个用户', async () => {
    await register(alice, 'alice_q');
    await register(bob, 'bob_q');
  });

  await t.test('问卷里新建题目会自动进入题库', async () => {
    const created = await alice.req('/api/surveys', { method: 'POST', body: { title: '问卷一' } });
    survey1 = created.json.survey;
    const patched = await alice.req(`/api/surveys/${survey1._id}`, {
      method: 'PATCH',
      body: { questions: [SINGLE] },
    });
    assert.equal(patched.status, 200, patched.text);
    const stored = patched.json.survey.questions[0];
    assert.ok(stored.questionId, '应写入 questionId');
    assert.equal(stored.version, 1);
    questionId = stored.questionId;
    version1 = stored.version;

    const bank = await alice.req('/api/questions');
    assert.equal(bank.status, 200);
    assert.ok(bank.json.questions.some((q) => String(q._id) === String(questionId)));
  });

  await t.test('发布后在另一个问卷里引用同一道题', async () => {
    assert.equal((await alice.req(`/api/surveys/${survey1._id}/publish`, { method: 'POST' })).status, 200);

    const created = await alice.req('/api/surveys', { method: 'POST', body: { title: '问卷二' } });
    survey2 = created.json.survey;
    const patched = await alice.req(`/api/surveys/${survey2._id}`, {
      method: 'PATCH',
      body: { questions: [{ ...SINGLE, questionId, version: version1 }] },
    });
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.json.survey.questions[0].questionId, questionId);
    assert.equal(patched.json.survey.questions[0].title, '你的年龄');
    assert.equal((await alice.req(`/api/surveys/${survey2._id}/publish`, { method: 'POST' })).status, 200);

    const usage = await alice.req(`/api/questions/${questionId}/usage`);
    assert.equal(usage.json.surveys.length, 2);
  });

  await t.test('两个问卷的答卷能按题目汇总', async () => {
    const a = await bob.req(`/api/public/surveys/${survey1.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: 'A' }] },
    });
    assert.equal(a.status, 201, a.text);
    const b = await bob.req(`/api/public/surveys/${survey2.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: 'B' }] },
    });
    assert.equal(b.status, 201, b.text);

    const stats = await alice.req(`/api/questions/${questionId}/stats`);
    assert.equal(stats.status, 200);
    assert.equal(stats.json.stats.total, 2);
    const v1 = stats.json.stats.versions.find((v) => v.version === 1);
    assert.equal(v1.totalAnswered, 2);
    assert.equal(v1.options.find((o) => o.key === 'A').count, 1);
    assert.equal(v1.options.find((o) => o.key === 'B').count, 1);
  });

  await t.test('新版本不影响已发布问卷的快照', async () => {
    const res = await alice.req(`/api/questions/${questionId}/versions`, {
      method: 'POST',
      body: {
        type: 'single',
        title: '你的年龄段',
        options: [
          { key: 'A', label: '18 以下' },
          { key: 'B', label: '18 以上' },
        ],
        constraints: {},
        note: '改标题',
      },
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.version, 2);

    const s1 = await alice.req(`/api/surveys/${survey1._id}`);
    assert.equal(s1.json.survey.questions[0].title, '你的年龄');
    assert.equal(s1.json.survey.questions[0].version, 1);

    const created = await alice.req('/api/surveys', { method: 'POST', body: { title: '问卷三' } });
    const patched = await alice.req(`/api/surveys/${created.json.survey._id}`, {
      method: 'PATCH',
      body: { questions: [{ ...SINGLE, questionId, version: 2, title: '不重要，服务端会用题库内容' }] },
    });
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.json.survey.questions[0].title, '你的年龄段');
    assert.equal(patched.json.survey.questions[0].version, 2);
  });

  await t.test('共享后被共享人可以使用，但不能修改', async () => {
    const share = await alice.req(`/api/questions/${questionId}/share`, {
      method: 'POST',
      body: { username: 'bob_q' },
    });
    assert.equal(share.status, 200, share.text);

    const bobList = await bob.req('/api/questions');
    assert.ok(bobList.json.questions.some((q) => String(q._id) === String(questionId)));

    const forbidden = await bob.req(`/api/questions/${questionId}/versions`, {
      method: 'POST',
      body: {
        type: 'single',
        title: '我也想改',
        options: [
          { key: 'A', label: 'a' },
          { key: 'B', label: 'b' },
        ],
      },
    });
    assert.equal(forbidden.status, 400);
    assert.match(forbidden.json.error, /所有者/);
  });

  await t.test('恢复旧版本会生成新版本，内容回到旧版', async () => {
    const restored = await alice.req(`/api/questions/${questionId}/restore`, {
      method: 'POST',
      body: { version: 1 },
    });
    assert.equal(restored.status, 200, restored.text);
    assert.equal(restored.json.version, 3);

    const detail = await alice.req(`/api/questions/${questionId}`);
    const v3 = detail.json.versions.find((v) => v.version === 3);
    assert.equal(v3.title, '你的年龄');
    assert.equal(v3.restoredFrom, 1);
  });
});

test('旧数据迁移：内嵌题目变成题目 + v1，答卷补上题目引用', async () => {
  const surveys = db.collection('surveys');
  const responses = db.collection('responses');
  const owner = new ObjectId();

  const legacy = {
    ownerId: owner,
    slug: `legacy${Date.now().toString(36)}`,
    title: '第一阶段问卷',
    description: '',
    anonymous: false,
    allowMultiple: true,
    status: 'published',
    deadline: null,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    questions: [
      {
        qid: 'q1',
        type: 'text',
        title: '旧题目',
        required: false,
        options: [],
        constraints: {},
        jumps: [],
      },
    ],
  };
  const inserted = await surveys.insertOne(legacy);

  await responses.insertOne({
    surveyId: inserted.insertedId,
    respondentId: null,
    anonymous: true,
    answers: [{ qid: 'q1', value: '旧答案' }],
    path: ['q1'],
    submittedAt: new Date(),
  });

  const result = await migrateV2(db);
  assert.ok(result.surveyCount >= 1);
  assert.ok(result.questionCount >= 1);

  const migratedSurvey = await surveys.findOne({ _id: inserted.insertedId });
  assert.equal(migratedSurvey.schemaVersion, 2);
  assert.ok(migratedSurvey.questions[0].questionId);
  assert.equal(migratedSurvey.questions[0].version, 1);

  const response = await responses.findOne({ surveyId: inserted.insertedId });
  assert.ok(response.answers[0].questionId);
  assert.equal(response.answers[0].version, 1);

  const question = await db.collection('questions').findOne({ _id: response.answers[0].questionId });
  assert.equal(question.title, '旧题目');
});
