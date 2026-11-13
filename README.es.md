<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-permission-rules-hero-en-dark.webp">
  <img src="docs/assets/dsh-permission-rules-hero-en-light.webp" width="100%" alt="El libro de decisiones de dsh-permission-rules: la primera coincidencia de una cadena de reglas ordenada, su tarjeta de veredicto deny y la franja del proxy para la salida de shell">
</picture>

# dsh-permission-rules

**Recupera la autoridad de decisión sobre las llamadas de herramientas: cada allow / deny / ask vive en YAML, de forma determinista, instantánea y auditable.**

Un middleware de permisos declarativo al estilo Claude Code para DeepSeek Harness: las reglas deciden lo conocido y un modelo revisor decide lo desconocido; además incluye una política de red de nivel de proceso al estilo Codex y un proxy local que gobiernan la salida de los subprocesos de shell.

[Instalar](#instalación-en-tres-pasos) · [Configuración](#configuración) · [FAQ](#faq) · [简体中文](README.md) · [English](README.en.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-3366CC?style=flat-square&labelColor=2B3245)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.1.2%20%3C0.3.0-4B67B4?style=flat-square&labelColor=2B3245)](#compatibilidad)
[![npm](https://img.shields.io/npm/v/dsh-permission-rules?style=flat-square&labelColor=2B3245&color=CB3837)](https://www.npmjs.com/package/dsh-permission-rules)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI&style=flat-square&labelColor=2B3245)](https://github.com/PerryLink/dsh-permission-rules/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24.9-339933?style=flat-square&labelColor=2B3245)](#compatibilidad)

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

<sub>Plugin de la comunidad, no afiliado a DeepSeek. Repositorio canónico: <https://github.com/PerryLink/dsh-permission-rules> (Gitee es un espejo).</sub>

## Qué es

`dsh-permission-rules` pone una lista ordenada de reglas **`allow` / `deny` / `ask`** delante de cada llamada de herramienta en el waterfall `tools/pre-execute`: determinista, instantánea, auditable y escrita por ti en YAML puro. Las reglas deciden las llamadas que conoces; las dudosas van al seam oficial de aprobación, donde responde un modelo revisor o una persona. Una segunda capa añade una política de red de nivel de proceso al estilo Codex: la salida de los subprocesos de shell pasa por un proxy local HTTP/CONNECT integrado, regido por reglas de red o por tres modos mapeados a los presets oficiales de sandbox.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-permission-rules-flow-v5-dark.svg">
  <img src="docs/assets/dsh-permission-rules-flow-v5-light.svg" width="100%" alt="Estructura de dsh-permission-rules: las llamadas de herramientas y la salida de shell confluyen en una cadena de reglas ordenada, se bifurcan en veredictos de herramientas y de red, y cierran con dos eventos de auditoría solo-log">
</picture>

*Estructura: dos canales (llamadas de herramientas / salida de shell) confluyen en una cadena de reglas ordenada —gana la primera coincidencia— y se bifurcan en veredictos de herramientas y de red, cerrados por dos eventos de auditoría solo-log.*

## Instalación en tres pasos

1. **Instala** (elige un canal):

   ```sh
   # canal git (main más reciente; el script prepare compila solo con dependencias de producción)
   dsh plugin --profile web add github:PerryLink/dsh-permission-rules
   # canal npm (versiones publicadas)
   dsh plugin --profile web add dsh-permission-rules
   # canal tarball: pnpm pack en este repo y luego
   dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz
   ```

2. **Escribe tu primera regla** (`.dsh/rules.yaml` en la raíz del proyecto; es opcional, la línea base de alto riesgo viene activada):

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

3. **Verifica que se monta**:

   ```sh
   # tras reiniciar el perfil, confirma la fila del plugin
   dsh --profile web --dump-config | grep -A4 'id: permission-rules'
   # evalúa en seco una llamada hipotética en la superficie de comandos real; no ejecuta ninguna herramienta
   /rules test bash {"command":"git push origin main","cwd":"src/secrets/app"}
   ```

```text
"bash" matches rule 1 (deny): 禁止 push 到受保护路径
```

**Desinstalar**: `dsh plugin --profile web remove dsh-permission-rules` (o borra la fila del patch del perfil).

<details>
<summary>Instalar desde el mercado de DSH Desktop</summary>

Todos los plugins de PerryLink figuran en el mercado integrado de DSH Desktop: **Mercado → Fuentes → Añadir fuente → pega** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ selecciona**. La instalación sigue requiriendo la verificación de identidad npm del mercado y tu confirmación.

</details>

## Capacidades clave

`dsh-permission-rules` pone reglas ordenadas delante de cada llamada de herramienta en `tools/pre-execute`: determinista, instantáneo, auditable:

- **`deny`** bloquea la llamada; el `reason` de la regla se convierte en el error visible para el modelo.
- **`ask`** usa el seam oficial de aprobación (monta `dsh-auto-review` para que responda un segundo modelo, o responde una persona; sin ninguno, el harness falla cerrado).
- **`allow`** (y la ausencia de coincidencia) delega estrictamente vía `next()`: los listeners posteriores nunca se cortocircuitan.

Cada acierto **y** cada paso directo se audita como evento de sesión `permissionRules/decision` (solo registro: no se inyecta nada extra en el contexto del modelo).

- **Coincidencia rica** — globs de nombre de herramienta (incluido `mcp__*`), selectores de identidad de agente (`main` / `subagent` / `preset:*`), globs **o** regex de claves/valores de argumentos (con negación `!pattern` y la dimensión de clave `absent`), globs de rutas relativas al workspace a **cualquier profundidad**, condiciones de host `when` (variables de entorno, plataforma) y **descomposición de comandos de shell** (`argv`: palabra de comando, tokens de argumento, firma de tubería) para coincidencias precisas a nivel de token.
- **Línea base de alto riesgo integrada** — un conjunto deny/ask incluido (comandos destructivos, escalada de privilegios, descarga y ejecución, rutas sensibles) activado por defecto y añadido tras las reglas de usuario, de modo que una regla más cercana puede anularlo; se controla con `builtin.enabled`.
- **Archivos de reglas jerárquicos** — `searchUp` opcional fusiona cada `.dsh/rules.yaml` desde el cwd de la sesión hasta la raíz del sistema, lo más cercano primero.
- **Despliegue en simulación** — `enforce: false` audita lo que la política *haría* mientras deja pasar cada llamada.
- **Recarga en caliente** — watch de Chokidar con debounce; una edición rota a nivel de archivo conserva las reglas anteriores y nunca bloquea, mientras que una sola regla inválida solo se deshabilita a sí misma. En un host WSL, o para un archivo bajo `/mnt/<unidad>`, el watch pasa a polling porque allí los eventos nativos no son fiables.
- **Ruidosa pero acotada** — los errores de archivo (YAML inválido y similares) siguen `badFilePolicy`; una regla inválida (glob/regex malo, campo/acción desconocidos) solo se deshabilita a sí misma y se muestra al inicio y en `/rules`, mientras las demás siguen funcionando (issue #49).

### Superficie de comandos y herramientas

| Superficie | Tipo | Notas |
|---|---|---|
| `tools/pre-execute` | listener | Reglas allow/deny/ask de primera coincidencia + extracción de URL candidatas de red |
| `/rules` | command | `list` · `reload` · `decisions [n]` · `test <tool> <json>` |
| `permissionRules/decision` | event | Auditoría solo-log de cada acierto y paso directo |
| `permissionRules/network` | event | Auditoría de la capa proxy para conexiones bloqueadas |
| HTTP/CONNECT proxy | service | Proxy local integrado que gobierna el tráfico de los subprocesos de shell |
| settings page | client | Editor de modo de red, editor de reglas, contadores de bloqueos e intercepciones recientes con acción de permitir por bloqueo |

```text
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call
```

`/rules test` también acepta flags iniciales: `--cwd <dir>`, `--env KEY=VALUE` (repetible), `--agent <selector>` (repetible) y `--platform <name>`. En cadenas de varios archivos (p. ej. `searchUp`), cada línea de regla listada se atribuye a su propio archivo de origen.

### Ejemplos

Estos son los puntos de entrada reales del plugin; instala una vez y llama a uno.

**Ejemplo detallado** — comando `/rules test bash {"command":"git push origin main","cwd":"src/secrets/app"}`, salida:

```text
"bash" matches rule 1 (deny): 禁止 push 到受保护路径
```

*Observed from `test/command.spec.ts:204-219 (assertions at :209-213); src/prose.ts:121`*

**Rama de fallo** — entrada `/rules test bash {not json`, salida:

```text
Invalid JSON arguments "{not json": the arguments must parse as JSON.
```

*Observed from `plugins/dsh-permission-rules/src/prose.ts:123; plugins/dsh-permission-rules/src/runtime.ts:1266-1272; plugins/dsh-permission-rules/test/command.spec.ts:221-228`*

**Ejemplos breves**: `tools/pre-execute` · `/rules test <tool> <json>`

## Sintaxis de reglas

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

- **Dimensiones de coincidencia** — `tools` (globs, incl. `mcp__*`), `agents` (`main` / `subagent` / `preset:<name>`; una identidad desconocida nunca coincide: falla cerrado), `params` (globs o regex de clave/valor, negación `!pattern`, dimensión de clave `absent`), `paths` (globs relativos al workspace extraídos a cualquier profundidad), `when` (globs/regex de variables `env` + lista cerrada `platform`) y `network` (`domains` / `ips` / `ports` / `schemes`: globs, comodines, CIDRs, rangos de puertos).
- **Acciones** — `allow` / `deny` / `ask`, evaluadas en orden de archivo, gana la primera coincidencia.
- **Metadatos de regla** — `enabled: false` (visible pero inerte), `description`, `tags`; los campos desconocidos fallan al cargar.
- **Esquema** — un JSON Schema en [docs/rules-format.schema.json](docs/rules-format.schema.json) (autocompletado del editor con `# yaml-language-server: $schema=...`); el vocabulario completo y una línea base de seguridad de 5 reglas están en [docs/rules-format.en.md](docs/rules-format.en.md).

## Política de red

Una **política de red de nivel de proceso** al estilo Codex: el tráfico de los subprocesos de shell pasa por un **proxy HTTP/CONNECT local integrado**, y cada conexión la deciden reglas de red ordenadas o tres modos mapeados a los presets oficiales de sandbox:

- **`deny-all`** — el preset de sandbox de solo lectura: bloquea toda salida.
- **`whitelist`** — el preset workspace-write: permite los objetivos listados y aplica `unlisted: ask` (o `deny`) al resto.
- **`allow-all`** — el preset danger-full-access: permite todo.
- **`auto`** (predeterminado) — sigue el preset de sandbox; en hosts sin el servicio de política de sandbox se resuelve en `autoFallback` (`allow-all`).

- **Coincidencia** — `match.network` con `domains` / `ips` / `ports` / `schemes` (globs, comodines, CIDRs, rangos de puertos; se aceptan puertos YAML numéricos). La extracción de URL candidatas en la ruta caliente `tools/pre-execute` se dispara con argumentos de herramientas web y URL incrustadas en el texto de comandos bash/pwsh; los objetivos de loopback pueden cortocircuitar reglas según la política `loopback`. Los literales IPv6 mapeados desde IPv4 se normalizan a su forma IPv4 antes de comparar, y el proxy conecta a las direcciones sobre las que se decidió, nunca a una segunda resolución DNS: una conexión cuya adjudicación no resolvió ninguna dirección falla cerrada (502) en lugar de marcar el nombre.
- **Encadenado ascendente** — `network.upstreamProxy` (por defecto `off`) envía las conexiones que este proxy **permite** a través de un proxy ascendente: CONNECT pide al ascendente un túnel (`CONNECT host:port`) y las peticiones HTTP simples se reenvían en forma absoluta. Un objetivo bloqueado nunca llega al ascendente: sigue recibiendo el 403 estructurado de este plugin. Dos casos nunca se encadenan aunque haya un ascendente configurado: un objetivo de **loopback** (un proxy fuera de este host no puede enrutar su loopback) y cualquier decisión producida por una **regla con alcance `ips`** (el encadenado entrega el nombre de host al ascendente, así que "la conexión aterriza en una dirección que las reglas vieron" — issue #21 — dejaría de cumplirse justo donde a las reglas les importaba la dirección; esas decisiones siguen marcando directamente la dirección adjudicada), más un objetivo cuyo scheme no tiene ascendente utilizable. El nombre de host del propio ascendente es configuración del operador, no entrada del agente, y no lo adjudican estas reglas. Una URL con credenciales nunca se emite en crudo: los avisos, `/rules network` y la instantánea de la página de ajustes enmascaran la contraseña (`http://user:***@host:port`). Un ascendente inalcanzable, un timeout (10 s) o una respuesta no 2xx producen **502**; deliberadamente no hay fallback silencioso a la conexión directa, para que una mala configuración siga siendo visible.
- **Auditoría** — las conexiones denegadas añaden `permissionRules/network` a la sesión propietaria (misma puerta adaptativa `ignorable`), con contadores de bloqueos e intercepciones recientes en `/rules network` y en la página de ajustes.
- **Diagnóstico** — las conexiones bloqueadas llevan un mensaje `[network: …]` que nombra el objetivo bloqueado, el modo o la regla que decidió y la remediación.
- **Permitir desde la página de ajustes** — cada intercepción reciente ofrece una acción **Permitir**. Escribe UNA regla mínima `match: { network: { domains: [<host>] } }` / `action: allow` en la **parte superior** (índice 0) del archivo de reglas más cercano que realmente juzga esa conexión: el archivo de proyecto del workspace al que se atribuyó el bloqueo (el `rulesFile` absoluto cuando está configurado) o, para un bloqueo de nivel de host sin sesión, el archivo que resuelve la cadena de host (`rulesFile` absoluto → `<processCwd>/<rulesFile>` existente → `fallbackPath` configurado → `<processCwd>/<rulesFile>`, creado); y cuando hay varios workspaces cargados, la página ofrece primero un selector, porque cualquier cadena de workspace cargada supera a la cadena de host. Índice 0 porque las reglas son de primera coincidencia: añadida tras un `deny` existente, la regla sería texto muerto. Solo `domains`, porque esa dimensión incluye subdominios y es ajena a puerto/scheme, así que el host no se vuelve a bloquear en su siguiente puerto; los comentarios existentes y las reglas no tocadas sobreviven, y el texto pasa por la misma puerta de validación que una edición manual. El cambio surte efecto de inmediato — se releen las cadenas de workspace en caché Y la cadena de host sin sesión, sin reinicio y sin `/rules reload` — y la decisión se recalcula, así que el aviso informa el resultado REAL y nunca afirma éxito mientras la conexión sigue bloqueada. Rechaza, dejando el archivo intacto, un workspace desconocido, un objetivo fuera de las fuentes de reglas conocidas, la línea base integrada de solo lectura y un archivo que no puede leer o parsear; una conexión ya permitida no escribe nada. `network.allowHostAction: false` oculta el botón y hace que el RPC rechace.

## Configuración

Todos los ajustes son campos `Config` de Schemastery (modificables desde cordis.yml). Una anulación dirigida por id reemplaza la fila entera: repite cada clave que necesites. En un host `0.1.7-alpha` cada campo se declara `.volatile()`, así que también se edita in situ desde la página de ajustes de Plugins: la edición se confirma en las referencias en ejecución sin remontar el plugin, el runtime lee el nuevo valor en su siguiente uso, y un cambio en `network.proxyPort`, `proxyBind`, `injectEnv` o `noProxy` reengancha el proxy local de inmediato. Los límites numéricos viven en el esquema, y el editor de configuración resuelve la configuración fusionada contra ese esquema antes de persistir, de modo que un valor fuera de rango se rechaza en el momento de escribir. En un host cuyo Schemastery es anterior a `volatile()`, estos campos solo se cambian por cordis.yml.

Claves más usadas:

| Clave | Predeterminado | Significado |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Ubicación del archivo de reglas; relativa = resuelta contra el cwd de la sesión llamante, absoluta = global y validada al montar |
| `fallbackPath` | *(none)* | Archivo de reglas usado cuando el descubrimiento por cwd no encuentra nada; validado al montar |
| `badFilePolicy` | `fail` | Fallos de archivo: `fail` hace fallar ruidosamente la llamada pendiente; `ignore-with-warning` avisa y continúa vacío. Una regla inválida siempre se aísla: esa regla se deshabilita y se informa al inicio y en `/rules` |
| `maxRules` | `256` | Límite duro de reglas en la cadena efectiva de fuentes |
| `patternMode` | `glob` | Estilo de patrón de `params`/`paths`/`when.env`: `glob` o `regex` (los nombres de herramienta son siempre globs) |
| `watch` | `true` | Watch de Chokidar + recarga al cambiar |
| `enforce` | `true` | `false` = modo simulación: los aciertos deny/ask se auditan con marca `dryRun` y toda llamada pasa |
| `language` | `en` | Idioma de salida de `/rules`: `en`, `zh`, `es`, `pt`, `hi` |

<details>
<summary>Tabla de configuración completa (29 claves)</summary>

| Clave | Predeterminado | Significado |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | Ubicación del archivo de reglas; relativa = resuelta contra el cwd de la sesión llamante, absoluta = global y validada al montar |
| `fallbackPath` | *(none)* | Archivo de reglas usado cuando el descubrimiento por cwd no encuentra nada; validado al montar |
| `badFilePolicy` | `fail` | Fallos de archivo: `fail` hace fallar ruidosamente la llamada pendiente; `ignore-with-warning` avisa y continúa vacío. Una regla inválida siempre se aísla: esa regla se deshabilita y se informa al inicio y en `/rules` |
| `maxRules` | `256` | Límite duro de reglas en la cadena efectiva de fuentes |
| `maxCachedWorkspaces` | `512` | Límite duro de cargas de reglas por workspace en caché (expulsión LRU) |
| `patternMode` | `glob` | Estilo de patrón de `params`/`paths`/`when.env`: `glob` o `regex` (los nombres de herramienta son siempre globs) |
| `watch` | `true` | Watch de Chokidar + recarga al cambiar |
| `watchStabilityThresholdMs` | `200` | Ventana de debounce de recarga (ms) |
| `language` | `en` | Idioma de salida de `/rules`: `en`, `zh`, `es`, `pt`, `hi` |
| `caseInsensitivePaths` | *(win32)* | Los patrones `paths` y la comparación con la raíz del workspace ignoran mayúsculas ASCII; `true` en Windows |
| `audit` | `all` | Granularidad de auditoría: `all` registra cada acierto Y cada paso directo; `hits` omite los pasos directos |
| `searchUp` | `false` | Recorre los directorios padre desde el cwd de la sesión y fusiona cada archivo de reglas encontrado, el más cercano primero |
| `maxGlobStars` | `2` | Límite duro de cuantificadores `*`/`**` sin límite por patrón glob |
| `enforce` | `true` | `false` = modo simulación: los aciertos deny/ask se auditan con marca `dryRun` y toda llamada pasa |
| `allowUnmarkedAudit` | `false` | Los hosts pre-marcador descartan la marca `ignorable`; el plugin desactiva la auditoría del registro de sesión con un aviso. Pon `true` para reactivarla |
| `network.enabled` | `true` | Interruptor maestro del proxy, la inyección de entorno y los valores por defecto del modo de herramientas web |
| `network.mode` | `auto` | Modo de política: `auto` sigue el preset de sandbox, o `deny-all` / `whitelist` / `allow-all` |
| `network.autoFallback` | `allow-all` | Modo usado cuando `auto` no tiene servicio de política de sandbox |
| `network.unlisted` | `ask` | Tratamiento en modo whitelist de objetivos sin coincidencia: `ask` o `deny` |
| `network.proxyBind` | `127.0.0.1` | Dirección de enlace del proxy local (solo loopback) |
| `network.proxyPort` | `0` | Puerto del proxy local; `0` elige un puerto efímero libre |
| `network.proxyMaxRecent` | `100` | Límite de registros de bloqueos recientes para la página de ajustes |
| `network.loopback` | `allow` | Objetivos de loopback: `allow` (paridad con Codex) o `policy` |
| `network.injectEnv` | `true` | Si se inyectan variables de entorno de proxy para los subprocesos |
| `network.noProxy` | `clear` | Manejo de NO_PROXY en subprocesos: `clear` impone la política o `preserve` |
| `network.upstreamProxy` | `off` | Proxy ascendente para las conexiones que este plugin PERMITE: `off` conecta directo, `inherit` reutiliza los nombres de proxy del entorno de lanzamiento, o una URL `http(s)://` explícita |
| `network.allowHostAction` | `true` | Acción "permitir este host" por bloqueo en la página de ajustes: `false` oculta el botón Permitir y hace que el RPC `permissionRules/allowHost` rechace (el editor de reglas no se ve afectado) |
| `builtin.enabled` | `true` | Línea base de alto riesgo integrada: `false` desactiva por completo el conjunto deny/ask incluido |
| `builtin.path` | *(incluido)* | Archivo de línea base de reemplazo (absoluto o relativo a `process.cwd()`); validado al montar |

</details>

## FAQ

<details>
<summary>¿Dónde viven los archivos de reglas? ¿El plugin escribirá en mis archivos?</summary>

Las reglas se leen de disco: `.dsh/rules.yaml` en la raíz del proyecto, o el `rulesFile` / `fallbackPath` configurado, fusionados hacia arriba con `searchUp`. La ruta normal de adjudicación no escribe ningún dato de reglas. Las únicas superficies de escritura son el editor de reglas de la página de ajustes y la acción "Permitir": esta última escribe una regla allow mínima al principio de una fuente de reglas conocida y vuelve a pasar la misma validación de parseo/compilación que una edición manual (ver "Política de red").

</details>

<details>
<summary>¿Qué pasa con ask si no está montado dsh-auto-review?</summary>

`ask` usa el seam oficial de aprobación: con `dsh-auto-review` montado responde un segundo modelo de solo lectura; si no, responde una persona; sin ninguno, el harness falla cerrado y la llamada nunca se permite en silencio. Este plugin nunca lanza subagentes ni llama a modelos: producir una decisión `ask` es el final de su trabajo.

</details>

<details>
<summary>¿Este proxy intercepta las peticiones salientes del propio host?</summary>

No. El entorno de proxy inyectado cubre los **hijos de shell lanzados** y cualquier consumidor que lea los nombres de proxy en el momento de la petición. **No** cubre el tráfico propio del proceso host basado en `fetch`: el launcher instala el dispatcher global de undici desde el entorno de lanzamiento antes de que se monte el primer plugin, y ese dispatcher enruta por su política, no por el entorno. Por tanto los endpoints del proveedor no necesitan regla de permiso, y `network.injectEnv: false` no saca al proceso host de nada. Medido el 2026-09-10 en Node 22; reproducible con `scripts/host-egress-probe.mjs`.

</details>

<details>
<summary>¿Cuánto cuesta en la ruta caliente?</summary>

La evaluación de reglas es un recorrido en memoria de primera coincidencia: sin llamadas a modelos ni peticiones de red; los aciertos y pasos directos solo añaden auditoría de sesión. Un watch que falla avisa y conserva las reglas anteriores. Con conjuntos grandes, pon `audit: hits` para omitir los pasos directos, o acota la carga con `maxRules` / `maxCachedWorkspaces`.

</details>

<details>
<summary>¿Compite con otros plugins por eventos, nombres de comando o slots?</summary>

No. Los nombres de herramienta llevan namespace y no se toma ningún nombre desnudo; las claves de servicio `permissionRules` / `permissionRulesRuntime` no son un seam integrado y ningún plugin de muchas estrellas encuestado las proporciona; no registra slots de cliente ni prefijos `webServer`, y su patch solo `insert`a su propia fila; los eventos compartidos siempre delegan vía `next()`. El argumento punto por punto está en "Interoperabilidad con otros plugins DSH".

</details>

## Límites de seguridad

- **Política, no kernel.** Los candidatos de `paths` vienen solo de un conjunto documentado de claves de argumento (a cualquier profundidad, con límite de profundidad), y solo coinciden rutas relativas al workspace.
- **Aquí no hay revisor.** El plugin nunca lanza subagentes ni llama a modelos: producir una decisión `ask` es el final de su trabajo.
- **Sin cambios de sandbox.** La política de sandbox a nivel de SO pertenece al seam de sandbox, no a este plugin.
- **Configuración inválida ruidosa.** Campos YAML desconocidos, acciones desconocidas y patrones malos se rechazan al cargar.
- **Límites de backtracking.** Los patrones glob se limitan a `maxGlobStars` expansiones de estrella sin límite; los patrones en modo regex rechazan cuantificadores anidados sin límite y alternancias literales solapadas cuantificadas.
- **Marcado que falla cerrado.** Los reenvíos HTTP planos y los túneles CONNECT solo conectan a direcciones adjudicadas; un allow cuya adjudicación no resolvió dirección falla cerrado con 502 en lugar de marcar el nombre (issue #23).

## Permisos y datos

- **Permisos**: declara `files:read`, `files:watch`, `files:write`, `session:append` y `network:outbound` en su manifiesto workshop. Las decisiones `ask` usan el seam oficial de aprobación: nada se reimplementa ni se evita.
- **Datos**: los archivos de reglas se leen de disco; la adjudicación normal no escribe datos de reglas: las únicas superficies de escritura son el editor de reglas de la página de ajustes y la acción "Permitir". Sin llamadas a modelos, sin subagentes revisores.
- **Registro de sesión**: `permissionRules/decision` nunca se inyecta en el contexto del modelo y se añade con la marca `ignorable: true` del sobre, de modo que cualquier build del harness carga el registro.

## Limitaciones conocidas

- **Marca de auditoría en hosts pre-marcador y hostiles.** `permissionRules/decision` se añade con `ignorable: true`; los hosts cuyo `Session.append` es anterior a la marca (las líneas `0.1.0-rc.1`–`rc.7` y `0.1.1-rc.1`–`rc.7`) la descartan en silencio, la línea `0.1.2-rc` trae la superficie alpha.5 (ninguna opción de append escribe la marca), la línea `0.1.2-alpha` rechaza los eventos de plugin al leer incluso marcados, y las líneas `0.1.3-alpha` y `0.1.5-alpha` mantienen la misma firma de append solo-superficie (verificado en los paquetes publicados `0.1.3-alpha.1`/`0.1.5-alpha.1`): el runtime precomprueba todas antes del primer append y desactiva la auditoría del registro de sesión con un aviso único. La migración entre generaciones también rechaza filas de auditoría marcadas: la puerta v1→v2 de `0.1.3-alpha` rechaza eventos v1 desconocidos, y la puerta v2→v3 de `0.1.5-alpha` rechaza todo evento no clasificado (su inventario está congelado al vocabulario v2 publicado), así que haz `strip` de las filas v1 antes de que un host 0.1.3 abra el registro y de las filas v2 antes de actualizar a un host 0.1.5. Los registros v3 nativos aceptan filas de plugin marcadas, así que solo necesitan `repair`. Pon `allowUnmarkedAudit: true` para reactivarla; repara los registros ya escritos con `scripts/repair-session-logs.mjs` (su modo `strip` elimina filas de auditoría donde la marca no ayuda).
- **Los candidatos de ruta son heurísticos.** Solo las claves de argumento documentadas alimentan la coincidencia de rutas, y la coincidencia relativa al workspace ignora mayúsculas ASCII solo con `caseInsensitivePaths` activo.
- **Los globs son un subconjunto conservador.** Sin expansión de llaves: escribe dos patrones, o usa el modo regex.
- **La guarda de backtracking regex es estructural, no exhaustiva.** Prefiere el modo glob para archivos no confiables.
- **Las peticiones salientes del propio host no pasan por este proxy.** El entorno de proxy inyectado cubre los **hijos de shell lanzados** —que es el propósito de la inyección— y cualquier consumidor que lea los nombres de proxy en el momento de la petición. **No** cubre el tráfico propio del proceso host basado en `fetch`: el launcher instala el dispatcher global de undici desde el **entorno de lanzamiento** antes de que se monte el primer plugin, ese dispatcher enruta por su política y no por el entorno, y Node muestrea el entorno de proxy al arrancar, así que un plugin montado después no puede redirigirlo. Consecuencias: los endpoints del proveedor **no** necesitan regla de permiso, y `network.injectEnv: false` no saca al proceso host de nada. Medido el 2026-09-10 en Node 22; reproducible con `scripts/host-egress-probe.mjs`.
- **El encadenado ascendente solo cubre lo que llega a este proxy.** En `dsh-v0.1.7-alpha.1` y posteriores, la política de proxy de lanzamiento del propio harness y su capa de entorno de subprocesos pueden tener precedencia sobre los nombres de proxy que este plugin inyecta, así que `network.upstreamProxy` describe lo que ocurre con las conexiones que maneja este proxy: no es una afirmación sobre cada ruta saliente del proceso host.

## Interoperabilidad con otros plugins DSH

Verificado contra **DSH `0.2.0-rc.2`** (el runtime para el que se publica este README) y el conjunto de plugins de muchas estrellas encuestado el 2026-10-05.

Este plugin **no interfiere** con otros plugins, incluidos los de muchas estrellas ampliamente instalados:

- **Sin colisión de nombres de herramienta.** Cada herramienta lleva namespace; no se registra ningún nombre desnudo propiedad de una herramienta incluida o de otro plugin.
- **Sin colisión de claves de servicio.** Proporciona `permissionRules`, `permissionRulesRuntime`; esas claves no son un seam integrado y ningún plugin de muchas estrellas encuestado las proporciona.
- **Sin colisión de slots.** No registra ninguna clave de slot de cliente, así que no compite por un asiento de `shadows-shipped-ui`.
- **Sin colisión de rutas HTTP.** No registra ningún prefijo `webServer`.
- **Sin colisión de capa patch.** El patch del bundle solo `insert`a su propia fila; nunca sobrescribe el `config` de una fila integrada.
- **Sin mutación global.** No parchea prototipos, no reescribe `process.env` ni reemplaza el dispatcher global de fetch.

**Los listeners de eventos compartidos no interfieren por construcción.** Observa los eventos sensibles al orden `tools/post-execute`, `tools/pre-execute` con `ctx.on()`: el registro de broadcast de Cordis, donde todos los listeners se ejecutan y ninguno puede dejar en inanición a otro. **Cada listener aquí delega vía `next()`**, así que la cadena nunca se cortocircuita, y una mutación se aplica al valor que produjo `next()` en lugar de sustituir su retorno:

- `tools/post-execute` — also used by `cc-safety-net` (1576★).
- `tools/pre-execute` — also used by `cc-safety-net` (1576★).

Evidencia estática: `dsh-plugin-doctor` K10–K13 informan `pass` en cada comprobación de este repositorio.

## Colaboración con dsh-auto-review

- `dsh-permission-rules` produce `ask`; `dsh-auto-review` responde en el waterfall `approval/request` con un veredicto de segundo modelo de solo lectura (o delega en personas). Monta ambos para el bucle cerrado completo.
- Probado en integración: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, con el revisor sustituido por un mock con script.
- La política de aprobación `never` y toda garantía de fallo cerrado del harness oficial permanecen intactas.

## Reparación de registros de sesión

Los registros de sesión escritos antes de que existiera la marca `ignorable` pueden ser rechazados por builds más nuevas del harness (`SessionFormatUnsupportedError`). El `scripts/repair-session-logs.mjs` incluido reescribe solo las filas de auditoría objetivo para que lleven `ignorable: true`, preservando el frame y con copias de seguridad:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # reporta filas ajenas, no cambia nada
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
node scripts/repair-session-logs.mjs strip [--home DIR] [--dry-run]
```

`--home` por defecto es `$DSH_HOME/sessions` (o `~/.dsh/sessions`). Cada registro direccionado por generación se descubre por su basename canónico — `session.jsonl`, `session.v2.jsonl`, `session.v3.jsonl`, cada uno opcionalmente comprimido con `.zstd` — así que elige el modo según la generación:

- **v3 (`session.v3.jsonl`, escrito nativamente por la línea `0.1.5-alpha`)** — la ruta de lectura acepta filas de plugin marcadas, así que basta con `repair`.
- **v2 (`session.v2.jsonl`, escrito por la línea `0.1.3-alpha`)** — `repair` lo abre en el host que lo escribió, pero la migración v2→v3 de `0.1.5-alpha` rechaza todo evento no clasificado aunque esté marcado: ejecuta `strip` sobre los registros v2 **antes** de actualizar a un host `0.1.5-alpha`.
- **v1 (`session.jsonl`)** — la migración v1→v2 de `0.1.3-alpha` rechaza eventos v1 desconocidos aunque estén marcados: ejecuta `strip` antes de que un host 0.1.3 o posterior abra el registro por primera vez.

## Compatibilidad

| Superficie | Estado |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (adaptado el 2026-09-22, cadena de puertas completa): su configuración de plugin es el contrato de ajustes en vivo — cada campo se declara `.volatile()`, el Loader entrega a `apply` una referencia viva por campo, y una edición guardada se confirma en las referencias en ejecución SIN remontar el plugin, con valores fuera de rango rechazados por el esquema antes de escribir nada. Un host cuyo Schemastery es anterior a `volatile()` (antes de 3.18.3) sigue montando y ejecutando este plugin — los campos simplemente quedan como valores ordinarios y el formulario de configuración en vivo no está disponible — porque la marca se aplica mediante una sonda de capacidad, no por suposición. `Session.append` en esta línea aún no puede estampar la marca `ignorable` (su tercer argumento es la bolsa de intención de superficie, y el campo del sobre sobrevive solo para lecturas de registros almacenados), así que toda la línea `0.2-alpha` se precomprueba como sin marca y la auditoría del registro de sesión queda desactivada por defecto — `append` solo lee `sourceEventSeqs`/`surfaceOp` y congela el sobre, así que no tiene ruta de código que pueda estampar la marca; las líneas anteriores `0.1.7-alpha` (adaptada el 2026-09-22), `0.1.5-rc.2` (adaptada el 2026-09-09) y `0.1.3-alpha` mantienen la misma firma de append solo-superficie, y cada prelanzamiento `0.2` se clasifica con ellas (una versión ESTABLE `0.2.x` se deja a la sonda de append, así que una superficie de marca restaurada se adopta sin un nuevo release del plugin). Las migraciones de registro de esas líneas rechazan eventos de plugin no clasificados incluso marcados, así que haz `strip` de las filas de auditoría v1 antes de que un host `0.1.3-alpha` abra el registro y de las filas v2 antes de que lo migre un host `0.1.5-alpha` (los registros v3 nativos solo necesitan `repair`). |
| Node | `^22.19.0 || >=24.9.0` |
| Plataformas | Todas (host + cliente web de ajustes) |
| Modelo | Cualquiera (los motivos deny/ask se muestran a través de los resultados de herramientas) |

## Ecosistema y calidad

- [Espejo Gitee](https://gitee.com/perrylink/dsh-permission-rules) (espejo sincronizado; GitHub es canónico)
- [Página del plugin en dshfind](https://dshfind.com/plugins/PerryLink/dsh-permission-rules) (instalaciones y ranking)
- [Informe OpenSSF Scorecard](https://securityscorecards.dev/viewer/?uri=github.com/PerryLink/dsh-permission-rules) (impulsado por [.github/workflows/scorecard.yml](.github/workflows/scorecard.yml))
- [Informe de verificación de dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章) (K10–K13 todos `pass`)
- [DSH Market](https://dsh.market/) (listado)
- **Canal de la tienda 1024**: `npm i -g dsh1024` una vez, luego `dsh1024 plugin --profile web add dsh-permission-rules` (cuenta para el ranking de instalaciones de [deepseek1024.com](https://deepseek1024.com))
- [Base de conocimiento del ecosistema](https://perrylink.github.io/dsh-plugin-guide/): datos medidos, no marketing: guía de desarrollo de plugins · datos de selección de plugins · criterios de mantenimiento

## Desarrollo

```sh
pnpm install            # node ^22.19 || >=24.9
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 24 spec files
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # puerta de sincronización de los README en cinco idiomas (también en CI)
```

Consulta [VERIFICATION.md](VERIFICATION.md) para el registro de verificación end-to-end sin interfaz. Las imágenes del README se generan programáticamente con [`scripts/gen-readme-assets.py`](scripts/gen-readme-assets.py) (Pillow dibuja los banners hero de 1440×576 en chino/inglés y claro/oscuro; un SVG de 1100×660 dibujado a mano es la figura de estructura) y se pueden volver a ejecutar sin riesgo.

Topics: `dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## Familia y agradecimientos

Este proyecto forma parte de la familia de plugins de DeepSeek Harness de [PerryLink](https://github.com/PerryLink) (todos Apache-2.0). Si te resulta útil, **una estrella ayuda a que la siguiente persona lo encuentre** — no hay nada bloqueado tras ella.

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: vocabulario y evaluación de reglas, runtime, watch HMR, auditoría del registro de sesión, política de red + proxy y la documentación en cinco idiomas.
- [@am-i-dead](https://github.com/am-i-dead) — separó los helpers allow-host seguros para el cliente del módulo solo-host (#24).
- [@22xuan](https://github.com/22xuan) — el informe detallado sobre los hosts rc.6 que descartan en silencio la marca `ignorable` del evento de auditoría ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) y la discusión upstream del harness; la detección de capacidades del host en v0.4.1 y la corrección de la documentación se derivaron directamente de ese análisis.
- [@sjh9714](https://github.com/sjh9714) — propuso el corpus compartido de vectores de prueba de sintaxis de reglas ([#4](https://github.com/PerryLink/dsh-permission-rules/issues/4), [#5](https://github.com/PerryLink/dsh-permission-rules/issues/5)), publicado en v0.5.1 como `docs/rule-test-vectors/`, y aportó los casos límite de descomposición AST en la [discusión de diseño](https://github.com/PerryLink/dsh-permission-rules/discussions/10).
- [@weipeng1999](https://github.com/weipeng1999) — la propuesta de descomposición de comandos basada en AST ([#8](https://github.com/PerryLink/dsh-permission-rules/issues/8)) detrás de la discusión de diseño.
- [@alexchenzl](https://github.com/alexchenzl) — la solicitud de listado en el DSH Directory ([#7](https://github.com/PerryLink/dsh-permission-rules/issues/7)).
- [@zl190](https://github.com/zl190) — informó y verificó la brecha de compatibilidad con el harness `0.1.0-rc.7` ([PR #9](https://github.com/PerryLink/dsh-permission-rules/pulls/9)).
- [@cuohua](https://github.com/cuohua) — informó que la línea `0.1.1-rc` sigue descartando la marca `ignorable` aunque la puerta de versión solo cubría `0.1.0` ([#11](https://github.com/PerryLink/dsh-permission-rules/issues/11)); la puerta ampliada se derivó directamente de ese análisis.

<details>
<summary>Expandir todos los plugins</summary>

| Plugin | Estado |
|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | 🧊 CONGELADO — ver el README del repo |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** |  |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | 🧊 CONGELADO — ver el README del repo |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** |  |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | 🧊 CONGELADO — ver el README del repo |
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
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | 🧊 CONGELADO — ver el README del repo |
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
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | 🚫 RETIRADO (repo archivado) |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | 🚫 RETIRADO (repo archivado) |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | 🚫 RETIRADO (repo archivado) |
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
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | 🧊 CONGELADO — ver el README del repo |
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
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | 🚫 RETIRADO (repo archivado) |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 CONGELADO — ver el README del repo |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 CONGELADO — ver el README del repo |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 CONGELADO — ver el README del repo |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 CONGELADO — ver el README del repo |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 CONGELADO — ver el README del repo |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 RETIRADO (repo archivado) |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 RETIRADO (repo archivado) |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 RETIRADO (repo archivado) |

</details>

## Licencia

[LICENSE](LICENSE) (Apache License 2.0) © 2026 dsh-permission-rules contributors

<p align="center"><sub>Apache-2.0 · Plugin de la comunidad, no afiliado a DeepSeek.</sub></p>
