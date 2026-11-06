#!/usr/bin/env python3
"""README visuals for dsh-permission-rules: hero banner + structure diagram.

Both figures are derived from this repo's code, not from the prose:

  * `tools/pre-execute` waterfall listener: the per-cwd rule chain is loaded
    (project `.dsh/rules.yaml` -> `searchUp` parents, nearest first ->
    `fallbackPath` -> the shipped built-in baseline APPENDED LAST), compiled,
    then evaluated in file order with first-match-wins across the `tools`,
    `agents`, `params`, `paths`, `argv`, `when` and `network` dimensions
    (src/rules.ts `matchRules`, src/runtime.ts chain resolution).
  * Three actions: `deny` claims the call with a model-visible reason, `ask`
    hands it to the official approval seam (fail closed when nobody answers),
    `allow` — and no match at all — delegate through `next()`, never
    short-circuiting the waterfall.
  * A second, process-level channel: shell children traverse the built-in
    local HTTP/CONNECT proxy, adjudicated by the same chain's network rules or
    by the mode (`auto` follows the sandbox preset, else `deny-all` /
    `whitelist` / `allow-all`); a blocked connection gets a structured 403,
    an allowed one connects to the ADJUDICATED address (no second DNS
    resolution), and upstream chaining exists for allowed connections only —
    never loopback or `ips`-scoped decisions (src/network.ts, src/proxy.ts).
  * Two log-only audit events: `permissionRules/decision` (every hit and every
    pass-through, with the final `outcome` and `dryRun` on `enforce: false`)
    and `permissionRules/network` (blocked connections); both are appended
    with `ignorable: true` and never injected into the model context
    (src/events.ts).

Hero: the rule ledger itself — the ordered rule list with the first match
highlighted, the verdict ticket that match produces, and the network strip of
the second channel. Deliberately NOT the pipeline; the pipeline is figure two.

Flow (docs/assets/…-flow-v5-*.svg): a dual-channel convergence — two entry
seams merge into one ordered rule chain, which forks into two verdict banks
(tool call / network egress) and closes on the two-event audit band. No row of
five boxes with arrows.

Fonts: Microsoft YaHei (msyh.ttc / msyhbd.ttc) for CJK, Consolas for mono.
Run:  python scripts/gen-readme-assets.py
"""
from __future__ import annotations

import os
from html import escape

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"
FONT_EN = r"C:\Windows\Fonts\segoeui.ttf"
FONT_EN_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"

for _p in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_MONO_BOLD,
           FONT_EN, FONT_EN_BOLD):
    if not os.path.exists(_p):
        raise SystemExit(f"FATAL: font missing: {_p}")

KIND = {
    "cjk": FONT_CJK,
    "cjk_bold": FONT_CJK_BOLD,
    "mono": FONT_MONO,
    "mono_bold": FONT_MONO_BOLD,
    "en": FONT_EN,
    "en_bold": FONT_EN_BOLD,
}

# Family palette: accent #4B67B4 (dark #8496f5), page gradients #f9f6fd→#e4eaf8
# and #131a2a→#0c1016. Radius 18–22, soft shadows.
SKIN = {
    "light": dict(
        bg_from="#f9f6fd", bg_to="#e4eaf8",
        card="#ffffff", card_edge="#e5e0f2",
        text="#17151f", sub="#4c5160", faint="#8a8fa2",
        accent="#4B67B4", pill="#ece7f9", grid="#ece8f5",
        allow="#24785f", ask="#a3681a", deny="#ad3a4e",
        shadow=(38, 30, 68),
    ),
    "dark": dict(
        bg_from="#131a2a", bg_to="#0c1016",
        card="#1b2231", card_edge="#2d364a",
        text="#eef2fa", sub="#a8b1c4", faint="#737d92",
        accent="#8496f5", pill="#242d42", grid="#242c3d",
        allow="#6fd3ac", ask="#e2ae57", deny="#f08a9c",
        shadow=(0, 0, 0),
    ),
}


# ── small colour / font helpers ─────────────────────────────────────────────

def font(size: int, kind: str = "cjk_bold") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(KIND[kind], int(size))


def hx(value) -> tuple:
    if isinstance(value, tuple):
        return value[:3]
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def blend(a, b, t: float):
    """Paint colour a over base b at t (t = how much of a survives)."""
    pa, pb = hx(a), hx(b)
    return tuple(int(y * (1 - t) + x * t) for x, y in zip(pa, pb))


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    a, b = hx(c1), hx(c2)
    for y in range(h):
        t = 0.30 * (y / h) + 0.70 * (y / h) ** 1.7
        d.line([(0, y), (w, y)],
               fill=tuple(int(p + (q - p) * t) for p, q in zip(a, b)))
    return img


def glow(img: Image.Image, cx: int, cy: int, r: int, color, alpha: int):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(12, 0, -1):
        rr = r * i / 12
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color + (int(alpha * (1 - i / 13)),))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def soft_card(img: Image.Image, box, skin, radius=20, lift=12, strength=1.0,
              outline=None, width=2) -> Image.Image:
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([x0 + 2, y0 + lift, x1 + 2, y1 + lift + 4],
                         radius=radius,
                         fill=hx(skin["shadow"]) + (int(38 * strength),))
    base = Image.alpha_composite(img.convert("RGBA"),
                                 sh.filter(ImageFilter.GaussianBlur(16)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=hx(skin["card"]),
                        outline=hx(outline or skin["card_edge"]), width=width)
    return base.convert("RGB")


def text_h(f: ImageFont.FreeTypeFont) -> int:
    a, dsc = f.getmetrics()
    return a + dsc


def rule_glyph(img: Image.Image, x: float, y: float, color):
    """Tiny ordered-list glyph in the kicker pill: three rule rows."""
    d = ImageDraw.Draw(img)
    c = hx(color)
    for i, w in enumerate((16, 16, 10)):
        d.rounded_rectangle([x, y + i * 5.5, x + w, y + i * 5.5 + 2.6],
                            radius=1.3, fill=c)


def fit(d: ImageDraw.ImageDraw, text: str, maxw: float, start: int,
        kind: str, floor: int) -> ImageFont.FreeTypeFont:
    size = start
    while size > floor:
        f = font(size, kind)
        if d.textlength(text, font=f) <= maxw:
            return f
        size -= 1
    return font(floor, kind)


# ── hero ────────────────────────────────────────────────────────────────────

ROWS = [
    dict(idx="01", match="bash · git push* · **/secrets/**", action="deny"),
    dict(idx="02", match="edit, write", action="ask"),
    dict(idx="03", match="mcp__*", action="allow"),
    dict(idx="04", pre="builtin", match=" · rm -rf /", action="deny"),
]

NET_RIGHT = ["127.0.0.1 · proxyPort", "HTTP · CONNECT", "loopback bind"]

HERO = {
    "zh": dict(
        kicker="DeepSeek Harness · 权限规则中间件",
        eyebrow="dsh-permission-rules",
        title="规则即裁决",
        value=["每条裁决都写在 YAML 里，", "没把握的，交给审批接缝。"],
        sub="首个匹配胜出 · 每条裁决都可审计",
        meta="16 条内置基线 · 热重载 · 试运行 · 代理",
        foot="Apache-2.0 · github.com/PerryLink/dsh-permission-rules",
        chain_head="有序规则链",
        chain_note="first match wins",
        chain_path=".dsh/rules.yaml → searchUp → fallbackPath → builtin",
        chain_foot="首个匹配即停 · 后续规则不再求值",
        ticket_label="裁决",
        reason=["禁止 push 到", "受保护路径"],
        ticket_rule="rule 01 · matched",
        ticket_foot="reason → 工具结果",
        net_label="进程级网络 · 同一份规则链",
        net_lines=[
            "shell child → 本地代理 → domains · ips · ports · schemes",
            "deny → 结构化 403 · allow → 直达裁决地址",
            "上游链式：仅放行连接",
        ],
    ),
    "en": dict(
        kicker="DeepSeek Harness · permission rules",
        eyebrow="dsh-permission-rules",
        title="Rules decide.",
        value=["Every verdict lives in YAML,", "uncertain calls go to approval."],
        sub="first match wins · every decision audited",
        meta="16 builtin rules · hot reload · dry-run · proxy",
        foot="Apache-2.0 · github.com/PerryLink/dsh-permission-rules",
        chain_head="ordered rule chain",
        chain_note="first match wins",
        chain_path=".dsh/rules.yaml → searchUp → fallbackPath → builtin",
        chain_foot="first match stops the scan · later rules unused",
        ticket_label="verdict",
        reason=["No pushes from", "protected paths"],
        ticket_rule="rule 01 · matched",
        ticket_foot="reason → tool result",
        net_label="process-level network · same chain",
        net_lines=[
            "shell child → local proxy → domains · ips · ports · schemes",
            "deny → structured 403 · allow → adjudicated address",
            "upstream chaining: allowed connections only",
        ],
    ),
}

W, H = 1440, 576
COL_X, COL_W = 72, 520


def hero(lang: str, skin: str) -> None:
    s = SKIN[skin]
    Hd = HERO[lang]
    zh = lang == "zh"
    light = skin == "light"

    img = gradient(W, H, s["bg_from"], s["bg_to"])
    img = glow(img, 1200, 70, 420, hx(s["accent"]), 26 if light else 44)
    img = glow(img, 250, 610, 320, hx(s["deny"]), 7 if light else 12)
    d = ImageDraw.Draw(img)

    # ── left column: kicker / eyebrow / title / value / sub / meta / footer ─
    fk = font(18, "cjk_bold" if zh else "en_bold")
    kw = d.textlength(Hd["kicker"], font=fk)
    pill_x, pill_y, pill_h = COL_X, 58, 38
    d.rounded_rectangle([pill_x, pill_y, pill_x + kw + 64, pill_y + pill_h],
                        radius=pill_h // 2, fill=hx(s["pill"]))
    rule_glyph(img, pill_x + 18, pill_y + 11, s["accent"])
    d = ImageDraw.Draw(img)
    d.text((pill_x + 44, pill_y + 8), Hd["kicker"], font=fk,
           fill=hx(s["accent"]))

    d.text((COL_X, 112), Hd["eyebrow"], font=font(26, "mono"),
           fill=hx(s["accent"]))

    f_title = fit(d, Hd["title"], COL_W, 88,
                  "cjk_bold" if zh else "en_bold", floor=80)
    assert f_title.size >= 80, (lang, f_title.size)
    d.text((COL_X, 152), Hd["title"], font=f_title, fill=hx(s["text"]))

    y = 270
    for line in Hd["value"]:
        f_v = fit(d, line, COL_W, 34,
                  "cjk_bold" if zh else "en_bold", floor=29)
        d.text((COL_X, y), line, font=f_v, fill=hx(s["text"]))
        y += 42

    f_sub = fit(d, Hd["sub"], COL_W, 27, "cjk" if zh else "en", floor=24)
    d.text((COL_X, 368), Hd["sub"], font=f_sub, fill=hx(s["sub"]))
    f_meta = fit(d, Hd["meta"], COL_W, 22, "cjk" if zh else "en", floor=20)
    d.text((COL_X, 410), Hd["meta"], font=f_meta, fill=hx(s["faint"]))
    d.line([COL_X, 448, COL_X + COL_W, 448], fill=hx(s["grid"]), width=2)
    f_foot = font(17, "mono")
    assert d.textlength(Hd["foot"], font=f_foot) <= COL_W
    d.text((COL_X, 462), Hd["foot"], font=f_foot, fill=hx(s["faint"]))

    # ── right: the ordered rule ledger ─────────────────────────────────────
    img = soft_card(img, (628, 64, 1096, 384), s, radius=20, lift=12)
    d = ImageDraw.Draw(img)
    d.text((652, 82), Hd["chain_head"],
           font=font(19, "cjk_bold" if zh else "en_bold"), fill=hx(s["text"]))
    d.text((1072, 86), Hd["chain_note"], font=font(15, "mono"),
           fill=hx(s["accent"]), anchor="ra")
    d.text((652, 112), Hd["chain_path"], font=font(14, "mono"),
           fill=hx(s["faint"]))
    d.line([652, 134, 1072, 134], fill=hx(s["grid"]), width=2)

    for i, row in enumerate(ROWS):
        top = 142 + i * 50
        if i:
            d.line([652, top, 1072, top], fill=hx(s["grid"]), width=1)
        if i == 0:
            d.rounded_rectangle([640, top + 3, 1084, top + 47], radius=12,
                                fill=blend(s["deny"], s["card"],
                                           0.08 if light else 0.15))
            d.rounded_rectangle([640, top + 11, 645, top + 41], radius=2,
                                fill=hx(s["deny"]))
        d.text((660, top + 15), row["idx"], font=font(15, "mono"),
               fill=hx(s["deny"] if i == 0 else s["faint"]))
        x = 686
        if "pre" in row:
            f_pre = font(16, "mono")
            d.text((x, top + 14), row["pre"], font=f_pre, fill=hx(s["accent"]))
            x += d.textlength(row["pre"], font=f_pre)
        f_row = font(16, "mono")
        d.text((x, top + 14), row["match"], font=f_row, fill=hx(s["text"]))
        assert x + d.textlength(row["match"], font=f_row) <= 998, row["match"]

        col = s[row["action"]]
        cx0, cx1 = 1010, 1072
        cy0, cy1 = top + 12, top + 38
        d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=13,
                            fill=blend(col, s["card"], 0.13 if light else 0.18))
        f_chip = font(15, "mono_bold")
        tw = d.textlength(row["action"], font=f_chip)
        d.text((cx0 + (cx1 - cx0 - tw) / 2,
                cy0 + ((cy1 - cy0) - text_h(f_chip)) / 2),
               row["action"], font=f_chip, fill=hx(col))

    d.line([652, 342, 1072, 342], fill=hx(s["grid"]), width=2)
    f_cf = fit(d, Hd["chain_foot"], 420, 15, "cjk" if zh else "en", floor=14)
    d.text((652, 350), Hd["chain_foot"], font=f_cf, fill=hx(s["faint"]))

    # ── right: the verdict ticket ─────────────────────────────────────────
    img = soft_card(img, (1112, 64, 1368, 384), s, radius=20, lift=12,
                    outline=blend(s["deny"], s["card"],
                                  0.34 if light else 0.40), width=2)
    d = ImageDraw.Draw(img)
    d.text((1136, 82), Hd["ticket_label"],
           font=font(16, "cjk_bold" if zh else "en_bold"), fill=hx(s["sub"]))
    d.text((1130, 104), "deny", font=font(60, "mono_bold"), fill=hx(s["deny"]))
    ry = 192
    for line in Hd["reason"]:
        d.text((1136, ry), line, font=font(17, "cjk" if zh else "en"),
               fill=hx(s["sub"]))
        ry += 24
    d.line([1136, 246, 1344, 246], fill=hx(s["grid"]), width=2)
    d.text((1136, 258), ".dsh/rules.yaml", font=font(14, "mono"),
           fill=hx(s["faint"]))
    d.text((1136, 280), Hd["ticket_rule"], font=font(14, "mono"),
           fill=hx(s["faint"]))
    d.rounded_rectangle([1136, 306, 1344, 344], radius=19,
                        fill=blend(s["deny"], s["card"],
                                   0.12 if light else 0.17))
    f_tf = font(14, "cjk_bold" if zh else "en_bold")
    tw = d.textlength(Hd["ticket_foot"], font=f_tf)
    d.text((1136 + (208 - tw) / 2, 316), Hd["ticket_foot"], font=f_tf,
           fill=hx(s["deny"]))

    # ── right: the network channel strip ──────────────────────────────────
    img = soft_card(img, (628, 398, 1368, 512), s, radius=18, lift=10,
                    strength=0.8)
    d = ImageDraw.Draw(img)
    d.text((652, 412), Hd["net_label"],
           font=font(17, "cjk_bold" if zh else "en_bold"), fill=hx(s["text"]))
    for i, line in enumerate(Hd["net_lines"]):
        f_net = font(15, "cjk" if zh else "mono")
        assert d.textlength(line, font=f_net) <= 540, line
        d.text((652, 436 + i * 24), line, font=f_net, fill=hx(s["sub"]))
    for i, line in enumerate(NET_RIGHT):
        d.text((1344, 436 + i * 24), line, font=font(14, "mono"),
               fill=hx(s["faint"]), anchor="ra")

    # audit line
    d.text((628, 530),
           "permissionRules/decision · permissionRules/network → session log",
           font=font(15, "mono"), fill=hx(s["faint"]))
    d.text((1368, 530), "log-only · ignorable", font=font(15, "mono"),
           fill=hx(s["faint"]), anchor="ra")

    path = os.path.join(OUT, f"dsh-permission-rules-hero-{lang}-{skin}.webp")
    img.save(path, "WEBP", quality=92, method=6)
    print(f"wrote {os.path.relpath(path, ROOT)}")


# ── flow diagram (hand-written SVG) ─────────────────────────────────────────

SANS = "Segoe UI, Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif"
MONO = "Consolas, SFMono-Regular, Menlo, monospace"


def flow_svg(skin: str) -> None:
    s = SKIN[skin]
    Wd, Ht = 1100, 660
    light = skin == "light"
    shadow_op = "0.14" if light else "0.50"
    e = []

    def add(x):
        e.append(x)

    def tint(c, t):
        return "#%02x%02x%02x" % blend(c, s["card"], t)

    def txt(x, y, body, size=15, color=None, weight="400", mono=False,
            anchor="start"):
        fam = MONO if mono else SANS
        add(f'<text x="{x}" y="{y}" fill="{color or s["text"]}" '
            f'font-family="{fam}" font-size="{size}" font-weight="{weight}" '
            f'text-anchor="{anchor}">{escape(body)}</text>')

    def rect(x, y, w, h, r=16, fill=None, stroke=None, sw=1.5, shadow=False):
        g = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" '
             f'fill="{fill or s["card"]}"')
        if stroke:
            g += f' stroke="{stroke}" stroke-width="{sw}"'
        g += "/>"
        add(f'<g filter="url(#soft)">{g}</g>' if shadow else g)

    def line(x1, y1, x2, y2, stroke, w=2, dash=None, marker=None):
        g = (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
             f'stroke="{stroke}" stroke-width="{w}" stroke-linecap="round"')
        if dash:
            g += f' stroke-dasharray="{dash}"'
        if marker:
            g += f' marker-end="url(#{marker})"'
        add(g + "/>")

    def path(d, stroke, w=2, marker=None):
        g = (f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{w}" '
             f'stroke-linecap="round" stroke-linejoin="round"')
        if marker:
            g += f' marker-end="url(#{marker})"'
        add(g + "/>")

    add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{Wd}" height="{Ht}" '
        f'viewBox="0 0 {Wd} {Ht}" role="img" aria-labelledby="fig-title">')
    add('<title id="fig-title">dsh-permission-rules — dual-channel '
        'adjudication: tool calls and shell egress converge on one ordered '
        'rule chain, fork into two verdict banks, and close on two log-only '
        'audit events</title>')
    add("<defs>")
    add('<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{s["bg_from"]}"/>'
        f'<stop offset="1" stop-color="{s["bg_to"]}"/></linearGradient>')
    add(f'<filter id="soft" x="-30%" y="-30%" width="170%" height="185%">'
        f'<feDropShadow dx="0" dy="8" stdDeviation="11" flood-color="#1b1735" '
        f'flood-opacity="{shadow_op}"/></filter>')
    add('<marker id="arr" viewBox="0 0 10 10" refX="8.5" refY="5" '
        f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0.5 0.5 L9.5 5 L0.5 9.5 z" fill="{s["accent"]}"/></marker>')
    add("</defs>")
    add(f'<rect width="{Wd}" height="{Ht}" fill="url(#bg)"/>')
    add(f'<circle cx="1000" cy="80" r="230" fill="{s["accent"]}" '
        f'opacity="{0.05 if light else 0.10}"/>')

    # ── header ────────────────────────────────────────────────────────────
    txt(44, 52, "dsh-permission-rules · dual-channel adjudication", 23,
        s["text"], "700")
    txt(44, 80, "tool calls and shell egress → one ordered rule chain → "
        "two log-only audit events", 15, s["sub"])
    txt(1056, 50, "src/runtime.ts · src/rules.ts · src/proxy.ts", 14,
        s["faint"], mono=True, anchor="end")
    txt(1056, 74, "first match wins · enforce: false = dry-run", 14,
        s["accent"], mono=True, anchor="end")
    line(44, 96, 1056, 96, s["grid"], 1.5)

    # ── entry channel A: tool calls ──────────────────────────────────────
    rect(44, 110, 196, 96, 16, s["card"], s["card_edge"], shadow=True)
    txt(64, 138, "tool call", 17, s["text"], "600")
    txt(64, 162, "name · params", 14, s["sub"], mono=True)
    txt(64, 184, "cwd · agent · env", 14, s["sub"], mono=True)

    # ── entry channel B: shell children ──────────────────────────────────
    rect(44, 330, 196, 96, 16, s["card"], s["card_edge"], shadow=True)
    txt(64, 358, "shell child", 17, s["text"], "600")
    txt(64, 382, "bash / pwsh", 14, s["sub"], mono=True)
    txt(64, 404, "HTTP · CONNECT", 14, s["sub"], mono=True)

    # seam chips
    rect(254, 132, 104, 54, 14, tint(s["accent"], 0.08),
         tint(s["accent"], 0.32), 1.2)
    txt(306, 155, "waterfall", 14, s["faint"], mono=True, anchor="middle")
    txt(306, 177, "pre-execute", 14, s["accent"], "700", mono=True,
        anchor="middle")
    rect(254, 352, 104, 54, 14, tint(s["accent"], 0.08),
         tint(s["accent"], 0.32), 1.2)
    txt(306, 375, "local proxy", 14, s["faint"], mono=True, anchor="middle")
    txt(306, 397, "CONNECT", 14, s["accent"], "700", mono=True,
        anchor="middle")

    # lanes into the convergence bus
    line(240, 158, 250, 158, s["accent"], 2, marker="arr")
    line(240, 378, 250, 378, s["accent"], 2, marker="arr")
    path("M 358 158 H 364 M 358 378 H 364 M 364 158 V 378", s["accent"], 2)
    line(364, 280, 376, 280, s["accent"], 2.4, marker="arr")

    # ── the ordered rule chain ───────────────────────────────────────────
    rect(376, 100, 348, 420, 18, s["card"], tint(s["accent"], 0.35), 1.6)
    txt(396, 132, "ordered rule chain", 18, s["text"], "700")
    txt(704, 132, "first match wins", 14, s["accent"], mono=True, anchor="end")
    line(396, 146, 704, 146, s["grid"], 1.5)

    txt(396, 170, ".dsh/rules.yaml · searchUp", 14, s["sub"], mono=True)
    txt(396, 192, "nearest file first · fallbackPath", 14, s["sub"], mono=True)
    txt(396, 214, "builtin 16 rules", 14, s["accent"], mono=True)
    txt(704, 214, "appended last", 14, s["faint"], mono=True, anchor="end")
    line(396, 228, 704, 228, s["grid"], 1.5)

    rules = [
        dict(match="bash · git push*", sub="paths **/secrets/**",
             action="deny"),
        dict(match="edit, write", sub="tools glob", action="ask"),
        dict(match="mcp__*", sub="tools glob · namespaced", action="allow"),
        dict(match="rm -rf /", sub="argv · builtin", action="deny"),
    ]
    for i, row in enumerate(rules):
        top = 236 + i * 46
        if i == 0:
            rect(388, top + 4, 328, 42, 12, tint(s["deny"], 0.08))
        col = s[row["action"]]
        txt(396, top + 20, f"{i + 1:02d}", 14,
            s["deny"] if i == 0 else s["faint"], mono=True)
        txt(420, top + 19, row["match"], 15, s["text"],
            "700" if i == 0 else "400", mono=True)
        txt(420, top + 37, row["sub"], 14, s["faint"], mono=True)
        rect(644, top + 10, 60, 26, 13, tint(col, 0.14))
        txt(674, top + 28, row["action"], 14, col, "700", mono=True,
            anchor="middle")

    txt(396, 440, "later rules are not evaluated", 14, s["accent"], mono=True)
    txt(396, 464, "match dimensions", 14, s["faint"], mono=True)
    txt(396, 486, "tools · agents · params · paths", 14, s["sub"], mono=True)
    txt(396, 508, "argv · when · network", 14, s["sub"], mono=True)

    # ── verdict bank A: tool call ────────────────────────────────────────
    rect(752, 110, 312, 182, 16, s["card"], s["card_edge"], shadow=True)
    txt(772, 134, "tool call verdicts", 15, s["text"], "700")
    txt(1044, 134, "3 verdicts", 14, s["faint"], mono=True, anchor="end")
    rows_a = [
        ("allow", "→ next()", "delegates · never short-circuits", 144),
        ("ask", "→ approval seam", "auto-review or human · fail closed", 192),
        ("deny", "→ reason", "reason becomes the tool error", 240),
    ]
    for action, target, note, top in rows_a:
        col = s[action]
        txt(772, top + 22, action, 15, col, "700", mono=True)
        aw = {"allow": 44, "ask": 27, "deny": 36}[action]
        txt(772 + aw + 10, top + 22, target, 14, s["sub"], mono=True)
        txt(772, top + 42, note, 14, s["sub"])

    # ── verdict bank B: network egress ───────────────────────────────────
    rect(752, 326, 312, 182, 16, s["card"], s["card_edge"], shadow=True)
    txt(772, 350, "network egress", 15, s["text"], "700")
    txt(1044, 350, "proxy", 14, s["faint"], mono=True, anchor="end")
    rows_b = [
        ("allow", "→ connect(adjudicated)", "no second DNS resolution", 360),
        ("deny", "→ structured 403", "never reaches upstream", 408),
        ("upstream", "→ allowed only", "loopback / ips-scoped never chained",
         456),
    ]
    for action, target, note, top in rows_b:
        col = s["accent"] if action == "upstream" else s[action]
        txt(772, top + 22, action, 15, col, "700", mono=True)
        aw = {"allow": 44, "deny": 36, "upstream": 68}[action]
        txt(772 + aw + 10, top + 22, target, 14, s["sub"], mono=True)
        txt(772, top + 42, note, 14, s["sub"])

    # ── outbound fork ───────────────────────────────────────────────────
    line(728, 280, 740, 280, s["accent"], 2)
    path("M 740 201 V 417", s["accent"], 2)
    line(740, 201, 752, 201, s["accent"], 2, marker="arr")
    line(740, 417, 752, 417, s["accent"], 2, marker="arr")

    # ── audit band ──────────────────────────────────────────────────────
    rect(44, 544, 1020, 66, 16, s["card"], s["card_edge"], shadow=True)
    txt(64, 570, "permissionRules/decision", 15, s["accent"], "700", mono=True)
    txt(280, 570, "tool · action · outcome · dryRun", 14, s["sub"], mono=True)
    txt(1044, 570, "log-only · never in model context", 14, s["deny"], "700",
        anchor="end")
    txt(64, 594, "permissionRules/network", 15, s["accent"], "700", mono=True)
    txt(280, 594, "domain · port · mode · action", 14, s["sub"], mono=True)
    txt(1044, 594, "ignorable · session log", 14, s["faint"], mono=True,
        anchor="end")

    txt(44, 640, "Apache-2.0 · PerryLink DSH plugin family · "
        "first match wins · fail closed", 14, s["faint"], mono=True)

    add("</svg>")
    path_out = os.path.join(OUT, f"dsh-permission-rules-flow-v5-{skin}.svg")
    with open(path_out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(e) + "\n")
    print(f"wrote {os.path.relpath(path_out, ROOT)}")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        for lang in ("zh", "en"):
            hero(lang, skin)
        flow_svg(skin)


if __name__ == "__main__":
    main()
