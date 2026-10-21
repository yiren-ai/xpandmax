# XpandMax

**帮你在 X 上连接更大的世界。**

[英文官网](https://xpandmax.com) · 在 X 上直接查看粉丝数和简短中文简介。

**MIT 开源，欢迎贡献。** [源代码](https://github.com/yiren-ai/xpandmax) · [提交问题](https://github.com/yiren-ai/xpandmax/issues) · [贡献指南](CONTRIBUTING.md) · [Pull Requests](https://github.com/yiren-ai/xpandmax/pulls)

在作者名下显示一行轻量注释：蓝色粉丝数和一小段中文简介，统一 12px、400 常规字重。点击展开完整简介、所在地和原文切换，同时最多展开一位作者。支持首页、回复、引用帖、搜索与账号列表。

默认无需 API Key，无额外账号查询。数据来自当前页面已经收到的 X 响应；可选接入自己的翻译 API。

![使用虚构账号的效果示意](docs/preview.svg)

## 安装到 Chrome

1. 从 [官网安装页](https://xpandmax.com/install/) 下载 `xpandmax-版本号.zip` 并解压；也可以下载项目源代码。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 打开右上角「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择解压后的 `extension` 文件夹，里面应该能看到 `manifest.json`。
5. 刷新已经打开的 X 页面，打开首页或任意账号的关注者列表即可。

普通用户优先从 [Chrome Web Store](https://chromewebstore.google.com/detail/dckjdeemcnjccfbinnmncalmoajleboo) 安装，无需开发者模式。商店版本以商店页面为准，可能与仓库代码不同。上面的步骤用于手动安装源码版本。

## 使用说明

- 默认隐藏左侧「通知」图标上的未读数字。点击 Chrome 工具栏里的 XpandMax，关闭「隐藏通知未读数字」即可恢复，切换后立即生效。通知入口和通知内容保持可用，不会将通知标记为已读。
- **沉浸式浏览**：点击 Chrome 工具栏里的 XpandMax，可独立选择「隐藏左侧导航」和「隐藏右侧栏」。左侧默认保留，开启隐藏后收起主页、通知等导航入口，并将主内容区居中；右侧默认整栏隐藏，包括搜索框、赛事、热门趋势、推荐关注、底部链接和版权信息，同时收回右栏占用的布局宽度。开关立即生效并在本机保存，可随时从插件恢复；正文和探索页的主要内容保持可用。
- 时间线默认在书签按钮旁显示 X 已返回的书签数；帖子详情页已有原生数字时不会重复添加。可在工具栏弹窗关闭。
- 打开帖子的 X 原生分享菜单，可选择「复制为 Markdown」。正文、作者和媒体链接来自页面已经收到的 GraphQL 响应，不读取页面渲染的正文；没有对应接口数据时会提示稍后重试。可在工具栏弹窗关闭。

- 支持信息流作者、帖子详情和回复作者、引用帖作者、搜索账号/帖子、个人主页标题，以及页面中的账号卡片。
- 支持 `/<账号>/verified_followers`、`followers`、`following`、`followers_you_follow`。
- 帖子作者下方默认只有一行：蓝色粉丝数 + 简短简介，无卡片底色或边框。长简介省略，点击整行展开；再点或按 Esc 收起。
- 未关注的帖子作者显示「关注」，点击后直接执行 X 原生关注，收到成功结果后显示「已关注」。已关注、已请求关注、被屏蔽、自己或状态未知的账号不显示关注按钮。引用帖仍只显示资料；按钮不会触发取消关注。
- 粉丝数与简介字号、字重一致，只用颜色区分。不显示「关注你」「互关」等关系标签。
- 所在地只在展开时显示。打开另一位作者会自动收起上一位。账号列表保留轻量粉丝数标签。空数据不猜测；简介短链接使用 X 已返回的网址显示为域名。所在地是账号自己填写的资料。
- 在支持的桌面版 Chrome 中，外文简介自动翻译成中文，点击「查看原文」可切换。首次使用时按提示点击「启用中文翻译」下载浏览器语言包，此后同一语言包就绪时自动翻译。默认简介只在本机处理；浏览器不支持或翻译失败时保留原文。不同 Chromium 浏览器也可能暴露 API 却无法创建模型，并非 Chrome 可用就代表其他浏览器可用。中文与中英混合简介保留原文。
- 滚动加载、站内切换列表时自动更新，同时处理右侧推荐账号。
- 不给正文中每一个 @提及、只有头像的通知或非标准账号结构强行加标签；只有识别出明确账号且 X 返回了粉丝字段才能展示数字。
- 「粉丝 —」表示没有拿到数据，**不等于 0**。安装后先刷新页面。
- 数字来自 X 页面返回时的数据，不是持续实时推送。超过 30 分钟的页面缓存不再显示为有效数字；刷新可重新读取。

## 帖子流速徽章

默认在帖子作者行显示发布以来的平均浏览/小时。公式为总浏览量 ÷ max(发布至今小时数, 0.1)，新帖至少按 6 分钟计算；这不是最近 60 分钟的浏览增量。低于 1,000/小时为普通，1,000 至低于 10,000 为上升，达到 10,000 为爆款。工具栏弹窗可关闭徽章或保存两个正数阈值，爆款阈值须高于上升阈值。

悬停可查看浏览、点赞、转发、回复、收藏、流速、爆帖指数和发布时间。未返回的互动字段显示「—」，不会当成 0；字段不完整时不计算爆帖指数。指数上限 100：流速占 40%（50,000/小时满分）、互动率占 25%（点赞+转发+回复+收藏占浏览 10% 满分）、转发/点赞占 20%（50% 满分）、收藏/点赞占 15%（30% 满分）；各项单独封顶，分母为 0 的比率按 0 处理。它是简单观察指标，不是 X 官方分数或预测。

仅提取页面已收到的 GraphQL 数据，不额外请求 TweetDetail，也不修改响应；广告、浏览数缺失或 `views.state` 不是 `EnabledWithCount` 的帖子不显示。引用帖按自己的帖子 ID 匹配。指标只保留在当前标签页内存，最多 5,000 条，30 分钟后失效；每 30 秒重算平均值，浏览总数仍以页面收到的数据为准。作者行通过帖子时间链接匹配；详情主帖使用与当前地址、作者账号均一致的正文下方时间链接；无独立链接的引用卡片使用原帖返回的引用 ID，并交叉核对引用发布时间。无法确认的布局不显示，避免错配。

## 在线翻译（可选）

本地翻译不可用时，打开工具栏 XpandMax →「简介翻译设置」。选择「Google 在线翻译（免 Key）」无需填写接口或 Key，保存并允许访问 Google 后即可测试。此入口不是有正式服务保障的 Google Cloud API，可能限流或失效，不保证长期免费。

也可以选择 Chat Completions、Anthropic Messages 或 Gemini 原生协议，填写 HTTPS 服务地址、Key 和服务商的模型 ID，保存并允许对应站点访问，再点击「测试已保存的接口」检查示例译文。无需 Key 的兼容服务可留空 Key。地址不接受查询参数、内嵌密码或片段。

自定义 API 不提供公共 Key 或免费额度；服务商可能收费，待翻译的简介会发送给该服务商。支持三种协议的非流式文本回复，不保证兼容所有厂商或特殊鉴权方式。服务根地址自动补 `/v1/chat/completions`、`/v1/messages` 或 `/v1beta/models/{model}:generateContent`；也可填协议前缀或完整请求地址，特殊代理路径按服务商文档填写。配置只存于当前浏览器；保存本地或 Google 翻译选项会清除自定义 API 配置。切换设置会清空已打开 X 页面的译文缓存。失败时保留原文，显示认证、限流、超时或格式提示，并等待手动重试。


### 验证范围

Google 免 Key 和 Gemini（AIGoCode 的 `gemini-3.8-flash`）已在 EGO 加载本地插件，验证示例请求、真实公开简介翻译及原文切换。Anthropic Messages 和 Chat Completions 目前仅通过模拟响应的自动测试，尚未实测真实服务；测试通过不代表所有服务商均已认证兼容。

## 数据与权限

插件只在 `x.com` 和 `twitter.com` 运行，在本机处理页面已经返回的用户名、粉丝数、简介、自填所在地、帖子指标，以及复制 Markdown 所需的帖子正文、作者和媒体链接。不发起额外账号或帖子查询，没有服务器、统计上报或账号、帖子数据持久化存储；帖子正文只在用户点击复制时写入系统剪贴板。Chrome 本地翻译可能首次下载语言包，默认本地模式的翻译文本不发到外部服务。选择 Google 或自定义 API 后，简介会发送给所选服务商。`storage` 在本地保存显示开关和 API 配置（包括 Key），不保存账号或帖子资料；在线翻译另外按需申请其 HTTPS 站点权限。没有 Cookie、历史记录或标签页权限。浏览器会提示它可以读取和更改 X 页面，这是添加标签和分享菜单项所需的站点访问范围。

详细说明见 [PRIVACY.md](PRIVACY.md)。演示图使用虚构账号；测试只使用合成数据。

适配实测的新字段 `core.screen_name`、`relationship_counts.followers`、`profile_bio.description`、`location.location`，同时兼容相应旧版 `legacy` 字段。每个字段分别计算 30 分钟有效期，资料缺失不会覆盖已有的新鲜资料，也不会延长其他字段的有效期。X 更改页面结构或接口字段后可能需要更新插件。

## 开发与验证

```sh
npm ci
npm test
npm run package
# 商店上传包（manifest.json 位于 ZIP 根目录）
npm run package:store
```

运行时无第三方依赖；jsdom 仅用于本地测试。自动化用例覆盖一键关注的目标校验、防重复提交、成功与失败状态、伪造点击拦截，以及账号映射、0 粉丝、精确数值、动态列表、DOM 复用、原帖/引用帖区分、站内路由、非法消息、fetch / XHR、晚启动重放和安装清单。

开发需要 Node.js 22+，打包需要 Python 3.9+。安装包按白名单生成，包含插件运行文件与图标、安装说明、虚构账号示意图、许可证和隐私说明；SHA-256 校验值写入 `dist/SHA256SUMS.txt`。商店上传包仅包含运行文件、图标、许可证和隐私说明，校验值写入 `dist/STORE-SHA256SUMS.txt`。发布检查使用 `python3 -m unittest discover -s tests -p '*_test.py'` 验证两种安装包的内容和可复现性。

`extension/` 为实际插件，`tests/` 为本地自动化测试。实际 Chrome 安装需要用户在扩展管理页完成。

### 自动化浏览器验收

首次准备执行 `npm ci` 和 `npx playwright install chromium`，此后运行 `npm run test:browser` 即可自动启动专用 Chromium、加载当前 `extension/`，验证真实的 Manifest V3 内容脚本、后台、popup 与本地存储。无需手动加载或重载插件，也不使用日常 Chrome 的配置、登录状态或 Cookie。测试资料均为虚构账号，X 页面和 GraphQL 响应由本地测试拦截提供；出站请求采用允许列表。

每次 push/PR 的 `browser-extension` CI 检查自动运行这一套验收，报告及桌面/窄屏/popup 截图保存在 Actions 的 `extension-browser-test-report` 附件，本机结果在 `artifacts/browser-tests/isolated/`。检查包括原帖与无链接引用卡片、广告过滤、旧节点复用、设置开关、阈值保存和跨标签页生效。测试配置目录由程序创建并在结束时清除，扩展安装包不包含 Playwright。

`npm run test:browser:live` 使用普通窗口模式的专用 Chromium 访问真实 X 公开帖子，不模拟响应、不注入测试数据。2026-10-17 对照检查发现无界面 Chromium 收到 HTTP 403，普通窗口可返回 HTTP 200；匿名访客界面又是不同的 SSR 布局，没有本功能所需的 GraphQL 数据，不能据此判定功能通过。首次可运行 `npm run test:browser:login`，仅需在专用窗口完成 X 登录，扩展自动加载；后续实页测试复用此专用会话。不会读取或复制日常 Chrome 的 Cookie。专用 profile 位于用户目录 `.local/share/xpandmax-test/browser-profile`，不进入仓库、CI 或发布包；不要将其上传或分享。

也可由本机 Agent 复用已登录 Chrome，在临时 X 标签页运行候选的 bridge/velocity 页面代码。此方式不安装或重载扩展，消息通道仅为隔离测试而更名；对真实原帖、引用帖、详情主帖和返回导航核对后，生成 `existing-authenticated-chrome-page` 证据。独立浏览器套件仍验证实际扩展安装、popup 和存储。使用 `XPANDMAX_LIVE_EVIDENCE=/绝对路径/evidence.json npm run store:submit` 时，发布检查只接受四项检查均通过、有正向样本、距验证不超过 1 小时且整个 `extension/` SHA-256 完全匹配的证据；修改任何扩展文件都须重新验收。不会复制个人浏览器的 Cookie，也不能用仅截图或未通过的报告放行。

实页报告在 `artifacts/browser-tests/live/`。只有真正加载数据并显示流速徽章才通过；缺少数据、登录未完成、访问受阻均以退出码 2 标记 `blocked`。默认 CI 仅跑确定性的隔离测试。`npm run store:submit` 会先执行 `verify:release`，依次运行单元测试、打包测试、隔离浏览器验收和真实 X 检查；任何一项失败都不会进入商店上传。实页受阻时不得声称已经完成真实账号验收。

## 已知限制

目前适配桌面版 Chrome 111 及以上版本。插件依赖 X 返回的数据与页面结构，无法保证所有实验界面都兼容。该项目与 X 官方没有隶属关系。

实现依据：Chrome 官方 [content scripts 文档](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)，使用 Manifest V3 的 `document_start`、`MAIN` 和隔离执行环境。

## 反馈与许可证

欢迎通过 [Issues](https://github.com/yiren-ai/xpandmax/issues) 提交复现步骤。请不要上传 Cookie、令牌、私信或其他私人数据。

欢迎 Fork 后提交 Pull Request，修复问题、改进文档或补充测试。开发环境、验证步骤和 PR 要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。新增功能请先开 Issue 讨论，优先保持插件简单、轻量。

本项目采用 [MIT License](LICENSE)。允许使用、修改和分发，请保留许可证与版权声明。

## 英文官网

`website/` 是独立的静态站点，部署到 Vercel 的 `xpandmax` 项目。执行 `npm run build:site` 会重新生成最新下载包。用 `python3 -m http.server 4173 --directory website` 本地预览。
