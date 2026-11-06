<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-permission-rules-hero-en-dark.webp">
  <img src="docs/assets/dsh-permission-rules-hero-en-light.webp" width="100%" alt="O livro de decisões do dsh-permission-rules: a primeira correspondência de uma cadeia ordenada de regras, seu cartão de veredito deny e a faixa do proxy para a saída de shell">
</picture>

# dsh-permission-rules

**Retome a autoridade de decisão sobre as chamadas de ferramentas: cada allow / deny / ask vive em YAML, de forma determinística, instantânea e auditável.**

Um middleware de permissões declarativo no estilo Claude Code para o DeepSeek Harness: as regras decidem o que é conhecido e um modelo revisor decide o que não é; ele também traz uma política de rede em nível de processo no estilo Codex e um proxy local que governam a saída dos subprocessos de shell.

[Instalar](#instalação-em-três-passos) · [Configuração](#configuração) · [FAQ](#faq) · [简体中文](README.md) · [English](README.en.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-3366CC?style=flat-square&labelColor=2B3245)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.1.2%20%3C0.3.0-4B67B4?style=flat-square&labelColor=2B3245)](#compatibilidade)
[![npm](https://img.shields.io/npm/v/dsh-permission-rules?style=flat-square&labelColor=2B3245&color=CB3837)](https://www.npmjs.com/package/dsh-permission-rules)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI&style=flat-square&labelColor=2B3245)](https://github.com/PerryLink/dsh-permission-rules/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24.9-339933?style=flat-square&labelColor=2B3245)](#compatibilidade)

[![Stars](https://img.shields.io/github/stars/PerryLink/dsh-permission-rules?style=flat-square&labelColor=2B3245)](https://github.com/PerryLink/dsh-permission-rules/stargazers)
[![npm downloads](https://img.shields.io/npm/dm/dsh-permission-rules?style=flat-square&labelColor=2B3245&color=CB3837)](https://www.npmjs.com/package/dsh-permission-rules)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-permission-rules?metric=downloads)](https://dshfind.com/plugins/PerryLink/dsh-permission-rules?ref=badge)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-permission-rules/badge)](https://securityscorecards.dev/viewer/?uri=github.com/PerryLink/dsh-permission-rules)
[![DSH Market](https://img.shields.io/badge/DSH_Market-listed-4B67B4?style=flat-square&labelColor=2B3245)](https://dsh.market/)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-C71D23?style=flat-square&labelColor=2B3245&logo=gitee)](https://gitee.com/perrylink/dsh-permission-rules)

```sh
dsh plugin --profile <name> add dsh-permission-rules
```

</div>

<sub>Plugin da comunidade, sem afiliação com a DeepSeek. Repositório canônico: <https://github.com/PerryLink/dsh-permission-rules> (o Gitee é um espelho).</sub>

## O que é

O `dsh-permission-rules` coloca uma lista ordenada de regras **`allow` / `deny` / `ask`** na frente de cada chamada de ferramenta no waterfall `tools/pre-execute`: determinística, instantânea, auditável e escrita por você em YAML puro. As regras decidem as chamadas que você conhece; as incertas vão para o seam oficial de aprovação, respondido por um modelo revisor ou por uma pessoa. Uma segunda camada adiciona uma política de rede em nível de processo no estilo Codex: a saída dos subprocessos de shell passa por um proxy local HTTP/CONNECT embutido, julgado por regras de rede ou por três modos mapeados nos presets oficiais de sandbox.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-permission-rules-flow-v5-dark.svg">
  <img src="docs/assets/dsh-permission-rules-flow-v5-light.svg" width="100%" alt="Estrutura do dsh-permission-rules: chamadas de ferramentas e saída de shell convergem em uma cadeia ordenada de regras, bifurcam em vereditos de ferramentas e de rede, e fecham com dois eventos de auditoria somente-log">
</picture>

*Estrutura: dois canais (chamadas de ferramentas / saída de shell) convergem em uma cadeia ordenada de regras —a primeira correspondência vence— e bifurcam em vereditos de ferramentas e de rede, fechados por dois eventos de auditoria somente-log.*

## Instalação em três passos

1. **Instale** (escolha um canal):

   ```sh
   # canal git (main mais recente; o script prepare compila apenas com dependências de produção)
   dsh plugin --profile web add github:PerryLink/dsh-permission-rules
   # canal npm (versões publicadas)
   dsh plugin --profile web add dsh-permission-rules
   # canal tarball: pnpm pack neste repositório e então
   dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz
   ```

2. **Escreva sua primeira regra** (`.dsh/rules.yaml` na raiz do projeto; é opcional, a linha de base de alto risco já vem ativada):

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

3. **Verifique se monta**:

   ```sh
   # após reiniciar o perfil, confirme a linha do plugin
   dsh --profile web --dump-config | grep -A4 'id: permission-rules'
   # avalie a seco uma chamada hipotética na superfície de comandos real; nenhuma ferramenta é executada
   /rules test bash {"command":"git push origin main","cwd":"src/secrets/app"}
   ```

```text
"bash" matches rule 1 (deny): 禁止 push 到受保护路径
```

**Desinstalar**: `dsh plugin --profile web remove dsh-permission-rules` (ou remova a linha do patch do perfil).

<details>
<summary>Instalar pelo mercado do DSH Desktop</summary>

Todos os plugins da PerryLink estão listados no mercado embutido do DSH Desktop: **Mercado → Fontes → Adicionar fonte → cole** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ selecione**. A instalação ainda exige a verificação de identidade npm do mercado e a sua confirmação.

</details>

## Capacidades principais

O `dsh-permission-rules` coloca regras ordenadas na frente de cada chamada de ferramenta em `tools/pre-execute`: determinístico, instantâneo, auditável:

- **`deny`** bloqueia a chamada; o `reason` da regra vira o erro visível para o modelo.
- **`ask`** usa o seam oficial de aprovação (monte o `dsh-auto-review` para um segundo modelo responder, ou uma pessoa responde; sem nenhum dos dois, o harness falha fechado).
- **`allow`** (e a ausência de correspondência) delega estritamente via `next()`: listeners posteriores nunca são curto-circuitados.

Cada acerto **e** cada passagem direta é auditado como evento de sessão `permissionRules/decision` (somente log: nada extra é injetado no contexto do modelo).

- **Correspondência rica** — globs de nome de ferramenta (incluindo `mcp__*`), seletores de identidade de agente (`main` / `subagent` / `preset:*`), globs **ou** regex de chaves/valores de argumentos (com negação `!pattern` e a dimensão de chave `absent`), globs de caminhos relativos ao workspace em **qualquer profundidade**, condições de host `when` (variáveis de ambiente, plataforma) e **decomposição de comandos de shell** (`argv`: palavra de comando, tokens de argumento, assinatura de pipe) para correspondência precisa em nível de token.
- **Linha de base de alto risco embutida** — um conjunto deny/ask incluído (comandos destrutivos, escalada de privilégios, baixar e executar, caminhos sensíveis) ativado por padrão e acrescentado após as regras do usuário, de modo que uma regra mais próxima pode sobrepô-lo; controlado por `builtin.enabled`.
- **Arquivos de regras hierárquicos** — `searchUp` opcional mescla cada `.dsh/rules.yaml` do cwd da sessão até a raiz do sistema de arquivos, o mais próximo primeiro.
- **Implantação em simulação** — `enforce: false` audita o que a política *faria* enquanto deixa cada chamada passar.
- **Recarga a quente** — watch do Chokidar com debounce; uma edição quebrada mantém as regras anteriores e nunca derruba o processo. Em um host WSL, ou para um arquivo em `/mnt/<unidade>`, o watch passa a polling porque os eventos nativos não são confiáveis ali.
- **Falha ruidosa** — YAML inválido, ações/campos desconhecidos, globs/regex ruins, padrões propensos a backtracking ou mais de `maxRules` regras falham no carregamento.

### Superfície de comandos e ferramentas

| Superfície | Tipo | Notas |
|---|---|---|
| `tools/pre-execute` | listener | Regras allow/deny/ask de primeira correspondência + extração de URLs candidatas de rede |
| `/rules` | command | `list` · `reload` · `decisions [n]` · `test <tool> <json>` |
| `permissionRules/decision` | event | Auditoria somente-log de cada acerto e passagem direta |
| `permissionRules/network` | event | Auditoria da camada proxy para conexões bloqueadas |
| HTTP/CONNECT proxy | service | Proxy local embutido que governa o tráfego dos subprocessos de shell |
| settings page | client | Editor de modo de rede, editor de regras, contadores de bloqueios e intercepções recentes com ação de permitir por bloqueio |

```text
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call
```

O `/rules test` também aceita flags iniciais: `--cwd <dir>`, `--env KEY=VALUE` (repetível), `--agent <selector>` (repetível) e `--platform <name>`. Em cadeias de vários arquivos (p. ex. `searchUp`), cada linha de regra listada é atribuída ao seu próprio arquivo de origem.

### Exemplos

Estes são os pontos de entrada reais do plugin; instale uma vez e chame um.

**Exemplo detalhado** — comando `/rules test bash {"command":"git push origin main","cwd":"src/secrets/app"}`, saída:

```text
"bash" matches rule 1 (deny): 禁止 push 到受保护路径
```

*Observed from `test/command.spec.ts:204-219 (assertions at :209-213); src/prose.ts:121`*

**Ramo de falha** — entrada `/rules test bash {not json`, saída:

```text
Invalid JSON arguments "{not json": the arguments must parse as JSON.
```

*Observed from `plugins/dsh-permission-rules/src/prose.ts:123; plugins/dsh-permission-rules/src/runtime.ts:1266-1272; plugins/dsh-permission-rules/test/command.spec.ts:221-228`*

**Exemplos curtos**: `tools/pre-execute` · `/rules test <tool> <json>`

## Sintaxe de regras

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

- **Dimensões de correspondência** — `tools` (globs, incl. `mcp__*`), `agents` (`main` / `subagent` / `preset:<name>`; identidade desconhecida nunca corresponde: falha fechado), `params` (globs ou regex de chave/valor, negação `!pattern`, dimensão de chave `absent`), `paths` (globs relativos ao workspace extraídos em qualquer profundidade), `when` (globs/regex de variáveis `env` + lista fechada `platform`) e `network` (`domains` / `ips` / `ports` / `schemes`: globs, curingas, CIDRs, faixas de portas).
- **Ações** — `allow` / `deny` / `ask`, avaliadas na ordem do arquivo, a primeira correspondência vence.
- **Metadados de regra** — `enabled: false` (visível mas inerte), `description`, `tags`; campos desconhecidos falham no carregamento.
- **Schema** — um JSON Schema em [docs/rules-format.schema.json](docs/rules-format.schema.json) (autocompletar do editor via `# yaml-language-server: $schema=...`); o vocabulário completo e uma linha de base de segurança de 5 regras estão em [docs/rules-format.en.md](docs/rules-format.en.md).

## Política de rede

Uma **política de rede em nível de processo** no estilo Codex: o tráfego dos subprocessos de shell passa por um **proxy HTTP/CONNECT local embutido**, e cada conexão é decidida por regras de rede ordenadas ou por três modos mapeados nos presets oficiais de sandbox:

- **`deny-all`** — o preset de sandbox somente leitura: bloqueia toda saída.
- **`whitelist`** — o preset workspace-write: permite os alvos listados e aplica `unlisted: ask` (ou `deny`) ao resto.
- **`allow-all`** — o preset danger-full-access: permite tudo.
- **`auto`** (padrão) — segue o preset de sandbox; em hosts sem o serviço de política de sandbox resolve para `autoFallback` (`allow-all`).

- **Correspondência** — `match.network` com `domains` / `ips` / `ports` / `schemes` (globs, curingas, CIDRs, faixas de portas; portas YAML numéricas são aceitas). A extração de URLs candidatas no caminho quente `tools/pre-execute` dispara em argumentos de ferramentas web e URLs embutidas no texto de comandos bash/pwsh; alvos de loopback podem curto-circuitar regras conforme a política `loopback`. Literais IPv6 mapeados de IPv4 são normalizados para a forma IPv4 antes da comparação, e o proxy conecta nos endereços sobre os quais a decisão foi tomada — nunca uma segunda resolução DNS — uma conexão cuja adjudicação não resolveu nenhum endereço falha fechada (502) em vez de discar o nome.
- **Encadeamento a montante** — `network.upstreamProxy` (padrão `off`) envia as conexões que este proxy **permite** por um proxy a montante: o CONNECT pede um túnel ao upstream (`CONNECT host:port`) e requisições HTTP simples são encaminhadas em forma absoluta. Um alvo bloqueado nunca chega ao upstream — ele continua recebendo o 403 estruturado deste plugin. Dois casos nunca encadeiam mesmo com upstream configurado: um alvo de **loopback** (um proxy fora deste host não roteia o loopback dele) e qualquer decisão produzida por uma **regra com escopo `ips`** (o encadeamento entrega o nome do host ao upstream, então "a conexão cai num endereço que as regras viram" — issue #21 — deixaria de valer exatamente onde as regras se importavam com o endereço; essas decisões continuam discando o endereço adjudicado diretamente), além de um alvo cujo scheme não tem upstream utilizável. O nome do host do próprio upstream é configuração do operador, não entrada do agente, e não é adjudicado por estas regras. Uma URL com credenciais nunca é emitida em bruto: avisos, `/rules network` e o snapshot da página de ajustes mascaram a senha (`http://user:***@host:port`). Upstream inalcançável, timeout (10 s) ou resposta não 2xx resultam em **502** — deliberadamente não há fallback silencioso para a conexão direta, para que uma configuração errada continue visível.
- **Auditoria** — conexões negadas acrescentam `permissionRules/network` à sessão proprietária (mesma porta adaptativa `ignorable`), com contadores de bloqueios e intercepções recentes em `/rules network` e na página de ajustes.
- **Diagnóstico** — conexões bloqueadas carregam uma mensagem `[network: …]` nomeando o alvo bloqueado, o modo ou a regra que decidiu e a remediação.
- **Permitir pela página de ajustes** — cada intercepção recente oferece uma ação **Permitir**. Ela escreve UMA regra mínima `match: { network: { domains: [<host>] } }` / `action: allow` no **topo** (índice 0) do arquivo de regras mais próximo que realmente julga aquela conexão: o arquivo de projeto do workspace ao qual o bloqueio foi atribuído (o `rulesFile` absoluto quando configurado) ou, para um bloqueio de nível de host sem sessão, o arquivo que a cadeia de host resolve (`rulesFile` absoluto → `<processCwd>/<rulesFile>` existente → `fallbackPath` configurado → `<processCwd>/<rulesFile>`, criado); e quando vários workspaces estão carregados, a página oferece primeiro um seletor, porque qualquer cadeia de workspace carregada supera a cadeia de host. Índice 0 porque as regras são de primeira correspondência: acrescentada depois de um `deny` existente, a regra seria texto morto. Somente `domains`, porque essa dimensão inclui subdomínios e ignora porta/scheme, então o host não é rebloqueado na próxima porta; comentários existentes e regras não tocadas sobrevivem, e o texto passa pela mesma porta de validação de uma edição manual. A mudança vale imediatamente — as cadeias de workspace em cache E a cadeia de host sem sessão são relidas, sem reinício e sem `/rules reload` — e a decisão é recalculada, então o aviso relata o resultado REAL e nunca afirma sucesso enquanto a conexão continua bloqueada. Recusa, deixando o arquivo intacto, um workspace desconhecido, um alvo fora das fontes de regras conhecidas, a linha de base embutida somente leitura e um arquivo que não consegue ler ou analisar; uma conexão já permitida não escreve nada. `network.allowHostAction: false` esconde o botão e faz o RPC recusar.

## Configuração

Todos os ajustes são campos `Config` do Schemastery (alteráveis no cordis.yml). Uma sobreposição por id substitui a linha inteira — repita cada chave necessária. Em um host `0.1.7-alpha` cada campo é declarado `.volatile()`, então também é editável no local pela página de ajustes de Plugins: a edição é confirmada nas referências em execução sem remontar o plugin, o runtime lê o novo valor no próximo uso, e uma mudança em `network.proxyPort`, `proxyBind`, `injectEnv` ou `noProxy` reata o proxy local imediatamente. Os limites numéricos vivem no schema, e o editor de configuração resolve a configuração mesclada contra esse schema antes de persistir, então um valor fora da faixa é recusado no momento da escrita. Em um host cujo Schemastery é anterior a `volatile()`, esses campos ficam restritos ao cordis.yml.

Chaves mais usadas:

| Chave | Padrão | Significado |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Local do arquivo de regras; relativo = resolvido contra o cwd da sessão chamadora, absoluto = global e validado na montagem |
| `fallbackPath` | *(none)* | Arquivo de regras usado quando a descoberta por cwd não acha nada; validado na montagem |
| `badFilePolicy` | `fail` | Arquivo de regras inválido: `fail` faz a chamada pendente falhar ruidosamente; `ignore-with-warning` avisa e continua vazio |
| `maxRules` | `256` | Limite rígido de regras na cadeia efetiva de fontes |
| `patternMode` | `glob` | Estilo de padrão de `params`/`paths`/`when.env`: `glob` ou `regex` (nomes de ferramenta são sempre globs) |
| `watch` | `true` | Watch do Chokidar + recarga ao mudar |
| `enforce` | `true` | `false` = modo simulação: acertos deny/ask são auditados com marca `dryRun` e toda chamada passa |
| `language` | `en` | Idioma de saída do `/rules`: `en`, `zh`, `es`, `pt`, `hi` |

<details>
<summary>Tabela de configuração completa (29 chaves)</summary>

| Chave | Padrão | Significado |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Local do arquivo de regras; relativo = resolvido contra o cwd da sessão chamadora, absoluto = global e validado na montagem |
| `fallbackPath` | *(none)* | Arquivo de regras usado quando a descoberta por cwd não acha nada; validado na montagem |
| `badFilePolicy` | `fail` | Arquivo de regras inválido: `fail` faz a chamada pendente falhar ruidosamente; `ignore-with-warning` avisa e continua vazio |
| `maxRules` | `256` | Limite rígido de regras na cadeia efetiva de fontes |
| `maxCachedWorkspaces` | `512` | Limite rígido de cargas de regras por workspace em cache (expulsão LRU) |
| `patternMode` | `glob` | Estilo de padrão de `params`/`paths`/`when.env`: `glob` ou `regex` (nomes de ferramenta são sempre globs) |
| `watch` | `true` | Watch do Chokidar + recarga ao mudar |
| `watchStabilityThresholdMs` | `200` | Janela de debounce da recarga (ms) |
| `language` | `en` | Idioma de saída do `/rules`: `en`, `zh`, `es`, `pt`, `hi` |
| `caseInsensitivePaths` | *(win32)* | Padrões `paths` e comparação com a raiz do workspace ignoram maiúsculas ASCII; `true` no Windows |
| `audit` | `all` | Granularidade da auditoria: `all` registra cada acerto E cada passagem direta; `hits` pula as passagens diretas |
| `searchUp` | `false` | Percorre os diretórios pais a partir do cwd da sessão e mescla cada arquivo de regras encontrado, o mais próximo primeiro |
| `maxGlobStars` | `2` | Limite rígido de quantificadores `*`/`**` sem limite por padrão glob |
| `enforce` | `true` | `false` = modo simulação: acertos deny/ask são auditados com marca `dryRun` e toda chamada passa |
| `allowUnmarkedAudit` | `false` | Hosts pré-marcador descartam a marca `ignorable`; o plugin desativa a auditoria do log de sessão com um aviso. Defina `true` para reativar |
| `network.enabled` | `true` | Interruptor mestre do proxy, da injeção de ambiente e dos padrões de modo das ferramentas web |
| `network.mode` | `auto` | Modo de política: `auto` segue o preset de sandbox, ou `deny-all` / `whitelist` / `allow-all` |
| `network.autoFallback` | `allow-all` | Modo usado quando `auto` não tem serviço de política de sandbox |
| `network.unlisted` | `ask` | Tratamento no modo whitelist de alvos sem correspondência: `ask` ou `deny` |
| `network.proxyBind` | `127.0.0.1` | Endereço de bind do proxy local (somente loopback) |
| `network.proxyPort` | `0` | Porta do proxy local; `0` escolhe uma porta efêmera livre |
| `network.proxyMaxRecent` | `100` | Limite de registros de bloqueios recentes para a página de ajustes |
| `network.loopback` | `allow` | Alvos de loopback: `allow` (paridade com Codex) ou `policy` |
| `network.injectEnv` | `true` | Se variáveis de ambiente de proxy são injetadas nos subprocessos |
| `network.noProxy` | `clear` | Tratamento do NO_PROXY nos subprocessos: `clear` impõe a política ou `preserve` |
| `network.upstreamProxy` | `off` | Proxy a montante para as conexões que este plugin PERMITE: `off` conecta direto, `inherit` reutiliza os nomes de proxy do ambiente de lançamento, ou uma URL `http(s)://` explícita |
| `network.allowHostAction` | `true` | Ação "permitir este host" por bloqueio na página de ajustes: `false` esconde o botão Permitir e faz o RPC `permissionRules/allowHost` recusar (o editor de regras não é afetado) |
| `builtin.enabled` | `true` | Linha de base de alto risco embutida: `false` desativa por completo o conjunto deny/ask incluído |
| `builtin.path` | *(incluído)* | Arquivo de linha de base substituto (absoluto ou relativo a `process.cwd()`); validado na montagem |

</details>

## FAQ

<details>
<summary>Onde ficam os arquivos de regras? O plugin vai escrever nos meus arquivos?</summary>

As regras são lidas do disco: `.dsh/rules.yaml` na raiz do projeto, ou o `rulesFile` / `fallbackPath` configurado, mesclados para cima com `searchUp`. O caminho normal de adjudicação não escreve nenhum dado de regra. As únicas superfícies de escrita são o editor de regras da página de ajustes e a ação "Permitir" — esta última escreve uma regra allow mínima no topo de uma fonte de regras conhecida e repassa a mesma validação de parse/compilação de uma edição manual (veja "Política de rede").

</details>

<details>
<summary>O que acontece com ask sem o dsh-auto-review montado?</summary>

`ask` usa o seam oficial de aprovação: com o `dsh-auto-review` montado, um segundo modelo somente leitura responde; caso contrário, uma pessoa responde; sem nenhum dos dois, o harness falha fechado e a chamada nunca é permitida em silêncio. Este plugin nunca cria subagentes nem chama modelos — produzir uma decisão `ask` é o fim do seu trabalho.

</details>

<details>
<summary>Este proxy intercepta as requisições de saída do próprio host?</summary>

Não. O ambiente de proxy injetado cobre os **filhos de shell gerados** e qualquer consumidor que leia os nomes de proxy no momento da requisição. **Não** cobre o tráfego do próprio processo host baseado em `fetch`: o launcher instala o dispatcher global do undici a partir do ambiente de lançamento antes de o primeiro plugin montar, e esse dispatcher roteia pela sua política, não pelo ambiente. Portanto endpoints do provedor **não** precisam de regra de permissão, e `network.injectEnv: false` não tira o processo host de nada. Medido em 2026-09-10 no Node 22; reproduza com `scripts/host-egress-probe.mjs`.

</details>

<details>
<summary>Quanto custa no caminho quente?</summary>

A avaliação de regras é uma varredura em memória de primeira correspondência — sem chamadas a modelos, sem requisições de rede; acertos e passagens diretas apenas acrescentam auditoria de sessão. Um watch que falha avisa e mantém as regras anteriores. Com conjuntos grandes, defina `audit: hits` para pular as passagens diretas, ou limite a carga com `maxRules` / `maxCachedWorkspaces`.

</details>

<details>
<summary>Ele briga com outros plugins por eventos, nomes de comando ou slots?</summary>

Não. Os nomes de ferramenta têm namespace e nenhum nome nu é tomado; as chaves de serviço `permissionRules` / `permissionRulesRuntime` não são um seam embutido e nenhum plugin de muitas estrelas pesquisado as fornece; ele não registra slot de cliente nem prefixo `webServer`, e seu patch apenas `insert`a a própria linha; eventos compartilhados sempre delegam via `next()`. O argumento ponto a ponto está em "Interoperabilidade com outros plugins DSH".

</details>

## Limites de segurança

- **Política, não kernel.** Os candidatos de `paths` vêm apenas de um conjunto documentado de chaves de argumento (em qualquer profundidade, com limite de profundidade), e somente caminhos relativos ao workspace correspondem.
- **Aqui não há revisor.** O plugin nunca cria subagentes nem chama modelos — produzir uma decisão `ask` é o fim do seu trabalho.
- **Sem mudanças de sandbox.** A política de sandbox em nível de SO pertence ao seam de sandbox, não a este plugin.
- **Configuração inválida ruidosa.** Campos YAML desconhecidos, ações desconhecidas e padrões ruins são rejeitados no carregamento.
- **Limites de backtracking.** Padrões glob são limitados a `maxGlobStars` expansões de estrela sem limite; padrões em modo regex rejeitam quantificadores aninhados sem limite e alternâncias literais sobrepostas quantificadas.
- **Conexão que falha fechada.** Encaminhamentos HTTP simples e túneis CONNECT conectam apenas a endereços adjudicados; um allow cuja adjudicação não resolveu endereço falha fechado com 502 em vez de discar o nome (issue #23).

## Permissões e dados

- **Permissões**: declara `files:read`, `files:watch`, `files:write`, `session:append` e `network:outbound` em seu manifesto workshop. As decisões `ask` usam o seam oficial de aprovação — nada é reimplementado nem contornado.
- **Dados**: os arquivos de regras são lidos do disco; a adjudicação normal não escreve dados de regras — as únicas superfícies de escrita são o editor de regras da página de ajustes e a ação "Permitir". Sem chamadas a modelos, sem subagentes revisores.
- **Log de sessão**: `permissionRules/decision` nunca é injetado no contexto do modelo e é acrescentado com a marca `ignorable: true` do envelope, para que qualquer build do harness carregue o log.

## Limitações conhecidas

- **Marca de auditoria em hosts pré-marcador e hostis.** `permissionRules/decision` é acrescentado com `ignorable: true`; hosts cujo `Session.append` é anterior à marca (as linhas `0.1.0-rc.1`–`rc.7` e `0.1.1-rc.1`–`rc.7`) a descartam em silêncio, a linha `0.1.2-rc` traz a superfície alpha.5 (nenhuma opção de append escreve a marca), a linha `0.1.2-alpha` recusa eventos de plugin na leitura mesmo marcados, e as linhas `0.1.3-alpha` e `0.1.5-alpha` mantêm a mesma assinatura de append somente-superfície (verificado nos pacotes publicados `0.1.3-alpha.1`/`0.1.5-alpha.1`) — o runtime pré-verifica todas antes do primeiro append e desativa a auditoria do log de sessão com um aviso único. A migração entre gerações também recusa linhas de auditoria marcadas: a porta v1→v2 do `0.1.3-alpha` recusa eventos v1 desconhecidos, e a porta v2→v3 do `0.1.5-alpha` recusa todo evento não classificado (seu inventário é congelado no vocabulário v2 publicado), então faça `strip` das linhas v1 antes de um host 0.1.3 abrir o log e das linhas v2 antes de atualizar para um host 0.1.5. Logs v3 nativos aceitam linhas de plugin marcadas, então só precisam de `repair`. Defina `allowUnmarkedAudit: true` para reativar; repare logs já escritos com `scripts/repair-session-logs.mjs` (seu modo `strip` remove linhas de auditoria onde a marca não ajuda).
- **Os candidatos de caminho são heurísticos.** Apenas as chaves de argumento documentadas alimentam a correspondência de caminhos, e a correspondência relativa ao workspace ignora maiúsculas ASCII somente com `caseInsensitivePaths` ativo.
- **Globs são um subconjunto conservador.** Sem expansão de chaves — escreva dois padrões, ou use o modo regex.
- **A guarda de backtracking regex é estrutural, não exaustiva.** Prefira o modo glob para arquivos não confiáveis.
- **As requisições de saída do próprio host não passam por este proxy.** O ambiente de proxy injetado cobre os **filhos de shell gerados** — que é o propósito da injeção — e qualquer consumidor que leia os nomes de proxy no momento da requisição. **Não** cobre o tráfego do próprio processo host baseado em `fetch`: o launcher instala o dispatcher global do undici a partir do **ambiente de lançamento** antes de o primeiro plugin montar, esse dispatcher roteia pela sua política e não pelo ambiente, e o Node amostra o ambiente de proxy na partida — então um plugin montado depois não consegue redirecioná-lo. Consequências: endpoints do provedor **não** precisam de regra de permissão, e `network.injectEnv: false` não tira o processo host de nada. Medido em 2026-09-10 no Node 22; reproduza com `scripts/host-egress-probe.mjs`.
- **O encadeamento a montante cobre apenas o que chega a este proxy.** Em `dsh-v0.1.7-alpha.1` e posteriores, a política de proxy de lançamento do próprio harness e sua camada de ambiente de subprocessos podem ter precedência sobre os nomes de proxy que este plugin injeta, então `network.upstreamProxy` descreve o que acontece com as conexões que este proxy trata — não é uma afirmação sobre cada caminho de saída do processo host.

## Interoperabilidade com outros plugins DSH

Verificado contra **DSH `0.2.0-rc.2`** (o runtime para o qual este README é publicado) e o conjunto de plugins de muitas estrelas pesquisado em 2026-10-05.

Este plugin **não interfere** em outros plugins, incluindo os de muitas estrelas amplamente instalados:

- **Sem colisão de nomes de ferramenta.** Toda ferramenta tem namespace; nenhum nome nu de ferramenta incluída ou de outro plugin é registrado.
- **Sem colisão de chaves de serviço.** Fornece `permissionRules`, `permissionRulesRuntime`; essas chaves não são um seam embutido e não são fornecidas por nenhum plugin de muitas estrelas pesquisado.
- **Sem colisão de slots.** Não registra chave de slot de cliente, então não disputa um assento de `shadows-shipped-ui`.
- **Sem colisão de rotas HTTP.** Não registra nenhum prefixo `webServer`.
- **Sem colisão de camada patch.** O patch do bundle apenas `insert`a a própria linha; nunca sobrescreve o `config` de uma linha embutida.
- **Sem mutação global.** Não altera protótipos, não reescreve `process.env` nem substitui o dispatcher global de fetch.

**Listeners de eventos compartilhados não interferem por construção.** Ele observa os eventos sensíveis à ordem `tools/post-execute`, `tools/pre-execute` com `ctx.on()` — o registro de broadcast do Cordis, onde todo listener roda e nenhum pode deixar outro faminto. **Cada listener aqui delega via `next()`**, então a cadeia nunca é curto-circuitada, e uma mutação é aplicada ao valor que `next()` produziu em vez de substituir seu retorno:

- `tools/post-execute` — also used by `cc-safety-net` (1576★).
- `tools/pre-execute` — also used by `cc-safety-net` (1576★).

Evidência estática: o `dsh-plugin-doctor` K10–K13 reporta `pass` em cada verificação deste repositório.

## Colaboração com o dsh-auto-review

- O `dsh-permission-rules` produz `ask`; o `dsh-auto-review` responde no waterfall `approval/request` com um veredito de segundo modelo somente leitura (ou delega a pessoas). Monte os dois para o ciclo fechado completo.
- Testado em integração: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, com o revisor substituído por um mock com script.
- A política de aprovação `never` e toda garantia de falha fechada do harness oficial permanecem intactas.

## Reparo de registros de sessão

Registros de sessão escritos antes de a marca `ignorable` existir podem ser recusados por builds mais novas do harness (`SessionFormatUnsupportedError`). O `scripts/repair-session-logs.mjs` incluído reescreve apenas as linhas de auditoria alvo para carregar `ignorable: true`, preservando o frame e com backups:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # relata linhas estranhas, não muda nada
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
node scripts/repair-session-logs.mjs strip [--home DIR] [--dry-run]
```

`--home` é por padrão `$DSH_HOME/sessions` (ou `~/.dsh/sessions`). Cada log endereçado por geração é descoberto pelo basename canônico — `session.jsonl`, `session.v2.jsonl`, `session.v3.jsonl`, cada um opcionalmente comprimido com `.zstd` — então escolha o modo pela geração:

- **v3 (`session.v3.jsonl`, escrito nativamente pela linha `0.1.5-alpha`)** — o caminho de leitura aceita linhas de plugin marcadas, então `repair` basta.
- **v2 (`session.v2.jsonl`, escrito pela linha `0.1.3-alpha`)** — `repair` o abre no host que o escreveu, mas a migração v2→v3 do `0.1.5-alpha` recusa todo evento não classificado mesmo marcado: rode `strip` nos logs v2 **antes** de atualizar para um host `0.1.5-alpha`.
- **v1 (`session.jsonl`)** — a migração v1→v2 do `0.1.3-alpha` recusa eventos v1 desconhecidos mesmo marcados: rode `strip` antes de um host 0.1.3 ou posterior abrir o log pela primeira vez.

## Compatibilidade

| Superfície | Estado |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (adaptado em 2026-09-22, cadeia completa de portas): sua configuração de plugin é o contrato de ajustes ao vivo — cada campo é declarado `.volatile()`, o Loader entrega ao `apply` uma referência viva por campo, e uma edição salva é confirmada nas referências em execução SEM remontar o plugin, com valores fora da faixa recusados pelo schema antes de qualquer escrita. Um host cujo Schemastery é anterior a `volatile()` (antes de 3.18.3) ainda monta e roda este plugin — os campos simplesmente ficam como valores comuns e o formulário de configuração ao vivo fica indisponível — porque a marca é aplicada por uma sonda de capacidade, não por suposição. `Session.append` nesta linha ainda não consegue carimbar a marca `ignorable` (seu terceiro argumento é a bolsa de intenção de superfície, e o campo do envelope sobrevive apenas para leituras de logs armazenados), então toda a linha `0.2-alpha` é pré-verificada como sem marca e a auditoria do log de sessão fica desativada por padrão — `append` lê apenas `sourceEventSeqs`/`surfaceOp` e congela o envelope, então não tem caminho de código que possa carimbar a marca; as linhas anteriores `0.1.7-alpha` (adaptada em 2026-09-22), `0.1.5-rc.2` (adaptada em 2026-09-09) e `0.1.3-alpha` mantêm a mesma assinatura de append somente-superfície, e cada pré-lançamento `0.2` é classificado com elas (uma versão ESTÁVEL `0.2.x` fica para a sonda de append, então uma superfície de marca restaurada é adotada sem um novo release do plugin). As migrações de log dessas linhas recusam eventos de plugin não classificados mesmo marcados, então faça `strip` das linhas de auditoria v1 antes de um host `0.1.3-alpha` abrir o log e das linhas v2 antes de um host `0.1.5-alpha` migrá-lo (logs v3 nativos só precisam de `repair`). |
| Node | `^22.19.0 || >=24.9.0` |
| Plataformas | Todas (host + cliente web de ajustes) |
| Modelo | Qualquer (motivos deny/ask aparecem pelos resultados de ferramentas) |

## Ecossistema e qualidade

- [Espelho Gitee](https://gitee.com/perrylink/dsh-permission-rules) (espelho sincronizado; o GitHub é canônico)
- [Página do plugin no dshfind](https://dshfind.com/plugins/PerryLink/dsh-permission-rules) (instalações e ranking)
- [Relatório OpenSSF Scorecard](https://securityscorecards.dev/viewer/?uri=github.com/PerryLink/dsh-permission-rules) (movido por [.github/workflows/scorecard.yml](.github/workflows/scorecard.yml))
- [Relatório de verificação do dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章) (K10–K13 todos `pass`)
- [DSH Market](https://dsh.market/) (listado)
- **Canal da loja 1024**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-permission-rules` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com))
- [Base de conhecimento do ecossistema](https://perrylink.github.io/dsh-plugin-guide/): dados medidos, não marketing: guia de desenvolvimento de plugins · dados de seleção de plugins · critérios de manutenção

## Desenvolvimento

```sh
pnpm install            # node ^22.19 || >=24.9
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 24 spec files
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # porta de sincronização dos README em cinco idiomas (também na CI)
```

Veja [VERIFICATION.md](VERIFICATION.md) para o registro de verificação end-to-end sem interface. As imagens do README são geradas programaticamente por [`scripts/gen-readme-assets.py`](scripts/gen-readme-assets.py) (Pillow desenha os banners hero de 1440×576 em chinês/inglês e claro/escuro; um SVG de 1100×660 desenhado à mão é a figura de estrutura) e podem ser reexecutadas com segurança.

Topics: `dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## Família e agradecimentos

Este projeto faz parte da família de plugins do DeepSeek Harness da [PerryLink](https://github.com/PerryLink) (todos Apache-2.0). Se for útil, **uma estrela ajuda a próxima pessoa a encontrá-lo** — nada fica bloqueado atrás dela.

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: vocabulário e avaliação de regras, runtime, watch HMR, auditoria do log de sessão, política de rede + proxy e a documentação em cinco idiomas.
- [@am-i-dead](https://github.com/am-i-dead) — separou os helpers allow-host seguros para o cliente do módulo somente-host (#24).
- [@22xuan](https://github.com/22xuan) — o relatório detalhado sobre hosts rc.6 descartando em silêncio a marca `ignorable` do evento de auditoria ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) e a discussão upstream do harness; a detecção de capacidades do host na v0.4.1 e a correção da documentação vieram diretamente dessa análise.
- [@sjh9714](https://github.com/sjh9714) — propôs o corpus compartilhado de vetores de teste de sintaxe de regras ([#4](https://github.com/PerryLink/dsh-permission-rules/issues/4), [#5](https://github.com/PerryLink/dsh-permission-rules/issues/5)), publicado na v0.5.1 como `docs/rule-test-vectors/`, e forneceu os casos limite de decomposição AST na [discussão de design](https://github.com/PerryLink/dsh-permission-rules/discussions/10).
- [@weipeng1999](https://github.com/weipeng1999) — a proposta de decomposição de comandos baseada em AST ([#8](https://github.com/PerryLink/dsh-permission-rules/issues/8)) por trás da discussão de design.
- [@alexchenzl](https://github.com/alexchenzl) — a solicitação de listagem no DSH Directory ([#7](https://github.com/PerryLink/dsh-permission-rules/issues/7)).
- [@zl190](https://github.com/zl190) — relatou e verificou a lacuna de compatibilidade com o harness `0.1.0-rc.7` ([PR #9](https://github.com/PerryLink/dsh-permission-rules/pulls/9)).
- [@cuohua](https://github.com/cuohua) — relatou que a linha `0.1.1-rc` ainda descarta a marca `ignorable` embora a porta de versão cobrisse apenas `0.1.0` ([#11](https://github.com/PerryLink/dsh-permission-rules/issues/11)); a porta ampliada veio diretamente dessa análise.

<details>
<summary>Expandir todos os plugins</summary>

| Plugin | Estado |
|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** |  |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** |  |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** |  |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | 🚫 APOSENTADO (repo arquivado) |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | 🚫 APOSENTADO (repo arquivado) |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | 🚫 APOSENTADO (repo arquivado) |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** |  |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** |  |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | 🚫 APOSENTADO (repo arquivado) |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 CONGELADO — ver o README do repo |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 APOSENTADO (repo arquivado) |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 APOSENTADO (repo arquivado) |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 APOSENTADO (repo arquivado) |

</details>

## Licença

[LICENSE](LICENSE) (Apache License 2.0) © 2026 dsh-permission-rules contributors

<p align="center"><sub>Apache-2.0 · Plugin da comunidade, sem afiliação com a DeepSeek.</sub></p>
