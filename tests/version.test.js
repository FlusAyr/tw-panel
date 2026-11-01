/* 版本一致性回归测试（v3.14 · 落点清单 `_release/version_bump_points_v3.14.md` 的断言化）
 *
 * 六类映射：
 *   A    必须手改的两处真值（version.json:2 / panel.js:12）必须相等
 *   A→B  A 的值必须等于 dist/loader-script.json 里 @vX.Y.Z 的 X.Y.Z
 *   B    build.py 生成物：dist/panel-script-v<ver>.json 必须存在且 name/info 带同一版本
 *   C    **只查落点行**（8 个落点），每行必须写着当前版本，且不得出现别的版本号；区间写法放行
 *   E    历史区白名单：显式列，禁止正则通配（CHANGELOG + 6 个历史 dist 文件）
 *   F    BOOT_VERSION 与面板 VERSION 必须不相等（防"顺手对齐"）
 *
 * 两条纪律：
 * 1. 禁扫描 —— 文件清单全部显式写死，不做目录枚举。代价是新增文件要手动登记，收益是
 *    被检查的集合永远不会在你不知情时改变。
 * 2. 缺失即失败 —— 任何必需文件/落点行找不到都直接判红，不留 SKIP 逃生门。这条是 boot.test.js
 *    第 8 组的同一个教训：能被静默跳过的检查等于没有检查。
 *
 * C 类为什么必须只查落点行、不许整文件扫（v1 犯过，已改）：
 *   仓库里合法存在**与当前版本不同的**版本号，三类：
 *     AGENTS.md:105/150/156/188/195   规则举例与示例命令（`git tag v3.9.0`、URL 示例）
 *     HANDOVER.md:75-79               版本增量史（叙述，不是当前状态）
 *     维护手册:45/105                 联机脚本 v3.1.8，与本面板零耦合
 *   整文件扫会把这 8 行正确叙述判成错。而"放宽正则糊过去"是死路——放宽到能过，真错也一起过了。
 *   正确做法：**只查落点行**，落点用锚点 pattern 定位（不写死行号，文档改了行号测试不该红）。
 *
 * 失败时必须打印**行号 + 该行原文**：只报"命中 1 处"时，两个数都在、都错，看不出真假。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const abs = (rel) => path.join(ROOT, rel);
const has = (rel) => fs.existsSync(abs(rel));
const read = (rel) => fs.readFileSync(abs(rel), 'utf8');
const readLines = (rel) => read(rel).split(/\r?\n/);

let pass = 0, fail = 0;
const T = (name, cond, detail) => {
  cond ? pass++ : fail++;
  console.log(cond ? 'OK  ' : 'FAIL', name + (!cond && detail ? '  ← ' + detail : ''));
};
const clip = (s) => { s = String(s); return s.length > 160 ? s.slice(0, 160) + '…' : s; };

/* ─────────── 必需文件预检：缺失即红，不 SKIP ─────────── */
const REQUIRED = ['panel.js', 'version.json', 'boot.mjs', 'dist/loader-script.json'];
const missing = REQUIRED.filter((rel) => !has(rel));
if (missing.length) {
  missing.forEach((rel) => console.error('  ✗ ' + rel + ' 缺失'));
  console.log('\nFAIL 预检：必需文件缺失（' + missing.join(', ') + '）');
  console.log('0 通过 / 1 失败');
  process.exit(1);
}

/* ─────────── 取值（全部现取，不手抄任何版本号） ─────────── */
const panelSrc = read('panel.js');
const verJson = JSON.parse(read('version.json'));
const loaderJson = JSON.parse(read('dist/loader-script.json'));
const bootSrc = read('boot.mjs');

const VERSION = (panelSrc.match(/const VERSION = '([^']*)'/) || [])[1] || '';
const BOOT_VERSION = (bootSrc.match(/const BOOT_VERSION = '([^']*)'/) || [])[1] || '';
const SEMVER = /^\d+\.\d+\.\d+$/;
const TAG_IN_IMPORT = (String(loaderJson.content || '').match(/@v(\d+\.\d+\.\d+)\//) || [])[1] || '';

console.log('\n当前 panel.js VERSION = ' + JSON.stringify(VERSION) + ' ｜ boot.mjs BOOT_VERSION = ' + JSON.stringify(BOOT_VERSION));

/* ─────────── 组 A · 两处真值 ─────────── */
console.log('\n── 组 A · 必须手改的两处真值 ──');
T('panel.js 的 VERSION 是三段式 semver', SEMVER.test(VERSION), '实际 ' + JSON.stringify(VERSION));
T('version.json:version === panel.js VERSION', verJson.version === VERSION,
  'version.json=' + JSON.stringify(verJson.version) + ' / panel.js=' + JSON.stringify(VERSION));

/* ─────────── 组 A→B · 与 dist 导入行的 tag 联动 ─────────── */
console.log('\n── 组 A→B · 导入行 @vX.Y.Z 与 VERSION 联动 ──');
T('dist/loader-script.json 里 @vX.Y.Z 的 X.Y.Z === VERSION', TAG_IN_IMPORT === VERSION,
  '导入行 tag=' + JSON.stringify(TAG_IN_IMPORT) + ' / VERSION=' + JSON.stringify(VERSION));
T('导入行是合法一行 import 且 URL 可被 new URL() 解析',
  /^import\s+'[^']+'$/.test(String(loaderJson.content || '')) && (() => {
    try { new URL(String(loaderJson.content).match(/'([^']+)'/)[1]); return true; } catch (e) { return false; }
  })());

/* ─────────── 组 B · build.py 生成物 ─────────── */
console.log('\n── 组 B · build.py 生成物 ──');
const panelDist = 'dist/panel-script-v' + VERSION + '.json';
T('dist/panel-script-v' + VERSION + '.json 存在', has(panelDist),
  '缺文件 → 先跑 python build.py');
if (has(panelDist)) {
  const pj = JSON.parse(read(panelDist));
  T('该文件 name 带 v' + VERSION, String(pj.name || '').indexOf('v' + VERSION) >= 0, 'name=' + JSON.stringify(pj.name));
  T('该文件 info 以 v' + VERSION + ' 开头', String(pj.info || '').indexOf('v' + VERSION) === 0, 'info=' + JSON.stringify(String(pj.info || '').slice(0, 40)));
} else {
  T('该文件 name 带 v' + VERSION, false, '文件缺失，无法取值');
  T('该文件 info 以 v' + VERSION + ' 开头', false, '文件缺失，无法取值');
}
/* loader 的 name 标的是 boot 版本，不是面板版本 —— 这两者混同是 F 类灾难的同一个根 */
T('dist/loader-script.json name 带 boot 版本 v' + BOOT_VERSION,
  String(loaderJson.name || '').indexOf('v' + BOOT_VERSION) >= 0, 'name=' + JSON.stringify(loaderJson.name));

/* ─────────── 组 C · 8 个落点行（锚点定位，不写死行号，不扫整文件） ─────────── */
console.log('\n── 组 C · 8 个落点行 ──');
const RANGE = /v?\d+\.\d+\.\d+\s*→\s*v?\d+\.\d+\.\d+/g;   // 「v3.8.0 → v3.13.0」区间放行
const POINTS = [
  { id: 'AGENTS.md:5', file: 'AGENTS.md', name: '文件抬头', re: /^> 最后更新[:：]/ },
  { id: 'HANDOVER.md:7', file: 'HANDOVER.md', name: '文件抬头', re: /^> 最后更新[:：]/ },
  { id: 'HANDOVER.md:67', file: 'HANDOVER.md', name: '资产表 panel.js 行', re: /^\|\s*`panel\.js`\s*\|/ },
  { id: 'HANDOVER.md:81', file: 'HANDOVER.md', name: '版本说明最新一条（升序排列，新版加在末）', re: /^- \*\*v\d+\.\d+\.\d+\*\*/, pick: 'last' },
  { id: 'README.md:60', file: 'README.md', name: '版本水印示例', re: /版本水印，如/ },
  { id: 'README.md:62', file: 'README.md', name: '控制台日志示例', re: /\[tw-boot\] 面板已启动/ },
  { id: 'llms.txt:22', file: 'llms.txt', name: 'dist 离线手动版链接', re: /dist\/panel-script-v\d+\.\d+\.\d+\.json/ },
  { id: '维护手册:4', file: 'content/docs/酒馆状态面板系统_维护手册.md', name: '面板脚本当前版本', re: /面板脚本当前版本/ },
  /* content/README.md 是唯一「玩家能看见 / 测试不覆盖 / QA 不读」的版本落点：三处都不管，它烂了没人会红。 */
  { id: 'content/README.md:8', file: 'content/README.md', name: '玩家安装页版本行', re: /\*\*v\d+\.\d+\.\d+\*\*/ },
];

POINTS.forEach((pt) => {
  if (!has(pt.file)) { T(pt.id + ' ' + pt.name, false, '文件缺失：' + pt.file); return; }
  const lines = readLines(pt.file);
  const hit = [];
  lines.forEach((ln, i) => { if (pt.re.test(ln)) hit.push({ no: i + 1, text: ln }); });
  if (!hit.length) {
    T(pt.id + ' ' + pt.name, false, '找不到落点行——锚点 pattern ' + pt.re + ' 已不匹配，先核对手册再改 pattern');
    return;
  }
  const picked = pt.pick === 'last' ? [hit[hit.length - 1]] : hit;
  picked.forEach((h) => {
    const stripped = h.text.replace(RANGE, '<RANGE>');
    const found = stripped.match(/\d+\.\d+\.\d+/g) || [];
    const hasCur = found.indexOf(VERSION) >= 0;
    const stray = [...new Set(found.filter((v) => v !== VERSION))];
    const where = pt.file + ':' + h.no + '（' + pt.name + '）';
    T(where + ' 写着当前版本 ' + VERSION, hasCur,
      '实际写着 ' + JSON.stringify(stray) + '\n       原文：' + clip(h.text));
    T(where + ' 没有别的版本号', stray.length === 0,
      '残留 ' + JSON.stringify(stray) + '\n       原文：' + clip(h.text));
  });
});

/* ─────────── 组 E · 历史区白名单（显式列，禁通配） ─────────── */
console.log('\n── 组 E · 历史区白名单 ──');
const C_FILES = [...new Set(POINTS.map((p) => p.file))];
const HISTORY_EXEMPT = ['CHANGELOG.md'];   // 历史条目：新版往上加节，旧节不动
T('CHANGELOG.md 在放行名单里、且不在 C 类检查清单里',
  HISTORY_EXEMPT.indexOf('CHANGELOG.md') >= 0 && C_FILES.indexOf('CHANGELOG.md') < 0);
/* 历史手动版 dist 已入 git，只增不删；逐一点名，不用通配 */
const HISTORY_DIST = [
  'dist/panel-script-v3.10.0.json',
  'dist/panel-script-v3.10.1.json',
  'dist/panel-script-v3.11.0.json',
  'dist/panel-script-v3.11.1.json',
  'dist/panel-script-v3.12.0.json',
  'dist/panel-script-v3.13.0.json',
];
const lost = HISTORY_DIST.filter((rel) => !has(rel));
T('6 个历史手动版 dist 全部在册（只增不删）', lost.length === 0, '丢失 ' + JSON.stringify(lost));

/* ─────────── 组 F · BOOT_VERSION 与面板 VERSION 必须不相等 ─────────── */
console.log('\n── 组 F · 引导版本与面板版本解耦 ──');
T('BOOT_VERSION 与 VERSION 字面不相等', BOOT_VERSION !== VERSION,
  '两者都成了 ' + JSON.stringify(VERSION) + ' —— 有人"顺手对齐"了，设置面板会显示错误引导版本且无任何报错');
const bootTriple = BOOT_VERSION.split('.').length === 2 ? BOOT_VERSION + '.0' : BOOT_VERSION;
T('BOOT_VERSION 补零成三段后仍 != VERSION', bootTriple !== VERSION,
  'BOOT_VERSION 补零=' + JSON.stringify(bootTriple) + ' 撞上了面板版本');

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
