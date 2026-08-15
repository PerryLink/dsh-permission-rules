<div align="center">

# 🛡️ dsh-permission-rules

**DeepSeek Harness 的 Claude Code 式声明式权限规则。**

*规则裁决已知，reviewer 模型裁决未知。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-permission-rules/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-permission-rules?label=version)](https://github.com/PerryLink/dsh-permission-rules/releases)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## 它能做什么

`dsh-permission-rules` 在 `tools/pre-execute` waterfall 上为每一次工具调用放置一个有序的 **`allow` / `deny` / `ask`** 规则列表——确定性、零延迟、可审计，规则用你写的普通 YAML 声明：

- **`deny`** 阻止调用。规则的 `reason` 成为模型可见的错误，让 agent 知道*为什么*而不是盲目重试。
- **`ask`** 走官方审批 seam。同时挂载 `dsh-auto-review` 时由第二模型裁决；否则人类审批；两者都没有时 harness fail-closed。
- **`allow`**（以及无命中）严格通过 `next()` 委托——绝不短路下游监听器。

每次命中**和**每次透传都会以 `permissionRules/decision` 会话事件审计落盘（log-only，不向模型上下文注入任何额外内容）。

```text
tools/pre-execute waterfall                     approval/request waterfall（answerer 链）
        │                                                   │
  dsh-permission-rules                                dsh-auto-review answerer
   · 按文件顺序首条命中                    ┌───────────────┴──────────────┐
   · deny/ask 认领调用                    │ 第二模型裁决                  │ 否 ── next() ──▶ 人类 UI
   · allow/透传 → next()                 └───────────────┬──────────────┘
        │ deny ──▶ 被拒工具结果                         │ allowed-once / rejected
        │ ask  ──▶ ctx.approval ────────────────────────┘
        │
   审计：permissionRules/decision → approval/asked → autoReview/verdict → approval/decided
```

## 为什么既要有规则又要有 reviewer？

第二模型回答*"这次调用行不行"*有判断力，但每次都要一次模型往返，也可能判错。声明式规则确定性、即时、不跑模型——但只能覆盖管理员写下来的情形。两者组合就是 **"规则先行、AI 兜底"** 闭环：规则裁决已知，reviewer 裁决未知。

## 特性

- ✅ **三态语义** — `allow`、`deny`、`ask`，按文件顺序求值，首条命中生效
- ✅ **丰富匹配** — 工具名 glob（含 `mcp__*`）、代理身份选择器（`main` / `subagent` / `preset:*`）、参数键值 glob **或** 正则（支持 `!pattern` 否定与 `absent` 键维度）、工作区相对路径 glob（从文档化参数键在**任意嵌套深度**提取候选），以及 `when` 宿主条件（环境变量、平台）
- ✅ **分层规则文件** — 可选 `searchUp` 从会话 cwd 向上逐级合并每份 `.dsh/rules.yaml`（最近的优先），子项目可覆盖父级规则
- ✅ **规则元数据** — `enabled: false`、`description`、`tags`；`/rules` 会告警被前面通配规则遮蔽的规则
- ✅ **waterfall 安全** — `allow`/透传一律 `next()`；只有 `deny`/`ask` 短路
- ✅ **官方审批 seam** — `ask` 走 `ctx.approval`；不重复实现、绝不绕过
- ✅ **完整审计** — `permissionRules/decision` 事件记录规则动作、工作区 cwd 与最终裁决；`/rules decisions` 可在会话内回放审计轨迹；早于审计信封标记的宿主自动降级为关闭审计并一次性警告，绝不写出无法恢复的日志（`allowUnmarkedAudit` 可重新开启）
- ✅ **干跑上线** — `enforce: false` 只审计策略「本会做什么」（记录本会动作 + 下游真实结果，带 `dryRun` 标记），所有调用照常透传；可在生产环境安全试跑新策略
- ✅ **干跑测试** — `/rules test <工具> <json-参数>` 不执行任何东西地评估规则命中，支持 `--cwd`、`--env`、`--agent`、`--platform` 覆盖每个匹配维度
- ✅ **热更新** — Chokidar 监视 + 去抖；改坏了保留旧规则，绝不崩溃；会话中途创建的规则文件（项目文件或 fallback）自动生效，无需手动重载
- ✅ **响亮失败** — 非法 YAML、未知字段/action、坏 glob/正则、易回溯灾难的模式、超过 `maxRules` 都使加载失败
- ✅ **热路径有界** — 预编译匹配器，O(规则数 × 模式数)，`maxRules` 封顶；glob 回溯度由 `maxGlobStars` 封顶

## 快速开始

```sh
# 1. 把 bundle 装进 profile
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# 或从打包好的 tarball 安装（预构建产物，无需构建许可）
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.4.1.tgz

# 2. 重启
dsh --profile web
```

然后在你的项目里创建规则文件，并在其中启动会话：

```yaml
# <project>/.dsh/rules.yaml
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "禁止从受保护路径 push"

  - match: { tools: [edit, write] }
    action: ask
    reason: "写文件需要确认"
```

```sh
dsh --profile web --dump-config | grep -A4 'id: permission-rules'   # 验证挂载行
```

完整的 5 条安全基线示例与完整 schema 见 [docs/rules-format.md](docs/rules-format.md)。

## 配置

所有可调参数都是 Schemastery `Config` 字段（可在 cordis.yml 修改）。按 id 的覆盖会整行替换——覆盖时请重写所有需要的键。

| 键 | 默认 | 含义 |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | 规则文件位置；相对值 = 按调用会话 cwd 解析，绝对值 = 全局生效并在挂载时校验 |
| `fallbackPath` | 无 | cwd 发现不到时使用的回退规则文件；挂载时校验 |
| `badFilePolicy` | `fail` | 坏规则文件处理：`fail` 让待处理工具调用响亮失败（重读保留旧规则）；`ignore-with-warning` 告警后以空集继续 |
| `maxRules` | `256` | 生效规则链的总规则数硬上界，超限加载失败 |
| `maxCachedWorkspaces` | `512` | 按工作区缓存的规则装载硬上界；超出时逐出最久未用工作区（连同其 watcher） |
| `patternMode` | `glob` | `params`/`paths`/`when.env` 模式类型：`glob` 或 `regex`（工具名始终是 glob） |
| `watch` | `true` | Chokidar 监视并在变更时重读 |
| `watchStabilityThresholdMs` | `200` | 重读去抖窗口（毫秒） |
| `language` | `en` | `/rules` 输出语言：`en`、`zh`、`es`、`pt`、`hi`（`en`/`zh` 为参考译文） |
| `caseInsensitivePaths` | *（win32）* | `paths` 模式与工作区根比较忽略 ASCII 大小写；Windows 默认 `true`，其余平台默认 `false` |
| `audit` | `all` | 审计粒度：`all` 记录每次命中与透传；`hits` 跳过透传事件 |
| `searchUp` | `false` | 从会话 cwd 向上逐级查找并合并规则文件，最近的优先 |
| `maxGlobStars` | `2` | 每个 glob 模式的无界 `*`/`**` 量词数硬上界（回溯度封顶） |
| `enforce` | `true` | `false` = 干跑模式：deny/ask 命中只写审计（带 `dryRun` 标记，记录本会动作与下游真实结果），所有调用照常透传——先试跑策略再强制执行 |
| `allowUnmarkedAudit` | `false` | 早于 `ignorable` 信封标记的宿主（`0.1.0-rc.6` 系列）会写出无标记审计事件，使会话在更严格构建上无法恢复：插件会探测到此类宿主并停用会话日志审计（一次性警告）。设 `true` 重新开启会话内轨迹（已有日志用 `scripts/repair-session-logs.mjs` 修复） |

### 会话命令

```
/rules                        列出当前生效规则、来源文件与最近一次重载错误
/rules list                   裸列出的显式别名
/rules reload                 重读本工作区的规则文件链
/rules decisions [n]          显示本会话最近 n 条权限裁决（默认 10）
/rules test <工具> <json>     对假设调用干跑评估，如 /rules test bash {"command":"git push origin main"}
```

`/rules test` 还支持前置标志：`--cwd <目录>` 换一个工作区评估，`--env 键=值`（可重复）覆盖宿主环境变量以测试 `when.env`，`--agent <选择器>`（可重复）为 `agents` 维度提供身份候选，`--platform <平台名>` 覆盖宿主平台以测试 `when.platform`。多文件链（如 `searchUp`）下，每条规则行都会标注它自己的来源文件。

命令输出只进 UI——模型只通过规则产生的工具结果感知规则。`language` 选择输出语言。规则文件的 JSON Schema 随包发布在 [docs/rules-format.schema.json](docs/rules-format.schema.json)（用 `# yaml-language-server: $schema=...` 启用编辑器补全）。

## 与 dsh-auto-review 协作

- `dsh-permission-rules` 产出 `ask`；`dsh-auto-review` 在 `approval/request` waterfall 上用只读第二模型裁决（或转交人类）。两者同挂载即完整闭环。
- 已做集成测试（`test/integration.spec.ts`）：`permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`，reviewer 以脚本化 mock 替代。
- [官方 harness](https://github.com/deepseek-ai/deepseek-harness) 的 `never` 审批策略与全部 fail-closed 保证不受影响。

## 安全边界

- **是策略，不是内核。**`paths` 候选只来自文档化的参数键集合（任意嵌套深度、深度封顶），且只匹配工作区相对路径。
- **不自己起 reviewer。**本插件不 spawn 子代理、不调模型——产出 `ask` 决定就是它工作的终点。
- **不改沙箱。**OS 级沙箱策略属于 sandbox seam，不属于本插件。
- **响亮拒绝错误配置。**未知 YAML 字段、未知 action、坏模式在加载期被拒绝，绝不静默忽略。
- **回溯有界。**glob 模式的无界星号量词数由 `maxGlobStars` 封顶；regex 模式拒绝嵌套无界量词与量化重叠字面量交替。（`\d+\.\d+\.\d+` 这类独立量词链仍然放行——regex 模式是逃生舱，glob 模式是受守护的默认。）

## 相关实现

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — 二态 allow/deny 分类器，审计走自有文件日志；本插件补齐三态语义、声明式 YAML 规则、会话日志审计与 `next()` 安全委托。
- `Drifter-yh/dsh-tool-policy` — deny-by-default 工具策略；在此声明差异化，避免重复实现。
- `dsh-auto-review` — 本插件所前置的"AI 兜底"半环。

## 已知局限

- `permissionRules/decision` 以信封 `ignorable: true` 标记写入，任何 harness 构建都能加载日志——不认识该仓库外类型的第一方读取器会跳过这条审计记录而不是拒绝整个会话。早于该标记的宿主（`0.1.0-rc.6` 系列）会静默丢弃它：插件在运行时探测（peer 版本预检 + 已写事件信封探针），探测到即停用会话日志审计并一次性警告，确保会话日志在任何构建上都能加载。设 `allowUnmarkedAudit: true` 重新开启会话内轨迹；已写出且缺标记的日志可在 required-on-read 语义的宿主上加载前用 `scripts/repair-session-logs.mjs` 修复。
- `paths` 候选是启发式的：只有文档化的参数键进入路径匹配；工作区相对匹配仅在 `caseInsensitivePaths` 开启时忽略 ASCII 大小写。
- glob 是保守子集（不支持花括号展开）——写两条模式，或用 regex 模式。
- regex 回溯守卫是结构性的而非穷尽的：不含字面量前缀的交替歧义（如精心构造的环视）由作者自负其责；不可信文件请优先用 glob 模式。

## 会话日志修复

`ignorable` 标记出现之前的会话日志可能被较新的 harness 构建拒绝（`SessionFormatUnsupportedError`）。随包发布的 `scripts/repair-session-logs.mjs` 只改写目标审计行、补上 `ignorable: true`，帧边界保留并自动备份：

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # 只报告外来行，不改动
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` 默认为 `$DSH_HOME/sessions`（或 `~/.dsh/sessions`）。完整约定见脚本头注释。

## 开发

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc，src + tests
pnpm run lint       # eslint，src + tests + scripts
pnpm test           # vitest：139 测试 / 9 套件
pnpm run test:coverage  # 覆盖率门禁（90/80/90/90）
pnpm run build      # tsc 声明 + tsdown 打包（lib/）
pnpm run pack:check # 构建 + pack（发布产物）
node scripts/check-readme-sync.mjs  # 五语 README 同步门禁（CI 同步执行）
```

headless 端到端验证记录（deny 阻止 shell 工具、ask 走审批 seam、`--dump-config`）见 [VERIFICATION.md](VERIFICATION.md)。

## 致谢

- 感谢 [@22xuan](https://github.com/22xuan) 关于 rc.6 宿主静默丢弃审计事件 `ignorable` 标记的详尽报告（[#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)）以及其向上游 harness 提交的讨论——运行时宿主能力探测与文档修正均直接源自该分析。

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
