(() => {
  'use strict';
  const CHANNEL = 'x-follower-count-v1';
  const AUTHOR = '[data-testid="User-Name"], [data-testid="UserName"]';
  const TTL = 30 * 60 * 1000;
  const defaults = { showTweetVelocity: true, velocityRisingThreshold: 1000, velocityViralThreshold: 10000 };
  let settings = { ...defaults };
  const changed = new Set();
  const tweets = new Map();
  let scheduled = false;
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
    if (!route || !article || article.querySelector(AUTHOR) !== author) return;
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
    const outer = [...article.querySelectorAll(AUTHOR)]
      .find(row => !quote.contains(row) && row.closest('article') === article && baseId(row));
    const quotedId = outer && tweets.get(baseId(outer))?.quotedId;
    const record = tweets.get(quotedId);
    const timestamp = Date.parse(author.querySelector('time')?.getAttribute('datetime'));
    if (record && timestamp === record.createdAt) return quotedId;
  }
  function render() {
    scheduled = false;
    const now = Date.now();
    for (const [id, record] of tweets) if (now - record.observedAt >= TTL) tweets.delete(id);
    const used = new Set();
    if (settings.showTweetVelocity) for (const author of document.querySelectorAll(AUTHOR)) {
      const id = tweetId(author);
      const record = tweets.get(id);
      if (!record || !record.valid) continue;
      let badge = [...author.querySelectorAll('[data-xfc-velocity]')].find(node => node.closest(AUTHOR) === author);
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute('data-xfc-velocity', '');
        badge.tabIndex = 0;
        const time = author.querySelector('time');
        const timestamp = time?.closest('a') || time?.parentElement;
        if (timestamp) timestamp.after(badge);
        else author.append(badge);
      }
      const rate = record.views / Math.max((now - record.createdAt) / 3600000, 0.1);
      const tier = rate >= settings.velocityViralThreshold ? 'viral' : rate >= settings.velocityRisingThreshold ? 'rising' : 'normal';
      const text = `${number(rate)}/小时`;
      const title = description(record, rate);
      if (badge.textContent !== text) badge.textContent = text;
      if (badge.title !== title) { badge.title = title; badge.setAttribute('aria-label', title); }
      if (badge.dataset.tier !== tier) badge.dataset.tier = tier;
      used.add(badge);
    }
    for (const badge of document.querySelectorAll('[data-xfc-velocity]')) if (!used.has(badge)) badge.remove();
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(render); }
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
  setInterval(schedule, 30000);
  window.postMessage({ channel: CHANNEL, type: 'ready' }, location.origin);
  schedule();
})();
