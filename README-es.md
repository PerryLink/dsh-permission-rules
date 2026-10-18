<div align="center">

# 🛡️ dsh-permission-rules
- **Canal 1024 store**: `npm i -g dsh1024` una vez, luego `dsh1024 plugin --profile web add dsh-permission-rules` (cuenta para el ranking de instalaciones de [deepseek1024.com](https://deepseek1024.com)).

**Reglas de permisos declarativas estilo Claude Code para DeepSeek Harness.**

*Las reglas deciden lo conocido. Un modelo revisor decide lo que no lo es.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-permission-rules)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-permission-rules.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-top-rated.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-permission-rules/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-permission-rules?label=version)](https://github.com/PerryLink/dsh-permission-rules/releases)
[![npm version](https://img.shields.io/npm/v/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)
[![npm downloads](https://img.shields.io/npm/dm/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-permission-rules?metric=downloads&lang=es)](https://dshfind.com/es/plugins/PerryLink/dsh-permission-rules?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-permission-rules
```


</div>

---

**📖 Base de conocimiento del ecosistema** — datos medidos, no marketing: [guía de desarrollo · datos de selección · criterios de mantenimiento](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## Install & uninstall

- **canal git** (último `main`): `dsh plugin --profile web add github:PerryLink/dsh-permission-rules` — el script `prepare` compila solo con dependencias de producción.
- **canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-permission-rules`.
- **canal tarball**: `pnpm pack` en este repo, luego `dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz`.
- **desinstalar**: `dsh plugin --profile web remove dsh-permission-rules`.

## ⭐ 如果它帮到了你

Este plugin forma parte de la [familia de plugins DSH](https://github.com/PerryLink) (más de 40, todos Apache-2.0). Si te resulta útil, **dale una estrella**: no desbloquea nada, pero ayuda a que la siguiente persona lo encuentre antes.

*English:* part of a 95 plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-permission-rules?

Reglas de permisos declarativas estilo Claude Code para DeepSeek Harness.

Las reglas deciden lo conocido. Un modelo revisor decide lo que no lo es.

![Demostración de terminal de dsh-permission-rules: dsh-permission-rules — deny/ask rules in one YAML file](https://raw.githubusercontent.com/PerryLink/dsh-permission-rules/main/docs/assets/dsh-permission-rules-hero.png)

![Animated terminal demo of dsh-permission-rules](https://raw.githubusercontent.com/PerryLink/dsh-permission-rules/main/docs/assets/dsh-permission-rules-demo.gif)

*La misma ejecución, animada.*

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (adaptado el 2026-09-22, cadena completa de gates): la configuración del plugin es el contrato de settings en vivo — cada campo se declara `.volatile()`, el Loader entrega a `apply` una referencia viva por campo, y una edición guardada se confirma en las referencias en ejecución SIN remontar el plugin, con los valores fuera de rango rechazados por el esquema antes de escribir nada. Un host cuyo Schemastery sea anterior a `volatile()` (antes de 3.18.3) sigue montando y ejecutando este plugin — los campos simplemente quedan como valores ordinarios y el formulario de configuración en vivo no está disponible — porque el marcador se aplica mediante una sonda de capacidad, no se da por supuesto. `Session.append` en esta línea todavía no puede estampar el marcador `ignorable` (su tercer argumento es el paquete surface-intent, y el campo del sobre solo sobrevive para la lectura de logs almacenados), así que toda la línea `0.2-alpha` se preverifica como no marcada y la auditoría del registro de sesión queda desactivada por defecto — `append` solo lee `sourceEventSeqs`/`surfaceOp` y congela el sobre, de modo que no tiene ninguna ruta de código capaz de estampar el marcador; las líneas anteriores `0.1.7-alpha` (adaptada el 2026-09-22), `0.1.5-rc.2` (adaptada el 2026-09-09) y `0.1.3-alpha` mantienen la misma firma de append surface-only, y cada versión preliminar `0.2` se clasifica con ellas (una versión ESTABLE `0.2.x` queda a cargo de la sonda de append, así que una superficie de marcado restaurada se adopta sin una nueva publicación de este plugin). Las migraciones de log de esas líneas rechazan eventos de plugin sin clasificar incluso marcados: aplica `strip` a las filas de auditoría v1 antes de que un host `0.1.3-alpha` abra el log y a las v2 antes de que un host `0.1.5-alpha` lo migre (los logs v3 nativos solo necesitan `repair`). |
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
- **Recarga en caliente** — vigilancia Chokidar con debounce; una edición rota conserva las reglas anteriores, nunca falla. En un host WSL, o para un archivo de reglas bajo `/mnt/<unidad>`, la vigilancia pasa a sondeo (polling) porque allí los eventos nativos de cambio no son fiables.
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

- **Emparejamiento** — `match.network` con `domains` / `ips` / `ports` / `schemes` (globs, comodines, CIDR, rangos de puertos; se aceptan puertos YAML numéricos). La extracción de candidatos URL en la ruta caliente `tools/pre-execute` se dispara sobre argumentos de herramientas web y URLs embebidas en texto de comandos bash/pwsh; los destinos de loopback pueden cortocircuitar reglas según la política `loopback`. Los literales IPv6 mapeados a IPv4 se normalizan a su forma IPv4 antes de comparar, y el proxy se conecta a las direcciones con las que se tomó la decisión, sin una segunda resolución DNS; una conexión cuya adjudicación no resolvió ninguna dirección falla cerrada (502) en lugar de marcar el nombre.
- **Encadenado a un proxy ascendente** — `network.upstreamProxy` (por defecto `off`) envía las conexiones que este proxy **permite** a través de un proxy ascendente: CONNECT le pide un túnel (`CONNECT host:port`) y las peticiones HTTP simples se le reenvían en forma absoluta. Un destino bloqueado nunca llega al proxy ascendente: sigue recibiendo el 403 estructurado de este plugin. Dos casos no se encadenan nunca aunque haya un proxy ascendente configurado: un destino de **loopback** (un proxy fuera de este host no puede enrutar su loopback) y cualquier decisión producida por una **regla con ámbito `ips`** (encadenar entrega el nombre de host al proxy ascendente, así que «la conexión aterriza en una dirección que las reglas vieron» — issue #21 — dejaría de cumplirse justo donde a las reglas les importaba la dirección; esas decisiones siguen conectando directamente a la dirección adjudicada), más un destino cuyo esquema no tenga un proxy ascendente utilizable. El nombre de host del propio proxy ascendente es configuración del operador, no entrada del agente, y no lo adjudican estas reglas. Una URL con credenciales nunca se emite en claro: los avisos, `/rules network` y la instantánea de settings enmascaran la contraseña (`http://user:***@host:port`). Un proxy ascendente inalcanzable, un timeout (10 s) o una respuesta no 2xx producen **502**; no hay a propósito una caída silenciosa a conexión directa, para que una mala configuración siga siendo visible.
- **Auditoría** — las conexiones denegadas anexan `permissionRules/network` a la sesión propietaria (la misma puerta adaptativa `ignorable`), con contadores de bloqueo e intercepciones recientes en `/rules network` y la página de settings.
- **Diagnóstico** — las conexiones bloqueadas llevan un mensaje `[network: …]` que nombra el destino bloqueado, el modo o la regla que decidió y la solución.
- **Permitir desde la página de settings** — cada intercepción reciente ofrece una acción **Permitir**. Escribe UNA regla mínima `match: { network: { domains: [<host>] } }` / `action: allow` en la **parte superior** (índice 0) del archivo de reglas más cercano que realmente adjudica esa conexión: el archivo de proyecto del workspace al que se atribuyó el bloqueo (el `rulesFile` absoluto cuando hay uno configurado) o, para un bloqueo a nivel de host sin sesión, el archivo que resuelve la cadena del host (`rulesFile` absoluto → `<processCwd>/<rulesFile>` existente → `fallbackPath` configurado → `<processCwd>/<rulesFile>`, creado). Con varios workspaces cargados, la página ofrece primero un selector, porque cualquier cadena de workspace cargada tiene prioridad sobre la cadena del host. En el índice 0 porque las reglas son de primera coincidencia: añadida después de un `deny` existente, la regla sería texto muerto. Solo `domains`, porque esa dimensión incluye subdominios y es independiente de puerto/esquema, así que el host no vuelve a bloquearse en su siguiente puerto; los comentarios y las reglas no tocadas se conservan, y el texto pasa por la misma puerta de validación que una edición manual. El cambio surte efecto de inmediato —se releen las cadenas de workspace en caché Y la cadena de host sin sesión, sin reinicio y sin `/rules reload`— y la decisión se recalcula, así que el aviso informa del resultado REAL y nunca afirma éxito mientras la conexión sigue bloqueada. Rechaza, sin tocar el archivo, un workspace desconocido, un destino fuera de las fuentes de reglas conocidas, la línea base integrada de solo lectura y un archivo que no puede leer o analizar; una conexión ya permitida no escribe nada. `network.allowHostAction: false` oculta el botón y hace que el RPC rechace.

## Quick start

```sh
dsh plugin --profile web add github:PerryLink/dsh-permission-rules
```

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add github:PerryLink/dsh-permission-rules

# or from npm (published releases)
dsh plugin --profile web add dsh-permission-rules

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: permission-rules'
```

## Configuration

Todos los parámetros son campos Schemastery `Config` (modificables desde cordis.yml). Una sobrescritura dirigida por id reemplaza toda la fila — reafirma cada clave que necesites. En un host `0.1.7-alpha` cada campo se declara `.volatile()`, así que TAMBIÉN se edita in situ desde la página de Plugins: la edición se confirma en las referencias en ejecución sin remontar el plugin, el runtime lee el valor nuevo en su siguiente uso, y un cambio en `network.proxyPort`, `proxyBind`, `injectEnv` o `noProxy` revincula el proxy local de inmediato. Los límites numéricos viven en el esquema, y el editor de configuración resuelve la configuración fusionada contra ese esquema antes de persistir, así que un valor fuera de rango se rechaza en el momento de escribir. En un host cuyo Schemastery sea anterior a `volatile()` estos campos solo se cambian por cordis.yml.

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
| `network.upstreamProxy` | `off` | Proxy ascendente para las conexiones que este plugin PERMITE: `off` conecta directamente, `inherit` reutiliza los nombres de proxy del entorno de lanzamiento, o una URL de proxy `http(s)://` explícita |
| `network.allowHostAction` | `true` | Acción «permitir este host» por bloque de la página de settings: `false` oculta el botón Permitir y hace que el RPC `permissionRules/allowHost` rechace (el editor de reglas no se ve afectado) |
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
| settings page | client | Editor de modo de red, editor de reglas, contadores de bloqueo, intercepciones recientes con una acción de permiso por bloque |

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
- **Marcado a prueba de fallos.** Los reenvíos HTTP simples y los túneles CONNECT conectan solo a direcciones adjudicadas; un allow cuya adjudicación no resolvió ninguna dirección falla cerrado con 502 en lugar de marcar el nombre (issue #23).

## Known limitations

- **Marcador de auditoría en hosts previos al marcador o que rechazan eventos.** `permissionRules/decision` se anexa con `ignorable: true`; los hosts cuyo `Session.append` es anterior al marcador (las líneas `0.1.0-rc.1`–`rc.7` y `0.1.1-rc.1`–`rc.7`) lo descartan silenciosamente, la línea `0.1.2-rc` trae la superficie alpha.5 (ninguna opción de append escribe el marcador), la línea `0.1.2-alpha` rechaza eventos de plugin al leerlos incluso marcados, y las líneas `0.1.3-alpha` y `0.1.5-alpha` mantienen la misma firma de append surface-only (verificado en los paquetes publicados `0.1.3-alpha.1`/`0.1.5-alpha.1`) — el runtime preverifica todas ellas antes del primer append y desactiva la auditoría de registro con una advertencia única. La migración entre generaciones también rechaza filas de auditoría marcadas: la puerta v1→v2 de `0.1.3-alpha` rechaza eventos v1 desconocidos, y la puerta v2→v3 de `0.1.5-alpha` rechaza todo evento sin clasificar (su inventario está congelado al vocabulario v2 publicado), así que aplica `strip` a las filas v1 antes de que un host 0.1.3 abra el log y a las v2 antes de actualizar a un host 0.1.5. Los logs v3 nativos aceptan filas de plugin marcadas, así que solo necesitan `repair`. Pon `allowUnmarkedAudit: true` para reactivar; repara registros ya escritos con `scripts/repair-session-logs.mjs` (su modo `strip` elimina filas de auditoría donde el marcador no ayuda).
- **Los candidatos de ruta son heurísticos.** Solo las claves de argumento documentadas alimentan el emparejamiento de rutas, y el emparejamiento relativo al workspace es insensible a mayúsculas ASCII solo con `caseInsensitivePaths` activado.
- **Los globs son un subconjunto conservador.** Sin expansión de llaves — escribe dos patrones, o usa modo regex.
- **La guardia de backtracking de regex es estructural, no exhaustiva.** Prefiere el modo glob para archivos no confiables.
- **Las peticiones salientes del propio host no pasan por este proxy.** El entorno de proxy inyectado cubre los **subprocesos de shell derivados** —que es para lo que sirve la inyección— y cualquier consumidor que lea los nombres de proxy en el momento de la petición. **No** cubre el tráfico basado en `fetch` del propio proceso del host: el launcher instala el dispatcher global de undici desde el **entorno de lanzamiento** antes de que se monte el primer plugin, ese dispatcher enruta por su política y no por el entorno, y Node muestrea el entorno de proxy al arrancar, así que un plugin que se monte después no puede redirigirlo. Consecuencias: los endpoints del proveedor **no** necesitan una regla allow, y `network.injectEnv: false` no saca al proceso del host de nada. Medido el 2026-09-10 en Node 22; reproducible con `scripts/host-egress-probe.mjs`.
- **El encadenado solo cubre lo que llega a este proxy.** En `dsh-v0.1.7-alpha.1` y posteriores, la propia política de proxy de lanzamiento del harness y su capa de entorno para subprocesos pueden tener precedencia sobre los nombres de proxy que inyecta este plugin, así que `network.upstreamProxy` describe qué ocurre con las conexiones que este proxy maneja — no es una afirmación sobre todas las rutas salientes del proceso del host.

## Collaborating with dsh-auto-review

- `dsh-permission-rules` produce `ask`; `dsh-auto-review` responde en la cascada `approval/request` con un veredicto de segundo modelo de solo lectura (o delega en humanos). Monta ambos para el bucle completo cerrado.
- Probado en integración: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, con el revisor reemplazado por un mock guionado.
- La política de aprobación `never` y toda garantía de fallo cerrado del harness oficial permanecen intactas.

## Session log repair

Los registros de sesión escritos antes de que existiera el marcador `ignorable` pueden ser rechazados por builds más nuevas del harness (`SessionFormatUnsupportedError`). El `scripts/repair-session-logs.mjs` distribuido reescribe solo las filas de auditoría objetivo para llevar `ignorable: true`, preservando marcos, con copias de seguridad:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # reporta filas ajenas, no cambia nada
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
node scripts/repair-session-logs.mjs strip [--home DIR] [--dry-run]
```

`--home` por defecto es `$DSH_HOME/sessions` (o `~/.dsh/sessions`). Descubre cada log por su nombre canónico de generación —`session.jsonl`, `session.v2.jsonl`, `session.v3.jsonl`, cada uno opcionalmente comprimido en `.zstd`—, así que elige el modo según la generación:

- **v3 (`session.v3.jsonl`, escrito nativamente por la línea `0.1.5-alpha`)** — la ruta de lectura acepta filas de plugin marcadas, así que basta `repair`.
- **v2 (`session.v2.jsonl`, escrito por la línea `0.1.3-alpha`)** — `repair` lo abre en el host que lo escribió, pero la migración v2→v3 de `0.1.5-alpha` rechaza todo evento sin clasificar incluso marcado: ejecuta `strip` sobre los logs v2 **antes** de actualizar a un host `0.1.5-alpha`.
- **v1 (`session.jsonl`)** — la migración v1→v2 de `0.1.3-alpha` rechaza eventos v1 desconocidos incluso marcados: ejecuta `strip` antes de que un host 0.1.3 o posterior abra el log por primera vez.

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 24 spec files
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # five-language README sync gate (also in CI)
```

Consulta [VERIFICATION.md](VERIFICATION.md) para el registro de verificación end-to-end sin cabeza.

## Interoperability with other DSH plugins

Verificado contra **DSH `0.2.0-rc.2`** (el runtime para el que se publica este README) y el conjunto de plugins con más estrellas sondeado el 2026-10-05.

Este plugin **no interfiere** con otros plugins, incluidos los de más estrellas:

- **Sin colisión de nombres de herramienta.** Todas las herramientas llevan espacio de nombres; ninguna ocupa un nombre desnudo ya perteneciente a una herramienta incluida u otro plugin.
- **Sin colisión de clave de servicio.** Solo provee `permissionRules`, `permissionRulesRuntime`; esa clave no es una costura incluida ni la provee ningún plugin de más estrellas.
- **Sin colisión de slot.** No registra ninguna clave de slot de cliente, así que no disputa un asiento `shadows-shipped-ui`.
- **Sin colisión de ruta HTTP.** No registra ningún prefijo `webServer`.
- **Sin colisión en la capa de patch.** El patch del bundle solo hace `insert` de su propia fila; nunca sobrescribe el `config` de una fila incluida.
- **Sin mutación global.** No parchea prototipos, ni reescribe `process.env`, ni reemplaza el dispatcher global de fetch.

**Los listeners de eventos compartidos no interfieren por construcción.** Observa los eventos sensibles al orden `tools/post-execute`, `tools/pre-execute` con `ctx.on()` — el registro de difusión de Cordis, donde cada listener se ejecuta y ninguno puede dejar sin turno a otro. **Todos los listeners aquí delegan por `next()`**, así que la cadena nunca se cortocircuita:
  - `tools/post-execute` — also used by `cc-safety-net` (1576★).
  - `tools/pre-execute` — also used by `cc-safety-net` (1576★).

Evidencia estática: `dsh-plugin-doctor` K10–K13 dan `pass` en todas las comprobaciones de este repositorio.

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

Este proyecto es uno de los **87 plugins activamente mantenidos** de DeepSeek Harness de [PerryLink](https://github.com/PerryLink). El registro familiar tiene **95** plugins — **5 congelados**, **3 retirados** — y permanece plegado abajo para que cada README conserve una primera pantalla corta. Expándelo para ver cada fila, con el motivo en la columna Estado.

<details>
<summary>Expandir los 95 plugins</summary>

| Plugin | Una línea | Estado |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** | 应急演练脚本核对（按阶段、响应分级、指挥与资源要素核对脚本齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** | 环评导则适用性核对（按要素、导则名称与执行标准核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** | 应急预案要素齐备性与条款级页码定位（依据 GB/T 29639-2020 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** | 作文量表评分核对（按评分项、原文定位与分值算术核对评分自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** | 证据清单齐备性核对（按待证事实与证据要素核对清单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** | 出口管制物项核对（按管制清单、最终用途与许可证核对台账齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** | FMEA 分析表要素齐备性与风险顺序数一致性核对（按公开的 FMEA 方法标准核对表内自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** | 预测准确率考核核对（按准确率、门槛与考核单价核对考核费用的算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** | 公文流转与办理时限核对（按公开的公文处理规范核对环节完整性与时限，仅提示差异，不作出定性结论） |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** | 公文格式要素核对（按公开的党政机关公文格式标准核对版头与主体要素，仅提示差异，不作出定性结论） |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** | 劳动保护与安全防护用品配置表核对（按公开的配备标准核对品名规格与配置数量，仅提示差异，不作出定性结论） |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** | 危险化学品临界量与重大危险源辨识核对（按储存量与临界量核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** | HAZOP 分析表要素齐备性与偏差推导一致性核对（依据公开的危险与可操作性分析标准，仅提示差异，不作出定性结论） |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** | 安全隐患台账→《工贸企业重大事故隐患判定标准》（应急管理部令第10号）条款映射提示（仅提示差异，不作出定性结论） |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** | 商品归类层级一致性核对（按章、品目、子目与商品编号的层级关系核对自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** | ICD 合并编码与星剑号配对提示（依据 GB/T 14396-2016 与公开的 ICD 使用说明，仅提示差异，不作出定性结论） |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** | 法条引用与文书要素核对（按名称、条号、原文与效力状态核对引用可核验性，仅提示差异，不作出定性结论） |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** | 信用证单据条款核对（按单据种类、份数、期限与不符点核对交单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** | 能力差距与培养计划核对（按能力等级差、培养措施与完成期限核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** | 病案首页形式质控与逻辑矛盾提示（依据国卫办医发〔2016〕24号等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** | 国家自然科学基金申请书形式审查与匿名化提示（依据《国家自然科学基金条例》与申请人导入的当年指南，仅提示差异，不作出定性结论） |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** | 护理记录时限、签名与评估表完整性校验（依据《病历书写基本规范》等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** | 原产地区域价值成分核对（按 RVC 定义式与门槛核对原产地判定自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** | 在线点评回复台账核对（按回复时限、问题分类与整改状态核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** | 试卷解析结构核对（按题型、答案、分值与 yotta 标识核对试卷结构自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** | 行政许可办理核对（按申请材料、法定时限与决定记录核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** | 项目全流程文件链条核对（按环节先后与金额口径核对链条自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** | 起诉状要素齐备性核对（按诉请、事实、证据、法条四要素核对文书齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** | 政策专报要素核对（按观点、依据、出处与建议核对专报齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** | 线损电量拆分与考核表核对（依据公开的线损计算口径，仅提示差异，不作出定性结论） |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** | 电力工作票要素齐备性与签发许可顺序核对（依据现行电力安全工作规程，仅提示差异，不作出定性结论） |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** | PPAP 提交要素齐备性核对（按公开的 PPAP 手册与提交等级核对要素齐备与版本填写，仅提示差异，不作出定性结论） |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** | 质疑与投诉期限核对（按公开的政府采购质疑投诉规定核对期限与台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** | 铁路施工天窗台账核对（按时间窗、时长算术与命令号核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

</details>

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors

### Instalar desde el mercado de DSH Desktop

Todos los plugins de PerryLink pueden explorarse en el mercado integrado de DSH Desktop: **Market → Sources → add source → pegar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ seleccionarlo**. La instalación sigue pasando por la verificación de identidad npm del mercado y tu confirmación.
