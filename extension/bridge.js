(() => {
  'use strict';
  const CHANNEL = 'x-follower-count-v1';
  const MAX_USERS = 5000;
  const users = new Map();
  const tweets = new Map();
  const TTL = 30 * 60 * 1000;
  const FIELDS = ['count', 'bio', 'location', 'following', 'followRequestSent', 'followBlocked'];

  function readableBio(text, urls) {
    let result = text;
    if (!Array.isArray(urls)) return result;
    for (const entry of urls.slice(0, 30)) {
      if (typeof entry?.url !== 'string' || !entry.url || typeof entry.expanded_url !== 'string') continue;
      try {
        const target = new URL(entry.expanded_url);
        if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
        // 仅用 X 已返回的网址生成可读文字，不访问短链接或额外请求网站。
        const label = target.hostname.replace(/^www\./, '') + target.pathname.replace(/\/$/, '');
        result = result.split(entry.url).join(label);
      } catch { /* 无法解析的链接保留原文。 */ }
    }
    return result;
  }

  // 只提取展示所需的账号字段，不保存原始响应、Cookie 或授权头。
  function extractUsers(root) {
    const output = new Map();
    const stack = [root];
    let visited = 0;
    while (stack.length && visited++ < 50000) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const handle = node.core?.screen_name ?? node.legacy?.screen_name ?? node.screen_name;
      const count = node.relationship_counts?.followers ?? node.legacy?.followers_count ?? node.followers_count;
      if (typeof handle === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(handle)) {
        const key = handle.toLowerCase();
        const record = { handle: key };
        const following = node.relationship_perspectives?.following ?? node.legacy?.following ?? node.following;
        const requested = node.follow_request_sent ?? node.legacy?.follow_request_sent;
        const blocking = node.relationship_perspectives?.blocking ?? node.legacy?.blocking;
        const blockedBy = node.relationship_perspectives?.blocked_by ?? node.legacy?.blocked_by;
        if (typeof following === 'boolean') record.following = following;
        if (typeof requested === 'boolean') record.followRequestSent = requested;
        if (typeof blocking === 'boolean' || typeof blockedBy === 'boolean') record.followBlocked = blocking === true || blockedBy === true;
        if (Number.isSafeInteger(count) && count >= 0) record.count = count;
        const bio = node.profile_bio?.description ?? node.legacy?.description ?? node.description;
        const location = node.location?.location ?? node.legacy?.location ?? node.location;
        if (typeof bio === 'string') {
          const urls = node.profile_bio?.entities?.description?.urls
            ?? node.legacy?.entities?.description?.urls ?? node.entities?.description?.urls;
          record.bio = readableBio(bio, urls).slice(0, 2000);
        }
        if (typeof location === 'string') record.location = location.slice(0, 300);
        if (Object.keys(record).length > 1) output.set(key, { ...output.get(key), ...record });
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') stack.push(value);
      }
    }
    return [...output.values()];
  }

  function shareFields(node, id) {
    const legacy = node.legacy || {};
    const user = node.core?.user_results?.result;
    const authorHandle = user?.core?.screen_name ?? user?.legacy?.screen_name;
    const authorName = user?.core?.name ?? user?.legacy?.name;
    const note = node.note_tweet?.note_tweet_results?.result;
    let text = note?.text ?? legacy.full_text ?? legacy.text;
    if (typeof text !== 'string') return {};
    const replacements = new Map();
    const canonicalArticle = typeof authorHandle === 'string' ? `https://x.com/${authorHandle}/article/${id}` : '';
    for (const entry of [...(legacy.entities?.urls || []), ...(note?.entity_set?.urls || [])].slice(0, 100)) {
      if (typeof entry?.url !== 'string' || typeof entry.expanded_url !== 'string') continue;
      const expanded = canonicalArticle && /^https?:\/\/(?:x|twitter)\.com\/i\/article\/\d+/i.test(entry.expanded_url)
        ? canonicalArticle : entry.expanded_url;
      replacements.set(entry.url, expanded);
    }
    for (const media of (legacy.extended_entities?.media || legacy.entities?.media || []).slice(0, 20)) {
      if (typeof media?.url !== 'string') continue;
      if (media.type === 'photo' && typeof media.media_url_https === 'string') {
        replacements.set(media.url, `![](${media.media_url_https})`);
      } else if (media.type === 'video' || media.type === 'animated_gif') {
        const videos = (media.video_info?.variants || []).filter(item => item?.content_type === 'video/mp4' && typeof item.url === 'string')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        const url = videos[0]?.url ?? media.media_url_https;
        if (typeof url === 'string') replacements.set(media.url, `[视频](${url})`);
      }
    }
    for (const [source, target] of replacements) text = text.split(source).join(target);
    const fields = { text: text.slice(0, 50000) };
    if (typeof authorHandle === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(authorHandle)) fields.authorHandle = authorHandle;
    if (typeof authorName === 'string') fields.authorName = authorName.slice(0, 200);
    return fields;
  }

  // Never request tweet details: these metrics come only from responses X already received.
  function consumeTweets(root) {
    const stack = [{ node: root, promoted: false }];
    const records = new Map();
    let visited = 0;
    const now = Date.now();
    while (stack.length && visited++ < 50000) {
      const { node, promoted: inherited } = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const promoted = inherited || Object.hasOwn(node, 'promotedMetadata')
        || Object.hasOwn(node, 'promoted_metadata') || /^promoted-/.test(node.entryId || node.entry_id || '');
      const id = node.rest_id ?? node.legacy?.id_str;
      if ((node.__typename === 'Tweet' || node.legacy?.created_at) && /^\d{1,25}$/.test(id || '')) {
        const raw = node.views?.count;
        const views = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
        const createdAt = Date.parse(node.legacy?.created_at ?? node.created_at);
        const record = { id, observedAt: now, ...shareFields(node, id), valid: !promoted && node.views?.state === 'EnabledWithCount'
          && Number.isSafeInteger(views) && views >= 0 && Number.isFinite(createdAt) && createdAt <= now };
        const bookmarks = node.legacy?.bookmark_count;
        if (!promoted && Number.isSafeInteger(bookmarks) && bookmarks >= 0) record.bookmarks = bookmarks;
        const quoted = node.quoted_status_result?.result;
        const quotedId = node.legacy?.quoted_status_id_str ?? quoted?.rest_id ?? quoted?.tweet?.rest_id;
        if (typeof quotedId === 'string' && /^\d{1,25}$/.test(quotedId)) record.quotedId = quotedId;
        if (record.valid) {
          Object.assign(record, { views, createdAt });
          for (const [field, source] of Object.entries({ likes: 'favorite_count', reposts: 'retweet_count', replies: 'reply_count' })) {
            const value = node.legacy?.[source];
            if (Number.isSafeInteger(value) && value >= 0) record[field] = value;
          }
        }
        // If any occurrence belongs to an ad, fail closed for that response.
        if (records.get(id)?.valid !== false) records.set(id, record);
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') stack.push({ node: value, promoted });
      }
    }
    for (const [id, record] of records) { tweets.delete(id); tweets.set(id, record); }
    for (const [id, record] of tweets) if (now - record.observedAt >= TTL) tweets.delete(id);
    while (tweets.size > MAX_USERS) tweets.delete(tweets.keys().next().value);
    publishTweets([...records.values()]);
  }

  function publishTweets(records) {
    for (let i = 0; i < records.length; i += 250) {
      window.postMessage({ channel: CHANNEL, type: 'tweets', tweets: records.slice(i, i + 250) }, location.origin);
    }
  }

  function publish(records) {
    for (let i = 0; i < records.length; i += 250) {
      window.postMessage({ channel: CHANNEL, type: 'counts', users: records.slice(i, i + 250) }, location.origin);
    }
  }

  function consume(json, url) {
    const records = extractUsers(json);
    consumeTweets(json);
    const action = typeof url === 'string' && url.match(/\/friendships\/(create|destroy|cancel)\.json(?:\?|$)/)?.[1];
    if (action && json?.errors) return;
    // 原生关注接口成功时 following 仍可能是操作前的值，以成功动作和请求中标识为准。
    if (action && (json?.screen_name || json?.legacy?.screen_name)) {
      for (const record of records) {
        if (record.handle !== (json.screen_name ?? json.legacy.screen_name).toLowerCase()) continue;
        record.following = action === 'create' && record.followRequestSent !== true;
        if (action !== 'create') record.followRequestSent = false;
      }
    }
    const now = Date.now();
    for (const record of records) {
      const cached = users.get(record.handle) || {};
      for (const field of FIELDS) {
        if (Object.hasOwn(record, field)) cached[field] = { value: record[field], at: now };
      }
      users.delete(record.handle);
      users.set(record.handle, cached);
    }
    while (users.size > MAX_USERS) users.delete(users.keys().next().value);
    publish(records);
  }

  function isUserResponse(url) {
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && (parsed.pathname.startsWith('/i/api/graphql/')
        || /^\/i\/api\/1\.1\/friendships\/(create|destroy|cancel)\.json$/.test(parsed.pathname));
    } catch { return false; }
  }

  // 克隆响应，不消耗 X 自己需要读取的正文；额外处理失败不能影响原请求。
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const pending = Reflect.apply(originalFetch, this, args);
    pending.then(response => {
      if (response.ok && isUserResponse(response.url)) {
        response.clone().json().then(json => consume(json, response.url)).catch(() => {});
      }
    }).catch(() => {});
    return pending;
  };

  // X 当前使用 XHR，兼容将来改用 fetch 的情况。
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('loadend', () => {
      try {
        if (this.status < 200 || this.status >= 300 || !isUserResponse(this.responseURL)) return;
        if (this.responseType === 'json') consume(this.response, this.responseURL);
        else if (!this.responseType || this.responseType === 'text') consume(JSON.parse(this.responseText), this.responseURL);
      } catch { /* 非 JSON 或接口异常时，不改动页面行为。 */ }
    }, { once: true });
    return Reflect.apply(originalSend, this, args);
  };

  // 两个脚本启动顺序不固定，界面准备好时重放本次页面收到的数据。
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin
        || event.data?.channel !== CHANNEL || event.data.type !== 'ready') return;
    const now = Date.now();
    const records = [];
    for (const [handle, cached] of users) {
      const record = { handle, observedAt: {} };
      for (const field of FIELDS) {
        if (cached[field] && now - cached[field].at < TTL) {
          record[field] = cached[field].value;
          record.observedAt[field] = cached[field].at;
        }
      }
      if (Object.keys(record.observedAt).length) records.push(record);
    }
    publish(records);
    publishTweets([...tweets.values()].filter(record => now - record.observedAt < TTL));
  });
})();
