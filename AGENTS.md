# AGENTS.md · 维护者手册（面向接手的 AI / 人）

> 你正在接手一个已上线的 SillyTavern（酒馆）跑团系统：**「主神空间」**。
> 本文件是操作手册，读完即可独立维护，不需要原始对话记录。
> 最后更新：2026-11-01　｜　面板 v3.13.0（引导 boot v2.1）　｜　仓库 https://github.com/FlusAyr/tw-panel

---

## 0. 三十秒速览

| 问题 | 答案 |
|---|---|
| 这是什么 | 一套跑团规则 + 状态渲染器 + 数据库模板，跑在 SillyTavern + 酒馆助手（TavernHelper）上 |
| 仓库里有什么 | 渲染器源码 `panel.js` + 自动更新器 `boot.mjs` + 打包脚本 + 玩家要下载的成品 `content/` |
| 谁在用 | 1 个主持人（GM）+ 若干玩家，各自本地酒馆，靠世界书 + 脚本同步规则 |
| 唯一的"服务器" | GitHub 仓库 + jsDelivr CDN（只托管静态 js/json，无后端） |
| 最常见的维护动作 | 改 `panel.js` → 加版本号 → `python build.py` → 打 tag 推送 |
| 最容易被搞坏的东西 | 数据库模板的**纪要表**（动了就丢记忆追回）；**旧 tag**（覆盖后 jsDelivr 不更新） |

---

## 1. 仓库地图

```
tw-panel/
├── panel.js                ★ 唯一源文件：状态块 → HUD 卡片渲染器（1658 行）
├── boot.mjs                自动更新引导（玩家只导入这一支）
├── build.py                打包：读 panel.js 的 VERSION → 写 version.json + dist/
├── deploy.py               一键部署脚本：装 ST + 扩展 + 放世界书 + 备好导入包（给外部用户/agent 用）
├── AGENT_DEPLOY.md         给外部 AI 助手的部署执行手册（从装 SillyTavern 开始）
├── version.json            版本清单，boot 据此判断是否更新
├── dist/                   生成物：loader-script.json、panel-script-vX.json
├── tests/  run_all.js 聚合（loader11/npc14/next_sweep4/boot56，node，无依赖）
├── ci/release.yml.example  可选自动 Release（启用需 token 带 workflow 权限）
├── ci/tests.yml.example    可选测试流水线（取代远端误建的 python-package.yml 恒红叉模板；启用同样需 workflow 权限）
├── content/                内容下载区（只放内容，不放面板）
│   ├── README.md           玩家安装顺序与文件说明
│   ├── worldbook/          无限恐怖 v2（24 条目）、跑团用 v4（18 条目）
│   ├── database/           10 表深度版模板、原版备份（不含第三方插件）
│   ├── entries/            超高校级幸运、魔药体系 v1.0
│   └── docs/               创作系统提示词、面板维护手册、状态块样例
├── llms.txt                给 AI / 检索工具的入口索引（改文件后要同步更新）
└── README.md               仓库首页：只讲玩家怎么装（维护内容不写在这里）
```

**文档分工（别混）**：`llms.txt` 是所有文档的机器可读索引——新增/改名/删除文件时**必须同步它**，否则 AI 会按旧路径找文件；`README.md` 只回答"玩家怎么装"；`AGENT_DEPLOY.md` 是给**外部** AI 装环境用的执行手册（不是给你维护仓库用的，别照着它改仓库）；本文件回答"怎么改、怎么发"；`CHANGELOG.md` 只记版本谱系。新增文档先想清楚属于哪一类，不要往首页堆。**指向代码别写死行号与版本值**——两者都会漂移；写 grep 锚点（如 `grep -n "const VERSION" panel.js`）+ 可查当前行号。

**单一出处**：面板成品只在 `dist/`（`build.py` 生成），**不要往 `content/` 复制一份**——两份副本必然漂移，之前已经出现过。

**本地全量备份**（不在仓库里）：`F:\酒馆卡\`（原「主神空间」改名），含 07_脚本 的测试脚本与预览页、08_样例回复、09_归档 的旧版。改东西前先在那里找历史版本对照。

---

## 2. 四件绝对不能做的事

### 2.1 不要改数据库模板的「纪要表」结构
表的 uid 是 `sheet_3NoMc1wI`，必须是原版：6 列、编码 `AM0001` 递增、`exportConfig` 的 `entryName="纪要"`、注入模板 `<记忆回溯>$1</记忆回溯>`。
酒馆助手的**记忆追回**依赖这套结构，改表名 / 编码格式 / 列数都会让它失效。
玩家的属性快照要求写在**正文里**（由「主神空间全局表」note 的【纪要补充要求】下达），**不是**新增列。

### 2.2 不要覆盖已发布的 tag
jsDelivr 对 `@vX.Y.Z` 做永久缓存，同 tag 重新推送不会刷新 CDN。必须打新 tag。

### 2.3 不要把第三方插件放进仓库

数据库插件「龙血玄黄·数据库」是 AlbusKen 的作品（https://github.com/AlbusKen/shujuku ），**我们只提供配套模板，不转发插件本体**：不复制它的 json、不镜像它的 jsDelivr 地址、不在 content/ 放"插件入口"。

理由：插件近 10 MB 且作者高频更新，转发即版本冻结，出问题还要我们背锅。README 与 content/README 只写"去作者处下载"，并保留一条免责说明（第三方插件的问题我们无法代为排查）。

同理，`SillyTavern` 本体和酒馆助手扩展也不进仓库，只给官方链接。

### 2.4 不要让面板改动正文 DOM
`panel.js` 的约定是：找到状态块所在节点，**只替换那一个节点**（`<pre>`/消息节点），正文其余 DOM 一律不碰。破坏这条会让用户的聊天记录看起来被"吞字"。

---

## 3. 面板架构（panel.js）

单一 IIFE，`window.__twCardLoaded` 守卫防重复注入。分三层：

| 层 | 关键符号 | 职责 |
|---|---|---|
| 解析 | `KEYS` / `LINE_RE` / `parseState` / `parseAttrs` / `parseCr` | 把 AI 输出的状态块文本切成结构化对象 |
| 渲染 | `render` / `CSS` / `injectCss` | 生成 HUD 卡片：指令栏、双栏主区、日志、选项键 |
| 生命周期 | `sweep` / `loop` / `MutationObserver` | 每 700ms 扫 400 次 + 监听 `#chat` 变化，重渲染新楼层 |

版本号位置：`panel.js` 里的 `const VERSION = '…';`（`grep -n "const VERSION" panel.js` 可查当前行号）—— `build.py` 唯一读取的版本源。

### 3.1 状态块键行契约（会被 `KEYS` 正则捕获）

```
scene team quest check result world next
bond* foe* nb* nf* nh* nd* nl* npc* mob*    ← 关系 / NTR 夺走 / NPC / 敌人，可带编号
pts<数字> lock<数字> ti<数字>    ← 点数 / 锁定项 / 称号，带编号
cr<数字> p<数字> sk<数字> eq<数字>  ← 自定义资源 / 玩家 / 技能 / 装备
```

硬规则（改解析器前必须知道）：

1. **`cr<N>` 与 `p<N>` 同号配对**——`p1` 的资源就写在 `cr1`。
2. `cr` 行一行装下该玩家的全部自定义资源，段间用**全角** ` ｜ ` 分隔：`cr1: 幸运LP 12/12 ｜ 幸运因果债 5 ｜ 幸运擦边 2/2`。
3. 资源**绝不写进 `p` 行状态段**——那里最容易被 AI 顶掉（这是 v3.8 之前的真实故障）。
4. 键名后冒号可全角可半角；`mob` 允许无键裸文本兜底（`变异体甲 精英 80/80`）。
5. `pts` 允许省略空档位；无称号不写 `ti` 行。
6. **v3.10.0 NTR 夺走体系（附属扩展册字段）**：`nb`（伴侣，字段同 bond）／`nf`（加害者，兼容 foe 位置制，支持 `身份`/`次用手段` 扩展键）／`nh`（心声：`对你`/`对他`/`心`/`白`）／`nd`（防线档案：`防线名 失守|回填|在守 日期 经过`）／`nl`（暗流事件：`日期 | 标题 | 经过 | 她 | 你 知情|不知情`）。与无限恐怖共用基础状态块，仅关系层换字段；无编号同键行后者覆盖前者，多实例必须编号（nb2/nf3…）。渲染为绯红「沦陷」主题（沦陷环/阶段水印/定局印章/双面镜心声/雾化暗流），与紫金 NPC、蓝 bond、红 foe 完全区分。规则文本见 NTR 卡条目 3，可视化预览页 `tests/preview-ntr.html`。

7. **拓展键纪律**：拓展世界书的自有键必须独占前缀，不得借用基础键；新键须登记到下表并同时加专属渲染分支，未登记的键视为基础键的私有编号，不得复用。多套拓展共享同一角色时，资源段合并进同一个 `cr` 行（段间 ` ｜ `），不新增键、不改渲染。

| 键 | 出处拓展 | 渲染 |
|---|---|---|
| `nb` `nf` `nh` `nd` `nl` | NTR 伴侣夺走 v3 | 绯红沦陷主题 |
| `cr<N>` + `p<N>` | 基础机制；**现由「超高校级幸运」与「魔药体系」共用**（两套均为血统，同角色可并存） | 青色胶囊 |
| `sk` `eq` `lock` `ti` `mob` `bond` `foe` `npc` | 基础机制 | 基础卡片 |

### 3.2 渲染约定

- 双栏：左 `minmax(430px,1fr)`，右栏顶部优先渲染 `THREAT` 区（**没有敌人时整块不渲染**——这是常态设计基准，别恢复成空白占位）。
- CSS 一次性注入 `<style id="tw-card-style">`，不重复注入。
- 自定义资源渲染为 `.tc-pill.cr`（青色 ◈ 胶囊）。
- 卡片右下角有版本水印，看不到水印 = 没装对。

---

## 4. 内容契约（content/ 与两本世界书）

改世界书或新增条目时，以下是不变量，任何"优化"都不得破坏：

1. **三个不豁免**：不豁免层级（高属性≠完整成果）、不豁免边界（叙事门栓前检定拿不到成果）、不豁免代价。
2. **判定**：`阈值 = 基础属性 + DL修正 + 环境修正 - 边界修正 - 状态惩罚`，d100 ≤ 阈值成功；成果层级按 `掷出值/阈值` 分 6 档；属性 140 掷 60% 也只到进阶层。
3. **基因锁上限映射**：未开 100 / 一阶 120 / 二阶 150 / 三阶 180 / 四阶 200-240 / 五阶不限；超上限部分压制不生效且每超 10 点 SP-2/场。
4. **奖励点数实时结算（三级触发器）**：击杀当楼入账 + 数据流闪现；剧变当楼入账；收尾只汇总核对、**严禁补发**。`pts` 变动必须与结算台账双向可审计。
5. **条目 Token 纪律**：条目成品会被注入每一次回复，字数×楼层数全程计费。血统 B≤3 技 / A≤4 / S≤5，内功 主动≤4 + 被动≤1；总字数 ≤3000（机制需要可超，但每句必须有用）；电报体。
6. **代价五不变量**：可感知、可累积且恶化路径写死、有主动管理手段、有防刷净上限（≤5 点当量/场）、以叙事层代价为主。
7. **禁止幸运换皮**：LP / 因果债 / 借运 / 认账 / 因祸得福 / 气运擦边只属于「超高校级幸运」。新条目结构近似可以，循环必须重设计。
8. **数据库模板 10 表**：主神空间全局 / 轮回者名册 / 强化台账 / 结算台账 / 敌情档案 / NPC 与势力 / 物资仓库 / 任务与支线 / 纪要 / 选项。列数口径（含 `row_id` 系统列）见 §5.2，改表后逐表核一遍。

---

## 5. 标准作业流程

### 5.1 改面板并发版

```bash
# 1. 改 panel.js（只改这一个文件）
# 2. 顶部的 VERSION 加一位：'3.8' → '3.9'
python build.py                  # 写 version.json + dist/panel-script-v3.9.json
node --check panel.js            # 语法
node tests/run_all.js   # 四套回归（见 §6）
git add -A && git commit -m "v3.9 描述"
git tag v3.9.0 && git push && git push --tags
```

推送后自检（必须两个都 200）：

- `https://raw.githubusercontent.com/FlusAyr/tw-panel/main/version.json`
- `https://cdn.jsdelivr.net/gh/FlusAyr/tw-panel@v3.9.0/panel.js`

### 5.1.1 新增或改名任何文件后

同步三处，缺一处就会让后来者读到旧路径：

1. `llms.txt` 的对应小节（AI 与检索工具靠它找入口）
2. 本文件第 1 节的仓库地图
3. 如果面向玩家，`README.md` 与 `content/README.md` 的表格

### 5.2 改内容（世界书 / 模板 / 条目）

1. 新文件放 `content/` 对应目录，**同目录只保留一个"最新"版本**，旧版挪到 `F:\酒馆卡\09_归档\`。
2. 同步更新 `content/README.md` 的说明表和版本号。
3. 数据库模板改完必须逐表核对：`content[0]` 长度 == `sourceData.ddl` 字段数 == note 列定义数 + 1；uid 不重复；纪要表保持原版。**+1 是插件加的 `row_id` 系统列，note 的「列0/列1…」从用户列数起、不含它——三者直接比会得到「每表都恰好差 1」的假警报。**
4. 提交信息写清"改了什么 + 影响哪张表/哪个条目"。

### 5.3 新增自定义条目（血统/内功）

按 `content/docs/提示词_自定义血统内功创作系统.md` 执行：八项功能契约、五不变量、cr 行三段、自检清单十条。交付后同时放 `content/entries/`，并在 `content/README.md` 登记。

### 5.4 从零自建一份（换账号 / 换托管）

想给另一个群开一套独立的面板源：

```bash
# 1. 建一个 public 仓库，假定 用户名/tw-panel
# 2. boot.mjs 改 REPO
const REPO = '用户名/tw-panel';
# 3. 重新打包（dist 里的引导包会带上新地址）
python build.py
# 4. 推上去，tag 必须 = v + version.json 里的 version
git add -A && git commit -m "v3.8.0"
git tag v3.8.0 && git push -u origin main && git push --tags
```

自检两个地址都能打开（第一个必须带 CORS 头）：

- `https://raw.githubusercontent.com/用户名/tw-panel/main/version.json`
- `https://cdn.jsdelivr.net/gh/用户名/tw-panel@v3.8.0/panel.js`

推送用的令牌：classic PAT 勾 `repo` 即可（fine-grained 建不了仓库，见 7.2）。推完就可以把令牌删掉。

### 5.5 国内网络 / CDN 打不开

boot 取源：jsDelivr 三域轮询 + GitHub Raw 兜底，任一可用即更新。若都慢：

1. **优先用 jsDelivr 兜底**——它是全球 CDN，国内通常可达，代码按 tag 取所以永不过期。
2. **自建静态托管**：把 `panel.js` + `version.json` 放 Cloudflare Pages / Vercel，改 `boot.mjs` 的取源数组指向自己域名。缓存自控，可挂自定义域名防污染。
3. **不要改用 Gitee 做源**——raw 无 CORS，浏览器 fetch 必被拦，原因见 7.1。Gitee 最多作为人工下载的镜像。

---

## 6. 验证与验收

| 检查 | 命令 / 方法 | 通过标准 |
|---|---|---|
| 面板语法 | `node --check panel.js` | 无输出 |
| 回归 | `node tests/run_all.js` | npc 14 / loader 11 / next_sweep 全部通过 / boot 56，任一失败即非零退出 |
| 面板渲染 | `node gen_preview.js`（在 `F:\酒馆卡\07_脚本`） | 生成 preview_*.html 无报错 |
| 状态块解析 | `F:\酒馆卡\07_脚本\test_*.js` | 各断言全过 |
| 线上可用 | curl 上节两个地址 | HTTP 200，`panel.js` ≥ 60KB |
| CORS | `curl -sI <raw 地址>` | 含 `access-control-allow-origin: *` |
| 模板完整性 | 手动 python 校验（无脚本），口径见 §5.2 | 8 + 10 表全部一致 |

> 不要用 `node tests/*.js` —— node 只执行第一个文件，其余当参数丢弃，**仍会 exit 0**（假绿）。新增测试须手动登记进 `tests/run_all.js` 的 `FILES` 数组。

---

## 7. 已知陷阱（都真实踩过）

1. **Gitee 不能当更新源**：raw 会 302 到 `raw.giteeusercontent.com` 的签名地址，两者都**没有 CORS 头**，浏览器 `fetch` 直接被拦；`raw.gitmirror.com` 已停服。要国内加速就用 jsDelivr，或自建 Cloudflare 代理。
2. **fine-grained PAT 建不了仓库**（`403 Resource not accessible`），也推不了 `.github/workflows/*`；classic PAT 需要 `repo` + `workflow` 两个 scope 才能推 CI。所以 CI 模板放在 `ci/release.yml.example`。
3. **jsDelivr 对 tag 永久缓存**：宁可多发一个 patch 版本，也不要覆盖旧 tag。
4. **版本清单延迟 + 镜像不同步**：`version.json` 走 raw 约 5 分钟、jsDelivr 最长 12 小时；purge 只覆盖 cdn/fastly、**不覆盖 gcore**，gcore 上 `@main` 的旧 URL 残留数小时到 12h，只核验 `cdn.jsdelivr.net` 会骗自己。玩家反馈"没更新"先等一会再刷；根治是拉取 URL 钉 tag。
5. **旧手动脚本冲突**：玩家如果同时装着 v3.8 手动版和 boot，两者都抢 `window.__twCardLoaded`，先加载的赢。boot 会弹黄字提醒，处理方式是让玩家停用旧脚本。
6. **缓存键**：`localStorage['tw-card:cache']` 存代码、`['tw-card:meta']` 存版本。排查"版本没变"先看这两个键。
7. **CRLF 警告**：仓库在 Windows 上提交会提示 LF→CRLF，不影响运行，可忽略；若要消除设 `git config core.autocrlf false`。
8. **测试里的模板字符串**：往 `test_*.js` 里写状态块样例时，`\n` 必须写 `\\n`，否则被 JS 烤成真换行导致解析失败（连续踩过三次）。

---

## 8. 交接自查（你接手时的 DoD）

- [ ] 读完本文件 + `content/docs/酒馆状态面板系统_维护手册.md`
- [ ] 能说清 `cr<N>` 与 `p<N>` 的配对关系，以及为什么资源不能写进 p 行
- [ ] 跑通四套回归测试（见 §6）
- [ ] curl 两个线上地址都是 200，且 raw 带 CORS 头
- [ ] 知道纪要表为什么不能动，以及属性快照写在哪里
- [ ] 知道发版必须打新 tag、必须 `python build.py`
- [ ] 改动前先在 `F:\酒馆卡\09_归档` 找历史版本对照

---

## 9. 术语表

| 词 | 含义 |
|---|---|
| 状态块 | AI 每楼末尾输出的键行文本（`scene:` / `p1:` / `cr1:` …），是本系统的唯一数据源 |
| 键行 | 状态块中以 `key:` 开头的行，被 `KEYS` 正则识别 |
| cr 行 | 自定义资源行，与 p 行同号，一行多段用 ` ｜ ` 分隔 |
| HUD 卡片 | 面板把状态块渲染成的作战指挥台样式卡片 |
| pts | 奖励点数（主神空间货币），实时结算 |
| 支线 | D/C/B/A/S 五级剧情凭证，3 低 = 1 高，只能向上合成 |
| 基因锁 | 属性上限的闸门，靠死亡边缘的恐惧+执念解锁 |
| 纪要 | 数据库里逐楼记录的历史卷宗，插件的记忆追回依赖它 |
