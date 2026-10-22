(() => {
  'use strict';
  const rules = window.xpandmaxFilterRules;
  let config = rules.settings(), loaded = false, scheduled = false;
  const changedSinceLoad = new Set();
  const rows = new WeakMap(), expanded = new Set();
  let whiteSave = false;
  function identity(article) {
    const header = article.querySelector('[data-testid="User-Name"], [data-testid="UserName"]');
    if (!header || header.closest('article') !== article) return null;
    const handles = new Set();
    for (const link of header.querySelectorAll('a[href]')) {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/);
        if (url.origin === location.origin && match) handles.add(match[1].toLowerCase());
      } catch { /* Ignore malformed links. */ }
    }
    if (handles.size !== 1) return null;
    const handle = [...handles][0];
    for (const time of article.querySelectorAll('a[href] time')) {
      try {
        const link = time.closest('a');
        const url = new URL(link.getAttribute('href'), location.href);
        const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d{1,25})\/?$/);
        if (url.origin === location.origin && match?.[1].toLowerCase() === handle) return { handle, id: match[2], key: `${handle}:${match[2]}` };
      } catch { /* Malformed time links cannot identify a post. */ }
    }
    return null;
  }
  function text(article) {
    return [...article.querySelectorAll('[data-testid="tweetText"]')].filter(node => {
      if (node.closest('article') !== article) return false;
      // A quote's words must not be attributed to the outer author.
      const quote = node.closest('[role="link"]');
      return !quote || !quote.querySelector('[data-testid="User-Name"], [data-testid="UserName"]');
    }).map(node => node.textContent).join('\n');
  }
  const profile = handle => window.xpandmaxProfiles?.get(handle) || {};
  function evaluate(article) {
    const who = identity(article);
    if (!who || !loaded) return null;
    const match = rules.match(text(article), profile(who.handle).bio, who.handle, config);
    return match ? { ...who, ...match } : null;
  }
  function reset(article) {
    article.removeAttribute('data-xfc-filtered');
    for (const child of [...article.children]) if (child.hasAttribute('data-xfc-filter-notice')) child.remove();
    rows.delete(article);
  }
  function render() {
    scheduled = false;
    for (const article of document.querySelectorAll('article')) {
      const hit = evaluate(article);
      if (!hit) { if (rows.has(article)) reset(article); continue; }
      let row = rows.get(article);
      if (!row || row.key !== hit.key || row.keyword !== hit.keyword || row.source !== hit.source) {
        reset(article);
        const notice = document.createElement('div');
        notice.setAttribute('data-xfc-filter-notice', '');
        const label = document.createElement('p');
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        const show = document.createElement('button'), trust = document.createElement('button');
        show.type = trust.type = 'button';
        trust.textContent = `信任 @${hit.handle}`;
        show.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          if (expanded.has(hit.key)) expanded.delete(hit.key); else expanded.add(hit.key);
          while (expanded.size > 1000) expanded.delete(expanded.values().next().value);
          schedule();
        });
        trust.addEventListener('click', async event => {
          event.preventDefault(); event.stopPropagation();
          if (whiteSave || identity(article)?.key !== hit.key) return;
          whiteSave = true; trust.disabled = true;
          try {
            const saved = await chrome.storage.local.get(rules.storageDefaults);
            const next = rules.whitelist(rules.settings(saved)); next.add(hit.handle);
            if (next.size > 1000) throw new Error('白名单已满');
            await chrome.storage.local.set({ filterWhitelist: [...next].join('\n') });
            config.filterWhitelist = [...next].join('\n'); schedule();
          } catch { status.textContent = '白名单保存失败，请重试'; }
          finally { whiteSave = false; trust.disabled = false; }
        });
        notice.append(label, status, show, trust);
        // Preserve the original article tree so unfolding restores X's own content.
        article.append(notice);
        row = { ...hit, notice, label, status, show };
        rows.set(article, row);
      }
      const open = expanded.has(hit.key);
      const collapsed = !open;
      if (article.getAttribute('data-xfc-filtered') !== String(collapsed)) article.setAttribute('data-xfc-filtered', String(collapsed));
      const label = `已过滤：${hit.label} · ${hit.source}匹配「${hit.keyword}」 · @${hit.handle}`;
      if (row.label.textContent !== label) row.label.textContent = label;
      const buttonLabel = open ? '重新折叠' : '展开内容';
      if (row.show.textContent !== buttonLabel) row.show.textContent = buttonLabel;
      row.show.setAttribute('aria-expanded', String(open));
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }
  chrome.storage.local.get(rules.storageDefaults, saved => {
    if (chrome.runtime.lastError) return;
    const initial = rules.settings(saved);
    for (const key of Object.keys(rules.defaults)) if (!changedSinceLoad.has(key)) config[key] = initial[key];
    loaded = true; schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some(key => key in rules.defaults)) return;

    for (const key of Object.keys(rules.defaults)) {
      if (['filterWhitelist', 'filterBlacklist'].includes(key)) continue;
      if (changes[key]) { config[key] = changes[key].newValue ?? rules.defaults[key]; changedSinceLoad.add(key); }
    }
    config = rules.settings(config);
    schedule();
  });
  new MutationObserver(mutations => {
    if (mutations.some(m => !m.target.closest?.('[data-xfc-filter-notice]'))) schedule();
  }).observe(document, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-testid'] });
  for (const event of ['xpandmax:profiles', 'popstate', 'pageshow']) window.addEventListener(event, schedule);
})();
