/* Shared local rules. Pattern matching uses a bounded NFA, never backtracking regexes. */
(() => {
  'use strict';
  const preset = [
    '(t\\.me|telegram|电报|飞机).{0,32}(福利|资源|视频|频道|群)',
    '(约炮|裸聊|外围|包养|上门服务|援交|同城可约)',
    '(私房照|裸照|流出|国产自拍|成人视频|成人资源)',
    '(福利视频|擦边|大尺度|黑丝|写真)',
    '(主页.{0,4}(打|看|来|约|玩)?.{0,4}✈️|打✈️|去.{0,4}✈️)',
    '(加群|接推广|电报.{0,12}(频道|群|资源|福利))',
    '(性生理|两性|私密|成人视频|成人|福利姬)',
    '(曰炮|曰[pP]平台|约炮平台|约[pP]平台|炮友平台)',
    '🔞.{0,40}(性癖|约|联系|私聊|主页|不飞|可飞|加我)',
    '全网[独首]?[创发家].{0,16}(线下|社交|约|匹配)',
    '(联系.{0,6}(直接)?点击大号|点击大号|看大号)',
    '(小号已禁言|来这里找我|可以来.{0,4}找我)',
    '(博彩|赌场|娱乐城|投注平台|澳门线上娱乐|百家乐|体彩|线上賭場|online casino|sportsbook bonus|betting bonus)'
  ];
  const defaultRules = Object.freeze(preset.map(value => Object.freeze({ kind: 'pattern', value })));
  const defaults = Object.freeze({ filterEnabled: false, filterRules: defaultRules, filterWhitelist: '', filterBlacklist: '' });
  // null distinguishes an absent new list from an intentionally saved empty list during migration.
  const storageDefaults = Object.freeze({ ...defaults, filterRules: null, filterAdultKeywords: '', filterGamblingKeywords: '', filterAdult: true, filterGambling: true });
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '');
  const lines = value => typeof value === 'string' ? value.split(/[\n,，]/).map(x => x.trim()).filter(Boolean) : [];
  const accounts = value => new Set(lines(value).map(x => x.replace(/^@/, '').toLowerCase()).filter(x => /^[a-z0-9_]{1,15}$/.test(x)));
  const whitelist = config => accounts(config.filterWhitelist);
  const blacklist = config => accounts(config.filterBlacklist);
  const copyRules = list => list.map(item => ({ kind: item.kind, value: item.value }));
  function settings(raw = {}) {
    const result = { ...defaults, filterRules: copyRules(defaultRules) };
    for (const key of ['filterEnabled', 'filterWhitelist', 'filterBlacklist']) {
      if (typeof raw[key] === typeof result[key]) result[key] = raw[key];
    }
    if (Array.isArray(raw.filterRules)) {
      result.filterRules = raw.filterRules.filter(item => item && ['keyword', 'pattern'].includes(item.kind) && typeof item.value === 'string').slice(0, 200).map(item => ({ kind: item.kind, value: item.value.slice(0, 300) }));
    } else {
      const custom = [...lines(raw.filterAdultKeywords), ...lines(raw.filterGamblingKeywords)];
      result.filterRules.push(...custom.slice(0, 200 - result.filterRules.length).map(value => ({ kind: 'keyword', value: value.slice(0, 300) })));
      if (raw.filterAdult === false && raw.filterGambling === false && raw.filterEnabled !== true) result.filterEnabled = false;
    }
    return result;
  }

  // Parse a deliberately small, safe pattern language: literals, groups, |, [], ., ?, {m,n}.
  // Compile finite repetitions to an NFA; the number of states is capped at 512.
  function compilePattern(input) {
    if (!input || input.length > 300) throw new Error('正则规则须为 1–300 字符');
    const chars = Array.from(input.normalize('NFKC'));
    let at = 0, depth = 0;
    const peek = () => chars[at];
    function expression() {
      if (++depth > 12) throw new Error('分组嵌套过深');
      const choices = [sequence()];
      while (peek() === '|') { at++; choices.push(sequence()); }
      depth--;
      return { type: 'choice', choices };
    }
    function sequence() {
      const items = [];
      while (at < chars.length && ![')', '|'].includes(peek())) {
        let node;
        const char = chars[at++];
        if (char === '(') {
          node = expression();
          if (chars[at++] !== ')') throw new Error('分组括号不完整');
        } else if (char === '[') {
          let body = '';
          while (at < chars.length && peek() !== ']') body += chars[at++];
          if (chars[at++] !== ']' || !body || /[\\[\^]/.test(body)) throw new Error('字符组无效，仅支持字符和简单范围');
          let re;
          try { re = new RegExp(`^[${body}]$`, 'iu'); } catch { throw new Error('字符组无效'); }
          node = { type: 'char', test: value => re.test(value) };
        } else if (char === '.') node = { type: 'char', test: value => !['\n', '\r'].includes(value) };
        else if (char === '\\') {
          const next = chars[at++];
          if (!next || /[a-zA-Z0-9]/.test(next)) throw new Error('不支持反向引用或转义字符类，请使用字面字符');
          node = { type: 'char', test: value => value.toLowerCase() === next.toLowerCase() };
        } else {
          if ('*+?{}]^$'.includes(char)) throw new Error('仅支持分组、或、字符组、点号、? 和有上限的 {m,n}');
          node = { type: 'char', test: value => value.toLowerCase() === char.toLowerCase() };
        }
        if (peek() === '?') { at++; node = { type: 'repeat', item: node, min: 0, max: 1 }; }
        else if (peek() === '{') {
          at++; let value = '';
          while (at < chars.length && peek() !== '}') value += chars[at++];
          if (chars[at++] !== '}' || !/^\d+(,\d+)?$/.test(value)) throw new Error('重复次数必须有明确上限，例如 {0,40}');
          const [min, max = min] = value.split(',').map(Number);
          if (max > 40 || max < min) throw new Error('重复上限最多 40，且不能小于下限');
          node = { type: 'repeat', item: node, min, max };
        }
        items.push(node);
      }
      if (!items.length) throw new Error('规则不能包含空分支，例如 (约炮|)');
      return { type: 'sequence', items };
    }
    const ast = expression();
    if (at !== chars.length) throw new Error('分组括号不匹配');
    const states = [];
    const state = () => {
      if (states.length >= 512) throw new Error('规则过于复杂，请拆成多条');
      states.push({ epsilon: [], edges: [] }); return states.length - 1;
    };
    const link = (from, to) => states[from].epsilon.push(to);
    function build(node, start, end) {
      if (node.type === 'char') states[start].edges.push({ test: node.test, to: end });
      else if (node.type === 'choice') for (const child of node.choices) build(child, start, end);
      else if (node.type === 'sequence') {
        let current = start;
        node.items.forEach((child, index) => { const next = index === node.items.length - 1 ? end : state(); build(child, current, next); current = next; });
      } else {
        let current = start;
        for (let i = 0; i < node.max; i++) {
          if (i >= node.min) link(current, end);
          const next = state(); build(node.item, current, next); current = next;
        }
        link(current, end);
      }
    }
    const start = state(), end = state(); build(ast, start, end);
    function closure(input) {
      const result = new Set(input), stack = [...result];
      while (stack.length) for (const next of states[stack.pop()].epsilon) if (!result.has(next)) { result.add(next); stack.push(next); }
      return result;
    }
    if (closure([start]).has(end)) throw new Error('规则不能匹配空文字');
    return text => {
      let active = new Set();
      for (const char of Array.from(text)) {
        const next = new Set();
        active.add(start);
        for (const id of closure(active)) for (const edge of states[id].edges) if (edge.test(char)) next.add(edge.to);
        active = closure(next);
        if (active.has(end)) return true;
      }
      return false;
    };
  }
  function compile(item) {
    if (!item || !['keyword', 'pattern'].includes(item.kind) || typeof item.value !== 'string' || !item.value.trim() || item.value.length > 300) throw new Error('每条规则须为 1–300 字符');
    if (item.kind === 'pattern') return compilePattern(item.value.trim());
    const needle = normalize(item.value.trim());
    if (!needle) throw new Error('关键词不能为空');
    if (/^[a-z0-9 ]+$/.test(needle)) {
      const re = new RegExp(`(^|[^a-z0-9_])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_])`, 'i');
      return text => re.test(text);
    }
    return text => text.includes(needle);
  }
  function validate(list) {
    if (!Array.isArray(list) || list.length > 200) return '最多保存 200 条规则';
    for (let i = 0; i < list.length; i++) { try { compile(list[i]); } catch (error) { return `第 ${i + 1} 条：${error.message}`; } }
    return '';
  }
  let cacheKey, compiled = [];
  function match(text, bio, handle, raw) {
    const config = settings(raw);
    if (!config.filterEnabled || whitelist(config).has(handle.toLowerCase())) return null;
    if (blacklist(config).has(handle.toLowerCase())) return { source: '黑名单', keyword: `@${handle.toLowerCase()}`, label: '黑名单账号' };
    const key = JSON.stringify(config.filterRules);
    if (key !== cacheKey) {
      cacheKey = key;
      compiled = config.filterRules.flatMap(item => { try { return [{ item, test: compile(item) }]; } catch { return []; } });
    }
    for (const [source, value] of [['正文', text], ['简介', bio]]) {
      const content = normalize(value).slice(0, 10000);
      for (const { item, test } of compiled) if (test(content)) return { source, keyword: item.value, label: '疑似推广内容' };
    }
    return null;
  }
  globalThis.xpandmaxFilterRules = Object.freeze({ defaults, storageDefaults, defaultRules, settings, lines, whitelist, blacklist, copyRules, compile, validate, match });
})();
