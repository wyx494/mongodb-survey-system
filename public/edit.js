'use strict';

/**
 * 问卷编辑器。
 *
 * 做法比较直接：题目放在一个数组里，输入时只改数组（不重绘，避免输入框失焦），
 * 只有增删题目/选项/跳转、切换题型时才整体重绘。
 */
(function () {
  const survey = window.__SURVEY__;
  const state = {
    id: survey._id,
    status: survey.status,
    questions: (survey.questions || []).map((q) => ({
      ...q,
      options: (q.options || []).map((o) => ({ ...o })),
      constraints: { ...(q.constraints || {}) },
      jumps: (q.jumps || []).map((j) => ({ ...j, when: { ...j.when } })),
    })),
  };
  const locked = state.status !== 'draft';

  const questionsEl = document.getElementById('questions');
  const messageEl = document.getElementById('save-message');

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function newQid() {
    return `q${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`;
  }

  function newQuestion() {
    return {
      qid: newQid(),
      type: 'single',
      title: '',
      required: false,
      options: [
        { key: 'A', label: '选项 A' },
        { key: 'B', label: '选项 B' },
      ],
      constraints: {},
      jumps: [],
    };
  }

  function nextOptionKey(options) {
    const used = new Set(options.map((o) => o.key));
    for (const key of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (!used.has(key)) return key;
    }
    return `O${options.length + 1}`;
  }

  function targetOptions(qi, selected) {
    return state.questions
      .map((q, index) => ({ q, index }))
      .filter(({ index }) => index > qi)
      .map(({ q, index }) => `<option value="${escapeHtml(q.qid)}" ${q.qid === selected ? 'selected' : ''}>第 ${index + 1} 题：${escapeHtml(q.title || '未命名')}</option>`)
      .join('');
  }

  function optionsHtml(q, qi) {
    return `
      <div class="options">
        ${q.options
          .map(
            (option, oi) => `
          <div class="option-row">
            <input data-field="option-key" data-qi="${qi}" data-oi="${oi}" value="${escapeHtml(option.key)}" ${locked ? 'disabled' : ''}>
            <input data-field="option-label" data-qi="${qi}" data-oi="${oi}" value="${escapeHtml(option.label)}" placeholder="选项文字" ${locked ? 'disabled' : ''}>
            ${locked ? '' : `<button type="button" class="btn small" data-action="remove-option" data-qi="${qi}" data-oi="${oi}">×</button>`}
          </div>`
          )
          .join('')}
        ${locked ? '' : `<button type="button" class="btn small" data-action="add-option" data-qi="${qi}">+ 选项</button>`}
      </div>`;
  }

  function constraintsHtml(q, qi) {
    if (q.type === 'multiple') {
      return `
        <div class="constraints">
          <label>至少选 <input type="number" min="1" data-field="minSelect" data-qi="${qi}" value="${q.constraints.minSelect ?? ''}" ${locked ? 'disabled' : ''}></label>
          <label>最多选 <input type="number" min="1" data-field="maxSelect" data-qi="${qi}" value="${q.constraints.maxSelect ?? ''}" ${locked ? 'disabled' : ''}></label>
          <label>必须选 <input type="number" min="1" data-field="exactSelect" data-qi="${qi}" value="${q.constraints.exactSelect ?? ''}" ${locked ? 'disabled' : ''}></label>
        </div>`;
    }
    if (q.type === 'text') {
      return `
        <div class="constraints">
          <label>最少字数 <input type="number" min="0" data-field="minLength" data-qi="${qi}" value="${q.constraints.minLength ?? ''}" ${locked ? 'disabled' : ''}></label>
          <label>最多字数 <input type="number" min="0" data-field="maxLength" data-qi="${qi}" value="${q.constraints.maxLength ?? ''}" ${locked ? 'disabled' : ''}></label>
        </div>`;
    }
    if (q.type === 'number') {
      return `
        <div class="constraints">
          <label>最小值 <input type="number" data-field="min" data-qi="${qi}" value="${q.constraints.min ?? ''}" ${locked ? 'disabled' : ''}></label>
          <label>最大值 <input type="number" data-field="max" data-qi="${qi}" value="${q.constraints.max ?? ''}" ${locked ? 'disabled' : ''}></label>
          <label class="check"><input type="checkbox" data-field="integer" data-qi="${qi}" ${q.constraints.integer ? 'checked' : ''} ${locked ? 'disabled' : ''}> 必须是整数</label>
        </div>`;
    }
    return '';
  }

  function jumpConditionHtml(q, qi, jump, ji) {
    const when = jump.when || {};
    if (q.type === 'single' || q.type === 'multiple') {
      const field = q.type === 'single' ? 'jump-option' : 'jump-includes';
      const current = q.type === 'single' ? when.option : when.includes;
      const options = q.options
        .map((o) => `<option value="${escapeHtml(o.key)}" ${o.key === current ? 'selected' : ''}>${escapeHtml(o.key)} · ${escapeHtml(o.label)}</option>`)
        .join('');
      return `当选择 <select data-field="${field}" data-qi="${qi}" data-ji="${ji}" ${locked ? 'disabled' : ''}>${options}</select>`;
    }

    const op = when.op || 'gte';
    const opOptions = [
      ['eq', '等于'],
      ['neq', '不等于'],
      ['gt', '大于'],
      ['gte', '大于等于'],
      ['lt', '小于'],
      ['lte', '小于等于'],
      ['between', '在区间内'],
    ]
      .map(([value, label]) => `<option value="${value}" ${op === value ? 'selected' : ''}>${label}</option>`)
      .join('');

    let valueInputs;
    if (op === 'between') {
      valueInputs = `
        <input type="number" data-field="jump-min" data-qi="${qi}" data-ji="${ji}" value="${when.min ?? ''}" placeholder="最小" ${locked ? 'disabled' : ''}>
        <input type="number" data-field="jump-max" data-qi="${qi}" data-ji="${ji}" value="${when.max ?? ''}" placeholder="最大" ${locked ? 'disabled' : ''}>`;
    } else {
      valueInputs = `<input type="number" data-field="jump-value" data-qi="${qi}" data-ji="${ji}" value="${when.value ?? ''}" placeholder="数值" ${locked ? 'disabled' : ''}>`;
    }

    return `当数值 <select data-field="jump-op" data-qi="${qi}" data-ji="${ji}" ${locked ? 'disabled' : ''}>${opOptions}</select> ${valueInputs}`;
  }

  function jumpsHtml(q, qi) {
    if (q.type === 'text') return '';
    return `
      <div class="jumps">
        <p class="muted small">跳转规则（从上往下匹配；都不命中就进入下一题）</p>
        ${(q.jumps || [])
          .map(
            (jump, ji) => `
          <div class="jump-row">
            ${jumpConditionHtml(q, qi, jump, ji)}
            跳转到
            <select data-field="jump-target" data-qi="${qi}" data-ji="${ji}" ${locked ? 'disabled' : ''}>
              <option value="">选择题目</option>
              ${targetOptions(qi, jump.to)}
            </select>
            ${locked ? '' : `<button type="button" class="btn small" data-action="remove-jump" data-qi="${qi}" data-ji="${ji}">×</button>`}
          </div>`
          )
          .join('')}
        ${locked ? '' : `<button type="button" class="btn small" data-action="add-jump" data-qi="${qi}">+ 跳转规则</button>`}
      </div>`;
  }

  function questionHtml(q, qi) {
    const types = [
      ['single', '单选题'],
      ['multiple', '多选题'],
      ['text', '填空题'],
      ['number', '数字题'],
    ]
      .map(([value, label]) => `<option value="${value}" ${q.type === value ? 'selected' : ''}>${label}</option>`)
      .join('');

    const fromBank = Boolean(q.questionId);
    const typeLabel = q.type === 'single' ? '单选' : q.type === 'multiple' ? '多选' : q.type === 'text' ? '填空' : '数字';
    const content = fromBank
      ? `
        <p class="question-text">${escapeHtml(q.title)}</p>
        ${q.type === 'single' || q.type === 'multiple'
          ? `<p class="muted small">${q.options.map((o) => `${escapeHtml(o.key)}. ${escapeHtml(o.label)}`).join('；')}</p>`
          : ''}
        <p class="muted small">
          <span class="badge">题库 v${q.version}</span>
          内容固定为所选版本；要改内容请到
          <a href="/questions/${q.questionId}" target="_blank">题目详情</a>
          创建新版本。
        </p>`
      : `
        <input class="q-title" data-field="title" data-qi="${qi}" value="${escapeHtml(q.title)}" placeholder="题目内容" ${locked ? 'disabled' : ''}>
        ${q.type === 'single' || q.type === 'multiple' ? optionsHtml(q, qi) : ''}
        ${constraintsHtml(q, qi)}`;

    return `
      <div class="card question" data-qi="${qi}">
        <div class="q-head">
          <span class="q-no">第 ${qi + 1} 题</span>
          ${fromBank
            ? `<span class="badge">${typeLabel} · 题库</span>`
            : `<select data-role="type" data-qi="${qi}" ${locked ? 'disabled' : ''}>${types}</select>`}
          ${locked ? '' : `<button type="button" class="btn small danger" data-action="remove-question" data-qi="${qi}">删除</button>`}
        </div>
        ${content}
        <label class="check"><input type="checkbox" data-field="required" data-qi="${qi}" ${q.required ? 'checked' : ''} ${locked ? 'disabled' : ''}> 必答题</label>
        ${jumpsHtml(q, qi)}
      </div>`;
  }

  function render() {
    questionsEl.innerHTML = state.questions.map((q, i) => questionHtml(q, i)).join('');
    if (state.questions.length === 0) {
      questionsEl.innerHTML = '<div class="card empty"><p class="muted">还没有题目，点下面“添加题目”开始。</p></div>';
    }
    document.getElementById('add-question').style.display = locked ? 'none' : '';
    document.getElementById('add-from-bank').style.display = locked ? 'none' : '';
  }

  function applyTypeChange(qi, type) {
    const q = state.questions[qi];
    q.type = type;
    if (type === 'single' || type === 'multiple') {
      if (!q.options || q.options.length < 2) {
        q.options = [
          { key: 'A', label: '选项 A' },
          { key: 'B', label: '选项 B' },
        ];
      }
      q.constraints = {};
      if (!q.jumps) q.jumps = [];
    } else if (type === 'text') {
      q.options = [];
      q.constraints = {};
      q.jumps = [];
    } else {
      q.options = [];
      q.constraints = {};
      if (!q.jumps) q.jumps = [];
    }
    render();
  }

  questionsEl.addEventListener('input', (event) => {
    const el = event.target;
    const field = el.dataset.field;
    if (!field) return;
    const qi = Number(el.dataset.qi);
    const q = state.questions[qi];
    if (!q) return;
    const oi = el.dataset.oi != null ? Number(el.dataset.oi) : null;
    const ji = el.dataset.ji != null ? Number(el.dataset.ji) : null;

    if (field === 'title') q.title = el.value;
    else if (field === 'required') q.required = el.checked;
    else if (field === 'option-key' && oi != null) q.options[oi].key = el.value;
    else if (field === 'option-label' && oi != null) q.options[oi].label = el.value;
    else if (['minSelect', 'maxSelect', 'exactSelect', 'minLength', 'maxLength', 'min', 'max'].includes(field)) {
      q.constraints[field] = el.value === '' ? undefined : Number(el.value);
    } else if (field === 'integer') q.constraints.integer = el.checked;
    else if (ji != null) {
      const jump = q.jumps[ji];
      if (!jump) return;
      if (field === 'jump-option') jump.when = { option: el.value };
      else if (field === 'jump-includes') jump.when = { includes: el.value };
      else if (field === 'jump-target') jump.to = el.value;
      else if (field === 'jump-op') jump.when = { op: el.value };
      else if (field === 'jump-value') jump.when.value = Number(el.value);
      else if (field === 'jump-min') jump.when.min = Number(el.value);
      else if (field === 'jump-max') jump.when.max = Number(el.value);
    }
  });

  questionsEl.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset.role === 'type') {
      applyTypeChange(Number(el.dataset.qi), el.value);
      return;
    }
    if (el.dataset.field === 'required') {
      const q = state.questions[Number(el.dataset.qi)];
      if (q) q.required = el.checked;
    }
    if (el.dataset.field === 'integer') {
      const q = state.questions[Number(el.dataset.qi)];
      if (q) q.constraints.integer = el.checked;
    }
    // 数字题的运算符切换会影响后面的输入框，重绘一次
    if (el.dataset.field === 'jump-op') {
      const qi = Number(el.dataset.qi);
      const ji = Number(el.dataset.ji);
      const q = state.questions[qi];
      if (q && q.jumps[ji]) {
        q.jumps[ji].when = { op: el.value };
        render();
      }
    }
  });

  questionsEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const qi = Number(button.dataset.qi);
    const q = state.questions[qi];

    if (action === 'add-option' && q) {
      q.options.push({ key: nextOptionKey(q.options), label: `选项 ${q.options.length + 1}` });
      render();
    } else if (action === 'remove-option' && q) {
      q.options.splice(Number(button.dataset.oi), 1);
      render();
    } else if (action === 'add-jump' && q) {
      const nextQuestion = state.questions[qi + 1];
      q.jumps.push({
        when: q.type === 'number' ? { op: 'gte', value: 0 } : q.type === 'multiple' ? { includes: q.options[0]?.key || '' } : { option: q.options[0]?.key || '' },
        to: nextQuestion ? nextQuestion.qid : '',
      });
      render();
    } else if (action === 'remove-jump' && q) {
      q.jumps.splice(Number(button.dataset.ji), 1);
      render();
    } else if (action === 'remove-question') {
      if (!confirm('删除这道题？')) return;
      state.questions.splice(qi, 1);
      render();
    }
  });

  document.getElementById('add-question').addEventListener('click', () => {
    state.questions.push(newQuestion());
    render();
  });

  // 从题库选题
  const bankModal = document.getElementById('bank-modal');
  const bankList = document.getElementById('bank-list');
  let bankItems = [];

  document.getElementById('add-from-bank').addEventListener('click', async () => {
    bankModal.classList.remove('hidden');
    bankList.innerHTML = '<p class="muted">加载中…</p>';
    try {
      const res = await fetch('/api/questions');
      const data = await res.json();
      bankItems = data.questions || [];
      bankList.innerHTML = bankItems.length
        ? bankItems
            .map(
              (q) => `
            <div class="bank-item">
              <div>
                <strong>${escapeHtml(q.title)}</strong>
                <div class="muted small">
                  ${q.type === 'single' ? '单选' : q.type === 'multiple' ? '多选' : q.type === 'text' ? '填空' : '数字'}
                  · v${q.currentVersion} · 被 ${q.usageCount} 份问卷使用
                </div>
              </div>
              <button type="button" class="btn small primary" data-bank-id="${q._id}">添加</button>
            </div>`
            )
            .join('')
        : '<p class="muted">题库还是空的，先在问卷里添加一道新题。</p>';
    } catch (err) {
      bankList.innerHTML = '<p class="form-error">题库加载失败</p>';
    }
  });

  document.getElementById('bank-close').addEventListener('click', () => bankModal.classList.add('hidden'));

  bankList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-bank-id]');
    if (!button) return;
    const item = bankItems.find((q) => String(q._id) === button.dataset.bankId);
    if (!item || !item.current) return;
    state.questions.push({
      qid: newQid(),
      questionId: item._id,
      version: item.currentVersion,
      type: item.current.type,
      title: item.current.title,
      options: item.current.options,
      constraints: item.current.constraints,
      required: false,
      jumps: [],
    });
    bankModal.classList.add('hidden');
    render();
  });

  function serialize() {
    return state.questions.map((q) => {
      const constraints = {};
      for (const [key, value] of Object.entries(q.constraints || {})) {
        if (value !== undefined && value !== '' && !Number.isNaN(value)) constraints[key] = value;
      }
      const jumps = (q.jumps || [])
        .filter((j) => j.to)
        .map((j) => ({ when: { ...j.when }, to: j.to }));
      return {
        qid: q.qid,
        type: q.type,
        title: q.title,
        required: !!q.required,
        options: q.options || [],
        constraints,
        jumps,
        ...(q.questionId ? { questionId: q.questionId, version: q.version } : {}),
      };
    });
  }

  function checkLocal() {
    for (let i = 0; i < state.questions.length; i += 1) {
      const q = state.questions[i];
      if (!q.title.trim()) return `第 ${i + 1} 题还没有写题目`;
      if ((q.type === 'single' || q.type === 'multiple') && q.options.length < 2) {
        return `第 ${i + 1} 题至少要有两个选项`;
      }
      for (const jump of q.jumps || []) {
        if (!jump.to) return `第 ${i + 1} 题有一条跳转规则没有选目标题`;
        if (q.type === 'number') {
          if (jump.when.op === 'between') {
            if (!Number.isFinite(jump.when.min) || !Number.isFinite(jump.when.max)) {
              return `第 ${i + 1} 题的区间跳转没有填完整`;
            }
          } else if (!Number.isFinite(jump.when.value)) {
            return `第 ${i + 1} 题的跳转条件没有填数值`;
          }
        }
      }
    }
    return null;
  }

  function readMeta() {
    const deadlineValue = document.getElementById('meta-deadline').value;
    return {
      title: document.getElementById('meta-title').value.trim(),
      description: document.getElementById('meta-desc').value,
      anonymous: document.getElementById('meta-anonymous').checked,
      allowMultiple: document.getElementById('meta-multiple').checked,
      deadline: deadlineValue ? new Date(deadlineValue).toISOString() : null,
    };
  }

  async function save() {
    const meta = readMeta();
    if (!meta.title) {
      messageEl.textContent = '标题不能为空';
      return false;
    }
    const localError = locked ? null : checkLocal();
    if (localError) {
      messageEl.textContent = localError;
      return false;
    }

    const body = { ...meta };
    if (!locked) body.questions = serialize();

    const res = await fetch(`/api/surveys/${state.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      messageEl.textContent = data.error || '保存失败';
      return false;
    }
    messageEl.textContent = '已保存';
    setTimeout(() => { messageEl.textContent = ''; }, 2000);
    return true;
  }

  document.getElementById('save').addEventListener('click', save);

  const publishBtn = document.getElementById('publish');
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      const ok = await save();
      if (!ok) return;
      publishBtn.disabled = true;
      const res = await fetch(`/api/surveys/${state.id}/publish`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert([data.error, ...(data.details || [])].filter(Boolean).join('\n'));
        publishBtn.disabled = false;
        return;
      }
      window.location.href = '/dashboard';
    });
  }

  render();
})();
