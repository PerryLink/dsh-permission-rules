<div align="center">

# 🛡️ dsh-permission-rules

**Reglas de permisos declarativas estilo Claude Code para DeepSeek Harness.**

*Las reglas deciden lo conocido. Un modelo revisor decide lo desconocido.*

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

## Qué hace

`dsh-permission-rules` coloca una lista ordenada de reglas **`allow` / `deny` / `ask`** delante de cada llamada a herramienta en el waterfall `tools/pre-execute`: determinista, instantánea, auditable y escrita por ti en YAML plano:

- **`deny`** bloquea la llamada. El `reason` de la regla se convierte en el error visible para el modelo, para que el agente aprenda *por qué* en lugar de reintentar a ciegas.
- **`ask`** usa el seam de aprobación oficial. Monta `dsh-auto-review` junto a él y una segunda modelo decide; si no, responde un humano; sin ninguno de los dos, el harness falla cerrado (fail-closed).
- **`allow`** (y la ausencia de coincidencia) delega estrictamente mediante `next()`: los listeners posteriores nunca se cortocircuitan.

Cada acierto **y** cada paso directo se audita como evento de sesión `permissionRules/decision` (solo registro, sin inyectar nada extra al contexto del modelo).

```text
waterfall tools/pre-execute                     waterfall approval/request (cadena de answerers)
        │                                                   │
  dsh-permission-rules                                answerer dsh-auto-review
   · primera coincidencia en orden    ┌───────────────────┴──────────────┐
   · deny/ask reclaman la llamada     │ veredicto de IA (segundo modelo)  │ no ── next() ──▶ UI humana
   · allow/paso → next()              └───────────────────┬──────────────┘
        │ deny ──▶ resultado denegado                    │ allowed-once / rejected
        │ ask  ──▶ ctx.approval ─────────────────────────┘
        │
   auditoría: permissionRules/decision → approval/asked → autoReview/verdict → approval/decided
```

## ¿Por qué reglas *y* un revisor?

Un segundo modelo responde *"¿es segura ESTA llamada?"* con criterio, pero cuesta un viaje de ida y vuelta y puede equivocarse. Las reglas declarativas responden de forma determinista, instantánea y sin modelo, pero solo cubren lo que un administrador escribió. Combinados obtienes el bucle **"primero reglas, IA de respaldo"**: las reglas deciden lo conocido, el revisor decide lo desconocido.

## Características

- ✅ **Semántica de tres estados** — `allow`, `deny`, `ask`, evaluadas en orden de archivo; gana la primera coincidencia
- ✅ **Coincidencia rica** — globs de nombre de herramienta (incluido `mcp__*`), selectores de identidad de agente (`main` / `subagent` / `preset:*`), globs **o** regex de clave/valor de argumentos (con negación `!pattern` y la dimensión de clave `absent`), globs de rutas relativas al workspace extraídos de claves de argumentos documentadas a **cualquier profundidad de anidamiento**, y condiciones de host `when` (variables de entorno, plataforma)
- ✅ **Archivos de reglas jerárquicos** — `searchUp` opcional combina cada `.dsh/rules.yaml` desde el cwd de la sesión hasta la raíz del sistema de archivos, el más cercano primero, para que un proyecto hijo pueda sobrescribir las reglas del padre
- ✅ **Metadatos de reglas** — `enabled: false`, `description`, `tags`; `/rules` advierte sobre reglas eclipsadas por un catch-all anterior
- ✅ **Seguro para el waterfall** — `allow`/paso siempre llaman a `next()`; solo `deny`/`ask` cortocircuitan
- ✅ **Seam de aprobación oficial** — `ask` fluye por `ctx.approval`; nunca reimplementado, nunca eludido
- ✅ **Auditoría completa** — los eventos `permissionRules/decision` llevan la acción de la regla, el cwd del workspace Y el resultado final de cada llamada; `/rules decisions` reproduce el rastro en la sesión; los hosts anteriores al marcador de envoltura de auditoría degradan a auditoría desactivada con un aviso único en lugar de escribir registros irrecuperables (`allowUnmarkedAudit` la reactiva)
- ✅ **Despliegue en simulación** — `enforce: false` audita lo que la política *haría* (acción hipotética + resultado real posterior, marcado `dryRun`) mientras deja pasar todas las llamadas; prueba segura de políticas en producción
- ✅ **Prueba en seco** — `/rules test <tool> <json-args>` evalúa las reglas activas sin ejecutar nada, con sobrescrituras `--cwd`, `--env`, `--agent` y `--platform` para cada dimensión
- ✅ **Recarga en caliente** — vigilancia Chokidar con debounce; una edición rota conserva las reglas previas, nunca falla; un archivo de reglas creado a mitad de sesión (el del proyecto o el fallback) se adopta automáticamente, sin recarga manual
- ✅ **Fallo ruidoso** — YAML inválido, acciones/campos desconocidos, globs/regex incorrectos, patrones propensos a backtracking o > `maxRules` hacen fallar la carga
- ✅ **Ruta caliente acotada** — matchers precompilados, O(reglas × patrones), limitado por `maxRules`; el grado de backtracking de glob limitado por `maxGlobStars`

## Inicio rápido

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# o desde un tarball empaquetado (artefactos compilados, sin permiso de build)
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.4.1.tgz

# 2. reinicia
dsh --profile web
```

Luego crea el archivo de reglas de tu proyecto e inicia una sesión dentro de él:

```yaml
# <project>/.dsh/rules.yaml
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "Prohibido push desde rutas protegidas"

  - match: { tools: [edit, write] }
    action: ask
    reason: "La escritura de archivos necesita confirmación"
```

```sh
dsh --profile web --dump-config | grep -A4 'id: permission-rules'   # verifica la fila
```

Una línea base de seguridad completa de 5 reglas y el esquema completo están en [docs/rules-format.en.md](docs/rules-format.en.md).

## Configuración

Todos los ajustes son campos `Config` de Schemastery (modificables desde cordis.yml). Una sobrescritura dirigida por id reemplaza toda la fila: vuelve a escribir todas las claves que necesites.

| Clave | Predeterminado | Significado |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Ubicación del archivo de reglas; relativo = resuelto contra el cwd de la sesión, absoluto = global y validado al montar |
| `fallbackPath` | *(ninguno)* | Archivo de reglas usado cuando la detección por cwd no encuentra nada; validado al montar |
| `badFilePolicy` | `fail` | Archivo roto: `fail` hace fallar ruidosamente la llamada pendiente (las recargas conservan las reglas previas); `ignore-with-warning` advierte y continúa vacío |
| `maxRules` | `256` | Límite duro de reglas en toda la cadena de fuentes efectiva; archivos mayores fallan la carga |
| `maxCachedWorkspaces` | `512` | Límite duro de cargas de reglas por espacio de trabajo en caché; más allá se expulsa el menos usado recientemente (y su watcher) |
| `patternMode` | `glob` | Tipo de patrón para `params`/`paths`/`when.env`: `glob` o `regex` (los nombres de herramienta siempre son globs) |
| `watch` | `true` | Vigilancia Chokidar + recarga al cambiar |
| `watchStabilityThresholdMs` | `200` | Ventana de debounce de recarga (ms) |
| `language` | `en` | Idioma de salida de `/rules`: `en`, `zh`, `es`, `pt`, `hi` (`en`/`zh` son las traducciones de referencia) |
| `caseInsensitivePaths` | *(win32)* | Los patrones de `paths` y la comparación con la raíz del workspace ignoran las mayúsculas ASCII; por defecto `true` en Windows, `false` en los demás |
| `audit` | `all` | Granularidad de auditoría: `all` registra cada acierto Y cada paso; `hits` omite los eventos de paso |
| `searchUp` | `false` | Recorre los directorios padre desde el cwd de la sesión y combina cada archivo de reglas encontrado, el más cercano primero |
| `maxGlobStars` | `2` | Límite duro de cuantificadores `*`/`**` sin límite por patrón glob (cota del grado de backtracking) |
| `enforce` | `true` | `false` = modo simulación: los aciertos deny/ask solo se registran en auditoría con un marcador `dryRun` (acción hipotética + resultado real posterior) y todas las llamadas pasan — prueba una política antes de aplicarla |
| `allowUnmarkedAudit` | `false` | Los hosts cuyo `Session.append` es anterior al marcador `ignorable` (la línea `0.1.0-rc.6`) escriben eventos de auditoría sin marcar, haciendo las sesiones irrecuperables en builds más estrictos: el plugin los detecta y desactiva la auditoría del registro de sesión con un aviso único. Ponlo en `true` para reactivar el rastro en la sesión (repara los registros existentes con `scripts/repair-session-logs.mjs`) |

### Comandos de sesión

```
/rules                        lista las reglas activas, sus archivos fuente y cualquier error de la última recarga
/rules list                   alias explícito del listado simple
/rules reload                 relee la cadena de archivos de reglas de este workspace
/rules decisions [n]          muestra las últimas n decisiones de permisos de esta sesión (por defecto 10)
/rules test <tool> <json>     evalúa en seco las reglas contra una llamada hipotética, p. ej. /rules test bash {"command":"git push origin main"}
```

`/rules test` también acepta banderas iniciales: `--cwd <dir>` evalúa contra otro workspace, `--env CLAVE=VALOR` (repetible) sobrescribe el entorno para `when.env`, `--agent <selector>` (repetible) suministra candidatos de identidad para la dimensión `agents`, y `--platform <nombre>` sobrescribe la plataforma para `when.platform`. En cadenas de varios archivos (p. ej. `searchUp`), cada línea de regla se atribuye a su propio archivo fuente.

La salida de los comandos es solo UI: el modelo aprende las reglas únicamente a través de los resultados de herramienta que producen. `language` elige el idioma de salida. Un JSON Schema del archivo de reglas se distribuye en [docs/rules-format.schema.json](docs/rules-format.schema.json) (conéctalo con `# yaml-language-server: $schema=...` para autocompletado en el editor).

## Colaboración con dsh-auto-review

- `dsh-permission-rules` produce `ask`; `dsh-auto-review` responde en el waterfall `approval/request` con un veredicto de un segundo modelo de solo lectura (o delega a humanos). Monta ambos para el bucle completo.
- Probado en integración (`test/integration.spec.ts`): `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, con el revisor sustituido por un mock.
- La política de aprobación `never` y todas las garantías fail-closed del [harness oficial](https://github.com/deepseek-ai/deepseek-harness) permanecen intactas.

## Límites de seguridad

- **Política, no kernel.** Los candidatos de `paths` provienen solo de un conjunto documentado de claves de argumentos, y solo coinciden rutas relativas al workspace.
- **Aquí no hay revisor.** El plugin nunca lanza subagentes ni llama modelos: producir una decisión `ask` es el final de su trabajo.
- **Sin cambios de sandbox.** La política de sandbox a nivel de SO pertenece al seam de sandbox, no a este plugin.
- **Mala configuración ruidosa.** Campos YAML desconocidos, acciones desconocidas y patrones incorrectos se rechazan al cargar, nunca se ignoran en silencio.
- **Límites de backtracking.** Los patrones glob están limitados a `maxGlobStars` expansiones de estrella sin límite; los patrones en modo regex rechazan cuantificadores anidados sin límite y alternancias literales superpuestas cuantificadas. (Las cadenas regex como `\d+\.\d+\.\d+` siguen permitidas: el modo regex es la válvula de escape, el modo glob es el predeterminado protegido.)

## Trabajo relacionado

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — clasificador allow/deny de dos estados con auditoría en archivo propio; este plugin añade la semántica completa de tres estados, reglas YAML declarativas, auditoría en el log de sesión y delegación segura con `next()`.
- `Drifter-yh/dsh-tool-policy` — política de herramientas deny-by-default; documentada aquí para evitar implementaciones duplicadas.
- `dsh-auto-review` — la mitad de respaldo de IA del bucle que este plugin encabeza.

## Discusiones de diseño

- [Perfiles de capacidad](https://github.com/PerryLink/dsh-permission-rules/issues/6) — conjuntos de permisos con nombre, conmutables por tarea/sesión (issue de seguimiento).
- [Task-scoped capabilities: combining Harness permissions with external enforcement](https://github.com/deepseek-ai/deepseek-harness/discussions/2506) — la discusión upstream sobre el límite de la aplicación externa que motivó la idea de los perfiles.

## Limitaciones conocidas

- `permissionRules/decision` se añade con el marcador de envoltura `ignorable: true`, de modo que cualquier build del harness carga el registro: los lectores que no conocen el tipo fuera del repositorio simplemente omiten el registro de auditoría en lugar de rechazar la sesión. Los hosts cuyo `Session.append` es anterior al marcador (la línea `0.1.0-rc.6`) lo DESCARTAN silenciosamente: el plugin los detecta en tiempo de ejecución (verificación previa de la versión del peer + una sonda del sobre añadido) y desactiva la auditoría del registro de sesión con un aviso único, para que los registros sigan siendo cargables en cualquier parte. Pon `allowUnmarkedAudit: true` para reactivar el rastro en la sesión; los registros ya escritos sin marcador pueden repararse con `scripts/repair-session-logs.mjs` antes de cargarlos en hosts con semántica required-on-read.
- Los candidatos de `paths` son heurísticos: solo las claves de argumentos documentadas alimentan la coincidencia de rutas, y la coincidencia relativa al workspace ignora las mayúsculas ASCII solo cuando `caseInsensitivePaths` está activo.
- Los globs son un subconjunto conservador (sin expansión de llaves): escribe dos patrones o usa el modo regex.
- El guard de backtracking de regex es estructural, no exhaustivo: los casos de ambigüedad por alternancia sin prefijos literales (p. ej. lookarounds elaborados) son responsabilidad del autor; prefiere el modo glob para archivos no confiables.

## Reparación de registros de sesión

Los registros de sesión escritos antes del marcador `ignorable` pueden ser rechazados por builds más nuevos del harness (`SessionFormatUnsupportedError`). El `scripts/repair-session-logs.mjs` incluido reescribe solo las filas de auditoría objetivo para añadir `ignorable: true`, preservando los marcos, con copias de seguridad:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # informa filas ajenas, sin cambios
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` por defecto es `$DSH_HOME/sessions` (o `~/.dsh/sessions`). El contrato completo está en la cabecera del script.

## Desarrollo

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc, src + tests
pnpm run lint       # eslint, src + tests + scripts
pnpm test           # vitest: 139 tests, 9 suites
pnpm run test:coverage  # puerta de cobertura (90/80/90/90)
pnpm run build      # declaraciones tsc + bundles tsdown (lib/)
pnpm run pack:check # build + pack (el artefacto publicado)
node scripts/check-readme-sync.mjs  # puerta de sincronización de READMEs en cinco idiomas (también en CI)
```

Consulta [VERIFICATION.md](VERIFICATION.md) para el registro de verificación headless de extremo a extremo (deny bloqueando una herramienta de shell, ask enrutado por el seam de aprobación, `--dump-config`).

## Colaboradores

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: vocabulario y evaluación de reglas, runtime, vigilancia HMR, auditoría del registro de sesión y documentación en cinco idiomas.
- [@22xuan](https://github.com/22xuan) — el detallado informe sobre los hosts rc.6 que descartan silenciosamente el marcador `ignorable` de los eventos de auditoría ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) y la discusión en el harness upstream; la detección de capacidades del host de v0.4.1 y la corrección de la documentación derivan directamente de ese análisis.

## PerryLink DSH Plugin Family

Este proyecto es uno de los [15 plugins de DeepSeek Harness](https://github.com/PerryLink) mantenidos por [PerryLink](https://github.com/PerryLink). Si este te sirve, los demás probablemente también:

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

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
