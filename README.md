# tw-panel · 主神空间 tw-card 状态面板（自动更新仓库）

> 线上仓库：https://github.com/FlusAyr/tw-panel
> 玩家导入：`dist/loader-script.json`（酒馆助手 → 脚本 → 导入）
> 当前版本：v3.8.0
> 接手维护请先读 [AGENTS.md](AGENTS.md)（AI/人通用作业手册）；版本历史见 [CHANGELOG.md](CHANGELOG.md)

酒馆助手（SillyTavern）渲染器 `panel.js` 的发布仓库。解决一件事：**改一次面板，不用再让每个玩家重新导入脚本。**

## 〇、内容下载（世界书 / 数据库模板 / 条目 / 文档）

玩家需要的东西都在 [`content/`](content/) 里，安装顺序见 [content/README.md](content/README.md)：

| 目录 | 内容 |
|---|---|
| `content/worldbook/` | 无限恐怖 v2、跑团用世界书 v4（AI 精简版） |
| `content/database/` | 无限恐怖数据库模板 10 表深度版、原版备份、插件入口 |
| `content/panel/` | 自动更新引导包（推荐）、v3.8 手动导入版 |
| `content/entries/` | 超高校级幸运、魔药体系 v1.0 |
| `content/docs/` | 自定义血统创作系统提示词、面板维护手册、状态块样例 |

## 一、原理

```
玩家导入一次 loader ──► 页面加载时读本地缓存 instant 启动
                     └─► 后台拉 version.json ──► 有新版就下载 panel.js 存缓存
                                              └─► 提示「已更新，刷新生效」
```

- 面板本体永远从仓库/CDN 拉，玩家端只有一支 90 行的引导脚本。
- 有本地缓存：断网、CDN 挂了也能正常渲染上一版。
- 两家源互为兜底：GitHub Raw（版本清单，5 分钟缓存）+ jsDelivr（代码，tag 不可变、国内通常可达）。

## 二、一次性部署（5 分钟）

**1. 建仓库**
GitHub 新建 public 仓库，名字随你（下文以 `你的账号/tw-panel` 为例）。

**2. 改一行配置**
打开 `loader.js`，把顶部：

```js
const REPO = 'CHANGE_ME/tw-panel';
```

已配置为 `'FlusAyr/tw-panel'`（仓库已上线，无需再改）。然后重新打包，让 dist 里的引导脚本也带上这个地址：

```bash
python build.py
```

**3. 推上去**

```bash
git add -A
git commit -m "v3.8.0"
git tag v3.8.0          # 标签名必须 = v + version.json 里的 version
git push
git push --tags
```

推送完成后自检两个地址（把账号换成你的）：

- `https://raw.githubusercontent.com/FlusAyr/tw-panel/main/version.json`
- `https://cdn.jsdelivr.net/gh/FlusAyr/tw-panel@v3.8.0/panel.js`

都能打开 → 部署完成。

## 三、玩家侧（只做一次）

1. 酒馆助手 → 脚本 → 导入 → 选 `dist/loader-script.json`（或直接把 `loader.js` 全文粘进新建脚本）。
2. **停用之前手动导入的 `tw-card 状态面板 vX` 脚本**——两份同时跑会互相抢渲染，loader 会在右下角弹黄字提醒你。
3. 刷新页面。看到面板正常渲染、控制台有 `[tw-loader] 面板已启动 v3.8.0` 即可。

以后不用再管。控制台可随时手动检查更新：`twPanelCheck()`；查当前版本：`twPanelVersion()`。

## 四、日常发版流程

```bash
# 1. 改 panel.js（唯一的源文件）
# 2. 把 panel.js 顶部 VERSION 加一位：'3.8' -> '3.9'
python build.py                              # 生成 version.json + dist 两个导入包
git add -A && git commit -m "v3.9 增删xxx"
git tag v3.9.0 && git push && git push --tags
```

玩家下次刷新页面就是新版本。**不要复用旧 tag**——jsDelivr 对 tag 做永久缓存，同 tag 覆盖推送不会生效，必须新 tag。

> 版本号规则：`version.json` 用三位（3.9.0），`panel.js` 里的 `VERSION` 可以写 `'3.9'`，比较时按段对齐，两种都认。tag 打 `v3.9.0` 或 `v3.9` 都能被 loader 命中（它会依次试）。

## 五、国内网络

- 若 GitHub Raw 打不开、jsDelivr 又慢：在 `loader.js` 的 `SOURCES` 里加 Gitee 镜像（文件里已留好注释模板），同步推一份到 Gitee 即可。
- 更稳的做法：仓库接 Cloudflare Pages / Vercel，把 `panel.js`、`version.json` 作为静态资源发布，然后把源地址换成自己的域名。缓存策略自己可控，也能挂自定义域名防污染。

## 六、排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 面板不出现，右下角红字「无法连接更新源，且本地无缓存」 | 首次安装就断网 / 仓库地址没改 | 检查 `REPO`；或临时导入 `dist/panel-script-vX.json` 手动版 |
| 一直提示「已更新，刷新生效」但版本没变 | 缓存写失败（隐私模式/存储满） | 换正常窗口；控制台看 `localStorage['tw-card:meta']` |
| 面板出现两份 / 闪烁 | 旧手动脚本没停用 | 只保留 loader，删除其余面板脚本 |
| 改了代码，玩家拿不到新版 | 没打新 tag，或 jsDelivr 缓存了旧 `@main` | `version.json` 会被缓存约 5 分钟（raw）/ 12 小时（jsDelivr）；确认 tag 是新的，等一会再刷 |
| tag 推了但 404 | tag 名与 `version.json` 的 version 不一致 | `git tag -l` 核对；tag 必须是 `v` + version |

## 七、文件说明

| 文件 | 作用 |
|---|---|
| `panel.js` | 面板渲染器唯一源文件（改这里） |
| `loader.js` | 引导脚本源码（玩家导入的那支） |
| `version.json` | 版本清单，loader 用它判断要不要更新 |
| `build.py` | 打包：读 `panel.js` 的 VERSION → 刷新 `version.json` → 生成 `dist/*.json` |
| `dist/loader-script.json` | 酒馆助手可直接导入的引导脚本包 |
| `dist/panel-script-vX.json` | 手动导入版（离线用，不自动更新） |
| `AGENTS.md` | 维护者手册：目录职责、三件绝不能做的事、状态块契约、标准作业流程、验收与已知陷阱 |
| `CHANGELOG.md` | 版本历史与存档格式 |
| `ci/release.yml.example` | 可选 CI：想启用自动 Release，把文件拷到 `.github/workflows/release.yml` 再推（推 workflow 需要 token 带 `workflow` 权限） |
