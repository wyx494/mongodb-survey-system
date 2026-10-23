'use strict';

/**
 * 手动冒烟检查：登录后把主要页面抓一遍，看 HTTP 状态和关键内容。
 * 用法：node scripts/check-pages.js [baseUrl]
 */
const base = process.argv[2] || 'http://127.0.0.1:3000';
let cookie = '';

async function req(path, options = {}) {
  const init = { method: options.method || 'GET', headers: { ...(options.headers || {}) }, redirect: 'manual' };
  if (options.body) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (cookie) init.headers.cookie = cookie;
  const res = await fetch(base + path, init);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, text: await res.text(), headers: res.headers };
}

function check(name, result, includes) {
  const ok = result.status === 200 && (!includes || result.text.includes(includes));
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} (${result.status})${ok ? '' : ' → ' + result.text.slice(0, 120)}`);
  return ok;
}

(async () => {
  let allOk = true;
  allOk &= check('登录页', await req('/login'), '登录');
  allOk &= check('注册页', await req('/register'), '注册');

  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'demo', password: 'demo123' } });
  console.log(`${login.status === 200 ? 'OK  ' : 'FAIL'} 登录接口 (${login.status})`);
  allOk &= login.status === 200;

  allOk &= check('我的问卷', await req('/dashboard'), '我的问卷');

  const list = await req('/api/surveys');
  const surveys = JSON.parse(list.text).surveys || [];
  if (surveys.length === 0) {
    console.log('FAIL 没有演示问卷');
    process.exit(1);
  }
  const survey = surveys.find((s) => s.status === 'published') || surveys[0];

  allOk &= check('编辑页', await req(`/surveys/${survey._id}/edit`), '编辑问卷');
  allOk &= check('统计页', await req(`/surveys/${survey._id}/stats`), '统计');
  allOk &= check('填写页', await req(`/survey/${survey.slug}`), 'window.__FILL__');
  allOk &= check('感谢页', await req(`/survey/${survey.slug}/thanks`), '提交成功');

  process.exit(allOk ? 0 : 1);
})().catch((err) => {
  console.error('检查失败：', err);
  process.exit(1);
});
