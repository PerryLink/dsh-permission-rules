<div align="center">

# 🛡️ dsh-permission-rules
- **Canal 1024 store**: `npm i -g dsh1024` una vez, luego `dsh1024 plugin --profile web add dsh-permission-rules` (cuenta para el ranking de instalaciones de [deepseek1024.com](https://deepseek1024.com)).

**Reglas de permisos declarativas estilo Claude Code para DeepSeek Harness.**

*Las reglas deciden lo conocido. Un modelo revisor decide lo que no lo es.*

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
| Harness | DeepSeek Harness `0.1.1-rc.2` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Todas (host + cliente web de settings) |
| Model | Cualquiera (las razones deny/ask se muestran a través de los resultados de herramienta) |

## What you get

`dsh-permission-rules` antepone una lista ordenada de reglas **`allow` / `deny` / `ask`** a cada llamada de herramienta en la cascada `tools/pre-execute` — determinista, instantánea, auditable y escrita por ti en YAML plano:

- **`deny`** bloquea la llamada; la `reason` de la regla se convierte en el error visible para el modelo.
- **`ask`** usa la costura oficial de aprobación (monta `dsh-auto-review` para un answerer de segundo modelo, o responde un humano; sin ninguno, el harness falla cerrado).
- **`allow`** (y sin coincidencia) delega estrictamente vía `next()` — los listeners posteriores nunca se cortocircuitan.

Cada acierto **y** cada paso directo se registra como un evento de sesión `permissionRules/decision` (solo registro — nada extra se inyecta en el contexto del modelo).

- **Emparejamiento rico** — globs de nombre de herramienta (incl. `mcp__*`), selectores de identidad de agente (`main` / `subagent` / `preset:*`), globs **o** regexes de clave/valor de argumentos (con negación `!pattern` y una dimensión de clave `absent`), globs de ruta relativos al workspace a **cualquier profundidad de anidamiento**, condiciones de host `when` (variables de entorno, plataforma), y **descomposición de comandos de shell** (`argv`: palabra de comando, tokens de argumento, firma de pipeline) para emparejamiento preciso a nivel de token.
- **Línea base de alto riesgo integrada** — un conjunto deny/ask embarcado (comandos destructivos, escalada de privilegios, descarga-y-ejecución, rutas sensibles) habilitado por defecto y añadido después de las reglas de usuario (una regla de usuario más cercana puede sobrescribirlo); se alterna con `builtin.enabled`.
- **Archivos de reglas jerárquicos** — `searchUp` opcional fusiona cada `.dsh/rules.yaml` desde el cwd de la sesión hasta la raíz del sistema de archivos, el más cercano primero.
- **Despliegue en dry-run** — `enforce: false` audita lo que la política *haría* mientras deja pasar cada llamada.
- **Recarga en caliente** — vigilancia Chokidar con debounce; una edición rota conserva las reglas anteriores, nunca falla.
- **Fallo ruidoso** — YAML inválido, acciones/campos desconocidos, globs/regexes malos, patrones propensos a backtracking o más de `maxRules` reglas fallan la carga.

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

- **Dimensiones de coincidencia** — `tools` (globs, incl. `mcp__*`), `agents` (`main` / `subagent` / `preset:<name>`; identidad desconocida nunca coincide — falla cerrado), `params` (globs o regexes de clave/valor, negación `!pattern`, dimensión de clave `absent`), `paths` (globs relativos al workspace extraídos a cualquier profundidad), `when` (globs/regexes de variables `env` + una lista `platform` cerrada), y `network` (`domains` / `ips` / `ports` / `schemes` — globs, comodines, CIDR, rangos de puertos).
- **Acciones** — `allow` / `deny` / `ask`, evaluadas en orden de archivo, la primera coincidencia gana.
- **Metadatos de regla** — `enabled: false` (visible pero inerte), `description`, `tags`; los campos desconocidos fallan la carga.
- **Schema** — un JSON Schema se distribuye en [docs/rules-format.schema.json](docs/rules-format.schema.json) (autocompletado de editor vía `# yaml-language-server: $schema=...`); el vocabulario completo y una línea base de 5 reglas viven en [docs/rules-format.en.md](docs/rules-format.en.md).

## Network policy

Una **política de red a nivel de proceso** estilo Codex: el tráfico de subprocesos de shell fluye a través de un **proxy HTTP/CONNECT** local integrado, y cada conexión se decide mediante reglas de red ordenadas o mediante tres modos mapeados sobre los presets oficiales del sandbox:

- **`deny-all`** — el preset de sandbox de solo lectura: bloquear todo el tráfico saliente.
- **`whitelist`** — el preset workspace-write: permitir los destinos listados, `unlisted: ask` (o `deny`) para el resto.
- **`allow-all`** — el preset danger-full-access: permitir todo.
- **`auto`** (por defecto) — sigue el preset del sandbox; en hosts sin el servicio de política de sandbox se resuelve a `autoFallback` (`allow-all`).

- **Emparejamiento** — `match.network` con `domains` / `ips` / `ports` / `schemes` (globs, comodines, CIDR, rangos de puertos; se aceptan puertos YAML numéricos). La extracción de candidatos URL en la ruta caliente `tools/pre-execute` se dispara sobre argumentos de herramientas web y URLs embebidas en texto de comandos bash/pwsh; los destinos de loopback pueden cortocircuitar reglas según la política `loopback`.
- **Auditoría** — las conexiones denegadas anexan `permissionRules/network` a la sesión propietaria (la misma puerta adaptativa `ignorable`), con contadores de bloqueo e intercepciones recientes en `/rules network` y la página de settings.

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

- **canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"` — el script `prepare` compila solo con dependencias de producción.
- **canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-permission-rules`.
- **canal tarball**: `pnpm pack` en este repo, luego `dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz`.
- **desinstalar**: `dsh plugin --profile web remove dsh-permission-rules`.

## Configuration

Todos los parámetros son campos Schemastery `Config` (modificables desde cordis.yml). Una sobrescritura dirigida por id reemplaza toda la fila — reafirma cada clave que necesites.

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Ubicación del archivo de reglas; relativo = resuelto contra el cwd de la sesión, absoluto = global y validado al montar |
| `fallbackPath` | *(none)* | Archivo de reglas usado cuando la detección por cwd no encuentra nada; validado al montar |
| `badFilePolicy` | `fail` | Archivo de reglas malo: `fail` hace fallar la llamada pendiente ruidosamente; `ignore-with-warning` advierte y continúa vacío |
| `maxRules` | `256` | Límite duro de recuento de reglas en la cadena fuente efectiva |
| `maxCachedWorkspaces` | `512` | Límite duro de cargas de reglas por workspace en caché (evicción LRU) |
| `patternMode` | `glob` | Sabor de patrón `params`/`paths`/`when.env`: `glob` o `regex` (los nombres de herramienta siempre son globs) |
| `watch` | `true` | Vigilancia Chokidar + recarga al cambiar |
| `watchStabilityThresholdMs` | `200` | Ventana de debounce de recarga (ms) |
| `language` | `en` | Idioma de salida de `/rules`: `en`, `zh`, `es`, `pt`, `hi` |
| `caseInsensitivePaths` | *(win32)* | Los patrones `paths` y la comparación de raíz del workspace ignoran mayúsculas ASCII; `true` en Windows |
| `audit` | `all` | Granularidad de auditoría: `all` registra cada acierto Y paso directo; `hits` omite eventos de paso |
| `searchUp` | `false` | Recorrer directorios padre desde el cwd y fusionar cada archivo de reglas encontrado, el más cercano primero |
| `maxGlobStars` | `2` | Límite duro de cuantificadores `*`/`**` no acotados por patrón glob |
| `enforce` | `true` | `false` = modo dry-run: los aciertos deny/ask se registran con marcador `dryRun` y cada llamada pasa |
| `allowUnmarkedAudit` | `false` | Los hosts previos al marcador descartan el marcador `ignorable`; el plugin desactiva la auditoría de registro con una advertencia. Pon `true` para reactivar |
| `network.enabled` | `true` | Interruptor maestro del proxy, la inyección de entorno y los modos por defecto de herramienta web |
| `network.mode` | `auto` | Modo de política: `auto` sigue el preset del sandbox, o `deny-all` / `whitelist` / `allow-all` |
| `network.autoFallback` | `allow-all` | Modo usado cuando `auto` no tiene servicio de política de sandbox |
| `network.unlisted` | `ask` | Manejo en modo whitelist de destinos sin regla coincidente: `ask` o `deny` |
| `network.proxyBind` | `127.0.0.1` | Dirección de enlace del proxy local (solo loopback) |
| `network.proxyPort` | `0` | Puerto del proxy local; `0` elige un puerto efímero libre |
| `network.proxyMaxRecent` | `100` | Límite de registros de bloqueo recientes para la página de settings |
| `network.loopback` | `allow` | Destinos de loopback: `allow` (paridad Codex) o `policy` |
| `network.injectEnv` | `true` | Si se inyectan variables de entorno del proxy para subprocesos |
| `network.noProxy` | `clear` | Manejo de NO_PROXY en subprocesos: `clear` aplica la política o `preserve` |
| `builtin.enabled` | `true` | Línea base de alto riesgo integrada: `false` deshabilita por completo el conjunto deny/ask embarcado |
| `builtin.path` | *(embarcado)* | Archivo de línea base de reemplazo (absoluto, o relativo a `process.cwd()`); validado al montar |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `tools/pre-execute` | listener | Reglas allow/deny/ask de primera coincidencia + extracción de candidatos URL de red |
| `/rules` | command | `list` · `reload` · `decisions [n]` · `test <tool> <json>` |
| `permissionRules/decision` | event | Auditoría solo de registro para cada acierto y paso directo |
| `permissionRules/network` | event | Auditoría de capa de proxy para conexiones bloqueadas |
| HTTP/CONNECT proxy | service | Proxy local integrado que gobierna el tráfico de subprocesos de shell |
| settings page | client | Editor de modo de red, editor de reglas, contadores de bloqueo, intercepciones recientes |

```
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call
```

`/rules test` también acepta banderas iniciales: `--cwd <dir>`, `--env KEY=VALUE` (repetible), `--agent <selector>` (repetible) y `--platform <name>`. En cadenas multi-archivo (p. ej. `searchUp`), cada línea de regla listada se atribuye a su propio archivo fuente.

## Permissions & data

- **Permissions**: el manifiesto de workshop declara `files:read`, `files:watch`, `files:write`, `session:append` y `network:outbound`. Las decisiones `ask` usan la costura oficial de aprobación — nada se reimplementa ni se evade.
- **Data**: los archivos de reglas se leen del disco; no se escribe ningún dato de reglas. Sin llamadas al modelo, sin subagentes revisores.
- **Session log**: `permissionRules/decision` nunca se inyecta en el contexto del modelo y se anexa con el marcador `ignorable: true` del sobre, de modo que cualquier build del harness carga el registro.

## Security boundaries

- **Política, no kernel.** Los candidatos `paths` provienen solo de un conjunto documentado de claves de argumento (a cualquier profundidad, con tope), y solo coinciden las rutas relativas al workspace.
- **Aquí no hay revisor.** El plugin nunca genera subagentes ni llama modelos — producir una decisión `ask` es el fin de su trabajo.
- **Sin cambios de sandbox.** La política de sandbox a nivel de SO pertenece a la costura del sandbox, no a este plugin.
- **Rechazo ruidoso de mala configuración.** Campos YAML desconocidos, acciones desconocidas y patrones malos se rechazan al cargar.
- **Límites de backtracking.** Los patrones glob se limitan a `maxGlobStars` expansiones de estrella no acotadas; los patrones regex rechazan cuantificadores anidados no acotados y alternancias literales solapadas cuantificadas.

## Known limitations

- **Marcador de auditoría en hosts previos al marcador.** `permissionRules/decision` se anexa con `ignorable: true`; los hosts cuyo `Session.append` es anterior al marcador (las líneas `0.1.0-rc.1`–`rc.7` y `0.1.1-rc.1`–`rc.7`) lo descartan silenciosamente, por lo que el runtime desactiva la auditoría de registro con una advertencia única. Pon `allowUnmarkedAudit: true` para reactivar; repara registros ya escritos con `scripts/repair-session-logs.mjs`.
- **Los candidatos de ruta son heurísticos.** Solo las claves de argumento documentadas alimentan el emparejamiento de rutas, y el emparejamiento relativo al workspace es insensible a mayúsculas ASCII solo con `caseInsensitivePaths` activado.
- **Los globs son un subconjunto conservador.** Sin expansión de llaves — escribe dos patrones, o usa modo regex.
- **La guardia de backtracking de regex es estructural, no exhaustiva.** Prefiere el modo glob para archivos no confiables.

## Collaborating with dsh-auto-review

- `dsh-permission-rules` produce `ask`; `dsh-auto-review` responde en la cascada `approval/request` con un veredicto de segundo modelo de solo lectura (o delega en humanos). Monta ambos para el bucle completo cerrado.
- Probado en integración: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, con el revisor reemplazado por un mock guionado.
- La política de aprobación `never` y toda garantía de fallo cerrado del harness oficial permanecen intactas.

## Session log repair

Los registros de sesión escritos antes de que existiera el marcador `ignorable` pueden ser rechazados por builds más nuevas del harness (`SessionFormatUnsupportedError`). El `scripts/repair-session-logs.mjs` distribuido reescribe solo las filas de auditoría objetivo para llevar `ignorable: true`, preservando marcos, con copias de seguridad:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # reporta filas ajenas, no cambia nada
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` por defecto es `$DSH_HOME/sessions` (o `~/.dsh/sessions`).

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

Consulta [VERIFICATION.md](VERIFICATION.md) para el registro de verificación end-to-end sin cabeza.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: vocabulario y evaluación de reglas, runtime, vigilancia HMR, auditoría de registro de sesión, política de red + proxy, y la documentación en cinco idiomas.
- [@22xuan](https://github.com/22xuan) — el informe detallado sobre hosts rc.6 que descartan silenciosamente el marcador `ignorable` del evento de auditoría ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) y la discusión del harness upstream; la detección de capacidad de host en runtime v0.4.1 y la corrección de documentación se derivaron directamente de ese análisis.
- [@sjh9714](https://github.com/sjh9714) — propuso el corpus compartido de vectores de prueba de sintaxis de reglas ([#4](https://github.com/PerryLink/dsh-permission-rules/issues/4), [#5](https://github.com/PerryLink/dsh-permission-rules/issues/5)), incluido en v0.5.1 como `docs/rule-test-vectors/`, y aportó los casos límite de descomposición AST en la [discusión de diseño](https://github.com/PerryLink/dsh-permission-rules/discussions/10).
- [@weipeng1999](https://github.com/weipeng1999) — la propuesta de descomposición de comandos basada en AST ([#8](https://github.com/PerryLink/dsh-permission-rules/issues/8)) detrás de la discusión de diseño.
- [@alexchenzl](https://github.com/alexchenzl) — la solicitud de inclusión en el DSH Directory ([#7](https://github.com/PerryLink/dsh-permission-rules/issues/7)).
- [@zl190](https://github.com/zl190) — informó y verificó la brecha de compatibilidad del harness `0.1.0-rc.7` ([PR #9](https://github.com/PerryLink/dsh-permission-rules/pulls/9)).
- [@cuohua](https://github.com/cuohua) — informó de que la línea `0.1.1-rc` sigue descartando el marcador `ignorable` aunque la compuerta de versión solo cubría `0.1.0` ([#11](https://github.com/PerryLink/dsh-permission-rules/issues/11)); la compuerta ampliada surgió directamente de ese análisis.

## PerryLink DSH Plugin Family

Este proyecto es uno de los [15 plugins de DeepSeek Harness](https://github.com/PerryLink) mantenidos por [PerryLink](https://github.com/PerryLink). Si este te ayuda, los demás probablemente también:

| Plugin | One-liner |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Engineering-discipline guard: requirements grill, test gates, adversary review |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Durable background child agents with a Web UI sidebar, messaging and interrupt |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | LSP diagnostics, formatting, completion, code actions and rename over language servers |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles-equivalent runtime style switching |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | Second-model auto-review on the approval chain, fail-closed by default |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Security-audit skill pack: secret scan, dependency and supply-chain review |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Pin sessions in the Web sidebar with durable ordering |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Terminal-style input history for the web composer: arrows, Ctrl+R search |
| [dsh-github](https://github.com/PerryLink/dsh-github) | GitHub PR/issues integration for DSH, every write gated by approval |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Plugin-development knowledge base as an on-demand agent skill |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
