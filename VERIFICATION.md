# dsh-permission-rules 验证记录

日期：2026-08-14 · 运行时：dsh `0.1.0-rc.6`（全局安装，`dsh` on PATH）· 平台：Windows（工具面为 `pwsh`）

## v0.4.0 完善轮次（2026-08-15）验证记录

在 v0.3.0 基础上实施四类完善（候选文件监听、`--platform` 测试标志、规则来源归属、缓存键规范化），全部通过仓库本地门禁（typecheck / lint / vitest 133 tests / 覆盖率 90-80-90-90 / build / pack / 五语 README 同步）。关键行为均有测试锁定（`watch.spec.ts` 12 用例、`command.spec.ts` 21 用例）：

- **候选文件监听**（真实缺口修复）：chokidar 5 在 Windows 上对「父目录也缺失」的路径监听不可靠（实测探针：父目录存在时 `add` 可达，父子同建时无事件），故对未生效候选文件改监听其最近存在祖先目录，事件回调里 `existsSync` 判定后再重载——空链时创建 `.dsh/rules.yaml`、fallback 挂载后删除再重建、项目文件重建从 fallback 切回，三条路径均自动采纳，无需 `/rules reload`。
- **`/rules test --platform <name>`**：`when.platform` 维度在任何宿主上可干跑测试；未知平台名响亮报错（五语 `testBadPlatform`）。
- **来源归属**：多文件链（`searchUp`）下每条规则行标注自己的来源文件（工作区内显示相对路径，区外显示绝对路径）；`/rules list` 为裸列出显式别名。
- **缓存键规范化**：`resolve(cwd)` + Windows 大小写折叠，同目录不同拼写共享一条缓存与一套 watcher（`watch.spec.ts` 断言 `activeWatcherCount() === 1`）。

### 待办（延续）

- rc.7 上线复核（见第 0 节待办三项）不变。
- `searchUp` 下更深祖先层的新建文件仍需 `/rules reload`（已写入 docs 与 AGENTS.md 的既定限制）。

## 0. 2026-08-14 加固轮次（Unreleased）验证记录

在上一轮验证基础上实施完善方案（P0-P3），全部通过仓库本地门禁：

```sh
pnpm run typecheck     # tsc src + tests，通过
pnpm run lint          # eslint src/test/scripts，通过
pnpm test              # vitest：106 tests / 8 套件，全部通过
pnpm run test:coverage # 覆盖率门禁 90/80/90/90：语句 95.13% / 分支 89.43% / 函数 99.27% / 行 95.13%，通过
pnpm run build         # lib/types (tsc 声明) + lib/index.js (tsdown)
pnpm run pack:check    # 构建 + pack 产物
node scripts/check-readme-sync.mjs   # 五语 README 同步门禁，通过
```

本轮关键行为均有单元/集成测试锁定（真实 rc.6 `Context`/`Session`/`Commands`/`ApprovalService`）：

- **安全修复**：Windows 大小写路径绕过（`caseInsensitivePaths`，win32 默认开，回归用例 `rules.spec.ts`）；嵌套参数候选提取（MCP 形态，深度上限 8）；回溯守卫（glob 星号数上限 `maxGlobStars`=2 + regex 嵌套无界量词/重叠交替拒绝，`compilePatternRegex` 用例组）；审计 `outcome` 补记（下游 deny 不被误记 allow，`dispatch.spec.ts`）。
- **新能力**：`/rules decisions [n]`、`/rules test <tool> <json>`、`language` 五语（en/zh/es/pt/hi，`prose.spec.ts` 全语言冒烟）、`searchUp` 分层合并（子覆盖父 + 审计归属具体文件，`file-load.spec.ts`）、规则元数据 `enabled/description/tags`、参数否定 `!pattern`、`absent` 维度、`when` 条件（env/platform）、`audit: 'hits'` 粒度、遮蔽告警、LRU 逐出与 watcher 定时器清理（`watch.spec.ts`）。
- **工程**：CI 增加 lint/覆盖率/五语 README 同步门禁；release workflow（tag 触发 pack + 校验 CHANGELOG + 发布 tarball）；`inject` 补齐 `tools`；`package.json` 发布 hygiene。

### 真实回放实测（新构建，rc.6 宿主）

demo profile（`permission-rules-demo`）重装本地 `dsh-permission-rules-0.1.1.tgz` 后，用 `.verification` 的 llm-replay fixture 在 `.verification/workspace` 重跑两条链路（`dsh --profile permission-rules-demo`，keyless）：

- **deny**（fixture-deny）：会话日志 seq 21 `permissionRules/decision {action:"deny", outcome:"deny", ruleIndex:0}` → seq 22 `tool/result` "Error: 禁止 push 到受保护路径"（模型可见 = reason；pwsh 未执行）。新 `outcome` 字段在真实宿主上落盘 ✅
- **ask**（fixture-ask）：seq 21 `permissionRules/decision {action:"ask", outcome:"ask", ruleIndex:1}` → seq 22 `approval/asked`（reason 原样进入官方审批 seam）→ seq 23 `approval/decided {outcome:"rejected"}`（headless `never` 策略 fail-closed）✅

解码用 `.verification/dump-session.mjs`（独立 zstd 帧扫描，不依赖 harness 源码；原 `dump-session.ts` 依赖 harness 源文件路径映射，保留作参考）。

### 待办：rc.7 上线复核

`AuditAppend` 假定 post-rc.6 宿主会在信封上真正落下 `ignorable: true`。rc.7 发布后一周内，用 `.verification` 流程实测一次：

1. 用 rc.7 的 `dsh` 重放 `fixture-deny.session.jsonl`，确认 deny 拦截与 `permissionRules/decision` 审计行（带 `ignorable` 标记）不变；
2. 用不含本插件的 rc.7 构建加载一段由 rc.6 宿主写入的会话日志，确认 `repair-session-logs.mjs repair` 后的日志可被加载；
3. CI 增加对 `next` tag 宿主的冒烟矩阵（peer 临时覆盖 + `--dump-config` + headless deny 回放）。

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

## 8. GitHub CI 与 Release（2026-08-14）

- 新增 `.github/workflows/ci.yml`（pnpm 11.7.0 + Node 22：`install --frozen-lockfile` → `typecheck` → `test` → `build`），提交 `38c28c0` 的 Actions 运行 **success**。
- tag `v0.1.0` + GitHub Release：https://github.com/PerryLink/dsh-permission-rules/releases/tag/v0.1.0 ，附件 `dsh-permission-rules-0.1.0.tgz`（61,771 bytes）。
- 演示 profile 已重装到最新提交 `38c28c0`（git 通道 + `allowBuilds` 键），`--dump-config` 行生效、headless deny 冒烟通过。
- profile 的 `pnpm peers check` 显示 rc.6 peers 缺失属预期（`autoInstallPeers: false` 的 profile 惯例）：运行时经 `$DSH_HOME/profiles/node_modules` healed fallback 解析，`--dump-config` 与 headless 运行均已实证可加载。
