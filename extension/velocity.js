(() => {
  'use strict';
  const CHANNEL = 'x-follower-count-v1';
  const TTL = 30 * 60 * 1000;
  const defaults = { showTweetVelocity: true, showBookmarkCount: true, velocityRisingThreshold: 1000, velocityViralThreshold: 10000 };
  let settings = { ...defaults };
  const changed = new Set();
  const tweets = new Map();
  const descriptions = new WeakMap();
  let scheduled = false;
  let tooltipTimer;
  let tooltipAnchor;
  const validThresholds = value => Number.isFinite(value.velocityRisingThreshold)
    && value.velocityRisingThreshold > 0 && Number.isFinite(value.velocityViralThreshold)
    && value.velocityViralThreshold > value.velocityRisingThreshold;

  function configure(values) {
    settings = { ...settings, ...values };
    if (typeof settings.showTweetVelocity !== 'boolean') settings.showTweetVelocity = true;
    if (typeof settings.showBookmarkCount !== 'boolean') settings.showBookmarkCount = true;
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
  function hideTooltip() {
    clearTimeout(tooltipTimer);
    tooltipTimer = undefined;
    tooltipAnchor?.removeAttribute('aria-describedby');
    tooltipAnchor = undefined;
    document.querySelector('[data-xfc-velocity-tooltip]')?.remove();
  }
  function showTooltip(anchor, point) {
    const text = descriptions.get(anchor);
    if (!text || !anchor.isConnected) return;
    hideTooltip();
    tooltipAnchor = anchor;
    const tooltip = document.createElement('div');
    tooltip.id = 'xfc-velocity-tooltip';
    tooltip.setAttribute('data-xfc-velocity-tooltip', '');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = text;
    document.body.append(tooltip);
    anchor.setAttribute('aria-describedby', tooltip.id);
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(8, point?.x ?? rect.left);
    const top = Math.max(8, rect.bottom + (point ? 20 : 6));
    tooltip.style.setProperty('max-width', `${Math.max(120, Math.min(520, innerWidth - left - 8))}px`, 'important');
    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top + bounds.height <= innerHeight - 8 ? top : Math.max(8, top - bounds.height)}px`;
  }
  const velocityBadge = target => target instanceof Element ? target.closest('[data-xfc-velocity]') : null;
  document.addEventListener('mouseover', event => {
    const badge = velocityBadge(event.target);
    if (!badge || (event.relatedTarget instanceof Node && badge.contains(event.relatedTarget))) return;
    clearTimeout(tooltipTimer);
    const point = { x: event.clientX, y: event.clientY };
    tooltipTimer = setTimeout(() => showTooltip(badge, point), 120);
  });
  document.addEventListener('mouseout', event => {
    const badge = velocityBadge(event.target);
    if (badge && !(event.relatedTarget instanceof Node && badge.contains(event.relatedTarget))) hideTooltip();
  });
  document.addEventListener('focusin', event => { const badge = velocityBadge(event.target); if (badge) showTooltip(badge); });
  document.addEventListener('focusout', event => { if (velocityBadge(event.target)) hideTooltip(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', hideTooltip);
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
  function badgePlacement(author) {
    const time = author.querySelector('time');
    if (time) return { anchor: time.closest('a') || time.parentElement, after: true };
    if (author.firstElementChild) return { anchor: author.firstElementChild, after: false };
  }
  function renderBookmarkCounts() {
    const used = new Set();
    if (settings.showBookmarkCount) for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const author = article.querySelector('[data-testid="User-Name"]');
      const record = author && tweets.get(tweetId(author));
      const button = article.querySelector('button[data-testid="bookmark"], button[data-testid="removeBookmark"]');
      if (!button || !Number.isSafeInteger(record?.bookmarks) || record.bookmarks <= 0) continue;
      const nativeCount = [...button.querySelectorAll('span')].some(node => !node.hasAttribute('data-xfc-bookmark-count')
        && node.children.length === 0 && /\d/.test(node.textContent || ''));
      if (nativeCount) continue;
      let count = button.querySelector('[data-xfc-bookmark-count]');
      if (!count) {
        count = document.createElement('span');
        count.setAttribute('data-xfc-bookmark-count', '');
        count.setAttribute('aria-hidden', 'true');
        (button.querySelector(':scope > div') || button).append(count);
      }
      count.textContent = number(record.bookmarks);
      used.add(count);
    }
    for (const count of document.querySelectorAll('[data-xfc-bookmark-count]')) if (!used.has(count)) count.remove();
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
      let badge = [...author.querySelectorAll('[data-xfc-velocity]')].find(node => node.closest('[data-testid="User-Name"]') === author);
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute('data-xfc-velocity', '');
        badge.tabIndex = 0;
        const placement = badgePlacement(author);
        if (placement?.after) placement.anchor.after(badge);
        else if (placement) placement.anchor.append(badge);
        else author.append(badge);
      }
      const rate = record.views / Math.max((now - record.createdAt) / 3600000, 0.1);
      const tier = rate >= settings.velocityViralThreshold ? 'viral' : rate >= settings.velocityRisingThreshold ? 'rising' : 'normal';
      const text = `${number(rate)}/小时`;
      const title = description(record, rate);
      if (badge.textContent !== text) badge.textContent = text;
      badge.removeAttribute('title');
      descriptions.set(badge, title);
      badge.setAttribute('aria-label', title);
      if (tooltipAnchor === badge) {
        const tooltip = document.querySelector('[data-xfc-velocity-tooltip]');
        if (tooltip) tooltip.textContent = title;
      }
      if (badge.dataset.tier !== tier) badge.dataset.tier = tier;
      used.add(badge);
    }
    for (const badge of document.querySelectorAll('[data-xfc-velocity]')) if (!used.has(badge)) badge.remove();
    if (tooltipAnchor && !tooltipAnchor.isConnected) hideTooltip();
    renderBookmarkCounts();
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
        const clean = { id: record.id, valid: false, observedAt: record.observedAt, quotedId };
        if (Number.isSafeInteger(record.bookmarks) && record.bookmarks >= 0) clean.bookmarks = record.bookmarks;
        tweets.set(record.id, clean);
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
