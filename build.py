#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tw-panel 打包脚本
  python build.py          # 读取 panel.js 的 VERSION，更新 version.json + 生成 dist 下两个可直接导入的脚本
用法：
  1. 改完 panel.js，把顶部 VERSION 加一位（'3.8' -> '3.9'）
  2. python build.py
  3. git add -A && git commit -m "v3.9" && git tag v3.9 && git push --tags
"""
import json, re, sys, pathlib, datetime

ROOT = pathlib.Path(__file__).resolve().parent
PANEL = ROOT / "panel.js"
LOADER = ROOT / "boot.mjs"     # v2.0：玩家导入包内容是一行 import，入口为 ESM boot
VERSION_JSON = ROOT / "version.json"
DIST = ROOT / "dist"

LOADER_ID = "8f3c1d92-6b47-4a10-9c55-1d2e7f8a0b31"   # 引导脚本固定 id，勿改
PANEL_ID = "1604cbb8-ce4d-4974-8efb-1b6d186e37fb"    # 与 v3.8 手动版同 id

NOTES = "NTR 夺走体系 + next 修复；引导 v2.0：一行 import 双通道（fetch 快速通道 + import 兜底）"


def read(p):
    return p.read_text(encoding="utf-8")


def main():
    panel = read(PANEL)
    m = re.search(r"const\s+VERSION\s*=\s*['\"]([0-9.]+)['\"]", panel)
    if not m:
        sys.exit("✗ panel.js 里找不到 VERSION 常量")
    ver = m.group(1)
    semver = ver if ver.count(".") >= 2 else ver + ".0"

    # 1) version.json —— 引导脚本检查更新的入口
    meta = {
        "version": semver,
        "file": "panel.js",
        "notes": NOTES,
        "updated": datetime.date.today().isoformat(),
    }
    VERSION_JSON.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 2) dist/loader：玩家导入一次（v2.0 一行 import，与数据库插件同机制）
    loader = {
        "type": "script",
        "enabled": True,
        "name": "tw-card 自动更新引导 v2.0",
        "id": LOADER_ID,
        "content": "import 'https://gcore.jsdelivr.net/gh/FlusAyr/tw-panel@main/boot.mjs'",
        "info": "只装这一支。ESM 一行 import 引导：能 fetch 走快速通道（分钟级更新），"
                "被沙箱 CSP 拦截时自动降级 import 直连面板。更新后刷新页面即生效。"
                "快速回复栏的「面板设置」按钮可调整更新选项。",
        "button": {"enabled": True, "buttons": [
            {"name": "面板设置", "visible": True},
            {"name": "检查更新", "visible": True},
        ]},
        "data": {},
        "export_with": {"data": True, "button": True},
    }
    (DIST / "loader-script.json").write_text(
        json.dumps(loader, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 3) dist/panel：离线/手动导入用（不自动更新）
    panel_script = {
        "type": "script",
        "enabled": True,
        "name": "tw-card 状态面板 v" + ver,
        "id": PANEL_ID,
        "content": panel,
        "info": "v" + ver + " · tw-state 状态块渲染成 HUD 卡片。手动版：每次更新需重新导入，建议改用 loader-script。",
        "button": {"enabled": True, "buttons": []},
        "data": {},
        "export_with": {"data": True, "button": True},
    }
    (DIST / ("panel-script-v" + ver + ".json")).write_text(
        json.dumps(panel_script, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("✓ 版本      v%s" % ver)
    print("✓ version.json")
    print("✓ dist/loader-script.json")
    print("✓ dist/panel-script-v%s.json" % ver)
    print("\n发布：git add -A && git commit -m 'v%s' && git tag v%s && git push --tags" % (semver, semver))
    print("CDN：https://cdn.jsdelivr.net/gh/<user>/tw-panel@v%s/panel.js" % semver)
    print("注意：tag 名 = v + version.json 的 version，不要覆盖旧 tag")


if __name__ == "__main__":
    main()
