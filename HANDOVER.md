# HANDOVER.md · 交接总档（给接手的 agent 团队）

> **这份文档是你要读的第一份文件。** 读完它你能知道：这套系统是什么、现在什么状态、
> 日常怎么维护、出问题去哪查。细节手册在 AGENTS.md，这里只做导览 + 补充 AGENTS.md
> 还没来得及写进去的最新增量（2026-11-01 前的全部变更）。
>
> 最后更新：2026-11-01　｜　面板 v3.14.0　｜　引导 boot v2.1　｜　仓库 https://github.com/FlusAyr/tw-panel

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
| `panel.js` | **v3.14.0**（tag 未推） | 渲染器唯一源文件，≈1.7k 行 |
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
- **结构性约束**：boot 与面板共用同一个 tag，因此任何 boot 变更都强制面板 bump 版本（tag 不可覆盖）；长期解法是 `version.json` 加独立 `boot` 字段，让引导版本可独立分发（backlog）

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
3. **`@main` 可变别名 + 多镜像缓存不同步**：曾出现 `@main/version.json` 报 3.10.1 而 `@main/panel.js` 已是 3.12.0 的自相矛盾；玩家导入行走的是 gcore，新玩家可能拿到无「面板设置」的旧 boot。处置：引导与面板拉取一律钉不可变 tag `@vX.Y.Z`，唯一例外：设置面板「强制重拉最新」按钮走 `@main`；急发版走 tag。
4. **`work/panel_content.js`**：仓库外工作副本（`C:\Users\Administrator\WorkBuddy\2026-10-31-05-01-50\work\`），发版时同步一份，防仓库目录意外损毁。
5. NTR 卡 v3 的**输出纪律**条款是治「AI 漏生成数值」的第一版方案；如果实际跑团仍漏，下一步方向是把纪律句复制到条目 1（五维数值核心）的头部，双保险。
6. **字节断言一律落盘后 `wc -c`**。`size_download` 本身准，错在用法：URL 形态错（`repo/@v1.2.3/f`，`@` 前多一个 `/`）→ jsDelivr 回 404 错误体（69~72 B），看着像文件只有几十字节；`-I`(HEAD) 恒 0；`--compressed` 给压缩字节（`llms.txt` 2952 vs 5884）。异常小值先核对 URL。
7. **R18 扩展册仍在 git 历史中**：`content/worldbook/NTR_伴侣夺走_v3_纯净框架版.json` 已于 2026-11-01 从 HEAD 移除（仓库无版本变更、未打 tag），但引入它的提交 `24802fe` 仍在历史里（`git log --all -- <该路径>` 可取回）。管理层已知并接受：仓库保持公开，重写历史会改变全部 tag 指向的 commit，与「tag 永不覆盖」冲突。新增 R18 册一律不入公开仓库。

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
