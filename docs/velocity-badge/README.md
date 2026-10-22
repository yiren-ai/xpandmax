# 流速徽章的读数与位置调整

分支 `codex/xpandmax-velocity-display`，基于 `origin/main` 的 0.9.6。这里放两张看得见的证据：`preview.png` 是信息流与详情页的对照，`placement.html` 单独比较胶囊在详情页的四种落点。

## 三条规则

**一、分母用观测时刻。** 原来 `Date.now() - createdAt`，页面每重算一次分母就变长，一条两小时、120 万浏览的帖每秒掉 83。改用 `observedAt - createdAt` 后，数字只在真的收到新数据时变，和 X 自己的查看数同频。

**二、三位有效数字。** 472、7,900、59.7万，配 `tabular-nums`，位数变化不再让元信息行重排；精确值留在 `title`。

**三、跟着身份行。** 信息流和引用卡片附在发布时间后面；详情页 header 没有内联时间戳，就贴到 `@handle` 后面。`metaAnchor()` 找不到锚点就不渲染，去掉 `author.append(badge)` 那个兜底——它会把胶囊塞到作者名容器末尾，让它自占一行、居中，还把简介行顶下去约 30px。

顺带把「每帧重算」换成按记录缓存：同一条记录只在数据或阈值变化时格式化一次，DOM 变动再频繁也不重复算。

## 验证

`node --test tests/velocity.test.cjs` 覆盖取整、锚点位置和原有回归；`npm test` 87 条全绿。

详情页 header 的真实 DOM 结构还没有实机确认，规则是「取账号链接里最后一个当 `@handle`」。
