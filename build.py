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
LOADER = ROOT / "boot.mjs"     # v2.1：玩家导入包内容是一行 import，入口为 ESM boot
VERSION_JSON = ROOT / "version.json"
DIST = ROOT / "dist"

LOADER_ID = "8f3c1d92-6b47-4a10-9c55-1d2e7f8a0b31"   # 引导脚本固定 id，勿改
PANEL_ID = "1604cbb8-ce4d-4974-8efb-1b6d186e37fb"    # 与 v3.8 手动版同 id

NOTES = ("拓展键前缀（kbnpc / ntrnpc 独立登记与主题）+ 版本一致性回归；引导 v2.1 不变")

# 玩家导入的那一行 import —— 全仓唯一出处，改托管/CDN 只动这个字面量。
# 两个 %s 依次是 REPO_SLUG（用户名/仓库名）与 semver（= tag 去掉 v）。
# 为什么钉 tag 而不是 @main：
#   jsDelivr 的 purge 只覆盖 Cloudflare(cdn) 与 Fastly，gcore 是独立镜像层、清不掉，
#   实测 purge 后 cdn 已是新版而 gcore 仍在发旧件（最长扛满 s-maxage=12h）。
#   分支引用的 URL 会被镜像各自缓存；钉 tag 的 URL 是全新条目，任何镜像都是缓存 MISS，
#   必须回源拿同一份字节 —— 同时解决「@main 可变」和「gcore 陈旧」两个问题。
IMPORT_URL = "https://gcore.jsdelivr.net/gh/%s@v%s/boot.mjs"
REPO_SLUG = "FlusAyr/tw-panel"


def read(p):
    return p.read_text(encoding="utf-8")


def main():
    # Windows 控制台默认 cp936，编不出 '✓' 会 UnicodeEncodeError 崩在 print 之前。
    # 这里把 stdout / stderr 都强制成 utf-8；errors="replace" 保证非 utf-8 终端
    # 降级成 '?' 也不会再崩。stderr 同样必须处理：sys.exit("✗ ...") 走 stderr，
    # 不重定向就会出现「报错信息自己报错」，真实原因被 UnicodeEncodeError 吞掉。
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")

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

    # 2) dist/loader：玩家导入一次（v2.1 一行 import，与数据库插件同机制）
    #    URL 钉 tag（@v<semver>）而不是 @main：@main 是分支引用，jsDelivr 缓存最长
    #    12 小时，发版后新导入的玩家可能仍装到旧引导；tag 不可变、发布即刻生效。
    #    所以这里必须排在 tag 推送之后才能换包（见 CHANGELOG / 发版 SOP）。
    #    版本号从 panel.js 的 VERSION 抓（上面 semver），不另写硬编码。
    loader = {
        "type": "script",
        "enabled": True,
        "name": "tw-card 自动更新引导 v2.1",
        "id": LOADER_ID,
        "content": "import '%s'" % (IMPORT_URL % (REPO_SLUG, semver)),
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
