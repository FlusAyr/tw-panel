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
   要建两份：本版（工作区）+ 基线 tag，用来做真跨版本逐字节比对。
   基线钉 tag 不钉 HEAD：提交后 HEAD 就等于本版，比对会退化成自指（v3.16 定下的规则）。 */
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
const BASELINE = 'v3.25.0';   // 跨版本锁的基线 tag：必须是不再变的东西

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
    base = require('child_process').execFileSync('git', ['show', BASELINE + ':panel.js'], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1 << 26
    });
  } catch (e) { baseErr = String((e && e.stderr) || (e && e.message) || e).slice(0, 200); }
  T('能取到基线源码（git show ' + BASELINE + ':panel.js）', typeof base === 'string' && base.length > 1000,
    '取不到：' + baseErr + '　← 浅克隆（git clone --depth=1）里没有 tag，'
      + '先跑 git fetch --tags 再重试；这不是可以跳过的项，取不到基线就是失败。');
  if (typeof base === 'string' && base.length > 1000) {
    const oldApi = makeApi(base);
    T('基线源码自身可运行且暴露 __twCard', !!(oldApi && typeof oldApi.render === 'function'));
    if (oldApi && typeof oldApi.render === 'function') {
      /* v3.15.0 起两个环多了一行「↑ 沦陷 / ↓ 回撤」标签（用户要求看得出涨/回）。
         这是本版唯一被允许的旧卡渲染差异，所以把它归一掉再比 —— 剩下的必须一个字节都不差。
         归一规则写死在这里，不引用任何仓库外脚本：删掉/改动环标签以外的任何东西，这条就会红。 */
      /* 基线是 v3.16.0：它的环标签已经带 ↑/↓ 箭头，与本版同形，所以**不需要任何归一**。
         只归一版本号字符串（版本号本来就该变）。归一越多，锁越松 —— 能逐字节就别归一。 */
      const cards = Object.keys(GOLD);
      const hardDiff = [];
      for (const card of cards) {
        const cur = NORM_VER(api.render(api.parseState(card)));
        const old = NORM_VER(oldApi.render(oldApi.parseState(card)));
        if (cur !== old) hardDiff.push(card.slice(3, 12) + '（本版 ' + cur.length + 'B / ' + BASELINE + ' ' + old.length + 'B）');
      }
      T('旧卡渲染与 ' + BASELINE + ' 逐字节相同（仅归一版本号，' + cards.length + ' 张）', hardDiff.length === 0,
        '不同的：' + hardDiff.join('；'));
    }
  }

  /* ══════════════ 组 7 · 机甲 kbm ══════════════ */
  console.log('\n── 组 7 · 机甲 kbm ──');

  const KBM_FULL = [
    'scene: 深夜·机库',
    'p1: 你 | HP 92/100 | SP 30/50',
    'kbm1: 猎隼 | 型 全包 | HP 120/150 | 能 80/100 | SP 45/60 | 力 62 | 敏 45 | 体 58 | 装 链锯剑 ｜ 护盾发生器 ｜ 推进器',
    'next: 继续',
  ].join('\n');

  const stK = api.parseState(KBM_FULL);
  const mk = stK.mechas || [];          // KEYS 里没登记 kbm 时这里是 undefined：要判红，不是崩
  T('kbm 行被解析出 1 台机甲', mk.length === 1, '实际 ' + mk.length + '（undefined=KEYS 没登记 kbm）');
  const m1 = mk[0] || {};
  T('名称取第一个位置值（无字段名）', m1.name === '猎隼', '实际 ' + JSON.stringify(m1.name));
  T('型 解析出原文与主题类', m1.typeRaw === '全包' && m1.type === 'full',
    'typeRaw=' + JSON.stringify(m1.typeRaw) + ' type=' + JSON.stringify(m1.type));
  T('HP 当前/上限', m1.hp && m1.hp.cur === 120 && m1.hp.max === 150, JSON.stringify(m1.hp));
  T('能 当前/上限', m1.en && m1.en.cur === 80 && m1.en.max === 100, JSON.stringify(m1.en));
  T('SP 当前/上限（机甲自己的槽）', m1.sp && m1.sp.cur === 45 && m1.sp.max === 60, JSON.stringify(m1.sp));
  const at1 = m1.attrs || [];
  T('六项属性任写几项都能取到（本例 3 项）', at1.length === 3 &&
    at1.map((a) => a.k).join('') === '力敏体' && at1[0].v === 62, JSON.stringify(at1));
  const eq1 = m1.equip || [];
  T('装 按全角 ｜ 切出 3 段', eq1.length === 3 && eq1[0] === '链锯剑' && eq1[2] === '推进器',
    JSON.stringify(eq1));

  const hK = api.render(stK);
  T('机甲卡被渲染（含 tc-kbm）', hK.indexOf('class="tc-kbm') >= 0);
  T('机甲卡挂在同号 p1 卡之后', hK.indexOf(m1.name) > hK.indexOf('92/100'),
    'p1 卡片指纹 idx=' + hK.indexOf('92/100') + ' / 机甲 idx=' + hK.indexOf(m1.name));
  /* 三根读数改成分段刻度的等宽读数条（class 里多了 ticks），判据从「有几个 tc-bar」
     改成「三根读数各自在不在」——数个数会被任何一次加条改动带着跑。 */
  const gCount = ['kbm', 'kbm-en', 'kbm-sp'].filter((c) => hK.indexOf('tc-kbm-g ' + c) >= 0).length;
  T('三根读数都在：HP / 能 / SP', gCount === 3, '命中 ' + gCount + ' / 3');

  /* 无对应 p：单独成卡、不许丢 */
  const stOrphan = api.parseState(['scene: x', 'p1: 你 | HP 1/1', 'kbm3: 孤机 | HP 10/20', 'next: 继续'].join('\n'));
  const hO = api.render(stOrphan);
  T('找不到 p3 的 kbm3 单独成卡、不丢', hO.indexOf('孤机') >= 0 && (stOrphan.mechas || []).length === 1);

  /* HP 归零：已失效 + dead 类；能归零：灰，不许用红（没电≠被打烂） */
  const hDead = api.render(api.parseState(['scene: x', 'p1: 你', 'kbm1: 残骸 | HP 0/100 | 能 0/80', 'next: 继'].join('\n')));
  T('HP 归零 → dead 类 + 已失效', hDead.indexOf('tc-kbm dead') >= 0 && hDead.indexOf('已失效') >= 0);
  /* 原判据是「血条变暗红」；v3.18 把失效做成整卡降饱和 + 斜纹 + 盖章，比单根条更狠，
     所以这里改判那三件在不在（不是放宽：原来只查一根条的 class，现在查整个失效态）。 */
  T('HP 归零 → 整卡降饱和（dead）+ 斜纹 + 盖章样式',
    hDead.indexOf('tc-kbm dead') >= 0 && hDead.indexOf('tc-kbm-stamp') >= 0,
    'dead=' + (hDead.indexOf('tc-kbm dead') >= 0) + ' stamp=' + (hDead.indexOf('tc-kbm-stamp') >= 0));
  T('能归零 → 灰条 + dry 类，不用红',
    hDead.indexOf('kbm-en-dry') >= 0 && hDead.indexOf('tc-kbm-g kbm-en dry') >= 0,
    '灰条=' + (hDead.indexOf('kbm-en-dry') >= 0) + ' dry=' + (hDead.indexOf('tc-kbm-g kbm-en dry') >= 0));

  /* ── 自定字段接口：照 nb 的 o.extra 那套（同一件事不写第二遍）＋ 显式 `自` 文本段 ── */
  const stCus = api.parseState([
    'scene: x',
    'p1: 你',
    'kbm1: 猎隼 | 型 全包 | HP 120/150 | 力 62 | 核熔炉 90 | 装甲 7/10 | 装 链锯剑 ｜ 护盾发生器 ｜ 推进器 | 自 破甲 ｜ 悬浮 ｜ 夜视',
    'next: 继续',
  ].join('\n'));
  const mc = (stCus.mechas || [])[0] || {};
  T('未知 `名字 数字` 自动进自定区（核熔炉 / 装甲）',
    (mc.extra || []).length === 2 && mc.extra[0].label === '核熔炉' && mc.extra[1].label === '装甲',
    JSON.stringify(mc.extra));
  T('自定数值解析：单值 → a 有值、b 为 null；双值 → 两个都有',
    mc.extra[0].a === 90 && mc.extra[0].b === null && mc.extra[1].a === 7 && mc.extra[1].b === 10,
    JSON.stringify(mc.extra));
  T('`自` 段按全角 ｜ 切出 3 个标签', (mc.tags || []).length === 3 && mc.tags[2] === '夜视',
    JSON.stringify(mc.tags));
  const hC = api.render(stCus);
  T('自定数值渲染成条（在 tc-kbm-cus 容器里，带刻度）',
    (hC.match(/class="tc-kbm-g kbm-x x"/g) || []).length === 2 && hC.indexOf('tc-kbm-cus') >= 0,
    '条数 ' + (hC.match(/class="tc-kbm-g kbm-x x"/g) || []).length);
  T('自定文本渲染成标签（tc-kbm-tags，条不混进去）', hC.indexOf('tc-kbm-tags') >= 0 &&
    hC.indexOf('<span>破甲</span>') >= 0 && hC.indexOf('<span>夜视</span>') >= 0);
  /* 真实的一行（用户贴的原始输出）：六维只写了 `敏 82`，装备全是裸段没写 `装`。
     这一行是常态，不是边角——断言直接钉它。 */
  const stReal = api.parseState([
    'scene: x', 'p1: 你',
    'kbm1: 隐士概念机 | 型 全包 | HP 300/300 | 敏 82 | 原型折叠维生舱 | 破损空间引擎 | 纳米抢修模块',
    'next: 继',
  ].join('\n'));
  const mReal = (stReal.mechas || [])[0] || {};
  const hReal = api.render(stReal);

  T('真实行：`敏 82` 解析成 {k:敏, v:82}',
    (mReal.attrs || []).length === 1 && mReal.attrs[0].k === '敏' && mReal.attrs[0].v === 82,
    JSON.stringify(mReal.attrs));
  T('真实行：三个裸段全进 tags（不丢）',
    (mReal.tags || []).length === 3 && mReal.tags[2] === '纳米抢修模块',
    JSON.stringify(mReal.tags));

  /* ① `敏82` 粘在一起会被读成字段名。标签与数值之间必须有空白字符——
     只靠 CSS margin 不够：视觉分开了，textContent、复制、朗读仍是粘的。 */
  const attrBox = (hReal.match(/<div class="tc-kbm-attrs">[\s\S]*?<\/div>/) || [''])[0];
  const attrTexts = (attrBox.match(/<span[^>]*>[\s\S]*?<\/span>/g) || [])
    .map((x) => x.replace(/<[^>]*>/g, ''));
  const valTexts = attrTexts.filter((x) => !/—/.test(x));
  T('读数形态是「名字 + 空白 + 数字」（不许出现 敏82 无空格形态）',
    valTexts.length === 1 && /^[力敏体智感魅]\s+\d+$/.test(valTexts[0]),
    '实际：' + JSON.stringify(attrTexts));
  /* ② 缺项必须显示成缺：力/敏/体 三项固定顺序，缺的写 `—`。
     「没有」和「丢了」在画面上必须能分开——否则读者只能靠肉眼怀疑"属性是不是掉了"。 */
  T('② 只有 `敏 82` 时：力/敏/体 三项按固定顺序出现，缺的两项是 `—`',
    attrTexts.length === 3 && attrTexts[0] === '力 —' && attrTexts[1] === '敏 82' && attrTexts[2] === '体 —',
    '实际：' + JSON.stringify(attrTexts));
  T('② 占位项在 DOM 里带 .miss（与真数值区分，样式上更暗）',
    (attrBox.match(/<span class="miss">/g) || []).length === 2 &&
    /\.tc-kbm-attrs \.miss b\{/.test(SRC.replace(/\r/g, '')));
  const stFull3 = api.parseState(['scene: x', 'p1: 你',
    'kbm1: 甲 | 力 62 | 敏 45 | 体 58', 'next: 继'].join('\n'));
  const hFull3 = api.render(stFull3);
  const full3Texts = ((hFull3.match(/<div class="tc-kbm-attrs">[\s\S]*?<\/div>/) || [''])[0]
    .match(/<span[^>]*>[\s\S]*?<\/span>/g) || []).map((x) => x.replace(/<[^>]*>/g, ''));
  T('② 三项齐全时不出现占位符（力 62 / 敏 45 / 体 58 原样）',
    full3Texts.length === 3 && full3Texts.join('|') === '力 62|敏 45|体 58',
    '实际：' + JSON.stringify(full3Texts));
  T('② 智/感/魅 不占位：没写就不出现，写了才追加在后面',
    api.parseState(['scene: x', 'p1: 你', 'kbm1: 甲 | 敏 45', 'next: 继'].join('\n')).mechas[0].attrs.length === 1 &&
    ((hFull3.match(/智/g) || []).length === 0));

  /* `型` 关键字被省略 = 常态（AI 写了「全包」不写「型 全包」）。认不出来的后果是徽章不显示、
     型相关样式全退化，但它不会报错——所以必须由断言盯着。 */
  const stNoType = api.parseState(['scene: x', 'p1: 你',
    'kbm1: 隐士概念机 | 全包 | HP 300/300 | 敏 82 | 装 原型折叠维生舱 ｜ 破损空间引擎', 'next: 继'].join('\n'));
  const mNoType = (stNoType.mechas || [])[0] || {};
  T('① 裸段 `全包`（无「型」关键字）→ type=full、tags 里没有「全包」',
    mNoType.type === 'full' && mNoType.typeRaw === '全包' && (mNoType.tags || []).indexOf('全包') < 0,
    'type=' + JSON.stringify(mNoType.type) + ' tags=' + JSON.stringify(mNoType.tags));
  const stTyped = api.parseState(['scene: x', 'p1: 你',
    'kbm1: 隐士概念机 | 型 全包 | HP 300/300 | 敏 82', 'next: 继'].join('\n'));
  const mTyped = (stTyped.mechas || [])[0] || {};
  T('① `型 全包`（有关键字）行为不变：type=full、tags 空',
    mTyped.type === 'full' && mTyped.typeRaw === '全包' && (mTyped.tags || []).length === 0,
    'type=' + JSON.stringify(mTyped.type) + ' tags=' + JSON.stringify(mTyped.tags));
  const stBoth = api.parseState(['scene: x', 'p1: 你',
    'kbm1: 隐士概念机 | 型 重装 | 全包 | HP 300/300', 'next: 继'].join('\n'));
  const mBoth = (stBoth.mechas || [])[0] || {};
  T('① 两个都写 → 关键字优先 type=heavy，「全包」留在 tags 不覆盖',
    mBoth.type === 'heavy' && (mBoth.tags || []).indexOf('全包') >= 0,
    'type=' + JSON.stringify(mBoth.type) + ' tags=' + JSON.stringify(mBoth.tags));
  const stInEq = api.parseState(['scene: x', 'p1: 你',
    'kbm1: 甲 | 装 链锯剑 ｜ 全包', 'next: 继'].join('\n'));
  const mInEq = (stInEq.mechas || [])[0] || {};
  T('① `装` 之后的裸段 `全包` 仍是装备，不被改判成型',
    mInEq.type === '' && (mInEq.equip || []).indexOf('全包') >= 0,
    'type=' + JSON.stringify(mInEq.type) + ' equip=' + JSON.stringify(mInEq.equip));
  T('六维：符号弱化色 + 数值等宽加粗（间距 ≥3px，另有空白字符）',
    /\.tc-kbm-attrs i\{[^}]*margin-right:3px/.test(SRC.replace(/\r/g, '')) &&
    /\.tc-kbm-attrs b\{[^}]*ui-monospace/.test(SRC.replace(/\r/g, '')));

  /* ② 裸段是「AI 没写装前缀」的常态，必须有读得出的容器与弱标题，且绝不进插槽 */
  const tagBox = (hReal.match(/<div class="tc-kbm-tags">[\s\S]*?<\/div>/) || [''])[0];
  T('裸段渲染在 tc-kbm-tags 内（三个都在）',
    tagBox.indexOf('原型折叠维生舱') >= 0 && tagBox.indexOf('破损空间引擎') >= 0 &&
    tagBox.indexOf('纳米抢修模块') >= 0,
    '片段长度 ' + tagBox.length);
  T('裸段绝不出现在 tc-kbm-eq 内（进了插槽会被读成可拆卸武器）',
    (hReal.match(/<div class="tc-kbm-eq">[\s\S]*?<\/div>/) || [''])[0].indexOf('维生舱') < 0);
  T('裸段有独立弱标题「其他」（不只当脚注）',
    /<em class="tc-kbm-tagl">其他<\/em>/.test(tagBox), tagBox.slice(0, 80));

  /* ③ `en`/`sp` 缺失就不画：画一根 0 的条会读成「有电但没电」，比不画更误导 */
  T('en/sp 为 null 时不画那两根条（真实行里只有 HP 一根）',
    mReal.en === null && mReal.sp === null &&
    hReal.indexOf('class="tc-kbm-g kbm-en') < 0 && hReal.indexOf('class="tc-kbm-g kbm-sp') < 0);

  /* 两者必须视觉可分：标签不许出现在数值容器里，反之亦然 */
  const cusBox = (hC.match(/<div class="tc-kbm-cus">[\s\S]*?<\/div>\s*(?=<div class="tc-kbm-tags">|<div class="tc-kbm-eq">|<em class="tc-kbm-stamp">|$)/) || [''])[0];
  T('数值自定与文本自定在两个容器里（标签不出现在 tc-kbm-cus 内）',
    cusBox.indexOf('tc-kbm-tags') < 0 && cusBox.indexOf('破甲') < 0,
    'cus 片段长度 ' + cusBox.length);
  /* 坏格不许猜数值：`散热 90/100/次` 进文本标签、原文保留、不画条 */
  const stBadCus = api.parseState(['scene: x', 'p1: 你', 'kbm1: 试验机 | 散热 90/100/次', 'next: 继'].join('\n'));
  const mbc = (stBadCus.mechas || [])[0] || {};
  T('坏格 `90/100/次` 不猜数值，原文进文本标签',
    (mbc.extra || []).length === 0 && (mbc.tags || []).indexOf('散热 90/100/次') >= 0,
    'extra=' + JSON.stringify(mbc.extra) + ' tags=' + JSON.stringify(mbc.tags));

  /* ── 前缀吃字段（真 bug，v3.18 现场抓到）──
     `装` 的关键字正则原本是 `^装[:：]?\s*(.*)$`，冒号可选 → `装甲 7/10` 被当成装备槽，
     equip 里躺一个「甲 7/10」，数值条永远画不出来。同型的还有 `能`（能力）、`型`（型号）、
     `自`（自由）。修法是关键字后必须跟「冒号 / 空白 / 行尾」。下面三条把它们钉住。 */
  const stPfx = api.parseState([
    'scene: x', 'p1: 你',
    'kbm1: 试制 | 装甲 7/10 | 能力 30 | 自由 20 | 型号 甲',
    'next: 继',
  ].join('\n'));
  const mp = (stPfx.mechas || [])[0] || {};
  T('`装甲 7/10` 不被 `装` 吃掉（进自定数值，不进装备槽）',
    (mp.equip || []).indexOf('甲 7/10') < 0 && (mp.extra || []).some((e) => e.label === '装甲' && e.a === 7 && e.b === 10),
    'equip=' + JSON.stringify(mp.equip) + ' extra=' + JSON.stringify(mp.extra));
  T('`能力 30` / `自由 20` 不被 `能` / `自` 吃掉（都进自定数值）',
    (mp.extra || []).some((e) => e.label === '能力' && e.a === 30) &&
    (mp.extra || []).some((e) => e.label === '自由' && e.a === 20),
    JSON.stringify(mp.extra));
  T('`型号 甲` 不被 `型` 吃掉（进文本标签，不当机型）',
    mp.typeRaw === '' && (mp.tags || []).indexOf('型号 甲') >= 0,
    'typeRaw=' + JSON.stringify(mp.typeRaw) + ' tags=' + JSON.stringify(mp.tags));

  /* 数值格严格：第二段非纯数字就整格丢，不取前半截（显示错值比不显示危险） */
  const stBad = api.parseState([
    'scene: x', 'p1: 你',
    'kbm1: 坏格机 | HP 120/150 | 能 80/100/次 | SP 80/abc',
    'next: 继',
  ].join('\n'));
  const mBad = (stBad.mechas || [])[0] || {};
  T('能 80/100/次 → 整格丢（不是取 80）', mBad.en === null, JSON.stringify(mBad.en));
  T('SP 80/abc → 整格丢（不是取 80）', mBad.sp === null, JSON.stringify(mBad.sp));
  T('同一行的合法格不受影响（HP 120/150 仍解析）', mBad.hp && mBad.hp.cur === 120 && mBad.hp.max === 150,
    JSON.stringify(mBad.hp));
  const hBad = api.render(stBad);
  T('坏格不画条、也不显示 80 这个数', !/能<\/span><b>80/.test(hBad.replace(/\s/g, '')),
    '渲染里出现了 "能 80"');
  const stHalf = api.parseState(['scene: x', 'p1: 你', 'kbm1: 半格机 | 能 80', 'next: 继'].join('\n'));
  const mHalf = (stHalf.mechas || [])[0] || {};
  T('能 80（只给当前值）→ 上限为空、当前值保留', mHalf.en && mHalf.en.cur === 80 && mHalf.en.max === null,
    JSON.stringify(mHalf.en));

  /* ── console.warn 白名单 ──
     门禁从「计数为 0」放宽成「白名单外为 0」。放宽只针对「坏数据被静默丢弃」这一类：
     原禁令针对「未登记键」——给它加 warn 会让它看起来已被处理，把可见变静默。
     两者方向相反：一个把静默变可见，一个把可见变静默。
     判据：这条 warn 出现时，玩家看到的是「少了一块」还是「正常画面」？少一块 → 允许。
     白名单必须带 [tw-card] kbm 前缀，且格式固定的 console.warn('字符串', …)。 */
const WARN_WHITELIST = [/^\s*console\.warn\('\[tw-card\] kbm /];
T('console.warn/error 白名单长度恰为 1（改名单要一起改这条）', WARN_WHITELIST.length === 1);
const warnLines = SRC.split('\n')
  .filter((ln) => /console\.(warn|error)\s*\(/.test(ln))
  .map((ln) => ln.trim());
T('console.warn/error 除白名单外为 0（实测 ' + warnLines.length + ' 处）',
  warnLines.length === WARN_WHITELIST.length &&
  warnLines.every((ln) => WARN_WHITELIST.some((re) => re.test(ln))),
  '白名单外的：' + JSON.stringify(warnLines.filter((ln) => !WARN_WHITELIST.some((re) => re.test(ln)))));

  /* 无 kbm 行：不许留空壳 */
  T('无 kbm 行 → 没有 tc-kbm 节点',
    api.render(api.parseState('scene: x\np1: 你 | HP 92/100')).indexOf('tc-kbm') < 0);

  /* ── 归属关系（v3.18.1）：有同号 p 才有「驾驶中」与竖线，没主不画 ── */
  const pairedHtml = api.render(api.parseState(
    'scene: x\np1: 你 | HP 92/100\nkbm1: 猎隼 | 型 全包 | HP 120/150'));
  T('有同号 p → 机甲卡带 paired 类', /class="tc-kbm[^"]*\bpaired\b/.test(pairedHtml),
    '渲染里没有 paired：' + (pairedHtml.match(/class="tc-kbm[^"]*"/) || ['<无>'])[0]);
  T('有同号 p → 出现「◤ 驾驶中」带子', pairedHtml.indexOf('tc-kbm-drive') > 0 && pairedHtml.indexOf('驾驶中') > 0);
  /* 几何也要断言：向上 12px 才盖得住玩家卡被 clip-path 切掉的左下角缺口，
     宽度 5px 才吃得下两卡边框之间那 1~2px 的错位。 */
  const tieRule = (SRC.replace(/\r/g, '').match(/\.tc-kbm\.paired::before\{[^}]*\}/) || [''])[0];
  T('竖线规则存在且长在未裁切的外层（.tc-kbm.paired::before）',
    /position:absolute/.test(tieRule), '实际：' + tieRule);
  T('竖线向上 ≥12px（盖住玩家卡左下切角缺口）',
    /top:-1[2-9]px|top:-[2-9]\dpx/.test(tieRule), '实际：' + tieRule);
  T('竖线宽度 ≥5px（容忍两卡边框的亚像素错位）',
    /width:[5-9]px|width:\d{2}px/.test(tieRule), '实际：' + tieRule);
  const orphanHtml = api.render(api.parseState(
    'scene: x\np1: 你 | HP 92/100\nkbm2: 孤儿机 | 型 重装 | HP 90/100'));
  T('无同号 p → 机甲卡照样渲染', orphanHtml.indexOf('tc-kbm') > 0);
  T('无同号 p → 不画 paired、不画驾驶中带子（没主就没有归属关系）',
    !/\bpaired\b/.test((orphanHtml.match(/class="tc-kbm[^"]*"/) || [''])[0]) &&
    orphanHtml.indexOf('tc-kbm-drive') < 0 && orphanHtml.indexOf('驾驶中') < 0,
    '孤儿机甲被错误标成有主');

  /* ── 型徽章（v3.18.1）：跟名字一起被读，字号 ≥12、padding ≥4px 10px ── */
  const typeRule = (SRC.replace(/\r/g, '').match(/\n\.tc-kbm-type\{([^}]*)\}/) || [])[1] || '';
  T('型徽章字号 ≥ 12px', /font-size:1[2-9]px|font-size:[2-9]\dpx/.test(typeRule), '实际：' + typeRule.trim());
  T('型徽章 padding ≥ 4px 10px', /padding:([4-9]|\d{2,})px ([1-9]\d{1,}|1[0-9])px/.test(typeRule), '实际：' + typeRule.trim());
  T('型徽章不再靠 margin-left:auto 飘到角落', typeRule.indexOf('margin-left:auto') < 0, '实际：' + typeRule.trim());
  T('徽章在 DOM 里紧邻机甲名（同一行 header 内、名字之后）',
    /<b>[^<]*<\/b>\s*<span class="tc-kbm-type/.test(pairedHtml));


  /* 测试口径备注（v3.20 立）：
      测「状态块被截断」这件事必须走 extractBlock，不能用 render(parseState(t)) ——
      render 那条链路整条绕开 extractBlock，两边都会「通过」。
      同理：别把 p1: 写在 scene: 同一行（输入本身不合法），也别给 extractBlock 传数组
      （它内部 text.split，报 text.split is not a function）。
     「两边都通过」不等于没问题，可能只是没走到那条路上。 */

  /* ── 键表边界锁（v3.19.1）：一条断言同时守住被删片段的两侧 ──
     来源：自造样例（为一个具体事故而写：删 `|kbf[0-9]*|` 时把两侧竖线一起吃掉了，
     KEYS 变成 `kbm[0-9]*pts[0-9]+`，pts 与 kbm 一起失效）。KEYS 是一行全是分隔符的
     正则拼串，删任何一个片段都最容易伤到边界——而伤害方式是「少显示一个东西」，
     不红就没人看得见。 */
  const sideSt = api.parseState('p1: 你 | HP 92/100\npts1: 力量 5 | 敏捷 3\nkbm1: 猎隼 | 型 全包 | HP 120/150');
  T('pts1 与 kbm1 同时在场：pts 一侧仍解析出来',
    !!(sideSt.players[0] && sideSt.players[0].ptsRow),
    '实际 ' + JSON.stringify(sideSt.players[0] && sideSt.players[0].ptsRow));
  T('pts1 与 kbm1 同时在场：kbm 一侧仍解析出来',
    (sideSt.mechas || []).length === 1, '实际 ' + (sideSt.mechas || []).length);



  /* ══════════ 组 9 · dmg 伤害事件行（v3.20） ══════════
     来源：自造样例（为覆盖 dmg 的六段解析、七种性质、六种判定、数值校验与截断而写，
     不是用户实测原文）。第一条的字段顺序与分隔符取自任务卡里的契约示例。
     判据分层：
       a) 解析层 —— 六段都要落位，`算` 必须原样保留（渲染器重算一遍就是第二个事实来源）
       b) 校验层 —— 伤 与 血 的差值对不上时必须可见，不能悄悄取一个
       c) 渲染层 —— 方向 / 量级 / 性质七色 / 判定形态 / 血条前→后 / 多行顺序
       d) 边界层 —— dmg 后面还有 p 行时必须保住（KEYS 漏登记的伤害方式正是「截断」） */

  const DMG_LINE = 'dmg1: 甲→乙 | 因 链锯剑·横扫 | 算 1D8+2 +4 +20% −3 | 伤 撕裂·左臂 ·12 | 血 84→72 | 判 命中';
  const dSt = api.parseState(DMG_LINE);
  const dx = (dSt.dmgs || [])[0] || {};

  T('dmg 行被解析出 1 条（KEYS 已登记 dmg[0-9]*）', (dSt.dmgs || []).length === 1,
    '实际 ' + (dSt.dmgs || []).length + '；KEYS 含 dmg：' + /(^|\|)dmg\[0-9\]\*(\||$)/.test(readKeysString()));
  T('甲→乙 方向解析成 from / to', dx.from === '甲' && dx.to === '乙', JSON.stringify([dx.from, dx.to]));
  T('因 段原样保留', dx.cause === '链锯剑·横扫', JSON.stringify(dx.cause));
  T('算 段原样保留、不计算', dx.calc === '1D8+2 +4 +20% −3', JSON.stringify(dx.calc));
  T('伤 段拆出性质 撕裂 / 部位 左臂 / 数值 12',
    dx.kindRaw === '撕裂' && dx.kind === 'r' && dx.part === '左臂' && dx.amount === 12,
    JSON.stringify([dx.kindRaw, dx.kind, dx.part, dx.amount]));
  T('血 段拆出前 84 / 后 72', dx.hpBefore === 84 && dx.hpAfter === 72, JSON.stringify([dx.hpBefore, dx.hpAfter]));
  T('判 段映射成 hit 并保留原文', dx.verdict === 'hit' && dx.verdictRaw === '命中',
    JSON.stringify([dx.verdict, dx.verdictRaw]));
  T('伤 12 与 血差 12 一致 → mismatch 为 false', dx.mismatch === false && dx.delta === 12,
    JSON.stringify([dx.mismatch, dx.delta]));

  const dHtml = api.render(dSt);
  T('dmg 卡有独立容器 tc-dmg / tc-dmgs', /class="tc-dmg /.test(dHtml) && dHtml.indexOf('tc-dmgs') > 0);
  T('方向感：from 在箭头之前、to 在箭头之后',
    dHtml.indexOf('who from') > 0 && dHtml.indexOf('who from') < dHtml.indexOf('arrow') &&
    dHtml.indexOf('arrow') < dHtml.indexOf('who to'));
  T('性质进 class（撕裂 → k-r）', dHtml.indexOf('tc-dmg k-r') > 0);
  T('血条画前→后：保留段 + 斜纹段各一个，保留段宽度 = 72/84 = 86%',
    /class="keep" style="width:86%"/.test(dHtml) && /class="gone" style="left:86%/.test(dHtml));

  /* 只断言 left 会漏掉「斜纹段没有宽度」这个 bug：那样它 left 对、宽度为 0，
     画面上等于仍然只是两个数字。宽度必须一起钉。 */
  T('斜纹段有真实宽度（left 86% → width 14%，否则「掉了多少」看不见）',
    /class="gone" style="left:86%;width:14%"/.test(dHtml),
    '实际：' + ((dHtml.match(/class="gone"[^>]*/) || [''])[0]));

  /* 校验层：对不上就要看得见。这是全卡唯一能被人肉验算的地方。 */
  const badSt = api.parseState('dmg1: 甲→乙 | 伤 撕裂 ·12 | 血 84→60 | 判 命中');
  const bad = (badSt.dmgs || [])[0] || {};
  T('伤 12 但 血差 24 → mismatch 为 true', bad.mismatch === true && bad.delta === 24,
    JSON.stringify([bad.mismatch, bad.delta]));
  T('不一致时打可见标记（不是不显示、也不是悄悄取一个）',
    api.render(badSt).indexOf('tc-dmg-warn') > 0);

  /* 名字对不上：原样显示，不丢弃 —— 这时「名字不对」本身就是玩家该看到的信息 */
  const wildSt = api.parseState('dmg1: 不存在的甲→不存在的乙 | 伤 钝击 ·5 | 血 10→5 | 判 命中');
  const wildHtml = api.render(wildSt);
  T('名字对不上 players[]/mobs[] 时原样显示',
    wildHtml.indexOf('不存在的甲') > 0 && wildHtml.indexOf('不存在的乙') > 0);

  /* 判定形态：暴击强化、闪避「空」 */
  const vSt = api.parseState([
    'dmg1: 甲→乙 | 伤 钝击·头部 ·40 | 血 100→60 | 判 暴击',
    'dmg2: 乙→甲 | 伤 穿刺·胸口 ·0 | 血 84→84 | 判 闪避',
  ].join('\n'));
  const vHtml = api.render(vSt);
  T('暴击 → v-crit（强化描边/发光）', vHtml.indexOf('v-crit') > 0);
  T('闪避 → v-dodge 且数值退让成 —',
    vHtml.indexOf('v-dodge') > 0 && /class="num">—</.test(vHtml));
  T('多行按 dmg1 → dmg2 顺序竖排（不是挤成一行）',
    vHtml.indexOf('钝击') < vHtml.indexOf('穿刺') && (vHtml.match(/class="tc-dmg /g) || []).length === 2);

  /* 量级：字号随伤害涨 —— 数值是这一块的视觉主角 */
  const sizeCss = (SRC.match(/\.tc-dmg\.s1 \.num\{[^}]*\}/) || [''])[0];
  const sizeCss2 = (SRC.match(/\.tc-dmg\.s3 \.num\{[^}]*\}/) || [''])[0];
  T('量级分档：数值字号随伤害增长（s1 与 s3 不同档）',
    !!sizeCss && !!sizeCss2 && sizeCss !== sizeCss2, sizeCss + ' / ' + sizeCss2);

  /* 七种性质各一色系：少一条就说明有人加性质时忘了配色 */
  const kinds = ['k-r', 'k-b', 'k-p', 'k-f', 'k-c', 'k-m', 'k-t'];
  T('七种性质色系齐全（撕裂/钝击/穿刺/灼烧/腐蚀/精神/真实）',
    kinds.every(x => SRC.indexOf('.tc-dmg.' + x + '{--dk:') > 0),
    '缺：' + kinds.filter(x => SRC.indexOf('.tc-dmg.' + x + '{--dk:') < 0).join(','));
  /* 七色映射表漏色：这条不是「意图」，是字符串存在性——所以能测，别留给 review。
     从源码里现解析 DMG_KINDS（不是手抄一份对照表：抄一份就等于给自己留个会腐烂的第二来源），
     逐个断言 CSS 里存在 `.tc-dmg.k-<值>{--dk:` 规则。加一个性质却忘了配色，这里会红。 */
  const kindPairs = [...SRC.matchAll(/'(.)': '(.)'/g)].length ? null : null;
  const kindsBlock = (SRC.match(/const DMG_KINDS = \{([^}]*)\}/) || [, ''])[1];
  const kindVals = [...kindsBlock.matchAll(/'([^']+)':\s*'([^']+)'/g)].map(m => ({ zh: m[1], cls: m[2] }));
  T('DMG_KINDS 解析出 7 种性质（性质表存在且条数对得上）', kindVals.length === 7,
    '实际 ' + kindVals.length + ' 种：' + JSON.stringify(kindVals.map(k => k.zh)));
  const noCss = kindVals.filter(k => SRC.indexOf('.tc-dmg.k-' + k.cls + '{--dk:') < 0);
  T('每个性质都能在 CSS 里找到对应的 .tc-dmg.k-<值>{--dk: 规则（漏色即红）',
    noCss.length === 0,
    '缺 CSS 的性质：' + JSON.stringify(noCss.map(k => k.zh + '→k-' + k.cls)));
  T('七种性质的颜色值互不相同（同一个色系两个性质 = 玩家分不出）',
    new Set(kindVals.map(k => (SRC.match(new RegExp('\\.tc-dmg\\.k-' + k.cls + '\\{--dk:(#[0-9a-fA-F]+)')) || [, ''])[1])).size === 7,
    '实际色值：' + JSON.stringify(kindVals.map(k => (SRC.match(new RegExp('\\.tc-dmg\\.k-' + k.cls + '\\{--dk:(#[0-9a-fA-F]+)')) || [, ''])[1])));

  T('未知性质不报错、落到中性色 k-x',
    api.render(api.parseState('dmg1: 甲→乙 | 伤 未知性质 ·3 | 血 10→7 | 判 命中')).indexOf('k-x') > 0);

  /* 边界层：截断锁。KEYS 里漏登记 dmg，坏的方式不是「少一个卡」而是「后面的键行全没了」。 */
  const cutSt = api.parseState([
    'dmg1: 甲→乙 | 伤 撕裂 ·5 | 血 50→45 | 判 命中',
    'p1: 甲 | HP 45/100',
    'next: 继续',
  ].join('\n'));
  T('dmg 行之后的 p 行仍被解析（截断锁）', (cutSt.players || []).length === 1,
    '实际 ' + (cutSt.players || []).length);
  T('dmg 行之后的 next 未被吃掉（截断锁）', cutSt.next === '继续', JSON.stringify(cutSt.next));

  T('无 dmg 行时不产生 tc-dmg 空壳',
    api.render(api.parseState('scene: x\\np1: 甲 | HP 9/10')).indexOf('tc-dmg') < 0);


  // ---- 算段不许被省略号/换行吃掉（窄屏那张图暴露的假象，先确认渲染器本身没截） ----
{
  const calcSrc = '算 1D8+2 +4 +20% −3';
  const stC = api.parseState('p1: 你 | 92/100\ndmg1: 甲→乙 | 因 链锯剑·横扫 | ' + calcSrc + ' | 伤 撕裂·左臂 ·12 | 血 84→72 | 判 命中\nnext: 继续');
  const wantC = stC.dmgs[0].calc;
  const htmlC = api.render(stC);
  const mC = htmlC.match(/<u>算<\/u>([\s\S]*?)<\/span>/);
  const gotC = mC ? mC[1] : '';
  T('dmg 算段解析保留原文（含 +4 +20% −3）', wantC === '1D8+2 +4 +20% −3', '实际=' + JSON.stringify(wantC));
  T('算段渲染文本 === 解析原文（长度 ' + gotC.length + '/' + wantC.length + '，不是「看起来完整」）',
    gotC === wantC, '渲染=' + JSON.stringify(gotC));
  const metaCss = (SRC.match(/\.tc-dmg-meta\{[^}]*\}/) || [''])[0];
  // 正向断言：必须是 flex-wrap:wrap。只查「不出现 nowrap」防不住「整句被删掉」——
  // 没人会故意写 nowrap，但有人会顺手删一句觉得多余的；删掉后行为退化而关键词黑名单照样绿。
  T('算段容器必须有 flex-wrap:wrap（正向要求，不是「只要没写 nowrap」）',
    /flex-wrap\s*:\s*wrap/.test(metaCss), '实际规则=' + metaCss);
  T('算段容器 CSS 不许 white-space:nowrap / text-overflow:ellipsis / overflow:hidden（黑名单，与上面那条互补）',
    metaCss.indexOf('nowrap') < 0 && metaCss.indexOf('ellipsis') < 0 && metaCss.indexOf('hidden') < 0,
    '实际规则=' + metaCss);
}
// ---- 五道防线：结构层（几何断言在浏览器探针里，vm 无布局） ----
{
  const stD = api.parseState([
    'p1: 你 | 92/100',
    'nb: 莉娅 | 位 夺取 | 爱 62 | 恋 28 | 调 34 | 屈 41 | 淫 58 | 癖 35 | 防线 2/5 称谓',
    'nd: 莉娅 | 界限 失守 4月6日 某 | 称谓 回填 12月16日 某 | 独处 在守 | 主动 失守 4月23日 某 | 归属 在守',
    'next: 继续',
  ].join('\n'));
  const htmlD = api.render(stD);
  const rowsD = htmlD.match(/class="tc-def-row /g) || [];
  T('夺取卡产出 5 个 .tc-def-row（五道防线逐格）', rowsD.length === 5, '实际=' + rowsD.length);
  T('五格文字完整：名称与状态都在（界限/称谓/独处/主动/归属 + 失守/回填/在守）',
    ['界限', '称谓', '独处', '主动', '归属', '失守', '回填', '在守'].every(w => htmlD.indexOf(w) >= 0),
    '缺字：' + ['界限', '称谓', '独处', '主动', '归属', '失守', '回填', '在守'].filter(w => htmlD.indexOf(w) < 0).join(','));
  const cssNarrow = (SRC.match(/@media \(max-width:520px\)\{([\s\S]*?)\n\}/) || [, ''])[1];

  /* ① 防线列数不是「写死的 5」，而是「必须等于 DEF_NAMES 的条数」。
     QA 指出的隐患：将来防线变 6 条，布局会挤而几何判据全绿 —— 这条把两个来源绑在一起，
     改一个不改另一个就红。 */
  const namesN = (SRC.match(/const DEF_NAMES = \[([^\]]*)\]/) || [, ''])[1]
    .split(',').map(function (x) { return x.trim(); }).filter(Boolean).length;
  const colsN = +(((cssNarrow.match(/\.tc-nb-defs\{[^}]*repeat\((\d+),\s*minmax\(0,\s*1fr\)\)/) || [, '0'])[1]) || 0);
  T('窄屏防线列数 === DEF_NAMES 条数（改一个必须改另一个）', colsN === namesN && colsN > 0,
    'CSS 列数=' + colsN + ' / DEF_NAMES=' + namesN);

  /* ② 防线数 > 布局列数时必须出现可见警告，不许静默变挤。 */
  const overTxt = ['nb: 莉娅 | 位 夺取 | 爱 62 | 恋 28 | 调 34 | 屈 41 | 淫 58 | 防线 3/6 称谓'].join('\n');
  const overHtml = api.render(api.parseState(overTxt));
  T('防线 6 道时卡上出现可见警告（不静默变挤）',
    /class="tc-defs-warn"/.test(overHtml) && /防线 6 道 > 布局 5 列/.test(overHtml),
    '片段=' + ((overHtml.match(/<em class="tc-defs-warn">[^<]*<\/em>/) || ['(无)'])[0]));
  T('防线 6 道时 .tc-nb-defs 带 over 类（边框提示）', /class="tc-nb-defs over"/.test(overHtml), '');
  T('防线 5 道时没有任何警告（正常场景零打扰）', !/tc-defs-warn/.test(htmlD) && !/tc-nb-defs over/.test(htmlD), '');

  /* ③ 几何断言的可信入口：__twCard 必须能拿到 CSS 与 injectCss。
     否则下游只能自己正则抽 `const CSS = `` `，抽不到时静默拿空串，量出来的全是默认值。 */
  T('__twCard 暴露 CSS（非空且是样式文本）', typeof api.CSS === 'string' && api.CSS.length > 1000 && /\.tc-card\{/.test(api.CSS), 'CSS 长度=' + (api.CSS || '').length);
  T('__twCard 暴露 injectCss（函数）', typeof api.injectCss === 'function', 'typeof=' + typeof api.injectCss);
  T('窄屏块存在（未匹配到 @media (max-width:520px) 就红）', cssNarrow.length > 200, '长度=' + cssNarrow.length);
  T('窄屏块的 .tc-nb-defs 是五等分（repeat(5,minmax(0,1fr))，不许 auto-fit 自己减列）',
    /\.tc-nb-defs\{[^}]*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(cssNarrow),
    '实际=' + ((cssNarrow.match(/\.tc-nb-defs\{[^}]*\}/) || ['(无)'])[0]));
  T('窄屏块让防线独占一行（basis:100% + 换行），环退第二行',
    /\.tc-nb-defs\{[^}]*flex:0 0 100%/.test(cssNarrow) && /\.tc-nb-body\{[^}]*flex-wrap:wrap/.test(cssNarrow),
    'defs=' + ((cssNarrow.match(/\.tc-nb-defs\{[^}]*\}/) || ['(无)'])[0]) + ' body=' + ((cssNarrow.match(/\.tc-nb-body\{[^}]*\}/) || ['(无)'])[0]));
  T('窄屏格内名称与状态上下两行占位（flex-wrap + em 独占一行），不并排挤成竖排',
    /\.tc-def-row\{[^}]*flex-wrap:wrap/.test(cssNarrow) && /\.tc-def-row em\{[^}]*flex:0 0 100%/.test(cssNarrow),
    '实际=' + ((cssNarrow.match(/\.tc-def-row\{[^}]*\}/) || ['(无)'])[0]));
}

  /* ══════════════ 组 10 · 使魔 kbf（v3.26.0） ══════════════
     为什么必须有这一组：kbf 在 v3.25.0 里根本没进 KEYS，而世界书一直在写它。
     按 §3.1 规则 7 的既定行为，未登记的键行「整行不解析，且 extractBlock 遇非状态行即 break」
     —— 于是它每写一次，就把它**后面所有状态行**一起吞掉（next/scene/其他键全丢）。
     所以第 1 条测的不是「使魔能不能显示」，是「它在不在 KEYS 里」。 */
  console.log('\n── 组 10 · 使魔 kbf ──');

  /* 来源：用户真实输出（2026-11-01 平台捕获，原文未改）
     —— `族兽` / `技撕咬` 都是没有分隔符的原样写法，别「顺手」补空格，补了就不测这条了。 */
  const KBF_REAL = [
    'p1: 你 | HP 92/100',
    'kbf3: 亚龙 | 族兽 | HP 105/160 | MP 0/0 | 忠 70 | 力 75 | 敏 40 | 体 80 | 技撕咬 | 结 实冲撞 | 签 已缔结',
    'next: 继续'
  ].join('\n');

  T('kbf 已登记进 KEYS（没登记 = 整行不解析且吞掉其后所有状态行）',
    /(^|\|)kbf\[0-9\]\*(\||$)/.test(KEYS), 'KEYS=' + KEYS.slice(0, 120));

  /* 必须先过 extractBlock 再看 parseState：
     parseState 对未匹配行是 `continue`，直接喂原文时 kbf 未登记也照样解析出 next ——
     那条断言会假绿。真正吞数据的是 extractBlock 的 break。 */
  const blkKbf = api.extractBlock(KBF_REAL);
  T('端到端：kbf3 没有截断状态块（extractBlock.end 覆盖到最后一行）',
    !!blkKbf && blkKbf.end === 2, 'end=' + (blkKbf && blkKbf.end) + '（期望 2）　'
      + '← 小于 2 说明 extractBlock 在 kbf 那行 break 了，其后状态行全丢');
  const stKbf = api.parseState(blkKbf ? blkKbf.body : KBF_REAL);
  const fams = stKbf.familiars || [];
  T('真实行解析出 1 只使魔，且编号取到 p 同号（idx=3）', fams.length === 1 && fams[0].idx === 3,
    'length=' + fams.length + ' idx=' + (fams[0] && fams[0].idx));
  const f0 = fams[0] || {};
  T('名称 = 亚龙', f0.name === '亚龙', '实际=' + JSON.stringify(f0.name));
  T('族 无分隔符（`族兽`）也认得出：race=beast / raceRaw=兽',
    f0.race === 'beast' && f0.raceRaw === '兽', 'race=' + f0.race + ' raw=' + JSON.stringify(f0.raceRaw));
  T('HP 105/160', !!f0.hp && f0.hp.cur === 105 && f0.hp.max === 160, JSON.stringify(f0.hp));
  T('MP 0/0（0 是值不是缺项）', !!f0.mp && f0.mp.cur === 0 && f0.mp.max === 0, JSON.stringify(f0.mp));
  T('忠 70', !!f0.loyal && f0.loyal.cur === 70, JSON.stringify(f0.loyal));
  T('属性 力75 / 敏40 / 体80（三项都在，顺序照世界书）',
    (f0.attrs || []).map(a => a.k + a.v).join(',') === '力75,敏40,体80',
    '实际=' + JSON.stringify((f0.attrs || []).map(a => a.k + a.v)));
  T('技 无分隔符（`技撕咬`）也认得出：skills=[撕咬]',
    (f0.skills || []).join(',') === '撕咬', JSON.stringify(f0.skills));
  T('规格外文本段 `结 实冲撞` 只当标签（进 tags、不进 extra、不猜数值）',
    (f0.tags || []).indexOf('结 实冲撞') >= 0 && (f0.extra || []).length === 0,
    'tags=' + JSON.stringify(f0.tags) + ' extra=' + JSON.stringify(f0.extra));
  T('签 已缔结 -> pact=on（原文保留）', f0.pact === 'on' && f0.pactRaw === '已缔结',
    'pact=' + f0.pact + ' raw=' + JSON.stringify(f0.pactRaw));

  /* 端到端：这条才是 kbf 真正的病 —— 它后面那行还在不在 */
  T('端到端：状态块里的 next 解析出来了（next 仍在）', stKbf.next === '继续',
    'next=' + JSON.stringify(stKbf.next));

  const htmlKbf = api.render(stKbf);
  T('渲染出使魔卡（tc-fam）且 HP/MP/忠/技/签 都在', /class="tc-fam/.test(htmlKbf)
    && /105/.test(htmlKbf) && /撕咬/.test(htmlKbf) && /已缔结/.test(htmlKbf), '');

  /* 来源：自造样例（为覆盖 缺项 / 三态 / 兜底 / 无行 分支而写，不是实测证据） */
  const onlyName = ['kbf1: 灰烬 | 族灵'].join('\n');
  const fMiss = (api.parseState(onlyName).familiars || [])[0] || {};
  T('缺项不整块消失：只有名称+族时，力敏体画 — 占位',
    /力<\/i>\s*<b>—<\/b>/.test(api.render(api.parseState(onlyName)))
    && /敏<\/i>\s*<b>—<\/b>/.test(api.render(api.parseState(onlyName))),
    'attrs=' + JSON.stringify(fMiss.attrs));

  const pactHtml = (raw) => api.render(api.parseState('kbf1: 灰烬 | 族灵 | 签 ' + raw));
  T('签 三态徽章：已缔结 p-on / 待缔结 p-wait / 已解除 p-off',
    /p-on/.test(pactHtml('已缔结')) && /p-wait/.test(pactHtml('待缔结')) && /p-off/.test(pactHtml('已解除')), '');
  T('签 非法值不静默改正：p-x 且保留原文', /p-x/.test(pactHtml('半吊子')) && /半吊子/.test(pactHtml('半吊子')), '');

  /* 取 .extra 之前先守住 [0]：造红（把 extra 初始化删掉、或让 familiars 为空）时，
     `[0].extra` 会抛 TypeError —— 进程崩掉，诊断一行都读不到，
     而「读得到诊断」正是造红的全部价值。所以这里只报形状，不抛。 */
  const famOf = (txt) => {
    const st = api.parseState(txt);
    const list = (st && st.familiars) || [];
    const f = list[0] || null;
    return { n: list.length, f: f, hasExtra: !!(f && Array.isArray(f.extra)) };
  };
  const extraTxt = 'kbf1: 灰烬 | 族灵 | 护甲 12';
  const ex = famOf(extraTxt);
  T('规格外 `名字 数字` 进 extra 成条（同 kbm 兜底）',
    ex.hasExtra && ex.f.extra.length === 1,
    'familiars=' + ex.n + ' 有 extra 数组=' + ex.hasExtra + ' 内容=' + JSON.stringify(ex.f && ex.f.extra));
  T('未知族值不冒充族：`族 龙` 不算 race，但字不丢（进 tags）',
    ((api.parseState('kbf1: 灰烬 | 族 龙').familiars || [])[0].race) === '',
    JSON.stringify(api.parseState('kbf1: 灰烬 | 族 龙').familiars));

  const noKbf = ['p1: 你 | HP 92/100', 'next: 继续'].join('\n');
  /* 0/0 的读数：比例必须显式 0，不能靠浏览器丢弃非法声明「碰巧」变零宽。
     这里钉两件事：整卡不出现 NaN ／ 那根条确实是 width:0%。 */
  const zeroTxt = 'kbf1: 亚龙 | 族兽 | HP 0/0 | MP 0/0 | 忠 0 | 力 1';
  const zeroHtml = api.render(api.parseState(zeroTxt));
  T('0/0 的读数不产生 NaN（HP 0/0 与 MP 0/0）', !/NaN/.test(zeroHtml),
    '命中片段：' + (/NaN.{0,40}/.exec(zeroHtml) || ['(无)'])[0]);
  /* 第一版写的是 /width:0%/.test(zeroHtml) —— 造红 C 时发现它是假绿：
     同一张卡里的 `忠 0`（无上限那条）本来就会产出 width:0%，于是「HP/MP 的条到底是不是 0」
     被别的条替它答了（实测：去掉 max=0 守卫后这条仍绿）。改成钉到那两根条自己身上。 */
  /* 第二版写成 /class="fam[^"]*"/ —— 又错了：`fam-loyal`（忠 0，无上限）同样以 fam 开头，
     于是 HP 的 NaN% 又一次被别的条替它答了（造红 C 实测：HP 子项读出来是 true）。
     这里必须锚精确 class，宁可将来改 markup 时它响亮地红。 */
  const hpZero = /class="fam" style="width:0%"/.test(zeroHtml);
  const mpZero = /class="fam-mp" style="width:0%"/.test(zeroHtml);
  T('0/0 的 HP / MP 两根条各自宽度显式为 0%（不是靠浏览器丢弃声明，也不是别的条替它答）',
    hpZero && mpZero,
    'HP 条 0%=' + hpZero + ' ｜ MP 条 0%=' + mpZero + ' ｜ 实际条：'
      + (zeroHtml.match(/class="(?:fam|fam-mp)[^"]*"[^>]*style="width:[^"]*"/g) || []).join(' '));

  T('没有 kbf 行时一张使魔卡都不出（不留空壳）', !/class="tc-fam/.test(api.render(api.parseState(noKbf))), '');


  /* ══════════ 组 11 · 通用截断锁：每个登记键都必须能在块中间（v3.26.0） ══════════
     这一组不是为 kbf 写的，是为「下一个新键」写的。
     截断只发生在 extractBlock 里，而四套既有测试全部绕开它（直接 render(parseState(t))），
     所以「未登记键吃掉其后所有状态行」能在全绿的情况下活着 —— kbf 就是这样活了两轮。 */
  console.log('\n── 组 11 · 通用截断锁（每个登记键） ──');

  /* 从 KEYS 枚举键基名：'npc[0-9]*' -> { base:'npc', num:true }；'scene' -> { base:'scene', num:false } */
  const keySpecs = frags.map(f => {
    const m = f.match(/^([A-Za-z]+)(\[0-9\][*+])?$/);
    return m ? { base: m[1], num: !!m[2], raw: f } : null;
  }).filter(Boolean);

  T('能从 KEYS 枚举出键基名（枚举失效时不许静默 0 通过）', keySpecs.length >= 20,
    '枚举到 ' + keySpecs.length + ' 个，KEYS=' + KEYS.slice(0, 80) + '　← 0 个说明解析规则没跟上 KEYS 的写法');

  const broken = [];
  for (const sp of keySpecs) {
    const mid = sp.base + (sp.num ? '2' : '') + ': 占位';
    const text = ['scene: 测试场景 | 地点 | 静', mid, 'next: 继续'].join('\n');
    const blk = api.extractBlock(text);
    if (!blk || blk.end !== 2) { broken.push(sp.base + (sp.num ? '2' : '') + '(end=' + (blk ? blk.end : 'null') + ')'); continue; }
    const st = api.parseState(blk.body);
    if (st.next !== '继续') broken.push(sp.base + '2(next 被吞)');
  }
  T('每个登记键出现在块中间都不会截断（共 ' + keySpecs.length + ' 个键）', broken.length === 0,
    '失效的：' + broken.join('、') + '　← 出现在这里 = 该键在 KEYS 里但 extractBlock 到它就 break，其后状态行全丢');

  /* 反向：把一个**没登记**的键放进块中间，必须截断 —— 证明上面那条不是恒真。
     恒真的断言和没写一样；这条保证「会红」的能力还在。 */
  /* 用 __nokeys__9 而不是 zzz9：zzz9 是个真可能被造出来的键名（调试时会随手写），
     一旦有人真把它登记进 KEYS，这条反向对照就静默失效。带下划线的名字不会被当成真键。 */
  const fakeBlk = api.extractBlock(['scene: 测试场景 | 地点 | 静', '__nokeys__9: 占位', 'next: 继续'].join('\n'));
  T('未登记的键确实会截断（反向对照：证明上一条不是恒真）', !!fakeBlk && fakeBlk.end === 0,
    'end=' + (fakeBlk && fakeBlk.end) + '（期望 0：遇到未登记行即 break）');

  /* ══════════ 组 12 · KEYS 契约双向差集（v3.27.0） ══════════
     KEYS 是**运行时真相**（从源码现取）；EXPECTED_KEYS 是**我们声称支持的全部键**（手写契约）。
     两边不同源才有比较的意义 —— 若期望集写成 KEYS.split('|') 的别名，就是两面镜子对镜，
     永远相等，比不检查更糟（它会替一张破网作证）。

     手写清单该不该存在，判据不是「写死还是现取」，而是「它错的时候会不会有人被叫醒」：
     下面两条差集会在两个方向上叫人 —— 少一个、多一个都红。
     失败时报**元素**不报数量：报数量的话人只会去改数量，报元素他才得读一遍。 */
  console.log('\n── 组 12 · KEYS 契约双向差集 ──');
  const EXPECTED_KEYS = [
    'scene', 'team', 'quest', 'check', 'result', 'world', 'next',
    'bond', 'foe', 'nb', 'nf', 'nh', 'nd', 'nl', 'npc',
    'kbnpc', 'ntrnpc', 'kbm', 'kbf', 'dmg', 'sh', 'dz', 'wh', 'pl', 'lk',
    'kbmsk', 'kbfsk',
    'pts', 'lock', 'ti', 'cr', 'p', 'sk', 'eq', 'mob'
  ];
  /* 期望集自己也要被查一次：必须是独立字面清单，不许引用 KEYS / SRC / readKeysString。
     没有这条，下一个人把期望集改成 KEYS.split('|') 就能让上面两条恒绿。 */
  /* 上面那条只能看「值」，看不出「这份值是哪儿来的」：把 EXPECTED_KEYS 换成
     frags.map(...) 之后 toString() 依旧是 scene,team,quest,…，断言照样绿（实测过）。
     要判「是不是手写字面清单」，只能读测试文件自己的源码文本。 */
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  const declAt = selfSrc.indexOf('const EXPECTED_KEYS = [');
  const declEnd = declAt < 0 ? -1 : selfSrc.indexOf('];', declAt);
  const decl = declAt >= 0 && declEnd > declAt ? selfSrc.slice(declAt, declEnd) : '';
  const quoteCount = (decl.match(/'[a-z]+'/g) || []).length;
  /* 判「有没有引用外部符号」之前先把标识符自己抹掉：decl 里必然含 EXPECTED_KEYS，
     而它里面就有「KEYS」三个字母——不抹掉的话这条对文件名自证，恒红。 */
  const declBody = decl.split('EXPECTED_KEYS').join('');
  T('期望键集是独立字面清单（源码必须是 [...] 字面量，不许是 KEYS.split / map 的别名）',
    decl !== '' && /^const EXPECTED_KEYS = \[/.test(decl) && quoteCount >= 20
      && !/frags|KEYS|SRC|readKeysString|\.map\(/.test(declBody),
    '声明片段长度=' + decl.length + ' ｜ 引号项=' + quoteCount + ' ｜ 片段前 80 字：' + decl.slice(0, 80));

  /* 上面那条只读「声明那一刻的快照」。QA 造过一个我们没料到的变异：
     声明一个字不改（仍是 28 项字面清单），在 `];` 之后加一个 IIFE ——
     先把 `EXPECTED_KEYS` 清空（长度置 0），再用 frags 派生的键填回去。
     运行时它就是 KEYS 的别名，而源码文本仍是漂亮的字面清单：删一个键 → 182/0 全绿。
     这不是「替身」问题，是**时序**问题 —— 声明是真的、值是假的。
     所以要再比一次「声明里的名字」和「运行时的值」：声明被谁改过、改过几次都不重要，
     只要它跟声明当初写的那份名字对不上，就红。 */
  const declNames = (decl.match(/'([a-z]+)'/g) || []).map((t) => t.slice(1, -1));
  T('期望集运行时值 === 声明里的字面清单（防声明后追加 / 清空重灌）',
    JSON.stringify(declNames) === JSON.stringify(EXPECTED_KEYS),
    '声明 ' + declNames.length + ' 项 / 运行时 ' + EXPECTED_KEYS.length + ' 项'
      + (declNames.length === EXPECTED_KEYS.length
        ? '（数量相同但内容不同：' + JSON.stringify(declNames.filter((n) => EXPECTED_KEYS.indexOf(n) < 0)) + ' 只在声明里 / '
          + JSON.stringify(EXPECTED_KEYS.filter((n) => declNames.indexOf(n) < 0)) + ' 只在运行时）'
        : ''));

  const baseOf = (frag) => frag.replace(/\[0-9\]\*$|\[0-9\]\+$/, '');
  const actualBases = [];
  for (const f of frags) { const b = baseOf(f); if (actualBases.indexOf(b) < 0) actualBases.push(b); }
  const missingInKeys = EXPECTED_KEYS.filter(b => actualBases.indexOf(b) < 0);
  const extraInKeys = actualBases.filter(b => EXPECTED_KEYS.indexOf(b) < 0);
  T('契约少一个：EXPECTED_KEYS 里每个键都在 KEYS 中', missingInKeys.length === 0,
    'KEYS 缺 ' + JSON.stringify(missingInKeys) + '（要么补进 KEYS，要么把它从契约里删掉——别留着）');
  T('实现多一个：KEYS 里没有契约外的键', extraInKeys.length === 0,
    'KEYS 多出 ' + JSON.stringify(extraInKeys) + '（新键要么登记进契约，要么写明它为什么是特例）');
  T('两侧都读到了东西（不是两个空集相等）',
    EXPECTED_KEYS.length > 20 && actualBases.length > 20,
    'EXPECTED=' + EXPECTED_KEYS.length + ' / KEYS=' + actualBases.length);

/* ───────── 组 13 · 避难所 sh / 灾变 dz ─────────
   两个键都是「前缀独占 + 独立卡片」（同 kbm/kbf/dmg，不进 EXT_KEYS）。
   这里要盯的不是「卡面好不好看」，是几件会**静默**坏掉的事：
   ① 夹在状态块中间时会不会把后面的行吞掉 —— 入口必须是 extractBlock。
      parseState 拿到的是已经切好的 body，截断发生在它之前，结构上看不见（§7 第 20 条）；
   ② `余 0` 会不会被真值判断当成「没写」；
   ③ 数值格坏掉时有没有把**原文片段**报出来（不许静默返回空对象）。
   整组裹一层块作用域：本文件的 setTimeout 回调是个大函数，组 1/2 已用过 html / blk 这些名字。 */
{
  console.log('\n── 组 13 · 避难所 sh / 灾变 dz ──');

  /* 每条都点名「哪一个」，不报「有几个」—— 报数量人只会去改数量（§7 第 22 条） */
  const SH_OK = '浮岛·望潮 ｜ 型 浮岛 ｜ 耐久 82/100 ｜ 舱 40/60 ｜ 电 12/30 ｜ 食 21/40 ｜ 温 6/12 ｜ 防 14 ｜ 模 净水器×3 ｜ 探照灯×2';
  const DZ_OK = '酸雨 ｜ 级 3 ｜ 余 0 ｜ 效 每回合 舱 -1';

  const s1 = api.parseShelter(SH_OK);
  T('sh 第 1 段取作名称', s1.name === '浮岛·望潮', 'name=' + JSON.stringify(s1.name));
  T('sh 型 三值映射（浮岛→isle，原文保留在 typeRaw）',
    s1.type === 'isle' && s1.typeRaw === '浮岛',
    'type=' + JSON.stringify(s1.type) + ' / typeRaw=' + JSON.stringify(s1.typeRaw));
  const resBad = [['hull', 82, 100], ['hold', 40, 60], ['power', 12, 30], ['food', 21, 40], ['temp', 6, 12]]
    .filter(([k, c, m]) => !s1[k] || s1[k].cur !== c || s1[k].max !== m)
    .map(([k]) => k + '=' + JSON.stringify(s1[k]));
  T('sh 五项资源各取 当前/上限', resBad.length === 0, '不对的项：' + JSON.stringify(resBad));
  T('sh 防 是单值数字', s1.def === 14, 'def=' + JSON.stringify(s1.def));
  T('sh 模 每段一组 名×级（2 段，顺序不乱）',
    s1.mods.length === 2 && s1.mods[0].name === '净水器' && s1.mods[0].lv === 3
      && s1.mods[1].name === '探照灯' && s1.mods[1].lv === 2,
    'mods=' + JSON.stringify(s1.mods));
  T('sh 正常行不产 errs（errs 只留给真的坏段）', s1.errs.length === 0, JSON.stringify(s1.errs));

  const s2 = api.parseShelter('无名礁 ｜ 耐久 50/50 ｜ 防 3');
  T('sh 缺 型 不误判，其余字段照解析',
    s2.type === '' && s2.typeRaw === '' && !!s2.hull && s2.hull.cur === 50 && s2.def === 3,
    'type=' + JSON.stringify(s2.type) + ' / hull=' + JSON.stringify(s2.hull) + ' / def=' + JSON.stringify(s2.def));

  const s0 = api.parseShelter('孤礁 ｜ 型 船坞 ｜ 模');
  T('sh 模 0 段：不产模组、也不算错', s0.mods.length === 0 && s0.errs.length === 0,
    'mods=' + s0.mods.length + ' / errs=' + JSON.stringify(s0.errs));
  /* 「模 无」是内容侧写「没有改装件」的常态写法：不许被当成「缺了 ×级 的模组名」报错 */
  const sNone = api.parseShelter('沉舟 ｜ 型 潜航 ｜ 模 无');
  T('sh 模 无：0 模组且不报错（无 ≠ 缺 ×级）',
    sNone.mods.length === 0 && sNone.errs.length === 0,
    'mods=' + JSON.stringify(sNone.mods) + ' / errs=' + JSON.stringify(sNone.errs));
  const s5 = api.parseShelter('船坞·铁锚 ｜ 型 船坞 ｜ 模 净化器×1 ｜ 蓄电池×2 ｜ 渔网×3 ｜ 补漏胶×4 ｜ 信标×5');
  T('sh 模 5 段：段数不定，末项名字与等级都在',
    s5.mods.length === 5 && s5.mods[4].name === '信标' && s5.mods[4].lv === 5,
    'mods=' + JSON.stringify(s5.mods));
  /* 顺序依赖：模 之后的裸段是设备名，不许被「型 关键字省略」的容错改判成载体形态 */
  const sm = api.parseShelter('礁盘 ｜ 模 浮岛×2');
  T('sh 模 之后的段不被改判成 型（容错分支的顺序）',
    sm.type === '' && sm.mods.length === 1 && sm.mods[0].name === '浮岛',
    'type=' + JSON.stringify(sm.type) + ' / mods=' + JSON.stringify(sm.mods));

  const d1 = api.parseDisaster(DZ_OK);
  T('dz 名称 / 级 1-5 取值', d1.name === '酸雨' && d1.level === 3,
    'name=' + JSON.stringify(d1.name) + ' / level=' + JSON.stringify(d1.level));
  T('dz 余 0 严格等于 0（真值判断会把终局读成「没写」）', d1.left === 0, 'left=' + JSON.stringify(d1.left));
  T('dz 效 一段自由文字原样取回', d1.effect === '每回合 舱 -1', 'effect=' + JSON.stringify(d1.effect));
  T('dz 正常行不产 errs', d1.errs.length === 0, JSON.stringify(d1.errs));

  /* ── 截断锁：入口必须 extractBlock ── */
  const MIX = ['scene: 夜航 ｜ 甲板', 'sh: ' + SH_OK, 'dz: ' + DZ_OK, 'p1: 我 ｜ HP 9/10', 'next: 收帆'].join('\n');
  const mixBlk = api.extractBlock(MIX);
  T('sh/dz 夹在状态块中间：extractBlock.end 一直覆盖到最后一行（end===4）',
    !!mixBlk && mixBlk.start === 0 && mixBlk.end === 4,
    'blk=' + JSON.stringify(mixBlk && { start: mixBlk.start, end: mixBlk.end }));
  const mixSt = api.parseState(mixBlk ? mixBlk.body : '');
  T('截断锁：sh/dz 之后的 p1 与 next 仍然被解析',
    mixSt.players.length === 1 && mixSt.next === '收帆',
    'players=' + mixSt.players.length + ' / next=' + JSON.stringify(mixSt.next));
  T('两个键都真进了解析结果（不是「没报错但也没东西」）',
    mixSt.shelters.length === 1 && mixSt.disasters.length === 1,
    'shelters=' + mixSt.shelters.length + ' / disasters=' + mixSt.disasters.length);

  /* ── 渲染：每条断言钉在具体元素上，不用「存在某个 0% / 某个 class」这种替身 ── */
  const shHtml = api.render(mixSt);
  const labMiss = ['耐久', '舱', '电', '食', '温']
    .filter(l => shHtml.indexOf('<span class="tc-kbm-gl">' + l + '</span>') < 0);
  T('sh 五条资源条逐条命中（点名缺哪一条）', labMiss.length === 0, '缺：' + JSON.stringify(labMiss));
  T('sh 条宽绑在「耐久」自己身上（82/100→82%，不是「某个 82%」）',
    shHtml.indexOf('<i class="sh-hull" style="width:82%"></i>') >= 0,
    '未命中 <i class="sh-hull" style="width:82%"></i>');
  T('sh 防 渲染为单值（不给条——给条会被读成消耗量）',
    shHtml.indexOf('<span class="tc-sh-def"><em>防</em><b>14</b></span>') >= 0);
  const modMiss = ['<span class="tc-sh-mod">净水器<i>×3</i></span>', '<span class="tc-sh-mod">探照灯<i>×2</i></span>']
    .filter(s => shHtml.indexOf(s) < 0);
  T('sh 模 逐枚渲染成徽章（点名缺哪一枚）', modMiss.length === 0, '缺：' + JSON.stringify(modMiss));

  const dzHtml = api.render(api.parseState('dz: ' + DZ_OK));
  T('dz 渲染为横幅：tc-dz + lv-3 + over 同在一个元素上',
    dzHtml.indexOf('class="tc-dz lv-3 over"') >= 0, '未命中 class="tc-dz lv-3 over"');
  T('dz 余 0 照字面显示为「余 0 回合」',
    dzHtml.indexOf('<b class="tc-dz-left">余 0 回合</b>') >= 0);
  T('dz 余 0 触发「已平息」印章', dzHtml.indexOf('<span class="tc-dz-over">已平息</span>') >= 0);
  T('dz 效 落在横幅底部整行（.tc-dz-fx）',
    dzHtml.indexOf('<div class="tc-dz-fx">每回合 舱 -1</div>') >= 0);
  T('dz 严重度点阵亮 3 格（1..5 是档位不是进度）',
    (dzHtml.match(/<i class="on"><\/i>/g) || []).length === 3,
    '亮格数=' + (dzHtml.match(/<i class="on"><\/i>/g) || []).length);

  /* ── 负向对照：同一台渲染器，没有这两个键时不许凭空出卡 ── */
  const plainHtml = api.render(api.parseState(['scene: 走廊', 'p1: 我 ｜ HP 9/10', 'next: 走'].join('\n')));
  const ghost = ['tc-shelter', 'tc-dz'].filter(c => plainHtml.indexOf(c) >= 0);
  T('没有 sh/dz 行时不出避难所与灾变容器', ghost.length === 0, '凭空出现：' + JSON.stringify(ghost));

  /* ── 破裂态：耐久归零才盖章；健康的那张必须没有章（反向对照） ── */
  const sunkHtml = api.render(api.parseState('sh: 沉礁 ｜ 型 潜航 ｜ 耐久 0/80 ｜ 舱 0/40'));
  T('耐久归零 → wrecked 主题 + 舱体破裂印章',
    sunkHtml.indexOf('tc-shelter t-sub wrecked') >= 0 && sunkHtml.indexOf('舱体破裂') >= 0,
    'class/印章未命中');
  T('同一张卡健康时不盖破裂章（防「总有一个章在」）',
    shHtml.indexOf('wrecked') < 0 && shHtml.indexOf('舱体破裂') < 0);

  /* ── 报错必须带原文片段，并且真的画得出来 ── */
  const sbad = api.parseShelter('破船 ｜ 型 飞艇 ｜ 耐久 八/十 ｜ 防 甲');
  const sbadTxt = sbad.errs.join(' ⏐ ');
  T('sh 坏 型 报错带原文（飞艇）', /飞艇/.test(sbadTxt), sbadTxt);
  T('sh 坏 数值格 报错带原文（八/十）', /八\/十/.test(sbadTxt), sbadTxt);
  T('sh 坏 防 报错带原文（甲）', /甲/.test(sbadTxt), sbadTxt);
  const sfull = api.parseShelter('破船 ｜ 耐久 82／100');
  T('sh 全角斜线不认双值：hull 为空且报错带原文（82／100）',
    sfull.hull === null && sfull.errs.join(' ⏐ ').indexOf('82／100') >= 0,
    'hull=' + JSON.stringify(sfull.hull) + ' / errs=' + JSON.stringify(sfull.errs));
  const sbadHtml = api.render(api.parseState('sh: 破船 ｜ 型 飞艇 ｜ 耐久 八/十 ｜ 防 甲'));
  T('sh 解析报错在卡面上可见（不许静默返回空对象）',
    sbadHtml.indexOf('class="tc-sh-err"') >= 0 && sbadHtml.indexOf('八/十') >= 0 && sbadHtml.indexOf('飞艇') >= 0);

  const dbad = api.parseDisaster('迷雾 ｜ 级 9 ｜ 余 若干 ｜ 效 视野 -2');
  const dbadTxt = dbad.errs.join(' ⏐ ');
  T('dz 级 越界报错带原文（9）', /级 必须是 1-5：9/.test(dbadTxt), dbadTxt);
  T('dz 余 非数字报错带原文（若干）', /若干/.test(dbadTxt), dbadTxt);
  const dzMissHtml = api.render(api.parseState('dz: 迷雾 ｜ 效 视野 -2'));
  T('dz 没写 余 时画「余 —」，不许冒充「余 0 回合」',
    dzMissHtml.indexOf('<b class="tc-dz-left miss">余 —</b>') >= 0 && dzMissHtml.indexOf('余 0 回合') < 0);

  /* ── 登记面：它们是独立卡片，不是 EXT_KEYS 的共享渲染器（登记会双注册） ── */
  T('sh/dz 不进 EXT_KEYS（与 kbm/kbf/dmg 同款：KEYS 前缀 + 自己那条分支）',
    REG.every(e => e.key !== 'sh' && e.key !== 'dz'),
    'EXT_KEYS 里的键：' + JSON.stringify(REG.map(e => e.key)));

  /* ── 视觉可区分：五条各配色、两张卡各有一处**形状**识别符 ── */
  const barMiss = ['sh-hull', 'sh-hold', 'sh-power', 'sh-food', 'sh-temp']
    .filter(k => api.CSS.indexOf('.tc-bar i.' + k + '{') < 0);
  T('五条资源条各有自己的配色（点名缺哪一条）', barMiss.length === 0, '缺：' + JSON.stringify(barMiss));
  T('shelter 的识别符是「圆角浮筒 + 水位线」（不是 kbm 的直角切角钢板）',
    api.CSS.indexOf('.tc-sh-water{') >= 0 && !/\.tc-shelter\{[^}]*clip-path/.test(api.CSS));
  T('dz 的识别符是「左侧 9px 等级色块 + 血色斜纹带」（横条不是卡片）',
    api.CSS.indexOf('border-left:9px solid var(--dl)') >= 0
      && api.CSS.indexOf('repeating-linear-gradient(135deg,rgba(120,20,20,.20)') >= 0);
}

{
  /* ══════════ 组 14 · 仓储 wh / 场所 pl ══════════
     wh 是**玩家资产的唯一载体**：这一组里最重要的一条不是配色、不是排版，是
     「16 段输入 → 16 个名字逐个出现在输出里」。数据丢一件，玩家就会在下一回合发现东西没了，
     而面板看起来一切正常 —— 那是最坏的一类静默降级。
     pl 的 `型` 有兜底要求：生成引擎会造出清单外的型，遇到未知型**不许报错**（报错=把 AI 生成的东西
     判成坏的），只许走默认色并把原词显示出来。 */
  console.log('\n── 组 14 · 仓储 wh / 场所 pl ──');

  const WH3 = '净水器×3 ｜ 军用密封声呐探头×1[备用灯油] ｜ 三棱刺×2';
  const WH16 = ['净水器×3', '军用密封声呐探头×1[备用灯油]', '三棱刺×2', '七号电池×12',
    '压缩饼干×24', '鱼干×5', '绳索×2', '铜铃×1', '铁钉×40', '药膏×3',
    '火折×6', '毯子×2', '灯油×1[满]', '钉子×9', '地图×1', '信标×1'].join(' ｜ ');

  /* ── 逐字段解析（失败时报是哪一段不对，不报数量） ── */
  const w3 = api.parseWarehouse(WH3);
  T('wh 第 1 段名称 / 件数 / 顺序', w3.items.length === 3
    && w3.items[0].name === '净水器' && w3.items[0].qty === 3
      && w3.items[2].name === '三棱刺' && w3.items[2].qty === 2, JSON.stringify(w3.items));
  T('wh 名字放宽到 14 字（「军用密封声呐探头」= 8 字也必须原样保留）',
    w3.items[1].name === '军用密封声呐探头', JSON.stringify(w3.items[1]));
  T('wh [注] 原样（≤8 字），没有注的那件是空串不是 undefined',
    w3.items[1].note === '备用灯油' && w3.items[0].note === '', JSON.stringify(w3.items.map(i => i.note)));
  T('wh 名字含中文数字不被吃掉（三棱刺 / 七号电池）',
    w3.items[2].name === '三棱刺' && api.parseWarehouse(WH16).items[3].name === '七号电池');
  T('wh 正常行不产生解析报错', w3.errs.length === 0, JSON.stringify(w3.errs));

  const w16 = api.parseWarehouse(WH16);
  T('wh 16 段满：段数 16、首件与末件都在',
    w16.items.length === 16 && w16.items[0].name === '净水器' && w16.items[15].name === '信标',
    w16.items.length + ' 段');

  /* ── 名字 / 注不许丢字（「铁钉×60 锅」那类怀疑的正面回答） ──
     只数件数不够：切名字时多吃一个或少吃一个，件数照样对。
     判据取「名字 + ×件数 在原文里连写的那个位置」——吃字后 `水桶×4` 就再也对不上原文的 `淡水桶×4`。 */
  const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameLoss = w16.items.filter(it => it.qty != null &&
    !new RegExp('(?:^|[\\s｜|，,、·])' + escRe(it.name) + '\\s*[×xX*]\\s*' + it.qty).test(WH16)).map(it => it.name + '×' + it.qty);
  T('每件名字都能在原始行里逐字找到（按「名字+×件数」连写的位置对，不按包含关系）',
    nameLoss.length === 0, '对不上原文：' + JSON.stringify(nameLoss));

  const noteLoss = [];
  for (const it of w16.items) {
    if (!it.note) continue;
    /* 注被吃进名字，是「名字丢字」的另一种长相：`铁钉[锈]` 不能解成名字带锈 */
    if (it.name.indexOf(it.note) >= 0) { noteLoss.push(it.name + ' 把注吃进名字：' + it.note); continue; }
    if (!new RegExp('[\\[［【]' + escRe(it.note) + '[\\]］】]').test(WH16)) {
      noteLoss.push(it.name + ' 的注在原文找不到：' + it.note);
    }
  }
  T('每件 [注] 都能在原文找到，且没被吃进名字里',
    noteLoss.length === 0, JSON.stringify(noteLoss));

  const wNone = api.parseWarehouse('无');
  T('wh: 无 = 空仓（0 件且不报错，不是「一件叫 无 的东西」）',
    wNone.items.length === 0 && wNone.errs.length === 0, JSON.stringify(wNone));

  /* 坏段：**收下 + 报原文**。扔掉一段等于把玩家的东西弄丢，比报错更糟。 */
  const wBad = api.parseWarehouse('鱼干 ｜ 净水器×0 ｜ 铁钉×40');
  T('wh 缺 ×件数 的段照样收下（不丢），并报原文片段',
    wBad.items.length === 3 && wBad.items[0].name === '鱼干' && wBad.items[0].qty === null
      && /鱼干/.test(wBad.errs.join('⏐')), JSON.stringify(wBad.items) + ' / ' + JSON.stringify(wBad.errs));
  T('wh ×0 报「必须是正整数」且件数画 —（不把这一件抹掉）',
    wBad.errs.some(e => /净水器×0/.test(e)) && wBad.items[1].qty === null,
    JSON.stringify(wBad.errs));

  const w17 = api.parseWarehouse(WH16 + ' ｜ 备用桨×1');
  T('wh 超 16 段：仍然全部保留（17 件），只在 errs 里说明', w17.items.length === 17
    && w17.errs.some(e => /超过 16/.test(e)), w17.items.length + ' 件 / ' + JSON.stringify(w17.errs));

  /* ── pl：六型映射 / 未知型兜底 / 存 0 / 特 ── */
  const PL6 = ['市场', '遗迹', '营地', '险地', '浮标', '船队'];
  const plTypes = PL6.map((t, i) => api.parsePlace('地点' + i + ' ｜ 型 ' + t + ' ｜ 存 ' + (i + 1)));
  const typeMiss = PL6.filter((t, i) => ['market', 'ruin', 'camp', 'peril', 'buoy', 'fleet'][i] !== plTypes[i].type);
  T('pl 六型映射（市场/遗迹/营地/险地/浮标/船队）', typeMiss.length === 0,
    '映射错：' + JSON.stringify(typeMiss.map((t, i) => t + '→' + plTypes[i].type)));

  const plU = api.parsePlace('虫窟 ｜ 型 虫巢 ｜ 存 0 ｜ 特 壁面在呼吸');
  T('pl 清单外的型不报错（报错=把生成引擎造的东西判成坏的）', plU.errs.length === 0, JSON.stringify(plU.errs));
  T('pl 未知型保留原词并落到默认色 t-x', plU.type === '' && plU.typeRaw === '虫巢', JSON.stringify({ t: plU.type, raw: plU.typeRaw }));
  T('pl 存 0 合法且严格等于 0（不许真值判断）', plU.store === 0, String(plU.store));
  T('pl 特 原样', plU.feature === '壁面在呼吸', JSON.stringify(plU.feature));
  const plBare = api.parsePlace('营地遗址 ｜ 营地 ｜ 存 2 ｜ 特 有人住');
  T('pl 型 关键字省略时裸段「营地」当型', plBare.type === 'camp' && plBare.typeRaw === '营地', JSON.stringify(plBare));
  const plBad = api.parsePlace('远岸 ｜ 型 市场 ｜ 存 三 ｜ 特 卖东西');
  T('pl 存 非数字报错带原文（三）', /存 必须是非负整数：三/.test(plBad.errs.join('⏐')), plBad.errs.join('⏐'));

  /* ── 三行并存：pl1/pl2/pl3 各自成卡、按编号排序 ── */
  const stPl = api.parseState(['scene: 码头', 'pl: 甲 ｜ 型 市场 ｜ 存 3 ｜ 特 一',
    'pl2: 乙 ｜ 型 遗迹 ｜ 存 1 ｜ 特 二', 'pl3: 丙 ｜ 型 险地 ｜ 存 0 ｜ 特 三', 'next: 走'].join('\n'));
  T('pl1..pl3 三行并存且按编号排序',
    stPl.places.length === 3 && stPl.places.map(p => p.name).join('') === '甲乙丙',
    JSON.stringify(stPl.places.map(p => p.name)));

  /* ── 截断锁：入口必须是 extractBlock（§7 第 20 条），parseState 结构上看不见这类 bug ── */
  const mix = ['scene: 夜航 ｜ 甲板', 'wh: ' + WH16, 'pl: 虫窟 ｜ 型 虫巢 ｜ 存 0 ｜ 特 会动',
    'p1: 我 ｜ HP 9/10', 'next: 收帆'].join('\n');
  const mixBlk = api.extractBlock(mix);
  T('wh/pl 插在状态块中间不吞后续行（extractBlock.end 指到 next）',
    !!mixBlk && mixBlk.start === 0 && mixBlk.end === 4,
    'start=' + (mixBlk && mixBlk.start) + ' end=' + (mixBlk && mixBlk.end));
  const mixSt = api.parseState(mixBlk.body);
  T('插在中间时后面的 p1 / next 仍然被解析到',
    mixSt.players.length === 1 && mixSt.next === '收帆',
    'players=' + mixSt.players.length + ' next=' + JSON.stringify(mixSt.next));
  T('插在中间时 wh 与 pl 也都解到了（不是牺牲它们换通过）',
    mixSt.warehouses.length === 1 && mixSt.places.length === 1,
    'wh=' + mixSt.warehouses.length + ' pl=' + mixSt.places.length);

  /* ── 渲染：wh 的**不丢项**是这一组的硬断言 ── */
  const stWh = api.parseState(['scene: 夜航', 'sh: 潮汐屿 ｜ 型 浮岛 ｜ 舱 7/12', 'wh: ' + WH16, 'next: 收帆'].join('\n'));
  const whHtml = api.render(stWh);
  const missingItems = stWh.warehouses[0].items.filter(it => whHtml.indexOf(it.name) < 0).map(it => it.name);
  T('16 段满 → 输出里 16 个物品名逐个出现（点名缺哪件，不报数量）',
    missingItems.length === 0 && stWh.warehouses[0].items.length === 16, '缺：' + JSON.stringify(missingItems));
  T('>8 件折成两列（DOM 一件不少，列由 CSS 轨道给）',
    whHtml.indexOf('class="tc-wh many"') >= 0 &&
    /\.tc-wh\.many \.tc-wh-list\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(api.CSS));
  T('占用 N/M：N=件数、M=舱当前×2（舱 7/12 → 14）',
    /class="tc-wh-occ[^"]*">16<u>\/14<\/u>/.test(whHtml),
    (whHtml.match(/tc-wh-occ[^>]*>[^<]*<u>[^<]*/) || [''])[0]);
  T('没有 sh 时容量画 — 而不是编一个数',
    /class="tc-wh-occ">3<u>\/—<\/u>/.test(api.render(api.parseState('wh: ' + WH3))),
    (api.render(api.parseState('wh: ' + WH3)).match(/tc-wh-occ[^>]*>[^<]*<u>[^<]*/) || [''])[0]);
  T('每件一行：名 + ×数（数量右对齐元素点名）',
    /<span class="tc-wh-n">净水器<\/span>\s*<em class="tc-wh-x">×3<\/em>/.test(whHtml),
    (whHtml.match(/tc-wh-i">[\s\S]{0,90}/) || [''])[0]);
  T('注画成独立的小字元素，且带方括号（照契约的记法显示：不带括号会分不清哪几个字是名字）',
    whHtml.indexOf('<i class="tc-wh-note">[备用灯油]</i>') >= 0,
    (whHtml.match(/tc-wh-note">[^<]*/) || [''])[0]);
  T('注与名字之间留出空隙（不是靠空格猜，是 padding）',
    /\.tc-wh-note\{[^}]*padding-left:5px/.test(api.CSS));
  const whEmptyHtml = api.render(api.parseState('wh: 无'));
  T('空仓画「空仓」，不出空的清单容器',
    whEmptyHtml.indexOf('class="tc-wh-empty">空仓<') >= 0 && whEmptyHtml.indexOf('class="tc-wh-list"') < 0);
  T('wh 坏段在卡面上可见（报错必须画得出来）',
    api.render(api.parseState('wh: 鱼干 ｜ 净水器×0')).indexOf('class="tc-wh-err"') >= 0);

  /* ── 渲染：pl 分色、倒计时角标、未知型 ── */
  const plHtml = api.render(api.parseState(['scene: 码头', 'pl: 锈锚市场 ｜ 型 市场 ｜ 存 3 ｜ 特 卖淡水',
    'pl2: 虫窟 ｜ 型 虫巢 ｜ 存 0 ｜ 特 壁面在呼吸'].join('\n')));
  const plClsMiss = ['market', 'ruin', 'camp', 'peril', 'buoy', 'fleet']
    .filter(t => api.CSS.indexOf('.tc-pl.t-' + t + '{--pc:') < 0);
  T('pl 六型各有一条配色规则（点名缺哪一型）', plClsMiss.length === 0, '缺：' + JSON.stringify(plClsMiss));
  T('pl 市场卡带 t-market 与 型 原词', /class="tc-pl t-market"[\s\S]{0,300}<span class="tc-pl-type">市场<\/span>/.test(plHtml));
  T('pl 未知型走 t-x 且原词「虫巢」照常显示',
    /class="tc-pl t-x"[\s\S]{0,300}<span class="tc-pl-type">虫巢<\/span>/.test(plHtml) && plHtml.indexOf('虫巢') >= 0);
  T('pl 存 N 是角标；存 0 划掉并标「存 0」',
    plHtml.indexOf('<b class="tc-pl-store">存 3</b>') >= 0
      && plHtml.indexOf('<b class="tc-pl-store gone">存 0</b>') >= 0);
  T('pl 没写 存 时画「存 —」，不冒充 0',
    api.render(api.parseState('pl: 荒野 ｜ 型 遗迹 ｜ 特 什么都没有')).indexOf('class="tc-pl-store miss">存 —<') >= 0);
  T('pl 特 画成小字摘要', plHtml.indexOf('<div class="tc-pl-ft">卖淡水</div>') >= 0);

  /* ── 负向：纯基础块不许冒出这两张卡 ── */
  const baseHtml = api.render(api.parseState(['scene: 天台', 'p1: 我 ｜ HP 10/10', 'next: 上前'].join('\n')));
  T('没有 wh/pl 行时不出这两张卡（不许画空壳）',
    baseHtml.indexOf('tc-wh') < 0 && baseHtml.indexOf('tc-pl') < 0);

  /* ── 量级：这两张是辅助信息，形状要比避难所轻（不给渐变外环） ── */
  const whRule = (api.CSS.match(/\.tc-wh\{[^}]*\}/) || [''])[0];
  const plRule = (api.CSS.match(/\.tc-pl\{[^}]*\}/) || [''])[0];
  T('wh 是扁平清单（无渐变外环 = 比 shelter 轻一档）',
    whRule !== '' && whRule.indexOf('linear-gradient') < 0 && api.CSS.indexOf('.tc-wh-list{') >= 0, whRule);
  T('pl 的识别符是「3px 型色左钉」（不是 shelter 的圆角浮筒）',
    /border-left:3px solid var\(--pc\)/.test(plRule), plRule);
  T('wh/pl 也不进 EXT_KEYS', REG.every(e => e.key !== 'wh' && e.key !== 'pl'),
    'EXT_KEYS 里的键：' + JSON.stringify(REG.map(e => e.key)));

  /* ── 两列不许串行：这几条 CSS 是「每件待在自己格子里」的前提，缺一条就会读错归属 ──
     只挂 minmax 不够：CJK 名字本来就能断行，`overflow-wrap:anywhere` 又把 min-content
     压到 1 字，`1fr` 的自动下限才不至于撑破。所以「可折行」和「minmax(0,·)」都得在。 */
  const manyRule = (api.CSS.match(/\.tc-wh\.many \.tc-wh-list\{[^}]*\}/) || [''])[0];
  const itemRule = (api.CSS.match(/\.tc-wh-i\{[^}]*\}/) || [''])[0];
  const nameRule = (api.CSS.match(/\.tc-wh-n\{[^}]*\}/) || [''])[0];
  T('wh 两列的轨道是 minmax(0,1fr)（不是 1fr：1fr 的自动下限会被长字的 min-content 撑开）',
    /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(manyRule), manyRule);
  T('wh 每件自己 min-width:0（允许被压窄，不许顶宽）',
    /min-width:0/.test(itemRule), itemRule);
  T('wh 名字可随处折行（overflow-wrap:anywhere 两列才不互相挤）',
    /overflow-wrap:anywhere/.test(nameRule), nameRule);
  /* 只查 wh 自己那一段 CSS：别的卡（.tc-ak / .tc-kbm-gl …）用 ellipsis 是它们的既有设计 */
  const whCss = api.CSS.slice(api.CSS.indexOf('.tc-whs{'), api.CSS.indexOf('.tc-pls{'));
  T('wh 不许用 ellipsis 收尾（那是把字丢了，比串行更坏）',
    whCss.length > 0 && whCss.indexOf('text-overflow') < 0, 'wh 段 CSS 长度 ' + whCss.length);
  T('wh ≤360 退回单列（宁可变高，不许两列挤成一团）',
    /@media \(max-width:360px\)\{\.tc-wh\.many \.tc-wh-list\{grid-template-columns:minmax\(0,1fr\)\}\}/.test(api.CSS));
}

{
  /* ══════════ 组 15 · 行内键切分（整块挤成一行时的抢救通道） ══════════
     实战事故：AI 把 `sh:` `cr1:` `dz:` `p1:` `sk1:` `eq1:` `result:` `world:` `next:`
     全写在同一行、用空格隔开。逐行解析只认第一个键，其余全丢 → 一张卡都不渲染，
     玩家看到的是一整块原始文本（全白）。
     这条通道的判据不是「修好了没有」，是两件同时成立：
       ① 该拆的拆开（9 个键都解到、卡片画出来）；
       ② 不该拆的**一个字都不动**（单键行的正文里提到 `next:` 是自然中文，误拆等于吃正文）。
     `segs` 是「切出了几段」，0/1 表示没切——所以「没切」也要被断言，不能只测会切的那半。 */
  console.log('\n── 组 15 · 行内键切分 ──');

  /* ── A 正常多行块：回归，不许有副作用 ── */
  const NORMAL = ['scene: 第三环·夜里两点 ｜ 甲板',
    'sh: 潮汐屿 ｜ 型 浮岛 ｜ 耐久 268/400 ｜ 舱 7/12 ｜ 防 12',
    'p1: 我 ｜ HP 88/100',
    'next: 收帆'].join('\n');
  const nBlk = api.extractBlock(NORMAL);
  T('A 正常块 extractBlock.body 与原文逐字节相同（切分不改结构）',
    !!nBlk && nBlk.body === NORMAL, 'len ' + (nBlk && nBlk.body.length) + ' vs ' + NORMAL.length);
  const nSp = api.splitInlineKeys(NORMAL);
  T('A 正常块不触发切分（segs === 0，行数不变）',
    nSp.segs === 0 && nSp.lines.length === 4, 'segs=' + nSp.segs + ' lines=' + nSp.lines.length);
  const nSt = api.parseState(NORMAL);
  T('A 正常块 parseState 不带 inlineSplit 标记', nSt.inlineSplit === undefined, String(nSt.inlineSplit));
  T('A 正常块卡面没有切分警告', api.render(nSt).indexOf('tc-split') < 0);

  /* ── B 用户截图里那串真实原文：9 个键挤成一行 ── */
  const ONE = 'sh: 潮汐屿 ｜ 型 浮岛 ｜ 耐久 268/400 ｜ 舱 7/12 ｜ 防 12 '
    + 'cr1: 幸运LP 12/12 dz: 海上风暴 ｜ 级 3 ｜ 余 4 ｜ 效 每回合 耐久 -15 '
    + 'p1: 我 ｜ HP 88/100 sk1: 操舵 3 eq1: 锈刀 result: 抢到半舱 food '
    + 'world: 赤潮北上 next: 收帆';
  const oneHits = api.keyHits(ONE).map(h => h.key);
  T('B 单行里认出 9 个键且顺序不乱',
    oneHits.join(',') === 'sh,cr1,dz,p1,sk1,eq1,result,world,next', oneHits.join(','));
  const oneBlk = api.extractBlock(ONE);
  T('B 切分发生在解析层：extractBlock 仍把它当成一行（end === 0）',
    !!oneBlk && oneBlk.end === 0, 'end=' + (oneBlk && oneBlk.end));
  const oneSt = api.parseState(oneBlk.body);
  T('B 解析出 9 段（inlineSplit === 9）', oneSt.inlineSplit === 9, String(oneSt.inlineSplit));
  const nineMiss = [];
  if (oneSt.shelters.length !== 1) nineMiss.push('sh');
  if (oneSt.disasters.length !== 1) nineMiss.push('dz');
  if (oneSt.players.length !== 1) nineMiss.push('p1');
  if (!(oneSt.players[0] && oneSt.players[0].skills.length)) nineMiss.push('sk1');
  if (!(oneSt.players[0] && oneSt.players[0].equip)) nineMiss.push('eq1');
  if (!(oneSt.players[0] && oneSt.players[0].crRow)) nineMiss.push('cr1');
  if (!oneSt.result) nineMiss.push('result');
  if (!oneSt.world) nineMiss.push('world');
  if (oneSt.next !== '收帆') nineMiss.push('next');
  T('B 九个键逐个解到（点名缺哪个键，不报数量）', nineMiss.length === 0, '缺：' + JSON.stringify(nineMiss));
  const oneHtml = api.render(oneSt);
  T('B 卡面显式标注「此行缺换行，已自动切分（9 段）」（不许静默修好）',
    oneHtml.indexOf('<div class="tc-split">⚠ 此行缺换行，已自动切分（9 段）</div>') >= 0,
    (oneHtml.match(/tc-split[\s\S]{0,40}/) || [''])[0]);
  T('B 切完之后真的画出卡片（不是标了警告却还是空卡）',
    oneHtml.indexOf('class="tc-shelter') >= 0 && oneHtml.indexOf('class="tc-dz ') >= 0);
  T('B result / world / next 三条尾部字段原样保留',
    oneSt.result === '抢到半舱 food' && oneSt.world === '赤潮北上' && oneSt.next === '收帆',
    JSON.stringify([oneSt.result, oneSt.world, oneSt.next]));

  /* ── C 防误伤：单键行的正文里提到 next: ── */
  const C1 = 'world: 频道里有人念了句「next: 该走了」，像是玩笑';
  const c1 = api.splitInlineKeys(C1);
  T('C 引号里的 next: 不触发切分（正文在「谈论」键，不是在用它）',
    c1.segs === 0 && c1.lines.length === 1 && c1.lines[0] === C1, 'segs=' + c1.segs);
  /* 同一条的另一个时刻：把引号拿掉，它就该切了 —— 否则上面那条可能只是「永远不切」的假绿 */
  const C2 = 'world: 频道里有人念了句 next: 该走了，像是玩笑';
  const c2 = api.splitInlineKeys(C2);
  T('C 对照：同一句去掉引号后确实会切（证明上一条不是恒不切的假绿）',
    c2.segs === 2 && c2.lines.length === 2, 'segs=' + c2.segs + ' lines=' + JSON.stringify(c2.lines));
  const C3 = 'next: 记住 next 才是下一步';
  T('C 正文提到键名但没有冒号 → 不切', api.splitInlineKeys(C3).segs === 0);
  const C4 = 'next: 收帆';
  T('C 单键正常行 → 不切', api.splitInlineKeys(C4).segs === 0);

  /* ── D 切不出来的乱码：原样返回，不崩 ── */
  const D1 = 'foo: bar baz: qux 这次真的没有状态键';
  const d1 = api.splitInlineKeys(D1);
  T('D 没有任何已知键 → 原样返回（不猜、不丢段）',
    d1.segs === 0 && d1.lines.length === 1 && d1.lines[0] === D1, 'segs=' + d1.segs);
  let dCrash = null;
  try { const stD = api.parseState(D1); api.render(stD); } catch (e) { dCrash = String(e && e.message); }
  T('D 乱码行走完整条链路不抛错', dCrash === null, String(dCrash));
  const D2 = 'xx yy next: 收帆 zz';
  T('D 只有 1 个已知键 → 不切（单键行一律不碰）', api.splitInlineKeys(D2).segs === 0);

  /* ── E 边界：全角冒号、键前有前置文字、键名长短 ── */
  const E1 = 'scene：天台 next：收帆';
  const e1 = api.splitInlineKeys(E1);
  T('E 全角冒号也认（scene：/ next：）',
    e1.segs === 2 && api.parseState(e1.lines.join('\n')).next === '收帆', 'segs=' + e1.segs);
  const E2 = '（状态） sh: 潮汐屿 ｜ 型 浮岛 next: 收帆';
  const e2 = api.splitInlineKeys(E2);
  T('E 第一个键之前的文字自己成一段，不被并进第一个键',
    e2.lines[0] === '（状态）' && e2.lines[1].indexOf('sh:') === 0, JSON.stringify(e2.lines));
  const E3 = 'pl: 虫巢 ｜ 型 虫巢 p1: 我 ｜ HP 9/10';
  T('E 键名长的优先（pl / p1 各自命中，pl 不被拆成 p + l）',
    api.keyHits(E3).map(h => h.key).join(',') === 'pl,p1', api.keyHits(E3).map(h => h.key).join(','));

  /* ══════════ 组 16 · 基因锁 lk（v3.30.0） ══════════
     盯三件最容易静默的事：
     ① `率 0%` 是合法值（未开锁也写整行），不许被 `if (rate)` 这类真值判断吃掉；
     ② 率 缺失或坏值必须把原文摆到卡面，不许静默消失、也不许假装成 0%；
     ③ 阶 换的是颜色与属性上限映射，未知阶要报出来，不能兜成「未开」。

     写法上一条硬要求：**取不到数据时只能红，不能抛**。
     造红 A（从 KEYS 里删掉 lk）第一版就死在 `geneLocks[0].name` 的 TypeError 上，
     进程在 timeout 里崩掉、连「N 通过 / N 失败」都不打印 —— 崩掉的测试会把
     它后面所有断言一起藏起来，看起来像「只坏了这一条」，实际是「后面的都没跑」。
     所以下面一律用 `lkOf()` 兜一个带 errs:[] 的空壳。 */
  console.log('\n── 组 16 · 基因锁 lk ──');

  const lkOf = (st) => (st.geneLocks && st.geneLocks[0]) || { errs: [] };
  const LK_SRC = 'lk1: 甲 ｜ 境 三阶 ｜ 率 62% ｜ 纹 30% ｜ 锁 +12% ｜ 成 2 ｜ 次 5 险成';

  const lkSt = api.parseState(LK_SRC);
  T('lk 行进 geneLocks（不串到 places）',
    lkSt.geneLocks.length === 1 && lkSt.places.length === 0,
    'geneLocks=' + lkSt.geneLocks.length + ' places=' + lkSt.places.length);

  const LK1 = lkOf(lkSt);
  T('lk 六段全解析（名/境/率/纹/锁/成/次/结果）',
    LK1.name === '甲' && LK1.stage === 3 && LK1.rate === 62 && LK1.marks === 30
      && LK1.lock === 12 && LK1.succ === 2 && LK1.tries === 5
      && LK1.outcome === '险成' && (LK1.errs || []).length === 0,
    JSON.stringify({ n: LK1.name, s: LK1.stage, r: LK1.rate, m: LK1.marks,
      k: LK1.lock, sc: LK1.succ, t: LK1.tries, o: LK1.outcome, e: LK1.errs }));

  /* 卡面结构会变（v3.30.2 重排过），但「人读到的字」不该变 ——
     所以这几条断言看的是去掉标签后的文本，不是某个 class 里的片段。 */
  const textOf = (html) => String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  const lkHtml = api.render(lkSt);
  T('lk 渲染出 tc-lock，且 境 决定 class（s-3）', /class="tc-lock s-3"/.test(lkHtml),
    '缺 class="tc-lock s-3"');
  T('lk 渲染出 率 与 锁 读数', /62%/.test(textOf(lkHtml)) && /锁\+12%/.test(textOf(lkHtml)),
    '读到的字=' + textOf(lkHtml));
  T('lk 渲染出 纹/成/次/结果',
    /纹30%/.test(textOf(lkHtml)) && /成2/.test(textOf(lkHtml))
      && /次5/.test(textOf(lkHtml)) && /险成/.test(textOf(lkHtml)),
    '读到的字=' + textOf(lkHtml));

  /* 率 0%：合法值 —— 必须画一条 0% 的条，不许变成 miss 斜纹 */
  const lk0 = api.parseState('lk2: 乙 ｜ 阶 未开 ｜ 率 0% ｜ 纹 0 ｜ 锁 +0%');
  const LK0 = lkOf(lk0);
  const lk0Html = api.render(lk0);
  T('率 0% 是合法值（不被真值判断吃掉）', LK0.rate === 0 && (LK0.errs || []).length === 0,
    'rate=' + LK0.rate + ' errs=' + JSON.stringify(LK0.errs));
  T('率 0% 画零宽条、不落 miss 斜纹',
    /class="tc-lock s-0"/.test(lk0Html) && /tc-lk-fill" style="width:0%"/.test(lk0Html)
      && !/tc-lk-bar miss/.test(lk0Html),
    '零宽条没画出来或错落 miss');

  /* 坏值：四个字段各报一条，且卡面显示原文 */
  const lkBad = api.parseState('lk3: 丙 ｜ 阶 七阶 ｜ 率 六成 ｜ 纹 三 ｜ 锁 未知');
  const LKB = lkOf(lkBad);
  const LKB_ERRS = LKB.errs || [];
  T('阶/率/纹/锁 四个坏值全部报进 errs（不吞）', LKB_ERRS.length === 4, JSON.stringify(LKB_ERRS));
  const badHtml = api.render(lkBad);
  T('坏值卡面同时显示原文（率 六成 / 阶 七阶）', /六成/.test(badHtml) && /七阶/.test(badHtml),
    '原文没上卡面');
  T('率 坏值时不画假进度条（落 miss 斜纹）', /tc-lk-bar miss/.test(badHtml));

  /* 缺段：率 缺失不能假装 0% */
  const lkMiss = api.parseState('lk4: 丁 ｜ 阶 二阶');
  const LKM = lkOf(lkMiss);
  const LKM_ERRS = LKM.errs || [];
  T('缺 率 段必须报错（未开锁也要写 率 0%）',
    LKM.rate === null && /率 段/.test(LKM_ERRS.join('|')), JSON.stringify(LKM_ERRS));

  /* 截断：lk 在块中间不许吃掉后面的行（组 11 已通用覆盖，这条留「本键自己的现场」） */
  const lkBlk = api.extractBlock(['scene: 车库 | 夜 | 静', LK_SRC, 'next: 继续'].join('\n'));
  T('lk 行在块中间不截断（end=2 且 next 还在）',
    !!lkBlk && lkBlk.end === 2 && api.parseState(lkBlk.body).next === '继续',
    'end=' + (lkBlk && lkBlk.end));

  /* 阶 关键字省略也要认（`lk5: 戊 ｜ 四阶 ｜ 率 88%`）——裸段恰是阶名才算，别把名字当阶 */
  const lkNoKey = api.parseState('lk5: 戊 ｜ 四阶 ｜ 率 88%');
  const LK5 = lkOf(lkNoKey);
  T('阶 关键字可省（裸段恰为阶名时认作阶）', LK5.stage === 4, 'stage=' + LK5.stage);

  /* 纹 是**累计百分比**（v3.30.4 起）。旧规则是「道数 0-3」，三点阵表达不了 100% 的进度，
     已改成 40px 小进度条。判据一律取「条宽」与「提示元素在不在」，不取字面——
     因为坏值那条错误的文案里本来就含「旧写法」三个字（`纹 必须是百分比「N%」（旧写法 0-3 道也认）`），
     拿文字去认提示会假绿：坏值卡也会「看起来有旧写法提示」。 */
  const mbarOf = (html) => {
    const m = String(html).match(/class="tc-lk-mbar"[^>]*><i style="width:(\d+(?:\.\d+)?)%/);
    return m ? +m[1] : null;
  };
  const hasNote = (html) => /class="tc-lk-note"/.test(html);         /* 旧写法提示 */
  const hasMust = (html) => /class="tc-lk-note must"/.test(html);    /* → 下次必开 */

  T('纹 30% 解析成 30，进度条 30%（主写法，带 %）',
    lkOf(lkSt).marks === 30 && mbarOf(lkHtml) === 30,
    'marks=' + lkOf(lkSt).marks + ' bar=' + mbarOf(lkHtml));

  const lkP100 = api.parseState('lk4: 丁 ｜ 境 五阶 ｜ 率 97% ｜ 纹 100% ｜ 锁 -8%');
  T('纹 100%：条填满 + 追加「→ 下次必开」，且不报错',
    mbarOf(api.render(lkP100)) === 100 && hasMust(api.render(lkP100))
      && (lkOf(lkP100).errs || []).length === 0,
    'bar=' + mbarOf(api.render(lkP100)) + ' must=' + hasMust(api.render(lkP100))
      + ' errs=' + JSON.stringify(lkOf(lkP100).errs));

  const lkOld = api.parseState('lk5: 戊 ｜ 境 三阶 ｜ 率 62% ｜ 纹 2 ｜ 锁 +4%');
  T('纹 2（旧写法）折算 20%：出「旧写法」提示、不报错（静默按 2% 会让概率差 10 倍）',
    lkOf(lkOld).marks === 20 && lkOf(lkOld).marksLegacy === 2 && hasNote(api.render(lkOld))
      && (lkOf(lkOld).errs || []).length === 0,
    JSON.stringify({ m: lkOf(lkOld).marks, lg: lkOf(lkOld).marksLegacy,
      note: hasNote(api.render(lkOld)), e: lkOf(lkOld).errs }));

  T('纹 0（旧写法）折算 0%：条零宽仍然画（0 是合法值，不是缺失）',
    mbarOf(api.render(lk0)) === 0 && hasNote(api.render(lk0)),
    'bar=' + mbarOf(api.render(lk0)));

  /* 单错夹具：只坏 纹，错的原文才能落在卡面上（四错夹具里第 3 条被「＋2」折进 ⚠ 的 title） */
  const lkBadMark = api.parseState('lk8: 辛 ｜ 境 三阶 ｜ 率 62% ｜ 纹 三');
  const lbmHtml = api.render(lkBadMark);
  T('纹 三（坏值）：落 errs 一条、不画条、数字位落 —、原文上卡面',
    (lkOf(lkBadMark).errs || []).length === 1
      && mbarOf(lbmHtml) === null && /纹—/.test(textOf(lbmHtml))
      && /：三/.test(textOf(lbmHtml)),
    'errs=' + JSON.stringify(lkOf(lkBadMark).errs) + ' bar=' + mbarOf(lbmHtml)
      + ' 读到的字=' + textOf(lbmHtml).slice(0, 80));

  T('多条错误时只有前两条上卡面，其余折进 ⚠ 的 title（卡高不随错误条数变）',
    /＋2/.test(textOf(badHtml)) && /class="tc-lk-warn"[^>]*title="[^"]*纹 必须是百分比/.test(badHtml),
    '读到的字=' + textOf(badHtml).slice(0, 60));

  const lk120 = api.parseState('lk9: 壬 ｜ 境 四阶 ｜ 率 55% ｜ 纹 120% ｜ 锁 +0%');
  const lk150 = api.parseState('lk6: 己 ｜ 境 三阶 ｜ 率 62% ｜ 纹 150% ｜ 锁 +0%');
  T('纹 120%：errs 为空（>100% 是规则内的正常路径，不是坏值）、数字显 120%、条 100%、出必开提示',
    (lkOf(lk120).errs || []).length === 0 && lkOf(lk120).marks === 120
      && mbarOf(api.render(lk120)) === 100 && hasMust(api.render(lk120))
      && /纹120%/.test(textOf(api.render(lk120))),
    JSON.stringify({ e: lkOf(lk120).errs, m: lkOf(lk120).marks,
      bar: mbarOf(api.render(lk120)), must: hasMust(api.render(lk120)) }));

  T('纹 150%：数字照显 150%，进度条封顶 100%',
    lkOf(lk150).marks === 150 && mbarOf(api.render(lk150)) === 100
      && /纹150%/.test(textOf(api.render(lk150))),
    'marks=' + lkOf(lk150).marks + ' bar=' + mbarOf(api.render(lk150))
      + ' 读到的字=' + textOf(api.render(lk150)).slice(0, 60));

  const lkNoMark = api.parseState('lk7: 庚 ｜ 境 二阶 ｜ 率 40% ｜ 锁 +0%');
  T('无 纹 段：不出条、不出提示（缺省不是 0%）',
    mbarOf(api.render(lkNoMark)) === null && !hasNote(api.render(lkNoMark))
      && /纹—/.test(textOf(api.render(lkNoMark))),
    'bar=' + mbarOf(api.render(lkNoMark)) + ' 读到的字=' + textOf(api.render(lkNoMark)).slice(0, 60));

  /* 次 无：本轮没判过是常态（长休/整备/行军都不掷），不许挂错误条；
     但放宽只针对「无 / — / -」三个写法，别的乱写仍然要红。 */
  const lkNone = api.parseState('lk6: 沈知 ｜ 阶 四阶 ｜ 率 69% ｜ 纹 0 ｜ 锁 +0% ｜ 成 4 ｜ 次 无');
  const LKN = lkOf(lkNone);
  const lkNoneHtml = api.render(lkNone);
  T('次 无 是合法写法（errs 空、tries=null、卡面显示「次 无」）',
    (LKN.errs || []).length === 0 && LKN.tries === null && /次无/.test(textOf(lkNoneHtml)),
    'errs=' + JSON.stringify(LKN.errs) + ' tries=' + LKN.tries
      + ' 读到的字=' + textOf(lkNoneHtml));

  const lkDash = api.parseState('lk7: 沈知 ｜ 阶 四阶 ｜ 率 69% ｜ 纹 0 ｜ 锁 +0% ｜ 成 4 ｜ 次 —');
  const lkHyphen = api.parseState('lk8: 沈知 ｜ 阶 四阶 ｜ 率 69% ｜ 纹 0 ｜ 锁 +0% ｜ 成 4 ｜ 次 -');
  T('次 — 与 次 - 与 次 无 等价（三个写法都不报错）',
    (lkOf(lkDash).errs || []).length === 0 && (lkOf(lkHyphen).errs || []).length === 0,
    '—→' + JSON.stringify(lkOf(lkDash).errs) + ' -→' + JSON.stringify(lkOf(lkHyphen).errs));

  const lkBadTry = api.parseState('lk9: 沈知 ｜ 阶 四阶 ｜ 率 69% ｜ 纹 0 ｜ 锁 +0% ｜ 成 4 ｜ 次 五');

  /* 卡面重排（v3.30.2）：错误不占整行、纹锁成分三段、锁 +0% 淡显。
     这三条盯的都是「版面被谁占掉」，不是数值对错 —— 数值那几条在上面。 */
  const warnOf = (html) => {
    const m = String(html).match(/<span class="tc-lk-warn" title="([^"]*)"/);
    return m ? m[1] : null;
  };
  const BAD_TITLE = warnOf(badHtml);
  const errEmCount = (String(badHtml).match(/<div class="tc-lk-err">[\s\S]*?<\/div>/) || [''])[0]
    .split('<em>').length - 1;
  T('错误收成标题右端 ⚠ 标记（全文进 title，不再独占整行）',
    BAD_TITLE !== null && /六成/.test(BAD_TITLE) && /七阶/.test(BAD_TITLE) && errEmCount <= 3,
    'title=' + (BAD_TITLE === null ? '无' : BAD_TITLE) + ' 行内条数=' + errEmCount);

  const cellCount = (String(lkHtml).match(/class="tc-lk-cell/g) || []).length;
  T('纹/锁/成/次 各自成段（4 个 tc-lk-cell，不连排）', cellCount === 4, '格子数=' + cellCount);

  const lkZero = api.parseState('lk1: 沈知 ｜ 阶 未开 ｜ 率 0% ｜ 纹 0 ｜ 锁 +0% ｜ 成 0');
  T('锁 +0% 淡显（zero 态），非 0 才占视觉权重',
    /class="tc-lk-cell zero"/.test(api.render(lkZero)) && /class="tc-lk-cell up"/.test(lkHtml),
    'zero=' + /class="tc-lk-cell zero"/.test(api.render(lkZero))
      + ' up=' + /class="tc-lk-cell up"/.test(lkHtml));
  T('次 五 仍然报错（放宽没连坏值一起放过）',
    /次 必须是「N 结果」/.test((lkOf(lkBadTry).errs || []).join('|')),
    JSON.stringify(lkOf(lkBadTry).errs));

  /* ── 境 / 阶 ────────────────────────────────────────────────
     背景：lk 行的 阶 与 lock 行的 阶（四阶初/中/高）撞名又相邻，
     模型会把上一行原样抄进下一行，五张卡全 ⚠。改名 境。
     兼容只针对**键名**，值（未开/一阶~五阶）的枚举校验一点没松。 */

  const LK_J = lkOf(api.parseState('lk1: 甲 ｜ 境 四阶 ｜ 率 62% ｜ 纹 1 ｜ 锁 +5% ｜ 成 2 ｜ 次 45 成功'));
  T('境 四阶：解析成功、不报错', LK_J.stage === 4 && (LK_J.errs || []).length === 0,
    JSON.stringify({ s: LK_J.stage, e: LK_J.errs }));

  const lkJhtml = api.render(api.parseState('lk1: 甲 ｜ 境 四阶 ｜ 率 62% ｜ 纹 1 ｜ 锁 +5% ｜ 成 2 ｜ 次 45 成功'));
  T('境 四阶：卡面标签写「境」（人读到的字里同时有 境 和 四阶）',
    /境/.test(textOf(lkJhtml)) && /四阶/.test(textOf(lkJhtml)) && !/阶—/.test(textOf(lkJhtml)),
    '读到的字=' + textOf(lkJhtml).slice(0, 80));

  const LK_OLD = lkOf(api.parseState('lk2: 乙 ｜ 阶 四阶 ｜ 率 62% ｜ 纹 1 ｜ 锁 +5% ｜ 成 2 ｜ 次 45 成功'));
  T('阶 四阶（旧写法）：仍能解析，旧存档不崩（兼容的是键名，不是放宽值）',
    LK_OLD.stage === 4 && (LK_OLD.errs || []).length === 0,
    JSON.stringify({ s: LK_OLD.stage, e: LK_OLD.errs }));

  const LK_BAD_J = lkOf(api.parseState('lk3: 丙 ｜ 境 四阶初 ｜ 率 62% ｜ 纹 1 ｜ 锁 +5%'));
  T('境 四阶初：仍然报错（改名没顺手把枚举放宽）',
    /境 只认 未开\/一阶~五阶/.test((LK_BAD_J.errs || []).join('|')),
    JSON.stringify(LK_BAD_J.errs));

  const LK_BOTH = lkOf(api.parseState('lk4: 丁 ｜ 境 三阶 ｜ 阶 四阶 ｜ 率 62% ｜ 纹 1 ｜ 锁 +5%'));
  /* ── 死核对账（v3.31.0）：结果/世界文字说「没了」，但敌人 HP 还 > 0 ──
     判据是「有没有那条警告」（class tc-killwarn），不是「文本里有没有 ⚠」——
     ⚠ 在 lk 卡上也用，是同一个撞车（§7 第 27 条）。 */
  const MOB_ALIVE = 'mob1: 畸变体甲 ｜ 精英 ｜ HP 80/80';
  const MOB_DEAD = 'mob1: 畸变体甲 ｜ 精英 ｜ HP 0/80';
  const KW = (src) => api.render(api.parseState(src));
  const hasKill = (src) => /class="[^"]*tc-killwarn/.test(KW(src));

  T('A 有 mob hp>0 + result 含「自爆」→ 出警告，且点名谁/HP/还需扣多少',
    hasKill(MOB_ALIVE + '\nresult: 畸变体甲自爆')
      && /畸变体甲 HP 80\/80，还需扣 80/.test(KW(MOB_ALIVE + '\nresult: 畸变体甲自爆')),
    '警告条=' + hasKill(MOB_ALIVE + '\nresult: 畸变体甲自爆'));

  T('B 有 mob hp==0 + result 含「自爆」→ 不报（HP 到 0 之后自爆是合法的）',
    !hasKill(MOB_DEAD + '\nresult: 畸变体甲自爆'),
    '警告条=' + hasKill(MOB_DEAD + '\nresult: 畸变体甲自爆'));

  /* C 是这四条里最重要的一条：**没有敌人时，任何「死」字都不该被解释成击杀**。
     「死」是叙事词，不是数据；把叙事词当数据判，就是拿一句散文去起诉玩家。 */
  T('C 无 mob 行 + world 含「击杀」→ 不报（没有敌人就没得判，误报会训练人无视黄字）',
    !hasKill('world: 你击杀了窗口外的守卫')
      && !hasKill('result: 秒杀\nworld: 全场溃散'),
    '警告条=' + hasKill('world: 你击杀了窗口外的守卫'));

  T('D 有 mob hp>0 + result 干净 → 不报',
    !hasKill(MOB_ALIVE + '\nresult: 你打中了它的肩膀'),
    '警告条=' + hasKill(MOB_ALIVE + '\nresult: 你打中了它的肩膀'));

  T('警告认的是「活着的那个」，不是「第一个 mob」（死的不许替活的背锅）',
    /畸变体甲 HP 0\/80/.test(KW('mob1: 畸变体甲 ｜ 精英 ｜ HP 0/80\nmob2: 畸变体乙 ｜ 小兵 ｜ HP 30/60\nresult: 畸变体乙瓦解'))
      === false
      && /畸变体乙 HP 30\/60，还需扣 30/.test(KW('mob1: 畸变体甲 ｜ 精英 ｜ HP 0/80\nmob2: 畸变体乙 ｜ 小兵 ｜ HP 30/60\nresult: 畸变体乙瓦解')),
    '点名=' + (/畸变体乙 HP 30\/60/.test(KW('mob1: 畸变体甲 ｜ 精英 ｜ HP 0/80\nmob2: 畸变体乙 ｜ 小兵 ｜ HP 30/60\nresult: 畸变体乙瓦解')) ? '乙' : '错'));

  T('境 与 阶 同时出现：取 境（stage=3），并报一条明确的「不一致」',
    LK_BOTH.stage === 3 && /境\/阶 同时出现且不一致/.test((LK_BOTH.errs || []).join('|')),
    JSON.stringify({ s: LK_BOTH.stage, e: LK_BOTH.errs }));

  /* ───────── 组 17 · 折叠技能卡（kbmsk / kbfsk / sk）与上限并集 ─────────
     上限 5 若只数新键，玩家就能「内联 技 放 5 个 + kbmsk 再放 5 个」绕过它。
     所以并集是断言，不是实现细节。 */
  console.log('\n── 组 17 · 折叠技能卡与上限并集 ──');
  const R = (t) => api.render(api.parseState(t));
  const NL = '\n';
  const foldN = (h) => (h.match(/tc-skfl-n">([^<]*)</) || [])[1];
  const pips = (h) => {
    const inner = (h.match(/tc-skfl-pips">([\s\S]*?)<\/i>/) || [])[1] || '';
    return { total: (inner.match(/<s/g) || []).length, on: (inner.split('class="on"').length - 1) };
  };
  const isOver = (h) => /tc-skfold[^"]*over/.test(h);
  const mk = (i) => `技${i} 效果${i} ｜ 式 F${i} ｜ CD ${i} ｜ SP ${i}`;
  const P1 = 'p1: 我 ｜ HP 88/100';
  const SK5 = 'sk1: ' + [1, 2, 3, 4, 5].map(mk).join(' ; ');
  const SK6 = 'sk1: ' + [1, 2, 3, 4, 5, 6].map(mk).join(' ; ');
  const M1 = 'kbm1: 猎隼 ｜ 型 全包 ｜ HP 120/150';
  const MSK5 = [1, 2, 3, 4, 5].map(i => `技能${i} 效果${i} ｜ 式 F${i}`).join(' ; ');
  const hA = R(P1 + NL + SK5);
  const hB = R(P1 + NL + SK6);
  T('A 玩家 5 个技能 → 标题 5/5、五个方点全亮、不报警',
    foldN(hA) === '5/5' && pips(hA).on === 5 && !isOver(hA),
    JSON.stringify({ n: foldN(hA), pips: pips(hA), over: isOver(hA) }));
  T('B 玩家 6 个技能 → 标题 6/5 ⚠、黄字行出现',
    foldN(hB) === '6/5 ⚠' && isOver(hB) && /tc-skcap/.test(hB),
    JSON.stringify({ n: foldN(hB), over: isOver(hB), cap: /tc-skcap/.test(hB) }));
  T('方点恰好 5 个（上限是看得见的槽位，不随技能数增长）',
    pips(hB).total === 5 && pips(hA).total === 5,
    JSON.stringify({ a: pips(hA).total, b: pips(hB).total }));

  const hG = R(M1 + NL + 'kbmsk1: ' + MSK5);
  T('G kbmsk1 五个 → 机甲卡 5/5、不报警、走机甲主题',
    foldN(hG) === '5/5' && !isOver(hG) && /tc-skfold-kbm/.test(hG) && api.parseState(M1 + NL + 'kbmsk1: ' + MSK5).mechas[0].skillsNew.length === 5,
    JSON.stringify({ n: foldN(hG), over: isOver(hG), theme: /tc-skfold-kbm/.test(hG) }));

  const hH = R('kbm1: 猎隼 ｜ 型 全包 ｜ HP 120/150 ｜ 技 甲,乙,丙' + NL + 'kbmsk1: ' + MSK5);
  T('H 内联 3 + 新键 5 → 并集 8/5 ⚠（只数新键就能绕过上限）',
    foldN(hH) === '8/5 ⚠' && isOver(hH),
    JSON.stringify({ n: foldN(hH), over: isOver(hH) }));

  const hH2 = R('kbm1: 猎隼 ｜ 型 全包 ｜ HP 120/150 ｜ 技 技能1,乙' + NL + 'kbmsk1: ' + MSK5);
  T('H2 同名的算一个（内联含 技能1，新键也有 技能1 → 6 不是 7）',
    foldN(hH2) === '6/5 ⚠',
    '实际 ' + foldN(hH2) + '（若 7/5 = 没去重）');

  const stI = api.parseState('kbf1: 墨鸦 ｜ 族 兽 ｜ HP 40/60' + NL + 'kbf3: 赤瞳 ｜ 族 灵 ｜ HP 30/50' + NL + 'kbfsk3: 凝视 定身 ｜ CD 2 ｜ SP 3');
  T('I kbfsk3 → 挂第 3 只使魔，一串都不给 1 号',
    stI.familiars[0].skillsNew.length === 0 && stI.familiars[1].skillsNew.length === 1,
    JSON.stringify(stI.familiars.map(f => f.skillsNew.length)));

  const hJ = R([P1 + NL + SK5, M1 + NL + 'kbmsk1: ' + MSK5, 'kbf1: 墨鸦 ｜ 族 兽 ｜ HP 40/60' + NL + 'kbfsk1: 撕咬 破甲 ｜ 式 1D6'].join(NL));
  T('J 三个键同场 → 三张卡各自成立、互不吞并（cr/kbm/fam 各一份）',
    (hJ.match(/tc-skfold /g) || []).length === 3 && /tc-skfold-cr/.test(hJ) && /tc-skfold-kbm/.test(hJ) && /tc-skfold-fam/.test(hJ),
    JSON.stringify({ n: (hJ.match(/tc-skfold /g) || []).length, cr: /tc-skfold-cr/.test(hJ), kbm: /tc-skfold-kbm/.test(hJ), fam: /tc-skfold-fam/.test(hJ) }));

  T('K 展开后显示公式原文（式 F1）',
    /tc-sk-formula">F1</.test(hG) && /F1/.test(hG),
    '实际 ' + ((hG.match(/tc-sk-formula">([^<]*)</) || [])[1] || '(无)'));

  T('没有技能就不出折叠区（不许留一个空壳）',
    !/tc-skfold/.test(R(P1)) && !/tc-skfold/.test(R(M1)),
    JSON.stringify({ player: /tc-skfold/.test(R(P1)), mecha: /tc-skfold/.test(R(M1)) }));

  T('kbmsk1: 无 = 确实没有 → 不出折叠、也不留下一个名字叫「无」的技能',
    !/tc-skfold/.test(R(M1 + NL + 'kbmsk1: 无')) && api.parseState(M1 + NL + 'kbmsk1: 无').mechas[0].skillsNew.length === 0,
    JSON.stringify(api.parseState(M1 + NL + 'kbmsk1: 无').mechas[0].skillsNew));


}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}, 0);
