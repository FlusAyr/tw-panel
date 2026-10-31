/* NPC 渲染回归测试：vm 加载 panel.js，验证 parseNpc/renderNpc 两种口径 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');
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
vm.runInContext(src, sandbox);

setTimeout(() => {
  const api = sandbox.window.__twCard;
  if (!api) { console.error('FAIL: __twCard 未暴露'); process.exit(1); }
  const R = (t) => api.render(api.parseState(t));
  let pass = 0, fail = 0;
  const T = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'OK  ' : 'FAIL', name); };

  // 1 世界书口径（ASCII 竖线，位置制 + 属性 + HP）
  const wb = 'npc: 巨狼 | 敌对·巨大·大型掠食者·高危 | STR 77 DEX 20 CON 85 INT 20 PER 45 CHA 15 WIL 55 | 352/352 | 林间伏击';
  const r = R(wb);
  T('世界书口径：姓名', r.includes('巨狼'));
  T('世界书口径：立场→态度(敌意角标)', r.includes('敌对·巨大·大型掠食者·高危') && r.includes('a-hostile'));
  T('世界书口径：属性芯片 7 项', (r.match(/<span>[力敏体智感魅志]<b>/g) || []).length === 7);
  T('世界书口径：HP 进状态行', r.includes('HP 352/352'));
  T('世界书口径：位置行动→备注', r.includes('林间伏击') && r.includes('tc-npc-note'));

  // 2 键制口径（全角｜）
  const r2 = R('npc1: 疤眼头目 ｜ 身份 黑市老大 ｜ 态度 敌视转忌惮 ｜ 状态 重伤咳嗽 ｜ 地库暗格里还藏着货');
  T('键制：身份/态度/备注', r2.includes('黑市老大') && r2.includes('a-hostile') && r2.includes('地库暗格里还藏着货'));
  T('键制：状态行', r2.includes('重伤咳嗽'));

  // 3 态度三档
  T('友善角标', R('npc1: 亚丝娜 ｜ 态度 友善').includes('a-friend'));
  T('中立角标', R('npc1: 商人 ｜ 态度 观望').includes('a-neutral'));

  // 4 兼容性
  T('裸文本整句渲染', R('npc1: 某个路过的卫兵，看起来不太好惹').includes('某个路过的卫兵，看起来不太好惹'));
  T('多 NPC 卡', (R('npc1: A ｜ 态度 友善\nnpc2: B ｜ 态度 中立').match(/tc-npc-name/g) || []).length === 2);
  T('中文属性键芯片', (R('npc1: 老猎人 ｜ 力量 65 敏捷 40 体质 55 智力 30 感知 70 魅力 20 意志 50').match(/<span>[力敏体智感魅志]<b>/g) || []).length === 7);

  // 5 结构
  T('旧 👹 已移除', !r.includes('👹') && !r2.includes('👹'));
  T('左栏 CONTACTS', r.includes('CONTACTS') && r2.includes('CONTACTS'));

  console.log(`--- ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}, 80);
