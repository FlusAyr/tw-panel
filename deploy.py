#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""主神空间 · 一键部署（半自动）

做掉可以自动化的部分：装 SillyTavern、装酒馆助手扩展、放世界书、下载导入包。
剩下 4 处在浏览器里点的地方，脚本跑完会打印出来。

用法：
    python deploy.py                      # 装到 ./st-env
    python deploy.py --dir D:/st-env      # 指定目录（不要有空格和中文）
    python deploy.py --skip-st            # 已有酒馆，只放内容与导入包
    python deploy.py --dry-run            # 只打印命令，不执行

依赖：python 3.8+、git、node 20+、npm
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

REPO_RAW = "https://raw.githubusercontent.com/FlusAyr/tw-panel/main"
ST_REPO = "https://github.com/SillyTavern/SillyTavern"
TH_REPO = "https://github.com/N0VI028/JS-Slash-Runner"          # 酒馆助手（TavernHelper）
DB_REPO = "https://github.com/AlbusKen/shujuku"                  # 第三方数据库插件（仅指路，不下载分发）

WORLDBOOKS = [
    ("content/worldbook/无限恐怖_v2_联机版_AI精简.json", "无限恐怖_v2_联机版_AI精简.json"),
    ("content/worldbook/跑团用世界书_v4_联机版_AI精简.json", "跑团用世界书_v4_联机版_AI精简.json"),
]
IMPORT_PACK = [
    ("dist/loader-script.json", "loader-script.json"),
    ("content/database/无限恐怖数据库模板_主神空间深度版.json", "无限恐怖数据库模板_主神空间深度版.json"),
]

DRY = False


# ─────────────────────────── 基础工具 ───────────────────────────

def log(msg=""):
    print(msg, flush=True)


def step(title):
    log()
    log("=" * 62)
    log("  " + title)
    log("=" * 62)


def run(cmd, cwd=None, check=True):
    """执行命令；DRY 模式只打印。"""
    printable = " ".join(cmd) if isinstance(cmd, list) else cmd
    if DRY:
        log("  [dry-run] " + printable + (("  (cwd=%s)" % cwd) if cwd else ""))
        return 0
    log("  $ " + printable)
    p = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str))
    if check and p.returncode != 0:
        raise SystemExit("\n  ✗ 命令失败（退出码 %d）：%s" % (p.returncode, printable))
    return p.returncode


def which_any(*names):
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    return None


def check_tools():
    step("阶段 0 · 环境检查")
    ok = True

    node = which_any("node", "node.exe")
    if node:
        try:
            v = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
            major = int(v.lstrip("v").split(".")[0])
            log("  node %s  %s" % (v, "OK" if major >= 20 else "✗ 需要 >= 20（SillyTavern 1.19 要求）"))
            ok = ok and major >= 20
        except Exception as e:
            log("  node 版本读取失败：%s" % e)
            ok = False
    else:
        log("  ✗ 找不到 node —— 先装 Node 20 或 22 LTS：https://nodejs.org/")
        ok = False

    npm = which_any("npm", "npm.cmd")
    log("  npm  %s" % ("OK" if npm else "✗ 未找到（随 Node 一起安装）"))
    ok = ok and bool(npm)

    git = which_any("git", "git.exe")
    log("  git  %s" % ("OK" if git else "✗ 未找到：https://git-scm.com/downloads"))
    ok = ok and bool(git)

    if not ok:
        raise SystemExit("\n  环境不满足，先解决上面 ✗ 的项再跑一次。")
    return {"node": node, "npm": npm, "git": git}


# ─────────────────────────── 各阶段 ───────────────────────────

def clone_st(base, tools):
    step("阶段 A · 安装 SillyTavern（release 分支）")
    st_dir = os.path.join(base, "SillyTavern")
    if os.path.isdir(os.path.join(st_dir, "server.js")):
        log("  已存在，跳过 clone：%s" % st_dir)
    else:
        run([tools["git"], "clone", ST_REPO, "-b", "release", "--depth", "1", st_dir])
    return st_dir


def npm_install(st_dir, tools):
    step("阶段 A3 · 安装依赖（2–5 分钟，别中断）")
    run([tools["npm"], "install"], cwd=st_dir)


def clone_helper(st_dir, tools):
    step("阶段 B · 装酒馆助手扩展（TavernHelper）")
    dest = os.path.join(st_dir, "public", "scripts", "extensions", "third-party", "JS-Slash-Runner")
    if os.path.isfile(os.path.join(dest, "manifest.json")):
        log("  已存在，跳过 clone：%s" % dest)
    else:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        run([tools["git"], "clone", TH_REPO, "--depth", "1", dest])
    man = os.path.join(dest, "manifest.json")
    if os.path.isfile(man):
        try:
            d = json.load(open(man, encoding="utf-8"))
            log("  manifest: %s v%s（dist 已打包，无需编译）" % (d.get("display_name"), d.get("version")))
        except Exception:
            pass
    return dest


def download(url, dest, min_bytes=1000):
    if DRY:
        log("  [dry-run] 下载 %s -> %s" % (url, dest))
        return True
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "tw-panel-deploy"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        if len(data) < min_bytes:
            log("  ✗ 内容过小（%d B），可能下到了错误页：%s" % (len(data), url))
            return False
        with open(dest, "wb") as f:
            f.write(data)
        log("  ✓ %s  (%d KB)" % (os.path.basename(dest), len(data) // 1024))
        return True
    except Exception as e:
        log("  ✗ 下载失败 %s：%s" % (url, e))
        return False


def put_worldbooks(st_dir):
    step("阶段 C1 · 放世界书到 data/default-user/worlds/")
    wdir = os.path.join(st_dir, "data", "default-user", "worlds")
    if not DRY:
        os.makedirs(wdir, exist_ok=True)
    ok = 0
    for rel, name in WORLDBOOKS:
        url = REPO_RAW + "/" + urllib.parse.quote(rel)
        if download(url, os.path.join(wdir, name)):
            ok += 1
    log("  %s" % ("[dry-run] 未实际下载" if DRY else "成功 %d / %d" % (ok, len(WORLDBOOKS))))
    return wdir


def make_import_pack(base):
    step("阶段 C2 · 准备「导入包」（待会要在界面里手工导入）")
    pdir = os.path.join(base, "主神空间导入包")
    if not DRY:
        os.makedirs(pdir, exist_ok=True)
    ok = 0
    for rel, name in IMPORT_PACK:
        url = REPO_RAW + "/" + urllib.parse.quote(rel)
        if download(url, os.path.join(pdir, name)):
            ok += 1
    log("  %s" % ("[dry-run] 未实际下载" if DRY else "成功 %d / %d" % (ok, len(IMPORT_PACK))))
    return pdir


# ─────────────────────────── 收尾 ───────────────────────────

def print_next_steps(st_dir, pack_dir):
    step("接下来必须人工点（约 5 分钟）")
    log("""
  ▸ 1. 启动酒馆（脚本不代你启动长驻进程）
       cd "%s"
       npm start
       浏览器打开 http://localhost:8000

  ▸ 2. 启用酒馆助手
       扩展按钮 → 找到「酒馆助手」→ 开关打开 → 刷新

  ▸ 3. 装数据库插件（第三方，去作者处下载，我们不转发）
       %s
       下载根目录的「酒馆助手脚本-龙血玄黄·数据库.json」
       酒馆助手 → 脚本 → 导入 → 选它 → 刷新

  ▸ 4. 导入数据库模板
       数据库面板 → 导入模板 → %s
       确认建出 10 张表。红线：不要改「纪要」表结构（6 列、AM0001 起）

  ▸ 5. 装渲染器
       酒馆助手 → 脚本 → 导入 → %s
       启用后刷新。看卡片右下角是否有版本水印

  ▸ 6. 启用世界书
       世界书面板 → 选中「跑团用世界书 v4」（条目数应为 18）
       「无限恐怖 v2」条目数应为 24；两本要同时生效就合并或绑角色卡

  ▸ 7. 端到端验收
       发一楼：AI 末尾出现 scene: / p1: / cr1: 键行 → 被渲染成卡片 = 成功
""" % (st_dir, DB_REPO, pack_dir, os.path.join(pack_dir, "loader-script.json")))


def main():
    global DRY
    ap = argparse.ArgumentParser(description="主神空间一键部署（半自动）")
    ap.add_argument("--dir", default="st-env", help="安装目录，默认 ./st-env")
    ap.add_argument("--skip-st", action="store_true", help="已有酒馆，只放内容与导入包")
    ap.add_argument("--dry-run", action="store_true", help="只打印命令，不落地")
    a = ap.parse_args()

    DRY = a.dry_run
    base = os.path.abspath(a.dir)

    log("主神空间 · 一键部署")
    log("目标目录：%s%s" % (base, "   [dry-run]" if DRY else ""))
    if " " in base:
        log("  ⚠ 路径含空格，npm 可能报错，建议换一个更短的路径")

    tools = check_tools()

    if a.skip_st:
        st_dir = base if os.path.isfile(os.path.join(base, "server.js")) else input_path(base)
        log("\n  跳过安装，酒馆目录：%s" % st_dir)
    else:
        if not DRY:
            os.makedirs(base, exist_ok=True)
        st_dir = clone_st(base, tools)
        npm_install(st_dir, tools)

    clone_helper(st_dir, tools)
    put_worldbooks(st_dir)
    pack = make_import_pack(base)

    print_next_steps(st_dir, pack)
    log("完成。任何一步失败，先把报错原文贴给 AI 助手，对照 AGENT_DEPLOY.md 第 8 节处理。")


def input_path(base):
    """--skip-st 时如果 base 不是酒馆根目录，就在常见位置找一下。"""
    for cand in ["SillyTavern", ".", ".."]:
        p = os.path.abspath(os.path.join(base, cand))
        if os.path.isfile(os.path.join(p, "server.js")):
            return p
    raise SystemExit("  找不到 SillyTavern（server.js），请用 --dir 指向酒馆根目录")


if __name__ == "__main__":
    main()
