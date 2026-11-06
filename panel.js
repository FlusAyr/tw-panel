/* ══════════════════════════════════════════════════════════════
   TavernWeave · tw-state 卡片渲染器 v3
   承载：判定块(17项) / 玩家卡(属性·HP·SP·惩罚·状态·点数·支线·已兑换·基因锁·称号)
         / 技能 / 装备 / NPC / 关系(bond·foe) / NTR夺走(nb·nf·绯红主题) / 结果·世界涟漪·后续方向
   装法：酒馆助手 → 脚本 → 新建 → 粘贴全文 → 启用
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__twCardLoaded) return;
  window.__twCardLoaded = true;

  const VERSION = '3.29.0';

  /* 面板尺寸偏好：紧凑(tc-mini)/完整。localStorage 持久化，点击 .tc-size 全局切换 */
  const SIZE_KEY = 'tw-card:size';
  function isMini() {
    try { return localStorage.getItem(SIZE_KEY) === 'mini'; } catch (e) { return false; }
  }
  function setMini(v) {
    try { localStorage.setItem(SIZE_KEY, v ? 'mini' : 'full'); } catch (e) { /* 沙箱无存储时仅本次生效 */ }
    const wraps = DOC.querySelectorAll('.tc-wrap');
    for (const w of wraps) {
      w.classList.toggle('tc-mini', v);
      const btn = w.querySelector('.tc-size');
      if (btn) { btn.textContent = v ? '＋' : '－'; btn.title = v ? '切换到完整面板' : '切换到紧凑面板'; }
      const ver = w.querySelector('.tc-ver');
      if (ver) ver.textContent = 'tw-card v' + VERSION + (v ? ' · 紧凑' : '');
    }
  }
  /* 全局点击委托：面板会被 sweep 反复重建，监听必须挂在 document 上且只装一次 */
  function installSizeToggle() {
    if (DOC.__twSizeBound) return;
    DOC.__twSizeBound = true;
    DOC.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('.tc-size') : null;
      if (t) { e.preventDefault(); e.stopPropagation(); setMini(!isMini()); }
    }, true);
  }

  const DOC = (function () {
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        const d = window.parent.document;
        if (d && d.querySelectorAll) return d;
      }
    } catch (e) { /* fallback */ }
    return document;
  })();

  /* ══════════ 基础工具 ══════════ */

  const KEYS = 'scene|team|quest|check|result|world|next|bond[0-9]*|foe[0-9]*|nb[0-9]*|nf[0-9]*|nh[0-9]*|nd[0-9]*|nl[0-9]*|npc[0-9]*|kbnpc[0-9]*|ntrnpc[0-9]*|kbm[0-9]*|kbf[0-9]*|dmg[0-9]*|sh[0-9]*|dz[0-9]*|wh[0-9]*|pl[0-9]*|pts[0-9]+|lock[0-9]+|ti[0-9]+|cr[0-9]+|p[0-9]+|sk[0-9]+|eq[0-9]+|mob[0-9]*';
  const LINE_RE = new RegExp('^[ \\t]*(' + KEYS + ')[:：][ \\t]*(.*)$', 'i');
  /* 拓展键登记表（AGENTS.md §3.1 规则 7）四列：键前缀 | base 名 | 渲染器 | 主题 class
     （派生第五列 field = 状态对象存放字段）。编号一律按「键前缀长度」取，禁字面量偏移
     （实测 'kbnpc2'.slice(3) = 'pc2' → NaN）。漏主题 class 则与基础 NPC 同色，需求静默未实现。 */
  const EXT_KEYS = [
    { key: 'kbnpc', base: 'npc', field: 'kbnpcs', render: renderNpc, theme: 'tc-kb' },
    { key: 'ntrnpc', base: 'npc', field: 'ntrnpcs', render: renderNpc, theme: 'tc-ntr' },
  ];
  /* 拓展键分发：只认「登记过的键前缀 + 纯数字后缀」；编号 = 键前缀长度之后的部分，无后缀即 1 */
  const extHit = (k) => { const e = EXT_KEYS.find(x => k.startsWith(x.key) && (k.length === x.key.length || /^[0-9]+$/.test(k.slice(x.key.length)))); return e ? { e: e, num: k.length === e.key.length ? 1 : +k.slice(e.key.length) } : null; };

  /* 无键名 mob 裸文本识别（「变异体甲 精英 80/80」式——AI 抄面板/联机同步丢格式时兜底） */
  const MOB_GRADE_SRC = 'BOSS[^\\s|｜]*|Boss[^\\s|｜]*|头目|首领|精英|小兵|杂兵';
  const MOB_PLAIN_A = new RegExp('^(.{1,24}?)\\s*(' + MOB_GRADE_SRC + ')\\s+([0-9?]+\\s*\\/\\s*[0-9?]+)\\s*$');
  const isStateLine = (l) => LINE_RE.test(l) || MOB_PLAIN_A.test(l);

  const seg = (s) => String(s == null ? '' : s).split(/[|｜]/).map(x => x.trim()).filter(Boolean);
  const pair = (s) => { const m = String(s || '').match(/(\d+)\s*\/\s*(\d+)/); return m ? { cur: +m[1], max: +m[2] } : null; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ══════════ 解析 ══════════ */

  const ATTR_RE = /(STR|DEX|CON|INT|PER|CHA|WIL)\s*(-?\d+)(?:\s*\+\s*(-?\d+))?\s*(?:=\s*(\d+))?\s*(⚡)?/gi;
  const ATTR_ORDER = ['STR', 'DEX', 'CON', 'INT', 'PER', 'CHA', 'WIL'];
  const ATTR_STRIP_RE = /(STR|DEX|CON|INT|PER|CHA|WIL)\s*-?\d+(?:\s*\+\s*-?\d+)?(?:\s*=\s*\d+)?\s*(?:⚡)?/gi;

  function parseAttrs(x) {
    const out = [];
    ATTR_RE.lastIndex = 0;
    let m;
    while ((m = ATTR_RE.exec(x)) !== null) {
      const base = +m[2], add = m[3] ? +m[3] : 0;
      out.push({ k: m[1].toUpperCase(), base, add, total: m[4] ? +m[4] : base + add, over: !!m[5] });
    }
    return out;
  }

  const HEALTH = /^(健康|正常|完好|轻伤|中伤|重伤|濒死)$/;

  /* 玩家行：名字 | 徽章 | HP | SP | 负重 | MOV/DB | 属性… | 惩罚 | 状态… | 点数 | 支线 | 已兑换 | 基因锁 | 称号 */
  /* 机甲（kbm）：independent 血/装/属性。字段全部可缺，缺则不画。
     装 段被 seg() 按 ｜ 切开，故 '装 链锯剑' 之后的裸段一律续作装备名，直到遇到已知字段。 */
  const MECHA_ATTRS = ['力', '敏', '体', '智', '感', '魅'];

  /* 机甲血/能/SP 的数值格：只认 `N` 或 `N/M` 两种。第二段不是纯数字（`80/100/次`、`80/abc`）
     就**整格丢掉**，不取前半截 —— 显示一个"看起来正常"的错值，比不显示危险：
     不显示有人会问，显示错了没人问。丢的时候在 stderr 留一行，让它在控制台可见。

     ★ 全文件唯一允许的 console.warn（白名单见 tests/keys.test.js 的 WARN_WHITELIST）。
       禁令原本针对「未登记键」：给它加 warn 会让它看起来已被处理，把可见变静默。
       这里方向相反——把静默变可见。判据：这条 warn 出现时玩家看到的是「少了一块」
       还是「正常画面」？少一块 → 允许。 */
  function mechaPair(field, rest) {
    const m = String(rest).match(/^(\d+)(?:\s*\/\s*(\d+))?$/);
    if (m) return { cur: +m[1], max: m[2] == null ? null : +m[2] };
    console.warn('[tw-card] kbm 的 ' + field + ' 数值格不合法、已丢弃：', JSON.stringify(String(rest)));
    return null;
  }
  const MECHA_TYPES = { '人型': 'human', '重装': 'heavy', '全包': 'full' };
  /* 使魔（无限册 八节）：族 兽/灵/构造；签 三态 已缔结/待缔结/已解除。 */
  const FAMILIAR_RACES = { '兽': 'beast', '灵': 'spirit', '构造': 'construct' };
  const PACT_MAP = { '已缔结': 'on', '待缔结': 'wait', '已解除': 'off' };

  function parseMecha(v) {
    const p = seg(v);
    const o = { name: '', type: '', typeRaw: '', hp: null, en: null, sp: null, attrs: [], equip: [], extra: [], tags: [] };
    let inEquip = false;
    let inTag = false;
    for (let i = 0; i < p.length; i++) {
      const x = p[i].trim();
      if (!x) continue;
      if (!o.name && i === 0) { o.name = x; continue; }

      let m;
      if ((m = x.match(/^型(?:\s*[:：]\s*|\s+|$)(.+)$/))) { inTag = false; o.typeRaw = m[1].trim(); o.type = MECHA_TYPES[o.typeRaw] || ''; inEquip = false; continue; }
      if ((m = x.match(/^HP\s*(.+)$/i))) { inTag = false; o.hp = mechaPair('HP', m[1]); inEquip = false; continue; }
      if ((m = x.match(/^能(?:\s*[:：]\s*|\s+|$)(.+)$/))) { inTag = false; o.en = mechaPair('能', m[1]); inEquip = false; continue; }
      if ((m = x.match(/^SP\s*(.+)$/i))) { inTag = false; o.sp = mechaPair('SP', m[1]); inEquip = false; continue; }
      if ((m = x.match(/^装(?:\s*[:：]\s*|\s+|$)(.*)$/))) { inEquip = true; inTag = false; if (m[1].trim()) o.equip.push(m[1].trim()); continue; }
      if ((m = x.match(/^(力|敏|体|智|感|魅)[:：]?\s*(-?\d+)$/))) { o.attrs.push({ k: m[1], v: +m[2] }); inEquip = false; inTag = false; continue; }
      if ((m = x.match(/^自(?:\s*[:：]\s*|\s+|$)(.*)$/))) { inTag = true; inEquip = false; if (m[1].trim()) o.tags.push(m[1].trim()); continue; }

      /* 型 关键字被省略时的容错：裸段整段恰好是三种型之一、且当前还没有型 → 当作型。
         AI 省关键字是常态，世界书只能请求它、不能保证它；能在下游容错的地方不要只靠上游守规矩。
         但 `装` 之后的裸段是装备名（`装 全包护盾` 可能被切成 `全包` + `护盾` 式写法），
         那里不许改判成型号，否则一件装备会被读成整台机器的型。 */
      if (!o.type && !inEquip && MECHA_TYPES[x]) {
        inTag = false; o.typeRaw = x; o.type = MECHA_TYPES[x]; continue;
      }

      /* 自定数值：不认识 `名字 数字` / `名字 数字/数字` 就当拓展字段收下，不丢。
         与 nb 的 o.extra 同一套规矩（同一件事不写第二遍）—— 唯一区别：这里单值也画条，
         按 100 制估，因为机甲的自定刻度（核熔炉 / 装甲 / 散热）没有"上限"这个概念。 */
      if ((m = x.match(/^([^\s：:\/]{1,12})\s*(-?\d+)(?:\s*\/\s*(-?\d+))?$/))) {
        o.extra.push({ label: m[1], a: +m[2], b: m[3] == null ? null : +m[3] });
        inEquip = false; inTag = false; continue;
      }

      if (inEquip) { o.equip.push(x); continue; }
      /* 文本型自定：`自` 段之后的裸词，或任何进不了数值的形状（含 `90/100/次` 这种坏格）。
         原文照收、只当标签，不猜数值 —— 猜错会画出一根看起来正常的条。 */
      o.tags.push(x);
    }
    return o;
  }


  /* 使魔 kbf：数值格复用 mechaPair 的严格校验（第二段非纯数字 -> 整格丢弃，不取前半截），
     但**没有装上/驾驶关系**，所以不画归属竖线、不画驾驶中带子。 */
  function parseFamiliar(v) {
    const p = seg(v);
    const o = { name: '', race: '', raceRaw: '', hp: null, mp: null, loyal: null, attrs: [], skills: [], extra: [], tags: [], pact: '', pactRaw: '' };
    let inSkill = false;
    let inTag = false;
    for (let i = 0; i < p.length; i++) {
      const x = p[i].trim();
      if (!x) continue;
      if (!o.name && i === 0) { o.name = x; continue; }

      let m;
      if ((m = x.match(/^族\s*[:：]?\s*(.+)$/)) && FAMILIAR_RACES[m[1].trim()]) { inTag = false; inSkill = false; o.raceRaw = m[1].trim(); o.race = FAMILIAR_RACES[o.raceRaw]; continue; }
      if ((m = x.match(/^HP\s*(.+)$/i))) { inTag = false; inSkill = false; o.hp = mechaPair('HP', m[1]); continue; }
      if ((m = x.match(/^MP\s*(.+)$/i))) { inTag = false; inSkill = false; o.mp = mechaPair('MP', m[1]); continue; }
      if ((m = x.match(/^忠(?:\s*[:：]\s*|\s+|$)(.+)$/))) { inTag = false; inSkill = false; o.loyal = mechaPair('忠', m[1]); continue; }
      if ((m = x.match(/^技\s*[:：]?\s*(.*)$/)) && !/^技能?$/.test(x)) { inSkill = true; inTag = false; if (m[1].trim()) o.skills.push(m[1].trim()); continue; }
      if ((m = x.match(/^签\s*[:：]?\s*(.+)$/))) {
        inTag = false; inSkill = false;
        o.pactRaw = m[1].trim(); o.pact = PACT_MAP[o.pactRaw] || 'x'; continue;
      }
      if ((m = x.match(/^(力|敏|体|智|感|魅)[:：]?\s*(-?\d+)$/))) { o.attrs.push({ k: m[1], v: +m[2] }); inSkill = false; inTag = false; continue; }
      if ((m = x.match(/^自\s*[:：]?\s*(.*)$/))) { inTag = true; inSkill = false; if (m[1].trim()) o.tags.push(m[1].trim()); continue; }

      /* 族 关键字被省略时的容错（与「型」同款）：裸段整段恰是三种族之一且还没族 -> 当作族。
         `技` 之后的裸段是技能名，不许改判成族（强规则优先）。 */
      if (!o.race && !inSkill && FAMILIAR_RACES[x]) { inTag = false; o.raceRaw = x; o.race = FAMILIAR_RACES[x]; continue; }

      /* 规格外的 `名字 数字` / `名字 数字/数字` -> 自定数值，成条，不丢 */
      if ((m = x.match(/^([^\s：:\/]{1,12})\s*(-?\d+)(?:\s*\/\s*(-?\d+))?$/))) {
        o.extra.push({ label: m[1], a: +m[2], b: m[3] == null ? null : +m[3] });
        inSkill = false; inTag = false; continue;
      }

      if (inSkill) {
        if (!/\s/.test(x)) { o.skills.push(x); continue; }
        /* 带空格的段退出技组：技名是单词短语，`结 实冲撞` 这类多单词段更可能是别的字段，
           顶着「技」的标题显示它会冒充技能；落到 tags 至少不冒充（两边都不丢数据）。 */
        inSkill = false;
      }
      /* 其余（`结 实冲撞` 这类规格外文本段、`90/100/次` 这类坏格）只当标签，绝不猜数值 */
      o.tags.push(x);
    }
    return o;
  }

  /* ── 避难所 sh（海上浮岛 / 船坞 / 潜航）──
     与 kbm 的差别有两处：`型` 三值描述的是**载体形态**而不是战斗形态；`模` 之后是**不定长**的
     `名×级` 段（0..N 组），所以用开关而不是定长字段。
     非法数值格一律把**原文片段**塞进 o.errs 并在卡上画出来：静默丢格会画出一根看起来正常的条，
     比少一行字更难发现（§7 第 22 条：报元素，不报数量）。 */
  const SHELTER_TYPES = { '浮岛': 'isle', '船坞': 'dock', '潜航': 'sub' };
  const SHELTER_RES = [['hull', '耐久'], ['hold', '舱'], ['power', '电'], ['food', '食'], ['temp', '温']];
  const SHELTER_KEY = { '耐久': 'hull', '舱': 'hold', '电': 'power', '食': 'food', '温': 'temp' };

  /* 五项资源都有上限，所以两段缺一不可：只写 `82` 不是「满格 82」，是「上限没给」——
     这里不走 mechaPair 的单值宽松路径，缺 B 侧就整格丢弃并报原文。 */
  function shelterPair(field, rest, errs) {
    const s = String(rest == null ? '' : rest).trim();
    const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) return { cur: +m[1], max: +m[2] };
    errs.push(field + ' 数值格不合法：' + s);
    return null;
  }

  function shelterMod(o, x) {
    const s = String(x).trim();
    /* 「无」是内容侧写「这艘船没有改装件」的常态写法，不是一段缺了 ×级 的模组名。 */
    if (/^(无|—|－|-|暂无|none)$/i.test(s)) return;
    const m = s.match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
    if (m) { o.mods.push({ name: m[1].trim(), lv: +m[2] }); return; }
    /* 少了 ×级 的模组名照收（不丢数据），但要报出来：模组行是「有什么设备」，
       不是「等级几」——收下名字、标出缺级，比整段扔掉更接近原文。 */
    o.mods.push({ name: s, lv: null });
    o.errs.push('模 段缺少 ×级：' + s);
  }

  function parseShelter(v) {
    const raw = String(v == null ? '' : v);
    const p = seg(raw);
    const o = {
      name: '', type: '', typeRaw: '',
      hull: null, hold: null, power: null, food: null, temp: null,
      def: null, mods: [], errs: [], raw,
    };
    let inMod = false;
    for (let i = 0; i < p.length; i++) {
      const x = p[i].trim();
      if (!x) continue;
      if (!o.name && i === 0) { o.name = x; continue; }

      let m;
      if ((m = x.match(/^型(?:\s*[:：]\s*|\s+|$)(.+)$/))) {
        o.typeRaw = m[1].trim();
        o.type = SHELTER_TYPES[o.typeRaw] || '';
        inMod = false;
        if (!o.type) o.errs.push('型 不在三值内：' + x);
        continue;
      }
      if ((m = x.match(/^(耐久|舱|电|食|温)(?:\s*[:：]\s*|\s+|$)(.+)$/))) {
        o[SHELTER_KEY[m[1]]] = shelterPair(m[1], m[2], o.errs);
        inMod = false; continue;
      }
      if ((m = x.match(/^防(?:\s*[:：]\s*|\s+|$)(.+)$/))) {
        const d = m[1].trim();
        if (/^-?\d+$/.test(d)) o.def = +d;
        else o.errs.push('防 不是数字：' + d);
        inMod = false; continue;
      }
      if ((m = x.match(/^模(?:\s*[:：]\s*|\s+|$)(.*)$/))) {
        inMod = true;
        if (m[1].trim()) shelterMod(o, m[1]);
        continue;
      }
      if (inMod) { shelterMod(o, x); continue; }

      /* 型 关键字被省略时的容错（与 kbm 同款）：裸段整段恰是三型之一且还没型 → 当作型。
         `模` 之后的裸段是模组名，不许改判成型（那里改了就是把一台设备读成载体形态）。 */
      if (!o.type && SHELTER_TYPES[x]) { o.typeRaw = x; o.type = SHELTER_TYPES[x]; continue; }

      o.errs.push('无法归类的段：' + x);
    }
    return o;
  }

  /* ── 灾变 dz ──
     一行里四件事：名称 / 级 1-5 / 余 N 回合 / 效 一句。`效` 之后被 ｜ 切开的裸段接回同一句，
     因为那句话本来就可能带竖线（`舱 -1 ｜ 电 -2`）。 */
  function parseDisaster(v) {
    const raw = String(v == null ? '' : v);
    const p = seg(raw);
    const o = { name: '', level: null, left: null, effect: '', errs: [], raw };
    for (let i = 0; i < p.length; i++) {
      const x = p[i].trim();
      if (!x) continue;
      if (!o.name && i === 0) { o.name = x; continue; }

      let m;
      if ((m = x.match(/^级(?:\s*[:：]\s*|\s+|$)(.+)$/))) {
        const s = m[1].trim();
        if (/^\d+$/.test(s) && +s >= 1 && +s <= 5) o.level = +s;
        else o.errs.push('级 必须是 1-5：' + s);
        continue;
      }
      if ((m = x.match(/^余(?:\s*[:：]\s*|\s+|$)(.+)$/))) {
        const s = m[1].trim();
        /* `余 0` 是合法终局（本回合结束后平息）：不许用真值判断，否则 0 会被当成"没写" */
        if (/^\d+$/.test(s)) o.left = +s;
        else o.errs.push('余 必须是非负整数：' + s);
        continue;
      }
      if ((m = x.match(/^效(?:\s*[:：]\s*|\s+|$)(.*)$/))) {
        if (m[1].trim()) o.effect = o.effect ? o.effect + ' ' + m[1].trim() : m[1].trim();
        continue;
      }
      /* 规格外的裸段：接着写进 效（这一段本来就是自由文字），不丢、也不冒充别的字段 */
      o.effect = o.effect ? o.effect + ' ' + x : x;
    }
    return o;
  }

  /* ── 仓储 wh ──
     `名×数[注]` 一段一件，段数 0..16，空仓写 `wh: 无`。
     这一行是**玩家资产的唯一载体**：解析的第一原则是「一件都不能丢」，好看排第二——
     所以认不出 `×数` 的段不跳过，原样收成一件（qty=null）再报原文；
     名字与注的长度不设限（内容侧是骰池生成，AI 会造「军用密封声呐探头」这种组合词），
     长度约束交给内容侧，渲染器只负责把它完整画出来。 */
  const WH_MAX = 16;

  function parseWarehouse(v) {
    const raw = String(v == null ? '' : v);
    const p = seg(raw);
    const o = { items: [], errs: [], raw };
    for (const s0 of p) {
      const x = s0.trim();
      if (!x) continue;
      /* 空仓的几种写法。只在「还没有任何一件」时生效：`无` 出现在第 3 段不能清空前两件 */
      if (!o.items.length && /^(无|—|－|-|暂无|空|none)$/i.test(x)) continue;

      const m = x.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*(?:[[［【]([^\]］】]*)[\]］】])?$/);
      if (m) {
        const name = m[1].trim();
        const qty = +m[2];
        const note = (m[3] || '').trim();
        /* `×0` 不是「没有」，是写错了：件数收下为 null 并报原文，不把这一件抹掉 */
        if (qty > 0) o.items.push({ name, qty, note });
        else { o.items.push({ name, qty: null, note }); o.errs.push('件数必须是正整数：' + x); }
        continue;
      }
      o.items.push({ name: x, qty: null, note: '' });
      o.errs.push('缺 ×件数：' + x);
    }
    if (o.items.length > WH_MAX) {
      o.errs.push('超过 ' + WH_MAX + ' 段（' + o.items.length + '）：全部照常显示，不截断');
    }
    return o;
  }

  /* ── 场所 pl ──
     四段固定：名称 / 型 / 存 N / 特 一句。`型` 命中六类就走对应配色；
     **清单外的型不报错**（生成引擎一定会造出没列过的型），走灰色兜底并把原词显示出来——
     报错等于把 AI 生成的东西判成坏的，玩家会以为是自己写错了。 */
  const PLACE_TYPES = { '市场': 'market', '遗迹': 'ruin', '营地': 'camp', '险地': 'peril', '浮标': 'buoy', '船队': 'fleet' };

  function parsePlace(v) {
    const raw = String(v == null ? '' : v);
    const p = seg(raw);
    const o = { name: '', type: '', typeRaw: '', store: null, feature: '', errs: [], raw };
    for (let i = 0; i < p.length; i++) {
      const x = p[i].trim();
      if (!x) continue;
      if (!o.name && i === 0) { o.name = x; continue; }

      let m;
      if ((m = x.match(/^型(?:\s*[:：]\s*|\s+|$)(.+)$/))) {
        o.typeRaw = m[1].trim();
        o.type = PLACE_TYPES[o.typeRaw] || '';
        continue;
      }
      if ((m = x.match(/^存(?:\s*[:：]\s*|\s+|$)(.+)$/))) {
        const s = m[1].trim();
        /* `存 0` 合法（本回合后消失）：不许用真值判断 */
        if (/^\d+$/.test(s)) o.store = +s;
        else o.errs.push('存 必须是非负整数：' + s);
        continue;
      }
      if ((m = x.match(/^特(?:\s*[:：]\s*|\s+|$)(.*)$/))) {
        if (m[1].trim()) o.feature = o.feature ? o.feature + ' ' + m[1].trim() : m[1].trim();
        continue;
      }
      /* 型 关键字省略的容错：裸段整段恰是六型之一且还没给型 → 当作型 */
      if (!o.typeRaw && PLACE_TYPES[x]) { o.typeRaw = x; o.type = PLACE_TYPES[x]; continue; }
      /* 规格外的裸段接进 特（那里本来就是自由文字）：不丢、也不冒充别的字段 */
      o.feature = o.feature ? o.feature + ' ' + x : x;
    }
    return o;
  }

  function parsePlayer(v) {
    const p = seg(v);
    const o = {
      name: p[0] || '', badge: '', hp: null, sp: null, weight: null,
      mov: null, db: null, attrs: [], penalty: '', status: [],
      pts: '', sub: '', blood: '', lock: '', title: '', weapon: '',
    };
    const ratios = [];

    for (let i = 1; i < p.length; i++) {
      const x = p[i].trim();
      if (!x) continue;

      if (!o.badge && HEALTH.test(x.replace(/[:：]/g, ''))) { o.badge = x; continue; }
      if (/^\d+\s*\/\s*\d+\s*(kg)?$/i.test(x)) { ratios.push(pair(x)); continue; }

      const at = parseAttrs(x);
      const mv = x.match(/MOV\s*(\d+)/i), db = x.match(/\bDB\s*(\d+)/i);
      if (at.length || mv || db) {
        o.attrs.push(...at);
        if (mv) o.mov = +mv[1];
        if (db) o.db = +db[1];
        continue;
      }

      if (!o.penalty && /(惩罚|HP正常|HP轻伤|HP中伤|HP重伤|HP濒死|SP正常|SP异常|合计)/.test(x)) { o.penalty = x; continue; }
      if (o.penalty && /^(HP|SP|合计|⚠️?\s*合计)/.test(x)) { o.penalty += ' ｜ ' + x; continue; }

      let m;
      if ((m = x.match(/^(?:💰\s*)?(?:奖励点数|点数)[：:]?\s*([\s\S]*)$/))) { o.pts = m[1].trim(); continue; }
      if ((m = x.match(/^(?:📜\s*)?(?:支线剧情|支线)[：:]?\s*([\s\S]*)$/))) { o.sub = m[1].trim(); continue; }
      if (/^(?:🧬\s*)?已兑换/.test(x)) {
        o.blood = x.replace(/^(?:🧬\s*)?已兑换[：:]?\s*/, '').trim();
        // 「已兑换 A级·X ｜ 三阶基因锁(初窥)」——把基因锁拆出来单独呈现
        const lk = o.blood.match(/([一二三四五]阶基因锁[^｜|]*)/);
        if (lk) {
          o.lock = lk[1].trim();
          o.blood = o.blood.replace(lk[0], '').replace(/[｜|]\s*$/, '').trim();
        }
        continue;
      }
      if (/基因锁/.test(x) && !o.lock) { o.lock = x.trim(); continue; }
      if ((m = x.match(/^(?:🏆\s*)?称号[：:]?\s*([\s\S]*)$/))) { o.title = m[1].trim(); continue; }

      if (/\d+[Dd]\d+|伤害|破甲|穿甲|减伤/.test(x) && !o.weapon) { o.weapon = x; continue; }

      o.status.push(x);
    }

    if (ratios.length >= 1) o.hp = ratios[0];
    if (ratios.length >= 2) o.sp = ratios[1];
    if (ratios.length >= 3) o.weight = ratios[2];
    return o;
  }

  function parseSkills(v) {
    return String(v || '').split(/[;；]/).map(s => s.trim())
      .filter(s => s && !/^(无|—|-|暂无)$/.test(s)).map(s => {
        const segs = seg(s);
        const head = segs[0] || '';
        const m = head.match(/^(\S+)[ \t]*(.*)$/);
        const o = { name: m ? m[1] : head, effect: m ? m[2] : '', cd: '', sp: '' };
        const rest = [];
        for (let i = 1; i < segs.length; i++) {
          const t = segs[i];
          const cdm = t.match(/(?:CD|冷却)[\s:：]*([^\s｜|/]+)/i);
          const spm = t.match(/SP[\s:：]*([^\s｜|/]+)/i);
          let used = false;
          if (cdm && !o.cd) { o.cd = cdm[1]; used = true; }
          if (spm && !o.sp) { o.sp = spm[1]; used = true; }
          if (used) continue;
          rest.push(t);
        }
        if (!o.effect) o.effect = rest.join(' ');
        return o;
      });
  }

  /* 无限恐怖册专用：pts / lock / ti 三行 */
  function parsePts(v) {
    const p = seg(v);
    const o = { total: '', ranks: '' };
    for (const x of p) {
      if (!o.total && /^[0-9]+$/.test(x)) { o.total = x; continue; }
      if (!o.ranks && /[DCBAS]\d/i.test(x)) { o.ranks = x; continue; }
      if (!o.total) o.total = x; else o.ranks = o.ranks ? o.ranks + ' ' + x : x;
    }
    return o;
  }

  function parseLock(v) {
    const p = seg(v);
    const o = { stage: p[0] || '', devil: '', over: '', cool: '' };
    for (const x of p.slice(1)) {
      let m;
      if ((m = x.match(/^心魔\s*([^\s｜|]*)/))) o.devil = m[1].trim();
      else if ((m = x.match(/(?:本场)?超标\s*([0-9]+\s*\/\s*[0-9]+)/))) o.over = m[1].replace(/\s/g, '');
      else if ((m = x.match(/^冷却\s*([^\s｜|]*)/))) o.cool = m[1].trim();
    }
    return o;
  }

  function parseTi(v) {
    const p = seg(v);
    const o = { cn: p[0] || '', en: '', state: '' };
    if (p[0] && p[0].includes('/')) {
      const parts = p[0].split('/');
      o.cn = parts[0].trim();
      o.en = parts.slice(1).join('/').trim();
    }
    if (p[1]) o.state = p[1].trim();
    return o;
  }

  /* 自定义资源行：cr1: 幸运LP 12/12 ｜ 幸运因果债 0 → [{name,val},...] */
  function parseCr(v) {
    return seg(v).map(x => {
      const m = x.match(/^(.+?)\s*[:：]?\s+([^:：]+)$/) || x.match(/^(.+?)[:：]\s*(.+)$/);
      return m ? { name: m[1].trim(), val: m[2].trim() } : { name: x.trim(), val: '' };
    });
  }

  /* 装备行：主手 x | 副手 x | 护甲 x | … | 负重 a/b 状态 | 加成 x
     seg 会把 "负重 | 13/45" 拆成两段，所以按「槽位名 → 取下一段」成对推进 */
  const EQ_SLOTS = /^(主手武器|主手|副手·盾牌|副手|护甲|杂物·项链|杂物|项链|戒指|饰品|消耗品|披风|腰带|靴子|头饰|加成|装备总加成|总加成|负重|重量)$/;

  function parseEquip(v) {
    const s = seg(v);
    const o = { slots: [], weight: null, wstate: '', bonus: '' };
    for (let i = 0; i < s.length; i++) {
      let k = s[i], val = '';
      if (EQ_SLOTS.test(k)) {
        val = (i + 1 < s.length && !EQ_SLOTS.test(s[i + 1])) ? s[++i] : '';
      } else {
        const m = k.match(/^(\S+?)[\s:：]+([\s\S]*)$/);
        if (m) { k = m[1]; val = m[2].trim(); }
        else { o.slots.push({ k: '', v: k }); continue; }
      }
      if (/^(负重|重量)$/.test(k)) {
        const pr = pair(val);
        if (pr) o.weight = pr;
        const st = val.match(/\[?状态[：:]\s*([^\]]+)\]?/);
        if (st) o.wstate = st[1].trim();
        continue;
      }
      if (/^(加成|装备总加成|总加成)$/.test(k)) { o.bonus = val; continue; }
      o.slots.push({ k, v: val });
    }
    return o;
  }

  const CHECK_KEYS = {
    '类别': 'cat', '适用属性': 'attr', '属性': 'attr',
    '阈值': 'base', '基础阈值': 'base',
    'DL': 'dl', 'DL修正': 'dl',
    '边界': 'edge', '边界修正': 'edge', '边界限制': 'edgelimit',
    '惩罚': 'pen', '状态惩罚': 'pen',
    '超限': 'over', '超限修正': 'over', '超限追加': 'overadd',
    '修正后': 'final', '修正后阈值': 'final',
    '掷出': 'roll', '掷出结果': 'roll',
    '等级': 'grade', '判定等级': 'grade',
    '层级': 'tier', '成果层级': 'tier',
    '检索': 'search', '检索进度': 'search',
    'AD': 'ad', '对抗差值': 'ad', '对抗差值(AD)': 'ad',
    '注视': 'gaze', '世界注视': 'gaze',
    '消耗': 'cost', '超限消耗': 'cost',
    '大失败': 'critfail', '大失败范围': 'critfail',
    '判定类别': 'cat', '检定类别': 'cat',
    '简述': 'note', '判定简述': 'note',
  };

  function parseCheck(v) {
    const s = String(v || '').trim();
    if (/^(无|none|—|-)$/i.test(s) || /^(无|—|-)\s*[|｜]/.test(s)) {
      return { none: true, reason: s.replace(/^(无|—|-)\s*[|｜]?\s*/, '').trim() };
    }
    const p = seg(v);
    const o = { none: false, title: p[0] || '', fields: [] };
    for (const x of p.slice(1)) {
      const m = x.match(/^([^\s:：]{1,12})[\s:：]+([\s\S]*)$/);
      if (m && CHECK_KEYS[m[1]]) { o[CHECK_KEYS[m[1]]] = m[2].trim(); continue; }
      o.fields.push(x);
    }
    return o;
  }

  function parseQuest(v) {
    const raw = String(v || '');
    const segs = raw.split(/[;；]/).map(s => s.trim()).filter(Boolean);
    const o = { main: { goal: '', time: '', fail: '' }, subs: [] };
    if (!segs.length) return o;

    /* 首段 = 主线部分。字段可能用 | 分隔，也可能连成一串 */
    const first = segs[0];
    const fields = first.split(/[|｜]/).map(s => s.trim()).filter(Boolean);
    for (const f of fields) {
      let m;
      if ((m = f.match(/^(?:时限|剩余|限时)[\s:：]*(.*)$/))) { o.main.time = m[1].trim(); continue; }
      if ((m = f.match(/^失败[\s:：]*(.*)$/))) { o.main.fail = m[1].trim(); continue; }
      if ((m = f.match(/^主线[\s:：]*(.*)$/))) { o.main.goal = m[1].trim(); continue; }
      if (!o.main.goal) o.main.goal = f;
    }
    /* 没有分隔符的写法：主线 … 时限 6小时 失败 全员抹杀 */
    if (!o.main.time && !o.main.fail) {
      const m1 = first.match(/(?:时限|剩余|限时)[\s:：]*([^｜|;；]+)/);
      const m2 = first.match(/失败[\s:：]*([^｜|;；]+)/);
      if (m1) o.main.time = m1[1].trim();
      if (m2) o.main.fail = m2[1].trim();
      if (m1 || m2) {
        o.main.goal = first.replace(/^主线[\s:：]*/, '')
          .replace(/(?:时限|剩余|限时).*$/, '').replace(/失败.*$/, '').trim();
      }
    }
    o.main.goal = o.main.goal.replace(/[|｜]\s*$/, '').trim();

    for (let i = 1; i < segs.length; i++) {
      const s = segs[i];
      const st = s.match(/(进行中|未完成|已完成|失败|已放弃|待触发|可触发)/);
      const name = s.replace(/^支线[：:]?/, '')
        .replace(/(进行中|未完成|已完成|失败|已放弃|待触发|可触发).*$/, '').trim();
      if (name && !/^(无|—|-|无[\s、,，|｜/·]*无?)$/.test(name)) o.subs.push({ name, status: st ? st[1] : '' });
    }
    return o;
  }

  function parseBond(v) {
    const p = seg(v);
    const o = { name: p[0] || '', love: null, crush: null, foeLove: null, train: null, trainYou: null, submit: null, submitYou: null, role: '', roleRaw: '', kink: null, lewd: null, lewdMask: null, defLost: null, defTotal: 5, defName: '', stage: null, stageName: '', trace: null, extra: [] };
    /* 数值按「形态」收，不按字段名收：`名字 数字` 或 `名字 数字/数字`（前=A 侧，后=B 侧）。
       面板不认识是哪本世界书 —— 书里多写一个 `xx 30/70` 这里也认，不用改代码。
       缺的那一侧一律 null，绝不用另一侧顶替：旧卡本来没有这一侧的数据，补一个值等于伪造。 */
    const num = (t) => { const m = String(t).match(/^\s*(-?\d+)(?:\s*\/\s*(-?\d+))?/); return m ? [+m[1], m[2] == null ? null : +m[2]] : null; };
    const NUM_FIELDS = [['爱', 'love'], ['恋', 'crush'], ['敌', 'foeLove'], ['调', 'train', 'trainYou'], ['屈', 'submit', 'submitYou']];
    for (const x of p.slice(1)) {
      let m, r;
      const hit = NUM_FIELDS.find((f) => x.startsWith(f[0]) && /^\s*-?\d/.test(x.slice(f[0].length)));
      if (hit) {
        r = num(x.slice(hit[0].length));
        if (r) { o[hit[1]] = r[0]; if (hit[2]) o[hit[2]] = r[1]; }
      }
      else if ((m = x.match(/^防线\s*(\d+)\s*\/\s*(\d+)\s*([^（(]*)/))) { o.defLost = +m[1]; o.defTotal = +m[2]; o.defName = m[3].trim(); }
      else if ((m = x.match(/^期\s*(\d+)\s*(.*)$/))) { o.stage = +m[1]; o.stageName = m[2].trim(); }
      else if ((m = x.match(/^淫\s*(-?\d+)\s*(?:[（(]\s*压\s*(\d+)\s*[)）])?/))) { o.lewd = +m[1]; if (m[2]) o.lewdMask = +m[2]; }
      else if ((m = x.match(/^迹\s*(\d+)/))) o.trace = +m[1];
      /* 位（受害/被夺/夺取）与 癖（0-100）只能写在 nb 行内。写成独立键行会让 extractBlock 停在该行，
         吞掉其后全部状态行（表现为面板少栏 + 裸文本漏出），而且不报错 —— 契约硬规则。 */
      else if ((m = x.match(/^位\s*([\s\S]*)$/))) { o.roleRaw = m[1].trim(); o.role = /^(受害|被夺|夺取)$/.test(o.roleRaw) ? o.roleRaw : '受害'; }
      else if ((m = x.match(/^癖\s*(\d+)/))) o.kink = Math.max(0, Math.min(100, +m[1]));
      /* 兜底：任何未知的「名字 数字(/数字)」都收进 extra，按形态渲染 —— 不认识的名字也不丢。 */
      else if ((m = x.match(/^\s*([^\s：:\/]{1,12})\s*(-?\d+)(?:\s*\/\s*(-?\d+))?\s*$/))) {
        o.extra.push({ label: m[1], a: +m[2], b: m[3] == null ? null : +m[3] });
      }
    }
    return o;
  }

  function parseFoe(v) {
    const p = seg(v);
    const o = { name: p[0] || '', method: p[1] || '', step: null, total: 5, weak: '' };
    for (const x of p.slice(2)) {
      let m;
      if ((m = x.match(/^攻势\s*(\d+)\s*\/\s*(\d+)/))) { o.step = +m[1]; o.total = +m[2]; }
      else if ((m = x.match(/^弱点\s*([\s\S]*)$/))) o.weak = m[1].trim();
    }
    return o;
  }

  /* nh 行（NTR 心声）：nh: 沈栀 | 对你 他今天又没回来吃饭 | 对他 他只是懂我 | 心 罪疚,渴求,自我说服 | 白 「只要不摊牌，这个家就还能装作完好」
     每个伴侣一条：对主角/对加害者的短句看法 + 心理状态 + 内心独白 */
  function parseNtrHeart(v) {
    const p = seg(v);
    const o = { name: (p[0] || '').trim(), toUser: '', toRival: '', mind: [], inner: '' };
    for (let i = 1; i < p.length; i++) {
      const x = p[i];
      let m;
      if ((m = x.match(/^对(?:你|主角|玩家)\s*([\s\S]*)$/))) o.toUser = m[1].trim();
      else if ((m = x.match(/^对(?:他|加害者|奸夫)\s*([\s\S]*)$/))) o.toRival = m[1].trim();
      else if ((m = x.match(/^心(?:理|理状态)?\s*([\s\S]*)$/))) o.mind = m[1].split(/[·、,，|｜]/).map(s => s.trim()).filter(Boolean);
      else if ((m = x.match(/^(?:白|内心|独白)\s*([\s\S]*)$/))) o.inner = m[1].trim();
    }
    return o;
  }

  /* nd 行（NTR 防线档案）：nd: 沈栀 | 界限 失守 4月6日 虚假死证胁迫 | 称谓 回填 12月16日 绝对治愈 | 独处 在守 ...
     每段 = 防线名 + 状态(失守/回填/在守) + 日期 + 经过备注 */
  function parseNtrFalls(v) {
    const p = seg(v);
    const o = { name: (p[0] || '').trim(), rows: [] };
    const DATE = '[0-9一二三四五六七八九十百]+月[0-9一二三四五六七八九十百日前后上下]*|^[0-9]+$';
    for (let i = 1; i < p.length; i++) {
      const x = p[i];
      const m = x.match(new RegExp('^(.*?)(失守|回填|在守|未失守)\\s*(' + DATE + ')?\\s*(.*)$'));
      if (m && m[2]) {
        o.rows.push({ name: m[1].trim(), status: m[2], date: (m[3] || '').trim(), note: (m[4] || '').trim() });
      } else {
        /* 无状态关键词的段落：首个词 = 防线名，其余 = 日期或备注 */
        const sp = x.trim().split(/\s+/);
        const rest = sp.slice(1).join(' ');
        const isDate = /^\s*[0-9一二三四五六七八九十百]+月/.test(rest);
        o.rows.push({ name: sp[0] || '', status: '', date: isDate ? rest : '', note: isDate ? '' : rest });
      }
    }
    return o;
  }

  /* nl 行（NTR 暗流事件）：nl: 4月6日 | 界限失守 | 经过 靳渊持伪造死证突入工坊 | 她 为保你自愿交出防线 | 你 不知情
     你=知情/不知情；不知情的事件渲染时雾化，体现主角被蒙在鼓里 */
  function parseNtrLog(v) {
    const p = seg(v);
    const o = { date: (p[0] || '').trim(), title: (p[1] || '').trim(), what: '', her: '', known: '' };
    for (let i = 2; i < p.length; i++) {
      const x = p[i];
      let m;
      if ((m = x.match(/^经过\s*([\s\S]*)$/))) o.what = m[1].trim();
      else if ((m = x.match(/^她\s*([\s\S]*)$/))) o.her = m[1].trim();
      else if ((m = x.match(/^你\s*([\s\S]*)$/))) o.known = m[1].trim();
    }
    return o;
  }

  /* nf 行（NTR 加害者）：nf: 靳渊 | 身份 特调局官员 | 手段 权力胁迫 | 攻势 5/5 | 弱点 无底线的自负
     兼容 foe 旧式位置制：nf: 沈砚 | 情感渗透 | 攻势 3/5 | 弱点 前妻 */
  function parseNtrFoe(v) {
    const p = seg(v);
    const o = { name: p[0] || '', role: '', method: p[1] || '', step: null, total: 5, weak: '' };
    let start = 2;
    if (p.length > 1 && /^(身份|职业)\s*/.test(p[1])) { o.role = p[1].replace(/^(身份|职业)\s*/, '').trim(); start = 2; }
    if (p.length > 2 && /^(手段|主用手段)\s*/.test(p[2])) { o.method = p[2].replace(/^(手段|主用手段)\s*/, '').trim(); start = 3; }
    for (const x of p.slice(start)) {
      let m;
      if ((m = x.match(/^(?:次用手段|次手段)\s*(.*)$/))) o.method2 = m[1].trim();
      else if ((m = x.match(/^攻势\s*(\d+)\s*\/\s*(\d+)/))) { o.step = +m[1]; o.total = +m[2]; }
      else if ((m = x.match(/^弱点\s*([\s\S]*)$/))) o.weak = m[1].trim();
      else if (!o.role && /^(身份|职业)\s*/.test(x)) o.role = x.replace(/^(身份|职业)\s*/, '').trim();
    }
    return o;
  }

  /* npc 行：npc1: 姓名 ｜ 身份 xx ｜ 态度 xx ｜ 状态 xx ｜ 备注 xx
     同时兼容世界书口径：npc: 名称 | 立场 | STR.. WIL.. | HP当前/最大 | 位置与行动
     未匹配键的段落并入备注，兼容旧版裸文本写法 */
  const NPC_ATTR_KEYS = { STR: '力', DEX: '敏', CON: '体', INT: '智', PER: '感', CHA: '魅', WIL: '志', 力量: '力', 敏捷: '敏', 体质: '体', 智力: '智', 感知: '感', 魅力: '魅', 意志: '志' };
  function parseNpc(v) {
    const p = seg(v);
    const o = { name: (p[0] || '').trim(), role: '', att: '', status: '', note: '', attrs: [] };
    const rest = [];
    const grabAttrs = (x) => {
      const out = [];
      const re = /(STR|DEX|CON|INT|PER|CHA|WIL|力量|敏捷|体质|智力|感知|魅力|意志)\s*(\d+)/g;
      let m;
      while ((m = re.exec(x))) out.push({ k: NPC_ATTR_KEYS[m[1]] || m[1], v: +m[2] });
      return out;
    };
    for (let i = 0; i < p.length - 1; i++) {
      const x = p[i + 1];
      let m;
      if ((m = x.match(/^(?:身份|职业|角色)\s*(.+)$/))) o.role = m[1].trim();
      else if ((m = x.match(/^(?:态度|立场)\s*(.+)$/))) o.att = m[1].trim();
      else if ((m = x.match(/^(?:状态|情况)\s*(.+)$/))) o.status = m[1].trim();
      else if ((m = x.match(/^(?:备注|情报|信息)\s*([\s\S]*)$/))) o.note = m[1].trim();
      else if (/^HP\s*\d+\s*\/\s*\d+$/i.test(x)) o.status = o.status || x.replace(/^HP/i, 'HP ');
      else if (/^\d+\s*\/\s*\d+$/.test(x)) o.status = o.status || 'HP ' + x;
      else if (grabAttrs(x).length >= 2) o.attrs = grabAttrs(x);
      else if (i === 0) o.att = x;   // 位置制（世界书口径）：姓名后第一段即立场
      else rest.push(x.trim());
    }
    if (rest.length) o.note = [o.note, ...rest].filter(Boolean).join(' ｜ ');
    return o;
  }

  function parseMob(v) {
    const p = seg(v);
    const o = { name: '', grade: '', hp: null, hpMax: null, hpUnknown: false, attrs: [], attrsUnknown: false, armor: '', status: [], target: '', intent: '', weak: '' };
    const gradeRe = new RegExp('^(' + MOB_GRADE_SRC + ')$', 'i');
    const gradeIn = new RegExp('(' + MOB_GRADE_SRC + ')');

    const grabHp = (x) => {
      const m = x.match(/HP\s*([0-9?]+)\s*\/\s*([0-9?]+)/i) || x.match(/^([0-9?]+)\s*\/\s*([0-9?]+)$/);
      if (!m) return false;
      if (m[1] === '?' || m[2] === '?') o.hpUnknown = true;
      else { o.hp = +m[1]; o.hpMax = +m[2]; }
      return true;
    };

    for (let i = 0; i < p.length; i++) {
      let x = p[i].trim().replace(/\+\d+\s*个?\s*未列\s*$/, '').trim();
      if (!x) continue;
      let m;
      if ((m = x.match(/^[🛡盾]\s*(.*)$/u))) { const t = m[1].trim(); if (t && !o.armor) o.armor = t; continue; }
      if ((m = x.match(/^[🎯◎]\s*(.*)$/u))) { const t = m[1].trim(); if (t && !o.target) o.target = t; o.sawTarget = true; continue; }
      if ((m = x.match(/^[➤▸→]\s*(.*)$/u))) { const t = m[1].trim(); if (t && !o.intent) o.intent = t; continue; }
      if ((m = x.match(/^弱点\s*(.*)$/))) { o.weak = m[1].trim(); continue; }
      if ((m = x.match(/^护甲\s*(.*)$/))) { o.armor = m[1].trim(); continue; }
      if ((m = x.match(/^状态\s*(.*)$/))) { o.status = m[1].split(/[,，、]/).map(t => t.trim()).filter(Boolean); continue; }
      if ((m = x.match(/^目标\s*(.*)$/))) { o.target = m[1].trim(); o.sawTarget = true; continue; }
      if ((m = x.match(/^意图\s*(.*)$/))) { o.intent = m[1].trim(); continue; }
      if (grabHp(x)) continue;

      /* 七维属性段：`STR 45 DEX 38 …` / `全属性 45`（七项全同）/ `七维 未知`（未侦查） */
      if ((m = x.match(/^七维\s*[:：]?\s*未知$/))) { o.attrsUnknown = true; continue; }
      if ((m = x.match(/^全?属性\s*[:：]?\s*(\d+)\s*$/))) {
        const v = +m[1];
        for (const k of ATTR_ORDER) o.attrs.push({ k, base: v, add: 0, total: v });
        continue;
      }
      ATTR_STRIP_RE.lastIndex = 0;
      if (ATTR_STRIP_RE.test(x)) {
        ATTR_STRIP_RE.lastIndex = 0;
        const am = parseAttrs(x);
        for (const a of am) if (!o.attrs.some(b => b.k === a.k)) o.attrs.push(a);
        /* 混合段（「守夜人甲 STR 42 …」/「80/80 STR 55 …」）：剥掉属性后的剩余文本塞回队列走正常解析 */
        const restRaw = x.replace(ATTR_STRIP_RE, ' ').trim();
        ATTR_STRIP_RE.lastIndex = 0;
        if (restRaw) {
          if (/^[0-9?]+\s*\/\s*[0-9?]+$/.test(restRaw)) grabHp(restRaw);
          else {
            const restA = restRaw.replace(/^[+\-=⚡\s\d.,、/]+|[+\-=⚡\s\d.,、/]+$/g, '').trim();
            if (restA) p.splice(i + 1, 0, restA);
          }
        }
        continue;
      }
      ATTR_STRIP_RE.lastIndex = 0;

      if (!o.grade && gradeRe.test(x)) { o.grade = x.trim(); continue; }

      /* 混合段：「变异体甲 精英 80/80」——名字+阶级+HP 挤在一段 */
      let rest = x;
      if (!o.grade) {
        const gm = rest.match(gradeIn);
        if (gm) { o.grade = gm[1]; rest = rest.replace(gm[1], ' ').trim(); }
      }
      const hm = rest.match(/([0-9?]+)\s*\/\s*([0-9?]+)\s*$/);
      if (hm) {
        if (hm[1] === '?' || hm[2] === '?') o.hpUnknown = true;
        else { o.hp = +hm[1]; o.hpMax = +hm[2]; }
        rest = rest.slice(0, hm.index).trim();
      }
      if (rest) {
        if (!o.name) o.name = rest;
        else if (!o.armor && /^[0-9]+$/.test(rest)) o.armor = rest;
        else if (o.sawTarget && !o.intent) o.intent = rest;
        else if (!o.weak) o.weak = rest;
        else o.status.push(rest);
      }
    }
    if (!o.armor) o.armor = '0';
    return o;
  }

  /* ── 裸文本 mob 块回收：把「名称 阶级 HP/HP」+「🛡 x 🎯 y」+意图+「弱点 z」
        这类丢了键名的纯文本转回结构化数据（联机同步/AI 抄面板时兜底） ── */
  function recoverMobLines(lines) {
    const mobs = [];
    const out = lines.slice();
    for (let i = 0; i < out.length; i++) {
      const line = String(out[i]).trim();
      if (/^mob\d*\s*[:：]/i.test(line)) continue; /* 有键名的走正常解析，避免重复 */
      const m = line.match(MOB_PLAIN_A);
      if (!m || !m[1].trim()) continue;
      const mob = { name: m[1].trim(), grade: m[2], hp: null, hpMax: null, hpUnknown: false, armor: '', status: [], target: '', intent: '', weak: '' };
      if (m[3].includes('?')) mob.hpUnknown = true;
      else { const pr = m[3].match(/([0-9]+)\s*\/\s*([0-9]+)/); if (pr) { mob.hp = +pr[1]; mob.hpMax = +pr[2]; } }
      let j = i + 1, took = false;
      while (j < out.length && j <= i + 4) {
        const t = String(out[j]).trim();
        if (!t || MOB_PLAIN_A.test(t)) break;
        let mm;
        if ((mm = t.match(/^[🛡盾]\s*(.+)$/u))) {
          const r = mm[1];
          const tm = r.match(/^(.*?)\s*[🎯◎]\s*(\S+)\s*$/u);
          if (tm) { mob.armor = tm[1].trim(); mob.target = tm[2]; } else mob.armor = r.trim();
          took = true; j++; continue;
        }
        if ((mm = t.match(/^[🎯◎]\s*(.+)$/u))) { mob.target = mm[1].trim(); took = true; j++; continue; }
        if ((mm = t.match(/^弱点\s*(.+)$/))) { mob.weak = mm[1].trim(); took = true; j++; break; }
        /* 意图行：短、无句读才认，防止吞正文 */
        if (!mob.intent && t.length <= 20 && !/[。！？；;，,]/.test(t)) { mob.intent = t; took = true; j++; continue; }
        break;
      }
      if (took) { mobs.push(mob); out.splice(i, j - i); i--; }
    }
    return { lines: out, mobs };
  }

  /* ── dmg<N>：伤害事件行 ──
     契约示例：dmg1: 甲→乙 | 因 链锯剑·横扫 | 算 1D8+2 +4 +20% −3 | 伤 撕裂·左臂 ·12 | 血 84→72 | 判 命中
     设计要点：
     1) `算` 只保留原文、绝不求值 —— 数值由模型算，渲染器算一遍就是第二个事实来源，两边不一致时没人知道该信谁。
     2) `伤` 的数值与 `血` 的前后差值都对得上才算一致；不一致不隐藏、打可见标记 —— 这是全卡唯一能被人肉验算的地方。
     3) 名字对不上 players[]/mobs[] 时原样显示：这时候「名字不对」本身就是要给玩家看的信息。 */
  const DMG_KINDS = { '撕裂': 'r', '钝击': 'b', '穿刺': 'p', '灼烧': 'f', '腐蚀': 'c', '精神': 'm', '真实': 't' };
  const DMG_VERDICTS = { '命中': 'hit', '暴击': 'crit', '闪避': 'dodge', '格挡': 'guard', '破防': 'break', '未破防': 'hold' };
  const DMG_ARROW = /^(.*?)\s*(?:→|->|⟶|⇒)\s*(.*)$/;

  function parseDmg(v) {
    const o = {
      from: '', to: '', cause: '', calc: '', kindRaw: '', kind: '', part: '',
      amount: null, hpBefore: null, hpAfter: null, verdictRaw: '', verdict: '',
      extra: [], mismatch: false, delta: null,
    };
    seg(v).forEach((piece, i) => {
      const x = String(piece).trim();
      if (!x) return;
      if (i === 0) {
        const mm = x.match(DMG_ARROW);
        if (mm) { o.from = mm[1].trim(); o.to = mm[2].trim(); } else { o.from = x; }
        return;
      }
      if (/^因[:：]?/.test(x)) { o.cause = x.replace(/^因[:：]?\s*/, '').trim(); return; }
      if (/^算[:：]?/.test(x)) { o.calc = x.replace(/^算[:：]?\s*/, '').trim(); return; }
      if (/^伤[:：]?/.test(x)) {
        const body = x.replace(/^伤[:：]?\s*/, '').trim();
        const num = body.match(/(-?\d+)\s*$/);
        if (num) o.amount = +num[1];
        const cut = num ? body.slice(0, body.lastIndexOf(num[1])) : body;
        const bits = cut.split('·');
        o.kindRaw = (bits[0] || '').trim();
        o.part = bits.slice(1).join('·').replace(/[·\s]+/g, ' ').trim();
        o.kind = DMG_KINDS[o.kindRaw] || '';
        return;
      }
      if (/^血[:：]?/.test(x)) {
        const body = x.replace(/^血[:：]?\s*/, '').trim();
        const mm = body.match(/^(-?\d+)\s*(?:→|->|⟶|⇒)\s*(-?\d+)$/);
        if (mm) { o.hpBefore = +mm[1]; o.hpAfter = +mm[2]; }
        return;
      }
      if (/^判[:：]?/.test(x)) {
        o.verdictRaw = x.replace(/^判[:：]?\s*/, '').trim();
        o.verdict = DMG_VERDICTS[o.verdictRaw] || '';
        return;
      }
      o.extra.push(x);
    });
    if (o.hpBefore != null && o.hpAfter != null) o.delta = o.hpBefore - o.hpAfter;
    if (o.amount != null && o.delta != null) o.mismatch = o.delta !== o.amount;
    return o;
  }

  /* ══════════ 行内键切分（抢救通道）══════════
     AI 偶尔把整块状态挤成一行：`sh: … ｜ 型 … cr1: … p1: … next: 收帆`。
     逐行解析只认第一个键、其余全被丢掉，玩家看到的是一整块不渲染的原文——
     这类「撞到就全白」不许只靠世界书自觉。

     只在**同一行出现 ≥2 个行首形态的已知键**时才动手：
     单键行一律不碰（正文里写一句「下一步 next: 出发」是很自然的中文，误切会吃掉正文）。
     切分点只认「键名 + 可选编号 + 冒号」，冒号全角半角都认；
     键与键之间是空格、` ｜ `、逗号还是别的，一概不假设——按位置切，不按分隔符切。
     切不起来（一行里只有 1 个键、或一个键都没有）就原样返回：不猜、不丢段。 */
  const KEY_BASES = (() => {
    const bases = [];
    String(KEYS).split('|').forEach((f) => {
      const b = f.trim().replace(/\[0-9\][*+]?$/, '');
      if (/^[a-z]+$/i.test(b) && bases.indexOf(b) < 0) bases.push(b);
    });
    bases.sort((a, b) => b.length - a.length);   /* 长的排前面：pl 不许被 p 抢头 */
    return bases;
  })();
  const KEY_AT = new RegExp('(?:^|[^A-Za-z0-9_])(' + KEY_BASES.join('|') + ')([0-9]*)\\s*[:：]', 'gi');

  /* 位置在不在引号里：正文里「有人念了句『next: 该走了』」是在**谈论**这个键，
     不是在用它。引号里的命中一律不参与切分——这是「防误伤」唯一能自动判的形态。 */
  function insideQuote(line, pos) {
    let a = 0, b = 0, c = 0, d = 0;
    for (let i = 0; i < pos; i++) {
      const ch = line[i];
      if (ch === '「') a++; else if (ch === '」') a = Math.max(0, a - 1);
      else if (ch === '『') b++; else if (ch === '』') b = Math.max(0, b - 1);
      else if (ch === '“') c++; else if (ch === '”') c = Math.max(0, c - 1);
      else if (ch === '"') d = d ? 0 : 1;
    }
    return !!(a || b || c || d);
  }

  /* 一行里所有「键 + 编号 + 冒号」的起始位置。m[0] 开头那个分隔字符不属于键名，
     所以要按 indexOf 把偏移找回来——直接拿 m.index 会把前一个空格算进键里。 */
  function keyHits(line) {
    const hits = [];
    KEY_AT.lastIndex = 0;
    let m;
    while ((m = KEY_AT.exec(line))) {
      const at = m.index + m[0].indexOf(m[1] + m[2]);
      if (!insideQuote(line, at)) hits.push({ at, key: m[1] + m[2] });
      if (KEY_AT.lastIndex <= at) KEY_AT.lastIndex = at + 1;   /* 防空转 */
    }
    return hits;
  }

  /* 返回 { lines, segs }：segs 是切出了几段（0/1 = 没切）。 */
  function splitInlineKeys(text) {
    const src = String(text == null ? '' : text).split(/\r?\n/);
    const out = [];
    let segs = 0;
    for (const line of src) {
      const hits = keyHits(line);
      if (hits.length < 2) { out.push(line); continue; }
      const pieces = [];
      const head = line.slice(0, hits[0].at).trim();   /* 第一个键之前若有文字，自己成一段，不并进第一个键 */
      if (head) pieces.push(head);
      for (let i = 0; i < hits.length; i++) {
        const from = hits[i].at;
        const to = i + 1 < hits.length ? hits[i + 1].at : line.length;
        const piece = line.slice(from, to).trim();
        if (piece) pieces.push(piece);
      }
      if (pieces.length < 2) { out.push(line); continue; }   /* 切了个寂寞就还原 */
      segs += pieces.length;
      for (const piece of pieces) out.push(piece);
    }
    return { lines: out, segs };
  }

  function parseState(text) {
    const st = {
      scene: '', team: '', quest: null, checks: [],
      players: [], npcs: [], kbnpcs: [], ntrnpcs: [], bonds: [], foes: [], mobs: [], ntrBonds: [], ntrFoes: [], ntrHearts: [], ntrFalls: [], ntrLogs: [], mechas: [], familiars: [], dmgs: [], shelters: [], disasters: [], warehouses: [], places: [],
      result: '', world: '', next: '',
    };
    const pmap = new Map(), smap = new Map(), emap = new Map();
    const bmap = new Map(), fmap = new Map(), nmap = new Map();
    const nbmap = new Map(), nfmap = new Map(), nhmap = new Map(), ndmap = new Map(), nlmap = new Map();
    const ptsm = new Map(), lockm = new Map(), tim = new Map(), crm = new Map();
    const mmap = new Map(), kmmap = new Map(), kfmap = new Map();
    const gmap = new Map();
    const shmap = new Map(), dzmap = new Map();
    const whmap = new Map(), plmap = new Map();
    const xmap = {}; EXT_KEYS.forEach(e => { xmap[e.field] = new Map(); });
    const checks = [];
    const split = splitInlineKeys(text);
    const rec = recoverMobLines(split.lines);
    if (split.segs > 1) st.inlineSplit = split.segs;   /* 卡面要标出来：我们切了，但 AI 写错了 */

    for (const raw of rec.lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(LINE_RE);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2];
      if (k === 'scene') st.scene = v;
      else if (k === 'team') st.team = v;
      else if (k === 'quest') st.quest = parseQuest(v);
      else if (k === 'check') checks.push(parseCheck(v));
      else if (k === 'result') st.result = v;
      else if (k === 'world') st.world = v;
      else if (k === 'next') st.next = v;
      else if (/^p\d+$/.test(k)) pmap.set(+k.slice(1), parsePlayer(v));
      else if (/^sk\d+$/.test(k)) smap.set(+k.slice(2), parseSkills(v));
      else if (/^eq\d+$/.test(k)) emap.set(+k.slice(2), parseEquip(v));
      else if (/^bond\d*$/.test(k)) bmap.set(k === 'bond' ? 1 : +k.slice(4), parseBond(v));
      else if (/^foe\d*$/.test(k)) fmap.set(k === 'foe' ? 1 : +k.slice(3), parseFoe(v));
      else if (/^nb\d*$/.test(k)) nbmap.set(k === 'nb' ? 1 : +k.slice(2), parseBond(v));
      else if (/^nf\d*$/.test(k)) nfmap.set(k === 'nf' ? 1 : +k.slice(2), parseNtrFoe(v));
      else if (/^nh\d*$/.test(k)) nhmap.set(k === 'nh' ? 1 : +k.slice(2), parseNtrHeart(v));
      else if (/^nd\d*$/.test(k)) ndmap.set(k === 'nd' ? 1 : +k.slice(2), parseNtrFalls(v));
      else if (/^nl\d*$/.test(k)) nlmap.set(k === 'nl' ? 1 : +k.slice(2), parseNtrLog(v));
      else if (/^npc\d*$/.test(k)) nmap.set(k === 'npc' ? 1 : +k.slice(3), parseNpc(v));
      else if (/^kbm\d*$/.test(k)) kmmap.set(k === 'kbm' ? 1 : +k.slice(3), parseMecha(v));
      else if (/^kbf\d*$/.test(k)) kfmap.set(k === 'kbf' ? 1 : +k.slice(3), parseFamiliar(v));
      else if (/^dmg\d*$/.test(k)) gmap.set(k === 'dmg' ? 1 : +k.slice(3), parseDmg(v));
      else if (/^sh\d*$/.test(k)) shmap.set(k === 'sh' ? 1 : +k.slice(2), parseShelter(v));
      else if (/^dz\d*$/.test(k)) dzmap.set(k === 'dz' ? 1 : +k.slice(2), parseDisaster(v));
      else if (/^wh\d*$/.test(k)) whmap.set(k === 'wh' ? 1 : +k.slice(2), parseWarehouse(v));
      else if (/^pl\d*$/.test(k)) plmap.set(k === 'pl' ? 1 : +k.slice(2), parsePlace(v));
      else if (extHit(k)) { const h = extHit(k); xmap[h.e.field].set(h.num, parseNpc(v)); }
      else if (/^pts\d+$/.test(k)) ptsm.set(+k.slice(3), parsePts(v));
      else if (/^lock\d+$/.test(k)) lockm.set(+k.slice(4), parseLock(v));
      else if (/^ti\d+$/.test(k)) tim.set(+k.slice(2), parseTi(v));
      else if (/^cr\d+$/.test(k)) crm.set(+k.slice(2), parseCr(v));
      else if (/^mob\d*$/.test(k)) {
        const mob = parseMob(v);
        if (mob.name && !/^(无|—|-)$/.test(mob.name)) mmap.set(k === 'mob' ? 1 : +k.slice(3), mob);
      }
    }

    st.checks = checks;
    st.players = [...pmap.keys()].sort((a, b) => a - b).map(i => {
      const p = pmap.get(i);
      p.idx = i;
      p.skills = smap.get(i) || [];
      p.equip = emap.get(i) || null;
      p.ptsRow = ptsm.get(i) || null;
      p.lockRow = lockm.get(i) || null;
      p.tiRow = tim.get(i) || null;
      p.crRow = crm.get(i) || null;
      return p;
    });
    st.bonds = [...bmap.keys()].sort((a, b) => a - b).map(k => bmap.get(k));
    st.foes = [...fmap.keys()].sort((a, b) => a - b).map(k => fmap.get(k));
    st.ntrBonds = [...nbmap.keys()].sort((a, b) => a - b).map(k => nbmap.get(k));
    st.ntrFoes = [...nfmap.keys()].sort((a, b) => a - b).map(k => nfmap.get(k));
    st.ntrHearts = [...nhmap.keys()].sort((a, b) => a - b).map(k => nhmap.get(k));
    st.ntrFalls = [...ndmap.keys()].sort((a, b) => a - b).map(k => ndmap.get(k));
    st.ntrLogs = [...nlmap.keys()].sort((a, b) => a - b).map(k => nlmap.get(k));
    st.npcs = [...nmap.keys()].sort((a, b) => a - b).map(k => nmap.get(k));
    EXT_KEYS.forEach(e => { st[e.field] = [...xmap[e.field].keys()].sort((a, b) => a - b).map(i => xmap[e.field].get(i)); });
    st.mechas = [...kmmap.keys()].sort((a, b) => a - b).map(i => { const m = kmmap.get(i); m.idx = i; return m; });
    st.familiars = [...kfmap.keys()].sort((a, b) => a - b).map(i => { const f = kfmap.get(i); f.idx = i; return f; });
    st.dmgs = [...gmap.keys()].sort((a, b) => a - b).map(k => gmap.get(k));
    st.shelters = [...shmap.keys()].sort((a, b) => a - b).map(i => { const s = shmap.get(i); s.idx = i; return s; });
    st.disasters = [...dzmap.keys()].sort((a, b) => a - b).map(i => { const d = dzmap.get(i); d.idx = i; return d; });
    st.warehouses = [...whmap.keys()].sort((a, b) => a - b).map(i => { const w = whmap.get(i); w.idx = i; return w; });
    st.places = [...plmap.keys()].sort((a, b) => a - b).map(i => { const p = plmap.get(i); p.idx = i; return p; });
    st.mobs = [...mmap.keys()].sort((a, b) => a - b).map(k => mmap.get(k));
    if (rec.mobs.length) st.mobs = st.mobs.concat(rec.mobs);
    return st;
  }

  /* ══════════ 渲染 ══════════ */

  const ATTR_ICON = { STR: '💪', DEX: '🦵', CON: '🫁', INT: '🧠', PER: '👁️', CHA: '💬', WIL: '🧘' };

  const bar = (cur, max, cls) => {
    if (cur == null || max == null || max <= 0) return '';
    const pct = Math.max(0, Math.min(100, Math.round(cur / max * 100)));
    return `<div class="tc-bar"><i class="${cls}" style="width:${pct}%"></i></div>`;
  };

  function renderAttrs(list) {
    if (!list.length) return '';
    return `<div class="tc-attrs">${list.map(a => `
      <div class="tc-attr${a.over ? ' ov' : ''}">
        <span class="tc-ak">${ATTR_ICON[a.k] || ''}${a.k}</span>
        <span class="tc-av">${a.base}${a.add ? `<small>+${a.add}</small>` : ''}</span>
        <b class="tc-at">${a.total}</b>
      </div>`).join('')}</div>`;
  }

  /* 读数组件：机甲与使魔共用一只（同一件事不写第二遍）。
     标签列等宽 + 等宽数字三位对齐 + 条内每 10% 一格刻度；三根读数必然等宽，
     因为宽度是 grid 列定义给的，不是逐根调出来的。 */
  const gaugeHtml = (lab, cur, max, cls, dry, extraCls) => {
    const num = (v) => String(v == null ? '—' : v).padStart(3, '\u2007');
    
      /* 同上：max 缺省时 cur 直接当百分比；max 为 0 时显式 0，不走 NaN 的「碰巧」路径。 */
      const pct = max == null ? Math.max(0, Math.min(100, cur))
        : (max ? Math.max(0, Math.min(100, Math.round(cur / max * 100))) : 0);
      return `<div class="tc-kbm-g ${cls}${dry ? ' dry' : ''}${extraCls || ''}">
        <span class="tc-kbm-gl">${lab}</span>
        <b class="tc-kbm-gv">${num(cur)}</b>
        <em class="tc-kbm-gm">${max == null ? '' : '/' + max}</em>
        <div class="tc-bar ticks"><i class="${dry ? cls + '-dry' : cls}" style="width:${pct}%"></i></div>
      </div>`;
  };

  /* 力/敏/体 固定三项：有值写值、无值写灰色 —。
     「没有」和「丢了」在画面上必须能分开——少一行字是静默降级的另一种形态。
     智/感/魅 不占位：机甲与使魔这两项本来就用玩家值，缺是正常。 */
  function attrsHtml(attrs) {
    const list = attrs || [];
    const got = new Map(list.map(a => [a.k, a.v]));
    const core = ['力', '敏', '体'].map(k => got.has(k)
      ? `<span><i>${k}</i> <b>${got.get(k)}</b></span>`
      : `<span class="miss"><i>${k}</i> <b>—</b></span>`);
    const rest = list.filter(a => ['力', '敏', '体'].indexOf(a.k) < 0)
      .map(a => `<span><i>${esc(a.k)}</i> <b>${a.v}</b></span>`);
    return core.concat(rest).join('');
  }

  /* 机甲卡：跟在同号 p 卡后面；无对应 p 时单独成卡。
     HP 归零 → dead 类 + 「已失效」（规则上此刻该弹出驾驶者）。 */
  function renderMecha(m, paired) {
    const dead = !!(m.hp && m.hp.max > 0 && m.hp.cur <= 0);
    const cls = ['tc-kbm'];
    if (m.type) cls.push('t-' + m.type);
    if (dead) cls.push('dead');
    /* paired = 存在同号 p<N>。只有 paired 才画「谁在谁里面」的那条竖线与驾驶中带子：
       没主就没有归属关系，画了就是假信息。 */
    if (paired) cls.push('paired');

    /* 一根读数：标签列等宽 + 等宽数字（三位对齐）+ 条内分段刻度。
       三根主读数走同一个函数、同一列宽，所以它们**必然等宽**——不是对齐调出来的。 */
    const dryOf = (v) => !!(v && v.max > 0 && v.cur <= 0);
    const gauges = (m.hp || m.en || m.sp) ? `
      <div class="tc-kbm-gauges">
        ${m.hp ? gaugeHtml('HP', m.hp.cur, m.hp.max, 'kbm', false) : ''}
        ${m.en ? gaugeHtml('能', m.en.cur, m.en.max, 'kbm-en', dryOf(m.en)) : ''}
        ${m.sp ? gaugeHtml('SP', m.sp.cur, m.sp.max, 'kbm-sp', dryOf(m.sp)) : ''}
      </div>` : '';

    /* 自定数值：与五维条同形（条），但配色走中性青，跟固定字段区分开 */
    const cus = (m.extra || []).length ? `
      <div class="tc-kbm-cus">${(m.extra || []).map(e => gaugeHtml(esc(e.label), e.a, e.b, 'kbm-x', false, ' x')).join('')}</div>` : '';

    /* 自定文本：只有标签，**没有条也没有数值格**——两者混在一起会让人以为"破甲"也有数字 */
    const tags = (m.tags || []).length ? `
      <div class="tc-kbm-tags"><em class="tc-kbm-tagl">其他</em>${(m.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '';

    const attrs = m.attrs.length ? `
      <div class="tc-kbm-attrs">${attrsHtml(m.attrs)}</div>` : '';

    /* 装备：方角内凹插槽，和伴侣卡的圆 pill 区分 */
    const equip = m.equip.length ? `
      <div class="tc-kbm-eq">${m.equip.map(e => `<span class="slot">${esc(e)}</span>`).join('')}</div>` : '';

    /* 外层 .tc-kbm 不裁切（挂竖线 ::before 用），切角与描边都在 .tc-kbm-in 上：
       clip-path 会连子元素一起裁，竖线要伸到卡片外面就必须长在未被裁的那一层。 */
    return `
      <div class="${cls.join(' ')}">
        <div class="tc-kbm-in">
          <div class="tc-kbm-hd">
            ${paired ? '<i class="tc-kbm-drive">◤ 驾驶中</i>' : ''}
            <b>${esc(m.name || '机体')}</b>
            ${m.typeRaw ? `<span class="tc-kbm-type ty-${m.type || 'x'}">${esc(m.typeRaw)}</span>` : ''}
          </div>
          ${gauges}${attrs}${cus}${tags}${equip}
          ${dead ? '<em class="tc-kbm-stamp">已失效</em>' : ''}
        </div>
      </div>`;
  }


  /* 使魔卡：比机甲小一档 —— 它是附属单位，不该和机甲、更不该和玩家抢视觉重量。
     结构：头（名称 + 族 + 签徽章）／HP·MP 两条细条 + 忠 一根短条／属性行／技标签／规格外兜底。
     缺项一律画 —（与 kbm 同规矩）：不许整块消失，否则「没有」和「丢了」分不开。 */
  function renderFamiliar(f) {
    const dryOf = (v) => !!(v && v.max > 0 && v.cur <= 0);
    const bars = (f.hp || f.mp) ? `
      <div class="tc-fam-bars">
        ${f.hp ? gaugeHtml('HP', f.hp.cur, f.hp.max, 'fam', false) : ''}
        ${f.mp ? gaugeHtml('MP', f.mp.cur, f.mp.max, 'fam-mp', dryOf(f.mp)) : ''}
      </div>` : '';
    const loyal = f.loyal ? `
      <div class="tc-fam-loyal"><span>忠</span><b>${f.loyal.cur}</b><div class="tc-bbar"><i class="fam-loyal" style="width:${Math.max(0, Math.min(100, f.loyal.cur))}%"></i></div></div>` : '';
    const attrs = `
      <div class="tc-fam-attrs">${attrsHtml(f.attrs || [])}</div>`;
    const skills = (f.skills || []).length ? `
      <div class="tc-fam-skills"><em class="tc-fam-l">技</em>${f.skills.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '';
    const cus = (f.extra || []).length ? `
      <div class="tc-fam-cus">${f.extra.map(e => gaugeHtml(esc(e.label), e.a, e.b, 'fam-x', false, ' x')).join('')}</div>` : '';
    const tags = (f.tags || []).length ? `
      <div class="tc-fam-tags">${f.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '';
    return `
      <div class="tc-fam${f.race ? ' r-' + f.race : ''}${f.pact === 'off' ? ' gone' : ''}">
        <div class="tc-fam-hd">
          <b>${esc(f.name || '使魔')}</b>
          ${f.raceRaw ? `<i class="tc-fam-race rr-${f.race || 'x'}">${esc(f.raceRaw)}</i>` : ''}
          ${f.pactRaw ? `<em class="tc-fam-pact p-${f.pact}">${esc(f.pactRaw)}</em>` : ''}
        </div>
        ${bars}${loyal}${attrs}${skills}${cus}${tags}
      </div>`;
  }


  /* 避难所卡：海上载体的「船壳」——圆角浮筒 + 锈斑 + 水位线，和机甲的直角切角不是一套骨架。
     五项资源全走 gaugeHtml（与机甲/使魔同一只读数组件）：同一件事不写第二遍，
     差异靠配色与外壳，不靠另造一根条。
     缺项一律画 —（与 kbm 同规矩）：五格里少一格而不留痕，会把「没写」读成「这条不存在」。 */
  function renderShelter(s) {
    const wrecked = !!(s.hull && s.hull.max > 0 && s.hull.cur <= 0);
    const cls = ['tc-shelter'];
    if (s.type) cls.push('t-' + s.type);
    if (wrecked) cls.push('wrecked');

    const dryOf = (v) => !!(v && v.max > 0 && v.cur <= 0);
    const gauges = SHELTER_RES.map(([key, lab]) => {
      const v = s[key];
      return v ? gaugeHtml(lab, v.cur, v.max, 'sh-' + key, dryOf(v))
        : gaugeHtml(lab, null, null, 'sh-' + key, false, ' miss');
    }).join('');

    /* 防 是单值、不给条：它回答「多难打穿」，不是「还剩多少」。给条就会被读成消耗量。 */
    const def = s.def != null
      ? `<span class="tc-sh-def"><em>防</em><b>${s.def}</b></span>`
      : `<span class="tc-sh-def miss"><em>防</em><b>—</b></span>`;

    /* 模 是徽章行：段数不定（0 段就不出这一行），等级画成 ×N 的角标 */
    const mods = s.mods.length ? `
      <div class="tc-sh-mods"><em class="tc-sh-mods-l">模</em>${
        s.mods.map(m => `<span class="tc-sh-mod">${esc(m.name)}${m.lv == null ? '' : `<i>×${m.lv}</i>`}</span>`).join('')
      }</div>` : '';

    /* 解析报错照原文片段显示：这是「少一块」的可见化，不是给玩家的说明文字 */
    const errs = s.errs.length ? `
      <div class="tc-sh-err">${s.errs.map(e => `<em>${esc(e)}</em>`).join('')}</div>` : '';

    return `
      <div class="${cls.join(' ')}">
        <div class="tc-sh-in">
          <div class="tc-sh-hd">
            <b class="tc-sh-name">${esc(s.name || '避难所')}</b>
            ${s.typeRaw ? `<span class="tc-sh-type ty-${s.type || 'x'}">${esc(s.typeRaw)}</span>` : ''}
            ${def}
          </div>
          <div class="tc-sh-gauges">${gauges}</div>
          ${mods}${errs}
          <div class="tc-sh-water"></div>
          ${wrecked ? '<em class="tc-sh-stamp">舱体破裂</em>' : ''}
        </div>
      </div>`;
  }

  /* 灾变横幅：它是横条不是卡片 —— 描述的是「这场正在发生什么」，不是某个单位。
     左边等级色块 + 五格严重度点阵（1..5 是**档位**不是进度，全亮=满级），
     所以用点阵不用条：画成条会被读成「快结束了」。 */
  function renderDisaster(d) {
    const lv = d.level == null ? 0 : Math.max(1, Math.min(5, d.level));
    const cls = ['tc-dz'];
    if (lv) cls.push('lv-' + lv);
    const over = d.left != null && d.left <= 0;
    if (over) cls.push('over');
    const pips = [1, 2, 3, 4, 5].map(i => `<i class="${lv >= i ? 'on' : ''}"></i>`).join('');
    const left = d.left != null
      ? `<b class="tc-dz-left">余 ${d.left} 回合</b>`
      : '<b class="tc-dz-left miss">余 —</b>';
    const errs = d.errs.length ? `
      <div class="tc-dz-err">${d.errs.map(e => `<em>${esc(e)}</em>`).join('')}</div>` : '';
    return `
      <div class="${cls.join(' ')}">
        <span class="tc-dz-sev"><u></u><em class="tc-dz-lv">${pips}</em></span>
        <b class="tc-dz-name">${esc(d.name || '灾变')}</b>
        ${d.level != null ? `<span class="tc-dz-grd">级 ${d.level}</span>` : ''}
        ${over ? '<span class="tc-dz-over">已平息</span>' : ''}
        ${left}
        ${d.effect ? `<div class="tc-dz-fx">${esc(d.effect)}</div>` : ''}
        ${errs}
      </div>`;
  }

  /* 仓储卡：**清单卡，不是条卡**。
     它是「你现在有什么」的账本，不是「还剩多少」的读数——所以一行一件、数量右对齐，
     不画条（条回答的是比例，账本回答的是有无）。
     硬约束：**一件都不许丢**。9 件以上折成两列只是为了不把卡拉成一条长鞭，
     折列用的是 CSS 多列（同一批 DOM 节点），不是「取前 8 件」——所以窄屏会掉成一列，
     但永远不会少一行。 */
  function renderWarehouse(w, cap) {
    const used = w.items.length;
    const many = used > 8;
    const capTxt = cap == null ? '—' : cap;
    const rows = w.items.map(it => `
      <div class="tc-wh-i">
        <span class="tc-wh-n">${esc(it.name)}</span>
        ${it.qty == null ? '<em class="tc-wh-x miss">×—</em>' : `<em class="tc-wh-x">×${it.qty}</em>`}
        ${it.note ? `<i class="tc-wh-note">[${esc(it.note)}]</i>` : ''}
      </div>`).join('');
    const errs = w.errs.length ? `
      <div class="tc-wh-err">${w.errs.map(e => `<em>${esc(e)}</em>`).join('')}</div>` : '';
    const full = cap != null && used > cap ? ' over' : '';
    return `
      <div class="tc-wh${many ? ' many' : ''}">
        <div class="tc-wh-in">
          <div class="tc-wh-hd">
            <em class="tc-wh-lab">占用</em>
            <b class="tc-wh-occ${full}">${used}<u>/${capTxt}</u></b>
          </div>
          ${used ? `<div class="tc-wh-list">${rows}</div>` : '<div class="tc-wh-empty">空仓</div>'}
          ${errs}
        </div>
      </div>`;
  }

  /* 场所卡：一行一个地点，按 型 分色 + `存 N` 倒计时角标 + `特` 一句小字摘要。
     量级比避难所轻一档：它是路过的背景，不是你要盯着的读数。 */
  function renderPlace(p) {
    const type = p.type || 'x';
    const cls = ['tc-pl', 't-' + type];
    const store = p.store == null
      ? '<b class="tc-pl-store miss">存 —</b>'
      : (p.store <= 0 ? '<b class="tc-pl-store gone">存 0</b>' : `<b class="tc-pl-store">存 ${p.store}</b>`);
    const errs = p.errs.length ? `
      <div class="tc-pl-err">${p.errs.map(e => `<em>${esc(e)}</em>`).join('')}</div>` : '';
    return `
      <div class="${cls.join(' ')}">
        <div class="tc-pl-in">
          <div class="tc-pl-hd">
            <b class="tc-pl-name">${esc(p.name || '场所')}</b>
            ${p.typeRaw ? `<span class="tc-pl-type">${esc(p.typeRaw)}</span>` : ''}
            ${store}
          </div>
          ${p.feature ? `<div class="tc-pl-ft">${esc(p.feature)}</div>` : ''}
          ${errs}
        </div>
      </div>`;
  }

  function renderPlayer(p) {
    const skills = p.skills.length ? `
      <details class="tc-fold"><summary>技能 · ${p.skills.length}</summary>
        <div class="tc-skills">${p.skills.map(s => `
          <div class="tc-skill">
            <b>${esc(s.name)}</b>
            <em>${s.cd ? 'CD ' + esc(s.cd) : (s.sp ? '被动' : '')}${s.sp ? ' · SP ' + esc(s.sp) : ''}</em>
            <span>${esc(s.effect)}</span>
          </div>`).join('')}</div>
      </details>` : '';

    const eq = p.equip ? `
      <details class="tc-fold"><summary>装备 · ${p.equip.slots.length + (p.equip.weight ? 1 : 0)}</summary>
        <div class="tc-eq">
          ${p.equip.slots.map(s => `<div class="tc-eqrow"><span>${esc(s.k || '·')}</span><b class="${/^空$/.test(s.v) ? 'empty' : ''}">${esc(s.v)}</b></div>`).join('')}
          ${p.equip.weight ? `<div class="tc-eqrow"><span>负重</span><b>${p.equip.weight.cur}/${p.equip.weight.max} kg${p.equip.wstate ? ` [${esc(p.equip.wstate)}]` : ''}</b></div>` : ''}
          ${p.equip.bonus ? `<div class="tc-eqrow tc-eqbonus"><span>总加成</span><b>${esc(p.equip.bonus)}</b></div>` : ''}
        </div>
      </details>` : '';

    const pills = (p.ptsRow || p.lockRow || p.tiRow || (p.crRow && p.crRow.length)) ? `
      <div class="tc-pills">
        ${p.ptsRow && p.ptsRow.total ? `<span class="tc-pill pts">✦ ${esc(p.ptsRow.total)}${p.ptsRow.ranks ? ` · ${esc(p.ptsRow.ranks)}` : ''}</span>` : ''}
        ${p.lockRow && p.lockRow.stage ? `<span class="tc-pill lock${/三阶|四阶|五阶/.test(p.lockRow.stage) ? ' hi' : ''}${p.lockRow.over && !/^0/.test(p.lockRow.over) ? ' warn' : ''}">${esc(p.lockRow.stage)}${p.lockRow.devil && !/^(无|未度)$/.test(p.lockRow.devil) ? ' · 心魔' + esc(p.lockRow.devil) : ''}${p.lockRow.over && !/^0/.test(p.lockRow.over) ? ' ⚠' + esc(p.lockRow.over) : ''}</span>` : ''}
        ${p.tiRow && p.tiRow.cn ? `<span class="tc-pill ti">${esc(p.tiRow.cn)}${p.tiRow.en ? ' <i>' + esc(p.tiRow.en) + '</i>' : ''}</span>` : ''}
        ${(p.crRow || []).map(r => `<span class="tc-pill cr">◈ ${esc(r.name)} <b>${esc(r.val)}</b></span>`).join('')}
      </div>` : '';

    const file = (p.pts || p.sub || p.blood || p.lock || p.title) ? `
      <details class="tc-fold"><summary>档案</summary>
        <div class="tc-file">
          ${p.pts ? `<div><span>💰 奖励点数</span><b>${esc(p.pts)}</b></div>` : ''}
          ${p.sub ? `<div><span>📜 支线剧情</span><b>${esc(p.sub)}</b></div>` : ''}
          ${p.blood ? `<div><span>🧬 已兑换</span><b>${esc(p.blood)}</b></div>` : ''}
          ${p.lock ? `<div><span>🔓 基因锁</span><b>${esc(p.lock)}</b></div>` : ''}
          ${p.title ? `<div><span>🏆 称号</span><b>${esc(p.title)}</b></div>` : ''}
        </div>
      </details>` : '';

    const hpPct = p.hp && p.hp.max ? Math.round(p.hp.cur / p.hp.max * 100) : 100;
    const low = (p.hp && hpPct > 0 && hpPct <= 25) ? ' tc-lowhp' : '';
    const num = String(p.idx || 1).padStart(2, '0');
    return `<div class="tc-card${low}" data-n="${num}">
      <div class="tc-chead">
        <span class="tc-pnum">${num}</span>
        <span class="tc-name">${esc(p.name || '玩家' + p.idx)}</span>
        ${p.badge ? `<span class="tc-badge${/健康|正常|完好/.test(p.badge) ? ' ok' : /轻伤/.test(p.badge) ? ' warn' : ' bad'}">${esc(p.badge)}</span>` : ''}
      </div>
      ${renderAttrs(p.attrs)}
      <div class="tc-vitals">
        ${p.hp ? `<div class="tc-vit"><span>❤️ HP</span><b>${p.hp.cur}/${p.hp.max}</b>${bar(p.hp.cur, p.hp.max, 'hp')}</div>` : ''}
        ${p.sp ? `<div class="tc-vit"><span>💠 SP</span><b>${p.sp.cur}/${p.sp.max}</b>${bar(p.sp.cur, p.sp.max, 'sp')}</div>` : ''}
        ${p.weight ? `<div class="tc-vit"><span>📦 负重</span><b>${p.weight.cur}/${p.weight.max}</b>${bar(p.weight.cur, p.weight.max, 'wt')}</div>` : ''}
      </div>
      <div class="tc-nums">
        ${p.mov != null ? `<span>🏃 MOV ${p.mov}</span>` : ''}
        ${p.db != null ? `<span>⚔️ DB ${p.db}</span>` : ''}
        ${p.weapon ? `<span class="tc-wpn">${esc(p.weapon)}</span>` : ''}
      </div>
      ${p.penalty ? `<div class="tc-pen">🩸 ${esc(p.penalty)}</div>` : ''}
      ${p.status.length ? `<div class="tc-tags">${p.status.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
      ${pills}${file}${skills}${eq}
    </div>`;
  }

  function renderCheck(c, i) {
    if (!c) return '';
    if (c.none) {
      return `<div class="tc-check none"><b>🎲 本轮判定</b><span>无${c.reason ? ' · ' + esc(c.reason) : ''}</span></div>`;
    }
    const rows = [
      ['🎯 适用属性', c.attr], ['📊 基础阈值', c.base],
      ['📋 DL修正', c.dl ? String(c.dl).replace(/^DL\s*[:：]?\s*/i, '') : ''],
      ['🚫 边界修正', c.edge], ['🩸 状态惩罚', c.pen], ['⚡ 超限修正', c.over],
      ['📐 修正后阈值', c.final], ['🎲 掷出结果', c.roll], ['📋 判定等级', c.grade],
      ['📊 成果层级', c.tier], ['🔍 检索进度', c.search], ['🚫 边界限制', c.edgelimit],
      ['⚡ 超限追加', c.overadd], ['🔄 对抗差值', c.ad], ['🌌 世界注视', c.gaze],
      ['🎯 类别', c.cat],
    ].filter(r => r[1]);

    /* AI 写歪/多写的字段不再静默丢弃，全部兜底显示 */
    const extraRows = (c.fields || []).map(f => {
      const mm = String(f).match(/^([^\s:：]{1,10})[\s:：]\s*(.+)$/);
      return mm ? ['📌 ' + mm[1], mm[2]] : ['📌 补充', f];
    });
    const allRows = rows.concat(extraRows);

    return `<details class="tc-check"${i === 0 ? ' open' : ''}>
      <summary>
        <b>🎲</b><span class="tc-ctitle">${esc(c.title || '本轮判定')}</span>
        ${c.grade ? `<u class="${/失败/.test(c.grade) ? 'bad' : 'ok'}">${esc(c.grade)}</u>` : ''}
        ${c.ad ? `<em>${esc(c.ad)}</em>` : ''}
      </summary>
      <div class="tc-cbody">
        ${allRows.map(r => `<div class="tc-crow"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}
      </div>
      ${c.note ? `<div class="tc-cnote">📝 ${esc(c.note)}</div>` : ''}
      ${(c.cost || c.critfail) ? `<div class="tc-cfoot">${c.cost ? `⚡ 超限消耗：${esc(c.cost)}` : ''}${c.cost && c.critfail ? ' ｜ ' : ''}${c.critfail ? `大失败范围：${esc(c.critfail)}` : ''}</div>` : ''}
    </details>`;
  }

  function renderBond(b) {
    const one = (label, v, cls) => v == null ? '' :
      `<div class="tc-bv"><span>${label}</span><b>${v}</b><div class="tc-bbar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, v))}%"></i></div></div>`;
    return `<div class="tc-bond">
      <div class="tc-bhead"><b>${esc(b.name)}</b>${b.stage ? `<em>期 ${b.stage} ${esc(b.stageName)}</em>` : ''}${b.lewdMask ? `<span class="tc-mask">淫压 ${b.lewdMask}</span>` : ''}${b.trace != null ? `<span class="tc-trace">迹 ${b.trace}</span>` : ''}</div>
      <div class="tc-bgrid">${one('爱', b.love, 'love')}${one('恋', b.crush, 'crush')}${one('调', b.train, 'train')}${one('屈', b.submit, 'submit')}${one('淫', b.lewd, 'lewd')}</div>
      ${b.defLost != null ? `<div class="tc-def">防线 ${b.defLost}/${b.defTotal}${b.defName ? ' · ' + esc(b.defName) : ''}<div class="tc-dbar"><i style="width:${b.defLost / b.defTotal * 100}%"></i></div></div>` : ''}
    </div>`;
  }

  /* NPC 卡：非敌对在场人物。紫金情报网风格，与敌方红色系完全区分。
     态度分三档着色：友善(青) / 中立·警惕(琥珀) / 敌意(暗红角标，仍不进威胁区) */
  function renderNpc(n) {
    const attTone = (s) => {
      const x = String(s || '');
      if (/友善|友好|亲近|信任|盟|伙伴|好感|热/.test(x)) return 'a-friend';
      if (/敌|敌视|敌对|仇| hostile /i.test(x)) return 'a-hostile';
      return 'a-neutral';
    };
    const name = n.name || '未知人物';
    return `<div class="tc-npc">
      <div class="tc-npc-hd">
        <b class="tc-npc-name">${esc(name)}</b>
        ${n.role ? `<span class="tc-npc-role">${esc(n.role)}</span>` : ''}
        ${n.att ? `<span class="tc-npc-att ${attTone(n.att)}">${esc(n.att)}</span>` : ''}
      </div>
      ${n.attrs && n.attrs.length >= 2 ? `<div class="tc-npc-attrs">${n.attrs.map(a => `<span>${a.k}<b>${a.v}</b></span>`).join('')}</div>` : ''}
      ${n.status ? `<div class="tc-npc-st">${esc(n.status)}</div>` : ''}
      ${n.note ? `<div class="tc-npc-note">${esc(n.note)}</div>` : ''}
    </div>`;
  }

  /* NTR 心声卡（nh 行）：双面镜分屏 —— 左冷蓝「对你·面具」，右绯红「对他·真面目」；
     心理状态琥珀芯片；内心独白引号压底。 */
  function renderNtrHeart(h) {
    if (!h.name && !h.toUser && !h.toRival && !h.inner && !(h.mind || []).length) return '';
    const quote = (s) => /^[「『"“]/.test(s) ? s : `「${s}」`;
    return `<div class="tc-nh"><span class="tc-nh-wm">心</span>
      <div class="tc-nh-hd"><b>${esc(h.name || '？？？')}</b>${(h.mind || []).map(x => `<span class="tc-nh-mind">${esc(x)}</span>`).join('')}</div>
      ${(h.toUser || h.toRival) ? `<div class="tc-nh-split">
        <div class="tc-nh-user"><i>对你</i>${h.toUser ? `<em>${esc(h.toUser)}</em>` : ''}</div>
        <div class="tc-nh-rival"><i>对他</i>${h.toRival ? `<em>${esc(h.toRival)}</em>` : ''}</div>
      </div>` : ''}
      ${h.inner ? `<div class="tc-nh-inner">${esc(quote(h.inner))}</div>` : ''}
    </div>`;
  }

  /* NTR 防线档案卡（nd 行）：五道防线逐条明细。
     失守=红🔓 / 回填=青🛠 / 在守=暗🔒；日期 + 经过备注。 */
  function renderNtrFalls(f) {
    if (!f.rows.length) return '';
    const tone = (s) => s === '失守' ? 'f-lost' : (s === '回填' ? 'f-heal' : 'f-hold');
    const icon = (s) => s === '失守' ? '🔓' : (s === '回填' ? '🛠️' : '🔒');
    return `<div class="tc-nd">
      <div class="tc-nd-hd"><b>${esc(f.name || '？？？')}</b><span>防线明细</span></div>
      ${f.rows.map(r => `<div class="tc-nd-row ${tone(r.status)}">
        <i>${icon(r.status)}</i><b>${esc(r.name)}</b>
        ${r.status ? `<u>${esc(r.status)}</u>` : ''}${r.date ? `<time>${esc(r.date)}</time>` : ''}${r.note ? `<em>${esc(r.note)}</em>` : ''}
      </div>`).join('')}
    </div>`;
  }

  /* NTR 暗流事件轴（nl 行）：绯红竖线时间线。
     「你 不知情」的事件整条雾化 + 🙈，主角视角的蒙在鼓里直接可视。 */
  function renderNtrLog(l) {
    const blind = /不知情|未察觉|无察觉|被瞒/.test(l.known);
    return `<div class="tc-nl${blind ? ' blind' : ''}">
      <div class="tc-nl-hd"><time>${esc(l.date)}</time><b>${esc(l.title || '——')}</b>
        ${l.known ? `<span class="tc-nl-know${blind ? ' no' : ''}">${blind ? '🙈 ' : ''}${esc(l.known)}</span>` : ''}</div>
      ${l.what ? `<div class="tc-nl-what">${esc(l.what)}</div>` : ''}
      ${l.her ? `<div class="tc-nl-her">她 · ${esc(l.her)}</div>` : ''}
    </div>`;
  }

  function renderMob(m) {
    const g = /BOSS|Boss|首领|头目/.test(m.grade) ? 'g-boss' : (/精英/.test(m.grade) ? 'g-elite' : 'g-mob');
    const pct = (m.hp != null && m.hpMax) ? Math.max(0, Math.min(100, Math.round(m.hp / m.hpMax * 100))) : 0;
    const hpTxt = m.hpUnknown ? '?/?' : (m.hp != null ? `${m.hp}/${m.hpMax}` : '');
    const sts = (m.status || []).filter(x => !/^(正常|无)$/.test(x));
    const attrs = (m.attrs || []).slice().sort((a, b) => ATTR_ORDER.indexOf(a.k) - ATTR_ORDER.indexOf(b.k));
    const attrRow = attrs.length
      ? `<div class="tc-mattrs">${attrs.map(a => `<span class="tc-mattr"><i>${esc(a.k)}</i><b>${a.total}</b>${a.add ? `<u>+${a.add}</u>` : ''}</span>`).join('')}</div>`
      : (m.attrsUnknown ? `<div class="tc-mattrs"><span class="tc-mattr unk"><i>七维</i><b>未知</b></span></div>` : '');
    const low = (pct > 0 && pct <= 25) ? ' tc-lowhp' : '';
    return `<div class="tc-mob ${g}${low}">
      <div class="tc-mob-hd">
        <span class="tc-mob-name">${esc(m.name)}</span>
        ${m.grade ? `<span class="tc-mob-grade">${esc(m.grade)}</span>` : ''}
        ${hpTxt ? `<span class="tc-mob-hp">${esc(hpTxt)}</span>` : ''}
      </div>
      ${hpTxt ? `<div class="tc-mob-bar"><i style="width:${pct}%"></i></div>` : ''}
      ${attrRow}
      <div class="tc-mob-meta">
        <span class="tc-mob-armor">🛡 ${esc(m.armor)}</span>
        ${sts.map(x => `<span class="tc-mob-st">${esc(x)}</span>`).join('')}
        ${m.target ? `<span class="tc-mob-tg">🎯 ${esc(m.target)}</span>` : ''}
      </div>
      ${m.intent ? `<div class="tc-mob-intent">${esc(m.intent)}</div>` : ''}
      ${m.weak ? `<div class="tc-mob-weak">弱点 ${esc(m.weak)}</div>` : ''}
    </div>`;
  }

  function renderFoe(f) {
    const dots = f.step == null ? '' : `<span class="tc-dots">${'●'.repeat(f.step)}${'○'.repeat(Math.max(0, f.total - f.step))}</span>`;
    return `<div class="tc-foe"><b>${esc(f.name)}</b><span>${esc(f.method)}</span>${dots}${f.weak ? `<em>弱点 ${esc(f.weak)}</em>` : ''}</div>`;
  }

  /* NTR 伴侣卡（nb 行）：绯红「沦陷」主题。
     阶段 1-5 逐级加深（边框/辉光/脉冲），期 5 定局盖印；
     右侧沦陷度环 =（恋+调+屈+淫)/4；阶段水印大字（裂/蚀/摇/沦/定）；
     防线用锁形进度（🔓/🔒），五维条配色与 bond 卡区分（爱=冷白蓝，其余绯红系）。 */
  const NB_WM = { 1: '裂', 2: '蚀', 3: '摇', 4: '沦', 5: '定' };
  /* 契约里的五道防线名（顺序即槽位顺序）。世界书给了更多道时，多出来的用编号占位。 */
  const DEF_NAMES = ['界限', '称谓', '独处', '主动', '归属'];

  function renderNtrBond(b) {
    const one = (label, v, cls) => v == null ? '' :
      `<div class="tc-bv"><span>${label}</span><b>${v}</b><div class="tc-bbar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, v))}%"></i></div></div>`;
    const stage = Math.max(1, Math.min(5, b.stage || 1));
    /* 位=被夺 时第三方那一栏读「敌」，其余位读「恋」；另一个字段整条忽略（不显示、不参与环）。 */
    const taken = b.role === '被夺';
    const rival = taken ? b.foeLove : b.crush;
    /* 按「值有几位」决定画几根条：a 有值画一根，b 也有值再画一根。不看字段名。 */
    /* 双值 = 同一维度两面：一根条分两层（上=A 实心、下=B 同色降透明），标签只写一次，数值写 34/12（B 降一档）。归属靠位置与透明度表达，不靠「你」这种通用字。 */
    const pair = (label, a, bc, cls) => a == null ? '' : (bc == null ? one(label, a, cls) :
      `<div class="tc-bv"><span>${label}</span><b>${a}<i>/</i><em>${bc}</em></b><div class="tc-bbar two"><i class="${cls} a" style="width:${Math.max(0, Math.min(100, a))}%"></i><i class="${cls} b" style="width:${Math.max(0, Math.min(100, bc))}%"></i></div></div>`);
    /* 沦陷度：恋(敌)/调/屈/淫 均值（缺失值按 0 计，全部缺失则不显示） */
    const parts = [rival, b.train, b.submit, b.lewd].filter(x => x != null);
    let ring = '';
    if (parts.length) {
      const pct = Math.round(parts.reduce((a, c) => a + c, 0) / parts.length);
      const C = 2 * Math.PI * 16;
      ring = `<svg class="tc-nb-ring" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="16" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="4"/>
        <circle cx="22" cy="22" r="16" fill="none" stroke="#e11d48" stroke-width="4" stroke-linecap="round"
          stroke-dasharray="${(pct / 100 * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 22 22)"/>
        <text x="22" y="21.5" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="#fda4af">${pct}</text>
        <text x="22" y="31" text-anchor="middle" font-size="5.2" font-weight="700" fill="rgba(253,164,175,.95)">↑ 沦陷</text>
      </svg>`;
    }
    /* 回撤环 =（爱 + 调你 + 屈你）/3，只看「对你」这一侧。三个值至少两个非空才画：
       旧卡这一侧只有一个「爱」，画出来是玩家从没填过的环 —— 不凭空造数据。 */
    const recParts = [b.love, b.trainYou, b.submitYou].filter(x => x != null);
    let ring2 = '';
    if (recParts.length >= 2) {
      const rpct = Math.round(recParts.reduce((a, c) => a + c, 0) / recParts.length);
      const C2 = 2 * Math.PI * 16;
      ring2 = `<svg class="tc-nb-ring recall" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="16" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="4"/>
        <circle cx="22" cy="22" r="16" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round"
          stroke-dasharray="${(rpct / 100 * C2).toFixed(1)} ${C2.toFixed(1)}" transform="rotate(-90 22 22)"/>
        <text x="22" y="21.5" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="#bae6fd">${rpct}</text>
        <text x="22" y="31" text-anchor="middle" font-size="5.2" font-weight="700" fill="rgba(186,230,253,.95)">↓ 回撤</text>
      </svg>`;
    }
    const locks = b.defLost == null ? '' :
      `<span class="tc-nb-locks">${Array.from({ length: b.defTotal }, (_, i) =>
        i < b.defLost ? '<i class="u">🔓</i>' : '<i>🔒</i>').join('')}</span>`;
    const stamp = stage === 5 ? '<span class="tc-nb-stamp">\u5b9a\u5c40</span>' : '';
    /* ── 按「谁在动」换骨架，不是换徽章 ──
       受害（A，旧卡默认）：她在被推动 → 主体是她的五维；右侧侵蚀边由 CSS ::after 画（不加 DOM，故旧卡字节不变）。
       被夺（B）：在动的是你 → 主体换成「你的漂移」三条，她的五维压成一行摘要。
       夺取（C）：你在拆 → 主体换成防线逐道槽位，五维退成副信息。 */
    const roleCls = b.role === '\u88ab\u593a' ? ' role-t' : b.role === '\u593a\u53d6' ? ' role-s' : '';
    const badge = b.roleRaw ? `<span class="tc-mask tc-role r-${b.role === '\u88ab\u593a' ? 't' : b.role === '\u593a\u53d6' ? 's' : 'v'}">位 ${esc(b.roleRaw)}</span>` : '';
    const head = `<div class="tc-bhead"><b>${esc(b.name)}</b>${b.stage ? `<em>期 ${b.stage} ${esc(b.stageName)}</em>` : ''}${b.lewdMask ? `<span class="tc-mask">淫压 ${b.lewdMask}</span>` : ''}${b.trace != null ? `<span class="tc-trace">迹 ${b.trace}</span>` : ''}${badge}</div>`;
    const kinkRow = b.kink == null ? '' : `
      <div class="tc-nb-kink"><span>癖</span><b>${b.kink}</b><em>玩家刻度</em><div class="tc-bbar" style="height:2px;flex:1;grid-column:auto"><i class="n-kink" style="width:${b.kink}%"></i></div></div>`;
    const defLine = b.defLost != null ? `<div class="tc-nb-def">防线 ${b.defLost}/${b.defTotal}${b.defName ? ' \u00b7 ' + esc(b.defName) : ''}${locks}</div>` : '';
    /* 她五维压成一行（B/C 副信息用）：只列真有值的 */
    const miniBits = [];
    if (b.love != null) miniBits.push('爱 ' + b.love);
    if (rival != null) miniBits.push((taken ? '敌' : '恋') + ' ' + rival);
    if (b.train != null) miniBits.push('调 ' + b.train);
    if (b.submit != null) miniBits.push('屈 ' + b.submit);
    if (b.lewd != null) miniBits.push('淫 ' + b.lewd);
    const mini = miniBits.map((t) => `<span>${t}</span>`).join('<i>\u00b7</i>');
    const extraBits = (b.extra || []).map((e) => pair(e.label, e.a, e.b, 'n-extra')).join('');

    /* 卡 A·受害 / 旧卡：主体 = 她的五维。这一支的字符串与 v3.15.0 逐字节相同。 */
    if (!roleCls) {
      return `<div class="tc-nb s${stage}"><span class="tc-nb-wm">${NB_WM[stage]}</span>${stamp}
      ${head}
      <div class="tc-nb-body">
        <div class="tc-bgrid">${one('爱', b.love, 'n-love')}${one(taken ? '敌' : '恋', rival, 'n-crush')}${pair('调', b.train, b.trainYou, 'n-train')}${pair('屈', b.submit, b.submitYou, 'n-submit')}${one('淫', b.lewd, 'n-lewd')}${extraBits}</div>
        ${ring}${ring2}
      </div>${kinkRow}
      ${defLine}
    </div>`;
    }

    /* 卡 B·被夺：主体 = 你。上半是你自己的漂移，她只剩一行摘要。 */
    if (b.role === '\u88ab\u593a') {
      /* 主体是「你」：只放主语真是玩家的值，标签写全中文 —— 三条裸数字等于让人猜「我在往哪边漂」 */
      const youBits = one('你对她的爱', b.love, 'n-love') + one('你对他的敌意', rival, 'n-you') +
        (b.kink == null ? '' : one('你的绿帽癖', b.kink, 'n-you'));
      const empty = b.love == null && rival == null && b.kink == null;
      /* 她那一侧压成一行：调/屈 仍带双值（A=被他 / B=被你），30、60 这两个数一个都不丢 */
      const herBits = [];
      if (b.train != null) herBits.push('调 ' + b.train + (b.trainYou == null ? '' : '/' + b.trainYou));
      if (b.submit != null) herBits.push('屈 ' + b.submit + (b.submitYou == null ? '' : '/' + b.submitYou));
      if (b.lewd != null) herBits.push('淫 ' + b.lewd);
      const herLine = herBits.map((t) => `<span>${t}</span>`).join('<i>\u00b7</i>');
      return `<div class="tc-nb s${stage} role-t"><span class="tc-nb-wm">${NB_WM[stage]}</span>${stamp}
      ${head}
      <div class="tc-nb-body">
        <div class="tc-nb-you">
          <div class="tc-you-hd"><b>你的漂移</b><em>YOU DRIFT</em></div>
          <div class="tc-bgrid">${empty ? '<div class="tc-bv tc-you-empty"><span>—</span><b>未提供</b></div>' : youBits}${extraBits}</div>
        </div>
        ${ring}${ring2}
      </div>
      <div class="tc-nb-mini"><b>她</b>${herLine || '<span>\u2014</span>'}</div>
      ${defLine}
    </div>`;
    }

    /* 卡 C·夺取：主体 = 防线逐道。你在拆，关心的是拆到第几道。 */
    /* 「第N道」是编号不是名字 —— 玩家要知道「她哪道线守住了」。名字做主、状态做次、编号降成角标。 */
    /* 布局契约：窄屏 CSS 把防线钉成 repeat(5,…)、DEF_NAMES 也正好 5 道。
       防线变多时不能静默变挤（格宽一路掉，而几何判据还能全绿），所以在卡上直接说出来。 */
    const defOver = b.defTotal > DEF_NAMES.length;
    const defRows = b.defLost == null ? '' : Array.from({ length: b.defTotal }, (_, i) => {
      const lost = i < b.defLost;
      const nm = DEF_NAMES[i] || ('第' + (i + 1) + '道');
      return `<div class="tc-def-row ${lost ? 'lost' : 'hold'}"><i class="tc-def-idx">${i + 1}</i><b>${nm}</b><em>${lost ? '已失守' : '在守'}</em></div>`;
    }).join('');
    return `<div class="tc-nb s${stage} role-s"><span class="tc-nb-wm">${NB_WM[stage]}</span>${stamp}
      ${head}
      <div class="tc-nb-body">
        <div class="tc-nb-defs${defOver ? ' over' : ''}">${defRows || '<div class="tc-def-row hold"><b>无防线记录</b><em>不详</em></div>'}${defOver ? `<em class="tc-defs-warn">防线 ${b.defTotal} 道 > 布局 ${DEF_NAMES.length} 列，请同步 DEF_NAMES 与 CSS</em>` : ''}</div>
        ${ring}${ring2}
      </div>
      <div class="tc-nb-side"><b>她</b>${mini}</div>${kinkRow}
    </div>`;
  }

  /* NTR 加害者卡（nf 行）：暗红「猎手」档案。攻势 ◆/◇ + 攻势标签，八成以上热度加 hot 辉光；
     未现身显示「身份不明」幽灵卡。 */
  function renderNtrFoe(f) {
    const unknown = !f.name || /^(未知|不明|？|\?|——|-|—)$/.test(f.name.trim());
    const dots = f.step == null ? '' : `<span class="tc-nf-atk">攻势</span><span class="tc-nf-dots">${'◆'.repeat(f.step)}${'◇'.repeat(Math.max(0, f.total - f.step))}</span>`;
    const hot = (f.step != null && f.total > 0 && f.step / f.total >= 0.8) ? ' hot' : '';
    if (unknown) return `<div class="tc-nf ghost"><span class="tc-nf-wm">猎</span><b>？？？</b><span>身份不明</span>${dots ? `<span class="tc-nf-atk">攻势</span><span class="tc-nf-dots">${'◇'.repeat(f.total || 5)}</span>` : ''}</div>`;
    return `<div class="tc-nf${hot}"><span class="tc-nf-wm">猎</span>
      <div class="tc-nf-hd"><b>${esc(f.name)}</b>${f.role ? `<span class="tc-nf-role">${esc(f.role)}</span>` : ''}</div>
      <div class="tc-nf-meta">${f.method ? `<span class="tc-nf-method">锋 ${esc(f.method)}</span>` : ''}${f.method2 ? `<span class="tc-nf-method sub">辅 ${esc(f.method2)}</span>` : ''}${dots}${f.weak ? `<em>🎯 弱点 ${esc(f.weak)}</em>` : ''}</div>
    </div>`;
  }

  function renderQuest(q) {
    if (!q || !q.main) return '';
    const subs = q.subs.map(s => `<span class="tc-sub">${esc(s.name)}${s.status && !/^无$/.test(s.status) ? `<i>${esc(s.status)}</i>` : ''}</span>`).join('');
    return `<div class="tc-quest">
      <div class="tc-qmain"><b>主线</b><span>${esc(q.main.goal)}</span>
        ${q.main.time && !/^(无|—|-)$/.test(q.main.time) ? `<em>⏳ ${esc(q.main.time)}</em>` : ''}
        ${q.main.fail && !/^(无|—|-)$/.test(q.main.fail) ? `<em class="bad">✕ ${esc(q.main.fail)}</em>` : ''}</div>
      ${subs ? `<div class="tc-qsubs">${subs}</div>` : ''}
    </div>`;
  }

  function renderNext(v) {
    if (!v) return '';
    const marks = [];
    const re = /(?:^|[\s,，;；/｜|])([A-H0-9]{1,2})(?=[\s.、．)）:：])/g;
    let m;
    while ((m = re.exec(v)) !== null) {
      marks.push({ i: m.index + m[0].length - m[1].length, k: m[1] });
    }
    if (!marks.length) return `<div class="tc-next"><b>NEXT</b><span>${esc(v)}</span></div>`;
    const opts = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].i + marks[i].k.length;
      const end = i + 1 < marks.length ? marks[i + 1].i : v.length;
      opts.push(`<div class="tc-opt"><b>${esc(marks[i].k)}</b><span>${esc(v.slice(start, end).replace(/^[\s.、．)）:：]+/, '').trim())}</span></div>`);
    }
    return `<div class="tc-next"><div class="tc-opts">${opts.join('')}</div></div>`;
  }

  /* dmg 卡：一瞬间的事，画面要有爆点。
     判据（遮住文字只看形状颜色）：谁打谁（方向带箭头）、打得多重（数值是主角，字号随量级涨）、
     什么性质（七色系）、判定（暴击发光双描边 / 闪避虚线与缺口）。血条画「前→后」，消掉那段用斜纹。 */
  function renderDmg(d, i, total) {
    const k = d.kind ? 'k-' + d.kind : 'k-x';
    const v = d.verdict ? 'v-' + d.verdict : 'v-none';
    const crit = d.verdict === 'crit';
    const dodge = d.verdict === 'dodge';
    const amt = dodge ? '—' : (d.amount == null ? '?' : String(d.amount));
    const mag = d.amount == null ? 's0' : (d.amount >= 50 ? 's3' : d.amount >= 20 ? 's2' : 's1');

    let hp = '';
    if (d.hpBefore != null && d.hpAfter != null && d.hpBefore > 0) {
      const keep = Math.max(0, Math.min(100, Math.round(d.hpAfter / d.hpBefore * 100)));
      hp = `<div class="tc-dmg-hp">
        <span class="hb">${d.hpBefore}</span>
        <div class="tc-dmg-bar"><i class="keep" style="width:${keep}%"></i><i class="gone" style="left:${keep}%;width:${100 - keep}%"></i></div>
        <span class="ha">${d.hpAfter}</span>
      </div>`;
    }

    const warn = d.mismatch
      ? `<i class="tc-dmg-warn">数值对不上：血 −${d.delta}／伤 ${d.amount}（模型算错了，按上面显示原样核对）</i>`
      : '';

    const meta = [];
    if (d.cause) meta.push(`<span><u>因</u>${esc(d.cause)}</span>`);
    if (d.calc) meta.push(`<span><u>算</u>${esc(d.calc)}</span>`);
    d.extra.forEach(x => meta.push(`<span>${esc(x)}</span>`));

    return `<div class="tc-dmg ${k} ${v} ${mag}">
      <i class="tc-dmg-spine"></i>
      <div class="tc-dmg-flow">
        <span class="who from">${esc(d.from || '？')}</span>
        <span class="arrow"><i></i></span>
        <span class="who to">${esc(d.to || '？')}</span>
        ${d.verdictRaw ? `<span class="verdict">${esc(d.verdictRaw)}</span>` : ''}
      </div>
      <div class="tc-dmg-core">
        <span class="num">${esc(amt)}</span>
        <span class="tags">${d.kindRaw ? `<b class="kind">${esc(d.kindRaw)}</b>` : ''}${d.part ? `<span class="part">${esc(d.part)}</span>` : ''}</span>
      </div>
      ${hp}
      ${warn}
      ${meta.length ? `<div class="tc-dmg-meta">${meta.join('')}</div>` : ''}
    </div>`;
  }

  function render(st) {
    const scene = seg(st.scene);
    const out = [];
    const sect = (zh, en) => `<div class="tc-sect"><i></i><b>${esc(zh)}</b><em>${en}</em></div>`;

    /* ── 行内键切分标记：**不许静默修好**。
          我们只是不让它白屏；AI 把整块写成一行这件事必须被玩家看见，
          否则下一次它还会这么写、而且没人知道面板在替它兜。 ── */
    if (st.inlineSplit) {
      out.push(`<div class="tc-split">⚠ 此行缺换行，已自动切分（${st.inlineSplit} 段）</div>`);
    }

    /* ── 顶部指令栏 ── */
    out.push(`<div class="tc-cmdbar">
      ${scene[0] ? `<span class="tc-time"><u></u>${esc(scene[0])}</span>` : ''}
      ${scene[1] ? `<span class="tc-loc">⌖ ${esc(scene[1])}</span>` : ''}
      ${scene[2] ? `<span class="tc-atmo">${esc(scene[2])}</span>` : ''}
    </div>`);

    if (st.team) {
      out.push(`<div class="tc-team">${seg(st.team).map(x => `<span>${esc(x)}</span>`).join('')}</div>`);
    }

    out.push(renderQuest(st.quest));

    /* ── 交火区：dmg 行按发生顺序竖排，走出一条战斗时间线 ── */
    if (st.dmgs.length) {
      out.push(`<div class="tc-dmgs">${sect('交火 · 伤害结算', 'IMPACT LOG')}${st.dmgs.map((d, i) => renderDmg(d, i, st.dmgs.length)).join('')}</div>`);
    }

    /* ── 灾变横幅：全宽横条，压在双栏之前 —— 它描述的是整场的处境，不属于任何一栏 ── */
    if (st.disasters.length) {
      out.push(`<div class="tc-dzs">${st.disasters.map(renderDisaster).join('')}</div>`);
    }

    /* ── 双栏战场：左翼我方 / 右翼威胁与判定 ── */
    const colL = [], colR = [];
    if (st.players.length || st.mechas.length || st.familiars.length) {
      colL.push(sect('我方小队', 'SQUAD'));
      /* 同号 kbm 紧跟 p 卡；找不到 p 的 kbm 排在玩家之后单独成卡（不许丢） */
      const kmBy = new Map(st.mechas.map(m => [m.idx, m]));
      const kfBy = new Map(st.familiars.map(f => [f.idx, f]));
      const kUsed = new Set();
      const fUsed = new Set();
      const cards = st.players.map(p => {
        const m = kmBy.get(p.idx), f = kfBy.get(p.idx);
        let one = renderPlayer(p);
        if (m) { kUsed.add(m.idx); one += renderMecha(m, true); }
        /* 使魔只按「同号 p」排队，不画归属竖线：它不是装上来的，是召来的 */
        if (f) { fUsed.add(f.idx); one += renderFamiliar(f); }
        return one;
      });
      st.mechas.forEach(m => { if (!kUsed.has(m.idx)) cards.push(renderMecha(m, false)); });
      st.familiars.forEach(f => { if (!fUsed.has(f.idx)) cards.push(renderFamiliar(f)); });
      colL.push(`<div class="tc-grid tc-stack">${cards.join('')}</div>`);
    }
    if (st.shelters.length) {
      colL.push(sect('避难所', 'SHELTER'));
      colL.push(`<div class="tc-shelters">${st.shelters.map(renderShelter).join('')}</div>`);
    }
    /* ── 仓储：容量 M 从同一栋的 舱 取（舱当前 ×2）——仓储不是独立空间，它装在船里 ── */
    if (st.warehouses.length) {
      const hold = st.shelters.length ? st.shelters[0].hold : null;
      const cap = hold && hold.max > 0 ? hold.cur * 2 : null;
      colL.push(sect('仓储', 'HOLD'));
      colL.push(`<div class="tc-whs">${st.warehouses.map(w => renderWarehouse(w, cap)).join('')}</div>`);
    }
    if (st.bonds.length) {
      colL.push(sect('羁绊', 'BONDS'));
      colL.push(`<div class="tc-bonds">${st.bonds.map(renderBond).join('')}</div>`);
    }
    if (st.foes.length) {
      colR.push(sect('宿敌', 'NEMESIS'));
      colR.push(`<div class="tc-foes">${st.foes.map(renderFoe).join('')}</div>`);
    }
    if (st.ntrBonds.length) {
      colL.push(sect('伴侣 · 夺走进度', 'POSSESSION'));
      colL.push(`<div class="tc-nbs">${st.ntrBonds.map(renderNtrBond).join('')}</div>`);
    }
    if (st.ntrHearts.length) {
      colL.push(sect('心声 · 两副面孔', 'MIRROR'));
      colL.push(`<div class="tc-nhs">${st.ntrHearts.map(renderNtrHeart).join('')}</div>`);
    }
    if (st.ntrFoes.length) {
      colR.push(sect('加害者', 'PREDATOR'));
      colR.push(`<div class="tc-nfs">${st.ntrFoes.map(renderNtrFoe).join('')}</div>`);
    }
    if (st.ntrFalls.length) {
      colR.push(sect('防线 · 失守档案', 'FALLS'));
      colR.push(`<div class="tc-nds">${st.ntrFalls.map(renderNtrFalls).join('')}</div>`);
    }
    if (st.ntrLogs.length) {
      colR.push(sect('暗流 · 事件轴', 'UNDERCURRENT'));
      colR.push(`<div class="tc-nls">${st.ntrLogs.map(renderNtrLog).join('')}</div>`);
    }
    /* 场所排在右栏末尾：它是「周围有什么」，不是威胁也不是队员 */
    if (st.places.length) {
      colR.push(sect('场所', 'PLACES'));
      colR.push(`<div class="tc-pls">${st.places.map(renderPlace).join('')}</div>`);
    }
    if (st.npcs.length) {
      colL.push(sect('在场人物', 'CONTACTS'));
      colL.push(`<div class="tc-npcs">${st.npcs.map(renderNpc).join('')}</div>`);
    }
    for (const e of EXT_KEYS) if (st[e.field].length) {
      colL.push(sect('在场人物 · ' + e.key.toUpperCase(), 'CONTACTS'));
      colL.push(`<div class="tc-npcs ${e.theme}">${st[e.field].map(e.render).join('')}</div>`);
    }
    if (st.mobs.length) {
      colR.push(sect('敌方威胁', 'THREAT'));
      colR.push(`<div class="tc-mobs">${st.mobs.map(renderMob).join('')}</div>`);
    }
    if (st.checks.length) {
      colR.push(sect('判定流', 'CHECK LOG'));
      st.checks.forEach((c, i) => colR.push(renderCheck(c, i)));
    }
    if (colL.length || colR.length) {
      const hint = colL.length && colR.length ? `<div class="tc-swipe-hint">内容可左右滑动</div>` : '';
      out.push(hint + `<div class="tc-main">${
        colL.length ? `<div class="tc-col">${colL.join('')}</div>` : ''
      }${colR.length ? `<div class="tc-col">${colR.join('')}</div>` : ''}</div>`);
    }

    /* ── 战场日志（时间线） ── */
    const log = [];
    if (st.result) log.push(`<div class="tc-line tc-result"><b>🎯 行动结果</b><span>${esc(st.result)}</span></div>`);
    if (st.world && !/^(无|—|-)$/.test(String(st.world).trim())) {
      log.push(`<div class="tc-line tc-world"><b>🌊 世界涟漪</b><span>${esc(st.world)}</span></div>`);
    }
    if (log.length) out.push(`<div class="tc-log">${log.join('')}</div>`);

    out.push(renderNext(st.next));

    const mini = isMini();
    return `<div class="tc-wrap${mini ? ' tc-mini' : ''}" data-tw-ver="${VERSION}">` +
      `<button class="tc-size" type="button" title="${mini ? '切换到完整面板' : '切换到紧凑面板'}">${mini ? '＋' : '－'}</button>` +
      `${out.filter(Boolean).join('')}<div class="tc-ver">tw-card v${VERSION}${mini ? ' · 紧凑' : ''}</div></div>`;
  }

  /* ══════════ 扫描 ══════════ */

  function looksLikeState(t) {
    return /(^|\n)[ \t]*(scene|team|check)[ \t]*[:：]/.test(t) && /(^|\n)[ \t]*(p[0-9]+|next)[ \t]*[:：]/.test(t);
  }

  function extractBlock(text) {
    const lines = text.split(/\r?\n/);
    let start = -1, end = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (isStateLine(l)) { if (start < 0) start = i; end = i; continue; }
      if (start >= 0 && /^(```|~~~)/.test(l)) continue;
      if (start >= 0) break;
    }
    if (start < 0) return null;
    return { start, end, body: lines.slice(start, end + 1).join('\n') };
  }

  /* ── 把 <br>/</p> 还原成真换行，再取纯文本 ── */
  function nodeText(n) {
    let h = n.nodeType === 3 ? (n.nodeValue || '') : (n.innerHTML || '');
    h = h.replace(/<br\s*\/?>/gi, '\n');
    h = h.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
    h = h.replace(/<[^>]+>/g, '');
    h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
         .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
    return h;
  }

  /* ── 找连续的状态行节点（不碰正文节点） ── */
  function collectLines(el) {
    const kids = Array.from(el.childNodes);
    const txtOf = (n) => String(n.nodeType === 3 ? (n.nodeValue || '') : (n.textContent || ''));
    const hit = (n) => {
      const s = txtOf(n).trim();
      if (!s) return false;
      return s.split(/\r?\n/).some(x => isStateLine(x.trim()));
    };
    const blank = (n) => !txtOf(n).trim();

    /* 空段落 / 空白文本节点不算断点 —— ST 常把状态块里的一处空行渲染成 <p></p> */
    const runs = [];
    let cur = [];
    for (const n of kids) {
      if (hit(n)) { cur.push(n); }
      else if (blank(n)) { /* 跳过，不断开 */ }
      else { if (cur.length) { runs.push(cur); cur = []; } }
    }
    if (cur.length) runs.push(cur);
    if (!runs.length) return null;
    runs.sort((a, b) => b.length - a.length);
    return runs[0];
  }

  /* ── 只替换状态块节点，正文 DOM 完全不动。
        同一条消息里可能有多段状态行（正文隔开的 mob 块等），循环吃干净 ── */
  function sweep() {
    const nodes = DOC.querySelectorAll('.mes_text');
    for (const el of nodes) {
      try {
        let guard = 0;
        while (guard++ < 6) {
          const run = collectLines(el);
          if (!run) break;

          const raw = run.map(nodeText).join('\n');
          const blk = extractBlock(raw);
          if (!blk) break;

          const st = parseState(blk.body);
          /* 守卫：完全没有已定义状态键的段才跳过。
             孤立的 next: / check: / bond: 等附属段（被正文与主状态块隔开）也必须渲染，
             否则主块渲染完、后续孤段会被静默丢弃（v3.10.0 真实故障：next: 丢失）。 */
          const meaningful = st.players.length || st.mechas.length || st.familiars.length || st.dmgs.length || st.scene || st.mobs.length ||
            st.bonds.length || st.foes.length || st.npcs.length ||
            st.ntrBonds.length || st.ntrFoes.length || st.ntrHearts.length || st.ntrFalls.length || st.ntrLogs.length ||
            st.checks.length || st.quest || st.next || st.result || st.world || st.team;
          if (!meaningful) break;

          const holder = DOC.createElement('div');
          holder.innerHTML = render(st);
          const wrap = holder.firstElementChild;
          if (!wrap) break;

          const first = run[0];
          if (!first.parentNode) break;
          const par = first.parentNode;

          /* 单个节点里「正文 + 状态块」混排时，先把前后正文救出来 */
          if (run.length === 1) {
            const txt = nodeText(first);
            const lines = txt.split(/\r?\n/);
            const beforeTxt = lines.slice(0, blk.start).join('\n').trim();
            const afterTxt = lines.slice(blk.end + 1).join('\n').trim();
            if (beforeTxt) {
              const p = DOC.createElement('p');
              p.textContent = beforeTxt;
              par.insertBefore(p, first);
            }
            par.insertBefore(wrap, first);
            if (afterTxt) {
              const p = DOC.createElement('p');
              p.textContent = afterTxt;
              par.insertBefore(p, first);
            }
            try { first.remove(); } catch (e) { first.textContent = ''; }
          } else {
            par.insertBefore(wrap, first);
            for (const n of run) { try { n.remove(); } catch (e) { n.textContent = ''; } }
          }
        }
      } catch (e) { /* 单条失败不影响其它楼层 */ }
    }
  }

  /* ══════════ 样式 ══════════ */

  const CSS = `
.tc-ver{font-size:10px;color:#3a4557;text-align:right;margin-top:6px;letter-spacing:.04em}
.tc-wrap{
  --bg: rgba(14,19,28,.95); --bg2: rgba(27,33,45,.92); --bd: rgba(120,140,170,.2);
  --fg: #dde5f0; --dim: #8794a8; --acc: #7dd3fc; --gold: #fbbf24; --pink: #f472b6; --red: #fca5a5;
  --hud: rgba(125,211,252,.6);
  position:relative;
  margin:10px 0; padding:12px 13px; border-radius:13px;
  background-color:var(--bg);
  background-image:
    linear-gradient(var(--hud),var(--hud)),linear-gradient(var(--hud),var(--hud)),
    linear-gradient(var(--hud),var(--hud)),linear-gradient(var(--hud),var(--hud)),
    linear-gradient(var(--hud),var(--hud)),linear-gradient(var(--hud),var(--hud)),
    linear-gradient(var(--hud),var(--hud)),linear-gradient(var(--hud),var(--hud));
  background-repeat:no-repeat;
  background-size:17px 2px,2px 17px,17px 2px,2px 17px,17px 2px,2px 17px,17px 2px,2px 17px;
  background-position:left top,left top,right top,right top,left bottom,left bottom,right bottom,right bottom;
  border:1px solid rgba(125,211,252,.16);
  box-shadow:inset 0 0 26px rgba(103,232,249,.04),0 2px 14px rgba(0,0,0,.35);
  font-size:13px; line-height:1.55; color:var(--fg);
  font-variant-numeric:tabular-nums; white-space:normal; word-break:break-word;
}
.tc-wrap::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:repeating-linear-gradient(0deg,transparent 0 3px,rgba(255,255,255,.013) 3px 4px)}
.tc-wrap *{box-sizing:border-box;white-space:normal}

/* ── 行内键切分提示：AI 把整块写成一行时，面板拆完还要当面说一句 ──
   用琥珀黄（与 .tc-dmg-warn 同一套「我们兜住了但这是错的」语气），虚线左边框，
   不用红色：红是「战斗失败」，这里是「格式错」，别把两件事混成一个信号。 */
.tc-split{display:flex;align-items:center;gap:7px;margin-bottom:8px;padding:5px 10px;
  border:1px dashed rgba(251,191,36,.42);border-left:3px solid #fbbf24;border-radius:6px;
  background:rgba(251,191,36,.07);color:#fcd34d;font-size:11.5px;letter-spacing:.02em}
/* ── 顶部指令栏 ── */
.tc-cmdbar{display:flex;flex-wrap:wrap;align-items:center;gap:5px 14px;
  background:linear-gradient(180deg,rgba(125,211,252,.10),rgba(125,211,252,.02));
  border:1px solid rgba(125,211,252,.22);border-left:3px solid var(--acc);
  border-radius:7px;padding:6px 11px;margin-bottom:8px;font-size:12.5px}
.tc-time{display:inline-flex;align-items:center;gap:7px;color:var(--acc);font-weight:700;letter-spacing:.03em}
.tc-time u{text-decoration:none;width:7px;height:7px;border-radius:50%;background:#22d3ee;
  box-shadow:0 0 7px #22d3ee;animation:tc-rec 1.7s ease-in-out infinite}
@keyframes tc-rec{0%,100%{opacity:1}50%{opacity:.22}}
.tc-loc{color:#e3ecf7;font-weight:600}
.tc-atmo{color:var(--dim);font-size:11.5px;margin-left:auto}
.tc-team{display:flex;flex-wrap:wrap;gap:5px 14px;margin:0 0 8px;font-size:12px;color:#a9b8cc}
.tc-team span::before{content:'▪ ';color:#51617a}

/* ── HUD 分区标头 ── */
.tc-sect{display:flex;align-items:center;gap:8px;margin:11px 0 7px}
.tc-sect i{flex:0 0 auto;width:7px;height:7px;background:var(--acc);transform:rotate(45deg);
  box-shadow:0 0 7px rgba(125,211,252,.85)}
.tc-sect b{flex:0 0 auto;font-size:11.5px;letter-spacing:.16em;color:#d3e8f8;font-weight:700}
.tc-sect em{flex:0 0 auto;font-style:normal;font-size:9.5px;letter-spacing:.24em;color:#51617a}
.tc-sect::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(125,211,252,.32),transparent)}

/* ── 双栏战场 ── */
.tc-main{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:2px 16px;align-items:start}
.tc-grid.tc-stack{display:flex;flex-direction:column;gap:8px}
.tc-col .tc-card{max-width:none}

.tc-quest{background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.26);
  border-radius:9px;padding:8px 12px;margin-bottom:8px;
  clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%);
  box-shadow:inset 0 0 18px rgba(251,191,36,.05)}
.tc-qmain{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;font-size:12.5px}
.tc-qmain b{font-size:10px;background:rgba(251,191,36,.2);color:var(--gold);border-radius:4px;padding:1px 7px;letter-spacing:.06em}
.tc-qmain em{font-style:normal;font-size:11.5px;color:var(--gold)}
.tc-qmain em.bad{color:#f87171}
.tc-qsubs{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:6px}
.tc-sub{font-size:11.5px;color:#b9c6d8;background:rgba(255,255,255,.06);border-radius:5px;padding:1px 8px}
.tc-sub i{font-style:normal;color:var(--acc);margin-left:6px}

.tc-check{background:rgba(251,191,36,.05);border:1px solid rgba(251,191,36,.22);
  border-radius:9px;padding:7px 11px;margin-bottom:7px;font-size:12.5px}
.tc-check summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 10px;cursor:pointer;list-style:none}
.tc-check summary::-webkit-details-marker{display:none}
.tc-check summary>b{font-size:12px}
.tc-ctitle{font-weight:600;color:#f0e2b8}
.tc-check summary u{text-decoration:none;font-size:11px;border-radius:20px;padding:1px 9px}
.tc-check summary u.ok{background:rgba(74,222,128,.16);color:#4ade80}
.tc-check summary u.bad{background:rgba(248,113,113,.16);color:#f87171}
.tc-check summary em{font-style:normal;font-size:11px;color:var(--gold);margin-left:auto}
.tc-check.none{display:flex;gap:10px;align-items:baseline;color:var(--dim)}
.tc-check.none b{font-size:10px;background:rgba(255,255,255,.07);border-radius:4px;padding:1px 7px}
.tc-cbody{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:2px 16px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--bd)}
.tc-crow{display:flex;justify-content:space-between;align-items:baseline;gap:8px;
  font-size:12px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.045);min-width:0}
.tc-crow span{color:var(--dim);flex:0 0 auto;font-size:11px}
.tc-crow b{font-weight:600;text-align:right;color:#e8eef8;min-width:0;
  overflow-wrap:anywhere;word-break:break-word}
.tc-cnote{margin-top:7px;font-size:12px;color:#cbd8e8;background:rgba(255,255,255,.04);
  border-left:3px solid var(--acc);border-radius:5px;padding:5px 10px}
.tc-cfoot{margin-top:5px;font-size:11px;color:var(--dim);text-align:right}

.tc-mobs{display:grid;grid-template-columns:repeat(auto-fit,minmax(258px,1fr));gap:8px;margin-bottom:8px;align-items:start}
.tc-mob{position:relative;background:#1a1114;border:1px solid #4a2630;border-left:3px solid #b91c1c;border-radius:10px;padding:8px 11px;min-width:0}
/* 杂兵：紧凑低调，衬得精英和BOSS更有排面 */
.tc-mob.g-mob{background:#150f13;border-left-width:2px;border-left-color:#6b2730;padding:6px 10px}
.tc-mob.g-mob .tc-mob-name{font-size:12px;font-weight:600;color:#d3bcc1}
.tc-mob.g-mob .tc-mob-grade{background:#241318;color:#b08a92}
.tc-mob.g-mob .tc-mob-hp{font-size:11px;color:#b08a92}
.tc-mob.g-mob .tc-mob-bar{height:4px;margin:4px 0 5px}
.tc-mob.g-mob .tc-mattr b{font-size:11px;color:#b99ba2}
/* 精英：切角装甲板、琥珀金流光呼吸 */
.tc-mob.g-elite{border:1px solid #8a5c16;border-left:4px solid #f59e0b;background:linear-gradient(135deg,#1c1410 0%,#261b0d 55%,#1c1410 100%);clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px));filter:drop-shadow(0 0 7px rgba(245,158,11,.30));padding:12px 15px;animation:tc-eliteglow 3s ease-in-out infinite}
@keyframes tc-eliteglow{0%,100%{filter:drop-shadow(0 0 6px rgba(245,158,11,.22))}50%{filter:drop-shadow(0 0 14px rgba(245,158,11,.48))}}
.tc-mob.g-elite .tc-mob-name{font-size:16px;color:#ffe9c2;text-shadow:0 0 9px rgba(245,158,11,.55)}
.tc-mob.g-elite .tc-mob-grade{background:linear-gradient(90deg,#7a4a0a,#b97a10);color:#fff3d6;font-weight:700;font-size:10.5px;padding:2px 9px;box-shadow:0 0 6px rgba(245,158,11,.45)}
.tc-mob.g-elite .tc-mob-grade::before{content:'◆ '}
.tc-mob.g-elite .tc-mob-hp{color:#fbbf24;font-size:13.5px;font-weight:700}
.tc-mob.g-elite .tc-mob-bar{height:8px;margin:6px 0 7px;background:#241708;border-radius:2px}
.tc-mob.g-elite .tc-mattr b{color:#fcd9a0}
/* BOSS：整行占位、重型装甲切角、滚动警戒纹、巨型水印、红光呼吸 */
.tc-mob.g-boss{grid-column:1/-1;overflow:hidden;border:1px solid #ef4444;border-left:6px solid #ef4444;background:linear-gradient(120deg,#20090c 0%,#3a0d12 45%,#20090c 100%);clip-path:polygon(0 0,calc(100% - 22px) 0,100% 22px,100% 100%,22px 100%,0 calc(100% - 22px));padding:16px 19px 14px;animation:tc-bosspulse 2.4s ease-in-out infinite}
.tc-mob.g-boss::before{content:'';position:absolute;top:0;left:0;right:0;height:5px;background:repeating-linear-gradient(-55deg,#ef4444 0 12px,transparent 12px 24px);opacity:.75;animation:tc-hazard 1.6s linear infinite}
.tc-mob.g-boss::after{content:'BOSS';position:absolute;right:10px;bottom:-14px;font-size:58px;font-weight:900;letter-spacing:6px;color:#ef4444;opacity:.07;pointer-events:none}
@keyframes tc-bosspulse{0%,100%{filter:drop-shadow(0 0 9px rgba(239,68,68,.35))}50%{filter:drop-shadow(0 0 24px rgba(239,68,68,.65))}}
@keyframes tc-hazard{from{background-position:0 0}to{background-position:34px 0}}
@keyframes tc-shine{from{transform:translateX(-110%)}to{transform:translateX(260%)}}
@keyframes tc-lowblink{0%,100%{opacity:1}50%{opacity:.3}}
.tc-mob.g-boss .tc-mob-name{font-size:20px;letter-spacing:2px;color:#ffd7d7;text-shadow:0 0 14px rgba(239,68,68,.9),0 0 34px rgba(239,68,68,.4)}
.tc-mob.g-boss .tc-mob-grade{background:linear-gradient(90deg,#991b1b,#dc2626);color:#fff1f1;font-size:11.5px;padding:3px 11px;font-weight:800;letter-spacing:1px;box-shadow:0 0 9px rgba(239,68,68,.55)}
.tc-mob.g-boss .tc-mob-grade::before{content:'☠ '}
.tc-mob.g-boss .tc-mob-hp{color:#fca5a5;font-size:16px;font-weight:800}
.tc-mob.g-boss .tc-mob-bar{height:12px;margin:8px 0 9px;background:#1c0a0d;border-radius:2px}
.tc-mob.g-boss .tc-mob-bar i{background:linear-gradient(90deg,#7f1d1d,#ef4444 55%,#fbbf24);position:relative;overflow:hidden}
.tc-mob.g-boss .tc-mob-intent{font-size:13.5px;padding:5px 11px;border-left:3px solid #ef4444;color:#fecaca;background:#2b0d11;font-weight:600}
.tc-mob.g-boss .tc-mob-intent::before{content:'⚡ '}
.tc-mob.g-boss .tc-mattr{background:#2b0d11;border-color:#5c1f26}
.tc-mob.g-boss .tc-mattr b{color:#ffd7d7}
/* 精英/BOSS 血条流光扫过 */
.tc-mob.g-elite .tc-mob-bar i{background:linear-gradient(90deg,#92400e,#f59e0b 60%,#fde68a)}
.tc-mob.g-elite .tc-mob-bar i,.tc-mob.g-boss .tc-mob-bar i{position:relative;overflow:hidden}
.tc-mob.g-elite .tc-mob-bar i::after,.tc-mob.g-boss .tc-mob-bar i::after{content:'';position:absolute;top:0;bottom:0;left:0;width:40%;background:linear-gradient(105deg,transparent 15%,rgba(255,255,255,.45) 50%,transparent 85%);animation:tc-shine 2.6s linear infinite}
/* 低血量(<=25%)：血条急促闪烁告警 */
.tc-mob.tc-lowhp .tc-mob-bar i{animation:tc-lowblink .7s steps(1) infinite}
.tc-mob-hd{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.tc-mob-name{font-weight:700;color:#f2d6da;font-size:13.5px}
.tc-mob-grade{font-size:10px;padding:1px 6px;border-radius:4px;background:#3b1418;color:#fca5a5;white-space:nowrap}
.tc-mob-hp{margin-left:auto;font-variant-numeric:tabular-nums;color:#fca5a5;font-size:12px;white-space:nowrap}
.tc-mob-bar{height:5px;background:#2a1418;border-radius:3px;overflow:hidden;margin:5px 0 6px}
.tc-mob-bar i{display:block;height:100%;background:linear-gradient(90deg,#7f1d1d,#ef4444);border-radius:3px}
/* 敌人七维属性格 */
.tc-mattrs{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin:2px 0 6px}
.tc-mattr{display:flex;flex-direction:column;align-items:center;gap:0;background:#241318;border:1px solid #3d2028;border-radius:5px;padding:2px 0;font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.15}
.tc-mattr i{font-style:normal;font-size:8.5px;color:#a89096;letter-spacing:0;white-space:nowrap}
.tc-mattr b{font-size:12px;color:#e8c9ce;font-weight:700;white-space:nowrap}
.tc-mattr b{font-size:12.5px;color:#e8c9ce;font-weight:700}
.tc-mattr u{text-decoration:none;font-size:9px;color:#7dd3a8}
.tc-mattr.unk{opacity:.55}
.tc-mattrs .tc-mattr:only-child{grid-column:1/-1}
.tc-mob-meta{display:flex;flex-wrap:wrap;gap:4px 9px;font-size:11.5px;color:#a89096;margin-bottom:5px;align-items:center}
.tc-mob-st{background:#2a1418;border:1px solid #4a2630;border-radius:4px;padding:0 5px;color:#f0a5b0}
.tc-mob-tg{color:#fbbf24;font-weight:600}
.tc-mob-intent{background:#2a1013;border:1px solid #7f1d1d;border-radius:6px;padding:3px 8px;font-size:12px;color:#fecaca;font-weight:600}
.tc-mob-intent::before{content:"➤ "}
.tc-mob-weak{margin-top:5px;font-size:11px;color:#8a7a80}
/* ── NPC 卡：紫金情报网（非敌对在场人物，与敌方红色系彻底区分） ── */
.tc-npcs{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:8px;margin-bottom:8px}
.tc-npc{position:relative;overflow:hidden;font-size:12px;color:#cfc3e8;
  background:linear-gradient(135deg,#131020 0%,#1c1733 55%,#131020 100%);
  border:1px solid #372a55;border-left:3px solid #a78bfa;border-radius:10px;padding:7px 11px;
  transition:border-color .2s,box-shadow .2s}
.tc-npc:hover{border-color:#5b4a8a;box-shadow:0 0 10px rgba(167,139,250,.22)}
.tc-npc::after{content:'◈';position:absolute;right:9px;top:6px;font-size:11px;color:#a78bfa;opacity:.4;pointer-events:none}
.tc-npc::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,#a78bfa 0%,rgba(167,139,250,.2) 50%,transparent 85%);opacity:.55}
.tc-npcs.tc-kb .tc-npc{border-color:#1e3a5f;border-left-color:#38bdf8}
.tc-npcs.tc-kb .tc-npc::before{background:linear-gradient(90deg,#38bdf8,rgba(56,189,248,.2) 50%,transparent 85%)}
.tc-npcs.tc-ntr .tc-npc{border-color:#4a1d2c;border-left-color:#f43f5e}
.tc-npcs.tc-ntr .tc-npc::before{background:linear-gradient(90deg,#f43f5e,rgba(244,63,94,.2) 50%,transparent 85%)}
.tc-npc-hd{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.tc-npc-name{font-weight:700;font-size:13.5px;color:#e4dbf7;letter-spacing:.5px}
.tc-npc-role{font-size:10px;padding:1px 7px;border-radius:4px;background:#2b2144;color:#c4b5fd;
  border:1px solid #453568;white-space:nowrap}
.tc-npc-att{font-size:10px;padding:1px 7px;border-radius:4px;white-space:nowrap;font-weight:600}
.tc-npc-att.a-friend{background:#0e2a26;color:#5eead4;border:1px solid #1d5148}
.tc-npc-att.a-neutral{background:#2b2144;color:#fbbf24;border:1px solid #57451f}
.tc-npc-att.a-hostile{background:#2a1418;color:#f0a5b0;border:1px solid #4a2630}
.tc-npc-st{margin-top:4px;font-size:11.5px;color:#b9a8e0;letter-spacing:.3px}
.tc-npc-st::before{content:'◇ ';color:#8b5cf6}
.tc-npc-attrs{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.tc-npc-attrs span{display:inline-flex;align-items:center;gap:2px;background:#221b3a;border:1px solid #3a2d5c;
  border-radius:4px;padding:1px 6px;font-size:10px;color:#9d8cc7;font-variant-numeric:tabular-nums;white-space:nowrap}
.tc-npc-attrs span b{color:#d6c9f5;font-weight:700;font-size:11.5px}
.tc-npc-note{margin-top:4px;font-size:11px;color:#8f82ad;line-height:1.5}

.tc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:8px;margin-bottom:8px}
/* 玩家卡：青蓝钢甲、切角装甲板、编号水印、辉光呼吸 */
.tc-card{position:relative;overflow:hidden;background:linear-gradient(135deg,#0e141d 0%,#16202e 55%,#0e141d 100%);
  border:1px solid #24384f;border-left:3px solid #22d3ee;max-width:560px;
  clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px));
  padding:9px 12px;display:flex;flex-direction:column;gap:6px;
  animation:tc-cardglow 4.5s ease-in-out infinite}
.tc-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#22d3ee 0%,rgba(34,211,238,.25) 45%,transparent 80%);opacity:.8}
.tc-card::after{content:attr(data-n);position:absolute;right:8px;top:-8px;font-size:52px;font-weight:900;letter-spacing:2px;color:#38bdf8;opacity:.06;pointer-events:none}
@keyframes tc-cardglow{0%,100%{filter:drop-shadow(0 0 4px rgba(34,211,238,.14))}50%{filter:drop-shadow(0 0 11px rgba(34,211,238,.30))}}
.tc-chead{display:flex;align-items:center;gap:7px;padding-bottom:5px;border-bottom:1px dashed #24384f}
.tc-pnum{font-size:9.5px;font-weight:800;letter-spacing:1px;color:#67e8f9;background:rgba(34,211,238,.10);border:1px solid rgba(34,211,238,.35);border-radius:3px;padding:1px 5px;white-space:nowrap}
.tc-name{font-size:15px;font-weight:700;letter-spacing:.5px;color:#e8f6ff;text-shadow:0 0 10px rgba(34,211,238,.45)}
.tc-badge{margin-left:auto;font-size:10.5px;padding:1px 10px;white-space:nowrap;
  clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)}
.tc-badge.ok{background:rgba(74,222,128,.15);color:#4ade80}
.tc-badge.warn{background:rgba(251,191,36,.15);color:#fbbf24}
.tc-badge.bad{background:rgba(248,113,113,.16);color:#f87171}

.tc-attrs{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
.tc-attr{display:grid;grid-template-columns:40px 1fr auto;gap:0 4px;align-items:baseline;
  font-size:11.5px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.045);min-width:0}
.tc-ak{color:var(--dim);font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tc-av{color:#94a3b8;font-weight:400;white-space:nowrap;font-size:11px}
.tc-av small{font-size:8.5px;color:#4ade80}
.tc-at{font-weight:700;color:#e2ecf8;justify-self:end;font-size:12.5px;white-space:nowrap}
.tc-at::before{content:"= ";color:#3f4d61;font-weight:400;font-size:10px}
.tc-attr.ov .tc-at{color:var(--gold)}
.tc-attr.ov .tc-ak{color:#d0a94a}

.tc-vitals{display:flex;flex-direction:column;gap:3px}
.tc-vit{display:grid;grid-template-columns:56px 1fr;gap:2px 8px;align-items:center;font-size:11.5px}
.tc-vit>span{color:var(--dim);font-size:10px;white-space:nowrap}
.tc-vit>b{text-align:right;font-weight:600}
.tc-bar{grid-column:2;height:6px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden}
.tc-bar i{display:block;height:100%;border-radius:2px;position:relative;overflow:hidden}
.tc-bar i.hp{background:linear-gradient(90deg,#7f1d1d,#ef4444 60%,#f87171)}
.tc-bar i.sp{background:linear-gradient(90deg,#1e3a8a,#3b82f6 60%,#7dd3fc)}
.tc-bar i.wt{background:linear-gradient(90deg,#a16207,#fbbf24)}
.tc-bar i.hp::after,.tc-bar i.sp::after{content:'';position:absolute;top:0;bottom:0;left:0;width:40%;background:linear-gradient(105deg,transparent 15%,rgba(255,255,255,.40) 50%,transparent 85%);animation:tc-shine 3s linear infinite}
/* 玩家低血量(<=25%)：HP 条急促闪烁 + 名字转红 */
.tc-card.tc-lowhp .tc-bar i.hp{animation:tc-lowblink .7s steps(1) infinite}
.tc-card.tc-lowhp .tc-name{color:#fca5a5;text-shadow:0 0 10px rgba(239,68,68,.7)}

.tc-nums{display:flex;flex-wrap:wrap;gap:3px 12px;font-size:11.5px;color:#b9c6d8}
.tc-nums .tc-wpn{color:#c4b5fd}
.tc-pen{font-size:11.5px;color:#f8a5a5;background:rgba(248,113,113,.07);border-radius:5px;padding:2px 8px}
.tc-tags{display:flex;flex-wrap:wrap;gap:4px}
.tc-tags span{font-size:10.5px;color:#a9b8cc;background:rgba(255,255,255,.06);border-radius:5px;padding:1px 7px}

.tc-pills{display:flex;flex-wrap:wrap;gap:4px}
.tc-pill{font-size:10.5px;border-radius:20px;padding:1px 9px;white-space:nowrap;
  border:1px solid transparent;line-height:1.7}
.tc-pill.pts{background:rgba(234,179,8,.14);color:#fbbf24;border-color:rgba(234,179,8,.3)}
.tc-pill.lock{background:rgba(168,85,247,.13);color:#c084fc;border-color:rgba(168,85,247,.3)}
.tc-pill.lock.hi{background:rgba(168,85,247,.22);color:#e9d5ff;border-color:rgba(192,132,252,.55)}
.tc-pill.lock.warn{background:rgba(248,113,113,.16);color:#fca5a5;border-color:rgba(248,113,113,.45)}
.tc-pill.ti{background:rgba(96,165,250,.13);color:#93c5fd;border-color:rgba(96,165,250,.3)}
.tc-pill.ti i{font-style:normal;opacity:.72;font-size:9.5px}
.tc-pill.cr{background:rgba(45,212,191,.13);color:#5eead4;border-color:rgba(45,212,191,.32)}
.tc-pill.cr b{color:#99f6e4;font-weight:700}
.tc-fold{border-top:1px dashed var(--bd);padding-top:5px;margin-top:1px}
.tc-fold summary{cursor:pointer;font-size:11px;color:var(--dim);list-style:none;letter-spacing:.04em}
.tc-fold summary::-webkit-details-marker{display:none}
.tc-fold summary::before{content:'▸ ';color:var(--acc)}
.tc-fold[open] summary::before{content:'▾ '}

.tc-skills{display:flex;flex-direction:column;gap:1px;margin-top:5px}
.tc-skill{display:grid;grid-template-columns:1fr auto;gap:0 8px;padding:4px 0;
  border-bottom:1px solid rgba(255,255,255,.04);font-size:11.5px}
.tc-skill b{color:#c4b5fd;font-weight:600}
.tc-skill em{grid-column:2;grid-row:1/3;align-self:center;font-style:normal;
  font-size:9.5px;color:var(--gold);white-space:nowrap}
.tc-skill span{grid-column:1;color:#c9d4e3}

.tc-eq{display:flex;flex-direction:column;gap:1px;margin-top:5px}
.tc-eqrow{display:grid;grid-template-columns:64px 1fr;gap:8px;font-size:11.5px;
  padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.tc-eqrow span{color:var(--dim);font-size:10.5px}
.tc-eqrow b{font-weight:600;color:#dbe6f4}
.tc-eqrow b.empty{color:#5a6778;font-weight:400}
.tc-eqbonus b{color:#6ee7b7}

.tc-file{display:flex;flex-direction:column;gap:1px;margin-top:5px}
.tc-file>div{display:grid;grid-template-columns:92px 1fr;gap:8px;font-size:11.5px;padding:3px 0;
  border-bottom:1px solid rgba(255,255,255,.04)}
.tc-file span{color:var(--dim);font-size:10.5px}
.tc-file b{font-weight:600;color:#dbe6f4}

.tc-bonds,.tc-foes{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:8px;margin-bottom:8px}
.tc-bond{background:rgba(224,85,154,.07);border:1px solid rgba(224,85,154,.3);border-radius:10px;padding:8px 11px}
.tc-bhead{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.tc-bhead b{color:var(--pink);font-size:13px}
.tc-bhead em{font-style:normal;font-size:10.5px;color:var(--dim);background:rgba(255,255,255,.06);border-radius:4px;padding:1px 8px}
.tc-bhead .tc-trace{margin-left:auto;font-size:10.5px;color:var(--gold)}
.tc-bgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:4px 12px}
.tc-bv{display:grid;grid-template-columns:18px 1fr;gap:2px 6px;align-items:center;font-size:11.5px}
.tc-bv>span{color:var(--dim);font-size:10px}
.tc-bv>b{text-align:right;font-weight:600}
.tc-bbar{grid-column:2;height:3px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden}
.tc-bbar i{display:block;height:100%;border-radius:2px}
.tc-bbar i.love{background:linear-gradient(90deg,#7f1d3a,#e0559a)}
.tc-bbar i.crush{background:linear-gradient(90deg,#4c1d95,#c084fc)}
.tc-bbar i.train{background:linear-gradient(90deg,#5b2a1a,#f59e0b)}
.tc-bbar i.submit{background:linear-gradient(90deg,#1e3a5f,#38bdf8)}
.tc-bbar i.lewd{background:linear-gradient(90deg,#7c2d12,#fb7185)}
.tc-mask{background:#3b1020;border:1px solid #9f1239;color:#fda4af;border-radius:5px;padding:1px 6px;font-size:10.5px}
.tc-def{margin-top:7px;font-size:11px;color:var(--dim)}
.tc-dbar{height:5px;margin-top:4px;border-radius:3px;overflow:hidden;
  background:repeating-linear-gradient(45deg,rgba(255,255,255,.06) 0 4px,rgba(255,255,255,.02) 4px 8px)}
.tc-dbar i{display:block;height:100%;background:repeating-linear-gradient(45deg,#4c1d95 0 4px,#7c3aed 4px 8px)}
.tc-foe{background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.3);border-radius:10px;
  padding:8px 11px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;font-size:12px}
.tc-foe b{color:var(--red);font-size:13px}
.tc-foe>span{color:var(--dim)}
.tc-dots{color:#ef4444;letter-spacing:2px;font-size:11px}
.tc-foe em{margin-left:auto;font-style:normal;font-size:11px;color:var(--dim)}

/* ── NTR 夺走卡（nb/nf）：绯红主题，与 bond/foe 完全区分 ── */
.tc-nbs,.tc-nfs{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:8px;margin-bottom:8px}
.tc-nb{position:relative;overflow:hidden;border-radius:10px;padding:9px 12px;
  background:linear-gradient(140deg,rgba(120,10,30,.18),rgba(45,6,16,.10));
  border:1px solid rgba(225,29,72,.32)}
.tc-nb::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse at 88% -25%,rgba(225,29,72,.25),transparent 55%)}
.tc-nb.s2{border-color:rgba(225,29,72,.45)}
.tc-nb.s3{border-color:rgba(225,29,72,.6);background:linear-gradient(140deg,rgba(140,12,34,.24),rgba(50,7,18,.12))}
.tc-nb.s4{border-color:rgba(225,29,72,.75);background:linear-gradient(140deg,rgba(155,14,38,.3),rgba(56,8,20,.15));box-shadow:inset 0 0 18px rgba(225,29,72,.12)}
.tc-nb.s5{border-color:#e11d48;background:linear-gradient(140deg,rgba(170,16,42,.34),rgba(60,9,22,.18));box-shadow:0 0 14px rgba(225,29,72,.35),inset 0 0 22px rgba(225,29,72,.16)}
.tc-nb.s4{animation:nbPulse 2.8s ease-in-out infinite}
.tc-nb.s5{animation:nbPulse 1.7s ease-in-out infinite}
@keyframes nbPulse{0%,100%{box-shadow:0 0 8px rgba(225,29,72,.22)}50%{box-shadow:0 0 22px rgba(225,29,72,.55)}}
.tc-nb-wm{position:absolute;right:6px;top:50%;transform:translateY(-52%);pointer-events:none;
  font-size:58px;font-weight:800;line-height:1;color:rgba(225,29,72,.09);user-select:none}
.tc-nb-ring{width:58px;height:58px;flex:none;filter:drop-shadow(0 0 5px rgba(225,29,72,.35))}
.tc-nb-body{position:relative;display:flex;align-items:center;gap:10px}
.tc-nb-body .tc-bgrid{flex:1;min-width:0}
.tc-nb-stamp{position:absolute;right:10px;bottom:8px;z-index:1;pointer-events:none;
  font-size:20px;font-weight:800;letter-spacing:6px;color:rgba(225,29,72,.5);
  border:2px solid rgba(225,29,72,.5);border-radius:6px;padding:1px 8px 1px 12px;
  transform:rotate(-11deg);opacity:.75}
.tc-nb .tc-bhead b{color:#fb7185;font-size:13.5px;letter-spacing:1px}
.tc-nb .tc-bhead em{background:rgba(225,29,72,.14);color:#fda4af}
.tc-nb .tc-bhead .tc-trace{color:#fbbf24}
.tc-bbar i.n-love{background:linear-gradient(90deg,#334155,#93c5fd)}
.tc-bbar i.n-crush{background:linear-gradient(90deg,#4c0519,#fb7185)}
.tc-bbar i.n-train{background:linear-gradient(90deg,#4a044e,#e879f9)}
.tc-bbar i.n-submit{background:linear-gradient(90deg,#450a0a,#f87171)}
.tc-bbar i.n-lewd{background:linear-gradient(90deg,#7f1d1d,#fda4af)}
.tc-bbar.two{position:relative;height:7px}
.tc-bbar.two i{position:absolute;left:0;border-radius:2px}
.tc-bbar.two i.a{top:0;height:4px}
/* B 值那条不靠透明度区分（缩略下会整个消失）：同一维度、另一种填法 —— 斜纹 */
.tc-bbar.two i.b{bottom:0;height:3px;
  background-image:repeating-linear-gradient(45deg,rgba(8,4,14,.62) 0 2px,transparent 2px 4px)}
.tc-bv>b i{font-style:normal;font-weight:400;font-size:10px;color:#64748b;margin:0 1px}
.tc-bv>b em{font-style:normal;font-weight:600;font-size:11px;color:#7dd3fc}
.tc-bbar i.n-kink{background:linear-gradient(90deg,#78350f,#fbbf24)}
.tc-bbar i.n-extra{background:linear-gradient(90deg,#1e3a5f,#7dd3fc)}
.tc-mask.tc-role{font-size:11px;font-weight:700;letter-spacing:.06em;padding:2px 8px;border-radius:6px}
.tc-mask.tc-role.r-v{background:#0e1c28;border-color:#3f7397;color:#a9c9de}
.tc-mask.tc-role.r-t{background:#2a1d05;border-color:#b45309;color:#fcd34d}
.tc-mask.tc-role.r-s{background:#1f1038;border-color:#7c3aed;color:#ddd6fe}
.tc-nb-ring.recall{filter:drop-shadow(0 0 5px rgba(56,189,248,.35))}
/* 位=受害 / 旧卡：侵蚀边。CSS 生成、不加 DOM —— 所以旧卡的 render 输出仍然逐字节不变 */
.tc-nb::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:
    linear-gradient(270deg,rgba(244,63,94,.34) 0%,rgba(244,63,94,.16) 18%,rgba(244,63,94,.05) 42%,transparent 66%),
    linear-gradient(270deg,rgba(244,63,94,.55) 0%,transparent 3%);}
/* 位=被夺：主体是你。琥珀警示色，跟受害的绯红分开 */
.tc-nb.role-t{border-color:rgba(180,83,9,.5);background:linear-gradient(140deg,rgba(92,54,10,.26),rgba(38,23,6,.14))}
.tc-nb.role-t::after{background:linear-gradient(180deg,rgba(251,191,36,.2),transparent 58%)}
.tc-nb.role-t .tc-bhead b{color:#fbbf24}
.tc-nb.role-t .tc-nb-wm{color:rgba(180,83,9,.13)}
.tc-nb-you{flex:1;min-width:0}
/* B 卡的标签是整句中文（你对她的爱…），.tc-bv 默认的 18px 标签列只够一个汉字，会被挤成竖排单字。
   这一组单独放宽：标签列自适应、不换行，条占满整行。 */
.tc-nb-you .tc-bgrid{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}
.tc-nb-you .tc-bv{grid-template-columns:1fr auto;gap:2px 6px}
.tc-nb-you .tc-bv>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em}
.tc-nb-you .tc-bv>.tc-bbar{grid-column:1 / -1}
.tc-you-hd{display:flex;align-items:baseline;gap:8px;margin-bottom:5px}
.tc-you-hd b{font-size:11.5px;letter-spacing:.14em;color:#fcd34d}
.tc-you-hd em{font-style:normal;font-size:9px;letter-spacing:.22em;color:#8a7340}
.tc-bbar i.n-you{background:linear-gradient(90deg,#78350f,#fbbf24)}
.tc-bv.tc-you-empty b{color:#6b7280;font-weight:400;font-size:10.5px}
.tc-nb-mini{margin-top:7px;padding-top:6px;border-top:1px dashed rgba(251,191,36,.2);
  display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:10.5px;color:#93a0b4;letter-spacing:.02em}
.tc-nb-mini b{color:#a98b3d;font-size:9.5px;letter-spacing:.16em}
.tc-nb-mini span{opacity:.85}
.tc-nb-mini i{font-style:normal;color:#4b5563}
/* 位=夺取：主体是防线逐道。紫色、边框向内收（主动、压迫感） */
.tc-nb.role-s{border-color:rgba(124,58,237,.55);background:linear-gradient(140deg,rgba(46,26,84,.3),rgba(24,14,46,.16));
  box-shadow:inset 0 0 26px rgba(124,58,237,.22)}
.tc-nb.role-s::after{background:radial-gradient(ellipse at 50% 118%,rgba(124,58,237,.24),transparent 62%)}
.tc-nb.role-s .tc-bhead b{color:#c4b5fd}
.tc-nb.role-s .tc-nb-wm{color:rgba(124,58,237,.12)}
.tc-nb-defs{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(76px,1fr));gap:4px 8px}  /* 76 而非 96：五道防线排成等宽一行，不出现 3+2 那种「后两块变宽」的主次错觉；第 6 道起才换行，换行后每块仍与第一行同宽 */
.tc-nb-defs.over{outline:1px dashed rgba(252,211,77,.45);outline-offset:2px}
.tc-defs-warn{grid-column:1 / -1;font-size:9.5px;font-style:normal;color:#fcd34d}  /* 防线数 > 布局列数时才出现的那行黄字，点出「要同步 DEF_NAMES 与窄屏列数」 */
.tc-def-row{position:relative;display:flex;align-items:baseline;gap:6px;border-radius:5px;padding:3px 7px;font-size:11px;
  border:1px solid transparent;background:rgba(255,255,255,.04)}
.tc-def-row b{font-weight:700;color:#cbbcf7;font-size:11.5px;letter-spacing:.04em}
.tc-def-idx{position:absolute;top:2px;right:4px;font-style:normal;font-size:8px;font-weight:700;
  letter-spacing:0;color:rgba(203,188,247,.42);line-height:1}
.tc-def-row em{font-style:normal;margin-left:auto;font-size:10.5px;font-weight:700}
.tc-def-row.lost{border-color:rgba(244,63,94,.45);background:rgba(244,63,94,.12)}
.tc-def-row.lost em{color:#fb7185}
.tc-def-row.hold{border-color:rgba(124,58,237,.35);background:rgba(124,58,237,.1)}
.tc-def-row.hold em{color:#a78bfa}
.tc-nb-side{margin-top:7px;padding-top:6px;border-top:1px dashed rgba(124,58,237,.22);
  display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:10.5px;color:#93a0b4;letter-spacing:.02em}
.tc-nb-side b{color:#8b7bc0;font-size:9.5px;letter-spacing:.16em}
.tc-nb-side span{opacity:.85}
.tc-nb-side i{font-style:normal;color:#4b5563}


.tc-nb-kink{display:flex;align-items:center;gap:8px;margin-top:9px;padding-top:7px;border-top:1px dashed rgba(251,191,36,.22);font-size:11px;color:#9a8a63;letter-spacing:.04em}
.tc-nb-kink span{color:#fbbf24;font-weight:700;letter-spacing:.16em}
.tc-nb-kink b{color:#fcd34d;font-size:13px;font-weight:700;min-width:24px;text-align:right}
.tc-nb-kink em{font-style:normal;font-size:10px;color:#6b5f45;letter-spacing:.1em}
/* ── 机甲卡（kbm）：切角外框 + 等宽读数 + 插槽，刻意与玩家卡/伴侣卡不同骨架 ── */
.tc-kbm{position:relative;margin-top:6px}
.tc-kbm-in{position:relative;padding:9px 12px 10px;background:#0a1218;border-radius:0;
  border:1px solid #26424f;border-left:3px solid #22d3ee;
  clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
.tc-kbm-in::before{content:'';position:absolute;left:4px;top:4px;width:9px;height:9px;
  border:1px solid #22d3ee;border-right:0;border-bottom:0;opacity:.55}
.tc-kbm::after{content:'';position:absolute;right:5px;bottom:5px;width:9px;height:9px;
  border:1px solid #22d3ee;border-left:0;border-top:0;opacity:.55}
.tc-kbm.t-heavy .tc-kbm-in{border-color:#4a3410;border-left-color:#f59e0b}
.tc-kbm.t-heavy .tc-kbm-in::before,.tc-kbm.t-heavy::after{border-color:#f59e0b}
.tc-kbm.t-full .tc-kbm-in{border-color:#2e2450;border-left-color:#a78bfa}
.tc-kbm.t-full .tc-kbm-in::before,.tc-kbm.t-full::after{border-color:#a78bfa}
/* 归属竖线：驾驶中带子的 ::before 长在外层（未被 clip-path 裁），从卡片顶向上 7px 与玩家卡左缘接上。
   左侧 0 对齐的就是玩家卡 .tc-card 的 border-left:3px，所以两卡看起来是同一根线。 */
.tc-kbm.paired::before{content:'';position:absolute;left:-1px;top:-12px;width:5px;height:18px;
  background:linear-gradient(180deg,#22d3ee 0 9px,var(--tie,#22d3ee) 9px 100%)}
.tc-kbm.t-heavy{--tie:#f59e0b}
.tc-kbm.t-full{--tie:#a78bfa}
.tc-kbm-hd{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.tc-kbm-hd>b{font-size:13.5px;color:#a5f3fc;letter-spacing:.04em}
.tc-kbm-drive{font-style:normal;font-size:9.5px;letter-spacing:.14em;color:#5f8fa0;
  border-bottom:1px solid rgba(34,211,238,.28);padding-bottom:1px}
.tc-kbm-type{margin-left:6px;font-size:12px;font-weight:700;letter-spacing:.1em;padding:4px 10px;color:#a5f3fc}
.tc-kbm-type.ty-human{border:1px solid #22d3ee;border-radius:5px}
.tc-kbm-type.ty-heavy{border:2px double #f59e0b;color:#fcd34d;padding:4px 12px;
  clip-path:polygon(13% 0,100% 0,87% 100%,0 100%)}
.tc-kbm-type.ty-full{border:2px solid #a78bfa;color:#ddd6fe;background:rgba(124,58,237,.16);
  padding:4px 14px;clip-path:polygon(20% 0,80% 0,100% 50%,80% 100%,20% 100%,0 50%)}
.tc-kbm-gauges,.tc-kbm-cus{display:flex;flex-direction:column;gap:3px}
.tc-kbm-g{display:grid;grid-template-columns:42px 34px 1fr;align-items:center;gap:0 6px}
.tc-kbm-gl{font-size:10px;color:#5f7b8a;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tc-kbm-gv{font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;
  font-size:12px;color:#c8f1fb;text-align:right;white-space:pre}
.tc-kbm-gm{font-family:ui-monospace,Consolas,monospace;font-size:9.5px;color:#47606d}
.tc-kbm-g .tc-bar{grid-column:1 / -1;height:5px;background:#0f1e26}
.tc-kbm-g .tc-bar{position:relative;overflow:hidden}
/* 刻度画在填充之上：放在 .tc-bar 自己的背景里会被 <i> 的填充色盖掉（只剩未填充那一截有格线） */
.tc-kbm-g .tc-bar.ticks::after{content:'';position:absolute;inset:0;pointer-events:none;
  background-image:repeating-linear-gradient(90deg,
    transparent 0 calc(10% - 1px),rgba(6,12,16,.62) calc(10% - 1px) 10%)}
.tc-kbm-g.dry .tc-kbm-gv,.tc-kbm-g.dry .tc-kbm-gm{color:#6b7280}
.tc-kbm-attrs{display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:7px}
.tc-kbm-attrs span{font-size:10.5px;color:#7c98a8}
.tc-kbm-attrs i{font-style:normal;color:#4f6b7a;margin-right:3px}
.tc-kbm-attrs b{font-family:ui-monospace,Consolas,monospace;color:#b8dbe8;font-weight:600}
/* 缺项占位：比数值暗一档、不加粗 —— 一眼看出是"没写"而不是"值是横杠" */
.tc-kbm-attrs .miss i{color:#3c5563}
.tc-kbm-attrs .miss b{color:#415a68;font-weight:400}
.tc-kbm-cus{margin-top:7px;padding-top:6px;border-top:1px dashed rgba(34,211,238,.14)}
.tc-kbm-g.x .tc-kbm-gl{color:#67a3b8}
.tc-kbm-g.x .tc-kbm-gv{color:#9fd8e8}
.tc-bar i.kbm-x{background:linear-gradient(90deg,#0e7490,#67e8f9)}
.tc-kbm-tags{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:7px}
.tc-kbm-tagl{font-style:normal;font-size:9.5px;letter-spacing:.14em;color:#456b7a;margin-right:1px}
.tc-kbm-tags span{font-size:10.5px;padding:1px 8px;color:#a8cbd8;
  border:1px dashed rgba(34,211,238,.42);border-radius:2px;background:rgba(34,211,238,.09)}
.tc-kbm-eq{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.tc-kbm-eq .slot{font-size:10.5px;padding:2px 9px;color:#b6cfda;background:#0b1720;
  border:1px solid #2b4a58;border-radius:1px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),inset 0 1px 0 rgba(120,200,220,.12)}
.tc-kbm.dead{filter:saturate(.32)}
.tc-kbm.dead .tc-kbm-hd>b{color:#94a3b8}
.tc-kbm.dead .tc-kbm-in{background-image:repeating-linear-gradient(45deg,rgba(244,63,94,.34) 0 7px,rgba(10,18,24,0) 7px 14px)}
/* 整卡 filter:saturate(.32) 会把盖章一起削灰，这里反向补回来——失效是重点，不能糊 */
.tc-kbm-stamp{position:absolute;right:10px;bottom:8px;transform:rotate(-8deg);filter:saturate(2.6) brightness(1.25);
  font-size:11px;font-weight:800;letter-spacing:.18em;color:#fecdd3;
  border:2px solid #e11d48;border-radius:3px;padding:1px 8px;background:rgba(76,5,25,.55)}
/* v3.17 的旧 .tc-kbm 定义已并入上面的 v3.18 骨架：重复声明会把切角、徽章字号与失效斜纹覆盖回去，
   这里只保留不会被新规则覆盖的条色。 */
.tc-bar i.kbm-dead{background:linear-gradient(90deg,#7f1d1d,#b91c1c)}
.tc-bar i.kbm{background:linear-gradient(90deg,#b91c1c,#f43f5e)}
.tc-bar i.kbm-en{background:linear-gradient(90deg,#0369a1,#38bdf8)}
.tc-bar i.kbm-sp{background:linear-gradient(90deg,#6d28d9,#c084fc)}
.tc-bar i.kbm-en-dry,.tc-bar i.kbm-sp-dry{background:linear-gradient(90deg,#3f3f46,#71717a)}
.tc-kbm-sub{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:7px}
.tc-kbm-il{display:flex;align-items:baseline;gap:4px;font-size:10px;color:#7c9aa8}
.tc-kbm-il>span{letter-spacing:.1em;color:#94a3b8;min-width:15px}
.tc-kbm-il>b{font-size:11px;font-weight:700;color:#a5f3fc;min-width:22px;text-align:right}
.tc-kbm-il>em{font-style:normal;font-size:9px;color:#5c7381}

/* ══════════ dmg 交火卡（v3.20） ══════════
   判据：遮住文字只看轮廓，要能读出「谁打谁 / 多重的伤 / 什么性质 / 死了没」。
   所以：方向靠箭头与两端的强弱对比，量级靠字号与环色，性质靠七条色系，判定靠描边与缺口。 */
.tc-dmgs{position:relative;margin:0 0 10px;padding:2px 0 0}
.tc-dmg{position:relative;display:grid;grid-template-columns:1fr auto;gap:2px 12px;
  margin:0 0 6px;padding:8px 12px 8px 16px;border-radius:2px;
  background:linear-gradient(100deg,rgba(12,10,20,.92),rgba(18,12,22,.72));
  border:1px solid #2a2438;border-left:3px solid var(--dk,#f43f5e)}
/* 左侧时间线：多行 dmg 竖排时连成一条，表示「按发生顺序」 */
.tc-dmg-spine{position:absolute;left:5px;top:0;bottom:0;width:1px;background:linear-gradient(180deg,transparent,var(--dk,#f43f5e),transparent);opacity:.55}
.tc-dmg-flow{grid-column:1 / -1;display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.04em}
.tc-dmg-flow .who{color:#c7d2fe;font-weight:700}
.tc-dmg-flow .who.to{color:#e2e8f0}
.tc-dmg-flow .arrow{flex:1;position:relative;height:9px;min-width:54px}
/* 方向：一条从中段向右收窄的光带 + 箭头尖，长得像「打过去」 */
.tc-dmg-flow .arrow::before{content:'';position:absolute;left:0;right:7px;top:4px;height:2px;
  background:linear-gradient(90deg,rgba(255,255,255,0),var(--dk,#f43f5e))}
.tc-dmg-flow .arrow::after{content:'';position:absolute;right:1px;top:1px;border:4px solid transparent;border-left:7px solid var(--dk,#f43f5e)}
.tc-dmg-flow .verdict{margin-left:auto;font-size:10px;font-weight:800;letter-spacing:.16em;
  color:var(--dk,#f43f5e);border:1px solid color-mix(in srgb,var(--dk,#f43f5e) 55%,transparent);
  border-radius:2px;padding:1px 6px}
.tc-dmg-core{display:flex;align-items:baseline;gap:8px;min-width:0}
.tc-dmg-core .num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;
  font-weight:800;line-height:1;color:#fff;text-shadow:0 0 14px color-mix(in srgb,var(--dk,#f43f5e) 75%,transparent)}
.tc-dmg-core .tags{display:flex;align-items:baseline;gap:6px;min-width:0}
.tc-dmg-core .kind{font-size:10px;font-weight:800;letter-spacing:.14em;color:var(--dk,#f43f5e);
  border-bottom:2px solid color-mix(in srgb,var(--dk,#f43f5e) 60%,transparent);padding-bottom:1px}
.tc-dmg-core .part{font-size:10px;color:#93a4b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 量级：伤越重字越大 —— 数值是这一块的视觉主角 */
.tc-dmg.s0 .num{font-size:20px}
.tc-dmg.s1 .num{font-size:30px}
.tc-dmg.s2 .num{font-size:38px}
.tc-dmg.s3 .num{font-size:46px}
/* 血条：前→后。保留段实心，消掉段斜纹 —— 只写两个数字看不出掉了多少 */
.tc-dmg-hp{grid-column:1 / -1;display:flex;align-items:center;gap:8px;margin-top:4px;font-size:10px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#8fa3b5}
.tc-dmg-hp .hb{min-width:26px;text-align:right;color:#cbd5e1}
.tc-dmg-hp .ha{min-width:26px;color:var(--dk,#f43f5e);font-weight:700}
.tc-dmg-bar{position:relative;flex:1;height:7px;border-radius:1px;background:#171322;overflow:hidden}
.tc-dmg-bar .keep{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#334155,#64748b)}
.tc-dmg-bar{background:#171322;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
.tc-dmg-bar .gone{position:absolute;top:0;bottom:0;
  background-image:repeating-linear-gradient(45deg,color-mix(in srgb,var(--dk,#f43f5e) 92%,transparent) 0 3px,rgba(8,4,12,.85) 3px 6px);
  box-shadow:inset 1px 0 0 color-mix(in srgb,var(--dk,#f43f5e) 90%,#fff)}
.tc-dmg-warn{grid-column:1 / -1;font-style:normal;font-size:10px;color:#fbbf24;margin-top:3px;
  border-left:2px solid #b45309;padding-left:6px;background:rgba(120,53,15,.16)}
.tc-dmg-meta{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:5px;font-size:10px;color:#6f8296}
.tc-dmg-meta u{text-decoration:none;color:#4f6376;margin-right:3px}
/* 七种性质各一色系（顺序 = 由外到内：撕裂红 / 钝击橙 / 穿刺青 / 灼烧金 / 腐蚀绿 / 精神紫 / 真实白） */
.tc-dmg.k-r{--dk:#f43f5e}
.tc-dmg.k-b{--dk:#fb923c}
.tc-dmg.k-p{--dk:#22d3ee}
.tc-dmg.k-f{--dk:#fbbf24}
.tc-dmg.k-c{--dk:#4ade80}
.tc-dmg.k-m{--dk:#c084fc}
.tc-dmg.k-t{--dk:#f8fafc}
.tc-dmg.k-x{--dk:#94a3b8}
/* 判定：暴击要一眼比命中重；闪避要「空」，所以数值退让、箭头断开、全身虚线 */
.tc-dmg.v-crit{border-color:color-mix(in srgb,var(--dk,#f43f5e) 70%,#fff);border-width:2px;
  box-shadow:0 0 0 1px color-mix(in srgb,var(--dk,#f43f5e) 45%,transparent),0 0 22px color-mix(in srgb,var(--dk,#f43f5e) 40%,transparent)}
.tc-dmg.v-crit .num{font-weight:900;text-shadow:0 0 10px #fff,0 0 26px var(--dk,#f43f5e)}
.tc-dmg.v-crit .verdict{background:color-mix(in srgb,var(--dk,#f43f5e) 26%,transparent);
  border-width:2px;box-shadow:0 0 12px color-mix(in srgb,var(--dk,#f43f5e) 55%,transparent)}
.tc-dmg.v-crit .tc-dmg-spine{opacity:1;width:2px}
.tc-dmg.v-dodge{border-style:dashed;background:linear-gradient(100deg,rgba(12,10,20,.7),rgba(18,12,22,.4))}
.tc-dmg.v-dodge .tc-dmg-flow .arrow::before{background:repeating-linear-gradient(90deg,var(--dk,#94a3b8) 0 4px,transparent 4px 9px)}
.tc-dmg.v-dodge .tc-dmg-flow .arrow::after{border-left-color:transparent;
  border:1px dashed color-mix(in srgb,var(--dk,#94a3b8) 80%,transparent);border-radius:50%;width:9px;height:9px;right:2px;top:0}
.tc-dmg.v-dodge .num{color:#94a3b8;text-shadow:none;font-weight:700}
.tc-dmg.v-dodge .tc-dmg-core .kind{opacity:.65;border-bottom-style:dashed}
.tc-dmg.v-guard{border-left-style:double;border-left-width:5px}
.tc-dmg.v-break{border-left-style:solid;border-left-width:5px}
.tc-dmg.v-hold .num{color:#cbd5e1}
.tc-kbm-il .tc-bar{flex:1;height:4px;margin-left:2px}
.tc-kbm-il.dry>b,.tc-kbm-il.dry>span{color:#6b7280}
.tc-nb-def{margin-top:7px;font-size:11px;color:#fca5a5;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tc-nb-locks{display:inline-flex;gap:2px;font-size:11px;filter:saturate(.85)}
.tc-nb-locks i{font-style:normal;opacity:.62}
.tc-nb-locks i.u{opacity:1}
.tc-nf{position:relative;overflow:hidden;background:linear-gradient(140deg,rgba(90,8,22,.22),rgba(35,5,14,.12));
  border:1px solid rgba(190,18,60,.4);border-radius:10px;padding:9px 12px;font-size:12px}
.tc-nf.hot{border-color:#e11d48;animation:nbPulse 1.9s ease-in-out infinite}
.tc-nf-wm{position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none;
  font-size:44px;font-weight:800;line-height:1;color:rgba(225,29,72,.08);user-select:none}
.tc-nf-atk{color:var(--dim);font-size:10px}
.tc-nf.ghost{border-style:dashed;opacity:.75;background:none}
.tc-nf>b{color:#fb7185;font-size:13px;letter-spacing:1px}
.tc-nf-hd{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.tc-nf-role{font-size:10.5px;color:var(--dim);background:rgba(255,255,255,.06);border-radius:4px;padding:1px 7px}
.tc-nf-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.tc-nf-method{color:#fda4af;background:rgba(225,29,72,.12);border:1px solid rgba(225,29,72,.3);
  border-radius:5px;padding:1px 8px;font-size:11px}
.tc-nf-method.sub{color:#e9d5ff;background:rgba(147,51,234,.12);border-color:rgba(147,51,234,.3)}
.tc-nf-dots{color:#f43f5e;letter-spacing:2.5px;font-size:11px}
.tc-nf em{margin-left:auto;font-style:normal;font-size:11px;color:var(--dim)}

/* ── NTR 心声卡（nh）：双面镜，左冷蓝面具 / 右绯红真面目 ── */
.tc-nhs{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:8px;margin-bottom:8px}
.tc-nh{position:relative;overflow:hidden;border-radius:10px;padding:8px 11px;
  background:linear-gradient(100deg,rgba(30,58,95,.16) 0 47%,rgba(20,10,16,.10) 50% 53%,rgba(120,10,30,.20) 56% 100%);
  border:1px solid rgba(190,18,60,.30)}
.tc-nh-wm{position:absolute;right:6px;bottom:-6px;pointer-events:none;
  font-size:46px;font-weight:800;line-height:1;color:rgba(225,29,72,.07);user-select:none}
.tc-nh-hd{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.tc-nh-hd>b{color:#fda4af;font-size:13px;letter-spacing:1px;
  text-shadow:0 0 8px rgba(225,29,72,.25)}
.tc-nh-mind{font-size:10px;color:#fcd34d;background:rgba(180,120,10,.14);
  border:1px solid rgba(245,158,11,.3);border-radius:4px;padding:0 6px}
.tc-nh-split{display:grid;grid-template-columns:1fr 1fr;gap:6px;position:relative}
.tc-nh-split>div{border-radius:7px;padding:5px 8px;display:flex;flex-direction:column;gap:3px}
.tc-nh-user{background:rgba(56,130,246,.10);border:1px solid rgba(96,165,250,.25)}
.tc-nh-rival{background:rgba(225,29,72,.12);border:1px solid rgba(244,63,94,.3)}
.tc-nh-split i{font-style:normal;font-size:9.5px;letter-spacing:2px;width:fit-content;
  border-radius:3px;padding:0 5px}
.tc-nh-user i{color:#93c5fd;background:rgba(96,165,250,.14)}
.tc-nh-rival i{color:#fda4af;background:rgba(244,63,94,.16)}
.tc-nh-split em{font-style:normal;font-size:11.5px;line-height:1.45;word-break:break-all}
.tc-nh-user em{color:#cfe0f2}
.tc-nh-rival em{color:#ffd6de}
.tc-nh-inner{position:relative;margin-top:6px;padding:5px 10px;font-size:11.5px;font-style:italic;
  color:rgba(252,165,165,.85);background:rgba(120,10,30,.10);border-radius:6px;
  border-left:2px solid rgba(225,29,72,.45)}
.tc-nh-inner::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;
  box-shadow:0 0 6px rgba(225,29,72,.5)}

/* ── NTR 防线档案（nd）：失守红 / 回填青 / 在守暗 ── */
.tc-nds{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:8px;margin-bottom:8px}
.tc-nd{border:1px solid rgba(120,53,15,.35);border-radius:10px;padding:8px 11px;
  background:linear-gradient(150deg,rgba(80,20,8,.14),rgba(25,8,10,.10))}
.tc-nd-hd{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
.tc-nd-hd b{color:#fdba74;font-size:12.5px;letter-spacing:1px}
.tc-nd-hd span{font-size:10px;color:var(--dim)}
.tc-nd-row{display:flex;align-items:baseline;gap:7px;font-size:11.5px;padding:3px 0;
  border-bottom:1px dashed rgba(255,255,255,.05)}
.tc-nd-row:last-child{border-bottom:none}
.tc-nd-row i{font-style:normal;font-size:11px;opacity:.85}
.tc-nd-row b{color:#e7d7c9;font-weight:600}
.tc-nd-row u{text-decoration:none;font-size:10px;border-radius:4px;padding:0 6px}
.tc-nd-row.f-lost u{color:#fca5a5;background:rgba(220,38,38,.16)}
.tc-nd-row.f-heal u{color:#5eead4;background:rgba(20,184,166,.14)}
.tc-nd-row.f-hold u{color:#cbd5e1;background:rgba(148,163,184,.14)}
.tc-nd-row time{font-size:10px;color:var(--dim)}
.tc-nd-row em{font-style:normal;font-size:10.5px;color:var(--dim);margin-left:auto;text-align:right;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52%}

/* ── NTR 暗流事件轴（nl）：绯红竖线时间线，不知情事件雾化 ── */
.tc-nls{position:relative;margin:2px 0 8px;padding-left:14px;display:flex;flex-direction:column;gap:6px}
.tc-nls::before{content:'';position:absolute;left:3px;top:8px;bottom:8px;width:1px;
  background:linear-gradient(180deg,rgba(225,29,72,.55),rgba(225,29,72,.2),transparent)}
.tc-nl{position:relative;border:1px solid rgba(190,18,60,.3);border-radius:9px;padding:6px 10px;
  background:linear-gradient(140deg,rgba(90,8,22,.16),rgba(30,6,12,.10));font-size:11.5px}
.tc-nl::before{content:'';position:absolute;left:-14px;top:12px;width:7px;height:7px;border-radius:50%;
  background:#e11d48;box-shadow:0 0 7px rgba(225,29,72,.85)}
.tc-nl.blind{opacity:.55;border-style:dashed;background:none}
.tc-nl.blind::before{background:#64748b;box-shadow:none}
.tc-nl-hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.tc-nl-hd time{font-size:10px;color:#fda4af;background:rgba(225,29,72,.12);border-radius:4px;padding:0 6px}
.tc-nl-hd b{color:#ffd6de;font-weight:600}
.tc-nl-know{margin-left:auto;font-size:10px;color:#94a3b8}
.tc-nl-know.no{color:#64748b}
.tc-nl-what{margin-top:3px;color:#d6c3c9;line-height:1.5}
.tc-nl-her{margin-top:3px;font-style:italic;color:rgba(252,165,165,.8)}
.tc-nl-her::before{content:''}
.tc-nf.ghost b{color:var(--dim)}

/* ── 战场日志时间线 ── */
.tc-log{position:relative;margin:11px 0 5px;padding-left:15px;display:flex;flex-direction:column;gap:6px}
.tc-log::before{content:'';position:absolute;left:3px;top:10px;bottom:10px;width:1px;
  background:linear-gradient(180deg,rgba(52,211,153,.55),rgba(34,211,238,.55),transparent)}
.tc-log .tc-line{position:relative;margin:0}
.tc-log .tc-line::before{content:'';position:absolute;left:-15px;top:9px;width:7px;height:7px;border-radius:50%;
  background:#34d399;box-shadow:0 0 7px rgba(52,211,153,.9)}
.tc-log .tc-world::before{background:#22d3ee;box-shadow:0 0 7px rgba(34,211,238,.9)}
.tc-line{display:flex;gap:10px;font-size:12.5px;margin-bottom:6px;align-items:flex-start}
.tc-line b{flex:0 0 auto;font-size:10px;letter-spacing:.05em;border-radius:4px;padding:2px 8px;width:auto}
.tc-result{background:rgba(52,211,153,.06);border-radius:7px;padding:6px 10px}
.tc-result b{background:rgba(52,211,153,.16);color:#6ee7b7}
.tc-world{background:rgba(34,211,238,.05);border-radius:7px;padding:6px 10px}
.tc-world b{background:rgba(34,211,238,.16);color:#67e8f9}
.tc-world span{color:#b9c6d8}

/* ── 行动选项：指令键 ── */
.tc-next{margin-top:9px}
.tc-opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(238px,1fr));gap:6px;margin-top:5px}
.tc-opt{position:relative;display:flex;gap:9px;align-items:baseline;padding:7px 26px 7px 12px;
  background:linear-gradient(180deg,rgba(103,232,249,.09),rgba(103,232,249,.025));
  border:1px solid rgba(103,232,249,.3);
  clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
.tc-opt b{flex:0 0 auto;color:#081420;background:#67e8f9;font-weight:800;font-size:11px;
  border-radius:3px;padding:1px 7px;box-shadow:0 0 9px rgba(103,232,249,.6)}
.tc-opt span{color:#dbe6f4}
.tc-opt::after{content:'▸';position:absolute;right:9px;top:50%;transform:translateY(-50%);
  color:rgba(103,232,249,.65);font-size:11px}
.tc-next>span{font-size:12.5px}

/* ── 手机端适配（≤760px）：不翻页，双栏按原样排开，整块可横向滑动 ──
   右滑内容往左走，露出被挤掉的部分；无吸附、无分页，桌面端（>760px）完全不受影响 */
.tc-swipe-hint{display:none}
@media (max-width:760px){
  .tc-wrap{padding:10px 11px;font-size:12.5px}
  .tc-main{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:430px;
    justify-content:start;overflow-x:auto;-webkit-overflow-scrolling:touch;
    scrollbar-width:none;gap:0 18px}
  .tc-main::-webkit-scrollbar{display:none}
  .tc-main>.tc-col{min-width:0}
  .tc-swipe-hint{display:flex;align-items:center;justify-content:center;gap:10px;
    color:#51617a;font-size:9.5px;letter-spacing:.22em;margin:0 0 6px;white-space:nowrap}
  .tc-swipe-hint::before,.tc-swipe-hint::after{content:'';height:1px;flex:1;min-width:20px;
    background:linear-gradient(90deg,transparent,rgba(125,211,252,.4))}
  .tc-swipe-hint::after{background:linear-gradient(90deg,rgba(125,211,252,.4),transparent)}
  .tc-attrs{gap:0 10px}
  .tc-cbody{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tc-opts{grid-template-columns:1fr}
}


  /* 使魔 kbf（v3.26）：比机甲小一档的附属卡。条更细、字号更小、无切角、无插槽，
     靠左侧一道窄色边区分族 —— 与机甲的「机械感切角 + 方角插槽」刻意不同形。 */
  .tc-fam{position:relative;margin:4px 0 0 14px;padding:7px 9px 8px;border-radius:6px;
    background:linear-gradient(180deg,rgba(10,20,16,.94),rgba(6,13,10,.94));border:1px solid #1f4a37;
    border-left:3px solid var(--fr,#34d399)}
  .tc-fam.gone{filter:saturate(.35);border-left-color:#475569}
  .tc-fam.r-beast{--fr:#34d399}
  .tc-fam.r-spirit{--fr:#7dd3fc}
  .tc-fam.r-construct{--fr:#a3a3a3}
  .tc-fam-hd{display:flex;align-items:center;gap:6px;margin-bottom:5px}
  .tc-fam-hd b{font-size:12.5px;color:#d7fbe8;letter-spacing:.02em}
  .tc-fam-race{font-style:normal;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;
    color:#6ee7b7;background:rgba(52,211,153,.10);border:1px solid rgba(52,211,153,.35)}
  .tc-fam-race.rr-spirit{color:#7dd3fc;background:rgba(125,211,252,.10);border-color:rgba(125,211,252,.35)}
  .tc-fam-race.rr-construct{color:#cbd5e1;background:rgba(203,213,225,.10);border-color:rgba(203,213,225,.32)}
  .tc-fam-race.rr-x{color:#fcd34d;background:rgba(252,211,77,.10);border-color:rgba(252,211,77,.35)}
  .tc-fam-pact{margin-left:auto;font-style:normal;font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:4px}
  .tc-fam-pact.p-on{color:#34d399;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4)}
  .tc-fam-pact.p-wait{color:#fcd34d;background:rgba(252,211,77,.10);border:1px solid rgba(252,211,77,.38)}
  .tc-fam-pact.p-off{color:#94a3b8;background:rgba(148,163,184,.10);border:1px solid rgba(148,163,184,.35)}
  .tc-fam-pact.p-x{color:#fda4af;background:rgba(244,63,94,.10);border:1px solid rgba(244,63,94,.35)}
  .tc-fam-bars{display:grid;gap:3px}
  .tc-fam .tc-kbm-g{grid-template-columns:26px 30px 1fr;font-size:10px}
  .tc-fam .tc-kbm-gl{font-size:9.5px}
  .tc-fam .tc-kbm-gv{font-size:11px}
  .tc-fam .tc-bar{height:4px}
  .tc-bar i.fam{background:linear-gradient(90deg,#065f46,#34d399)}
  .tc-bar i.fam-mp{background:linear-gradient(90deg,#0c4a6e,#38bdf8)}
  .tc-bar i.fam-mp-dry{background:#52525b}
  .tc-fam-loyal{display:grid;grid-template-columns:26px 30px 1fr;align-items:center;margin-top:4px;font-size:10px;color:#8fb6c4}
  .tc-fam-loyal b{font-size:11px;color:#d7fbe8;text-align:right;padding-right:4px}
  .tc-bar i.fam-loyal{background:linear-gradient(90deg,#78350f,#fbbf24)}
  .tc-fam-attrs{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:5px;font-size:10.5px;color:#9fc3cf}
  .tc-fam-attrs span i{font-style:normal;color:#6b8b98;margin-right:3px}
  .tc-fam-attrs .miss i{color:#3c5563}
  .tc-fam-attrs .miss b{color:#415a68;font-weight:400}
  .tc-fam-skills,.tc-fam-tags,.tc-fam-cus{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:5px}
  .tc-fam-l{font-style:normal;font-size:9.5px;color:#456b7a;margin-right:1px}
  .tc-fam-skills span{font-size:10px;color:#a8cbd8;padding:1px 6px;border-radius:4px;background:rgba(52,211,153,.07);border:1px solid rgba(52,211,153,.28)}
  .tc-fam-tags span{font-size:9.5px;color:#8fb6c4;padding:1px 5px;border-radius:4px;border:1px dashed rgba(143,182,196,.34)}
  .tc-fam-cus .tc-kbm-g{grid-template-columns:56px 30px 1fr}
  .tc-bar i.fam-x{background:linear-gradient(90deg,#134e4a,#5eead4)}

/* ── 窄屏（≤520px）：单列自适应，不再横滑 ──
   判据不是「能不能滑动」，是「一眼能不能看完」：430px 固定列在 320~430 的屏上必然被剪，
   而剪掉的部分连 document.scrollWidth 都看不出来（藏在 overflow-x:auto 里），
   所以这里改成单列，卡片宽度 = 视口 - 边距。
   宽度不够时按「先牺牲装饰、绝不牺牲数字」排序：收窄标签列、缩边距、藏掉横滑提示；
   HP / SP / 负重 / 机甲三读数 / 属性值在任何宽度下都必须可见。
   唯一不删的「装饰」是属性值的 '= '：基础值与总值并排时，没有它就只是两个裸数字，
   读者分不出哪个是哪一个 —— 它已经不算装饰。 */
@media (max-width:520px){
  .tc-wrap{padding:9px 6px;font-size:12px}
  .tc-main{grid-template-columns:none;grid-auto-flow:row;grid-auto-columns:auto;
    justify-content:stretch;overflow-x:visible;gap:2px 0}
  .tc-main>.tc-col{min-width:0}
  .tc-card{max-width:none}
  /* 属性区：单列，标签与值紧邻，不跨列对齐 */
  .tc-attrs{grid-template-columns:1fr;gap:0}
  .tc-attr{grid-template-columns:42px auto auto;gap:0 5px;justify-content:start}
  .tc-attr .tc-at{justify-self:start}              /* 值紧邻标签，不排到右边缘去跨列对齐 */
  .tc-at::before{content:"= ";font-size:9px}       /* 保留 '= '：基础值与总值并排时，没有它就只是两个裸数字 */
  /* 读数：数值不参与换行计算，永远在条的上方同一行右侧 */
  .tc-vit{grid-template-columns:52px 1fr;gap:1px 6px}
  .tc-vit>b{grid-column:2;text-align:right}
  .tc-vit>.tc-bar{grid-column:1 / -1}
  /* 机甲 / 使魔读数：标签列收窄，数字仍等宽三位 */
  .tc-kbm-g{grid-template-columns:38px 32px 1fr}
  .tc-kbm-sub{grid-template-columns:1fr}
  .tc-cbody{grid-template-columns:1fr}
  .tc-bgrid{grid-template-columns:1fr 1fr}
  .tc-opts{grid-template-columns:1fr}
  /* 五道防线：窄屏仍要「一行五格」——1..5 是有顺序的防线带，折行会让读者以为
     后几格是另一类东西（布局替内容撒谎）。auto-fit 无论阈值调多少都会在某个宽度减列，
     所以这里改成固定 5 等分；格内文字允许换行，序号与字号可让位，名称/状态绝不让位。 */
  /* 防线带宽不够就换行的话，1..5 的顺序语义会被折行拆散；所以窄屏让防线独占一整行
     （basis:100% 逼它自己占一行），两个 58px 的环退到第二行并排 —— 环是副信息，退一步不丢语义。 */
  .tc-nb-body{flex-wrap:wrap}
  .tc-nb-defs{flex:0 0 100%;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px 5px}
  /* 格宽只有 50px 上下时，名称与状态并排会把两边都挤成两个字一行；改成上下两行占位，
     名称和状态各自一整行 —— 排的是行，不是字。 */
  .tc-def-row{padding:3px 4px;gap:1px;flex-wrap:wrap}
  .tc-def-row em{margin-left:0;flex:0 0 100%}
  .tc-def-idx{font-size:7.5px}
  .tc-defs-warn{grid-column:1 / -1;font-size:9px;font-style:normal;color:#fcd34d;letter-spacing:.02em}
  .tc-swipe-hint{display:none}                      /* 单列不需要横滑提示 */
}

/* ══════════ sh 避难所卡（海上载体） ══════════
   判据：遮住文字只看轮廓 —— kbm 是直角切角钢板、fam 是小一号的副卡、ntr 是竖排绯红、
   kb 是紫金，shelter 必须是「圆角浮筒 + 锈斑 + 一条水位线」。四张并排时先被认出来的是那条水线。 */
.tc-shelters{display:flex;flex-direction:column;gap:6px}
.tc-shelter{position:relative;margin-top:6px;padding:1px;border-radius:11px;
  background:linear-gradient(135deg,rgba(45,212,191,.30),rgba(180,83,9,.26) 52%,rgba(13,148,136,.20))}
.tc-sh-in{position:relative;border-radius:10px;padding:9px 12px 11px;overflow:hidden;
  background:radial-gradient(130% 90% at 100% 0%,rgba(45,212,191,.12),transparent 58%),
             linear-gradient(180deg,#07181b,#061014 58%,#0b1210);
  border:1px solid #235053}
/* 锈斑：两向细纹，远看只是一层脏，近看才认得出锈迹 —— 不加噪点，噪点会跟 dmg 的斜纹撞形 */
.tc-sh-in::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.55;
  background-image:repeating-linear-gradient(115deg,rgba(180,83,9,.10) 0 2px,rgba(0,0,0,0) 2px 7px),
                   repeating-linear-gradient(28deg,rgba(120,53,15,.10) 0 3px,rgba(0,0,0,0) 3px 11px)}
.tc-sh-hd{position:relative;display:flex;align-items:center;gap:7px;margin-bottom:8px}
.tc-sh-name{font-size:13.5px;color:#99f6e4;letter-spacing:.05em}
.tc-sh-type{font-size:10px;font-weight:700;letter-spacing:.12em;padding:2px 8px;color:#5eead4;
  background:rgba(13,148,136,.18)}
/* 三型用三种**边界画法**区分，不靠填色（填色在缩略图里全糊成一块青） */
.tc-sh-type.ty-isle{border:1px solid #2dd4bf;border-radius:999px;color:#99f6e4}
.tc-sh-type.ty-dock{border:1px solid #14b8a6;border-left:3px solid #b45309;border-radius:2px}
.tc-sh-type.ty-sub{border:0;border-top:2px dashed #22d3ee;border-radius:0;color:#a5f3fc;background:transparent}
.tc-sh-type.ty-x{border:1px dashed #7c2d12;color:#fdba74}
.tc-sh-def{margin-left:auto;display:flex;align-items:baseline;gap:4px;
  padding:1px 9px 1px 7px;border:1px solid rgba(180,83,9,.55);border-radius:3px;
  background:linear-gradient(90deg,rgba(120,53,15,.28),rgba(0,0,0,0))}
.tc-sh-def em{font-style:normal;font-size:9.5px;letter-spacing:.16em;color:#a16207}
.tc-sh-def b{font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;
  font-size:15px;line-height:1;color:#fcd34d}
.tc-sh-def.miss em,.tc-sh-def.miss b{color:#5b4a35}
.tc-sh-gauges{position:relative;display:flex;flex-direction:column;gap:4px}
/* 读数复用 .tc-kbm-g 的列宽与等宽数字（同一只组件，列宽继承，不在此处另调），只改配色与条高：
   五条比三条更需要读得清，所以条从 5px 抬到 6px、行距加 1px。 */
.tc-shelter .tc-kbm-gl{color:#5f8c86;font-size:10px}
.tc-shelter .tc-kbm-gv{color:#ccfbf1}
.tc-shelter .tc-kbm-gm{color:#3f6360}
.tc-shelter .tc-kbm-g .tc-bar{height:6px;background:#0a1c1e}
.tc-shelter .tc-kbm-g.miss .tc-kbm-gv,.tc-shelter .tc-kbm-g.miss .tc-kbm-gm{color:#41504f}
.tc-shelter .tc-kbm-g.dry .tc-kbm-gv,.tc-shelter .tc-kbm-g.dry .tc-kbm-gm{color:#7c6a5a}
.tc-bar i.sh-hull{background:linear-gradient(90deg,#115e59,#2dd4bf)}
.tc-bar i.sh-hold{background:linear-gradient(90deg,#0f766e,#5eead4)}
.tc-bar i.sh-power{background:linear-gradient(90deg,#92400e,#fbbf24)}
.tc-bar i.sh-food{background:linear-gradient(90deg,#7c2d12,#f97316)}
.tc-bar i.sh-temp{background:linear-gradient(90deg,#164e63,#67e8f9)}
.tc-bar i.sh-hull-dry,.tc-bar i.sh-hold-dry,.tc-bar i.sh-power-dry,
.tc-bar i.sh-food-dry,.tc-bar i.sh-temp-dry{background:linear-gradient(90deg,#3f3f46,#71717a)}
.tc-sh-mods{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:8px;
  padding-top:7px;border-top:1px dashed rgba(45,212,191,.18)}
.tc-sh-mods-l{font-style:normal;font-size:9.5px;letter-spacing:.16em;color:#3f7d74;margin-right:1px}
.tc-sh-mod{font-size:10.5px;color:#a7f3d0;padding:1px 7px;border-radius:3px;
  border:1px solid rgba(45,212,191,.42);background:rgba(13,148,136,.15)}
.tc-sh-mod i{font-style:normal;margin-left:3px;font-size:10px;font-weight:800;color:#fbbf24}
/* 解析报错：左竖条 + 原文片段。它不是给玩家的说明，是「这里少了一块 / 这个格没读懂」的凭证 */
.tc-sh-err,.tc-dz-err{margin-top:7px;display:flex;flex-direction:column;gap:2px}
.tc-sh-err em,.tc-dz-err em{font-style:normal;font-size:9.5px;color:#fdba74;letter-spacing:.02em;
  border-left:2px solid #b45309;padding-left:6px;line-height:1.4}
/* 水位线：等宽虚格的水面 —— shelter 的识别符，缩略图里第一眼看到的是它 */
.tc-sh-water{position:relative;height:5px;margin-top:9px;border-radius:1px;opacity:.55;
  background:repeating-linear-gradient(90deg,#0e7490 0 5px,#134e4a 5px 10px)}
.tc-shelter.wrecked{filter:saturate(.55)}
.tc-shelter.wrecked .tc-sh-in{background-image:repeating-linear-gradient(45deg,rgba(244,63,94,.11) 0 6px,rgba(6,16,20,0) 6px 14px)}
/* 终局态最需要读清的是那五个数字，不是纹路：给读数垫一块暗板，斜纹只留在四周 */
.tc-shelter.wrecked .tc-sh-gauges{padding:5px 7px;border-radius:6px;background:rgba(4,10,12,.62);
  box-shadow:inset 0 0 0 1px rgba(127,29,29,.38)}
.tc-shelter.wrecked .tc-sh-water{opacity:.8;background:repeating-linear-gradient(90deg,#7f1d1d 0 5px,#450a0a 5px 10px)}
/* 盖章要反向补饱和：整卡 filter 会把它一起削灰，而失效是重点 */
.tc-sh-stamp{position:absolute;right:10px;bottom:18px;transform:rotate(-7deg);
  filter:saturate(2.4) brightness(1.2);
  font-size:10.5px;font-weight:800;letter-spacing:.16em;color:#fecdd3;
  border:2px solid #e11d48;border-radius:2px;padding:1px 7px;background:rgba(76,5,25,.5)}

/* ══════════ dz 灾变横幅 ══════════
   它是横条，不是卡片：整宽的血色斜纹带 + 左侧 9px 等级色块 + 五格严重度点阵。
   点阵而不是条 —— 1..5 是**档位**，画成条会被读成「快结束了」（而且条已经有三处在用）。 */
.tc-dzs{position:relative;display:flex;flex-direction:column;gap:5px;margin:0 0 10px}
/* 五列不是四列：终局时多出「已平息」一枚徽章，四列会把它挤到第二行、把「余 0 回合」拆成两行 */
.tc-dz{--dl:#f59e0b;position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto;
  align-items:center;gap:3px 10px;padding:7px 12px;border-left:9px solid var(--dl);
  background:repeating-linear-gradient(135deg,rgba(120,20,20,.20) 0 7px,rgba(9,11,14,.94) 7px 14px);
  border-top:1px solid #3a1c1c;border-bottom:1px solid #3a1c1c}
.tc-dz.lv-1{--dl:#fbbf24}.tc-dz.lv-2{--dl:#fb923c}.tc-dz.lv-3{--dl:#f97316}
.tc-dz.lv-4{--dl:#ef4444}.tc-dz.lv-5{--dl:#e11d48}
.tc-dz-sev{display:flex;align-items:center;gap:6px}
.tc-dz-sev>u{width:0;height:0;display:block;border:5px solid transparent;
  border-bottom-color:var(--dl);border-top-width:0}
.tc-dz-lv{display:flex;gap:2px}
.tc-dz-lv i{display:block;width:5px;height:11px;background:#2a1a1a;border:1px solid #402424}
.tc-dz-lv i.on{background:var(--dl);border-color:var(--dl)}
.tc-dz-name{font-size:13px;font-weight:700;color:#fecaca;letter-spacing:.04em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tc-dz-grd{font-size:9.5px;letter-spacing:.14em;color:#fca5a5;
  border:1px solid rgba(248,113,113,.4);border-radius:2px;padding:1px 6px;justify-self:start;white-space:nowrap}
.tc-dz-over{font-size:9.5px;font-weight:800;letter-spacing:.16em;color:#a8a29e;
  border:1px solid #57534e;border-radius:2px;padding:1px 6px;white-space:nowrap}
.tc-dz-left{font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;
  font-size:11px;color:#fcd34d;white-space:nowrap;justify-self:end}
.tc-dz-left.miss{color:#5b4a35}
.tc-dz-fx{grid-column:1 / -1;margin-top:3px;padding-top:3px;font-size:11px;line-height:1.5;
  color:#c9a9a9;border-top:1px dotted rgba(248,113,113,.16)}
.tc-dz.over{filter:saturate(.45)}
.tc-dz.over .tc-dz-name{color:#a8a29e}
.tc-dz.over .tc-dz-lv i.on{background:#57534e;border-color:#57534e}
.tc-mini .tc-sh-mods{margin-top:5px;padding-top:5px}
.tc-mini .tc-dz{padding:5px 9px;gap:2px 8px}
.tc-mini .tc-dz-fx{font-size:10px}

/* ══════════ wh 仓储 / pl 场所 ══════════
   这两张是**辅助信息**，量级要比避难所轻一档：没有渐变外环、没有锈纹、没有水位线。
   做法是「扁」——一条 1px 暗边 + 一行一件的清单；缩略图里它们应该是两片安静的方块，
   而避难所仍然是那张带环带纹的卡。 */

/* 清单卡：不画条。折列用 CSS 多列，DOM 节点不增不减 —— 窄屏掉成单列，但一件不少。 */
.tc-whs{display:flex;flex-direction:column;gap:5px}
.tc-wh{position:relative;border:1px solid rgba(148,163,184,.20);border-radius:6px;
  background:rgba(12,19,31,.60)}
.tc-wh-in{padding:6px 9px 7px}
.tc-wh-hd{display:flex;align-items:baseline;gap:6px;margin-bottom:5px}
.tc-wh-lab{font-style:normal;font-size:9.5px;letter-spacing:.16em;color:#64748b}
.tc-wh-occ{margin-left:auto;font-family:ui-monospace,Consolas,monospace;
  font-variant-numeric:tabular-nums;font-size:11px;color:#cbd5e1}
.tc-wh-occ u{text-decoration:none;color:#475569}
.tc-wh-occ.over{color:#fca5a5}
.tc-wh-occ.over u{color:#7f1d1d}
/* 每件一行：名（可换行、绝不截断）+ 数量（右对齐、不缩）+ 可选注 */
.tc-wh-list{display:grid;grid-template-columns:minmax(0,1fr);gap:1px 14px}
/* 两列只在够宽时开：minmax(0,…) 让每格按自己的宽度换行，长名字绝不越过列线
   （用 1fr 等于 minmax(auto,1fr)，单元格会被长字的 min-content 撑宽、溢出到隔壁那一列，
   读起来像注挂错了人——这比不好看严重）。不用 ellipsis：那是把字丢了。
   ≤360 干脆退回单列，宁可变长也不让两列挤成一团。 */
.tc-wh.many .tc-wh-list{grid-template-columns:repeat(2,minmax(0,1fr))}
.tc-wh-i{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:baseline;
  min-width:0;overflow-wrap:anywhere;
  gap:0 5px;padding:1px 0;border-bottom:1px dotted rgba(148,163,184,.10)}
@media (max-width:360px){.tc-wh.many .tc-wh-list{grid-template-columns:minmax(0,1fr)}}
/* 两列时给左列一条极淡的列线：数量贴着谁的右缘，就只属于谁，扫一眼不会读串 */
@media (min-width:361px){.tc-wh.many .tc-wh-i:nth-child(odd){
  padding-right:9px;border-right:1px solid rgba(148,163,184,.10)}}
.tc-wh-n{font-size:11px;color:#e2e8f0;line-height:1.5;
  overflow-wrap:anywhere;word-break:break-word}
.tc-wh-x{font-style:normal;font-family:ui-monospace,Consolas,monospace;
  font-variant-numeric:tabular-nums;font-size:11px;font-weight:700;color:#7dd3fc;
  justify-self:end;white-space:nowrap}
.tc-wh-x.miss{color:#64748b}
.tc-wh-note{font-style:normal;font-size:9.5px;color:#94a3b8;white-space:nowrap;padding-left:5px}
.tc-wh-empty{font-size:10.5px;color:#475569;letter-spacing:.1em;padding:1px 0 2px}
.tc-wh-err{margin-top:4px;display:flex;flex-direction:column;gap:2px}
.tc-wh-err em,.tc-pl-err em{font-style:normal;font-size:9.5px;color:#fdba74;
  border-left:2px solid #b45309;padding-left:6px;line-height:1.4}

/* 场所卡：一条 3px 型色左钉 + 名称 / 型词 / 倒计时角标 + 一句摘要 */
.tc-pls{display:flex;flex-direction:column;gap:4px}
.tc-pl{--pc:#94a3b8;position:relative;border:1px solid rgba(148,163,184,.18);
  border-left:3px solid var(--pc);border-radius:5px;
  background:linear-gradient(90deg,rgba(148,163,184,.06),rgba(10,16,26,.5))}
.tc-pl.t-market{--pc:#fbbf24}
.tc-pl.t-ruin{--pc:#94a3b8}
.tc-pl.t-camp{--pc:#4ade80}
.tc-pl.t-peril{--pc:#f87171}
.tc-pl.t-buoy{--pc:#38bdf8}
.tc-pl.t-fleet{--pc:#a78bfa}
.tc-pl-in{padding:5px 8px 6px}
.tc-pl-hd{display:flex;align-items:baseline;gap:6px}
.tc-pl-name{font-size:12px;color:#e2e8f0;letter-spacing:.04em;
  overflow-wrap:anywhere;min-width:0}
.tc-pl-type{font-size:9.5px;letter-spacing:.1em;color:var(--pc);
  border:1px solid currentColor;border-radius:2px;padding:0 5px;opacity:.85;white-space:nowrap}
.tc-pl-store{margin-left:auto;font-family:ui-monospace,Consolas,monospace;
  font-variant-numeric:tabular-nums;font-size:10.5px;color:#fcd34d;white-space:nowrap}
.tc-pl-store.gone{color:#a8a29e;text-decoration:line-through;opacity:.8}
.tc-pl-store.miss{color:#475569}
.tc-pl-ft{margin-top:3px;font-size:10px;line-height:1.45;color:#94a3b8;
  border-top:1px dotted rgba(148,163,184,.14);padding-top:3px}
.tc-pl-err{margin-top:4px;display:flex;flex-direction:column;gap:2px}
.tc-mini .tc-wh-in{padding:5px 7px 6px}
.tc-mini .tc-wh-n{font-size:10.5px}
.tc-mini .tc-pl-in{padding:4px 7px 5px}
.tc-mini .tc-pl-ft{font-size:9.5px}

/* ── 尺寸切换（全局持久偏好，点击 .tc-size 在 紧凑/完整 间切换）──
   .tc-mini 置于所有基础规则与手机媒体查询之后，同级选择器下后写胜出 */
.tc-size{position:absolute;top:7px;right:9px;z-index:5;width:20px;height:20px;
  display:flex;align-items:center;justify-content:center;padding:0;
  background:rgba(20,28,40,.85);border:1px solid rgba(125,211,252,.28);border-radius:5px;
  color:#7dd3fc;font-size:12px;line-height:1;cursor:pointer;opacity:.45;
  transition:opacity .15s,background .15s}
.tc-size:hover{opacity:1;background:rgba(30,42,60,.95)}
.tc-mini{padding:8px 9px;font-size:11.5px;line-height:1.45}
.tc-mini .tc-cmdbar{gap:3px 10px;font-size:11px}
.tc-mini .tc-sect{margin:7px 0 4px;font-size:10px}
.tc-mini .tc-attrs{gap:0 8px;font-size:10.5px}
.tc-mini .tc-bgrid{gap:2px 8px;grid-template-columns:repeat(auto-fit,minmax(74px,1fr))}
.tc-mini .tc-bv{font-size:10px}
.tc-mini .tc-bbar{height:2px}
.tc-mini .tc-nb-wm,.tc-mini .tc-nf-wm,.tc-mini .tc-nu-wm{display:none}
.tc-mini .tc-nb-ring{width:32px;height:32px}
.tc-mini .tc-nb-ring text{font-size:9px}
.tc-mini .tc-nb{padding:6px 8px}
.tc-mini .tc-nf,.tc-mini .tc-nh,.tc-mini .tc-nd,.tc-mini .tc-nl{padding:5px 8px;font-size:10.5px}
.tc-mini .tc-nd-r,.tc-mini .tc-nl-i{padding:3px 0}
.tc-mini .tc-next>span{font-size:11px}
.tc-mini .tc-ver{margin-top:3px;font-size:9px}
.tc-mini::after{display:none}
`;

  function injectCss() {
    if (DOC.getElementById('tw-card-style')) return;
    const s = DOC.createElement('style');
    s.id = 'tw-card-style';
    s.textContent = CSS;
    (DOC.head || DOC.documentElement).appendChild(s);
  }

  injectCss();
  installSizeToggle();
  let n = 0;
  function loop() {
    try { injectCss(); sweep(); } catch (e) { /* 静默 */ }
    if (++n < 400) setTimeout(loop, 700);
  }
  loop();

  try {
    const chat = DOC.getElementById('chat');
    if (chat) new MutationObserver(() => setTimeout(sweep, 60)).observe(chat, { childList: true, subtree: true });
  } catch (e) { /* 忽略 */ }

  /* 仅供测试，非公开 API，可随实现变动 */
  window.__twCard = { version: VERSION, parseState, render, sweep, keys: EXT_KEYS, extractBlock: extractBlock, extHit: extHit, CSS: CSS, injectCss: injectCss, parseShelter, parseDisaster, parseWarehouse, parsePlace, splitInlineKeys, keyHits };
  console.log('[tw-card] v' + VERSION + ' ready');
})();
