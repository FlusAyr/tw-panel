/* ══════════════════════════════════════════════════════════════
   tw-card 自动更新引导（loader）v1.0
   玩家只导入这一支脚本，面板本体从 git 仓库/CDN 拉取。
   以后面板更新 → 仓库发版 → 玩家刷新页面自动生效，无需重装。
   ──────────────────────────────────────────────────────────────
   【部署前只改一处】把 REPO 改成你自己的 GitHub 仓库：用户名/仓库名
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═════════ 配置区 ═════════ */
  const REPO = 'CHANGE_ME/tw-panel';   // ← 例：'zhangsan/tw-panel'
  const AUTO_RELOAD = false;           // true = 拉到新版本立刻刷新页面；false = 提示后由玩家下次刷新生效
  const CHECK_ON_BOOT = true;          // 每次页面加载都检查更新
  const TIMEOUT = 6000;                // 单个源超时(ms)
  /* ═════════ 配置区结束 ═════════ */

  const CACHE_KEY = 'tw-card:cache';
  const META_KEY = 'tw-card:meta';

  /* 每个源给出「版本清单地址」与「代码地址候选列表」；
     tag 既可能打成 v3.9.0 也可能打成 v3.9，两种都试 */
  const SOURCES = [
    {
      name: 'GitHub Raw',
      version: 'https://raw.githubusercontent.com/' + REPO + '/main/version.json',
      code: (v) => [
        'https://raw.githubusercontent.com/' + REPO + '/v' + v + '/panel.js',
        'https://raw.githubusercontent.com/' + REPO + '/v' + v.replace(/\.0$/, '') + '/panel.js'
      ]
    },
    {
      name: 'jsDelivr',
      version: 'https://cdn.jsdelivr.net/gh/' + REPO + '@main/version.json',
      code: (v) => [
        'https://cdn.jsdelivr.net/gh/' + REPO + '@v' + v + '/panel.js',
        'https://cdn.jsdelivr.net/gh/' + REPO + '@v' + v.replace(/\.0$/, '') + '/panel.js'
      ]
    }
    /* 国内可加 Gitee 镜像：
    ,{ name:'Gitee', version:'https://gitee.com/'+REPO+'/raw/main/version.json',
       code:(v)=>['https://gitee.com/'+REPO+'/raw/v'+v+'/panel.js'] }
    */
  ];

  /* ═════════ 小工具 ═════════ */
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const jget = (k) => { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } };

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
      document.body.appendChild(d);
      setTimeout(() => d.remove(), ms || 4200);
    } catch (e) { }
  }

  async function fetchText(url, timeout) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => { try { ac && ac.abort(); } catch (e) { } }, timeout || TIMEOUT);
    try {
      const r = await fetch(url, { signal: ac ? ac.signal : undefined, cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } finally { clearTimeout(t); }
  }

  async function fetchFirst(urls) {
    let lastErr;
    for (let i = 0; i < urls.length; i++) {
      try { return await fetchText(urls[i]); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('无可用地址');
  }

  /* ═════════ 执行面板代码 ═════════ */  function boot(code, ver) {
    try {
      if (typeof window.__twCardLoaded !== 'undefined' && window.__twCardLoaded) return false;
      // 允许覆盖守卫执行一次（同页只跑最新一份）
      window.__twCardLoaded = false;
      try {
        new Function(code).call(window);
      } catch (e) {
        // CSP 禁 eval 时退化为 <script> 注入
        const s = document.createElement('script');
        s.textContent = code;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      }
      const cur = (window.__twCard && window.__twCard.version) || ver || '?';
      console.log('[tw-loader] 面板已启动 v' + cur);
      return true;
    } catch (e) {
      console.error('[tw-loader] 面板启动失败:', e);
      toast('tw-card：面板启动失败，' + (e && e.message ? e.message : e), 'err', 8000);
      return false;
    }
  }

  /* ═════════ 更新检查 ═════════ */
  async function refresh() {
    const meta = jget(META_KEY) || {};
    const curVer = meta.version || (window.__twCard && window.__twCard.version) || '0.0.0';

    for (let i = 0; i < SOURCES.length; i++) {
      const s = SOURCES[i];
      try {
        const remote = JSON.parse(await fetchText(s.version));
        const v = String(remote.version || '').replace(/^v/i, '');
        if (!v) continue;
        if (cmpVer(v, curVer) <= 0) {
          console.log('[tw-loader] 已是最新 v' + curVer + '（' + s.name + '）');
          return;
        }
        const code = await fetchFirst(s.code(v));
        if (!code || code.length < 2000) throw new Error('内容异常');
        lsSet(CACHE_KEY, code);
        lsSet(META_KEY, JSON.stringify({
          version: v, at: Date.now(), src: s.name, notes: remote.notes || ''
        }));
        console.log('[tw-loader] 拉到新版本 v' + v + '（' + s.name + '）');
        if (!window.__twCardLoaded) { boot(code, v); return; }
        if (AUTO_RELOAD) { location.reload(); return; }
        toast('tw-card 面板已更新至 v' + v + '，刷新页面后生效' +
          (remote.notes ? '（' + remote.notes + '）' : ''), 'ok', 6000);
        return;
      } catch (e) {
        console.warn('[tw-loader] 源 ' + s.name + ' 不可用：', e && e.message);
      }
    }
    if (!lsGet(CACHE_KEY)) {
      toast('tw-card：无法连接更新源，且本地无缓存。请检查网络，或手动导入面板脚本。', 'err', 9000);
    } else {
      console.warn('[tw-loader] 所有更新源不可用，继续使用本地缓存 v' + curVer);
    }
  }

  /* ═════════ 启动 ═════════ */
  // 已装旧的手动脚本 → 提醒停用，避免两份互相抢渲染
  if (window.__twCardLoaded && window.__twCard && !window.__twCardLoader) {
    toast('tw-card：检测到旧版手动脚本仍在运行，请到酒馆助手 → 脚本 停用旧面板脚本，否则自动更新不会生效', 'warn', 10000);
  }

  window.__twCardLoader = true;

  const cache = lsGet(CACHE_KEY);
  if (cache) {
    boot(cache, (jget(META_KEY) || {}).version);
  }
  if (CHECK_ON_BOOT) {
    setTimeout(refresh, cache ? 1200 : 0);
  }

  window.twPanelCheck = refresh;                      // 控制台手动触发：twPanelCheck()
  window.twPanelVersion = () => (jget(META_KEY) || {}).version || 'unknown';
})();
