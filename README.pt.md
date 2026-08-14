<div align="center">

# 🛡️ dsh-permission-rules

**Regras de permissão declarativas estilo Claude Code para o DeepSeek Harness.**

*As regras decidem o que é conhecido. Um modelo revisor decide o que não é.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![Tests](https://img.shields.io/badge/tests-58%20passed-success.svg)](#desenvolvimento)
[![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](package.json)

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
- ✅ **Correspondência rica** — globs de nome de ferramenta (incluindo `mcp__*`), globs **ou** regex de chave/valor de argumentos, globs de caminhos relativos ao workspace
- ✅ **Seguro para o waterfall** — `allow`/passagem sempre chamam `next()`; somente `deny`/`ask` curto-circuitam
- ✅ **Seam de aprovação oficial** — `ask` flui por `ctx.approval`; nunca reimplementado, nunca contornado
- ✅ **Auditoria completa** — eventos `permissionRules/decision` para cada acerto e passagem
- ✅ **Recarga a quente** — vigilância Chokidar com debounce; uma edição quebrada mantém as regras anteriores, nunca quebra
- ✅ **Falha ruidosa** — YAML inválido, ações desconhecidas, globs/regex ruins ou > `maxRules` fazem a carga falhar
- ✅ **Caminho quente limitado** — matchers pré-compilados, O(regras × padrões), limitado por `maxRules`

## Início rápido

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# ou a partir de um tarball empacotado (artefatos compilados, sem permissão de build)
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.1.0.tgz

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
| `maxRules` | `256` | Limite rígido de regras; arquivos maiores falham a carga |
| `patternMode` | `glob` | Sabor dos padrões de `params`/`paths`: `glob` ou `regex` (nomes de ferramenta sempre são globs) |
| `watch` | `true` | Vigilância Chokidar + recarga ao mudar |
| `watchStabilityThresholdMs` | `200` | Janela de debounce da recarga (ms) |

### Comandos de sessão

```
/rules           lista as regras ativas, o arquivo de origem e qualquer erro de recarga
/rules reload    relê o arquivo de regras deste workspace
```

A saída dos comandos é somente UI — o modelo aprende as regras apenas pelos resultados de ferramenta que elas produzem.

## Colaboração com o dsh-auto-review

- O `dsh-permission-rules` produz `ask`; o `dsh-auto-review` responde no waterfall `approval/request` com um veredito de um segundo modelo somente leitura (ou delega para humanos). Monte os dois para o ciclo completo.
- Testado em integração (`test/integration.spec.ts`): `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, com o revisor substituído por um mock.
- A política de aprovação `never` e todas as garantias fail-closed do [harness oficial](https://github.com/deepseek-ai/deepseek-harness) permanecem intactas.

## Limites de segurança

- **Política, não kernel.** Os candidatos de `paths` vêm apenas de um conjunto documentado de chaves de argumentos, e somente caminhos relativos ao workspace correspondem.
- **Nenhum revisor aqui.** O plugin nunca lança subagentes nem chama modelos — produzir uma decisão `ask` é o fim do seu trabalho.
- **Sem mudanças de sandbox.** A política de sandbox no nível do SO pertence ao seam de sandbox, não a este plugin.
- **Configuração errada ruidosa.** Campos YAML desconhecidos, ações desconhecidas e padrões ruins são rejeitados na carga, nunca ignorados em silêncio.

## Trabalho relacionado

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — classificador allow/deny de dois estados com auditoria em arquivo próprio; este plugin adiciona a semântica completa de três estados, regras YAML declarativas, auditoria no log de sessão e delegação segura com `next()`.
- `Drifter-yh/dsh-tool-policy` — política de ferramentas deny-by-default; documentada aqui para evitar implementação duplicada.
- `dsh-auto-review` — a metade de apoio de IA do ciclo que este plugin lidera.

## Limitações conhecidas

- `permissionRules/decision` é gravado com o marcador de envelope `ignorable: true`, então qualquer build do harness carrega o log — leitores que não conhecem o tipo fora do repositório simplesmente pulam o registro de auditoria em vez de recusar a sessão. (Hosts rc.6 aceitam e ignoram o marcador, mantendo exatamente o comportamento anterior.)
- Os candidatos de `paths` são heurísticos: apenas as chaves de argumentos documentadas alimentam a correspondência de caminhos.
- Os globs são um subconjunto conservador (sem expansão de chaves) — escreva dois padrões ou use o modo regex.

## Desenvolvimento

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc, src + tests
pnpm test           # vitest: 58 tests, 7 suites
pnpm run build      # declarações tsc + bundles tsdown (lib/)
pnpm pack           # artefato de publicação
```

Veja [VERIFICATION.md](VERIFICATION.md) para o registro de verificação headless de ponta a ponta (deny bloqueando uma ferramenta de shell, ask roteado pelo seam de aprovação, `--dump-config`).

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
