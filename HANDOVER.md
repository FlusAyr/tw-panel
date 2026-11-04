# HANDOVER.md · 交接总档（给接手的 agent 团队）

> **这份文档是你要读的第一份文件。** 读完它你能知道：这套系统是什么、现在什么状态、
> 日常怎么维护、出问题去哪查。细节手册在 AGENTS.md，这里只做导览 + 补充 AGENTS.md
> 还没来得及写进去的最新增量（2026-11-01 前的全部变更）。
>
> 最后更新：2026-11-01　｜　面板 v3.28.0　｜　引导 boot v2.1　｜　仓库 https://github.com/FlusAyr/tw-panel

---

## 1. 你接手了什么

一套跑在 SillyTavern（酒馆）+ 酒馆助手（TavernHelper）上的跑团系统，由四层组成：

```
┌─ 规则层（世界书，注入 AI）────────────────────────────┐
│  跑团用世界书 v4（基础规则：状态块/检定/cr 行）          │
│  无限恐怖 v2（主世界书：任务/点数/基因锁）               │
│  NTR 伴侣夺走 v3（附属扩展册：nb/nf/nh/nd/nl 关系层）   │
│  ※ 附属册与基础册共用状态块主体，启动扩展册时主册不启用   │
├─ 状态块（AI 每楼输出的键行文本）──────────────────────┤
│  scene: / quest: / p1: / nb: / nf: / check: / next: …  │
├─ 渲染层（tw-panel，本仓库）──────────────────────────┤
│  panel.js：键行文本 → HUD 卡片（含 NTR 绯红主题/手机端） │
│  boot.mjs：ESM 双通道自动更新引导                       │
├─ 记忆层（第三方数据库插件，不随仓库分发）──────────────┤
│  龙血玄黄·数据库（AlbusKen/shujuku），纪要表记忆追回     │
└──────────────────────────────────────────────────────┘
```

- **仓库只托管静态文件**（GitHub + jsDelivr CDN），无后端。
- 玩家只需导入 `dist/loader-script.json`（一行 import 引导），面板全自动更新。
- **本地全量备份在 `F:\酒馆卡\`**（原「主神空间」改名），含世界书成品、源码、文档、预览页。仓库里只放玩家要下载的成品。

## 2. 上手第一天：15 分钟检查清单

```bash
git clone https://github.com/FlusAyr/tw-panel && cd tw-panel
node tests/npc.test.js        # 期望：14 通过 / 0 失败
node tests/loader.test.js     # 期望：11 通过 / 0 失败
node tests/next_sweep.test.js # 期望：全部通过
python build.py               # 期望：✓ 版本 v<当前版本>，无报错（会刷新 dist/）
curl -s https://raw.githubusercontent.com/FlusAyr/tw-panel/main/version.json
# 期望 version 与 `const VERSION` 一致
```

然后按顺序读：本文件 → `AGENTS.md`（维护手册，红线和键行契约在那）→
`CHANGELOG.md`（每个版本为什么改）。要给外部用户装环境才读 `AGENT_DEPLOY.md`。

## 3. 文档地图（谁管什么，别写错地方）

| 文件 | 受众 | 回答的问题 |
|---|---|---|
| `README.md` | 玩家 | 怎么装（Part 1 渲染器 / Part 2 完整环境） |
| `AGENT_DEPLOY.md` | 外部装环境的 AI | 从装 SillyTavern 起的全步骤 |
| `AGENTS.md` | **接手维护的你** | 目录职责、红线、键行契约、发版流程、陷阱 |
| `HANDOVER.md`（本文件） | 接手第一天 | 全景导览 + 最新增量 + 实操记录 |
| `CHANGELOG.md` | 所有人 | 版本谱系与改动原因 |
| `llms.txt` | 检索工具/AI | 机器可读索引。**增删文件必须同步它** |
| `content/README.md` | 玩家 | 下载区文件的安装顺序 |
| `content/docs/…维护手册.md` | 玩家 | 规范/排障；正文停 v3.3，v3.9+ 见 AGENTS §3.1 |

## 4. 当前版本状态（2026-11-01）

| 资产 | 版本/状态 | 说明 |
|---|---|---|
| `panel.js` | **v3.28.0** | 渲染器唯一源文件，≈1.9k 行 |
| `boot.mjs` | **v2.1**（跟 main，无 tag） | ESM 双通道引导，替代 loader.js 机制 |
| `dist/loader-script.json` | 跟随 build | 玩家导入包，内容 = 一行 `import …/boot.mjs` |
| NTR 卡 | **v3 纯净框架版**（仅本地私有副本） | 三个版本演进见 §7.3 |
| 无限恐怖 v2 / 跑团用 v4 | 不变 | content/worldbook/ |

**v3.8.0 → v3.14.0 的增量能力**（AGENTS.md 写作时还没有的）：

- **v3.9.1** NPC 渲染：NPC ≠ 敌人（敌人是 mob），左栏 CONTACTS 紫金情报卡，键制/位置制双口径解析
- **v3.10.0** NTR 夺走体系五字段 `nb/nf/nh/nd/nl` + 绯红主题（沦陷环/阶段水印/定局印章/双面镜心声/雾化暗流事件轴）
- **v3.10.1** 修复：`next:` 等孤段被 sweep 守卫静默丢弃（守卫已扩展为全状态键判定）
- **v3.11.x** 手机端：≤760px 双栏变**无吸附连续横滑画布**（430px 列排开，右滑内容左移），桌面端零改动
- **v3.12.0** 尺寸切换：面板右上角 －/＋ 按钮切紧凑/完整，`localStorage['tw-card:size']` 全局持久
- **boot v2.1**：玩家包一行 `import` 钉不可变 tag 的 boot（`@vX.Y.Z/boot.mjs`，不走 `@main`）；fetch 快速通道并行探测全镜像 version.json 取最大版本，失败即降级 `import()` 兜底；带设置面板（显示 `BOOT_VERSION` 可自检，开关存 `tw-card:opts`，支持立即检查/强制重拉/清缓存）
- **v3.13.0** 引导升级配套：面板无功能变更，仅为让 `dist/loader-script.json` 指向钉 tag 的新 boot 而 bump
- **v3.14.0** 拓展键前缀：`kbnpc[<N>]`/`ntrnpc[<N>]` 独立前缀并登记进 `KEYS`（缺登记会截断其后状态行）；删除 `.github/workflows/` 恒红叉模板，不再新建 CI
- **v3.15.0** 行内 A/B 双值：任何 `名字 30/70` 自动出两根条、`名字 15` 仍单值（面板不认识具体是哪本书，纯通用解析）；旧面板会把 `调 34/12` 静默截成 `34`，带双值的书须面板 v3.15+
- **v3.16.0** 版本源收敛：`version.json` 删 `notes`、加 `boot`（从 `boot.mjs` 现读，不硬编码）；导入行改用 `build.py` 的 `BOOT_TAG`，面板发版不再改导入行——只有 `boot.mjs` 真改过时才动；`version.test.js` 加三条断言（`notes` 不存在 / `boot` 与 `boot.mjs` 一致 / `BOOT_TAG` 到 `HEAD` 之间 `boot.mjs` 无变更）；`panel.js` 仅 `VERSION` bump；`boot.mjs` 未改动（v2.1 / 19897 B）
- **v3.17.0** 机甲状态行：新增 `kbm<N>` 键（编号与 `p<N>` 同号，字段 名称/型/HP/能/SP/力敏体智感魅/装），渲染为独立机甲卡（HP 主条 + 能/SP 细条，三型徽章）；数值位第二段必须纯数字，非纯数字整格丢弃并打一次提示；配套无限恐怖册两条（uid 24 机甲状态 / uid 25 判定与承伤）
- **v3.18.0** 机甲卡视觉重做：切角外框 + 双短角标 + 读数同宽堆叠 + 插槽感装备；型徽章移名右、三型靠形状区分；有同号 p 行的机甲卡与玩家卡共一条左缘竖线 + 「◤ 驾驶中」细带（无同号 p 不画）；HP 0 降饱和 + 斜纹 + 旋转盖章，能 0 变灰；解析新增自定数值条与纯文本标签两层，形状对不上的只当标签
- **v3.19.0** 读数与兜底：六维读数标签与数值不再粘连（markup 补真空白 + 3px 间距，断言锁「名字 + 空白 + 数字」）；机甲自定字段的裸段加弱标题「其他」并提亮，明确不进装备插槽；`panel.js` 只改这两处，`boot.mjs` 未动（v2.1 / 19897 B）；旧卡六组样本逐字节相同（基线 tag 见 CHANGELOG）
- **v3.19.1** `kbm` 的「型」关键字可省：裸段恰是 `人型`/`重装`/`全包` 之一时按型识别（`装` 之后仍一律当装备名）；力/敏/体 缺项显示 `—`、智/感/魅 不占位；`gauge`/`attrsHtml` 抽成共用件，`kbm` 卡输出逐字节不变；撤销使魔 `kbf` 支持（从未发布、已移除，面板不渲染该行，也不吞后续行）；`boot.mjs` 未改动（v2.1 / 19897 B）
- **v3.20.0** 新增 `dmg<N>` 伤害事件行：六段（谁对谁｜因｜算｜伤｜血｜判），渲染为交火卡（方向箭头 + 伤害数值 + 七色性质 + 六种判定形态 + 血条前后）；`算` 段原样保留不重算，血差与伤值不一致时卡上打黄字标记（不隐藏不改写）；`keys` 断言 109→137（dmg 六段/七色/颜色互不相同/截断锁/血差不一致）；旧卡八组样本逐字节相同（基线 tag 见 CHANGELOG）；`boot.mjs` 未改动（v2.1 / 19897 B），导入行 tag 仍由 `build.py` 的 `BOOT_TAG` 决定
- **v3.21.0** 窄屏修复：<520px 时卡片退回单列自适应、不再向右越界，属性单列、标签与值紧邻，血量/SP/负重/机甲三读数强制可见；≥520px 布局一字未改（桌面逐字节对上一版相同）；`dmg` 算段加三条保护（解析保留原文 / 渲染文本须等于原文全文 / 容器禁止省略号与裁切）；`keys` 137→140；`boot.mjs` 未改动（v2.1 / 19897 B），导入行 tag 仍由 `build.py` 的 `BOOT_TAG` 决定（基线 tag 见 CHANGELOG）
- **v3.22.0** 窄屏五格防线：<520px 五道防线固定五等分一行（原先退成 1+1+1+1+1 或 3+2），双环挪到防线下一行并排，每格名称与状态上下两行；≥520px 一字未改；`keys` 141→147；`boot.mjs` 未改动（v2.1 / 19897 B），导入行 tag 仍由 `build.py` 的 `BOOT_TAG` 决定
- **v3.23.0** 纯文档与内容修正，面板逻辑未改：`README.md` 世界书条目数 24 → 29（上一版世界书同步遗漏）；`AGENTS.md §7` 新增第 15、16 条（让既有规矩变成假话的改动要连带改规矩 / 改掉数字后扫数字不扫句子）；`boot.mjs` 未改动（v2.1 / 19897 B），导入行 tag 仍由 `build.py` 的 `BOOT_TAG` 决定
- **v3.24.0** 测试与文档口径收紧，面板逻辑未改：`version.test.js` 新增 13 条断言（36 → 49），世界书条目数改为从 `content/worldbook/` 的 json 反查（29 / 18），11 处文档的「条目数」被钉死，任一文档写过期数字、或 json 实际条数变了而文档没跟都红；`AGENTS.md §6` 扫描命令加 `-F`（BRE 的 `.` 是通配，会把版本号里的点当成任意字符，搜出 `3X22Y0` 这种不存在的串）；`§8` 第 3 条改精确——多镜像不同步只会延迟更新，不会拿旧代码、不会降级；`§7` 尾部多余空行收掉；`boot.mjs` 未改动（v2.1 / 19897 B），导入行 tag 仍由 `build.py` 的 `BOOT_TAG` 决定
- **v3.25.0** 防线容量显式化 + 测试入口去隐式：防线列数与防线名称数绑死（改一边不改另一边即红），超出布局容量时卡面出黄字「防线 N 道 > 布局 M 列」而不是静默变挤；五道时渲染零变化（旧卡逐字节相同）。`window.__twCard` 暴露 `CSS` / `injectCss`，几何断言不再靠正则从源码抽 CSS（抽空时表现为静默全绿）；`keys` 147 → 153。`boot.mjs` 未改动（v2.1 / 19897 B）。
- **v3.26.0** `kbf<N>` 使魔行进面板：登记进 `KEYS`，渲染紧凑使魔卡（`tc-fam` 主题，族色窄边 + 细条，刻意区别于机甲卡）；`族 兽/灵/构造`、`技`、`签 已缔结/待缔结/已解除` 按世界书 uid3 §八 原文实现，缺项显示 `—`；关键字后可无冒号无空格（`族兽` / `技撕咬`）；`kbf` 未登记时 `extractBlock` 在它那行 `break`、其后状态行被整块吞掉，本次一并修掉（用户实战样本暴露）。`boot.mjs` 未改动（v2.1 / 19897 B），导入行 tag 仍由 `build.py` 的 `BOOT_TAG` 决定
- **v3.27.0** 测试假绿的三个来源逐个堵掉：`KEYS` 与「声称支持的键集合」做**双向差集**（期望集少一个红、多一个红，且期望集不许写成 `KEYS` 的别名）；造红时不再因 `undefined` 崩掉进程，改打印字段名与解析对象形状；`0/0` 的条不再产生 `width:NaN%`，改显式 `0%`；反向对照键 `zzz9` → `__nokeys__9`（`zzz9` 可能被真造出来）。`panel.js` 本版仅 `3/1`（一次 `pct` 守卫 + 两处注释），无新功能、无新键。`boot.mjs` 未改动（v2.1 / 19897 B）
- **v3.28.0** 海上避难所第四张卡：新增 `sh<N>`（避难所/海上载体）与 `dz<N>`（灾变）两键，均为 `KEYS` 前缀 + 独立解析与独立卡片（不进 `EXT_KEYS`）；`sh` 卡走 `tc-shelter`（圆角浮筒 + 水位线，五项资源条 + 防单值 + `模` 徽章，坏格落 `errs` 并在卡面显示原文）；`dz` 走 `tc-dz` 全宽横幅（等级色块 + 血色斜纹，`余 0` 是合法终局并盖「已平息」章）；配套跑团用世界书新增 `content/worldbook/海上避难所_v1_纯净框架版.json`（21 条目 / 4 常驻 / 常驻 2211 字符）；`keys` 182 → 225。`boot.mjs` 未改动（v2.1 / 19897 B）
- **结构性约束**：boot 与面板共用同一个 tag，因此任何 boot 变更都强制面板 bump 版本（tag 不可覆盖）。v3.16.0 起 `version.json` 带独立 `boot` 字段，引导版本可独立分发、导入行不再随面板版本变——但 tag 仍是共用的，别把 `boot` 字段误当成分离 tag。

## 5. 发版 SOP（命令级，照抄即可）

```bash
# 1. 改 panel.js（唯一源文件），改 VERSION 常量（语义化：修 bug → patch，新字段/新主题 → minor）
# 2. 语法检查 + 打包
node --check panel.js && python build.py
cp panel.js ../work/panel_content.js        # 仓库外工作副本（如存在）
# 3. 全部回归
node tests/npc.test.js && node tests/loader.test.js && node tests/next_sweep.test.js
# 4. CHANGELOG.md 顶部加版本条目
# 5. 提交 + 打 tag + 推送（tag 一旦推了永不覆盖，见 §6）
git add -A && git commit -m "vX.Y.Z 一句话说明" && git tag vX.Y.Z
git push https://<TOKEN>@github.com/FlusAyr/tw-panel.git main:main
git push https://<TOKEN>@github.com/FlusAyr/tw-panel.git vX.Y.Z
# 6. 尝试刷新 CDN（jsDelivr purge，传播可能慢，见 §6）
curl -s "https://purge.jsdelivr.net/gh/FlusAyr/tw-panel@main/panel.js,gh/FlusAyr/tw-panel@main/version.json"
# 7. 核验（raw 有 ~5min 缓存，必须走 API；核验 host 必须与玩家导入行的 host 同域，否则核验全绿、玩家仍旧）
curl -s "https://api.github.com/repos/FlusAyr/tw-panel/contents/version.json?ref=vX.Y.Z" \
  | python -c "import json,sys,base64;print(base64.b64decode(json.load(sys.stdin)['content']).decode())"
# 8. 同步 F:\酒馆卡\（手动导入版/源码/CHANGELOG/00_索引.md 版本号）
```

**令牌**：push 用管理员提供的 classic PAT（需 repo 权限）。**令牌绝不写进任何会提交的文件**。
教训：fine-grained 令牌不能建仓、不能推 workflow；classic 缺 `workflow` scope 时推不动 `.github/workflows/`。

索引最后更新：它的数据来自别人的产物（03_面板 由值守同步）。
面板发版不改导入行；只有改 `boot.mjs` 时才动 `build.py` 的 `BOOT_TAG`，并在发版说明里写清。

## 6. 更新链路与 CDN 的脾气（最重要的一节）

```
玩家端 boot.mjs（每楼渲染 + 页面加载时触发）
  ① fetch 快速通道：raw(≈5min 新鲜) → gcore → cdn → fastly 拉 version.json
     比对版本 → 有新版拉 tag 代码（gcore 优先，tag 不可变所以缓存无害）→ 写 localStorage 缓存
  ② fetch 被沙箱 CSP 拦截（酒馆助手 iframe 常见）→ 自动降级 import('@main/panel.js')
     ——模块 import 走 script-src 必放行；这是照抄数据库插件（AlbusKen/shujuku）的机制
```

- **为什么放弃旧 loader.js 三件套**：它全靠 `fetch`，走 `connect-src`，在酒馆助手沙箱里可能整链路被拦且无报错。别人家插件用一行 import 就能更新，我们不能——根因是 CSP 通道不同，不是逻辑 bug。
- **jsDelivr `@main` 分支缓存 ≤12h**，`purge.jsdelivr.net` 只清 `CF`/`FY`、**不覆盖 gcore**（实测 purge 后 cdn 已新、gcore 仍停在旧 8393B，5 分钟未清），gcore 只能等自然回源（s-maxage 12h）。**purge 只能当加速，不能当保证。**急发布就打 tag（tag 永久缓存反而是优点）。
- **tag 永不覆盖**：覆盖后 jsDelivr 不刷新，玩家会永远拿到旧代码。
- 核验远端内容一律走 `api.github.com/repos/…/contents/<path>?ref=<ref>`（base64），raw 有约 5 分钟 CDN 缓存会骗人。
- **引导脚本自身无法自更新**（鸡生蛋）：改 boot.mjs 后，旧版引导用户需重新导入一次导入包。发布说明里要写清楚。

## 7. 内容资产与工具

### 7.1 仓库 `content/`（玩家下载区）
- `worldbook/`：无限恐怖 v2、跑团用 v4（NTR 册不入公开仓库，见 §7.3）
- `database/`：10 表深度版模板 + 原版备份（**不含第三方插件**，玩家去作者原贴下载）
- `entries/`、`docs/`：条目与提示词

### 7.2 本地 `F:\酒馆卡\`
00_索引（改任何东西后要更新版本号行）/ 01_世界书 / 03_面板（手动导入版+源码）/ 06_文档 / 07_脚本（panel_content.js + 预览页）/ 09_归档（旧版与勿分发件）。
**改动面板后同步五处**：仓库 dist、F 盘 03_面板 手动版与源码、07_脚本 panel_content.js、00_索引 版本行。

### 7.3 NTR 卡三版本（在 Downloads 与 F 盘，v3 已移出公开仓库）
- v1 原版：40 条目裸世界书，bond/foe 雏形 + 预设剧情（苏乐/沈栀/靳渊剧本）+ TavernDB 纪要
- v2 渲染器适配：bond/foe→nb/nf，写入五字段规则（`tools/adapt_ntr_card.py`）
- **v3 纯净框架（当前）**：预设剧情全部清空（纪要/索引/快照/防线/加害者档案→空表+列序说明；条目 20 → 伴侣角色条目模板含 `{{user}}`；示例人名泛化为莉娅/季临），并新增**输出纪律**条款强制每轮输出五维 0-100 全值——沦陷轮盘 =（恋+调+屈+淫)/4，缺值不显示，这是「AI 不生成数值」故障的修复。**TavernDB 结构件（条目 21/29/32/33/34/36/38）字节级未动**（`tools/make_ntr_v3_clean.py` 有断言）。

### 7.4 测试与可视化预览（`tests/`）
- `npc.test.js` 14 断言 / `loader.test.js` 11 断言 / `next_sweep.test.js` 4 断言（最小假 DOM 全链路仿真；注意假 DOM 的 innerHTML setter 必须生成 firstElementChild，否则仿真失真）
- 预览页直接浏览器打开：`preview-ntr.html`（NTR 五字段全量）、`preview_mobile.html`（手机端，`?p2=1` 滚到右栏）、`preview_mini.html`（紧凑模式自动演示）、`boot_e2e.html`（引导双通道）
- **无头 Edge E2E 套路**（本仓库最常用的验证手段）：
  - 截图：`msedge --headless=new --disable-gpu --hide-scrollbars --window-size=W,H --screenshot=x.png file:///...`（脚本注入的 hook 要**轮询等元素就绪**，setTimeout 会撞渲染时序）
  - 程序化断言：`--dump-dom --virtual-time-budget=15000`，把诊断结果写进 `<pre id=...>`，再用 python 正则抽出来。不要靠看截图猜。
  - PNG 文件（mob_*/mini_*/ntr_preview*）是历次视觉验收存档，可删，不影响测试。

## 8. 已知问题与未了事项

1. **CI**：仓库无 CI workflow（`.github/workflows/` 已删除）。改动靠本地 `node tests/run_all.js` 六组全绿把关；备选配置在 `ci/tests.yml.example`，启用前须先确认能绿。
2. **旧版引导用户**（v1.0 loader 三件套时代的）：需手动重导一次导入包才获得 boot v2.1 双通道，否则在 CSP 拦截环境下面板可能永不更新。发布渠道上要把这句带到。
3. **`@main` 可变别名 + 多镜像缓存不同步**：曾出现 `@main/version.json` 报 3.10.1 而 `@main/panel.js` 已是 3.12.0 的自相矛盾。玩家导入行走的 gcore 不被 purge 覆盖，只会让更新**延迟**（`s-maxage` 12h），**不会拿到旧代码、不会降级**——代码按 tag 取（不可变）+ 全源并行探版本取最大值 + 只升不降：`boot.mjs` 的 `refresh()` 对所有版本源并行探测后取 `cmpVer` 最大值，拿到 best 后 `cmpVer(best.v, curVer) <= 0` 就不更新。处置：引导与面板拉取一律钉不可变 tag `@vX.Y.Z`，唯一例外：设置面板「强制重拉最新」按钮走 `@main`；急发版走 tag。
4. **`work/panel_content.js`**：仓库外工作副本（`C:\Users\Administrator\WorkBuddy\2026-10-31-05-01-50\work\`），发版时同步一份，防仓库目录意外损毁。
5. NTR 卡 v3 的**输出纪律**条款是治「AI 漏生成数值」的第一版方案；如果实际跑团仍漏，下一步方向是把纪律句复制到条目 1（五维数值核心）的头部，双保险。
6. **字节断言一律落盘后 `wc -c`**。`size_download` 本身准，错在用法：URL 形态错（`repo/@v1.2.3/f`，`@` 前多一个 `/`）→ jsDelivr 回 404 错误体（69~72 B），看着像文件只有几十字节；`-I`(HEAD) 恒 0；`--compressed` 给压缩字节（`llms.txt` 2952 vs 5884）。异常小值先核对 URL。
7. **R18 扩展册仍在 git 历史中**：`content/worldbook/NTR_伴侣夺走_v3_纯净框架版.json` 已于 2026-11-01 从 HEAD 移除（仓库无版本变更、未打 tag），但引入它的提交 `24802fe` 仍在历史里（`git log --all -- <该路径>` 可取回）。管理层已知并接受：仓库保持公开，重写历史会改变全部 tag 指向的 commit，与「tag 永不覆盖」冲突。新增 R18 册一律不入公开仓库。
8. **递归扫描默认关闭**（`world_info_recursive` 在 ST `settings.json`，默认 `false`；世界书文件里没有这个字段）。玩家若开启：无限恐怖册 `uid 19`（常驻的世界选择表，正文含队名与选项值）已设 `preventRecursion:true`，不再作为递归触发源；`uid 28` 故意不设 —— 它被「换个难度」叫起来时，递归拉进 `uid 8` 难度基准表正好有用。三个字段别单看名字猜：`excludeRecursion` = 本条不被递归拉进来（`:4870`）；`preventRecursion` = 本条不去触发别人（`:5080` `filter(x => !x.preventRecursion)`）；`delayUntilRecursion` = 非递归轮跳过本条，数字＝递归第 N 层才放行（`:4860/:4865`）。来源：`SillyTavern/SillyTavern@06bde939fb1e` · `public/scripts/world-info.js`。

## 9. 红线（AGENTS.md §2 的摘要，全文去读原文）

1. 不改数据库模板**纪要表**结构（uid `sheet_3NoMc1wI`，6 列 AM 编码原版，动了丢记忆追回）
2. SillyTavern `data/default-user/` 下 `default/` 目录禁止编辑
3. 不分发第三方插件（数据库插件指路作者原贴）
4. 不往 `content/` 复制面板成品（单一出处是 `dist/`）
5. tag 永不覆盖；`llms.txt` 增删文件必须同步

## 10. 状态块键行速查（完整契约见 AGENTS.md §3）

```
基础行（跑团用 v4 定义）：scene team quest check result world next
  bond* foe* npc* mob*    pts<数字> lock<数字> ti<数字>    cr<数字> p<数字> sk<数字> eq<数字>
NTR 附属册（条目 3 定义）：nb* nf* nh* nd* nl*
  nb: 名 | 爱 62 | 恋 28 | 调 34 | 屈 41 | 淫 58 | 防线 2/5 称谓 | 期 3 摇摆 | 迹 3
  nf: 名 | 身份 X | 手段 X | 次用手段 X | 攻势 5/5 | 弱点 X     （未现身写 未知 | 不明）
  nh: 名 | 对你 … | 对他 … | 心 A,B | 白 「…」
  nd: 名 | 防线名 失守|回填|在守 日期 经过 ×5
  nl: 日期 | 标题 | 经过 X | 她 X | 你 知情|不知情|半知半觉
通用：键名后冒号可全半角；**无编号同键行后者覆盖前者**，多实例必须编号（nb2/nf3…）
本册无战斗：p 行战斗项写「无」，sk/eq/pts/lock/ti 一律不写
```

---

接手有问题先查 AGENTS.md 与 CHANGELOG——两个会话跨天的坑（纪要表、CSP 通道、tag 缓存）都有复盘。
这份文档由上一任维护 agent 于 2026-11-01 写就；改完仓库记得把 §4 的状态表和版本号更新掉。
