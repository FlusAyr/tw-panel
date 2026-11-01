/* 拓展键前缀回归测试（v3.14 · 方案 A 显式登记）
 *
 * 为什么单独一个文件：现有 tests/npc.test.js:30 是 `api.render(api.parseState(t))`，
 * 直接跳过 collectLines(:1055) / extractBlock(:1028) 这两道唯一的门 —— 也就是说
 * 「状态块里混进一个未登记的键行 → 后面所有键行被静默截掉」这个故障，
 * 四套既有测试（npc 14 / loader 11 / next_sweep 4 / boot 56）全绿的时候依然存在。
 * 本文件的第 3 组就是用来钉死它的。
 *
 * 自曝手段只走断言，panel.js 零运行时埋点（console.warn/error 数量必须保持 0）：
 * 「一行没人看的控制台告警」会让问题看起来已经处理了，比可复现的坏结果更坏。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');

const win = {};
const sandbox = {
  window: win,
  document: {
    body: { appendChild() {} }, head: { appendChild() {} }, documentElement: {},
    createElement: () => ({ style: {} }), getElementById: () => null, addEventListener() {}
  },
  console,
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  location: { href: '' },
  MutationObserver: class { observe() {} disconnect() {} },
  navigator: { userAgent: 'test' },
  requestAnimationFrame: () => {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);

/* KEYS 字符串从源码现取（不手抄：手抄的副本会随 panel.js 漂移而变成假绿） */
function readKeysString() {
  const marker = "const KEYS = '";
  const i = SRC.indexOf(marker);
  if (i < 0) throw new Error('panel.js 里找不到 KEYS 字符串（源码结构变了，先修本测试的锚点）');
  const start = i + marker.length;
  const end = SRC.indexOf("'", start);
  if (end < 0) throw new Error('KEYS 字符串没有闭合引号');
  return SRC.slice(start, end);
}

setTimeout(() => {
  const api = sandbox.window.__twCard;
  if (!api) { console.error('FAIL: __twCard 未暴露'); process.exit(1); }

  let pass = 0, fail = 0;
  const T = (name, cond, detail) => {
    cond ? pass++ : fail++;
    console.log(cond ? 'OK  ' : 'FAIL', name + (!cond && detail ? '  ← ' + detail : ''));
  };

  const KEYS = readKeysString();
  const REG = Array.isArray(api.keys) ? api.keys : [];
  const frags = KEYS.split('|').map(s => s.trim()).filter(Boolean);

  /* ───────── 组 1 · 登记表结构：四列一个都不许漏 ─────────
     漏第四列（主题 class）的后果不是报错，是拓展 NPC 和基础 NPC 长得一模一样，
     「渲染不冲突」这个需求静默没实现 —— 所以把它写成断言。 */
  console.log('\n── 组 1 · 登记表四列完整 ──');
  T('登记表存在且非空（api.keys）', REG.length > 0, '实际 ' + (api.keys === undefined ? 'undefined' : JSON.stringify(REG.length)));
  const badCols = REG.filter(e => !e || !e.key || !e.base || !e.render || !e.theme);
  T('每条都填满 key/base/render/theme 四列', REG.length > 0 && badCols.length === 0,
    '缺列条目 ' + JSON.stringify(badCols.map(e => (e && e.key) || '(空)')));
  T('渲染器列是真函数', REG.length > 0 && REG.every(e => typeof e.render === 'function'));
  const badField = REG.filter(e => !e.field);
  T('派生列 field 存在（状态对象存放字段）', REG.length > 0 && badField.length === 0,
    '缺 field ' + JSON.stringify(badField.map(e => e.key)));

  /* ───────── 组 2 · 登记表 ↔ KEYS 双向一致 ─────────
     正向抓「改了登记表忘了改 KEYS」，反向抓「改了 KEYS 忘了登记」。
     两个方向都是一行代码的事，但都足以让整个特性静默失效。 */
  console.log('\n── 组 2 · 登记表 ↔ KEYS 双向一致 ──');
  const missKey = REG.filter(e => !frags.includes(e.key + '[0-9]*'));
  T('正向：每个登记键前缀都在 KEYS 里（key[0-9]*）', REG.length > 0 && missKey.length === 0,
    'KEYS 缺 ' + JSON.stringify(missKey.map(e => e.key + '[0-9]*')));
  const missBase = REG.filter(e => !frags.includes(e.base + '[0-9]*'));
  T('正向：每个 base 名都在 KEYS 里（base[0-9]*）', REG.length > 0 && missBase.length === 0,
    'KEYS 缺 ' + JSON.stringify(missBase.map(e => e.base + '[0-9]*')));
  /* 反向：KEYS 里所有「npc 家族」片段（npc / kbnpc / ntrnpc …）都必须登记过 */
  const npcFrags = frags.filter(f => /^[a-z]*npc\[0-9\]\*$/.test(f)).map(f => f.replace('[0-9]*', ''));
  const registered = REG.map(e => e.key).concat(REG.map(e => e.base));
  const unreg = npcFrags.filter(n => !registered.includes(n));
  T('反向：KEYS 里每个 npc 家族片段都已登记', npcFrags.length > 0 && unreg.length === 0,
    '未登记 ' + JSON.stringify(unreg) + '（KEYS 现有 ' + JSON.stringify(npcFrags) + '）');

  /* ───────── 组 3 · 截断回归锁（本文件存在的理由） ─────────
     extractBlock(:1028) 的规则是「碰到第一个非状态行就 break」。
     未登记键一旦出现在块中间，它后面的 p 行 / next 行会一起从面板上消失，
     不报错、不告警。这一组就是那条故障的回归锁。 */
  console.log('\n── 组 3 · extractBlock 截断回归锁 ──');
  const block = ['scene: 天台', 'npc: 甲 ｜ 中立', 'kbnpc: 季临 ｜ 情敌', 'p1: 我 ｜ HP 10/10', 'next: 上前'];
  const blk = api.extractBlock ? api.extractBlock(block.join('\n')) : null;
  T('extractBlock 提取整块 5 行（end===4）', !!blk && blk.end === 4,
    '实际 end=' + (blk ? blk.end : 'null') + '（0..' + (blk ? blk.end : '?') + ' 被截断，丢失后续键行）');
  const blkBase = api.extractBlock ? api.extractBlock(['scene: 天台', 'npc: 甲 ｜ 中立', 'p1: 我 ｜ HP 10/10', 'next: 上前'].join('\n')) : null;
  T('既有行为不变：纯基础块仍提取 4 行（end===3）', !!blkBase && blkBase.end === 3,
    '实际 end=' + (blkBase ? blkBase.end : 'null'));

  /* ───────── 组 4 · 编号偏移：禁止字面量 slice ─────────
     'kbnpc2'.slice(3) === 'pc2' → +'pc2' = NaN。编号必须按「键前缀长度」取，
     不可以按基础键长度（3）写死 —— 这是本次改造最容易踩的坑。 */
  console.log('\n── 组 4 · 编号偏移 ──');
  const hit = (k) => (typeof api.extHit === 'function' ? api.extHit(k) : null);
  T("extHit('kbnpc2') 编号 === 2", !!hit('kbnpc2') && hit('kbnpc2').num === 2,
    '实际 ' + JSON.stringify(hit('kbnpc2') && hit('kbnpc2').num));
  T("extHit('ntrnpc3') 编号 === 3", !!hit('ntrnpc3') && hit('ntrnpc3').num === 3,
    '实际 ' + JSON.stringify(hit('ntrnpc3') && hit('ntrnpc3').num));
  T("extHit('kbnpc') 无编号时编号 === 1", !!hit('kbnpc') && hit('kbnpc').num === 1,
    '实际 ' + JSON.stringify(hit('kbnpc') && hit('kbnpc').num));
  T("extHit 不吃未登记前缀（'foonpc' → null）", hit('foonpc') === null,
    '实际 ' + JSON.stringify(hit('foonpc')));
  T('字面量 slice(3) 对 kbnpc2 得 NaN（禁止用字面量偏移的证据）',
    Number.isNaN(+('kbnpc2'.slice(3))), '实际 +("pc2") = ' + +('kbnpc2'.slice(3)));

  /* ───────── 组 5 · 端到端：拓展键与基础键互不覆盖 ───────── */
  console.log('\n── 组 5 · 端到端分流 ──');
  const st = api.parseState(['npc: 甲 ｜ 中立', 'npc2: 乙', 'kbnpc: 季临 ｜ 情敌', 'ntrnpc: 阿黎'].join('\n'));
  T('基础 npc 仍进 st.npcs 且编号未变（npc + npc2 → 2 张）',
    Array.isArray(st.npcs) && st.npcs.length === 2, '实际 ' + (st.npcs && st.npcs.length));
  T('kbnpc 进 st.kbnpcs，不挤占 st.npcs',
    Array.isArray(st.kbnpcs) && st.kbnpcs.length === 1, '实际 ' + (st.kbnpcs && st.kbnpcs.length));
  T('ntrnpc 进 st.ntrnpcs，不挤占 st.npcs',
    Array.isArray(st.ntrnpcs) && st.ntrnpcs.length === 1, '实际 ' + (st.ntrnpcs && st.ntrnpcs.length));
  const html = api.render(st);
  T('拓展 NPC 渲染时带专属主题 class（KB）', /\btc-kb\b/.test(html));
  T('拓展 NPC 渲染时带专属主题 class（NTR）', /\btc-ntr\b/.test(html));
  const baseOnly = api.render(api.parseState('npc: 甲 ｜ 中立'));
  T('只有基础 npc 时不带拓展主题 class（不污染既有输出）',
    !/\btc-kb\b/.test(baseOnly) && !/\btc-ntr\b/.test(baseOnly));

  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}, 0);
