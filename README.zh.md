<div align="center">

# 🛡️ dsh-permission-rules

**DeepSeek Harness 的 Claude Code 式声明式权限规则。**

*规则裁决已知，reviewer 模型裁决未知。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![Tests](https://img.shields.io/badge/tests-58%20passed-success.svg)](#开发)
[![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](package.json)

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
- ✅ **丰富匹配** — 工具名 glob（含 `mcp__*`）、参数键值 glob **或** 正则、工作区相对路径 glob
- ✅ **waterfall 安全** — `allow`/透传一律 `next()`；只有 `deny`/`ask` 短路
- ✅ **官方审批 seam** — `ask` 走 `ctx.approval`；不重复实现、绝不绕过
- ✅ **完整审计** — 每次命中与透传都写 `permissionRules/decision` 事件
- ✅ **热更新** — Chokidar 监视 + 去抖；改坏了保留旧规则，绝不崩溃
- ✅ **响亮失败** — 非法 YAML、未知 action、坏 glob/正则、超过 `maxRules` 都使加载失败
- ✅ **热路径有界** — 预编译匹配器，O(规则数 × 模式数)，`maxRules` 封顶

## 快速开始

```sh
# 1. 把 bundle 装进 profile
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# 或从打包好的 tarball 安装（预构建产物，无需构建许可）
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.1.0.tgz

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
| `maxRules` | `256` | 规则数硬上界，超限加载失败 |
| `patternMode` | `glob` | `params`/`paths` 模式类型：`glob` 或 `regex`（工具名始终是 glob） |
| `watch` | `true` | Chokidar 监视并在变更时重读 |
| `watchStabilityThresholdMs` | `200` | 重读去抖窗口（毫秒） |

### 会话命令

```
/rules           列出当前生效规则、来源文件与最近一次重载错误
/rules reload    重读本工作区的规则文件
```

命令输出只进 UI——模型只通过规则产生的工具结果感知规则。

## 与 dsh-auto-review 协作

- `dsh-permission-rules` 产出 `ask`；`dsh-auto-review` 在 `approval/request` waterfall 上用只读第二模型裁决（或转交人类）。两者同挂载即完整闭环。
- 已做集成测试（`test/integration.spec.ts`）：`permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`，reviewer 以脚本化 mock 替代。
- [官方 harness](https://github.com/deepseek-ai/deepseek-harness) 的 `never` 审批策略与全部 fail-closed 保证不受影响。

## 安全边界

- **是策略，不是内核。**`paths` 候选只来自文档化的参数键集合，且只匹配工作区相对路径。
- **不自己起 reviewer。**本插件不 spawn 子代理、不调模型——产出 `ask` 决定就是它工作的终点。
- **不改沙箱。**OS 级沙箱策略属于 sandbox seam，不属于本插件。
- **响亮拒绝错误配置。**未知 YAML 字段、未知 action、坏模式在加载期被拒绝，绝不静默忽略。

## 相关实现

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — 二态 allow/deny 分类器，审计走自有文件日志；本插件补齐三态语义、声明式 YAML 规则、会话日志审计与 `next()` 安全委托。
- `Drifter-yh/dsh-tool-policy` — deny-by-default 工具策略；在此声明差异化，避免重复实现。
- `dsh-auto-review` — 本插件所前置的"AI 兜底"半环。

## 已知局限

- `permissionRules/decision` 以信封 `ignorable: true` 标记写入，任何 harness 构建都能加载日志——不认识该仓库外类型的第一方读取器会跳过这条审计记录而不是拒绝整个会话。（rc.6 宿主会接受并忽略该标记，行为与打标前完全一致。）
- `paths` 候选是启发式的：只有文档化的参数键进入路径匹配。
- glob 是保守子集（不支持花括号展开）——写两条模式，或用 regex 模式。

## 开发

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc，src + tests
pnpm test           # vitest：58 测试 / 7 套件
pnpm run build      # tsc 声明 + tsdown 打包（lib/）
pnpm pack           # 发布产物
```

headless 端到端验证记录（deny 阻止 shell 工具、ask 走审批 seam、`--dump-config`）见 [VERIFICATION.md](VERIFICATION.md)。

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
