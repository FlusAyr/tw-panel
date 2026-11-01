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

/* 建一个隔离的 window，把某份 panel.js 源码跑进去，拿它的 __twCard。
   要建两份：本版（工作区）+ v3.14.0（git tag），用来做真跨版本逐字节比对。 */
function makeApi(source) {
  const sb = {
    window: {},
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
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(source, sb);
  return sb.window.__twCard;
}

const api = makeApi(SRC);

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

  /* ───────── 组 6 · NTR 双向属性（v3.15.0） ───────── */
  console.log('\n── 组 6 · NTR 双向属性 ──');
  const bond = (t) => api.parseState('nb: ' + t).ntrBonds[0];
  const NORM_VER = (h) => h.replace(/[0-9]+\.[0-9]+\.[0-9]+/g, '<V>');
  const sha = (str) => require('crypto').createHash('sha256').update(str).digest('hex');

  const d1 = bond('莉娅 | 爱 62 | 恋 28 | 调 34/12 | 屈 41/55 | 淫 58');
  T('调 34/12 → train=34 且 trainYou=12',
    d1.train === 34 && d1.trainYou === 12, '实际 train=' + d1.train + ' trainYou=' + d1.trainYou);
  T('屈 41/55 → submit=41 且 submitYou=55',
    d1.submit === 41 && d1.submitYou === 55, '实际 submit=' + d1.submit + ' submitYou=' + d1.submitYou);

  const d2 = bond('莉娅 | 爱 62 | 调 34');
  T('旧卡单值 调 34 → trainYou 必须是 null（不是 34，不许用另一侧顶替）',
    d2.train === 34 && d2.trainYou === null, '实际 trainYou=' + JSON.stringify(d2.trainYou));
  T('旧卡单值 屈 41 → submitYou === null',
    bond('莉娅 | 屈 41').submitYou === null, '实际 ' + JSON.stringify(bond('莉娅 | 屈 41').submitYou));

  /* 口径：解析按「值的形态」收，不按字段名 —— 未知字段也必须认 */
  const gx = bond('莉娅 | 爱 62 | 亲 30/70 | 怒 15');
  T('未知字段 亲 30/70 → 收进 extra（a=30, b=70）',
    gx.extra.length === 2 && gx.extra[0].label === '亲' && gx.extra[0].a === 30 && gx.extra[0].b === 70,
    '实际 ' + JSON.stringify(gx.extra));
  T('未知字段单值 怒 15 → a=15 且 b=null',
    gx.extra[1].label === '怒' && gx.extra[1].a === 15 && gx.extra[1].b === null,
    '实际 ' + JSON.stringify(gx.extra[1]));
  const gxHtml = api.render(api.parseState('nb: 莉娅 | 爱 62 | 亲 30/70 | 怒 15'));
  /* B 值不再靠 opacity 变淡（缩略下会整个消失），改为独立标签 em + 换色；判据钉在结构上 */
  T('未知字段渲染：双值同格（亲 30/70 一根双层条），单值一根（怒）',
    /<span>亲<\/span>/.test(gxHtml) && !/<span>亲你<\/span>/.test(gxHtml) &&
    /30<i>\/<\/i><em>70<\/em>/.test(gxHtml) && /tc-bbar two/.test(gxHtml) &&
    /<span>怒<\/span>/.test(gxHtml) && !/<span>怒你<\/span>/.test(gxHtml));

  const takenHtml = api.render(api.parseState('nb: 莉娅 | 爱 62 | 恋 28 | 敌 70 | 调 34/12 | 屈 41/55 | 淫 58 | 位 被夺'));
  /* 骨架已按「谁在动」拆分（B 的五维退成摘要行），判据改成与骨架无关：出现了「敌」就够，不要求它长在五维网格里 */
  T('位 被夺 + 敌 70 → 用「敌」，不用「恋」',
    takenHtml.includes('敌') && !takenHtml.includes('恋'),
    '敌:' + takenHtml.includes('敌') + ' 恋:' + takenHtml.includes('恋'));
  T('位 被夺 → 沦陷环用「敌 70」而不是「恋 28」（(70+34+41+58)/4 = 51）',
    takenHtml.indexOf('>51<') > 0, '环值命中 51: ' + (takenHtml.indexOf('>51<') > 0));

  const stealHtml = api.render(api.parseState('nb: 莉娅 | 爱 62 | 恋 28 | 敌 70 | 位 夺取'));
  T('位 夺取 → 用「恋」，不用「敌」（另一个字段整条忽略）',
    stealHtml.includes('恋') && !stealHtml.includes('敌'),
    '恋:' + stealHtml.includes('恋') + ' 敌:' + stealHtml.includes('敌'));
  T('位 徽章按位着色（夺取 → r-s，被夺 → r-t）',
    /tc-role r-s/.test(stealHtml) && /tc-role r-t/.test(takenHtml));

  const badRole = bond('莉娅 | 爱 62 | 位 乱写');
  T('非法 位 值 → 按受害处理（role=受害），但原文保留（roleRaw=乱写，让人看得见写错）',
    badRole.role === '受害' && badRole.roleRaw === '乱写',
    '实际 role=' + badRole.role + ' roleRaw=' + JSON.stringify(badRole.roleRaw));
  T('非法 位 值 → 徽章渲染原文（不静默改正）',
    api.render(api.parseState('nb: 莉娅 | 爱 62 | 位 乱写')).indexOf('位 乱写') > 0);

  T('癖 40 → kink=40；癖 150 → 夹到 100；无 癖 → null',
    bond('莉娅 | 爱 62 | 癖 40').kink === 40 &&
    bond('莉娅 | 爱 62 | 癖 150').kink === 100 &&
    bond('莉娅 | 爱 62').kink === null,
    '实际 ' + bond('莉娅 | 爱 62 | 癖 40').kink + '/' + bond('莉娅 | 爱 62 | 癖 150').kink + '/' + JSON.stringify(bond('莉娅 | 爱 62').kink));
  T('癖 渲染走独立容器（.tc-nb-kink），不混进五维条',
    /tc-nb-kink/.test(api.render(api.parseState('nb: 莉娅 | 爱 62 | 癖 40'))) &&
    !/tc-nb-kink/.test(api.render(api.parseState('nb: 莉娅 | 爱 62'))));

  T('回撤环：只有「爱」时不画（不凭空造玩家没填过的环）',
    api.render(api.parseState('nb: 莉娅 | 爱 62')).indexOf('回撤') < 0);
  T('回撤环：爱 + 调你 两个值就画',
    api.render(api.parseState('nb: 莉娅 | 爱 62 | 调 34/12')).indexOf('回撤') > 0);

  /* 世界书是可选件：完全没有 nb 行的状态块，面板必须照常渲染主角面板 */
  const NO_NB = ['scene: 广场', 'p1: 甲 ｜ 力量 100 ｜ HP 100/100', 'next: 继续'].join('\n');
  let noNbHtml = '', noNbErr = '';
  try { noNbHtml = api.render(api.parseState(NO_NB)); } catch (e) { noNbErr = String(e && e.message); }
  T('无 nb 行（未装 NTR 世界书）→ 不抛异常', noNbErr === '', '实际异常: ' + noNbErr);
  T('无 nb 行 → 主角面板照常渲染（tc-wrap + 主角甲都在）',
    /tc-wrap/.test(noNbHtml) && noNbHtml.indexOf('甲') > 0,
    '长度 ' + noNbHtml.length);
  T('无 nb 行 → 不留伴侣卡空壳（不出现 tc-nb 卡）',
    !/class="tc-nb /.test(noNbHtml));

  /* 旧卡逐字节回归锁。两层：
     (a) 下面这组 GOLD 常量是快照 —— 挡住「本版以后谁手贱改了旧卡渲染」；
     (b) 再下面那组跨版本比对 —— 拿 git tag v3.14.0 里的 panel.js 现场渲染同样 4 张卡，
         和本版逐字节对。基线钉 tag 而不是 HEAD：HEAD 一提交就等于本版，比出来是自指。
         tag 按项目规则永久不覆盖，所以这条锁不会随时间失效。
     v3.15.0 样式批把两个环的标签从「沦陷/回撤」改成「↑ 沦陷 / ↓ 回撤」（用户要求看得出涨/回），
     带环的旧卡字节因此变化 —— 差异只在那一个 <text>，把环标签整段归一后与改动前逐字节相同。 */
  const GOLD = {
    'nb: 莉娅 | 爱 62 | 恋 28 | 调 34 | 屈 41 | 淫 58 | 防线 2/5 界限 | 期 3 摇摆 | 迹 3': 'a5d72d05b90db7a3ab14c5a9b24d76facd6f68607d71955734c8dae67512d0e6',
    'nb: 沈栀 | 爱 20': '767bab0befdb0c4622dc174643715f4f5a9a81e3972035c43bca17605b0ec9dc',
    'nb: 苏晚 | 爱 88 | 恋 5 | 调 90 | 屈 95 | 淫 100（压 60） | 防线 5/5 名分 | 期 5 定局 | 迹 9': '8a9ab5caa910305ed5d176e6a6b70c610d0c4f71803985318392ecfd2c8eb759',
    'nb: 阿绫 | 恋 10 | 淫 40': '315cd2d5290047b9b20e0b6d09d2dd669680d427d0bfa2e56dc4c115af38911b'
  };
  for (const card of Object.keys(GOLD)) {
    const got = sha(NORM_VER(api.render(api.parseState(card))));
    T('旧卡渲染快照锁：' + card.slice(3, 18), got === GOLD[card],
      '期望 ' + GOLD[card].slice(0, 16) + ' 实际 ' + got.slice(0, 16));
  }

  /* 真·跨版本锁：v3.14.0 tag 里的 panel.js 现场渲染，和本版逐字节比。
     不设跳过开关：拿不到 tag 就是失败 —— 这条是本项目最硬的回归判据，能被静默跳过就等于没有。 */
  let base = null, baseErr = '';
  try {
    base = require('child_process').execFileSync('git', ['show', 'v3.14.0:panel.js'], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1 << 26
    });
  } catch (e) { baseErr = String((e && e.stderr) || (e && e.message) || e).slice(0, 200); }
  T('能取到基线源码（git show v3.14.0:panel.js）', typeof base === 'string' && base.length > 1000,
    '取不到：' + baseErr + '　← 浅克隆（git clone --depth=1）里没有 tag，'
      + '先跑 git fetch --tags 再重试；这不是可以跳过的项，取不到基线就是失败。');
  if (typeof base === 'string' && base.length > 1000) {
    const oldApi = makeApi(base);
    T('基线源码自身可运行且暴露 __twCard', !!(oldApi && typeof oldApi.render === 'function'));
    if (oldApi && typeof oldApi.render === 'function') {
      /* v3.15.0 起两个环多了一行「↑ 沦陷 / ↓ 回撤」标签（用户要求看得出涨/回）。
         这是本版唯一被允许的旧卡渲染差异，所以把它归一掉再比 —— 剩下的必须一个字节都不差。
         归一规则写死在这里，不引用任何仓库外脚本：删掉/改动环标签以外的任何东西，这条就会红。 */
      const NORM_RING = (h) => h.replace(/<text[^>]*>(?:[↑↓]\s*)?(沦陷|回撤)<\/text>/g, '<RING>');
      const cards = Object.keys(GOLD);
      const hardDiff = [], rawDiff = [], ringCards = [];
      for (const card of cards) {
        const cur = api.render(api.parseState(card));
        const old = oldApi.render(oldApi.parseState(card));
        if (NORM_VER(cur) !== NORM_VER(old)) rawDiff.push(card.slice(3, 12));
        if (NORM_RING(cur) !== cur) ringCards.push(card.slice(3, 12));
        const a = NORM_RING(NORM_VER(cur));
        const b = NORM_RING(NORM_VER(old));
        if (a !== b) hardDiff.push(card.slice(3, 12) + '（本版 ' + a.length + 'B / v3.14.0 ' + b.length + 'B）');
      }
      T('旧卡渲染与 v3.14.0 逐字节相同（归一掉环标签后，' + cards.length + ' 张）', hardDiff.length === 0,
        '归一后仍不同的：' + hardDiff.join('；'));
      T('旧卡与 v3.14.0 的 raw 差异只出现在带环的卡上（' + ringCards.length + ' 张）',
        rawDiff.length === ringCards.length && rawDiff.every((n) => ringCards.indexOf(n) >= 0),
        'raw 有差异：' + JSON.stringify(rawDiff) + ' / 带环：' + JSON.stringify(ringCards));
    }
  }

  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}, 0);
