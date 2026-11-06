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

/* ─────────── 组 A→B · 导入行的 tag 归属（v3.16 起与面板 VERSION 解耦） ─────────── */
console.log('\n── 组 A→B · 导入行 tag 归属 ──');
/* v3.15 及以前：导入行钉的是面板版本，于是每次面板发版，一份**没变**的引导脚本都显示"变了"。
   v3.16 起导入行钉 BOOT_TAG（boot.mjs 最后变更所在 tag）。所以「=== VERSION」是**过时的契约**，
   继续钉它会逼着每版都去 bump BOOT_TAG —— 那正是这次要消掉的 churn。
   现在这里只验 tag 的**形状**（合法的 vX.Y.Z），归属由组 G 的 C-1/C-2 锁死。 */
T('导入行钉的 tag 形如 vX.Y.Z', /^\d+\.\d+\.\d+$/.test(String(TAG_IN_IMPORT)),
  '导入行 tag=' + JSON.stringify(TAG_IN_IMPORT));
/* 导入行钉的那个 tag 里，boot.mjs 的 blob 必须与 HEAD:boot.mjs 的 blob 相同。一次锁三件事：
     1. tag 存在（rev-parse 失败即红）—— 堵住打错 tag 名（玩家导入行 404）
     2. 玩家拿到的 boot 就是我们发的这一份（内容相同，比"版本号相等"更实）
     3. BOOT_TAG 没落后（boot 改过却没 bump，两边 blob 就不同）
   「同时改了 boot.mjs 和面板、BOOT_TAG 恰好等于本版 tag」这种正常发版照样绿 —— 所以没有用
   `TAG_IN_IMPORT !== VERSION`：那是不变量错觉，正常演进会被判成故障，然后逼下一个人放宽它。 */
(function () {
  const gitBlob = (spec) => {
    try {
      return require('child_process').execFileSync('git', ['rev-parse', spec],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }).trim();
    } catch (e) { return null; }
  };
  const inTag = gitBlob('v' + TAG_IN_IMPORT + ':boot.mjs');
  const atHead = gitBlob('HEAD:boot.mjs');
  T('导入行 tag 里的 boot.mjs blob === HEAD:boot.mjs 的 blob（tag 存在、内容对得上、BOOT_TAG 没落后）',
    !!inTag && !!atHead && inTag === atHead,
    'v' + TAG_IN_IMPORT + ':boot.mjs=' + JSON.stringify(inTag) + ' / HEAD:boot.mjs=' + JSON.stringify(atHead)
      + (inTag === null ? '　← 该 tag 不存在，玩家导入行会 404' : '')
      + (inTag && atHead && inTag !== atHead ? '　← BOOT_TAG 落后：boot.mjs 改过却没 bump' : ''));
})();
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

/* ─────────── 组 G · version.json 只留机器读的字段 + 导入行 tag 与 boot.mjs 真相一致 ─────────── */
console.log('\n── 组 G · version.json 字段与导入行 tag ──');

/* A. notes 必须消失。它当年是「人读文案的第二个来源」：同一段话 CHANGELOG 一份、build.py NOTES 一份，
      只有前者在维护白名单里，于是必然分叉 —— v3.15.0 发出去时 notes 还写着 v3.14.0 的话。 */
const meta = JSON.parse(fs.readFileSync(abs('version.json'), 'utf8'));
T('version.json 里不存在 notes 字段（人读文案只留在 CHANGELOG.md）',
  !Object.prototype.hasOwnProperty.call(meta, 'notes'),
  '仍有 notes=' + JSON.stringify(meta.notes) + ' —— 那是人读文案的第二个来源，删掉它，不要同步它');

/* B. boot 必须等于 boot.mjs 里现读的 BOOT_VERSION，不许另存一份字面量。 */
T('version.json.boot === boot.mjs 的 BOOT_VERSION（现读，非硬编码）',
  meta.boot === BOOT_VERSION,
  'version.json.boot=' + JSON.stringify(meta.boot) + ' / boot.mjs=' + JSON.stringify(BOOT_VERSION));

/* C. 导入行钉的 tag 必须就是 boot.mjs 最后一次变更所在的 tag。
      这条是「解耦之后不会静默失效」的唯一保险：改了 boot.mjs 却没 bump BOOT_TAG，
      导入行仍指旧 tag、玩家永远拿不到新 boot，而没有这条时所有测试照样全绿。
      BOOT_TAG 从 build.py 现解析，不在本文件里再写一份字面量（两份字面量＝两个来源，同 NOTES 那个病）。 */
const BUILD_SRC = fs.readFileSync(abs('build.py'), 'utf8');
const mt = BUILD_SRC.match(/^BOOT_TAG\s*=\s*["'](v[0-9.]+)["']/m);
T('能从 build.py 解析出 BOOT_TAG', !!mt, 'build.py 里找不到 `BOOT_TAG = "vX.Y.Z"`');
if (mt) {
  const BOOT_TAG = mt[1];

  /* C-1 导入行必须钉这个 tag（防 build.py 里改了一处漏了另一处） */
  const loader = JSON.parse(fs.readFileSync(abs('dist/loader-script.json'), 'utf8'));
  T('dist 导入行钉的 tag === build.py 的 BOOT_TAG（' + BOOT_TAG + '）',
    String(loader.content).indexOf('@' + BOOT_TAG + '/boot.mjs') > 0,
    '导入行实际内容：' + String(loader.content).slice(0, 120));

  /* C-2 真锁：BOOT_TAG..HEAD 之间 boot.mjs 必须没有变更 */
  let changed = null, gitErr = '';
  try {
    changed = require('child_process').execFileSync('git',
      ['diff', '--name-only', BOOT_TAG + '..HEAD', '--', 'boot.mjs'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }).trim();
  } catch (e) { gitErr = String((e && e.stderr) || (e && e.message) || e).slice(0, 200); }
  T('git diff --name-only ' + BOOT_TAG + '..HEAD -- boot.mjs 为空（BOOT_TAG 跟得上 boot.mjs）',
    changed === '',
    'boot.mjs 在 ' + BOOT_TAG + ' 之后改过、却没 bump BOOT_TAG —— 导入行还钉在老 tag，玩家永远拿不到新 boot。'
      + (gitErr ? ' git 报错：' + gitErr + '　← 浅克隆请先 git fetch --tags'
                : ' 实际输出=' + JSON.stringify(changed)));
}

/* ─────────── H 条目数一致性：真值从 content/worldbook/*.json 数出来 ───────────
 * 为什么需要这一组：世界书从 24 条扩到 29 条时，七处文档里的「条目数」同时变假，
 * 而没有任何门禁会红（AGENTS.md §7 第 15/16 条就是那次事故的产物）。其中 AGENT_DEPLOY.md:137
 * 最坏——它给玩家一个会误判的校验动作（照做看到 29≠24，会得出「文件下坏了」并重下）。
 *
 * 三条纪律：
 * 1. 真值不写死：从 json 本体数 entries，代码里不出现字面量 29 / 18。
 * 2. 锚点逐条写、不许泛型：「条目」在维护手册里还指「条目 3/22」「条目 14」这种**条目编号**，
 *    泛型正则会连它们一起扫进来。每条锚点必须恰好命中 1 次；命中 0 次 = 文档改写了这句，
 *    命中 >1 次 = 锚点不唯一。两种都判红，不许静默跳过。
 * 3. 失败必打印：文件 + 行号 + 该行原文 + 期望值 + 实际值。
 *
 * 豁免（不在本组内）：CHANGELOG.md、HANDOVER.md —— 谱系里的「24 → 29」是历史记录，不是缺陷。
 * 把历史判红等于要求谎报历史；而「第一天就红、红得没道理」的断言最后一定会被调宽或删掉，
 * 比没写更坏。
 */
{
  const readUtf8 = (rel) => fs.readFileSync(abs(rel), 'utf8');
  const WB = {
    kb: 'content/worldbook/无限恐怖_v2_联机版_AI精简_2026-11-06.json',
    tuan: 'content/worldbook/跑团用世界书_v4_联机版_AI精简_2026-11-06.json',
  };
  const TRUTH = {};
  Object.keys(WB).forEach((k) => {
    let n = null, err = '';
    try {
      const j = JSON.parse(readUtf8(WB[k]));
      if (!j || typeof j.entries !== 'object' || j.entries === null) err = 'json 里没有 entries 对象';
      else n = Object.keys(j.entries).length;
    } catch (e) { err = e.message; }
    TRUTH[k] = n;
    T('真值可数：' + k + ' 的条目数（来自 ' + WB[k] + '）',
      typeof n === 'number' && n > 0, err || ('实际=' + n));
  });

  const DOC = 'content/docs/酒馆状态面板系统_维护手册.md';
  // [文件, 锚点正则（必须恰好命中 1 次）, 捕获组顺序, 这处在说什么]
  const COUNT_ANCHORS = [
    ['AGENTS.md', /无限恐怖 v2（(\d+) 条目）、跑团用 v4（(\d+) 条目）/, ['kb', 'tuan'], '仓库地图'],
    ['llms.txt', /主世界书，(\d+) 条目/, ['kb'], '入口索引·无限恐怖'],
    ['llms.txt', /通用规则层，(\d+) 条目/, ['tuan'], '入口索引·跑团用'],
    ['content/README.md', /`无限恐怖_v2_联机版_AI精简_\d{4}-\d{2}-\d{2}\.json` \| (\d+) 条目/, ['kb'], '下载表·无限恐怖'],
    ['content/README.md', /`跑团用世界书_v4_联机版_AI精简_\d{4}-\d{2}-\d{2}\.json` \| (\d+) 条目/, ['tuan'], '下载表·跑团用'],
    ['AGENT_DEPLOY.md', /条目数应为 \*\*(\d+)\*\*（无限恐怖）和 \*\*(\d+)\*\*（跑团用）/, ['kb', 'tuan'], '玩家校验动作'],
    ['AGENT_DEPLOY.md', /条目数 (\d+) \/ (\d+)/, ['kb', 'tuan'], '验收表'],
    [DOC, /当前世界卡（世界书格式，(\d+) 条目）/, ['kb'], '§条目表·无限恐怖'],
    [DOC, /### 9\.1 跑团用世界书（基础册，(\d+) 条目）/, ['tuan'], '§9.1 跑团用'],
    [DOC, /### 9\.2 无限恐怖 v2 联机版（世界册，(\d+) 条目）/, ['kb'], '§9.2 无限恐怖'],
    ['README.md', /条目数分别为 (\d+) 和 (\d+)/, ['kb', 'tuan'], '玩家安装表'],
  ];

  const lineAt = (text, idx) => {
    let n = 1;
    for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  };

  COUNT_ANCHORS.forEach(([file, re, order, what]) => {
    const id = file + '（' + what + '）';
    if (!has(file)) { T('条目数锚点：' + id, false, '文件不存在'); return; }
    const text = readUtf8(file);
    const g = new RegExp(re.source, 'g');
    const hits = [];
    let m;
    while ((m = g.exec(text)) !== null) {
      hits.push({ m: m, idx: m.index });
      if (m[0] === '') g.lastIndex++;  // 防零宽匹配死循环
    }
    if (hits.length !== 1) {
      T('条目数锚点唯一性：' + id, false,
        '命中 ' + hits.length + ' 次（必须恰好 1 次）'
        + (hits.length === 0 ? '　← 锚点失效：文档可能改写了这句，请改锚点，别放宽正则'
          : '　← 锚点不唯一：同句在文件里出现了多次'));
      return;
    }
    const h = hits[0];
    const ln = lineAt(text, h.idx);
    const src = (text.split('\n')[ln - 1] || '').trim();
    const bad = [];
    order.forEach((k, i) => {
      const want = TRUTH[k];
      const got = Number(h.m[i + 1]);
      if (want === null || got !== want) bad.push(order.length > 1 ? '第' + (i + 1) + '个(' + k + ')' : k + ' 期望 ' + want + ' 实际 ' + h.m[i + 1]);
    });
    T('条目数一致：' + id + ' @ ' + file + ':' + ln, bad.length === 0,
      (bad.length ? '不符：' + bad.join('；') + '　' : '')
      + '期望 ' + order.map((k) => TRUTH[k]).join('/') + '　实际 ' + order.map((k, i) => h.m[i + 1]).join('/')
      + '　原文=' + JSON.stringify(clip(src)));
  });
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
