(() => {
  'use strict';
  const rules = globalThis.xpandmaxFilterRules;
  const status = document.getElementById('status'), form = document.getElementById('filter-settings');
  const list = document.getElementById('rule-list'), keyword = document.getElementById('new-keyword');
  const count = () => { document.getElementById('rule-count').textContent = String(list.children.length); };
  function add(item) {
    const row = document.createElement('div'); row.className = 'rule-row';
    const type = document.createElement('select'); type.setAttribute('aria-label', '规则类型');
    for (const [value, label] of [['keyword', '关键词'], ['pattern', '正则']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; type.append(option); }
    type.value = item.kind;
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 300; input.value = item.value; input.setAttribute('aria-label', '规则内容');
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
    remove.addEventListener('click', () => { row.remove(); count(); status.textContent = '规则已删除，点击保存后生效；误删可恢复默认'; });
    row.append(type, input, remove); list.append(row); count();
  }
  function render(items) { list.replaceChildren(); for (const item of items) add(item); count(); }
  chrome.storage.local.get(rules.storageDefaults, saved => {
    if (chrome.runtime.lastError) { status.textContent = '读取失败，请重新打开设置'; return; }
    const config = rules.settings(saved);
    for (const key of ['filterWhitelist', 'filterBlacklist']) document.getElementById(key).value = config[key];
    render(config.filterRules);
    for (const input of form.elements) input.disabled = false;
    status.textContent = '修改后点击保存；黑白名单保存后请刷新 X 页面';
  });
  document.getElementById('add-keyword').addEventListener('click', () => {
    const value = keyword.value.trim();
    if (!value) { status.textContent = '请先输入关键词'; keyword.focus(); return; }
    if (list.children.length >= 200) { status.textContent = '最多保存 200 条规则'; return; }
    add({ kind: 'keyword', value }); keyword.value = '';
    list.lastElementChild.querySelector('input').focus(); status.textContent = '已添加关键词，点击保存后生效';
  });
  keyword.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); document.getElementById('add-keyword').click(); } });
  document.getElementById('restore-defaults').addEventListener('click', () => {
    render(rules.defaultRules);
    status.textContent = '已恢复默认规则和文字，点击保存后生效；开关、黑白名单保持当前填写值';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = { filterRules: [...list.children].map(row => ({ kind: row.querySelector('select').value, value: row.querySelector('input').value.trim() })) };
    const error = rules.validate(values.filterRules);
    if (error) { status.textContent = error; return; }
    for (const [key, label] of [['filterWhitelist', '白名单'], ['filterBlacklist', '黑名单']]) {
      const value = document.getElementById(key).value;
      const accounts = rules.lines(value);
      if (accounts.length > 1000 || accounts.some(line => !/^@?[a-zA-Z0-9_]{1,15}$/.test(line))) { status.textContent = `${label}最多 1,000 个账号，仅填写有效的 @账号`; return; }
      values[key] = [...rules.whitelist({ filterWhitelist: value })].join('\n');
    }
    const overlap = [...rules.whitelist(values)].some(handle => rules.blacklist(values).has(handle));
    for (const input of form.elements) input.disabled = true;
    chrome.storage.local.set(values, () => {
      status.textContent = chrome.runtime.lastError ? '保存失败，请重试' : `已保存；请刷新 X 页面使黑白名单生效${overlap ? '；重叠账号按白名单处理' : ''}。黑白名单仅影响本地展示`;
      for (const input of form.elements) input.disabled = false;
    });
  });
})();
