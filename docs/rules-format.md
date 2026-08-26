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

顶层只允许 `rules` 一个键；每条规则只允许 `match`、`action`、`reason`、`enabled`、`description`、`tags` 六个键；`match` 只允许 `tools`、`agents`、`params`、`paths`、`absent`、`when`、`argv`、`network` 八个键。出现任何未知键都在加载期报错（响亮失败），绝不静默忽略。

## match 维度（全部 AND）

| 维度 | 类型 | 语义 |
|---|---|---|
| `tools` | `string[]` | 工具名 glob（始终 glob 解释，与 `patternMode` 无关）。空/缺省 = 不限制。支持 `mcp__*` 等前缀匹配。 |
| `agents` | `string[]` | 调用方代理身份选择器 glob，匹配会话头推导出的候选：`main`（顶层会话）、`subagent`（子代理会话）、`preset:<name>`（由预设组合的代理）。**任一选择器命中任一候选**即满足该维度；空/缺省 = 不限制。身份未知（无候选）永不命中——面向代理的规则按失败关闭（fail closed）处理。 |
| `params` | `Record<string, string \| number \| boolean \| (…)[]>` | 参数键 → 模式（或模式列表）。**列出的每个键都必须存在且命中**（AND）；缺省 = 不限制。标量值按字符串匹配（数字/布尔字符串化）；数组任一元素命中即可；嵌套对象贡献其标量叶子（深度上限 8）。`!` 前缀为否定：值必须**不**命中该模式；只含否定的键在键存在且全部否定未命中时命中（YAML 里请给 `!` 模式加引号：`"!git*"`）。params 模式中 `/` 是普通字符，`*` 可跨 `/`。 |
| `paths` | `string[]` | 工作区相对路径模式，任一候选命中任一模式即可。候选来自参数中下列键的值（**任意嵌套深度**、深度上限）：`path` `paths` `file` `files` `file_path` `dir` `directory` `directories` `cwd` `workspace` `root` `target` `targets` `output`。工作区外的绝对候选被丢弃；相对 `../` 形式保留，可显式匹配工作区外。路径模式中 `*` 不跨 `/`，`**` 跨任意深度（含零层）。`caseInsensitivePaths` 开启时（Windows 默认）根比较与模式匹配忽略 ASCII 大小写。 |
| `absent` | `string[]` | 必须**缺席**的参数键；**每个列出的键都必须缺失**（非对象参数天然满足）。 |
| `when` | `{ env, platform }` | 宿主条件：`env` 为环境变量名 → 模式（**每个列出的变量都必须存在且命中**）；`platform` 为任一命中即可的封闭列表（`aix` `android` `darwin` `freebsd` `linux` `openbsd` `sunos` `win32`）。 |
| `argv` | `{ command, args, anyArg, pipeline }` | shell 命令分解作用域：命中携带命令字符串参数（`command`/`cmd`/`script`/`command_line`/`commandLine`）且其词法分解命中每个列出字段的调用。`command` 命中任一简单命令的命令词；`pipeline` 命中用 `|` 连接的命令词序列；`args` 要求每个模式都命中某 token；`anyArg` 要求某 token 命中某模式（两者均支持 `!` 否定）。参数 token 含重定向目标。详见下一节。 |
| `network` | `{ domains, ips, ports, schemes }` | 网络作用域（网络规则）：调用必须携带命中每个列出维度的 URL 候选。`domains`（无通配符时包含子域）、`ips`（字面量/glob/CIDR）、`ports`（`*`、单端口或区间）、`schemes`（`http`/`https`）。详见下一节。 |

所有维度为 AND：一条规则只有在它的**每个非空维度都命中**时才命中。规则按顺序求值，**首条命中生效**；无命中 = 透传。

## network 维度

`match` 带 `network` 块的规则是**网络规则**。它只有在调用携带命中每个列出维度（AND）的 URL 候选时才命中——候选来自 web 工具的 URL 参数（`url`、`endpoint`、`webhook` 等）或 `bash`/`pwsh` 命令文本中嵌入的 URL；在代理层则直接对 shell 子进程的连接目标求值。不带 `network` 的规则保持原有文件/命令行为不变。

| 字段 | 语义 |
|---|---|
| `domains` | 域名模式，小写化并去掉末尾点。无通配符的模式包含子域——`example.com` 同时命中 `api.example.com`；`*.example.com` 只匹配子域；`*`/`**` 按普通 glob 编译。任一模式命中目标主机即满足该维度。 |
| `ips` | 精确 IPv4/IPv6 字面量、glob（`10.0.*.*`）或 IPv4 CIDR（`10.0.0.0/8`）。URL 中的字面量 IP 始终是候选；代理额外解析主机名并测试其地址，而 `tools/pre-execute` 只匹配字面量 IP（热路径不做 DNS）。任一命中即满足。 |
| `ports` | `*`、单端口（`443`）或闭区间（`8000-9000`）；接受数值型 YAML 端口。按有效端口求值（URL 端口，否则按 scheme 取 80/443）。任一命中即满足。 |
| `schemes` | `http` 和/或 `https`；目标 scheme 必须是其中之一。 |

网络块必须至少命名四个字段之一。用工具作用域限定网络规则：`tools: [bash, pwsh]`（shell 流量）、`tools: [web_fetch, web_search]`（web 工具），或留空 `tools` 同时覆盖两者。决定未列出目标的三档策略模式（`deny-all` / `whitelist` / `allow-all`，以及映射到沙箱预设的 `auto` 模式）是插件配置而非规则语法——见 README「Network policy」一节。

```yaml
rules:
  # 对 web 工具封锁一个主机；shell 代理对 curl 同样生效
  - match: { tools: [web_fetch, web_search], network: { domains: [blocked.example] } }
    action: deny
    reason: "blocked.example 禁止访问"

  # 仅放行固定的包镜像（https，白名单友好规则）
  - match: { tools: [bash, pwsh], network: { domains: ["registry.npmjs.org", "proxy.golang.org"], schemes: [https] } }
    action: allow
    reason: "固定包镜像"
```

## argv 维度（shell 命令分解）

`match` 带 `argv` 块的规则会命中命令字符串参数——即 `command`/`cmd`/`script`/`command_line`/`commandLine` 的值（任意嵌套深度）——先做词法分解再匹配。分解对引号/转义/管道/控制运算符/重定向有感知，得到每个简单命令的命令词、参数 token 与重定向目标，从而获得 `params.command` 子串 glob 无法表达的「token 级精确」匹配（例如 `rm -rf /tmp` 不是 `rm -rf /`）。

| 字段 | 语义 |
|---|---|
| `command` | 命令词 glob；**任一**简单命令的命令词命中**任一**模式即满足该字段。 |
| `pipeline` | 管道签名 glob：用 `|` 连接的命令词序列（如 `curl http://x \| sh` → `curl\|sh`）上匹配；**任一**模式命中签名即满足该字段。 |
| `args` | 参数 token 模式；**每个**模式都必须命中至少一个 token（模式间 AND、token 间任一命中）。`!` 前缀为否定（任何 token 都不得命中）。 |
| `anyArg` | 参数 token 模式；**任一** token 命中**任一**模式即满足该字段（OR）。`!` 前缀为否定。 |

四个字段之间 AND；块必须至少命名一个字段。参数 token 包含重定向目标（`echo x > /etc/passwd` 会把 `/etc/passwd` 交给 `args`/`anyArg`）。`command`、`pipeline` 始终按 glob 解释；`args`、`anyArg` 遵循 `patternMode`。通常用 `tools: [bash, pwsh]` 限定作用域，但该维度本身与工具无关（任何携带命令字符串的工具都会喂给它）。

```yaml
rules:
  # token 级精确：rm -rf / 命中，rm -rf /tmp 不命中
  - match: { tools: [bash, pwsh], argv: { command: "rm", args: ["-rf", "/"] } }
    action: deny
    reason: "rm -rf / 会清空根文件系统"

  # 下载即执行：任何「curl/wget 管道到 sh/bash」的管道
  - match: { tools: [bash, pwsh], argv: { pipeline: ["curl*|*sh", "wget*|*bash"] } }
    action: deny
    reason: "把远程抓取直接管道给 shell 会执行远程代码"
```

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

## 内置高危基线

插件随附一份内置高危基线 `rules/builtin-high-risk.yaml`（针对破坏性命令、权限提升、下载即执行与敏感路径的 deny/ask 规则）。它**默认开启**，追加在每条用户规则文件（项目链 → `searchUp` → `fallback`）**之后**，因此首匹配语义让更近的用户规则可以覆盖它；没有用户规则时它单独生效。`/rules` 会把基线规则归属到其随附源文件。

- 用 `builtin.enabled: false` 整体关闭。
- 用 `builtin.path`（绝对路径，或相对 `process.cwd()`）替换文件。
- 基线是部署级只读文件：挂载时校验（缺失/非法即响亮失败）、不监听、设置页编辑器拒绝写入。

随附基线只是示例而非穷尽策略——请用自己的项目规则扩展它。

## 与 dsh-auto-review 的分工

本插件只产出 `ask` 决定；`ask` 交给官方 `ctx.approval` 审批 seam。挂载 `dsh-auto-review` 后，其 answerer 会认领符合策略的请求并给出第二模型裁决，否则交给人类审批；两者都没有时官方 fail-closed（`unavailable` → 拒绝）。本插件**不**自己启动 reviewer 子代理。

## 加载与热更新

- 按会话 cwd 惰性发现，首次 `tools/pre-execute` 时加载并缓存（超出 `maxCachedWorkspaces` 逐出最久未用项）；缓存键为解析后的 cwd（Windows 上折叠大小写），同一目录的不同拼写共享同一条目。
- 非法 YAML / 未知字段或 action / 坏 glob 与正则 / 易回溯灾难的模式 / 超 `maxRules` 都是加载期错误：`badFilePolicy: fail`（默认）时首个使用该工作区的工具调用响亮失败；`ignore-with-warning` 时告警并降级为空规则集。
- 绝对 `rulesFile` 或配置的 `fallbackPath` 在插件挂载时即校验，缺失/非法直接挂载失败。
- 文件变更后经 Chokidar 去抖重读（`watch`、`watchStabilityThresholdMs`）；重读失败保留旧规则、只告警，绝不崩溃。`/rules reload` 手动触发同样路径；`/rules decisions` 回放审计轨迹，`/rules test` 对假设调用干跑规则。
- 预期存在但缺失的规则文件（未生效的项目文件、被删除后的 fallback）会通过其最近存在祖先目录被监听：会话中途创建即自动采纳，无需手动重载。`searchUp` 下只监听 cwd 层级的候选——更上层祖先新建规则文件仍需 `/rules reload`。
- `/rules` 列出当前规则（`list` 为显式别名）；多文件链中每条规则行标注自己的来源文件。
- `/rules test` 支持前置标志：`--cwd <目录>` 换一个工作区求值（规则发现与路径归一化都切换）；`--env 键=值`（可重复）覆盖宿主环境变量以测试 `when.env`；`--agent <选择器>`（可重复）为 `agents` 维度提供身份候选；`--platform <平台名>` 覆盖宿主平台以测试 `when.platform`。
- `enforce: false` 让插件进入干跑模式：deny/ask 命中只写审计（带 `dryRun` 标记，记录「本会做什么」与下游真实结果），所有调用照常透传——用于在生产环境先试跑新策略再强制执行。激活期间 `/rules` 会打印干跑提示。
