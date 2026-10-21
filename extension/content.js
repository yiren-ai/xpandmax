(() => {
  'use strict';
  const CHANNEL = 'x-follower-count-v1';
  const BADGE = 'data-xfc-badge';
  const FIELDS = ['count', 'bio', 'location', 'following', 'followRequestSent', 'followBlocked'];
  const counts = new Map();
  const TTL = 30 * 60 * 1000;
  let scheduled = false;
  let preview;
  let previewAnchor;
  let expandedProfile = null;

  function profileData(handle) {
    const cached = counts.get(handle) || {};
    const now = Date.now();
    const profile = {};
    for (const field of FIELDS) {
      if (cached[field] && now - cached[field].at < TTL) profile[field] = cached[field].value;
    }
    return profile;
  }

  function pageTheme() {
    const color = getComputedStyle(document.body || document.documentElement).backgroundColor.match(/[\d.]+/g);
    return color && Number(color[0]) + Number(color[1]) + Number(color[2]) < 384
      && (color.length < 4 || Number(color[3]) > 0) ? 'dark' : 'light';
  }

  function hidePreview() {
    previewAnchor?.removeAttribute('aria-describedby');
    previewAnchor = null;
    if (preview) preview.hidden = true;
  }

  function showPreview(anchor) {
    if (!anchor?.isConnected || !document.body) return hidePreview();
    if (previewAnchor !== anchor) hidePreview();
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'xpandmax-profile-preview';
      preview.setAttribute('data-xfc-preview', '');
      preview.setAttribute('role', 'tooltip');
      document.body.append(preview);
    }
    previewAnchor = anchor;
    const handle = anchor.dataset.xfcHandle;
    const profile = profileData(handle);
    const showProfileBio = document.documentElement.dataset.xfcShowProfileBio !== 'false';
    preview.replaceChildren();
    const addLine = (tag, text, kind) => {
      const line = document.createElement(tag);
      line.textContent = text;
      line.dataset.xfcPreviewLine = kind;
      preview.append(line);
    };
    addLine('strong', `@${handle}`, 'handle');
    const summary = [];
    if (profile.count !== undefined) summary.push(`${profile.count.toLocaleString('zh-CN')} 位粉丝`);
    if (summary.length) addLine('div', summary.join(' · '), 'summary');
    if (showProfileBio && profile.bio?.trim()) addLine('p', profile.bio.trim(), 'bio');
    if (showProfileBio && profile.location?.trim()) addLine('p', profile.location.trim(), 'location');
    if (showProfileBio && !profile.bio?.trim() && !profile.location?.trim()) {
      addLine('p', profile.bio !== undefined && profile.location !== undefined
        ? '这个账号尚未填写简介和所在地。' : '页面尚未返回简介或所在地。', 'empty');
    }
    // 跟随 X 当前的页面底色，不要求用户另外设置主题。
    preview.dataset.xfcTheme = pageTheme();
    preview.hidden = false;
    anchor.setAttribute('aria-describedby', preview.id);
    const rect = anchor.getBoundingClientRect();
    const margin = 10;
    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    preview.style.left = `${Math.max(margin, Math.min(rect.left, innerWidth - width - margin))}px`;
    const below = rect.bottom + 8;
    preview.style.top = `${Math.max(margin, below + height <= innerHeight - margin ? below : rect.top - height - 8)}px`;
  }

  function formatCount(value) {
    if (value >= 100000000) return `${Number((value / 100000000).toFixed(1))}亿`;
    if (value >= 10000) return `${Number((value / 10000).toFixed(1))}万`;
    return value.toLocaleString('zh-CN');
  }

  function profileLink(cell) {
    // 优先头像对应的账号，避免把简介里提到的其他人误认成该行用户。
    const avatar = cell.querySelector('[data-testid^="UserAvatar-Container-"]');
    const avatarHandle = avatar?.getAttribute('data-testid').slice('UserAvatar-Container-'.length).toLowerCase();
    for (const link of cell.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(link.getAttribute('href'), location.href); }
      catch { continue; }
      const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/?$/);
      if (url.origin !== location.origin || !match || link.getAttribute('aria-hidden') === 'true') continue;
      const handle = match[1].toLowerCase();
      if (avatarHandle && handle !== avatarHandle) continue;
      if (!link.textContent.trim()) continue;
      return { link, handle };
    }
    return null;
  }

  function authorHeader(header) {
    const name = header.firstElementChild;
    if (!name) return null;
    // 仅看这个作者标题内的链接，不向外查找，避免引用帖认成外层作者。
    const profile = profileLink(header);
    if (profile) return { anchor: name, handle: profile.handle, mode: 'append' };
    // 引用帖中的名字不是链接；从标题的账号一栏读取完整 @handle。
    const accountColumn = header.children[1];
    if (!accountColumn) return null;
    const handles = new Set();
    for (const node of accountColumn.querySelectorAll('span, div')) {
      if (node.children.length) continue;
      const match = node.textContent.trim().match(/^@([a-zA-Z0-9_]{1,15})$/);
      if (match) handles.add(match[1].toLowerCase());
    }
    if (handles.size !== 1) return null;
    return { anchor: name, handle: [...handles][0], mode: 'append' };
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function part(parent, attribute, tag = 'span') {
    let node = [...parent.children].find(child => child.hasAttribute(attribute));
    if (!node) {
      node = document.createElement(tag);
      node.setAttribute(attribute, '');
      parent.append(node);
    }
    return node;
  }

  function render() {
    scheduled = false;
    const theme = pageTheme();
    const showFollowerCount = document.documentElement.dataset.xfcShowFollowerCount !== 'false';
    const showProfileBio = document.documentElement.dataset.xfcShowProfileBio !== 'false';
    const targets = [];
    for (const cell of document.querySelectorAll('[data-testid="UserCell"]')) {
      const profile = profileLink(cell);
      if (profile) targets.push({ root: cell, anchor: profile.link, handle: profile.handle, mode: 'after' });
    }
    for (const header of document.querySelectorAll('[data-testid="User-Name"], [data-testid="UserName"]')) {
      if (header.closest('[data-testid="UserCell"]')) continue;
      const profile = authorHeader(header);
      if (profile) targets.push({ root: header, ...profile });
    }
    const liveBadges = new Set();
    const liveProfiles = new Set();
    const liveHosts = new Set();
    const liveRows = new Set();
    for (const profile of targets) {
      const record = profileData(profile.handle);
      const known = record.count !== undefined;
      const bio = showProfileBio ? record.bio?.trim() : '';
      const location = showProfileBio ? record.location?.trim() : '';
      const inline = profile.mode === 'append' && !!profile.root.closest('article');
      if (inline) {
        if (!known && !bio && !location) continue;
        const details = part(profile.root, 'data-xfc-inline-profile', 'div');
        if (details.dataset.xfcHandle !== profile.handle) {
          if (expandedProfile === details) expandedProfile = null;
          delete details.dataset.xfcShowOriginal;
        }
        details.dataset.xfcHandle = profile.handle;
        details.dataset.xfcTheme = theme;
        details.dataset.xfcLayout = 'compact';
        const inlineRow = part(details, 'data-xfc-inline-row', 'div');
        let countToggle = inlineRow.querySelector('[data-xfc-count-toggle]');
        if (!showFollowerCount) countToggle?.remove();
        else {
          countToggle = countToggle || part(inlineRow, 'data-xfc-count-toggle', 'button');
          if (inlineRow.firstElementChild !== countToggle) inlineRow.prepend(countToggle);
          countToggle.setAttribute('data-xfc-toggle', '');
          countToggle.type = 'button';
          const badge = part(countToggle, BADGE);
          badge.dataset.xfcHandle = profile.handle;
          badge.dataset.xfcState = known ? 'ready' : 'pending';
          badge.dataset.xfcTheme = theme;
          setText(part(badge, 'data-xfc-count'), known ? formatCount(record.count) : '—');
          setText(part(badge, 'data-xfc-count-label'), '粉丝');
          badge.title = known ? `${record.count.toLocaleString('zh-CN')} 位粉丝` : '粉丝数暂缺';
          liveBadges.add(badge);
        }
        const toggle = part(inlineRow, 'data-xfc-summary-toggle', 'button');
        toggle.setAttribute('data-xfc-toggle', '');
        toggle.type = 'button';
        const rect = details.getBoundingClientRect();
        const translation = bio && window.xpandmaxTranslations?.[rect.bottom >= 0 && rect.top < innerHeight + 300 ? 'request' : 'inspect'](bio);
        const translated = translation?.state === 'ready';
        const displayedBio = translated && details.dataset.xfcShowOriginal !== 'true' ? translation.text : bio;
        const summary = part(toggle, 'data-xfc-summary');
        setText(summary, (displayedBio || '').replace(/\s+/g, ' '));
        const hasDetails = !!(bio || location);
        if (!hasDetails && expandedProfile === details) expandedProfile = null;
        const open = expandedProfile === details;
        details.dataset.xfcOpen = String(open);
        toggle.disabled = !hasDetails;
        toggle.setAttribute('aria-expanded', String(open));
        if (countToggle) {
          countToggle.disabled = !hasDetails;
          countToggle.setAttribute('aria-expanded', String(open));
        }
        summary.hidden = open || !displayedBio;
        const closeLabel = part(toggle, 'data-xfc-close-label');
        setText(closeLabel, '收起');
        closeLabel.hidden = !open;
        const chevron = part(toggle, 'data-xfc-chevron');
        setText(chevron, open ? '⌃' : '⌄');
        chevron.setAttribute('aria-hidden', 'true');
        chevron.hidden = !hasDetails;
        const article = profile.root.closest('article');
        const primaryHeader = article.querySelector('[data-testid="User-Name"], [data-testid="UserName"]');
        const ownLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
        const ownHandle = ownLink?.replace(/^\//, '').replace(/\/$/, '').toLowerCase();
        const followState = window.xpandmaxFollow?.state(profile.handle);
        const canFollow = primaryHeader === profile.root && !!article.querySelector('[data-testid="caret"]')
          && profile.handle !== ownHandle && !record.followBlocked
          && ((record.following === false && !record.followRequestSent) || !!followState);
        let follow = inlineRow.querySelector('[data-xfc-follow]');
        if (!canFollow) follow?.remove();
        else {
          follow = follow || part(inlineRow, 'data-xfc-follow', 'button');
          follow.type = 'button';
          const state = followState?.status || 'idle';
          const label = { pending: '关注中…', success: '已关注', requested: '已请求', error: '重试关注' }[state] || '关注';
          setText(follow, label);
          follow.dataset.xfcFollowState = state;
          follow.disabled = ['pending', 'success', 'requested'].includes(state);
          follow.setAttribute('aria-label', `${label} @${profile.handle}`);
          follow.title = followState?.message || `关注 @${profile.handle}`;
          if (follow.nextElementSibling !== toggle) inlineRow.insertBefore(follow, toggle);
        }
        const body = part(details, 'data-xfc-expanded', 'div');
        body.hidden = !open;
        for (const [field, value] of [['bio', displayedBio], ['location', location]]) {
          const attr = `data-xfc-inline-${field}`;
          if (value) setText(part(body, attr, 'div'), value.replace(/\r\n?/g, '\n'));
          else body.querySelector(`[${attr}]`)?.remove();
        }
        let control = body.querySelector('[data-xfc-translation]');
        const action = translated ? 'toggle' : ['activate', 'failed'].includes(translation?.state) ? 'enable' : null;
        if (!action) control?.remove();
        else {
          control = control || part(body, 'data-xfc-translation', 'button');
          control.type = 'button';
          control.dataset.xfcAction = action;
          setText(control, action === 'toggle' ? (details.dataset.xfcShowOriginal === 'true' ? '查看中文' : '查看原文')
            : translation.state === 'failed' ? '重试中文翻译' : '启用中文翻译');
          control.title = action === 'enable' ? (translation.error || '本地翻译首次使用可能需要下载语言包；可在插件设置中选择翻译方式') : '';
        }
        if (translated) details.setAttribute('data-xfc-translated', '');
        else details.removeAttribute('data-xfc-translated');
        if (['queued', 'translating'].includes(translation?.state)) setText(part(body, 'data-xfc-translation-status'), '正在翻译…');
        else if (translation?.state === 'failed' && translation.error) setText(part(body, 'data-xfc-translation-status'), translation.error);
        else body.querySelector('[data-xfc-translation-status]')?.remove();
        profile.root.setAttribute('data-xfc-inline-host', '');
        liveHosts.add(profile.root);
        liveProfiles.add(details);
      } else {
        if (!showFollowerCount) continue;
        const row = profile.mode === 'after' ? profile.anchor.parentElement : profile.anchor;
        let badge = [...row.children].find(child => child.hasAttribute(BADGE));
        if (badge && badge.dataset.xfcHandle !== profile.handle) { badge.remove(); badge = null; }
        if (!badge) {
          badge = document.createElement('span');
          badge.setAttribute(BADGE, '');
          badge.tabIndex = 0;
          if (profile.mode === 'after') profile.anchor.insertAdjacentElement('afterend', badge);
          else profile.anchor.append(badge);
        }
        badge.dataset.xfcHandle = profile.handle;
        badge.dataset.xfcTheme = theme;
        badge.dataset.xfcState = known ? 'ready' : 'pending';
        setText(badge, known ? `粉丝 ${formatCount(record.count)}` : '粉丝 —');
        row.setAttribute('data-xfc-name-row', '');
        liveRows.add(row);
        liveBadges.add(badge);
      }
    }
    document.querySelectorAll(`[${BADGE}]`).forEach(node => { if (!liveBadges.has(node)) node.remove(); });
    document.querySelectorAll('[data-xfc-relationship]').forEach(node => node.remove());
    document.querySelectorAll('[data-xfc-inline-profile]').forEach(node => { if (!liveProfiles.has(node)) node.remove(); });
    document.querySelectorAll('[data-xfc-inline-host]').forEach(node => { if (!liveHosts.has(node)) node.removeAttribute('data-xfc-inline-host'); });
    document.querySelectorAll('[data-xfc-name-row]').forEach(node => { if (!liveRows.has(node)) node.removeAttribute('data-xfc-name-row'); });
    if (expandedProfile && !liveProfiles.has(expandedProfile)) expandedProfile = null;
    if (previewAnchor) {
      if (previewAnchor.isConnected) showPreview(previewAnchor);
      else hidePreview();
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin
        || event.data?.channel !== CHANNEL || event.data.type !== 'counts'
        || !Array.isArray(event.data.users) || event.data.users.length > 250) return;
    for (const user of event.data.users) {
      if (!user || typeof user.handle !== 'string' || !/^[a-zA-Z0-9_]{1,15}$/.test(user.handle)) continue;
      const handle = user.handle.toLowerCase();
      const cached = counts.get(handle) || {};
      let updated = false;
      const now = Date.now();
      for (const field of FIELDS) {
        const value = user[field];
        const valid = field === 'count' ? Number.isSafeInteger(value) && value >= 0
          : ['following', 'followRequestSent', 'followBlocked'].includes(field) ? typeof value === 'boolean'
            : typeof value === 'string' && value.length <= (field === 'bio' ? 2000 : 300);
        if (!valid) continue;
        const at = user.observedAt?.[field] ?? now;
        if (!Number.isFinite(at) || at > now || now - at >= TTL || (cached[field] && at < cached[field].at)) continue;
        cached[field] = { value, at };
        updated = true;
      }
      if (!updated) continue;
      counts.delete(handle);
      counts.set(handle, cached);
    }
    while (counts.size > 5000) counts.delete(counts.keys().next().value);
    window.dispatchEvent(new Event('xpandmax:profiles'));
    schedule();
  });

  function previewTarget(event) {
    const target = event.target instanceof Element ? event.target.closest(`[${BADGE}]`) : null;
    return target?.closest('[data-xfc-inline-profile]') ? null : target;
  }
  document.addEventListener('click', event => {
    const follow = event.target instanceof Element ? event.target.closest('[data-xfc-follow]') : null;
    if (follow) {
      event.preventDefault();
      event.stopPropagation();
      // 只有真实点击或键盘激活可以关注；网页伪造事件不会触发账号操作。
      if (!event.isTrusted || follow.disabled) return;
      const details = follow.closest('[data-xfc-inline-profile]');
      window.xpandmaxFollow?.start({ button: follow, details, handle: details.dataset.xfcHandle, getProfile: profileData });
      return;
    }
    const toggle = event.target instanceof Element ? event.target.closest('[data-xfc-toggle]') : null;
    if (toggle && !toggle.disabled) {
      event.preventDefault();
      event.stopPropagation();
      const details = toggle.closest('[data-xfc-inline-profile]');
      expandedProfile = expandedProfile === details ? null : details;
      hidePreview();
      schedule();
      return;
    }
    const control = event.target instanceof Element ? event.target.closest('[data-xfc-translation]') : null;
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    if (control.dataset.xfcAction === 'enable') window.xpandmaxTranslations?.enable();
    else {
      const details = control.closest('[data-xfc-inline-profile]');
      details.dataset.xfcShowOriginal = details.dataset.xfcShowOriginal === 'true' ? 'false' : 'true';
    }
    schedule();
  }, true);
  window.addEventListener('xpandmax:translation', schedule);
  window.addEventListener('xpandmax:followstate', schedule);
  window.addEventListener('xpandmax:settings', schedule);
  document.addEventListener('mouseover', event => {
    const anchor = previewTarget(event);
    if (anchor) showPreview(anchor);
  });
  document.addEventListener('mouseout', event => {
    const anchor = previewTarget(event);
    if (anchor && (!(event.relatedTarget instanceof Node) || !anchor.contains(event.relatedTarget))) hidePreview();
  });
  document.addEventListener('focusin', event => {
    const anchor = previewTarget(event);
    if (anchor) showPreview(anchor);
  });
  document.addEventListener('focusout', event => { if (previewTarget(event)) hidePreview(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hidePreview(); expandedProfile = null; schedule(); }
  });
  window.addEventListener('scroll', () => { hidePreview(); schedule(); }, true);
  window.addEventListener('resize', hidePreview);

  // 监听路由、列表追加、虚拟列表复用和名字变化。自身标签变化不会重复写入。
  new MutationObserver(mutations => {
    // 预览自身的文本和位置更新不触发下一次渲染，避免悬停时循环刷新。
    if (mutations.some(mutation => {
      if (mutation.type === 'attributes' && ['class', 'style'].includes(mutation.attributeName)) {
        return mutation.target === document.body || mutation.target === document.documentElement;
      }
      return !mutation.target.parentElement?.closest('[data-xfc-preview]')
        && !mutation.target.closest?.('[data-xfc-preview]');
    })) schedule();
  }).observe(document, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['href', 'data-testid', 'class', 'style']
  });
  window.addEventListener('popstate', schedule);
  window.addEventListener('pageshow', schedule);
  setInterval(schedule, 30000);
  window.postMessage({ channel: CHANNEL, type: 'ready' }, location.origin);
  schedule();
})();
