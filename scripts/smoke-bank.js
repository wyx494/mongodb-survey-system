'use strict';

/**
 * 第二阶段的冒烟检查：题库、版本、共享、引用、跨问卷统计。
 * 用法：node scripts/smoke-bank.js
 */
const base = process.argv[2] || 'http://127.0.0.1:3000';

function client() {
  let cookie = '';
  return {
    async req(path, options = {}) {
      const init = { method: options.method || 'GET', headers: { ...(options.headers || {}) }, redirect: 'manual' };
      if (options.body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }
      if (cookie) init.headers.cookie = cookie;
      const res = await fetch(base + path, init);
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, json, text };
    },
  };
}

function ok(name, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
  return condition;
}

(async () => {
  const demo = client();
  let allOk = true;

  allOk &= ok('登录', (await demo.req('/api/auth/login', { method: 'POST', body: { username: 'demo', password: 'demo123' } })).status === 200);

  const page = await demo.req('/questions');
  allOk &= ok('题库页面', page.status === 200 && page.text.includes('题库'));

  const list = await demo.req('/api/questions');
  const questions = (list.json && list.json.questions) || [];
  allOk &= ok('题库列表', list.status === 200 && questions.length > 0, `${questions.length} 道题`);

  const target = questions[0];
  if (!target) process.exit(1);

  const detail = await demo.req(`/api/questions/${target._id}`);
  allOk &= ok('题目详情', detail.status === 200 && detail.json.versions.length >= 1, `v${detail.json.question.currentVersion}`);

  const oldVersion = detail.json.question.currentVersion;
  const current = detail.json.versions.find((v) => v.version === oldVersion);

  const newVersion = await demo.req(`/api/questions/${target._id}/versions`, {
    method: 'POST',
    body: {
      type: current.type,
      title: current.title + '（新版本）',
      options: current.options,
      constraints: current.constraints,
      note: '冒烟检查创建',
    },
  });
  allOk &= ok('创建新版本', newVersion.status === 201, `v${newVersion.json && newVersion.json.version}`);

  const after = await demo.req(`/api/questions/${target._id}`);
  allOk &= ok('版本数增加', after.json.question.currentVersion === oldVersion + 1);

  const restore = await demo.req(`/api/questions/${target._id}/restore`, {
    method: 'POST',
    body: { version: 1 },
  });
  allOk &= ok('恢复旧版本', restore.status === 200, `v${restore.json && restore.json.version}`);

  const stats = await demo.req(`/api/questions/${target._id}/stats`);
  allOk &= ok('跨问卷统计', stats.status === 200 && stats.json.stats.total >= 0, `total=${stats.json.stats.total}`);

  const usage = await demo.req(`/api/questions/${target._id}/usage`);
  allOk &= ok('引用反查', usage.status === 200 && Array.isArray(usage.json.surveys), `${usage.json.surveys.length} 份问卷`);

  // 共享：注册一个临时用户，共享后它能看见
  const mate = client();
  const register = await mate.req('/api/auth/register', {
    method: 'POST',
    body: { username: `mate_${Date.now().toString(36)}`, password: 'secret123' },
  });
  if (register.status === 201) {
    const share = await demo.req(`/api/questions/${target._id}/share`, {
      method: 'POST',
      body: { username: register.json.user.username },
    });
    allOk &= ok('共享题目', share.status === 200);
    const mateList = await mate.req('/api/questions');
    const found = (mateList.json.questions || []).some((q) => String(q._id) === String(target._id));
    allOk &= ok('被共享人可见', found);
  } else {
    allOk &= ok('注册临时用户', false, register.text);
  }

  process.exit(allOk ? 0 : 1);
})().catch((err) => {
  console.error('检查失败：', err);
  process.exit(1);
});
