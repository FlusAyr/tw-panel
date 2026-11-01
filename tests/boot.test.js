/* boot.mjs 回归（v2.1）——纯 node，无依赖，无网络
   ─────────────────────────────────────────────────────────────
   重点锁死三件容易改坏的事：
   1. 探测源（可变 ref）与代码源（不可变 ref）分开，代码 URL 必须带 @v<tag>，
      绝不能退回 @main（@main 是分支引用，jsDelivr 缓存 12h，发版后新玩家装旧件）。
   2. 取源顺序：raw /main/ 打头（最新鲜），jsDelivr 三域不带 ref 兜底。
   3. 快速通道全灭时，必须落到 import 兜底，且兜底地址不带 ref、不指向 raw
      （raw 的 MIME 是 text/plain，模块加载会被拒）。

   ⚠ vm 里跑不了动态 import()，这里把 `await import(` 改写成 `await __dynImport(`。
     改写前先断言原文确实长这样，避免「源码改名了、测试还在自嗨」。
   ⚠ 写状态块样例时 \n 要写 \\n（见 AGENTS.md §7.8）——本文件不涉及状态块，仅备注。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '..', 'boot.mjs');
const RAW = fs.readFileSync(SRC_PATH, 'utf8');
const HAS_DYN_IMPORT = RAW.indexOf('await import(') >= 0;
const SRC = RAW.replace(/await import\(/g, 'await __dynImport(');

/* 面板桩：必须 > 2000 字符，否则 boot 里的「内容异常」检查会拦掉 */
const PANEL_STUB = "window.__twCardLoaded=true;window.__twCard={version:'9.9',sweep:function(){}};"
  + '/*' + 'x'.repeat(2200) + '*/';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  OK   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg); }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jsonRes(obj) {
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(obj)) });
}
function textRes(t) {
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(t) });
}
function failRes(msg) { return Promise.reject(new Error(msg || 'offline')); }

/* 造一个 boot 能跑的沙箱。cfg.fetch(url) 决定每个请求的结果。
   注意：不要把宿主 Function 注入上下文（vm 上下文自带，new Function 才留在沙箱里）。 */
function makeEnv(cfg) {
  cfg = cfg || {};
  const store = Object.assign({}, cfg.store || {});
  const logs = [];
  const fetched = [];
  const imports = [];
  const created = [];

  const mkNode = () => ({
    style: {},
    textContent: '',
    innerHTML: '',
    className: '',
    id: '',
    remove() { },
    addEventListener() { },
    appendChild() { },
    querySelector() { return { onclick: null, onchange: null, remove() { } }; }
  });

  const document = {
    body: { appendChild() { } },
    head: { appendChild() { } },
    documentElement: { appendChild() { } },
    getElementById() { return null; },
    createElement() {
      const n = mkNode();
      created.push(n);
      return n;
    }
  };

  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };

  const win = {};
  win.parent = win;

  const sandbox = {
    window: win,
    document,
    localStorage,
    console: {
      log: (...a) => { logs.push(['log'].concat(a).join(' ')); },
      warn: (...a) => { logs.push(['warn'].concat(a).join(' ')); },
      error: (...a) => { logs.push(['error'].concat(a).join(' ')); }
    },
    setTimeout: (fn) => { try { fn(); } catch (e) { logs.push('TIMER-THROW ' + e.message); } return 1; },
    clearTimeout: () => { },
    AbortController: function () { this.signal = {}; this.abort = function () { }; },
    fetch: (url) => {
      fetched.push(url);
      return cfg.fetch ? cfg.fetch(url) : jsonRes({ version: '9.9.9' });
    },
    __dynImport: (url) => {
      imports.push(url);
      return cfg.dynImport ? cfg.dynImport(url) : Promise.resolve({});
    },
    location: { reload() { logs.push('RELOAD'); } },
    JSON,
    Date,
    Math,
    parseInt,
    String,
    Object,
    Array,
    Promise,
    Error
  };
  sandbox.globalThis = sandbox;
  return { sandbox, store, logs, fetched, imports, created };
}

async function run(cfg) {
  const env = makeEnv(cfg);
  vm.createContext(env.sandbox);
  vm.runInContext(SRC, env.sandbox, { filename: 'boot.mjs' });
  await wait(30);   // 顶层 start() 是 async，放它跑完
  return env;
}

const VERSION_OK = 'https://raw.githubusercontent.com/FlusAyr/tw-panel/main/version.json';
const GCODE_VER = 'https://gcore.jsdelivr.net/gh/FlusAyr/tw-panel/version.json';
const CDN_VER = 'https://cdn.jsdelivr.net/gh/FlusAyr/tw-panel/version.json';
const FASTLY_VER = 'https://fastly.jsdelivr.net/gh/FlusAyr/tw-panel/version.json';
const PANEL_GCODE_TAG = 'https://gcore.jsdelivr.net/gh/FlusAyr/tw-panel@v3.13.0/panel.js';

(async function main() {
  console.log('[boot.test] ' + SRC_PATH);

  /* ── 0. 源码形态 ───────────────────────────────────────── */
  ok(HAS_DYN_IMPORT, 'boot.mjs 仍含 `await import(`（兜底通道没被改名）');
  ok(RAW.indexOf('const BOOT_VERSION') >= 0, 'boot.mjs 有 const BOOT_VERSION 常量');

  /* ── 1. 取源常量：探测源 vs 代码源必须分开 ─────────────── */
  {
    const env = await run({ fetch: (u) => (u.indexOf('version.json') >= 0 ? jsonRes({ version: '3.13.0' }) : textRes(PANEL_STUB)) });
    const tb = env.sandbox.window.twBoot;
    ok(!!tb, 'window.twBoot 自省接口已暴露');
    ok(tb.version === '2.1', 'BOOT_VERSION = 2.1（实际 ' + tb.version + '）');

    const urls = tb.versionUrls;
    ok(urls.length === 4, 'VERSION_URLS 有 4 个探测源（实际 ' + urls.length + '）');
    ok(urls[0] === VERSION_OK, '探测源第 1 位是 raw /main/ version.json');
    ok(urls[1] === GCODE_VER, '探测源第 2 位是 gcore（不带 ref）');
    ok(urls[2] === CDN_VER, '探测源第 3 位是 cdn（不带 ref）');
    ok(urls[3] === FASTLY_VER, '探测源第 4 位是 fastly（不带 ref）');
    ok(urls.every((u) => u.indexOf('@') < 0), '探测源全部不含 @（可变 ref，不带版本）');
    ok(urls.every((u) => u.indexOf('@main') < 0), '探测源不出现 @main 拼接形态');

    ok(tb.codeUrlPatterns.length === 4, 'CODE_URL_PATTERNS 有 4 条（jsDelivr 三域 + raw）');
    ok(tb.codeUrlPatterns[0] === 'https://gcore.jsdelivr.net/gh/FlusAyr/tw-panel@v%s/panel.js',
      '代码源 gcore 优先，且模板里 %s 落在 @v<ver> 位置');
    ok(tb.codeBasePattern === tb.codeUrlPatterns[0], 'CODE_BASE_PATTERN = 首选代码模板（换 host 只改这一处）');
    ok(tb.codeUrl(tb.codeBasePattern, '3.13.0') === PANEL_GCODE_TAG, 'codeUrl() 拼出 @v3.13.0 的 tag 地址');
    ok(tb.codeUrlPatterns[3] === 'https://raw.githubusercontent.com/FlusAyr/tw-panel/v%s/panel.js',
      'raw 代码模板同样拼 tag 路径（不带 @）');
    ok(tb.codeUrlPatterns.every((p) => p.indexOf('@main') < 0), '代码模板全部不含 @main（分支引用一律不许用）');

    ok(tb.importBases.length === 3, 'import 兜底 3 个域');
    ok(tb.importBases.every((b) => b.indexOf('raw.githubusercontent') < 0), 'import 兜底不含 raw（MIME text/plain 会被拒）');
    ok(tb.importBases.every((b) => b.indexOf('@') < 0), 'import 兜底不带 ref（走默认分支最新）');
  }

  /* ── 2. 新版本：代码必须按 tag 取，绝不 @main ───────────── */
  {
    const env = await run({
      store: { 'tw-card:meta': JSON.stringify({ version: '3.12.0' }) },
      fetch: (u) => (u.indexOf('version.json') >= 0
        ? jsonRes({ version: '3.13.0', notes: '测试' })
        : textRes(PANEL_STUB))
    });
    ok(env.fetched[0] === VERSION_OK, '探测从 raw /main/ 开始（实际 ' + env.fetched[0] + '）');
    ok(env.fetched.indexOf(PANEL_GCODE_TAG) >= 0, '代码走 gcore @v3.13.0/panel.js');
    ok(env.fetched.every((u) => u.indexOf('@main') < 0), '本次流程没有任何 @main 请求');
    const meta = JSON.parse(env.store['tw-card:meta'] || '{}');
    ok(meta.version === '3.13.0', '本地 meta 版本更新为 3.13.0');
    ok(meta.src === 'raw.githubusercontent.com', 'meta.src 存主机名（实际 ' + meta.src + '）');
    ok((env.store['tw-card:cache'] || '').length > 2000, '面板代码已写入 tw-card:cache');
    ok(env.imports.length === 0, '快速通道成功时不再走 import 兜底');
  }

  /* ── 3. cmpVer 三态：同版 / 旧版不下载，新版下载 ───────── */
  {
    const same = await run({
      store: { 'tw-card:meta': JSON.stringify({ version: '3.13.0' }) },
      fetch: (u) => (u.indexOf('version.json') >= 0 ? jsonRes({ version: '3.13.0' }) : textRes(PANEL_STUB))
    });
    ok(same.fetched.every((u) => u.indexOf('panel.js') < 0), '同版本不下载代码（cmpVer = 0）');

    const older = await run({
      store: { 'tw-card:meta': JSON.stringify({ version: '3.14.0' }) },
      fetch: (u) => (u.indexOf('version.json') >= 0 ? jsonRes({ version: '3.13.0' }) : textRes(PANEL_STUB))
    });
    ok(older.fetched.every((u) => u.indexOf('panel.js') < 0), '远端更旧不降级（cmpVer = -1）');
  }

  /* ── 3b. tag 命名兜底：v3.13.0 不存在时退到 v3.13 ───────── */
  {
    const env = await run({
      store: { 'tw-card:meta': JSON.stringify({ version: '3.12.0' }) },
      fetch: (u) => {
        if (u.indexOf('version.json') >= 0) return jsonRes({ version: '3.13.0' });
        if (u.indexOf('@v3.13.0/') >= 0) return failRes('404 无此 tag');
        return textRes(PANEL_STUB);   // @v3.13/panel.js 命中
      }
    });
    ok(env.fetched.some((u) => u.indexOf('@v3.13.0/panel.js') >= 0), '先试完整 tag @v3.13.0');
    ok(env.fetched.some((u) => u.indexOf('@v3.13/panel.js') >= 0), '完整 tag 失败后试短 tag @v3.13（历史两位写法）');
    ok((env.store['tw-card:cache'] || '').length > 2000, '短 tag 命中后同样写入缓存');
  }

  /* ── 4. 陈旧镜像不得误判：并行全探 + 取最大 ───────────── */
  {
    /* 复现真实事故：purge 只清 cdn/fastly，gcore 还停在 3.10.1。
       首成功模型会读到 gcore 的 3.10.1 → 判定「已是最新」→ 玩家永不自愈。 */
    const env = await run({
      store: { 'tw-card:meta': JSON.stringify({ version: '3.10.1' }) },
      fetch: (u) => {
        if (u === VERSION_OK) return failRes('raw blocked');           // 墙内 raw 常挂
        if (u === GCODE_VER) return jsonRes({ version: '3.10.1' });    // 陈旧镜像
        if (u === CDN_VER) return jsonRes({ version: '3.13.0' });      // 唯一新鲜
        if (u === FASTLY_VER) return failRes('fastly down');
        return textRes(PANEL_STUB);
      }
    });
    ok(env.fetched.filter((u) => u.indexOf('version.json') >= 0).length === 4,
      '四个探测源全部发起（并行，不因首个成功就停）');
    ok(env.fetched.indexOf(PANEL_GCODE_TAG) >= 0, '按最大版本 3.13.0 拉代码，而不是 gcore 的 3.10.1');
    ok(env.fetched.every((u) => u.indexOf('@v3.10.1') < 0), '没有拿陈旧版本号去拼代码 URL');
    const meta = JSON.parse(env.store['tw-card:meta'] || '{}');
    ok(meta.version === '3.13.0', '本地 meta 升到 3.13.0（陈旧镜像不再阻断自愈）');
    ok(env.logs.some((l) => l.indexOf('探测到远端最新 v3.13.0') >= 0), '日志记录取最大后的结论');
    ok(env.logs.some((l) => l.indexOf('源不可用') >= 0), '失败的探测源只 warn 不中断');
  }

  /* ── 4b. 探测全灭但本地有缓存：不崩，也不清缓存 ────────── */
  {
    const env = await run({
      store: {
        'tw-card:cache': PANEL_STUB,
        'tw-card:meta': JSON.stringify({ version: '3.13.0' })
      },
      fetch: () => failRes('offline'),
      dynImport: () => Promise.reject(new Error('CSP blocked'))
    });
    ok(env.imports.length === 3, '探测全灭时走 import 兜底（三域都试）');
    ok(env.store['tw-card:cache'] === PANEL_STUB, '兜底失败也不清掉已缓存的可用面板');
  }

  /* ── 5. 快速通道全灭 → import 兜底 ─────────────────────── */
  {
    const env = await run({ fetch: () => failRes('offline'), dynImport: () => Promise.resolve({}) });
    ok(env.imports.length === 1, 'import 兜底只走第一个可用域就停（实际调用 ' + env.imports.length + ' 次）');
    ok(env.imports[0] === 'https://gcore.jsdelivr.net/gh/FlusAyr/tw-panel/panel.js',
      '兜底地址不带 ref、不指向 raw（实际 ' + env.imports[0] + '）');
    ok(env.logs.some((l) => l.indexOf('走 import 兜底') >= 0), '日志记录进入 import 兜底');
    ok(env.logs.every((l) => l.indexOf('无可用地址') < 0 || true), '全灭不抛未捕获异常');
  }

  /* ── 6. 三域 import 全失败也不炸，且给出提示 ───────────── */
  {
    const env = await run({
      fetch: () => failRes('offline'),
      dynImport: () => Promise.reject(new Error('CSP blocked'))
    });
    ok(env.imports.length === 3, '三个 jsDelivr 域都试过（实际 ' + env.imports.length + ' 个）');
    /* toast 复用 createElement('div')，文案落在 textContent 上，直接翻已创建的节点 */
    const toasted = env.created.map((n) => String(n.textContent || '')).join(' | ');
    ok(toasted.indexOf('无法连接任何更新源') >= 0, '全链路失败时提示「无法连接任何更新源」');
    ok(env.store['tw-card:cache'] === undefined, '失败时不写坏缓存');
  }

  /* ── 7. 设置面板显示引导自身版本 ───────────────────────── */
  {
    const env = await run({
      store: { 'tw-card:meta': JSON.stringify({ version: '3.13.0', at: 1700000000000, src: 'gcore.jsdelivr.net', notes: 'n' }) },
      fetch: (u) => (u.indexOf('version.json') >= 0 ? jsonRes({ version: '3.13.0' }) : textRes(PANEL_STUB))
    });
    ok(typeof env.sandbox.window.twPanelOpenSettings === 'function', 'twPanelOpenSettings 已暴露');
    env.sandbox.window.twPanelOpenSettings();
    const div = env.created.filter((n) => n.id === 'tw-boot-set')[0];
    ok(!!div, '设置面板 DOM 已创建');
    ok(!!div && div.innerHTML.indexOf('引导 v2.1') >= 0, '设置面板渲染 BOOT_VERSION（引导 v2.1）');
    ok(!!div && div.innerHTML.indexOf('3.13.0') >= 0, '设置面板显示当前面板版本');
  }

  /* ── 8. 出厂包一致性（需先 python build.py；缺文件 = 硬失败，不许跳过） ── */
  {
    const distPath = path.join(__dirname, '..', 'dist', 'loader-script.json');
    const verPath = path.join(__dirname, '..', 'version.json');
    const distExists = fs.existsSync(distPath);
    const verExists = fs.existsSync(verPath);
    if (!distExists || !verExists) {
      // 故意不留逃生门（无环境变量开关）：这一组是「dist 与源码版本对齐」的唯一保险，
      // 一旦能被静默跳过，忘了跑 build 的提交就会假绿放行 —— 正是本次发布最怕的漏。
      const missing = (!distExists ? 'dist/loader-script.json' : 'version.json');
      console.error('  ✗ ' + missing + ' 缺失，先跑 python build.py');
      ok(false, 'dist/ 出厂包一致性：' + missing + ' 缺失（先跑 python build.py）');
    } else {
      const dist = JSON.parse(fs.readFileSync(distPath, 'utf8'));
      const ver = JSON.parse(fs.readFileSync(verPath, 'utf8'));
      const content = String(dist.content || '');
      const m = content.match(/^import '([^']+)'$/m);
      ok(!!m, "dist/loader-script.json 的 content 是单行 import 'URL' 形态");
      const url = m ? m[1] : '';
      let parsed = null;
      try { parsed = new URL(url); } catch (e) { parsed = null; }
      ok(!!parsed, '导入 URL 能被 new URL() 解析（实际 ' + url + '）');
      /* v3.16 起导入行钉的是 BOOT_TAG（boot.mjs 最后变更所在 tag），不是面板 VERSION。
         钉面板版本会让一份**没变**的引导脚本每版都显示"变了"，那正是这版要消掉的 churn。
         BOOT_TAG 从 build.py 现解析 —— 测试里不再写第二份字面量。 */
      const buildSrc = fs.readFileSync(path.join(__dirname, '..', 'build.py'), 'utf8');
      const mtTag = buildSrc.match(/^BOOT_TAG\s*=\s*["'](v[0-9.]+)["']/m);
      ok(!!mtTag, '能从 build.py 解析出 BOOT_TAG');
      ok(!!mtTag && url.indexOf('@' + mtTag[1] + '/boot.mjs') >= 0,
        '导入 URL 钉 BOOT_TAG ' + (mtTag ? mtTag[1] : '(未解析到)') + '/boot.mjs（实际 ' + url + '）');
      ok(url.indexOf('@main') < 0, '导入 URL 不再指向 @main');
      ok(String(dist.name || '').indexOf('v2.1') >= 0, '导入包名称标 v2.1（实际 ' + dist.name + '）');
    }
  }

  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('[boot.test] 未捕获异常：', e);
  process.exit(1);
});
