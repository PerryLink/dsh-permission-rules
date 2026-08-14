# dsh-permission-rules 规则文件格式

规则文件是 YAML 文档，默认按会话工作目录发现：`<cwd>/.dsh/rules.yaml`。插件配置 `rulesFile` 可以改文件名或固定为绝对路径；`searchUp: true` 会额外从会话 cwd 向上合并每一份同名文件（最近的优先，子目录可覆盖父目录）；发现不到时使用 `fallbackPath`，两者都没有则为空规则集（全部透传）。

本格式的 JSON Schema 随包发布在 `rules-format.schema.json`，可在编辑器首行接线启用补全：

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/PerryLink/dsh-permission-rules/main/docs/rules-format.schema.json
```

## 顶层结构

```yaml
rules:        # 规则列表，按书写顺序求值；可以省略或为空
  - match: ...
    action: ...
    reason: ...
```

顶层只允许 `rules` 一个键；每条规则只允许 `match`、`action`、`reason`、`enabled`、`description`、`tags` 六个键；`match` 只允许 `tools`、`params`、`paths`、`absent`、`when` 五个键。出现任何未知键都在加载期报错（响亮失败），绝不静默忽略。

## match 维度（全部 AND）

| 维度 | 类型 | 语义 |
|---|---|---|
| `tools` | `string[]` | 工具名 glob（始终 glob 解释，与 `patternMode` 无关）。空/缺省 = 不限制。支持 `mcp__*` 等前缀匹配。 |
| `params` | `Record<string, string \| number \| boolean \| (…)[]>` | 参数键 → 模式（或模式列表）。**列出的每个键都必须存在且命中**（AND）；缺省 = 不限制。标量值按字符串匹配（数字/布尔字符串化）；数组任一元素命中即可；嵌套对象贡献其标量叶子（深度上限 8）。`!` 前缀为否定：值必须**不**命中该模式；只含否定的键在键存在且全部否定未命中时命中（YAML 里请给 `!` 模式加引号：`"!git*"`）。params 模式中 `/` 是普通字符，`*` 可跨 `/`。 |
| `paths` | `string[]` | 工作区相对路径模式，任一候选命中任一模式即可。候选来自参数中下列键的值（**任意嵌套深度**、深度上限）：`path` `paths` `file` `files` `file_path` `dir` `directory` `directories` `cwd` `workspace` `root` `target` `targets` `output`。工作区外的绝对候选被丢弃；相对 `../` 形式保留，可显式匹配工作区外。路径模式中 `*` 不跨 `/`，`**` 跨任意深度（含零层）。`caseInsensitivePaths` 开启时（Windows 默认）根比较与模式匹配忽略 ASCII 大小写。 |
| `absent` | `string[]` | 必须**缺席**的参数键；**每个列出的键都必须缺失**（非对象参数天然满足）。 |
| `when` | `{ env, platform }` | 宿主条件：`env` 为环境变量名 → 模式（**每个列出的变量都必须存在且命中**）；`platform` 为任一命中即可的封闭列表（`aix` `android` `darwin` `freebsd` `linux` `openbsd` `sunos` `win32`）。 |

所有维度为 AND：一条规则只有在它的**每个非空维度都命中**时才命中。规则按顺序求值，**首条命中生效**；无命中 = 透传。

## action、reason 与元数据

- `action: allow | deny | ask`（必填）。
- `reason: string`（必填，非空）。`deny` 的 reason 会进入被拒绝工具的结果、对模型可见；`ask` 的 reason 会作为审批理由进入官方审批 seam。
- `enabled: false` 保留规则但使其失效（显示为已禁用）；`description`、`tags` 为 `/rules` 展示的自由注解。

## 模式解释（patternMode）

`params`、`paths` 与 `when.env` 的模式按插件配置 `patternMode` 解释（默认 `glob`）：

- `glob`：`*`、`**`、`?`、`[abc]`/`[!abc]` 字符类、`\x` 转义。params 中 `*` 跨 `/`；paths 中 `*` 不跨 `/`、`**` 跨。非法 glob（未闭合 `[`、空字符类、悬空转义）加载期报错；展开出超过 `maxGlobStars`（默认 2）个无界星号量词的模式会被拒绝——编译产物的回溯度恰好等于星号数。更宽的模式请拆成多条。
- `regex`：不锚定的 JavaScript 正则（`RegExp.test` 语义），非法正则在加载期报错。嵌套无界量词（`(a+)+`、`(ab*)+`）与被量化且字面量交替分支重叠的分组（`(a|aa)+`）会被判定为灾难回溯风险而拒绝；独立量词链（`\d+\.\d+\.\d+`）保持放行。注意 YAML 双引号字符串中 `\` 需要转义，建议用单引号。

## 规则数上界

规则总数（`searchUp` 下为整个合并链的总数）超过配置 `maxRules`（默认 256）时加载失败。这是 `tools/pre-execute` 热路径的简单上界：每条规则的工具名 glob、参数键、路径候选都是预编译正则，匹配成本 O(规则数 × 各维度模式数)。

## 安全基线示例（5 条）

```yaml
# .dsh/rules.yaml — 推荐的安全基线
rules:
  # 1. 危险命令：任何 shell 中的删除/强推/格式化都先要第二模型（或人类）裁决
  - match:
      tools: [bash, pwsh]
      params:
        command: ["rm -rf*", "git push*--force*", "git push* -f*", "*:(){ :|:& };:*"]
    action: ask
    reason: "危险命令需要第二模型裁决"

  # 2. 保护路径：对密钥/凭据/配置目录的任何工具操作直接拒绝
  - match:
      paths: ["**/secrets/**", "**/.env", "**/*.pem", "**/*.key", "**/.ssh/**"]
    action: deny
    reason: "禁止操作受保护的密钥与凭据路径"

  # 3. 发布动作：npm/pnpm 发布需要确认
  - match:
      tools: [bash, pwsh]
      params:
        command: ["npm publish*", "pnpm publish*", "cargo publish*"]
    action: ask
    reason: "发布动作需要确认"

  # 4. 远程副作用：git 推送到主分支需要确认
  #    （二星模式——maxGlobStars 将无界星号量词数封顶在 2）
  - match:
      tools: [bash, pwsh]
      params:
        command: ["git push*origin main*", "git push*origin master*"]
    action: ask
    reason: "推送到主分支需要确认"

  # 5. 写文件确认：编辑器类工具改写文件前统一确认（配合 dsh-auto-review 可全自动裁决）
  - match:
      tools: [edit, write, bash, pwsh, mcp__*]
    action: ask
    reason: "写操作需要确认"
```

## 与 dsh-auto-review 的分工

本插件只产出 `ask` 决定；`ask` 交给官方 `ctx.approval` 审批 seam。挂载 `dsh-auto-review` 后，其 answerer 会认领符合策略的请求并给出第二模型裁决，否则交给人类审批；两者都没有时官方 fail-closed（`unavailable` → 拒绝）。本插件**不**自己启动 reviewer 子代理。

## 加载与热更新

- 按会话 cwd 惰性发现，首次 `tools/pre-execute` 时加载并缓存（超出 `maxCachedWorkspaces` 逐出最久未用项）。
- 非法 YAML / 未知字段或 action / 坏 glob 与正则 / 易回溯灾难的模式 / 超 `maxRules` 都是加载期错误：`badFilePolicy: fail`（默认）时首个使用该工作区的工具调用响亮失败；`ignore-with-warning` 时告警并降级为空规则集。
- 绝对 `rulesFile` 或配置的 `fallbackPath` 在插件挂载时即校验，缺失/非法直接挂载失败。
- 文件变更后经 Chokidar 去抖重读（`watch`、`watchStabilityThresholdMs`）；重读失败保留旧规则、只告警，绝不崩溃。`/rules reload` 手动触发同样路径；`/rules decisions` 回放审计轨迹，`/rules test` 对假设调用干跑规则。
