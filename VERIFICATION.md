# dsh-permission-rules 验证记录

日期：2026-08-14 · 运行时：dsh `0.1.0-rc.6`（全局安装，`dsh` on PATH）· 平台：Windows（工具面为 `pwsh`）

## 1. 静态检查与单元测试

```sh
pnpm run typecheck   # tsc src + tests，通过
pnpm test            # vitest：58 tests / 7 suites，全部通过
pnpm run build       # lib/types (tsc 声明) + lib/index.js (tsdown)，lib/types/index.d.ts 存在
pnpm pack            # dsh-permission-rules-0.1.0.tgz
```

覆盖矩阵（`test/`）：三态分派（deny/ask 短路、allow/透传严格 `next()`）、参数 glob 匹配（跨 `/`、标量字符串化、数组任一、缺失键不命中）、paths 匹配（工作区相对、Windows 盘符、`**` 零层、工作区外绝对候选丢弃）、规则顺序（首条命中）、无命中透传、坏文件 `fail`（每次调用响亮失败）与 `ignore-with-warning`（告警降级）两路径、绝对 `rulesFile`/`fallbackPath` 挂载期校验、`maxRules` 超限失败、Chokidar HMR（变更生效、坏重载保留旧规则不崩溃、unlink 重解析、重建恢复、watcher 错误只告警）、`/rules` 走真实 `dsh-commands` registry（列出/重载/坏文件/未知参数）、与 dsh-auto-review 集成（mock answerer 替代真实模型：ask 规则 → 裁决放行/拒绝 → 审计链完整；无 answerer → 官方 `unavailable` fail-closed）。

## 2. 组合验证：`dsh --dump-config` 行生效

Profile `~/.dsh/profiles/permission-rules-demo`：bundles `@deepseek-ai/dsh-base + @deepseek-ai/dsh-headless + dsh-permission-rules`，patch 层挂 `@deepseek-ai/dsh-llm-replay`（keyless 回放）并禁用 `session-title-llm`。

```
# == dsh-permission-rules
- id: permission-rules
  name: dsh-permission-rules
  config:
    rulesFile: .dsh/rules.yaml
    badFilePolicy: fail
    maxRules: 256
    patternMode: glob
    watch: true
# == C:\Users\zzhdz\.dsh\profiles\permission-rules-demo\cordis.patch.yml
- id: llm-replay
  name: '@deepseek-ai/dsh-llm-replay'
```

无 FAILED 行（完整输出见 `.verification/dump-config.txt`）。

## 3. headless 实测（无 API key，llm-replay 回放模型脚本）

工作区 `Project\Plugins\dsh-permission-rules\.verification\workspace`，规则文件 `.dsh/rules.yaml`：

```yaml
rules:
  - match: { tools: [pwsh], params: { command: "git push*" } }
    action: deny
    reason: "禁止 push 到受保护路径"
  - match: { tools: [pwsh], params: { command: "Write-Output secret*" } }
    action: ask
    reason: "输出 secret 需要审批"
```

回放 fixture（`.verification/fixture-deny.session.jsonl` / `fixture-ask.session.jsonl`）记录两轮模型响应：第 1 轮发出 `pwsh` 工具调用，第 2 轮输出 `DONE` 结束回合。运行：

```sh
$env:DSH_SNAPSHOT_FILE = '<repo>\.verification\fixture-deny.session.jsonl'
dsh --profile permission-rules-demo "verify the deny rule blocks git push"   # cwd = .verification\workspace
```

### 3.1 deny 阻止 pwsh（fixture-deny）

回放出的 `pwsh(git push origin main)` 在 `tools/pre-execute` 被规则 1 阻止。会话日志（`~/.dsh/sessions/.../session.jsonl.zstd` 解帧）：

```
{"type":"permissionRules/decision","seq":21,"data":{"toolName":"pwsh","callId":"call-1",
 "source":"D:\\deepseek-harness\\Project\\Plugins\\dsh-permission-rules\\.verification\\workspace\\.dsh\\rules.yaml",
 "action":"deny","ruleIndex":0,"reason":"禁止 push 到受保护路径"}}
{"type":"tool/result","seq":22,"data":{...,"content":[{"type":"tool-result","toolCallId":"call-1",
 "content":[{"type":"text","text":"Error: 禁止 push 到受保护路径"}],"isError":true}]}}
```

模型可见结果 = 规则 reason；`pwsh` 进程从未执行。✅

### 3.2 ask 触发官方审批（fixture-ask）

`pwsh(Write-Output secret hello)` 命中规则 2 → 返回 `ask` → 官方 tools 流水线调用 `ctx.approval.request`。headless 组合的会话预设为 `danger-full-access`，审批策略因此为 `never`（官方服务在任何 answerer 之前确定拒绝），审计对完整：

```
{"type":"permissionRules/decision","seq":21,"data":{...,"action":"ask","ruleIndex":1,"reason":"输出 secret 需要审批"}}
{"type":"approval/asked","seq":22,"data":{"id":"d205813e-...","toolName":"pwsh","callId":"call-1","reason":"输出 secret 需要审批"}}
{"type":"approval/decided","seq":23,"data":{"id":"d205813e-...","outcome":"rejected"}}
{"type":"tool/result","seq":24,"data":{...,"text":"Error: the user rejected tool \"pwsh\"","isError":true}}
```

✅ `ask` 规则完整走官方审批 seam（`approval/asked` → `approval/decided`），reason 原样进入审批请求。

### 3.3 ask + auto-review answerer（mock 第二模型）— 集成测试

真实模型需要 API key，按交付约定以 **mock answerer（脚本化 reviewer 子代理）** 代替（`test/integration.spec.ts`，真实 `ApprovalService` + 真实 `dsh-auto-review` bundle）：

- allow 裁决：`permissionRules/decision`(ask) → `approval/asked` → `autoReview/verdict`(allow, outcome allowed-once) → `approval/decided`(allowed-once)，事件顺序断言通过。
- deny 裁决：同链，`approval/decided`(rejected)。
- 两者都无（未挂 answerer）：`approval/decided`(unavailable) — 官方 fail-closed。✅

## 4. /rules 命令

headless 组合没有命令分发面（斜杠命令由客户端 UI 驱动），`/rules` 的实测走**真实 `dsh-commands` registry**（`test/command.spec.ts`，真实 Session/Agent）：

- `/rules` 列出 2 条规则、来源路径、1-based 序号与 reason ✅
- `/rules reload` 重读文件（1 条新规则生效）；坏文件 → error 结果 + 旧规则保留 ✅
- 未知参数 → 用法提示 ✅

## 5. 验证环境文件（.verification/，gitignored）

- `workspace/.dsh/rules.yaml` — 演示规则
- `fixture-deny.session.jsonl` / `fixture-ask.session.jsonl` — llm-replay 回放脚本
- `dump-config.txt` — `--dump-config` 完整输出
- `dump-session.ts` — zstd 会话日志解帧工具（帧扫描复用 harness 的 `scanZstdFrames`）

## 6. GitHub 发布（2026-08-14）

- 仓库：https://github.com/PerryLink/dsh-permission-rules （public，默认分支 `main`，初始提交 `c0bd092`）
- 协议：Apache License 2.0（`LICENSE` + package.json `license` 字段；五语 README 同步更新）
- Topics：`dsh` `dsh-plugin` `deepseek-harness` `deepseek` `cordis` `permission-rules` `approval` `ai-safety`
- 提交树经密钥扫描（`ghp_*`/常见凭据模式）无命中；`.gitignore` 排除 `node_modules/`、`lib/`、`.verification/` 与 `*.tgz`（`vendor/dsh-auto-review-0.1.0.tgz` 为集成测试 fixture，显式保留在树内）。

## 7. git 安装通道实测（2026-08-14，提交 `8e6d1eb`）

`dsh plugin --profile permission-rules-demo add "github:PerryLink/dsh-permission-rules#8e6d1eb…"`（README 承诺的安装路径）：

1. pnpm 首次因 git 包 `prepare` 构建未获 allowBuilds 许可而拒绝，CLI 打印精确的 `allowBuilds` 键 → 加入 profile 的 `pnpm-workspace.yaml` 后重装成功。
2. 隔离 prepare 环境实测暴露两个仓库缺陷并已修复：
   - `vendor/dsh-auto-review-0.1.0.tgz`（devDep 的 `file:` 目标）被 gitignore 导致隔离 `pnpm install` ENOENT → **改为随仓库提交**；
   - package.json 的 `pnpm.neverBuiltDependencies` 在 pnpm 11 被忽略 → **改为在仓库自带 `pnpm-workspace.yaml` 声明 `allowBuilds: { esbuild: true }`**（隔离 prepare 读取依赖方随包发布的工作区文件）。
3. 修复后 git 安装：隔离 prepare 构建通过（`prepare: Done`），`dsh --dump-config` 显示 `permission-rules` 行，headless deny 冒烟（fixture-deny 回放）产出 `permissionRules/decision`(deny, "禁止 push 到受保护路径") ✅。
