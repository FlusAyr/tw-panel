/* ══════════════════════════════════════════════════════════════
   tw-card 自动更新引导（boot）v2.1 —— ESM 版
   玩家导入的脚本只有一行（由 build.py 生成，URL 里的 tag = v + version.json 的 version）：
     import 'https://gcore.jsdelivr.net/gh/FlusAyr/tw-panel@v3.13.0/boot.mjs'
   钉 tag 而不是 @main：@main 是分支引用，jsDelivr 会缓存最长 12 小时，发版后
   新导入的玩家可能仍装到旧引导；tag 不可变，发布即刻生效（详见 §v2.1 变更）。
   v2.1 变更：导入行钉 tag、版本探测源与代码源拆成两个显式数组、设置面板显示引导版本
   ──────────────────────────────────────────────────────────────
   双通道设计（v2.0 关键改进）：
   ① 快速通道：fetch version.json 比对版本 → fetch 新代码 → 缓存。
      适用于普通浏览器（更新粒度：分钟级）。
   ② 兜底通道：酒馆助手等 iframe 沙箱可能用 connect-src CSP 拦掉
      fetch（实测会导致整个更新链路哑掉），而 import() 走 script-src
      通道必然放行——此时直接 import 面板本体（jsDelivr 不带 ref 的地址）。
      适用于沙箱环境（更新粒度：jsDelivr 分支缓存 ≤12 小时）。
   ──────────────────────────────────────────────────────────────
   【部署前只改一处】把 REPO 改成你自己的 GitHub 仓库：用户名/仓库名
   ══════════════════════════════════════════════════════════════ */

const REPO = 'FlusAyr/tw-panel';
const BOOT_VERSION = '2.1';     // 引导自身版本（与面板版本无关；设置面板会显示）
const TIMEOUT = 6000;           // 快速通道单请求超时(ms)

const CACHE_KEY = 'tw-card:cache';
const META_KEY = 'tw-card:meta';
const OPTS_KEY = 'tw-card:opts';

/* 用户设置（酒馆助手脚本按钮「面板设置」里调整） */
const DEFAULT_OPTS = { autoReload: false, checkOnBoot: true };
function readOpts() {
  return Object.assign({}, DEFAULT_OPTS, jget(OPTS_KEY) || {});
}
function writeOpts(patch) {
  lsSet(OPTS_KEY, JSON.stringify(Object.assign(readOpts(), patch)));
}

/* ── 取源地址：探测源（可变 ref）与代码源（不可变 ref）必须分开 ─────────────
   为什么要拆：两者要的东西正好相反。
   · 版本探测要「新鲜」——必须知道最新是什么，所以用可变 ref：
     Raw 的 main 分支约 5 分钟新鲜，放第一个；jsDelivr 三域不带 ref 时也指向
     默认分支最新（≤12h 缓存），只作后备。
   · 代码拉取要「不变」——必须拿到与 version.json 声明完全一致的那一份，所以用
     tag。tag 一旦发布，任何镜像都只能回源取同一份字节。
   旧版 v2.0 把两者塞进同一个以 '@' 结尾的 base，靠 base+'v'+v 拼代码 URL、靠
   base+'main' 拼探测 URL，字符串形态强耦合；改任一处都可能拼出
   '@mainv3.13.0' 这种废 URL。现在两边各自是完整字面模板，互不影响。

   ⚠ 注意：jsDelivr purge 不覆盖 gcore / fastly 镜像，只有 cdn.jsdelivr.net
   保证被清（purge 回执里 providers 只有 CF + FY）。实测 purge 后 cdn 全绿而
   gcore 仍在发旧版，最长扛满 s-maxage=12h。因此所有拉取 URL 必须钉 tag
   （不可变）；用 @main 这类分支引用 = 把「镜像缓存多旧」变成玩家的随机体验。 */
const RAW_BASE = 'https://raw.githubusercontent.com/' + REPO + '/';   // 结尾是 /
/* 不以 @ 结尾：gh/<repo>/<file> 即默认分支最新，用于探测与 import 兜底 */
const JSD_PLAIN_BASES = [
  'https://gcore.jsdelivr.net/gh/' + REPO + '/',
  'https://cdn.jsdelivr.net/gh/' + REPO + '/',
  'https://fastly.jsdelivr.net/gh/' + REPO + '/'
];

/* 版本探测（可变 ref）：Raw /main/ 最先，jsDelivr 三域不带 ref 兜底。
   注意是「并行全探 + 取最大」，不是「取第一个成功」——gcore 可能比 cdn 落后
   一整个发版周期，首成功模型会读到旧版号后直接判定「已是最新」，玩家永不自愈。 */
const VERSION_URLS = [RAW_BASE + 'main/version.json'].concat(
  JSD_PLAIN_BASES.map((b) => b + 'version.json')
);
/* 代码拉取（不可变 ref）：完整字面模板，%s 处填探测出来的版本号。
   gcore 优先（对国内最稳），cdn / fastly / Raw 依次兜底。
   语义要点：v 只能来自探测结果，不能写死——但前缀永远是 tag，绝不用 @main。 */
const CODE_URL_PATTERNS = [
  'https://gcore.jsdelivr.net/gh/' + REPO + '@v%s/panel.js',
  'https://cdn.jsdelivr.net/gh/' + REPO + '@v%s/panel.js',
  'https://fastly.jsdelivr.net/gh/' + REPO + '@v%s/panel.js',
  RAW_BASE + 'v%s/panel.js'
];
/* 单一代码模板（首选 gcore），调试与文档只需认这一个 */
const CODE_BASE_PATTERN = CODE_URL_PATTERNS[0];
const codeUrl = (pattern, v) => String(pattern).replace('%s', v);
/* @main 代码地址：只在「强制重拉最新」时用，日常更新一律走 tag */
const MAIN_CODE_URLS = [RAW_BASE + 'main/panel.js'].concat(
  JSD_PLAIN_BASES.map((b) => b + 'panel.js')
);
/* import 兜底通道只用 jsDelivr 系（Raw 的 MIME 是 text/plain，模块加载会拒） */
const IMPORT_BASES = JSD_PLAIN_BASES;

/* ═════════ 小工具 ═════════ */
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
const jget = (k) => { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } };

/* 把完整 URL 缩成主机名，用于日志与设置面板显示（'import'/'force-main' 原样返回） */
function shortSrc(u) {
  const s = String(u == null ? '' : u);
  if (s.indexOf('://') < 0) return s || '—';
  return s.replace(/^[a-z]+:\/\//i, '').split('/')[0] || '—';
}

function cmpVer(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function toast(msg, kind, ms) {
  try {
    const d = document.createElement('div');
    const color = kind === 'err' ? '#f87171' : kind === 'warn' ? '#fbbf24' : '#4ade80';
    d.textContent = msg;
    d.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99999;max-width:380px;' +
      'font:12.5px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8eef7;' +
      'background:rgba(12,18,28,.94);border:1px solid ' + color + '55;border-left:3px solid ' + color + ';' +
      'border-radius:8px;padding:9px 13px;box-shadow:0 8px 26px rgba(0,0,0,.5)';
    (document.body || document.documentElement).appendChild(d);
    setTimeout(() => d.remove(), ms || 4200);
  } catch (e) { }
}

async function fetchText(url) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => { try { ac && ac.abort(); } catch (e) { } }, TIMEOUT);
  try {
    const r = await fetch(url, { signal: ac ? ac.signal : undefined, cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function fetchFirst(urls) {
  let lastErr;
  for (const u of urls) {
    try { return await fetchText(u); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('无可用地址');
}

/* ═════════ 执行面板代码 ═════════ */
function boot(code, ver) {
  try {
    if (typeof window.__twCardLoaded !== 'undefined' && window.__twCardLoaded) return false;
    window.__twCardLoaded = false;
    try {
      new Function(code).call(window);
    } catch (e) {
      const s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    }
    const cur = (window.__twCard && window.__twCard.version) || ver || '?';
    console.log('[tw-boot] 面板已启动 v' + cur);
    return true;
  } catch (e) {
    console.error('[tw-boot] 面板启动失败:', e);
    toast('tw-card：面板启动失败，' + (e && e.message ? e.message : e), 'err', 8000);
    return false;
  }
}

/* 兜底通道：import() 直连面板本体，逐域尝试。
   用「不带 ref」的 jsDelivr 地址（=默认分支最新），因为兜底通道本来就不可能是
   精确版本，能拿到当前 main 上的面板即可；带 @main 写法会被缓存 12h，故不再用。 */
async function bootViaImport() {
  for (const base of IMPORT_BASES) {
    try {
      console.log('[tw-boot] 快速通道不可用，走 import 兜底：' + base + 'panel.js');
      await import(base + 'panel.js');
      const cur = (window.__twCard && window.__twCard.version) || '?';
      console.log('[tw-boot] 面板已启动 v' + cur + '（import 兜底）');
      try { lsSet(META_KEY, JSON.stringify({ version: cur, at: Date.now(), src: 'import', notes: '' })); } catch (e) { }
      return true;
    } catch (e) {
      console.warn('[tw-boot] import 失败（' + shortSrc(base) + '）：', e && e.message);
    }
  }
  return false;
}

/* ═════════ 快速通道：版本检查 + 缓存更新 ═════════ */

/* 并行探测所有版本源 → 用 cmpVer 取「最大版本」。
   为什么不是「第一个成功就返回」：jsDelivr purge 只清 cdn（CF）+ fastly，gcore
   是独立镜像层，可以落后一整个发版周期。首成功模型会拿 gcore 的旧版号去比，
   判成「已是最新」后直接 return，玩家永远停旧版、还不报错——这是最坏的失败方式。
   并行而非串行：墙内串行等于排队等四次超时，启动会卡住。 */
async function probeLatest() {
  const results = await Promise.all(VERSION_URLS.map((url) =>
    fetchText(url).then(
      (txt) => ({ url: url, data: JSON.parse(txt) }),
      (e) => { console.warn('[tw-boot] 源不可用：', shortSrc(url), e && e.message); return null; }
    )
  ));
  let best = null;
  for (const r of results) {
    if (!r || !r.data) continue;
    const v = String(r.data.version || '').replace(/^v/i, '');
    if (!v) continue;
    if (!best || cmpVer(v, best.v) > 0) {
      best = { v: v, url: r.url, notes: r.data.notes || '' };
    }
  }
  if (best) console.log('[tw-boot] 探测到远端最新 v' + best.v + '（' + shortSrc(best.url) + '）');
  return best;
}

async function refresh() {
  const meta = jget(META_KEY) || {};
  const curVer = meta.version || (window.__twCard && window.__twCard.version) || '0.0.0';

  const best = await probeLatest();
  if (!best) return false;   // 四个探测源全灭 → 交给 import 兜底

  if (cmpVer(best.v, curVer) <= 0) {
    console.log('[tw-boot] 已是最新 v' + curVer);
    return true;
  }

  /* 代码一律按 tag 取（不可变）。跨域 + 两种 tag 命名各试一遍：
     tag 既可能是 v3.13.0，也可能是 v3.13（VERSION 只有两位的历史写法）。 */
  const urls = [];
  const short = best.v.replace(/\.0$/, '');
  for (const pat of CODE_URL_PATTERNS) {
    urls.push(codeUrl(pat, best.v));
    if (short !== best.v) urls.push(codeUrl(pat, short));
  }
  try {
    const code = await fetchFirst(urls);
    if (!code || code.length < 2000) throw new Error('内容异常');
    const src = shortSrc(best.url);
    lsSet(CACHE_KEY, code);
    lsSet(META_KEY, JSON.stringify({ version: best.v, at: Date.now(), src: src, notes: best.notes }));
    console.log('[tw-boot] 拉到新版本 v' + best.v + '（tag 锁死）');
    if (!window.__twCardLoaded) { boot(code, best.v); return true; }
    if (readOpts().autoReload) { location.reload(); return true; }
    toast('tw-card 面板已更新至 v' + best.v + '，刷新页面后生效' +
      (best.notes ? '（' + best.notes + '）' : ''), 'ok', 6000);
    return true;
  } catch (e) {
    /* 版本号探到了但代码全取不到：不能算「已是最新」，交回上层，让它走 import 兜底 */
    console.warn('[tw-boot] 代码拉取失败：', e && e.message);
    return false;
  }
}

/* ═════════ 设置面板（酒馆助手脚本按钮「面板设置」触发） ═════════ */
function openSettings() {
  try {
    const old = document.getElementById('tw-boot-set'); if (old) old.remove();
    const meta = jget(META_KEY) || {};
    const o = readOpts();
    const cur = (window.__twCard && window.__twCard.version) || meta.version || '未知';
    const at = meta.at ? new Date(meta.at).toLocaleString() : '—';
    const src = shortSrc(meta.src);
    const d = document.createElement('div');
    d.id = 'tw-boot-set';
    d.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)';
    d.innerHTML =
      '<div style="width:min(420px,92vw);background:#111827;color:#e5e7eb;border:1px solid rgba(148,163,184,.3);border-radius:14px;padding:18px 20px;font:13px/1.7 system-ui,-apple-system,\'Segoe UI\',sans-serif;box-shadow:0 18px 60px rgba(0,0,0,.6)">' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px"><b style="font-size:15px">tw-card 面板设置</b><span style="color:#94a3b8;font-size:12px">引导 v' + BOOT_VERSION + '</span></div>' +
      '<div style="background:#0b1220;border-radius:10px;padding:9px 12px;font-size:12px;color:#94a3b8;margin-bottom:12px">' +
      '当前版本 <b style="color:#7dd3fc">v' + cur + '</b> ｜ 缓存于 ' + at + '<br>更新源 <span style="color:#94a3b8">' + src + '</span>' +
      (meta.notes ? '<br>版本说明：' + meta.notes : '') + '</div>' +
      '<label style="display:flex;align-items:center;gap:8px;padding:6px 2px;cursor:pointer">' +
      '<input type="checkbox" id="tw-o-reload"' + (o.autoReload ? ' checked' : '') + '> 拉到新版本后自动刷新页面（关 = 提示后下次刷新生效）</label>' +
      '<label style="display:flex;align-items:center;gap:8px;padding:6px 2px;cursor:pointer">' +
      '<input type="checkbox" id="tw-o-check"' + (o.checkOnBoot ? ' checked' : '') + '> 每次打开页面时检查更新</label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' +
      '<button id="tw-b-check" style="flex:1;background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:12.5px">立即检查更新</button>' +
      '<button id="tw-b-force" style="flex:1;background:#7c2d12;color:#fdba74;border:1px solid #ea580c55;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:12.5px">强制重拉最新</button>' +
      '<button id="tw-b-clear" style="flex:1;background:#3f1d1d;color:#fca5a5;border:1px solid #ef444455;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:12.5px">清除缓存并停用</button>' +
      '</div>' +
      '<div style="margin-top:8px;font-size:11px;color:#64748b">强制重拉：忽略版本号直接拉取仓库最新面板。清除缓存：卸载本页面面板并清空本地数据（重新加载页面后引导会重新安装）。</div>' +
      '<button id="tw-b-close" style="display:block;margin:10px 0 0 auto;background:none;border:0;color:#94a3b8;cursor:pointer;font-size:12px">关闭</button>' +
      '</div>';
    (document.body || document.documentElement).appendChild(d);
    d.addEventListener('click', (e) => { if (e.target === d) d.remove(); });
    d.querySelector('#tw-b-close').onclick = () => d.remove();
    d.querySelector('#tw-o-reload').onchange = (e) => { writeOpts({ autoReload: e.target.checked }); toast('tw-card：自动刷新已' + (e.target.checked ? '开启' : '关闭'), 'ok'); };
    d.querySelector('#tw-o-check').onchange = (e) => { writeOpts({ checkOnBoot: e.target.checked }); toast('tw-card：启动检查已' + (e.target.checked ? '开启' : '关闭'), 'ok'); };
    d.querySelector('#tw-b-check').onclick = async () => { d.remove(); toast('tw-card：正在检查更新…', 'ok', 2500); await start(); };
    d.querySelector('#tw-b-force').onclick = async () => {
      d.remove(); toast('tw-card：正在强制重拉最新面板…', 'ok', 3000);
      try {
        const code = await fetchFirst(MAIN_CODE_URLS);
        if (!code || code.length < 2000) throw new Error('内容异常');
        lsSet(CACHE_KEY, code);
        window.__twCardLoaded = false;
        if (!boot(code, '最新') && !window.__twCardLoaded) { location.reload(); return; }
        lsSet(META_KEY, JSON.stringify({ version: (window.__twCard && window.__twCard.version) || '最新', at: Date.now(), src: 'force-main', notes: '强制重拉 main' }));
        toast('tw-card：已重拉仓库最新面板并热启动，建议刷新页面固化', 'ok', 6000);
      } catch (e) { toast('tw-card：强制重拉失败，' + (e && e.message || e), 'err', 8000); }
    };
    d.querySelector('#tw-b-clear').onclick = () => {
      try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(META_KEY); } catch (e) { }
      window.__twCardLoaded = true;   // 阻止本页再次 boot
      d.remove();
      toast('tw-card：缓存已清空，刷新页面后引导会重新安装面板', 'ok', 6000);
    };
  } catch (e) { console.error('[tw-boot] 设置面板打开失败:', e); }
}

/* ═════════ 启动 ═════════ */
// 已装旧的手动脚本 → 提醒停用，避免两份互相抢渲染
if (window.__twCardLoaded && window.__twCard && !window.__twCardLoader) {
  toast('tw-card：检测到旧版手动脚本仍在运行，请到酒馆助手 → 脚本 停用旧面板脚本，否则自动更新不会生效', 'warn', 10000);
}

window.__twCardLoader = true;
window.twPanelOpenSettings = openSettings;
/* 引导自身自省接口：版本 + 实际在用的取源地址（排查「到底在拉哪个 URL」时用；
   tests/boot.test.js 也靠它断言取源顺序，省得去解析源码字符串） */
window.twBoot = {
  version: BOOT_VERSION,
  versionUrls: VERSION_URLS,
  codeUrlPatterns: CODE_URL_PATTERNS,
  codeBasePattern: CODE_BASE_PATTERN,
  codeUrl: codeUrl,
  importBases: IMPORT_BASES
};

/* 酒馆助手脚本按钮（按钮名须与导入包 button.buttons 声明一致） */
try {
  if (typeof eventOn === 'function' && typeof getButtonEvent === 'function') {
    eventOn(getButtonEvent('面板设置'), openSettings);
    eventOn(getButtonEvent('检查更新'), () => start());
  }
} catch (e) { /* 非酒馆助手环境，忽略 */ }

const cache = lsGet(CACHE_KEY);
if (cache) boot(cache, (jget(META_KEY) || {}).version);

const start = async () => {
  const o = readOpts();
  let ok = false;
  if (o.checkOnBoot || window.__twPanelManual) ok = await refresh();
  if (!ok) ok = await bootViaImport();   // 快速通道失败/被 CSP 拦 → import 兜底
  if (!ok && !lsGet(CACHE_KEY)) {
    toast('tw-card：无法连接任何更新源，且本地无缓存。请检查网络，或手动导入面板脚本。', 'err', 9000);
  }
};

window.twPanelCheck = () => { window.__twPanelManual = true; return start(); };
window.twPanelVersion = () => (jget(META_KEY) || {}).version || (window.__twCard && window.__twCard.version) || 'unknown';

if (cache) setTimeout(start, 1200); else start();
