#!/usr/bin/env python3
"""Generate README image assets for dsh-permission-rules (docs/assets/).

Outputs (idempotent overwrite):
  dsh-permission-rules-flow-light.svg / dsh-permission-rules-flow-dark.svg
      Hero data-flow diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is command-surface tokens only
      (tools/pre-execute, .dsh/rules.yaml, permissionRules/decision, ...),
      so all five README languages share the same pair.

There is no benchmark data in this repository, so no evidence chart is
produced — do not invent one when adding a chart later.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (pip install pillow)
"""
from __future__ import annotations

import os
import sys

from PIL import ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
AMBER = {"light": "#bc4c00", "dark": "#d29922"}
RED = {"light": "#dc2626", "dark": "#f85149"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# --- CJK font probe: kept in the family script skeleton so a future ---------
# evidence chart cannot silently render Chinese as tofu boxes.
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


# ---------------------------------------------------------------------------
# Hero data-flow SVG (light + dark)
# ---------------------------------------------------------------------------
W, H = 1200, 440
NODE_H = 104
TOP_Y = 140
TOP = [
    # (width, label, sub, stroke, label_size)
    (130, "tool call", "arguments", None, 14),
    (145, "tools/pre-execute", "waterfall", FAMILY, 13),
    (145, ".dsh/rules.yaml", "first match wins", FAMILY, 12),
    (190, "allow · ask · deny", "next() · approval · reason", None, 12),
    (215, "permissionRules/decision", "audit · log-only", GREEN, 13),
    (135, "session log", "ignorable", None, 13),
]
GAP = 36


def top_row():
    x = (W - (sum(n[0] for n in TOP) + GAP * (len(TOP) - 1))) // 2
    boxes = []
    for index, (node_w, label, sub, accent, size) in enumerate(TOP):
        boxes.append((x, index, node_w, label, sub, accent, size))
        x += node_w + GAP
    return boxes


NET = [
    (220, "shell child", "spawned process"),
    (220, "HTTP/CONNECT proxy", "127.0.0.1 · proxyPort"),
    (230, "domains · ips · ports · schemes", "network rules or mode"),
    (200, "403 · upstream", "blocked | allowed"),
]
NET_Y = 296
NET_H = 84


def net_row():
    x = (W - (sum(n[0] for n in NET) + 56 * (len(NET) - 1))) // 2
    boxes = []
    for index, (node_w, label, sub) in enumerate(NET):
        boxes.append((x, index, node_w, label, sub))
        x += node_w + 56
    return boxes


def arrow(x1, y, x2, color):
    mid = (x1 + x2) // 2
    return [
        f'<path d="M{x1} {y}H{x2 - 10}" stroke="{color}" stroke-width="2.5"/>',
        f'<path d="M{x2 - 16} {y - 6}l7 6-7 6" fill="none" stroke="{color}" '
        f'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    ]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" '
        f'aria-label="dsh-permission-rules data flow">',
        '<title>dsh-permission-rules data flow</title>',
        f'<rect width="{W}" height="{H}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="56" y="60" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">'
        f'dsh-permission-rules</text>',
        f'<text x="56" y="94" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="15">tools/pre-execute · ordered allow / '
        f'deny / ask · YAML</text>',
        f'<line x1="56" y1="118" x2="1144" y2="118" stroke="{s["border"]}"/>',
    ]

    # top flow
    boxes = top_row()
    for x, index, node_w, label, sub, accent, size in boxes:
        stroke = accent or s["border"]
        parts.append(
            f'<rect x="{x}" y="{TOP_Y}" width="{node_w}" height="{NODE_H}" '
            f'rx="14" fill="{s["box"]}" stroke="{stroke}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + node_w // 2}" y="{TOP_Y + 40}" '
            f'fill="{s["text"]}" text-anchor="middle" '
            f'font-family="ui-monospace,monospace" font-size="{size}" '
            f'font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + node_w // 2}" y="{TOP_Y + 68}" '
            f'fill="{s["sub"]}" text-anchor="middle" '
            f'font-family="ui-monospace,monospace" font-size="10.5">'
            f'{sub}</text>')
        if index < len(boxes) - 1:
            parts += arrow(x + node_w + 9, TOP_Y + NODE_H // 2,
                           x + node_w + GAP - 4, s["sub"])
    # verdict colour dots on the verdict node
    vx, _, vw, *_ = boxes[3]
    for i, colour in enumerate((GREEN[skin], AMBER[skin], RED[skin])):
        parts.append(
            f'<circle cx="{vx + vw // 2 - 26 + i * 26}" cy="{TOP_Y + 84}" '
            f'r="4.5" fill="{colour}"/>')

    # network flow
    parts.append(
        f'<text x="56" y="{NET_Y - 18}" fill="{s["sub"]}" '
        f'font-family="ui-monospace,monospace" font-size="12">'
        f'network policy</text>')
    nboxes = net_row()
    for x, index, node_w, label, sub in nboxes:
        parts.append(
            f'<rect x="{x}" y="{NET_Y}" width="{node_w}" height="{NET_H}" '
            f'rx="12" fill="{s["box"]}" stroke="{s["border"]}" '
            f'stroke-width="1.5"/>')
        parts.append(
            f'<text x="{x + node_w // 2}" y="{NET_Y + 34}" '
            f'fill="{s["text"]}" text-anchor="middle" '
            f'font-family="ui-monospace,monospace" font-size="11.5" '
            f'font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + node_w // 2}" y="{NET_Y + 58}" '
            f'fill="{s["sub"]}" text-anchor="middle" '
            f'font-family="ui-monospace,monospace" font-size="10.5">'
            f'{sub}</text>')
        if index < len(nboxes) - 1:
            parts += arrow(x + node_w + 8, NET_Y + NET_H // 2,
                           x + node_w + 48, s["sub"])

    parts.append(
        f'<text x="56" y="{H - 22}" fill="{s["sub"]}" '
        f'font-family="ui-monospace,monospace" font-size="12">'
        f'builtin · searchUp · watch · enforce: false · /rules test · '
        f'/rules reload</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(
                OUT, f"dsh-permission-rules-flow-{skin}.svg"),
                "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    print("wrote 2 SVG assets to docs/assets/")


if __name__ == "__main__":
    main()
