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

  const VERSION = '3.10.1';

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

  const KEYS = 'scene|team|quest|check|result|world|next|bond[0-9]*|foe[0-9]*|nb[0-9]*|nf[0-9]*|nh[0-9]*|nd[0-9]*|nl[0-9]*|npc[0-9]*|pts[0-9]+|lock[0-9]+|ti[0-9]+|cr[0-9]+|p[0-9]+|sk[0-9]+|eq[0-9]+|mob[0-9]*';
  const LINE_RE = new RegExp('^[ \\t]*(' + KEYS + ')[:：][ \\t]*(.*)$', 'i');

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
    const o = { name: p[0] || '', love: null, crush: null, train: null, submit: null, lewd: null, lewdMask: null, defLost: null, defTotal: 5, defName: '', stage: null, stageName: '', trace: null };
    for (const x of p.slice(1)) {
      let m;
      if ((m = x.match(/^爱\s*(-?\d+)/))) o.love = +m[1];
      else if ((m = x.match(/^恋\s*(-?\d+)/))) o.crush = +m[1];
      else if ((m = x.match(/^调\s*(-?\d+)/))) o.train = +m[1];
      else if ((m = x.match(/^屈\s*(-?\d+)/))) o.submit = +m[1];
      else if ((m = x.match(/^防线\s*(\d+)\s*\/\s*(\d+)\s*([^（(]*)/))) { o.defLost = +m[1]; o.defTotal = +m[2]; o.defName = m[3].trim(); }
      else if ((m = x.match(/^期\s*(\d+)\s*(.*)$/))) { o.stage = +m[1]; o.stageName = m[2].trim(); }
      else if ((m = x.match(/^淫\s*(-?\d+)\s*(?:[（(]\s*压\s*(\d+)\s*[)）])?/))) { o.lewd = +m[1]; if (m[2]) o.lewdMask = +m[2]; }
      else if ((m = x.match(/^迹\s*(\d+)/))) o.trace = +m[1];
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

  function parseState(text) {
    const st = {
      scene: '', team: '', quest: null, checks: [],
      players: [], npcs: [], bonds: [], foes: [], mobs: [], ntrBonds: [], ntrFoes: [], ntrHearts: [], ntrFalls: [], ntrLogs: [],
      result: '', world: '', next: '',
    };
    const pmap = new Map(), smap = new Map(), emap = new Map();
    const bmap = new Map(), fmap = new Map(), nmap = new Map();
    const nbmap = new Map(), nfmap = new Map(), nhmap = new Map(), ndmap = new Map(), nlmap = new Map();
    const ptsm = new Map(), lockm = new Map(), tim = new Map(), crm = new Map();
    const mmap = new Map();
    const checks = [];
    const rec = recoverMobLines(String(text).split(/\r?\n/));

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
  function renderNtrBond(b) {
    const one = (label, v, cls) => v == null ? '' :
      `<div class="tc-bv"><span>${label}</span><b>${v}</b><div class="tc-bbar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, v))}%"></i></div></div>`;
    const stage = Math.max(1, Math.min(5, b.stage || 1));
    /* 沦陷度：恋/调/屈/淫 均值（缺失值按 0 计，全部缺失则不显示） */
    const parts = [b.crush, b.train, b.submit, b.lewd].filter(x => x != null);
    let ring = '';
    if (parts.length) {
      const pct = Math.round(parts.reduce((a, c) => a + c, 0) / parts.length);
      const C = 2 * Math.PI * 16;
      ring = `<svg class="tc-nb-ring" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="16" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="4"/>
        <circle cx="22" cy="22" r="16" fill="none" stroke="#e11d48" stroke-width="4" stroke-linecap="round"
          stroke-dasharray="${(pct / 100 * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 22 22)"/>
        <text x="22" y="21.5" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="#fda4af">${pct}</text>
        <text x="22" y="31" text-anchor="middle" font-size="5" fill="rgba(253,164,175,.75)" letter-spacing="1">沦陷</text>
      </svg>`;
    }
    const locks = b.defLost == null ? '' :
      `<span class="tc-nb-locks">${Array.from({ length: b.defTotal }, (_, i) =>
        i < b.defLost ? '<i class="u">🔓</i>' : '<i>🔒</i>').join('')}</span>`;
    const stamp = stage === 5 ? '<span class="tc-nb-stamp">定局</span>' : '';
    return `<div class="tc-nb s${stage}"><span class="tc-nb-wm">${NB_WM[stage]}</span>${stamp}
      <div class="tc-bhead"><b>${esc(b.name)}</b>${b.stage ? `<em>期 ${b.stage} ${esc(b.stageName)}</em>` : ''}${b.lewdMask ? `<span class="tc-mask">淫压 ${b.lewdMask}</span>` : ''}${b.trace != null ? `<span class="tc-trace">迹 ${b.trace}</span>` : ''}</div>
      <div class="tc-nb-body">
        <div class="tc-bgrid">${one('爱', b.love, 'n-love')}${one('恋', b.crush, 'n-crush')}${one('调', b.train, 'n-train')}${one('屈', b.submit, 'n-submit')}${one('淫', b.lewd, 'n-lewd')}</div>
        ${ring}
      </div>
      ${b.defLost != null ? `<div class="tc-nb-def">防线 ${b.defLost}/${b.defTotal}${b.defName ? ' · ' + esc(b.defName) : ''}${locks}</div>` : ''}
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

  function render(st) {
    const scene = seg(st.scene);
    const out = [];
    const sect = (zh, en) => `<div class="tc-sect"><i></i><b>${esc(zh)}</b><em>${en}</em></div>`;

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

    /* ── 双栏战场：左翼我方 / 右翼威胁与判定 ── */
    const colL = [], colR = [];
    if (st.players.length) {
      colL.push(sect('我方小队', 'SQUAD'));
      colL.push(`<div class="tc-grid tc-stack">${st.players.map(renderPlayer).join('')}</div>`);
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
    if (st.npcs.length) {
      colL.push(sect('在场人物', 'CONTACTS'));
      colL.push(`<div class="tc-npcs">${st.npcs.map(renderNpc).join('')}</div>`);
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
      out.push(`<div class="tc-main">${
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

    return `<div class="tc-wrap" data-tw-ver="${VERSION}">${out.filter(Boolean).join('')}<div class="tc-ver">tw-card v${VERSION}</div></div>`;
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
          const meaningful = st.players.length || st.scene || st.mobs.length ||
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
.tc-nb-ring{width:52px;height:52px;flex:none;filter:drop-shadow(0 0 5px rgba(225,29,72,.35))}
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
`;

  function injectCss() {
    if (DOC.getElementById('tw-card-style')) return;
    const s = DOC.createElement('style');
    s.id = 'tw-card-style';
    s.textContent = CSS;
    (DOC.head || DOC.documentElement).appendChild(s);
  }

  injectCss();
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

  window.__twCard = { version: VERSION, parseState, render, sweep };
  console.log('[tw-card] v' + VERSION + ' ready');
})();
