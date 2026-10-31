/* sweep 全链路仿真：最小假 DOM，验证「next: 被正文隔断成孤段」能否渲染 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'panel.js'), 'utf8');

/* ── 最小假 DOM ── */
function mkNode(type, text) {
  return {
    nodeType: type === 'text' ? 3 : 1,
    tagName: type === 'text' ? undefined : type.toUpperCase(),
    _text: text || '',
    textContent: text || '',
    get innerHTML() { return this._text; },
    set innerHTML(h) { this._html = h; this._first = mkNode('div', ''); this._first._html = h; },
    get firstElementChild() { return this._first; },
    parentNode: null, childNodes: [],
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (!this._first) this._first = c; return c; },
    insertBefore(c, ref) {
      c.parentNode = this;
      const i = this.childNodes.indexOf(ref);
      if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
      this._first = this.childNodes[0];
      return c;
    },
    remove() {
      if (this.parentNode) {
        const i = this.parentNode.childNodes.indexOf(this);
        if (i >= 0) this.parentNode.childNodes.splice(i, 1);
        this.parentNode._first = this.parentNode.childNodes[0] || null;
        this.parentNode = null;
      }
    },
    querySelectorAll() { return []; },
  };
}
const mesText = mkNode('div', '');
mesText.classList = { add() {} };
// 场景：主状态块一段（含 scene+quest）、正文一段、被隔断的孤立 next 段
mesText.appendChild(mkNode('p', 'scene: 白天 | 家 | 平静\nquest: 守住关系 | 30天 | 无\nnb: 沈栀 | 爱 62 | 恋 28 | 调 34 | 屈 41 | 淫 58 | 防线 2/5 称谓 | 期 3 摇摆 | 迹 3'));
mesText.appendChild(mkNode('p', '她低着头收拾碗筷，没有看你。'));
mesText.appendChild(mkNode('p', 'next: A 追问昨晚去向 B 装作不知道 C 查手机记录'));

const doc = {
  body: mkNode('body'), head: mkNode('head'), documentElement: {},
  createElement: (t) => mkNode(t, ''),
  getElementById: () => null,
  addEventListener() {}, querySelectorAll: (sel) => (sel === '.mes_text' ? [mesText] : []),
};
const win = {};
const sandbox = {
  window: win, document: doc, console,
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  location: { href: '' },
  MutationObserver: class { observe() {} disconnect() {} },
  navigator: { userAgent: 'test' },
  requestAnimationFrame: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

setTimeout(() => {
  // sweep 由启动逻辑触发（setTimeout/init）；等一等再检查 DOM
  setTimeout(() => {
    const kids = mesText.childNodes;
    const tags = kids.map(n => (n._html ? 'TC-WRAP' : (n.tagName + ':' + String(n.textContent || n._text).slice(0, 24))));
    console.log('DOM 节点序列：');
    tags.forEach(t => console.log('  -', t));
    const rendered = kids.filter(n => n._html && n._html.includes('tc-wrap'));
    const allHtml = rendered.map(n => n._html).join('');
    const ok1 = allHtml.includes('tc-next') && allHtml.includes('追问昨晚去向');
    const ok2 = allHtml.includes('tc-opt');           // 选项式 A/B/C
    const ok3 = allHtml.includes('tc-nb');             // 主块伴侣卡仍正常
    const ok4 = kids.some(n => !n._html && String(n.textContent).includes('她低着头收拾碗筷')); // 正文幸存
    let f = 0;
    [[ '孤立 next 段被渲染', ok1 ], [ 'A/B/C 选项芯片', ok2 ], [ '主块 nb 伴侣卡正常', ok3 ], [ '中间正文未被吞', ok4 ]]
      .forEach(([n, ok]) => { if (!ok) f++; console.log(ok ? 'OK  ' : 'FAIL', n); });
    console.log(f ? '--- ' + f + ' 失败' : '--- 全部通过');
    process.exit(f ? 1 : 0);
  }, 600);
}, 400);
