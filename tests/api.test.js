'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { connect, ensureSchema, close } = require('../src/db');
const createApp = require('../src/app');

let db;
let server;
let base;

const QUESTIONS = [
  {
    qid: 'q1', type: 'single', title: '你现在读大几？', required: true,
    options: [{ key: 'A', label: '大一' }, { key: 'B', label: '大二' }, { key: 'C', label: '大三' }, { key: 'D', label: '大四' }],
    constraints: {}, jumps: [{ when: { option: 'D' }, to: 'q4' }],
  },
  {
    qid: 'q2', type: 'multiple', title: '主要学习方式', required: true,
    options: [{ key: 'A', label: '看视频' }, { key: 'B', label: '读文档' }, { key: 'C', label: '写代码' }],
    constraints: { minSelect: 1, maxSelect: 2 }, jumps: [],
  },
  {
    qid: 'q3', type: 'number', title: '每周自学小时数', required: true,
    options: [], constraints: { min: 0, max: 60, integer: true }, jumps: [],
  },
  {
    qid: 'q4', type: 'text', title: '建议', required: false,
    options: [], constraints: { minLength: 5, maxLength: 200 }, jumps: [],
  },
];

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
      } catch {
        json = null;
      }
      return { status: res.status, json, text };
    },
    get cookie() {
      return cookie;
    },
  };
}

async function register(client, username) {
  const res = await client.req('/api/auth/register', {
    method: 'POST',
    body: { username, password: 'secret123' },
  });
  assert.equal(res.status, 201, `注册失败：${res.text}`);
  return res.json.user;
}

async function createSurvey(client, options = {}) {
  const res = await client.req('/api/surveys', {
    method: 'POST',
    body: { title: options.title || '测试问卷', anonymous: options.anonymous === true, allowMultiple: options.allowMultiple !== false },
  });
  assert.equal(res.status, 201, `创建失败：${res.text}`);
  const survey = res.json.survey;

  if (options.questions) {
    const patch = await client.req(`/api/surveys/${survey._id}`, {
      method: 'PATCH',
      body: { questions: options.questions, deadline: options.deadline ?? null },
    });
    assert.equal(patch.status, 200, `保存题目失败：${patch.text}`);
  }

  if (options.publish) {
    const pub = await client.req(`/api/surveys/${survey._id}/publish`, { method: 'POST' });
    assert.equal(pub.status, 200, `发布失败：${pub.text}`);
  }

  return { id: survey._id, slug: survey.slug };
}

before(async () => {
  const dbName = `survey_test_${Date.now()}`;
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

test('问卷系统 API 全流程', async (t) => {
  const alice = makeClient();
  const bob = makeClient();
  const anon = makeClient();

  let survey;
  let submitted = 0;

  await t.test('注册后立即获得登录态', async () => {
    await register(alice, 'alice');
    const me = await alice.req('/api/auth/me');
    assert.equal(me.json.user.username, 'alice');
  });

  await t.test('未登录访问问卷接口返回 401', async () => {
    const res = await anon.req('/api/surveys');
    assert.equal(res.status, 401);
  });

  await t.test('创建草稿问卷', async () => {
    survey = await createSurvey(alice, { title: '学习习惯调查' });
    const detail = await alice.req(`/api/surveys/${survey.id}`);
    assert.equal(detail.json.survey.status, 'draft');
    assert.equal(detail.json.survey.questions.length, 0);
  });

  await t.test('保存题目和跳转规则', async () => {
    const res = await alice.req(`/api/surveys/${survey.id}`, {
      method: 'PATCH',
      body: { description: '大约一分钟', questions: QUESTIONS },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.survey.questions.length, 4);
    assert.equal(res.json.survey.questions[0].jumps[0].to, 'q4');
  });

  await t.test('空问卷不能发布', async () => {
    const empty = await createSurvey(alice, { title: '空问卷' });
    const res = await alice.req(`/api/surveys/${empty.id}/publish`, { method: 'POST' });
    assert.equal(res.status, 400);
    assert.match(res.json.details.join(''), /至少需要一道题目/);
  });

  await t.test('发布问卷', async () => {
    const res = await alice.req(`/api/surveys/${survey.id}/publish`, { method: 'POST' });
    assert.equal(res.status, 200);
    const detail = await alice.req(`/api/surveys/${survey.id}`);
    assert.equal(detail.json.survey.status, 'published');
  });

  await t.test('公开接口能读取已发布问卷', async () => {
    const res = await anon.req(`/api/public/surveys/${survey.slug}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.survey.title, '学习习惯调查');
    assert.equal(res.json.closedReason, null);
  });

  await t.test('草稿不能通过公开接口读取', async () => {
    const draft = await createSurvey(alice, { title: '还没发布' });
    const res = await anon.req(`/api/public/surveys/${draft.slug}`);
    assert.equal(res.status, 404);
  });

  await t.test('未登录不能提交答卷', async () => {
    const res = await anon.req(`/api/public/surveys/${survey.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: 'D' }] },
    });
    assert.equal(res.status, 401);
  });

  await t.test('按跳转路径提交：选 D 直接到第 4 题', async () => {
    await register(bob, 'bob');
    const res = await bob.req(`/api/public/surveys/${survey.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: 'D' }, { qid: 'q4', value: '希望多些练习' }] },
    });
    assert.equal(res.status, 201, res.text);
    submitted += 1;

    const doc = await db.collection('responses').findOne({ _id: new ObjectId(res.json.responseId) });
    assert.deepEqual(doc.path, ['q1', 'q4']);
  });

  await t.test('必答题没答会被拒绝', async () => {
    const res = await bob.req(`/api/public/surveys/${survey.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: 'A' }] },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.details.join(''), /必答/);
  });

  await t.test('多选题超过上限会被拒绝', async () => {
    const res = await bob.req(`/api/public/surveys/${survey.slug}/responses`, {
      method: 'POST',
      body: {
        answers: [
          { qid: 'q1', value: 'A' },
          { qid: 'q2', value: ['A', 'B', 'C'] },
          { qid: 'q3', value: 10 },
        ],
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.details.join(''), /最多/);
  });

  await t.test('数字题必须满足整数和范围', async () => {
    const res = await bob.req(`/api/public/surveys/${survey.slug}/responses`, {
      method: 'POST',
      body: {
        answers: [
          { qid: 'q1', value: 'A' },
          { qid: 'q2', value: ['A'] },
          { qid: 'q3', value: 10.5 },
        ],
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.details.join(''), /整数/);
  });

  await t.test('完整路径提交成功', async () => {
    const res = await bob.req(`/api/public/surveys/${survey.slug}/responses`, {
      method: 'POST',
      body: {
        answers: [
          { qid: 'q1', value: 'A' },
          { qid: 'q2', value: ['A', 'B'] },
          { qid: 'q3', value: 10 },
          { qid: 'q4', value: '讲得挺不错的' },
        ],
      },
    });
    assert.equal(res.status, 201, res.text);
    submitted += 1;

    const second = await bob.req(`/api/public/surveys/${survey.slug}/responses`, {
      method: 'POST',
      body: {
        answers: [
          { qid: 'q1', value: 'A' },
          { qid: 'q2', value: ['A', 'B'] },
          { qid: 'q3', value: 10 },
        ],
      },
    });
    assert.equal(second.status, 201, second.text);
    submitted += 1;
  });

  await t.test('统计按答卷实时聚合', async () => {
    const res = await alice.req(`/api/surveys/${survey.id}/stats`);
    assert.equal(res.status, 200);
    assert.equal(res.json.stats.total, submitted);

    const q1 = res.json.stats.questions.find((q) => q.qid === 'q1');
    assert.equal(q1.options.find((o) => o.key === 'A').count, 2);
    assert.equal(q1.options.find((o) => o.key === 'D').count, 1);
    assert.equal(q1.options.find((o) => o.key === 'B').count, 0);

    const q3 = res.json.stats.questions.find((q) => q.qid === 'q3');
    assert.equal(q3.avg, 10);
    assert.equal(q3.totalAnswered, 2);

    const q4 = res.json.stats.questions.find((q) => q.qid === 'q4');
    assert.equal(q4.values.length, 2);
  });

  await t.test('单题统计接口', async () => {
    const res = await alice.req(`/api/surveys/${survey.id}/stats/q2`);
    assert.equal(res.status, 200);
    assert.equal(res.json.question.qid, 'q2');
    assert.equal(res.json.question.totalAnswered, 2);
  });

  await t.test('别人的问卷看不到', async () => {
    const res = await bob.req(`/api/surveys/${survey.id}`);
    assert.equal(res.status, 404);

    const stats = await bob.req(`/api/surveys/${survey.id}/stats`);
    assert.equal(stats.status, 404);
  });

  await t.test('不允许重复填写的问卷只收一份', async () => {
    const single = await createSurvey(alice, {
      title: '只能填一次',
      questions: [
        {
          qid: 'q1', type: 'single', title: '选一个', required: true,
          options: [{ key: 'A', label: '甲' }, { key: 'B', label: '乙' }],
          constraints: {}, jumps: [],
        },
      ],
      allowMultiple: false,
      publish: true,
    });

    const first = await bob.req(`/api/public/surveys/${single.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: 'A' }] },
    });
    assert.equal(first.status, 201);

    const second = await bob.req(`/api/public/surveys/${single.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: 'B' }] },
    });
    assert.equal(second.status, 409);
    assert.match(second.json.error, /已经填写过/);
  });

  await t.test('匿名问卷不保存填写人', async () => {
    const anonymous = await createSurvey(alice, {
      title: '匿名问卷',
      questions: [
        {
          qid: 'q1', type: 'text', title: '随便说点什么', required: false,
          options: [], constraints: {}, jumps: [],
        },
      ],
      anonymous: true,
      publish: true,
    });

    const res = await bob.req(`/api/public/surveys/${anonymous.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: '匿名回答' }] },
    });
    assert.equal(res.status, 201);
    const doc = await db.collection('responses').findOne({ _id: new ObjectId(res.json.responseId) });
    assert.equal(doc.respondentId, null);
    assert.equal(doc.anonymous, true);
  });

  await t.test('关闭后不能提交', async () => {
    const res = await alice.req(`/api/surveys/${survey.id}/close`, { method: 'POST' });
    assert.equal(res.status, 200);

    const blocked = await bob.req(`/api/public/surveys/${survey.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: 'D' }] },
    });
    assert.equal(blocked.status, 409);
    assert.match(blocked.json.error, /已关闭/);
  });

  await t.test('过了截止时间不能提交', async () => {
    const expired = await createSurvey(alice, {
      title: '过期问卷',
      questions: [
        {
          qid: 'q1', type: 'text', title: '写点什么', required: false,
          options: [], constraints: {}, jumps: [],
        },
      ],
      deadline: new Date(Date.now() - 86400000).toISOString(),
      publish: true,
    });

    const res = await bob.req(`/api/public/surveys/${expired.slug}/responses`, {
      method: 'POST',
      body: { answers: [{ qid: 'q1', value: '迟到了' }] },
    });
    assert.equal(res.status, 409);
    assert.match(res.json.error, /截止/);
  });

  await t.test('退出登录后接口回到 401', async () => {
    await bob.req('/api/auth/logout', { method: 'POST' });
    const res = await bob.req('/api/surveys');
    assert.equal(res.status, 401);
  });
});
