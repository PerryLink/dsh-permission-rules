<div align="center">

# 🛡️ dsh-permission-rules

**Reglas de permisos declarativas estilo Claude Code para DeepSeek Harness.**

*Las reglas deciden lo conocido. Un modelo revisor decide lo desconocido.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![Tests](https://img.shields.io/badge/tests-58%20passed-success.svg)](#desarrollo)
[![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](package.json)

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
- ✅ **Coincidencia rica** — globs de nombre de herramienta (incluido `mcp__*`), globs **o** regex de clave/valor de argumentos, globs de rutas relativas al workspace
- ✅ **Seguro para el waterfall** — `allow`/paso siempre llaman a `next()`; solo `deny`/`ask` cortocircuitan
- ✅ **Seam de aprobación oficial** — `ask` fluye por `ctx.approval`; nunca reimplementado, nunca eludido
- ✅ **Auditoría completa** — eventos `permissionRules/decision` para cada acierto y paso directo
- ✅ **Recarga en caliente** — vigilancia Chokidar con debounce; una edición rota conserva las reglas previas, nunca falla
- ✅ **Fallo ruidoso** — YAML inválido, acciones desconocidas, globs/regex incorrectos o > `maxRules` hacen fallar la carga
- ✅ **Ruta caliente acotada** — matchers precompilados, O(reglas × patrones), limitado por `maxRules`

## Inicio rápido

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# o desde un tarball empaquetado (artefactos compilados, sin permiso de build)
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.1.0.tgz

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
| `maxRules` | `256` | Límite duro de reglas; archivos mayores fallan la carga |
| `patternMode` | `glob` | Tipo de patrón para `params`/`paths`: `glob` o `regex` (los nombres de herramienta siempre son globs) |
| `watch` | `true` | Vigilancia Chokidar + recarga al cambiar |
| `watchStabilityThresholdMs` | `200` | Ventana de debounce de recarga (ms) |

### Comandos de sesión

```
/rules           lista las reglas activas, su archivo fuente y cualquier error de recarga
/rules reload    relee el archivo de reglas de este workspace
```

La salida de los comandos es solo UI: el modelo aprende las reglas únicamente a través de los resultados que producen.

## Colaboración con dsh-auto-review

- `dsh-permission-rules` produce `ask`; `dsh-auto-review` responde en el waterfall `approval/request` con un veredicto de un segundo modelo de solo lectura (o delega a humanos). Monta ambos para el bucle completo.
- Probado en integración (`test/integration.spec.ts`): `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, con el revisor sustituido por un mock.
- La política de aprobación `never` y todas las garantías fail-closed del [harness oficial](https://github.com/deepseek-ai/deepseek-harness) permanecen intactas.

## Límites de seguridad

- **Política, no kernel.** Los candidatos de `paths` provienen solo de un conjunto documentado de claves de argumentos, y solo coinciden rutas relativas al workspace.
- **Aquí no hay revisor.** El plugin nunca lanza subagentes ni llama modelos: producir una decisión `ask` es el final de su trabajo.
- **Sin cambios de sandbox.** La política de sandbox a nivel de SO pertenece al seam de sandbox, no a este plugin.
- **Mala configuración ruidosa.** Campos YAML desconocidos, acciones desconocidas y patrones incorrectos se rechazan al cargar, nunca se ignoran en silencio.

## Trabajo relacionado

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — clasificador allow/deny de dos estados con auditoría en archivo propio; este plugin añade la semántica completa de tres estados, reglas YAML declarativas, auditoría en el log de sesión y delegación segura con `next()`.
- `Drifter-yh/dsh-tool-policy` — política de herramientas deny-by-default; documentada aquí para evitar implementaciones duplicadas.
- `dsh-auto-review` — la mitad de respaldo de IA del bucle que este plugin encabeza.

## Limitaciones conocidas

- `permissionRules/decision` se escribe con el marcador de envoltura `ignorable: true`, de modo que cualquier build del harness carga el registro: los lectores que no conocen el tipo fuera del repositorio simplemente omiten el evento de auditoría en lugar de rechazar la sesión. (Los hosts rc.6 aceptan e ignoran el marcador, conservando exactamente el comportamiento anterior.)
- Los candidatos de `paths` son heurísticos: solo las claves de argumentos documentadas alimentan la coincidencia de rutas.
- Los globs son un subconjunto conservador (sin expansión de llaves): escribe dos patrones o usa el modo regex.

## Desarrollo

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc, src + tests
pnpm test           # vitest: 58 tests, 7 suites
pnpm run build      # declaraciones tsc + bundles tsdown (lib/)
pnpm pack           # artefacto de publicación
```

Consulta [VERIFICATION.md](VERIFICATION.md) para el registro de verificación headless de extremo a extremo (deny bloqueando una herramienta de shell, ask enrutado por el seam de aprobación, `--dump-config`).

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
