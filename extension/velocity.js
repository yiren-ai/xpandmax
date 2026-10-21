(() => {
  'use strict';
  const CHANNEL = 'x-follower-count-v1';
  const TTL = 30 * 60 * 1000;
  const defaults = { showTweetVelocity: true, velocityRisingThreshold: 1000, velocityViralThreshold: 10000 };
  let settings = { ...defaults };
  const changed = new Set();
  const tweets = new Map();
  let scheduled = false;
  // 同一条记录只在数据或阈值变化时重算一次文本，DOM 变动再频繁也不必重复格式化。
  const paints = new WeakMap();
  const validThresholds = value => Number.isFinite(value.velocityRisingThreshold)
    && value.velocityRisingThreshold > 0 && Number.isFinite(value.velocityViralThreshold)
    && value.velocityViralThreshold > value.velocityRisingThreshold;

  function configure(values) {
    settings = { ...settings, ...values };
    if (typeof settings.showTweetVelocity !== 'boolean') settings.showTweetVelocity = true;
    if (!validThresholds(settings)) {
      settings.velocityRisingThreshold = defaults.velocityRisingThreshold;
      settings.velocityViralThreshold = defaults.velocityViralThreshold;
    }
    schedule();
  }
  if (globalThis.chrome?.storage?.local) {
    chrome.storage.local.get(defaults, saved => {
      if (!chrome.runtime.lastError) configure(Object.fromEntries(Object.entries(saved).filter(([key]) => !changed.has(key))));
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const values = {};
      for (const key of Object.keys(defaults)) if (Object.hasOwn(changes, key)) {
        changed.add(key); values[key] = changes[key].newValue ?? defaults[key];
      }
      configure(values);
    });
  }
  const number = value => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  // 三位有效数字：读数稳定、宽度稳定，精确值留给 title。
  const APPROX = '≈';
  function formatRate(rate) {
    if (!Number.isFinite(rate) || rate < 0) return '—';
    if (rate < 1000) return Math.round(rate).toLocaleString('zh-CN');
    if (rate < 10000) return (Math.round(rate / 10) * 10).toLocaleString('zh-CN');
    const wan = rate / 10000;
    const text = wan >= 100 ? Math.round(wan).toLocaleString('zh-CN') : wan.toFixed(1).replace(/\.0$/, '');
    return `${text}万`;
  }
  function description(record, rate) {
    const metric = (label, key) => `${label}：${record[key] === undefined ? '—' : number(record[key])}`;
    const complete = ['likes', 'reposts', 'replies', 'bookmarks'].every(key => record[key] !== undefined);
    let score = '—（互动字段不完整）';
    if (complete) {
      const ratio = (a, b) => b > 0 ? a / b : 0;
      const clamp = value => Math.min(1, Math.max(0, value));
      score = (40 * clamp(rate / 50000)
        + 25 * clamp(ratio(record.likes + record.reposts + record.replies + record.bookmarks, record.views) / 0.1)
        + 20 * clamp(ratio(record.reposts, record.likes) / 0.5)
        + 15 * clamp(ratio(record.bookmarks, record.likes) / 0.3)).toFixed(1) + '/100';
    }
    return [metric('浏览', 'views'), metric('点赞', 'likes'), metric('转发', 'reposts'), metric('回复', 'replies'), metric('收藏', 'bookmarks'),
      `流速：${number(rate)}/小时（发布以来平均，最短按 6 分钟）`, `爆帖指数：${score}`, `发布时间：${new Date(record.createdAt).toLocaleString('zh-CN')}`].join('\n');
  }
  function linkedId(author) {
    const link = [...author.querySelectorAll('a[href]')].find(anchor => anchor.querySelector('time'));
    if (!link) return;
    try {
      const url = new URL(link.getAttribute('href'), location.href);
      if (url.origin === location.origin) return url.pathname.match(/^\/[a-zA-Z0-9_]{1,15}\/status\/(\d+)\/?$/)?.[1];
    } catch { /* Unknown page shape: show nothing. */ }
  }
  function baseId(author) {
    const direct = linkedId(author);
    if (direct) return direct;
    // Detail pages move the permalink timestamp below the body. Only the main
    // author of the article containing that exact permalink may use the route ID.
    const article = author.closest('article');
    const route = location.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d+)\/?$/);
    if (!route || !article || article.querySelector('[data-testid="User-Name"]') !== author) return;
    const profileMatches = [...author.querySelectorAll('a[href]')].some(link => {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        return url.origin === location.origin && url.pathname.toLowerCase().replace(/\/$/, '') === '/' + route[1].toLowerCase();
      } catch { return false; }
    });
    if (!profileMatches) return;
    const hasPermalink = [...article.querySelectorAll('a[href]')].some(link => {
      if (!link.querySelector('time') || link.closest('article') !== article) return false;
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        return url.origin === location.origin && url.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '');
      } catch { return false; }
    });
    return hasPermalink ? route[2] : undefined;
  }
  function tweetId(author) {
    const direct = baseId(author);
    if (direct) return direct;
    // X quote cards have a time element but no status link. Resolve through
    // the enclosing tweet's explicit quoted ID, never by display name alone.
    const quote = author.closest('[role="link"]');
    const article = author.closest('article');
    if (!quote || !article || !article.contains(quote)) return;
    const outer = [...article.querySelectorAll('[data-testid="User-Name"]')]
      .find(row => !quote.contains(row) && row.closest('article') === article && baseId(row));
    const quotedId = outer && tweets.get(baseId(outer))?.quotedId;
    const record = tweets.get(quotedId);
    const timestamp = Date.parse(author.querySelector('time')?.getAttribute('datetime'));
    if (record && timestamp === record.createdAt) return quotedId;
  }
  // 徽章永远跟着“这条帖的身份行”：信息流是「@handle · 43分钟」之后，
  // 详情页 header 里没有时间戳，就往前贴到 @handle 后面。找不到锚点就不渲染。
  // 注意 X 用 column 容器包住 @handle，直接插兄弟节点会换到下一行，所以这一层
  // 要改成一行再插（[data-xfc-velocity-line]）。
  function metaAnchor(author) {
    const time = author.querySelector('time');
    if (time) return { node: time.closest('a') || time.parentElement, mode: 'after' };
    // 账号链接里最后一个是 @handle（前面可能是头像或昵称链接）。
    const handle = [...author.querySelectorAll('a[href]')]
      .filter(link => /^\/[A-Za-z0-9_]{1,15}\/?$/.test(link.getAttribute('href') || ''))
      .pop();
    if (!handle) return null;
    const line = handle.parentElement;
    if (!line || line === author) return { node: handle, mode: 'after' };
    line.setAttribute('data-xfc-velocity-line', '');
    return { node: line, mode: 'append' };
  }
  // 徽章始终挂在作者行内部，所以按作者行找，不跨行复用（同一个帖子在页面
  // 里可能出现两次，按 id 找会把第一个徽章挪给第二处）。
  function findBadge(author) {
    return [...author.querySelectorAll('[data-xfc-velocity]')]
      .find(node => node.closest('[data-testid="User-Name"]') === author) || null;
  }
  // 站内跳转后作者行可能被复用，锚点会从「时间后面」变成「账号后面」，
  // 这时要把旧徽章挪过去，而不是留在原地。
  function targetNode(anchor) {
    return anchor.mode === 'append' ? anchor.node : anchor.node.parentElement || anchor.node;
  }
  function render() {
    scheduled = false;
    const now = Date.now();
    for (const [id, record] of tweets) if (now - record.observedAt >= TTL) tweets.delete(id);
    const used = new Set();
    if (settings.showTweetVelocity) for (const author of document.querySelectorAll('[data-testid="User-Name"]')) {
      const id = tweetId(author);
      const record = tweets.get(id);
      if (!record || !record.valid) continue;
      const anchor = metaAnchor(author);
      if (!anchor) continue;
      let badge = findBadge(author);
      if (badge && badge.parentElement !== targetNode(anchor)) badge.remove();
      if (!badge || !badge.isConnected) {
        badge = document.createElement('span');
        badge.setAttribute('data-xfc-velocity', '');
        badge.tabIndex = 0;
        if (anchor.mode === 'append') anchor.node.append(badge);
        else anchor.node.after(badge);
      }
      badge.dataset.xfcTweetId = id;
      // 用观测时刻算，不用当前时刻：否则分母每秒都在长，数字永远在往下淌。
      let paint = paints.get(record);
      if (!paint || paint.rising !== settings.velocityRisingThreshold || paint.viral !== settings.velocityViralThreshold) {
        const hours = Math.max((record.observedAt - record.createdAt) / 3600000, 0.1);
        const rate = record.views / hours;
        paint = {
          rising: settings.velocityRisingThreshold,
          viral: settings.velocityViralThreshold,
          text: `${APPROX}${formatRate(rate)}/小时`,
          title: description(record, rate),
          tier: rate >= settings.velocityViralThreshold ? 'viral' : rate >= settings.velocityRisingThreshold ? 'rising' : 'normal',
        };
        paints.set(record, paint);
      }
      const frozen = badge.matches(':hover, :focus, :focus-within') || badge === document.activeElement;
      if (!frozen) {
        if (badge.textContent !== paint.text) badge.textContent = paint.text;
        if (badge.title !== paint.title) { badge.title = paint.title; badge.setAttribute('aria-label', paint.title); }
        if (badge.dataset.tier !== paint.tier) badge.dataset.tier = paint.tier;
      }
      used.add(badge);
    }
    for (const badge of document.querySelectorAll('[data-xfc-velocity]')) if (!used.has(badge)) badge.remove();
    for (const line of document.querySelectorAll('[data-xfc-velocity-line]')) {
      if (!line.querySelector('[data-xfc-velocity]')) line.removeAttribute('data-xfc-velocity-line');
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      if (document.hidden) { scheduled = false; return; }
      render();
    });
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.channel !== CHANNEL
      || data.type !== 'tweets' || !Array.isArray(data.tweets) || data.tweets.length > 250) return;
    const now = Date.now();
    for (const record of data.tweets) {
      if (!record || typeof record.id !== 'string' || !/^\d{1,25}$/.test(record.id)
        || !Number.isFinite(record.observedAt) || record.observedAt > now || now - record.observedAt >= TTL
        || (tweets.get(record.id)?.observedAt > record.observedAt)) continue;
      const quotedId = typeof record.quotedId === 'string' && /^\d{1,25}$/.test(record.quotedId) ? record.quotedId : undefined;
      if (record.valid === false) {
        tweets.delete(record.id);
        tweets.set(record.id, { id: record.id, valid: false, observedAt: record.observedAt, quotedId });
        continue;
      }
      if (record.valid !== true || !Number.isSafeInteger(record.views) || record.views < 0
        || !Number.isFinite(record.createdAt) || record.createdAt < 0 || record.createdAt > now) continue;
      const clean = { id: record.id, valid: true, views: record.views, createdAt: record.createdAt, observedAt: record.observedAt, quotedId };
      for (const key of ['likes', 'reposts', 'replies', 'bookmarks']) {
        if (Number.isSafeInteger(record[key]) && record[key] >= 0) clean[key] = record[key];
      }
      tweets.delete(record.id); tweets.set(record.id, clean);
    }
    while (tweets.size > 5000) tweets.delete(tweets.keys().next().value);
    schedule();
  });
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-testid', 'datetime'] });
  window.addEventListener('popstate', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  setInterval(schedule, 30000);
  window.postMessage({ channel: CHANNEL, type: 'ready' }, location.origin);
  schedule();
})();
