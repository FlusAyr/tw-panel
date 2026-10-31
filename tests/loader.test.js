/* loader.js 单元测试（node tests/loader.test.js）
   覆盖：无缓存首次拉取 / 有缓存先启动再后台更新 / 全源失败降级 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'loader.js'), 'utf8');

function makeEnv(opts) {
  const store = Object.assign({}, opts.storage || {});
  const logs = [];
  const toasts = [];
  const win = {};
  const doc = {
    body: { appendChild() { } },
    head: { appendChild() { } },
    documentElement: { appendChild() { } },
    createElement() {
      return { style: {}, textContent: '', remove() { }, set id(v) { } };
    },
    getElementById() { return null; }
  };
  const sandbox = {
    window: win,
    document: doc,
    console: { log: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    setTimeout: (fn) => { if (opts.runTimers !== false) fn(); return 1; },
    clearTimeout: () => { },
    AbortController: class { constructor() { this.signal = null; } abort() { } },
    fetch: opts.fetch,
    location: { reload() { logs.push('RELOAD'); } },
    JSON,
  };
  sandbox.window = win;
  sandbox.globalThis = sandbox;
  win.parent = win;
  vm.createContext(sandbox);   // 上下文自带 Function，勿注入宿主 Function（否则 new Function 落在宿主作用域）
  return { sandbox, store, logs, toasts };
}

const PANEL_STUB = "window.__twCardLoaded=true;window.__twCard={version:'9.9',sweep:function(){}};";
const REMOTE = { version: '3.9.0', notes: '测试' };

function fetchFactory(cfg) {
  return async (url) => {
    if (cfg.failAll) throw new Error('offline');
    if (url.endsWith('version.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(REMOTE) };
    }
    return { ok: true, status: 200, text: async () => PANEL_STUB + '/*pad*/'.repeat(500) };
  };
}

async function wait(ms) { await new Promise((r) => setTimeout(r, ms)); }

(async () => {
  let pass = 0, fail = 0;
  const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

  // 用例1：无缓存 → 直接拉远端并缓存
  {
    const env = makeEnv({ fetch: fetchFactory({}) });
    vm.runInContext(SRC, env.sandbox);
    await wait(30);
    ok(env.sandbox.window.__twCard && env.sandbox.window.__twCard.version === '9.9', '无缓存时从远端启动面板');
    ok(!!env.store['tw-card:cache'], '代码写入 localStorage');
    ok(JSON.parse(env.store['tw-card:meta']).version === '3.9.0', '版本元数据写入');
  }

  // 用例2：有缓存且远端同版 → 只启动缓存，不重复下载
  {
    let codeFetched = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('version.json')) return { ok: true, status: 200, text: async () => JSON.stringify(REMOTE) };
      codeFetched++;
      return { ok: true, status: 200, text: async () => PANEL_STUB };
    };
    const env = makeEnv({
      storage: { 'tw-card:cache': PANEL_STUB, 'tw-card:meta': JSON.stringify({ version: '3.9.0' }) },
      fetch: fetchImpl
    });
    vm.runInContext(SRC, env.sandbox);
    await wait(30);
    ok(env.sandbox.window.__twCard && env.sandbox.window.__twCard.version === '9.9', '同版本时用缓存启动');
    ok(codeFetched === 0, '同版本不重复下载代码');
  }

  // 用例3：有缓存，远端更新 → 缓存被覆盖为新版
  {
    const env = makeEnv({
      storage: { 'tw-card:cache': '/*old*/', 'tw-card:meta': JSON.stringify({ version: '3.8.0' }) },
      fetch: fetchFactory({})
    });
    vm.runInContext(SRC, env.sandbox);
    await wait(40);
    ok(JSON.parse(env.store['tw-card:meta']).version === '3.9.0', '旧版检测到新版本并更新缓存');
    ok(env.store['tw-card:cache'].indexOf('__twCard') >= 0, '新代码已落盘');
  }

  // 用例4：全源失败 + 有缓存 → 不崩，继续用缓存
  {
    const env = makeEnv({
      storage: { 'tw-card:cache': PANEL_STUB, 'tw-card:meta': JSON.stringify({ version: '3.8.0' }) },
      fetch: fetchFactory({ failAll: true })
    });
    let threw = false;
    try { vm.runInContext(SRC, env.sandbox); await wait(30); } catch (e) { threw = true; }
    ok(!threw, '断网不抛异常');
    ok(env.sandbox.window.__twCard.version === '9.9', '断网时仍用缓存渲染');
  }

  // 用例5：版本比较
  {
    const env = makeEnv({ fetch: fetchFactory({}), storage: {} });
    vm.runInContext(SRC, env.sandbox);
    const cmp = env.sandbox.window.twPanelVersion;
    ok(typeof cmp === 'function', '暴露 twPanelVersion()');
    ok(typeof env.sandbox.window.twPanelCheck === 'function', '暴露 twPanelCheck()');
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
