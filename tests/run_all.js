#!/usr/bin/env node
/**
 * tw-panel 聚合测试入口
 *
 * 为什么有这个文件：
 *   在 shell 里给 node 传一个带通配符的路径（node tests/ 后面跟星号点 js），
 *   shell 会把它展开成四个文件参数，而 node **只执行第一个文件**（按字母序是
 *   boot.test.js），其余三个被当成 argv 丢掉，EXIT 仍然是 0。
 *   于是"四套回归全过"永远成立，谁漏跑都没人知道。
 *   所以这里用**显式文件名数组**逐个 spawn，逐个取真实 exit code。
 *
 * 三条纪律（和 boot.test.js 第 8 组封的那道门是同一个原则）：
 *   1. 绝不做通配符匹配、绝不做目录扫描 —— 否则只是把假绿换个地方住。
 *      清单是手写的、唯一的真相：新增测试必须手动追加进 FILES，才会被执行。
 *   2. 缺文件 = 失败，不是 SKIP（漏掉一个测试和跑挂一个测试同样严重）。
 *   3. 纯 node、零依赖、无环境变量开关。
 *
 * 用法：
 *   node tests/run_all.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const TESTS_DIR = __dirname;

/** 显式清单：顺序 = 执行顺序。新增测试请手动追加到这里。 */
const FILES = [
  'npc.test.js',
  'loader.test.js',
  'next_sweep.test.js',
  'boot.test.js',
];

function main() {
  console.log('[run_all] tw-panel 聚合测试');
  console.log('[run_all] node ' + process.version);
  console.log('[run_all] ' + TESTS_DIR);
  console.log('[run_all] 清单（显式，无通配符）：');
  for (const name of FILES) console.log('           - ' + name);
  console.log('');

  const failures = [];

  // ── 1. 缺文件 = 硬失败（不许 SKIP） ───────────────────────────────
  for (const name of FILES) {
    if (!fs.existsSync(path.join(TESTS_DIR, name))) {
      console.error('  ✗ ' + name + ' 不存在（清单里有、磁盘上没有 —— 别改名，或同步改本文件清单）');
      failures.push({ name, code: 'MISSING' });
    }
  }

  if (failures.length) {
    console.log('');
    console.log('[run_all] 预检失败，未执行任何测试：' + failures.map((f) => f.name).join(', '));
    process.exit(1);
  }

  // ── 2. 逐个跑，stdio: 'inherit' 保留每个测试自己的完整输出 ─────────
  //    不用 'pipe'：本仓库的沙箱环境对「程序捕获另一个程序输出」会 EPERM，
  //    而 'inherit' 是安全的，且四组数字（14 / 11 / 全部通过 / 56）照样直接
  //    出现在聚合输出里，人工和 CI 都能逐项核对。
  const codes = [];
  for (let i = 0; i < FILES.length; i++) {
    const name = FILES[i];
    const full = path.join(TESTS_DIR, name);
    console.log('════════ [' + (i + 1) + '/' + FILES.length + '] ' + name + ' ════════');

    const r = spawnSync(process.execPath, [full], {
      stdio: 'inherit',
      cwd: path.join(TESTS_DIR, '..'),
    });

    // status 为 null = 子进程没能正常退出（被信号杀 / spawn 失败），一律算失败。
    let code = 0;
    if (r && typeof r.status === 'number') {
      code = r.status;
    } else {
      code = -1;
      if (r && r.error) console.error('[run_all] spawn 失败：' + r.error.message);
      if (r && r.signal) console.error('[run_all] 被信号终止：' + r.signal);
    }

    codes.push({ name, code });
    if (code !== 0) failures.push({ name, code });

    console.log('════════ [' + (i + 1) + '/' + FILES.length + '] ' + name +
      ' → ' + (code === 0 ? '通过 (exit 0)' : '失败 (exit ' + code + ')') + ' ════════');
    console.log('');
  }

  // ── 3. 汇总 ──────────────────────────────────────────────────────
  console.log('[run_all] 逐项结果：');
  for (const c of codes) {
    const label = c.name.padEnd(22);
    console.log('  ' + (c.code === 0 ? '✓' : '✗') + ' ' + label + ' exit ' + c.code);
  }
  console.log('');

  if (failures.length) {
    console.error('[run_all] 失败：' + failures.length + ' / ' + FILES.length + ' 组');
    for (const f of failures) {
      console.error('  - ' + f.name + '  (exit ' + f.code + ')');
    }
    process.exit(1);
  }

  console.log('[run_all] 全部通过：' + FILES.length + ' / ' + FILES.length + ' 组，均 exit 0');
  process.exit(0);
}

main();
