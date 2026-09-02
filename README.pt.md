<div align="center">

# 🛡️ dsh-permission-rules
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-permission-rules` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

**Regras de permissão declarativas estilo Claude Code para o DeepSeek Harness.**

*Regras decidem o conhecido. Um modelo revisor decide o que não é.*

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
| Harness | DeepSeek Harness `0.1.2-alpha.5` (adaptado em 2026-09-02): o envelope de sessão mantém seu campo ignorable apenas para compatibilidade de leitura de logs armazenados - o Session.append ainda não consegue estampá-lo, então o comportamento da porta não muda. |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Todas (host + cliente web de settings) |
| Model | Qualquer (razões deny/ask aparecem pelos resultados de ferramenta) |

## What you get

O `dsh-permission-rules` antepõe uma lista ordenada de regras **`allow` / `deny` / `ask`** a cada chamada de ferramenta na cascata `tools/pre-execute` — determinística, instantânea, auditável e escrita por você em YAML puro:

- **`deny`** bloqueia a chamada; a `reason` da regra vira o erro visível para o modelo.
- **`ask`** usa a costura oficial de aprovação (monte o `dsh-auto-review` para um answerer de segundo modelo, ou um humano responde; sem nenhum, o harness falha fechado).
- **`allow`** (e sem correspondência) delega estritamente via `next()` — os listeners posteriores nunca são curto-circuitados.

Cada acerto **e** cada passagem direta é registrada como um evento de sessão `permissionRules/decision` (somente log — nada extra é injetado no contexto do modelo).

- **Correspondência rica** — globs de nome de ferramenta (incl. `mcp__*`), seletores de identidade de agente (`main` / `subagent` / `preset:*`), globs **ou** regexes de chave/valor de argumentos (com negação `!pattern` e dimensão de chave `absent`), globs de caminho relativos ao workspace em **qualquer profundidade de aninhamento**, condições de host `when` (variáveis de ambiente, plataforma), e **decomposição de comandos de shell** (`argv`: palavra de comando, tokens de argumento, assinatura de pipeline) para correspondência precisa por token.
- **Linha de base de alto risco integrada** — um conjunto deny/ask embarcado (comandos destrutivos, escalada de privilégios, baixar-e-executar, caminhos sensíveis) habilitado por padrão e anexado após as regras de usuário (uma regra de usuário mais próxima pode sobrescrevê-lo); alterna com `builtin.enabled`.
- **Arquivos de regras hierárquicos** — `searchUp` opcional mescla cada `.dsh/rules.yaml` do cwd da sessão até a raiz do sistema de arquivos, o mais próximo primeiro.
- **Implantação em dry-run** — `enforce: false` audita o que a política *faria* enquanto deixa cada chamada passar.
- **Recarga a quente** — vigilância Chokidar com debounce; uma edição quebrada mantém as regras anteriores, nunca falha.
- **Falha ruidosa** — YAML inválido, ações/campos desconhecidos, globs/regexes ruins, padrões propensos a backtracking ou mais de `maxRules` regras falham a carga.

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

- **Dimensões de correspondência** — `tools` (globs, incl. `mcp__*`), `agents` (`main` / `subagent` / `preset:<name>`; identidade desconhecida nunca corresponde — falha fechado), `params` (globs ou regexes de chave/valor, negação `!pattern`, dimensão de chave `absent`), `paths` (globs relativos ao workspace extraídos a qualquer profundidade), `when` (globs/regexes de variáveis `env` + lista `platform` fechada), e `network` (`domains` / `ips` / `ports` / `schemes` — globs, curingas, CIDR, faixas de porta).
- **Ações** — `allow` / `deny` / `ask`, avaliadas em ordem de arquivo, primeira correspondência vence.
- **Metadados de regra** — `enabled: false` (visível mas inerte), `description`, `tags`; campos desconhecidos falham a carga.
- **Schema** — um JSON Schema é distribuído em [docs/rules-format.schema.json](docs/rules-format.schema.json) (autocompletar de editor via `# yaml-language-server: $schema=...`); o vocabulário completo e uma linha base de 5 regras vivem em [docs/rules-format.en.md](docs/rules-format.en.md).

## Network policy

Uma **política de rede em nível de processo** estilo Codex: o tráfego de subprocessos de shell flui por um **proxy HTTP/CONNECT** local integrado, e cada conexão é decidida por regras de rede ordenadas ou por três modos mapeados sobre os presets oficiais do sandbox:

- **`deny-all`** — o preset de sandbox somente leitura: bloquear todo o tráfego de saída.
- **`whitelist`** — o preset workspace-write: permitir destinos listados, `unlisted: ask` (ou `deny`) para o resto.
- **`allow-all`** — o preset danger-full-access: permitir tudo.
- **`auto`** (padrão) — segue o preset do sandbox; em hosts sem o serviço de política de sandbox resolve para `autoFallback` (`allow-all`).

- **Correspondência** — `match.network` com `domains` / `ips` / `ports` / `schemes` (globs, curingas, CIDR, faixas de porta; portas YAML numéricas são aceitas). A extração de candidatos URL na rota quente `tools/pre-execute` dispara sobre argumentos de ferramentas web e URLs embutidas em texto de comando bash/pwsh; destinos de loopback podem curto-circuitar regras conforme a política `loopback`.
- **Auditoria** — conexões negadas anexam `permissionRules/network` à sessão proprietária (a mesma porta adaptativa `ignorable`), com contadores de bloqueio e intercepções recentes em `/rules network` e na página de settings.

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

- **canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"` — o script `prepare` compila apenas com dependências de produção.
- **canal npm** (versões publicadas): `dsh plugin --profile web add dsh-permission-rules`.
- **canal tarball**: `pnpm pack` neste repo, depois `dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz`.
- **desinstalar**: `dsh plugin --profile web remove dsh-permission-rules`.

## Configuration

Todos os parâmetros são campos Schemastery `Config` (alteráveis pelo cordis.yml). Uma sobrescrita direcionada por id substitui a linha inteira — reafirme cada chave de que precisa.

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Local do arquivo de regras; relativo = resolvido contra o cwd da sessão, absoluto = global e validado na montagem |
| `fallbackPath` | *(none)* | Arquivo de regras usado quando a detecção por cwd não encontra nada; validado na montagem |
| `badFilePolicy` | `fail` | Arquivo de regras ruim: `fail` faz a chamada pendente falhar ruidosamente; `ignore-with-warning` avisa e continua vazio |
| `maxRules` | `256` | Limite rígido de contagem de regras na cadeia fonte efetiva |
| `maxCachedWorkspaces` | `512` | Limite rígido de cargas de regras por workspace em cache (evicção LRU) |
| `patternMode` | `glob` | Sabor de padrão `params`/`paths`/`when.env`: `glob` ou `regex` (nomes de ferramenta são sempre globs) |
| `watch` | `true` | Vigilância Chokidar + recarga ao mudar |
| `watchStabilityThresholdMs` | `200` | Janela de debounce de recarga (ms) |
| `language` | `en` | Idioma de saída de `/rules`: `en`, `zh`, `es`, `pt`, `hi` |
| `caseInsensitivePaths` | *(win32)* | Padrões `paths` e comparação de raiz do workspace ignoram maiúsculas ASCII; `true` no Windows |
| `audit` | `all` | Granularidade de auditoria: `all` registra cada acerto E passagem; `hits` omite eventos de passagem |
| `searchUp` | `false` | Percorrer diretórios pai do cwd e mesclar cada arquivo de regras encontrado, o mais próximo primeiro |
| `maxGlobStars` | `2` | Limite rígido de quantificadores `*`/`**` não limitados por padrão glob |
| `enforce` | `true` | `false` = modo dry-run: acertos deny/ask são registrados com marcador `dryRun` e cada chamada passa |
| `allowUnmarkedAudit` | `false` | Hosts anteriores ao marcador descartam o marcador `ignorable`; o plugin desativa a auditoria de log com um aviso. Ponha `true` para reativar |
| `network.enabled` | `true` | Interruptor mestre do proxy, da injeção de ambiente e dos padrões de modo de ferramenta web |
| `network.mode` | `auto` | Modo de política: `auto` segue o preset do sandbox, ou `deny-all` / `whitelist` / `allow-all` |
| `network.autoFallback` | `allow-all` | Modo usado quando `auto` não tem serviço de política de sandbox |
| `network.unlisted` | `ask` | Manejo em modo whitelist de destinos sem regra coincidente: `ask` ou `deny` |
| `network.proxyBind` | `127.0.0.1` | Endereço de vínculo do proxy local (somente loopback) |
| `network.proxyPort` | `0` | Porta do proxy local; `0` escolhe uma porta efêmera livre |
| `network.proxyMaxRecent` | `100` | Limite de registros de bloqueio recentes para a página de settings |
| `network.loopback` | `allow` | Destinos de loopback: `allow` (paridade Codex) ou `policy` |
| `network.injectEnv` | `true` | Se variáveis de ambiente do proxy são injetadas para subprocessos |
| `network.noProxy` | `clear` | Manejo de NO_PROXY em subprocessos: `clear` aplica a política ou `preserve` |
| `builtin.enabled` | `true` | Linha de base de alto risco integrada: `false` desabilita por completo o conjunto deny/ask embarcado |
| `builtin.path` | *(embarcado)* | Arquivo de linha de base de substituição (absoluto, ou relativo a `process.cwd()`); validado ao montar |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `tools/pre-execute` | listener | Regras allow/deny/ask de primeira correspondência + extração de candidatos URL de rede |
| `/rules` | command | `list` · `reload` · `decisions [n]` · `test <tool> <json>` |
| `permissionRules/decision` | event | Auditoria somente de log para cada acerto e passagem |
| `permissionRules/network` | event | Auditoria da camada de proxy para conexões bloqueadas |
| HTTP/CONNECT proxy | service | Proxy local integrado que governa o tráfego de subprocessos de shell |
| settings page | client | Editor de modo de rede, editor de regras, contadores de bloqueio, intercepções recentes |

```
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call
```

`/rules test` também aceita bandeiras iniciais: `--cwd <dir>`, `--env KEY=VALUE` (repetível), `--agent <selector>` (repetível) e `--platform <name>`. Em cadeias multi-arquivo (ex.: `searchUp`), cada linha de regra listada é atribuída ao seu próprio arquivo fonte.

## Permissions & data

- **Permissions**: o manifesto de workshop declara `files:read`, `files:watch`, `files:write`, `session:append` e `network:outbound`. Decisões `ask` usam a costura oficial de aprovação — nada é reimplementado ou contornado.
- **Data**: arquivos de regras são lidos do disco; nenhum dado de regra é escrito. Sem chamadas de modelo, sem subagentes revisores.
- **Session log**: `permissionRules/decision` nunca é injetado no contexto do modelo e é anexado com o marcador `ignorable: true` do envelope, de modo que qualquer build do harness carrega o log.

## Security boundaries

- **Política, não kernel.** Candidatos `paths` vêm apenas de um conjunto documentado de chaves de argumento (a qualquer profundidade, com limite), e apenas caminhos relativos ao workspace correspondem.
- **Aqui não há revisor.** O plugin nunca gera subagentes nem chama modelos — produzir uma decisão `ask` é o fim do seu trabalho.
- **Sem mudanças de sandbox.** A política de sandbox em nível de SO pertence à costura do sandbox, não a este plugin.
- **Rejeição ruidosa de má configuração.** Campos YAML desconhecidos, ações desconhecidas e padrões ruins são rejeitados na carga.
- **Limites de backtracking.** Padrões glob são limitados a `maxGlobStars` expansões de estrela não limitadas; padrões regex rejeitam quantificadores aninhados não limitados e alternâncias literais sobrepostas quantificadas.

## Known limitations

- **Marcador de auditoria em hosts anteriores ao marcador ou que rejeitam eventos.** `permissionRules/decision` é anexado com `ignorable: true`; hosts cujo `Session.append` é anterior ao marcador (as linhas `0.1.0-rc.1`–`rc.7` e `0.1.1-rc.1`–`rc.7`) o descartam silenciosamente, e a linha `0.1.2-alpha` rejeita eventos de plugin na leitura mesmo marcados — o runtime detecta ambos antes do primeiro append e desativa a auditoria de log com um aviso único. Ponha `allowUnmarkedAudit: true` para reativar; repare logs já escritos com `scripts/repair-session-logs.mjs` (seu modo `strip` remove linhas de auditoria onde o marcador não ajuda).
- **Candidatos de caminho são heurísticos.** Somente as chaves de argumento documentadas alimentam a correspondência de caminho, e a correspondência relativa ao workspace é insensível a maiúsculas ASCII apenas com `caseInsensitivePaths` ativado.
- **Globs são um subconjunto conservador.** Sem expansão de chaves — escreva dois padrões, ou use o modo regex.
- **A guarda de backtracking de regex é estrutural, não exaustiva.** Prefira o modo glob para arquivos não confiáveis.

## Collaborating with dsh-auto-review

- O `dsh-permission-rules` produz `ask`; o `dsh-auto-review` responde na cascata `approval/request` com um veredito de segundo modelo somente leitura (ou delega a humanos). Monte ambos para o laço completo fechado.
- Testado em integração: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, com o revisor substituído por um mock roteirizado.
- A política de aprovação `never` e toda garantia de falha fechada do harness oficial permanecem intactas.

## Session log repair

Logs de sessão escritos antes de o marcador `ignorable` existir podem ser recusados por builds mais novas do harness (`SessionFormatUnsupportedError`). O `scripts/repair-session-logs.mjs` distribuído reescreve apenas as linhas de auditoria alvo para carregar `ignorable: true`, preservando quadros, com backups:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # relata linhas estranhas, não muda nada
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` por padrão é `$DSH_HOME/sessions` (ou `~/.dsh/sessions`).

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 236 tests, 20 files
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # five-language README sync gate (also in CI)
```

Consulte [VERIFICATION.md](VERIFICATION.md) para o registro de verificação end-to-end sem cabeça.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: vocabulário e avaliação de regras, runtime, vigilância HMR, auditoria de log de sessão, política de rede + proxy, e a documentação em cinco idiomas.
- [@22xuan](https://github.com/22xuan) — o relatório detalhado sobre hosts rc.6 descartando silenciosamente o marcador `ignorable` do evento de auditoria ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) e a discussão do harness upstream; a detecção de capacidade de host em runtime v0.4.1 e a correção de documentação se derivaram diretamente dessa análise.
- [@sjh9714](https://github.com/sjh9714) — propôs o corpus compartilhado de vetores de teste de sintaxe de regras ([#4](https://github.com/PerryLink/dsh-permission-rules/issues/4), [#5](https://github.com/PerryLink/dsh-permission-rules/issues/5)), incluído na v0.5.1 como `docs/rule-test-vectors/`, e contribuiu com os casos-limite de decomposição AST na [discussão de design](https://github.com/PerryLink/dsh-permission-rules/discussions/10).
- [@weipeng1999](https://github.com/weipeng1999) — a proposta de decomposição de comandos baseada em AST ([#8](https://github.com/PerryLink/dsh-permission-rules/issues/8)) por trás da discussão de design.
- [@alexchenzl](https://github.com/alexchenzl) — a solicitação de inclusão no DSH Directory ([#7](https://github.com/PerryLink/dsh-permission-rules/issues/7)).
- [@zl190](https://github.com/zl190) — relatou e verificou a lacuna de compatibilidade do harness `0.1.0-rc.7` ([PR #9](https://github.com/PerryLink/dsh-permission-rules/pulls/9)).
- [@cuohua](https://github.com/cuohua) — relatou que a linha `0.1.1-rc` ainda descarta o marcador `ignorable` embora a verificação de versão cobrisse apenas `0.1.0` ([#11](https://github.com/PerryLink/dsh-permission-rules/issues/11)); a verificação ampliada veio diretamente dessa análise.

## PerryLink DSH Plugin Family

Este projeto é um dos [33 plugins de DeepSeek Harness](https://github.com/PerryLink) mantidos por [PerryLink](https://github.com/PerryLink). Se este ajuda você, os outros provavelmente também:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | Auto-revisão de segundo modelo na cadeia de aprovação, com falha fechada por padrão | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | Agentes filhos em segundo plano duráveis com barra lateral de UI web, mensagens e interrupção | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | Governança de custos para DeepSeek Harness: orçamentos, carbono e latência em um painel. | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Equivalente ao /rewind do Claude Code: instantâneos, bifurcações de sessão, restauração de uso único | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Migre sessões, memória, habilidades e CLAUDE.md do Claude Code para o DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | Controle de desktop nativo multiplataforma para DeepSeek Harness — Windows primeiro. | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Histórico de entrada estilo terminal para o compositor web: setas, busca Ctrl+R | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | Verificações de qualidade de datasets e verificação de citações (a ponte numérica opcional consumida aqui) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | Defesa contra injeção de prompt, jailbreak e vazamento de segredos para DeepSeek Harness. | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | Guardião de disciplina de engenharia: sabatina de requisitos, portões de teste, revisão adversária | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | Roteamento unificado de geração de imagens estáticas para DeepSeek Harness. | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | Diagnóstico de desempenho só de leitura para DeepSeek Harness. | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | Relatórios de pesquisa deterministas para fundos mútuos públicos chineses | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | Integração de PR/issues do GitHub para o DSH, cada escrita controlada por aprovação | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | Orquestração de pesquisa setorial que sela as suas entregas através do `ctx.researchReport.assemble` deste plugin | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | Base de conhecimento documental local para DeepSeek Harness. | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | Integração de modelos locais (Ollama) para DeepSeek Harness. | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | Diagnósticos, formatação, autocompletar, ações de código e renomeação LSP sobre servidores de linguagem | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | Middleware de mascaramento de PII: anonimiza no limite do modelo, restaura na camada de exibição | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | Painel de tempo de execução MCP somente leitura: comando /mcp + aba Settings com status, ferramentas e erros | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | Memória entre sessões controlada por aprovação: costura ctx.memory + SQLite + ferramenta de memória | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | Exportador de observabilidade OpenTelemetry e Langfuse para DeepSeek Harness. | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Troca de estilo em tempo de execução equivalente ao outputStyles do Claude Code | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | Base de conhecimento de desenvolvimento de plugins como habilidade de agente sob demanda | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | Motor de relatórios de pesquisa verificáveis com evidência endereçada por conteúdo | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | Pontuação de qualidade multidimensional para plugins de DeepSeek Harness. | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | Fixe sessões na barra lateral web com ordenação durável | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | Sincronização de sessões entre dispositivos para DeepSeek Harness — um espelho git dedicado do seu armazenamento de sessões. | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | Pacote de habilidades de auditoria de segurança: varredura de segredos, revisão de dependências e cadeia de suprimentos | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | Loop de sessão com voz para DeepSeek Harness: fale e ouça a resposta. | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | Test drives isolados de instalação e smoke para plugins de DeepSeek Harness. | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | Tradução de parâmetros entre fornecedores e reparo determinístico de JSON para DeepSeek Harness. | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
