<div align="center">

# 🛡️ dsh-permission-rules

**Regras de permissão declarativas estilo Claude Code para o DeepSeek Harness.**

*As regras decidem o que é conhecido. Um modelo revisor decide o que não é.*

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

## O que ele faz

O `dsh-permission-rules` coloca uma lista ordenada de regras **`allow` / `deny` / `ask`** na frente de cada chamada de ferramenta no waterfall `tools/pre-execute` — determinístico, instantâneo, auditável e escrito por você em YAML puro:

- **`deny`** bloqueia a chamada. O `reason` da regra vira o erro visível para o modelo, para que o agente aprenda o *porquê* em vez de tentar de novo às cegas.
- **`ask`** usa o seam de aprovação oficial. Monte o `dsh-auto-review` junto e a pergunta é decidida por um segundo modelo; caso contrário, um humano responde; sem nenhum dos dois, o harness falha fechado (fail-closed).
- **`allow`** (e a ausência de correspondência) delega estritamente via `next()` — os listeners seguintes nunca são curto-circuitados.

Cada acerto **e** cada passagem direta é auditado como evento de sessão `permissionRules/decision` (somente registro — nada extra é injetado no contexto do modelo).

```text
waterfall tools/pre-execute                     waterfall approval/request (cadeia de answerers)
        │                                                   │
  dsh-permission-rules                                answerer dsh-auto-review
   · primeira correspondência em ordem ┌───────────────────┴──────────────┐
   · deny/ask reivindicam a chamada    │ veredito de IA (segundo modelo)    │ não ── next() ──▶ UI humana
   · allow/passagem → next()           └───────────────────┬──────────────┘
        │ deny ──▶ resultado negado                     │ allowed-once / rejected
        │ ask  ──▶ ctx.approval ────────────────────────┘
        │
   auditoria: permissionRules/decision → approval/asked → autoReview/verdict → approval/decided
```

## Por que regras *e* um revisor?

Um segundo modelo responde *"ESTA chamada é segura?"* com julgamento, mas custa uma ida e volta e pode errar. Regras declarativas respondem de forma determinística, instantânea e sem modelo — mas só cobrem o que um administrador escreveu. Combinados, você obtém o ciclo **"regras primeiro, IA de apoio"**: as regras decidem o conhecido, o revisor decide o desconhecido.

## Funcionalidades

- ✅ **Semântica de três estados** — `allow`, `deny`, `ask`, avaliadas na ordem do arquivo; a primeira correspondência vence
- ✅ **Correspondência rica** — globs de nome de ferramenta (incluindo `mcp__*`), seletores de identidade de agente (`main` / `subagent` / `preset:*`), globs **ou** regex de chave/valor de argumentos (com negação `!pattern` e a dimensão de chave `absent`), globs de caminhos relativos ao workspace extraídos de chaves de argumentos documentadas em **qualquer profundidade de aninhamento**, e condições de host `when` (variáveis de ambiente, plataforma)
- ✅ **Arquivos de regras hierárquicos** — `searchUp` opcional combina cada `.dsh/rules.yaml` do cwd da sessão até a raiz do sistema de arquivos, o mais próximo primeiro, para que um projeto filho possa sobrescrever regras do pai
- ✅ **Metadados de regras** — `enabled: false`, `description`, `tags`; `/rules` avisa sobre regras encobertas por um catch-all anterior
- ✅ **Seguro para o waterfall** — `allow`/passagem sempre chamam `next()`; somente `deny`/`ask` curto-circuitam
- ✅ **Seam de aprovação oficial** — `ask` flui por `ctx.approval`; nunca reimplementado, nunca contornado
- ✅ **Auditoria completa** — os eventos `permissionRules/decision` carregam a ação da regra, o cwd do workspace E o resultado final de cada chamada; `/rules decisions` reproduz o rastro na sessão; hosts anteriores ao marcador de envelope de auditoria degradam para auditoria desativada com um aviso único em vez de gravar registros irrecuperáveis (`allowUnmarkedAudit` reativa)
- ✅ **Implantação em simulação** — `enforce: false` audita o que a política *faria* (ação hipotética + resultado real posterior, marcado com `dryRun`) enquanto deixa todas as chamadas passarem; teste seguro de políticas em produção
- ✅ **Teste em seco** — `/rules test <tool> <json-args>` avalia as regras ativas sem executar nada, com sobrescritas `--cwd`, `--env`, `--agent` e `--platform` para cada dimensão
- ✅ **Recarga a quente** — vigilância Chokidar com debounce; uma edição quebrada mantém as regras anteriores, nunca quebra; um arquivo de regras criado no meio da sessão (o do projeto ou o fallback) é adotado automaticamente, sem recarga manual
- ✅ **Falha ruidosa** — YAML inválido, ações/campos desconhecidos, globs/regex ruins, padrões propensos a backtracking ou > `maxRules` fazem a carga falhar
- ✅ **Caminho quente limitado** — matchers pré-compilados, O(regras × padrões), limitado por `maxRules`; o grau de backtracking de glob limitado por `maxGlobStars`

## Início rápido

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# ou a partir de um tarball empacotado (artefatos compilados, sem permissão de build)
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.4.1.tgz

# 2. reinicie
dsh --profile web
```

Depois crie o arquivo de regras do seu projeto e inicie uma sessão nele:

```yaml
# <project>/.dsh/rules.yaml
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "Sem push a partir de caminhos protegidos"

  - match: { tools: [edit, write] }
    action: ask
    reason: "Escrita de arquivos precisa de confirmação"
```

```sh
dsh --profile web --dump-config | grep -A4 'id: permission-rules'   # verifique a linha
```

Uma linha de base de segurança completa com 5 regras e o esquema completo estão em [docs/rules-format.en.md](docs/rules-format.en.md).

## Configuração

Todos os ajustes são campos `Config` do Schemastery (alteráveis no cordis.yml). Uma sobrescrita direcionada por id substitui a linha inteira — reescreva todas as chaves que você precisa.

| Chave | Padrão | Significado |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Local do arquivo de regras; relativo = resolvido contra o cwd da sessão, absoluto = global e validado na montagem |
| `fallbackPath` | *(nenhum)* | Arquivo de regras usado quando a descoberta por cwd não encontra nada; validado na montagem |
| `badFilePolicy` | `fail` | Arquivo ruim: `fail` faz a chamada pendente falhar ruidosamente (recargas mantêm as regras anteriores); `ignore-with-warning` avisa e segue vazio |
| `maxRules` | `256` | Limite rígido de regras em toda a cadeia de fontes efetiva; arquivos maiores falham a carga |
| `maxCachedWorkspaces` | `512` | Limite rígido de cargas de regras por workspace em cache; além dele o menos usado recentemente (e seu watcher) é expulso |
| `patternMode` | `glob` | Sabor dos padrões de `params`/`paths`/`when.env`: `glob` ou `regex` (nomes de ferramenta sempre são globs) |
| `watch` | `true` | Vigilância Chokidar + recarga ao mudar |
| `watchStabilityThresholdMs` | `200` | Janela de debounce da recarga (ms) |
| `language` | `en` | Idioma da saída do `/rules`: `en`, `zh`, `es`, `pt`, `hi` (`en`/`zh` são as traduções de referência) |
| `caseInsensitivePaths` | *(win32)* | Padrões de `paths` e comparação com a raiz do workspace ignoram maiúsculas ASCII; por padrão `true` no Windows, `false` nos demais |
| `audit` | `all` | Granularidade da auditoria: `all` registra cada acerto E passagem; `hits` pula eventos de passagem |
| `searchUp` | `false` | Percorre os diretórios pais a partir do cwd da sessão e combina cada arquivo de regras encontrado, o mais próximo primeiro |
| `maxGlobStars` | `2` | Limite rígido de quantificadores `*`/`**` ilimitados por padrão glob (cota do grau de backtracking) |
| `enforce` | `true` | `false` = modo simulação: acertos deny/ask são apenas registrados na auditoria com um marcador `dryRun` (ação hipotética + resultado real posterior) e todas as chamadas passam — teste uma política antes de aplicá-la |
| `allowUnmarkedAudit` | `false` | Hosts cujo `Session.append` é anterior ao marcador `ignorable` (a linha `0.1.0-rc.6`) gravam eventos de auditoria sem marcação, tornando as sessões irrecuperáveis em builds mais rígidos: o plugin os detecta e desativa a auditoria do registro da sessão com um aviso único. Defina `true` para reativar o rastro na sessão (repare registros existentes com `scripts/repair-session-logs.mjs`) |

### Comandos de sessão

```
/rules                        lista as regras ativas, seus arquivos de origem e qualquer erro da última recarga
/rules list                   alias explícito da listagem simples
/rules reload                 relê a cadeia de arquivos de regras deste workspace
/rules decisions [n]          mostra as últimas n decisões de permissão desta sessão (padrão 10)
/rules test <tool> <json>     avalia em seco as regras contra uma chamada hipotética, ex.: /rules test bash {"command":"git push origin main"}
```

`/rules test` também aceita sinalizadores iniciais: `--cwd <dir>` avalia contra outro workspace, `--env CHAVE=VALOR` (repetível) sobrescreve o ambiente para `when.env`, `--agent <seletor>` (repetível) fornece candidatos de identidade para a dimensão `agents`, e `--platform <nome>` sobrescreve a plataforma para `when.platform`. Em cadeias de vários arquivos (ex.: `searchUp`), cada linha de regra é atribuída ao seu próprio arquivo de origem.

A saída dos comandos é somente UI — o modelo aprende as regras apenas pelos resultados de ferramenta que elas produzem. `language` escolhe o idioma da saída. Um JSON Schema do arquivo de regras é distribuído em [docs/rules-format.schema.json](docs/rules-format.schema.json) (conecte-o com `# yaml-language-server: $schema=...` para autocompletar no editor).

## Colaboração com o dsh-auto-review

- O `dsh-permission-rules` produz `ask`; o `dsh-auto-review` responde no waterfall `approval/request` com um veredito de um segundo modelo somente leitura (ou delega para humanos). Monte os dois para o ciclo completo.
- Testado em integração (`test/integration.spec.ts`): `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, com o revisor substituído por um mock.
- A política de aprovação `never` e todas as garantias fail-closed do [harness oficial](https://github.com/deepseek-ai/deepseek-harness) permanecem intactas.

## Limites de segurança

- **Política, não kernel.** Os candidatos de `paths` vêm apenas de um conjunto documentado de chaves de argumentos, e somente caminhos relativos ao workspace correspondem.
- **Nenhum revisor aqui.** O plugin nunca lança subagentes nem chama modelos — produzir uma decisão `ask` é o fim do seu trabalho.
- **Sem mudanças de sandbox.** A política de sandbox no nível do SO pertence ao seam de sandbox, não a este plugin.
- **Configuração errada ruidosa.** Campos YAML desconhecidos, ações desconhecidas e padrões ruins são rejeitados na carga, nunca ignorados em silêncio.
- **Limites de backtracking.** Padrões glob são limitados a `maxGlobStars` expansões de estrela ilimitadas; padrões em modo regex rejeitam quantificadores aninhados ilimitados e alternâncias literais sobrepostas quantificadas. (Cadeias regex como `\d+\.\d+\.\d+` permanecem permitidas — o modo regex é a válvula de escape, o modo glob é o padrão protegido.)

## Trabalho relacionado

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — classificador allow/deny de dois estados com auditoria em arquivo próprio; este plugin adiciona a semântica completa de três estados, regras YAML declarativas, auditoria no log de sessão e delegação segura com `next()`.
- `Drifter-yh/dsh-tool-policy` — política de ferramentas deny-by-default; documentada aqui para evitar implementação duplicada.
- `dsh-auto-review` — a metade de apoio de IA do ciclo que este plugin lidera.

## Limitações conhecidas

- `permissionRules/decision` é anexado com o marcador de envelope `ignorable: true`, então qualquer build do harness carrega o log — leitores que não conhecem o tipo fora do repositório simplesmente pulam o registro de auditoria em vez de recusar a sessão. Hosts cujo `Session.append` é anterior ao marcador (a linha `0.1.0-rc.6`) o DESCARTAM silenciosamente: o plugin os detecta em tempo de execução (verificação prévia da versão do peer + sonda do envelope anexado) e desativa a auditoria do registro da sessão com um aviso único, mantendo os registros carregáveis em qualquer lugar. Defina `allowUnmarkedAudit: true` para reativar o rastro na sessão; registros já gravados sem o marcador podem ser reparados com `scripts/repair-session-logs.mjs` antes de carregar em hosts com semântica required-on-read.
- Os candidatos de `paths` são heurísticos: apenas as chaves de argumentos documentadas alimentam a correspondência de caminhos, e a correspondência relativa ao workspace ignora maiúsculas ASCII somente quando `caseInsensitivePaths` está ativo.
- Os globs são um subconjunto conservador (sem expansão de chaves) — escreva dois padrões ou use o modo regex.
- O guard de backtracking de regex é estrutural, não exaustivo: casos de ambiguidade por alternância sem prefixos literais (ex.: lookarounds elaborados) são responsabilidade do autor; prefira o modo glob para arquivos não confiáveis.

## Reparo de registros de sessão

Registros de sessão gravados antes do marcador `ignorable` podem ser recusados por builds mais novos do harness (`SessionFormatUnsupportedError`). O `scripts/repair-session-logs.mjs` incluído reescreve apenas as linhas de auditoria alvo para adicionar `ignorable: true`, preservando os frames, com backups:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # relata linhas externas, sem alterar
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` por padrão é `$DSH_HOME/sessions` (ou `~/.dsh/sessions`). O contrato completo está no cabeçalho do script.

## Desenvolvimento

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc, src + tests
pnpm run lint       # eslint, src + tests + scripts
pnpm test           # vitest: 139 tests, 9 suites
pnpm run test:coverage  # portão de cobertura (90/80/90/90)
pnpm run build      # declarações tsc + bundles tsdown (lib/)
pnpm run pack:check # build + pack (o artefato publicado)
node scripts/check-readme-sync.mjs  # portão de sincronização dos READMEs em cinco idiomas (também na CI)
```

Veja [VERIFICATION.md](VERIFICATION.md) para o registro de verificação headless de ponta a ponta (deny bloqueando uma ferramenta de shell, ask roteado pelo seam de aprovação, `--dump-config`).

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: vocabulário e avaliação de regras, runtime, vigilância HMR, auditoria do registro da sessão e documentação em cinco idiomas.
- [@22xuan](https://github.com/22xuan) — o relatório detalhado sobre hosts rc.6 descartando silenciosamente o marcador `ignorable` dos eventos de auditoria ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) e a discussão no harness upstream; a detecção de capacidade do host da v0.4.1 e a correção da documentação derivam diretamente dessa análise.

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
