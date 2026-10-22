'use strict';

/**
 * 填写页：一次只显示一道题，按规则跳转。
 *
 * 这里的跳转判断只是为了即时体验；最终以服务端重新计算的路径为准。
 */
(function () {
  const data = window.__FILL__;
  if (!data) return;

  const questions = data.questions || [];
  const answers = new Map();
  let index = 0;
  let submitting = false;

  const area = document.getElementById('question-area');
  const errorEl = document.getElementById('fill-error');
  const nextBtn = document.getElementById('next-btn');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  const indexById = new Map(questions.map((q, i) => [q.qid, i]));

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function matchRule(rule, answer) {
    if (!rule || !rule.when) return false;
    const when = rule.when;
    if (typeof answer === 'string') return when.option === answer;
    if (Array.isArray(answer)) return typeof when.includes === 'string' && answer.includes(when.includes);
    if (typeof answer === 'number' && Number.isFinite(answer)) {
      switch (when.op) {
        case 'eq': return answer === when.value;
        case 'neq': return answer !== when.value;
        case 'gt': return answer > when.value;
        case 'gte': return answer >= when.value;
        case 'lt': return answer < when.value;
        case 'lte': return answer <= when.value;
        case 'between': return answer >= when.min && answer <= when.max;
        default: return false;
      }
    }
    return false;
  }

  function nextIndexFor(question, answer) {
    const rule = (question.jumps || []).find((r) => matchRule(r, answer));
    if (rule) {
      const target = indexById.get(rule.to);
      if (target !== undefined) return target;
    }
    return index + 1;
  }

  function renderQuestion() {
    const question = questions[index];
    let body = '';

    if (question.type === 'single') {
      body = `<div class="choice-list">${(question.options || [])
        .map(
          (o) => `<label class="choice-item"><input type="radio" name="choice" value="${escapeHtml(o.key)}"> <span>${escapeHtml(o.label)}</span></label>`
        )
        .join('')}</div>`;
    } else if (question.type === 'multiple') {
      const c = question.constraints || {};
      const hints = [];
      if (c.exactSelect != null) hints.push(`必须选 ${c.exactSelect} 个`);
      else {
        if (c.minSelect != null) hints.push(`至少选 ${c.minSelect} 个`);
        if (c.maxSelect != null) hints.push(`最多选 ${c.maxSelect} 个`);
      }
      body = `<div class="choice-list">${(question.options || [])
        .map(
          (o) => `<label class="choice-item"><input type="checkbox" name="choice" value="${escapeHtml(o.key)}"> <span>${escapeHtml(o.label)}</span></label>`
        )
        .join('')}</div>
        ${hints.length ? `<p class="muted small">${hints.join('，')}</p>` : ''}`;
    } else if (question.type === 'text') {
      const c = question.constraints || {};
      const hints = [];
      if (c.minLength != null) hints.push(`至少 ${c.minLength} 字`);
      if (c.maxLength != null) hints.push(`最多 ${c.maxLength} 字`);
      body = `<textarea id="answer-input" rows="4" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font:inherit"></textarea>
        ${hints.length ? `<p class="muted small">${hints.join('，')}</p>` : ''}`;
    } else {
      const c = question.constraints || {};
      const hints = [];
      if (c.min != null) hints.push(`不小于 ${c.min}`);
      if (c.max != null) hints.push(`不大于 ${c.max}`);
      if (c.integer) hints.push('必须是整数');
      body = `<input id="answer-input" type="number" step="any" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font:inherit">
        ${hints.length ? `<p class="muted small">${hints.join('，')}</p>` : ''}`;
    }

    area.innerHTML = `
      <div class="card">
        <h2>第 ${index + 1} 题${question.required ? ' <span class="badge">必答</span>' : ''}</h2>
        <p>${escapeHtml(question.title)}</p>
        ${body}
      </div>`;

    const percent = Math.round(((index + 1) / Math.max(1, questions.length)) * 100);
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressText) progressText.textContent = `第 ${index + 1} 题 / 共 ${questions.length} 题`;
    if (nextBtn) nextBtn.textContent = index + 1 >= questions.length ? '提交' : '下一题';
  }

  function readValue(question) {
    if (question.type === 'single') {
      const checked = area.querySelector('input[name="choice"]:checked');
      return checked ? checked.value : undefined;
    }
    if (question.type === 'multiple') {
      return [...area.querySelectorAll('input[name="choice"]:checked')].map((el) => el.value);
    }
    if (question.type === 'text') {
      const input = area.querySelector('#answer-input');
      return input ? input.value.trim() : undefined;
    }
    const input = area.querySelector('#answer-input');
    if (!input || input.value === '') return undefined;
    return Number(input.value);
  }

  function isBlank(value) {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  }

  function validate(question, value) {
    if (isBlank(value)) {
      return question.required ? '这道题是必答题' : null;
    }
    const c = question.constraints || {};
    if (question.type === 'multiple') {
      if (c.exactSelect != null && value.length !== c.exactSelect) return `需要正好选择 ${c.exactSelect} 个选项`;
      if (c.minSelect != null && value.length < c.minSelect) return `至少需要选择 ${c.minSelect} 个选项`;
      if (c.maxSelect != null && value.length > c.maxSelect) return `最多只能选择 ${c.maxSelect} 个选项`;
    }
    if (question.type === 'text') {
      if (c.minLength != null && value.length < c.minLength) return `至少需要输入 ${c.minLength} 个字`;
      if (c.maxLength != null && value.length > c.maxLength) return `最多只能输入 ${c.maxLength} 个字`;
    }
    if (question.type === 'number') {
      if (!Number.isFinite(value)) return '请填写数字';
      if (c.integer && !Number.isInteger(value)) return '必须填写整数';
      if (c.min != null && value < c.min) return `不能小于 ${c.min}`;
      if (c.max != null && value > c.max) return `不能大于 ${c.max}`;
    }
    return null;
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    nextBtn.disabled = true;
    nextBtn.textContent = '提交中…';

    const payload = [...answers.entries()].map(([qid, value]) => ({ qid, value }));
    try {
      const res = await fetch(`/api/public/surveys/${data.slug}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(result.details) ? result.details : [];
        throw new Error([result.error, ...details].filter(Boolean).join('\n'));
      }
      window.location.href = `/survey/${data.slug}/thanks`;
    } catch (err) {
      submitting = false;
      nextBtn.disabled = false;
      nextBtn.textContent = '提交';
      errorEl.textContent = err.message;
    }
  }

  nextBtn.addEventListener('click', () => {
    const question = questions[index];
    const value = readValue(question);
    const problem = validate(question, value);
    if (problem) {
      errorEl.textContent = problem;
      return;
    }

    errorEl.textContent = '';
    if (!isBlank(value)) answers.set(question.qid, value);

    const next = nextIndexFor(question, value);
    if (next >= questions.length) {
      submit();
      return;
    }
    index = next;
    renderQuestion();
  });

  renderQuestion();
})();
