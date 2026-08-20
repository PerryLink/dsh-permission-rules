<div align="center">

# 🛡️ dsh-permission-rules

**DeepSeek Harness 的 Claude Code 风格声明式权限规则。**

*规则裁决已知的。评审模型裁决未知的。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-permission-rules/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-permission-rules?label=version)](https://github.com/PerryLink/dsh-permission-rules/releases)
[![npm version](https://img.shields.io/npm/v/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)
[![npm downloads](https://img.shields.io/npm/dm/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.5`–`0.1.0-rc.7` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | 全部（host + Web 设置客户端） |
| Model | 任意（deny/ask 原因经工具结果呈现） |

## What you get

`dsh-permission-rules` 在 `tools/pre-execute` waterfall 上为每次工具调用前置一个有序的 **`allow` / `deny` / `ask`** 规则列表——确定、即时、可审计，由你用纯 YAML 编写：

- **`deny`** 阻断调用；规则的 `reason` 成为模型可见的错误。
- **`ask`** 走官方审批接缝（挂载 `dsh-auto-review` 用第二模型作答，或由人作答；两者皆无时 harness 失败关闭）。
- **`allow`**（及未命中）严格经 `next()` 委托——下游监听器绝不会被短路。

每次命中**和**每次透传都作为 `permissionRules/decision` 会话事件审计落盘（仅日志——不会向模型上下文额外注入任何内容）。

- **丰富匹配** —— 工具名 glob（含 `mcp__*`）、agent 身份选择器（`main` / `subagent` / `preset:*`）、参数键/值 glob **或** 正则（含 `!pattern` 取反与 `absent` 键维度）、**任意嵌套深度**的工作区相对路径 glob，以及 `when` 宿主条件（环境变量、平台）。
- **分层规则文件** —— 可选 `searchUp` 从会话 cwd 到文件系统根合并每个 `.dsh/rules.yaml`，就近优先。
- **试运行上线** —— `enforce: false` 审计策略*会*做什么，同时放行每个调用。
- **热重载** —— Chokidar 监听带去抖；损坏的编辑保留旧规则、绝不崩溃。
- **失败大声** —— 非法 YAML、未知 action/字段、坏 glob/正则、易回溯模式或超过 `maxRules` 的规则在加载期失败。

## Rule syntax

```yaml
# <project>/.dsh/rules.yaml
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "No pushes from protected paths"

  - match: { tools: [edit, write] }
    action: ask
    reason: "File writes need confirmation"
```

- **匹配维度** —— `tools`（glob，含 `mcp__*`）、`agents`（`main` / `subagent` / `preset:<name>`；未知身份永不匹配——失败关闭）、`params`（键/值 glob 或正则，`!pattern` 取反，`absent` 键维度）、`paths`（任意嵌套深度抽取的工作区相对 glob）、`when`（`env` 变量 glob/正则 + 封闭 `platform` 列表），以及 `network`（`domains` / `ips` / `ports` / `schemes`——glob、通配符、CIDR、端口范围）。
- **动作** —— `allow` / `deny` / `ask`，按文件顺序求值，首个命中胜出。
- **规则元数据** —— `enabled: false`（可见但失效）、`description`、`tags`；未知字段加载失败。
- **Schema** —— JSON Schema 见 [docs/rules-format.schema.json](docs/rules-format.schema.json)（编辑器补全 `# yaml-language-server: $schema=...`）；完整词汇表与 5 条安全基线见 [docs/rules-format.en.md](docs/rules-format.en.md)。

## Network policy

Codex 风格的**进程级网络策略**：shell 子进程流量经内置本地 **HTTP/CONNECT 代理**，每个连接由有序网络规则或映射到官方沙箱预设的三档模式裁决：

- **`deny-all`** —— 只读沙箱预设：阻断所有出站。
- **`whitelist`** —— workspace-write 预设：放行列表目标，其余按 `unlisted: ask`（或 `deny`）。
- **`allow-all`** —— danger-full-access 预设：放行一切。
- **`auto`**（默认）—— 跟随沙箱预设；无沙箱策略服务的宿主上解析为 `autoFallback`（`allow-all`）。

- **匹配** —— `match.network` 用 `domains` / `ips` / `ports` / `schemes`（glob、通配符、CIDR、端口范围；数值型 YAML 端口可接受）。`tools/pre-execute` 热路径上的 URL 候选抽取作用于 web 工具参数与嵌入 bash/pwsh 命令文本的 URL；回环目标可按 `loopback` 策略短路规则。
- **审计** —— 被拒连接向所属会话追加 `permissionRules/network`（同样的自适应 `ignorable` 门），块计数器与近期拦截在 `/rules network` 与设置页展示。

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-permission-rules

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: permission-rules'
```

## Install & uninstall

- **git channel**（最新 `main`）：`dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"` —— `prepare` 脚本仅用生产依赖构建。
- **npm channel**（发布版本）：`dsh plugin --profile web add dsh-permission-rules`。
- **tarball channel**：在本仓库执行 `pnpm pack`，然后 `dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz`。
- **uninstall**：`dsh plugin --profile web remove dsh-permission-rules`。

## Configuration

所有可调项均为 Schemastery `Config` 字段（可在 cordis.yml 中修改）。按 id 覆盖会整行替换——重述你需要的每个键。

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | 规则文件位置；相对 = 相对调用会话 cwd 解析，绝对 = 全局并在挂载时校验 |
| `fallbackPath` | *(none)* | 按 cwd 发现无果时使用的规则文件；挂载时校验 |
| `badFilePolicy` | `fail` | 坏规则文件：`fail` 响亮地令待处理工具调用出错；`ignore-with-warning` 警告并空继续 |
| `maxRules` | `256` | 生效源链上规则总数的硬上限 |
| `maxCachedWorkspaces` | `512` | 缓存的工作区规则加载硬上限（LRU 逐出） |
| `patternMode` | `glob` | `params`/`paths`/`when.env` 模式风格：`glob` 或 `regex`（工具名始终为 glob） |
| `watch` | `true` | Chokidar 监听 + 变更重载 |
| `watchStabilityThresholdMs` | `200` | 重载去抖窗口（毫秒） |
| `language` | `en` | `/rules` 输出语言：`en`、`zh`、`es`、`pt`、`hi` |
| `caseInsensitivePaths` | *(win32)* | `paths` 模式与工作区根比较忽略 ASCII 大小写；Windows 上为 `true` |
| `audit` | `all` | 审计粒度：`all` 记录每次命中与透传；`hits` 跳过透传事件 |
| `searchUp` | `false` | 从会话 cwd 向上遍历父目录并合并每个找到的规则文件，就近优先 |
| `maxGlobStars` | `2` | 每个 glob 模式无界 `*`/`**` 量词的硬上限 |
| `enforce` | `true` | `false` = 试运行：deny/ask 命中带 `dryRun` 标记审计，每个调用都透传 |
| `allowUnmarkedAudit` | `false` | 前标记宿主丢弃 `ignorable` 标记；插件以一次性警告禁用会话日志审计。设 `true` 重新启用 |
| `network.enabled` | `true` | 代理、环境注入与 web 工具模式默认的总开关 |
| `network.mode` | `auto` | 策略模式：`auto` 跟随沙箱预设，或 `deny-all` / `whitelist` / `allow-all` |
| `network.autoFallback` | `allow-all` | `auto` 无沙箱策略服务时使用的模式 |
| `network.unlisted` | `ask` | 白名单模式下未命中规则目标：`ask` 或 `deny` |
| `network.proxyBind` | `127.0.0.1` | 本地代理绑定地址（仅回环） |
| `network.proxyPort` | `0` | 本地代理端口；`0` 选空闲临时端口 |
| `network.proxyMaxRecent` | `100` | 设置页保留的近期拦截记录上限 |
| `network.loopback` | `allow` | 回环目标：`allow`（Codex 对齐）或 `policy` |
| `network.injectEnv` | `true` | 是否为子进程注入代理环境变量 |
| `network.noProxy` | `clear` | 子进程 NO_PROXY 处理：`clear` 强制策略或 `preserve` |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `tools/pre-execute` | listener | 首个匹配的 allow/deny/ask 规则 + 网络 URL 候选抽取 |
| `/rules` | command | `list` · `reload` · `decisions [n]` · `test <tool> <json>` |
| `permissionRules/decision` | event | 每次命中与透传的仅日志审计 |
| `permissionRules/network` | event | 被拒连接的代理层审计 |
| HTTP/CONNECT proxy | service | 治理 shell 子进程流量的内置本地代理 |
| settings page | client | 网络模式编辑器、规则编辑器、块计数器、近期拦截 |

```
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call
```

`/rules test` 也接受前置标志：`--cwd <dir>`、`--env KEY=VALUE`（可重复）、`--agent <selector>`（可重复）与 `--platform <name>`。在多文件链（如 `searchUp`）中，每条列出的规则行都归属到其自身源文件。

## Permissions & data

- **Permissions**：workshop 清单声明 `files:read`、`files:watch`、`files:write`、`session:append` 与 `network:outbound`。`ask` 决策走官方审批接缝——不重实现、不绕过。
- **Data**：规则文件从磁盘读取；不写任何规则数据。无模型调用、无评审子代理。
- **Session log**：`permissionRules/decision` 绝不注入模型上下文，并以信封的 `ignorable: true` 标记追加，任何 harness 构建都能加载日志。

## Security boundaries

- **是策略，不是内核。** `paths` 候选只来自一组文档化的参数键（任意嵌套深度、有深度上限），且仅工作区相对路径匹配。
- **这里没有评审者。** 插件绝不生成子代理或调用模型——产出 `ask` 决策就是其工作的终点。
- **不改沙箱。** OS 级沙箱策略属于沙箱接缝，与本插件无关。
- **响亮地拒绝错误配置。** 未知 YAML 字段、未知 action 与坏模式在加载期被拒绝。
- **回溯界限。** glob 模式以 `maxGlobStars` 限制无界星号展开；正则模式拒绝嵌套无界量词与量化重叠字面交替。

## Known limitations

- **前标记宿主上的审计标记。** `permissionRules/decision` 以 `ignorable: true` 追加；`Session.append` 早于该标记的宿主（`0.1.0-rc.6` 线）静默丢弃它，因此运行时以一次性警告禁用会话日志审计。设 `allowUnmarkedAudit: true` 重新启用；用 `scripts/repair-session-logs.mjs` 修复已写日志。
- **路径候选是启发式的。** 只有文档化的参数键参与路径匹配，且工作区相对匹配仅在 `caseInsensitivePaths` 开启时忽略 ASCII 大小写。
- **glob 是保守子集。** 无花括号展开——写两个模式，或用正则模式。
- **正则回溯守卫是结构性的、非穷尽的。** 对不可信文件优先用 glob 模式。

## Collaborating with dsh-auto-review

- `dsh-permission-rules` 产出 `ask`；`dsh-auto-review` 在 `approval/request` waterfall 上以只读第二模型裁决作答（或委托给人）。两者都挂载即得完整闭环。
- 集成测试：`permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`，评审者以脚本化 mock 替换。
- 官方 harness 的 `never` 审批策略与每个失败关闭保证保持不变。

## Session log repair

在 `ignorable` 标记出现之前写入的会话日志可能被较新 harness 构建拒绝（`SessionFormatUnsupportedError`）。随附的 `scripts/repair-session-logs.mjs` 仅重写目标审计行以携带 `ignorable: true`，保帧、带备份：

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # 报告外来行，不改任何内容
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` 默认 `$DSH_HOME/sessions`（或 `~/.dsh/sessions`）。

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 139 tests, 9 suites
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # five-language README sync gate (also in CI)
```

无头端到端验证记录见 [VERIFICATION.md](VERIFICATION.md)。

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## Contributors

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：规则词汇与求值、运行时、HMR 监听、会话日志审计、网络策略 + 代理，以及五语文档。
- [@22xuan](https://github.com/22xuan) —— 关于 rc.6 宿主静默丢弃审计事件 `ignorable` 标记的详细报告（[#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)）与上游 harness 讨论；v0.4.1 的运行时宿主能力检测与文档更正直接源自该分析。

## PerryLink DSH Plugin Family

本项目是 [PerryLink](https://github.com/PerryLink) 维护的 [15 个 DeepSeek Harness 插件](https://github.com/PerryLink) 之一。如果这个对你有用，其他插件多半也有用：

| Plugin | One-liner |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Engineering-discipline guard: requirements grill, test gates, adversary review |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Durable background child agents with a Web UI sidebar, messaging and interrupt |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | LSP diagnostics, formatting, completion, code actions and rename over language servers |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles-equivalent runtime style switching |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | Second-model auto-review on the approval chain, fail-closed by default |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Security-audit skill pack: secret scan, dependency and supply-chain review |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Pin sessions in the Web sidebar with durable ordering |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Terminal-style input history for the web composer: arrows, Ctrl+R search |
| [dsh-github](https://github.com/PerryLink/dsh-github) | GitHub PR/issues integration for DSH, every write gated by approval |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Plugin-development knowledge base as an on-demand agent skill |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
