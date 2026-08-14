/**
 * UI-facing prose for the `/rules` session command, per language. Only the
 * command surface localizes: rule `reason`s are author-provided and are
 * never translated, and logger diagnostics stay English for greppability.
 * `en` and `zh` are the reference translations; `es`/`pt`/`hi` are
 * community-quality.
 * @module dsh-permission-rules/prose
 */

/** Supported command-output languages. */
export type UiLanguage = 'en' | 'zh' | 'es' | 'pt' | 'hi'

/** The localized strings one language provides for the command surface. */
export interface UiProse {
  /** Header line naming the active rules, their sources, and the workspace. */
  rulesHeader: (count: number, sources: readonly string[], cwd: string) => string
  /** Line shown when no rule file is in effect. */
  noRules: (cwd: string, fallbackNote: string) => string
  /** Note appended when a fallback path is configured but missing. */
  fallbackMissing: string
  /** Success line of `/rules reload`. */
  reloaded: (count: number, source: string) => string
  /** Error line of a failed reload. */
  reloadFailed: (error: string) => string
  /** Warning appended to a listing whose last reload failed. */
  lastReloadWarning: (error: string) => string
  /** Notice appended to a listing when dry-run mode (`enforce: false`) is active. */
  dryRunNotice: string
  /** Rejection of an unknown `/rules` argument. */
  unknownArg: (arg: string) => string
  /** Usage hint. */
  usage: string
  /** Header for `/rules decisions` when decisions exist. */
  decisionsHeader: (shown: number, total: number) => string
  /** Line shown when the session log holds no audit decisions. */
  noDecisions: string
  /** Rejection of a malformed decisions count. */
  invalidDecisionsCount: (arg: string) => string
  /** One audit-decision row (dry-run rows mark the actual outcome). */
  decisionLine: (seq: number, action: string, toolName: string, ruleIndex: number | undefined, reason: string | undefined, dryRun: boolean, outcome: string | undefined) => string
  /** Hit line of `/rules test`. */
  testHit: (tool: string, ruleIndex: number, action: string, reason: string) => string
  /** No-match line of `/rules test`. */
  testNoMatch: (tool: string) => string
  /** Rejection of unparseable `/rules test` JSON arguments. */
  testBadJson: (text: string) => string
  /** Rejection of an unknown `/rules test` flag. */
  testUnknownFlag: (flag: string) => string
  /** Rejection of a malformed `/rules test` flag (missing value, bad KEY=VALUE). */
  testBadFlag: (flag: string) => string
  /** Usage hint of `/rules test`. */
  testUsage: string
  /** Warning naming shadowed (unreachable) rules by 1-based number. */
  unreachableWarning: (numbers: readonly number[]) => string
  /** Empty-source placeholder in the rules header. */
  emptySource: string
}

/** Tokens `describeRule` uses for its match-dimension prefixes. */
export interface DescribeTokens {
  allTools: string
  tools: string
  agents: string
  params: string
  paths: string
  absent: string
  when: string
  platform: string
  disabled: string
  tags: string
}

/** Truncate long reasons/descriptions in one-line displays. */
function short(text: string, limit = 120): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

const EN: UiProse = {
  rulesHeader: (count, sources, cwd) => `Permission rules: ${count} rule(s) from ${sources.join(', ')} (workspace ${cwd}).`,
  noRules: (cwd, fallbackNote) => `No permission rules active: no rule file found for workspace ${cwd}${fallbackNote}; the empty rule set passes everything through.`,
  fallbackMissing: ' (and the configured fallback path is missing)',
  reloaded: (count, source) => `Reloaded ${count} rule(s) from ${source}.`,
  reloadFailed: error => `Reload failed: ${error}. The previous rules are still active.`,
  lastReloadWarning: error => `Warning: the last reload failed (${error}); the rules listed above are the previous ones.`,
  dryRunNotice: 'Dry-run mode (enforce: false): deny/ask hits are audit-logged only — every call is passed through.',
  unknownArg: arg => `Unknown /rules argument "${arg}". ${EN.usage}`,
  usage: 'Usage: /rules [reload | decisions [n] | test <tool> <json-args>]',
  decisionsHeader: (shown, total) => `Last ${shown} of ${total} permission decision(s) for this session:`,
  noDecisions: 'No permission decisions recorded in this session yet.',
  invalidDecisionsCount: arg => `Invalid decisions count "${arg}": give a positive integer (default 10).`,
  decisionLine: (seq, action, toolName, ruleIndex, reason, dryRun, outcome) => {
    const rule = ruleIndex === undefined ? '' : ` (rule ${ruleIndex + 1})`
    const dry = dryRun ? (outcome === undefined ? ' (dry-run)' : ` (dry-run → ${outcome})`) : ''
    const why = reason === undefined ? '' : `: ${short(reason)}`
    return `- #${seq} ${action} ${toolName}${rule}${dry}${why}`
  },
  testHit: (tool, ruleIndex, action, reason) => `"${tool}" matches rule ${ruleIndex + 1} (${action}): ${short(reason)}`,
  testNoMatch: tool => `"${tool}" matches no rule — the call passes through.`,
  testBadJson: text => `Invalid JSON arguments "${text}": the arguments must parse as JSON.`,
  testUnknownFlag: flag => `Unknown /rules test flag "${flag}". ${EN.testUsage}`,
  testBadFlag: flag => `Invalid /rules test flag "${flag}": expected a value. ${EN.testUsage}`,
  testUsage: 'Usage: /rules test [--cwd <dir>] [--env KEY=VALUE]... [--agent <selector>]... <tool> <json-args>, e.g. /rules test bash {"command":"git push origin main"}',
  unreachableWarning: numbers => `Warning: rule${numbers.length > 1 ? 's' : ''} ${numbers.join(', ')} ${numbers.length > 1 ? 'are' : 'is'} unreachable (shadowed by an earlier catch-all rule).`,
  emptySource: '(no rule file — empty rule set)',
}

const ZH: UiProse = {
  rulesHeader: (count, sources, cwd) => `权限规则：共 ${count} 条，来自 ${sources.join('、')}（工作区 ${cwd}）。`,
  noRules: (cwd, fallbackNote) => `当前没有生效的权限规则：工作区 ${cwd} 未找到规则文件${fallbackNote}；空规则集全部放行。`,
  fallbackMissing: '（且配置的回退路径不存在）',
  reloaded: (count, source) => `已重载 ${count} 条规则，来自 ${source}。`,
  reloadFailed: error => `重载失败：${error}。之前的规则仍然生效。`,
  lastReloadWarning: error => `警告：上次重载失败（${error}）；以上列出的是之前的规则。`,
  dryRunNotice: '干跑模式（enforce: false）：deny/ask 命中仅写入审计日志——所有调用照常透传。',
  unknownArg: arg => `未知的 /rules 参数 "${arg}"。${ZH.usage}`,
  usage: '用法：/rules [reload | decisions [n] | test <工具名> <json-参数>]',
  decisionsHeader: (shown, total) => `本会话最近 ${shown}/${total} 条权限裁决：`,
  noDecisions: '本会话还没有记录任何权限裁决。',
  invalidDecisionsCount: arg => `无效的裁决条数 "${arg}"：请给正整数（默认 10）。`,
  decisionLine: (seq, action, toolName, ruleIndex, reason, dryRun, outcome) => {
    const rule = ruleIndex === undefined ? '' : `（规则 ${ruleIndex + 1}）`
    const dry = dryRun ? (outcome === undefined ? '（干跑）' : `（干跑 → ${outcome}）`) : ''
    const why = reason === undefined ? '' : `：${short(reason)}`
    return `- #${seq} ${action} ${toolName}${rule}${dry}${why}`
  },
  testHit: (tool, ruleIndex, action, reason) => `"${tool}" 命中规则 ${ruleIndex + 1}（${action}）：${short(reason)}`,
  testNoMatch: tool => `"${tool}" 未命中任何规则——该调用将透传。`,
  testBadJson: text => `无效的 JSON 参数 "${text}"：参数必须能被解析为 JSON。`,
  testUnknownFlag: flag => `未知的 /rules test 标志 "${flag}"。${ZH.testUsage}`,
  testBadFlag: flag => `无效的 /rules test 标志 "${flag}"：缺少取值。${ZH.testUsage}`,
  testUsage: '用法：/rules test [--cwd <目录>] [--env 键=值]... [--agent <选择器>]... <工具名> <json-参数>，例如 /rules test bash {"command":"git push origin main"}',
  unreachableWarning: numbers => `警告：规则 ${numbers.join('、')} 不可达（被前面的通配规则遮蔽）。`,
  emptySource: '（无规则文件——空规则集）',
}

const ES: UiProse = {
  rulesHeader: (count, sources, cwd) => `Reglas de permiso: ${count} regla(s) desde ${sources.join(', ')} (espacio de trabajo ${cwd}).`,
  noRules: (cwd, fallbackNote) => `No hay reglas de permiso activas: no se encontró archivo de reglas para el espacio de trabajo ${cwd}${fallbackNote}; el conjunto vacío lo permite todo.`,
  fallbackMissing: ' (y la ruta de respaldo configurada no existe)',
  reloaded: (count, source) => `Recargadas ${count} regla(s) desde ${source}.`,
  reloadFailed: error => `Error de recarga: ${error}. Las reglas anteriores siguen activas.`,
  lastReloadWarning: error => `Aviso: la última recarga falló (${error}); las reglas mostradas son las anteriores.`,
  dryRunNotice: 'Modo simulación (enforce: false): los aciertos deny/ask solo se registran en auditoría — todas las llamadas pasan.',
  unknownArg: arg => `Argumento de /rules desconocido "${arg}". ${ES.usage}`,
  usage: 'Uso: /rules [reload | decisions [n] | test <herramienta> <json-args>]',
  decisionsHeader: (shown, total) => `Últimas ${shown} de ${total} decisión(es) de permiso de esta sesión:`,
  noDecisions: 'Esta sesión aún no registra decisiones de permiso.',
  invalidDecisionsCount: arg => `Cantidad de decisiones inválida "${arg}": indique un entero positivo (por defecto 10).`,
  decisionLine: (seq, action, toolName, ruleIndex, reason, dryRun, outcome) => {
    const rule = ruleIndex === undefined ? '' : ` (regla ${ruleIndex + 1})`
    const dry = dryRun ? (outcome === undefined ? ' (simulación)' : ` (simulación → ${outcome})`) : ''
    const why = reason === undefined ? '' : `: ${short(reason)}`
    return `- #${seq} ${action} ${toolName}${rule}${dry}${why}`
  },
  testHit: (tool, ruleIndex, action, reason) => `"${tool}" coincide con la regla ${ruleIndex + 1} (${action}): ${short(reason)}`,
  testNoMatch: tool => `"${tool}" no coincide con ninguna regla — la llamada pasa sin restricciones.`,
  testBadJson: text => `Argumentos JSON inválidos "${text}": los argumentos deben poderse analizar como JSON.`,
  testUnknownFlag: flag => `Bandera de /rules test desconocida "${flag}". ${ES.testUsage}`,
  testBadFlag: flag => `Bandera de /rules test inválida "${flag}": falta un valor. ${ES.testUsage}`,
  testUsage: 'Uso: /rules test [--cwd <dir>] [--env CLAVE=VALOR]... [--agent <selector>]... <herramienta> <json-args>, p. ej. /rules test bash {"command":"git push origin main"}',
  unreachableWarning: numbers => `Aviso: ${numbers.length > 1 ? 'las reglas' : 'la regla'} ${numbers.join(', ')} ${numbers.length > 1 ? 'son inalcanzables' : 'es inalcanzable'} (tapada por una regla general anterior).`,
  emptySource: '(sin archivo de reglas — conjunto vacío)',
}

const PT: UiProse = {
  rulesHeader: (count, sources, cwd) => `Regras de permissão: ${count} regra(s) de ${sources.join(', ')} (workspace ${cwd}).`,
  noRules: (cwd, fallbackNote) => `Nenhuma regra de permissão ativa: nenhum arquivo de regras encontrado para o workspace ${cwd}${fallbackNote}; o conjunto vazio permite tudo.`,
  fallbackMissing: ' (e o caminho de fallback configurado não existe)',
  reloaded: (count, source) => `Recarregadas ${count} regra(s) de ${source}.`,
  reloadFailed: error => `Falha ao recarregar: ${error}. As regras anteriores continuam ativas.`,
  lastReloadWarning: error => `Aviso: a última recarga falhou (${error}); as regras listadas são as anteriores.`,
  dryRunNotice: 'Modo simulação (enforce: false): acertos deny/ask são apenas registrados na auditoria — todas as chamadas passam.',
  unknownArg: arg => `Argumento de /rules desconhecido "${arg}". ${PT.usage}`,
  usage: 'Uso: /rules [reload | decisions [n] | test <ferramenta> <json-args>]',
  decisionsHeader: (shown, total) => `Últimas ${shown} de ${total} decisão(ões) de permissão desta sessão:`,
  noDecisions: 'Esta sessão ainda não registrou decisões de permissão.',
  invalidDecisionsCount: arg => `Quantidade de decisões inválida "${arg}": informe um inteiro positivo (padrão 10).`,
  decisionLine: (seq, action, toolName, ruleIndex, reason, dryRun, outcome) => {
    const rule = ruleIndex === undefined ? '' : ` (regra ${ruleIndex + 1})`
    const dry = dryRun ? (outcome === undefined ? ' (simulação)' : ` (simulação → ${outcome})`) : ''
    const why = reason === undefined ? '' : `: ${short(reason)}`
    return `- #${seq} ${action} ${toolName}${rule}${dry}${why}`
  },
  testHit: (tool, ruleIndex, action, reason) => `"${tool}" corresponde à regra ${ruleIndex + 1} (${action}): ${short(reason)}`,
  testNoMatch: tool => `"${tool}" não corresponde a nenhuma regra — a chamada passa livremente.`,
  testBadJson: text => `Argumentos JSON inválidos "${text}": os argumentos precisam ser JSON analisável.`,
  testUnknownFlag: flag => `Sinalizador de /rules test desconhecido "${flag}". ${PT.testUsage}`,
  testBadFlag: flag => `Sinalizador de /rules test inválido "${flag}": falta um valor. ${PT.testUsage}`,
  testUsage: 'Uso: /rules test [--cwd <dir>] [--env CHAVE=VALOR]... [--agent <seletor>]... <ferramenta> <json-args>, ex.: /rules test bash {"command":"git push origin main"}',
  unreachableWarning: numbers => `Aviso: ${numbers.length > 1 ? 'as regras' : 'a regra'} ${numbers.join(', ')} ${numbers.length > 1 ? 'são inalcançáveis' : 'é inalcançável'} (encoberta por uma regra geral anterior).`,
  emptySource: '(sem arquivo de regras — conjunto vazio)',
}

const HI: UiProse = {
  rulesHeader: (count, sources, cwd) => `अनुमति नियम: ${count} नियम, स्रोत ${sources.join(', ')} (कार्यक्षेत्र ${cwd})।`,
  noRules: (cwd, fallbackNote) => `कोई अनुमति नियम सक्रिय नहीं: कार्यक्षेत्र ${cwd} के लिए नियम फ़ाइल नहीं मिली${fallbackNote}; खाली नियम-समूह सब कुछ पास कर देता है।`,
  fallbackMissing: ' (और कॉन्फ़िगर किया गया फ़ॉलबैक पथ मौजूद नहीं है)',
  reloaded: (count, source) => `${count} नियम पुनः लोड किए गए, स्रोत ${source}।`,
  reloadFailed: error => `पुनः लोड विफल: ${error}। पिछले नियम अब भी सक्रिय हैं।`,
  lastReloadWarning: error => `चेतावनी: अंतिम पुनः लोड विफल रहा (${error}); ऊपर सूचीबद्ध नियम पिछले वाले हैं।`,
  dryRunNotice: 'ड्राई-रन मोड (enforce: false): deny/ask हिट केवल ऑडिट में दर्ज होते हैं — हर कॉल पास हो जाती है।',
  unknownArg: arg => `अज्ञात /rules तर्क "${arg}"। ${HI.usage}`,
  usage: 'उपयोग: /rules [reload | decisions [n] | test <टूल> <json-args>]',
  decisionsHeader: (shown, total) => `इस सत्र के अंतिम ${shown}/${total} अनुमति निर्णय:`,
  noDecisions: 'इस सत्र में अभी कोई अनुमति निर्णय दर्ज नहीं है।',
  invalidDecisionsCount: arg => `अमान्य निर्णय-संख्या "${arg}": एक धनात्मक पूर्णांक दें (डिफ़ॉल्ट 10)।`,
  decisionLine: (seq, action, toolName, ruleIndex, reason, dryRun, outcome) => {
    const rule = ruleIndex === undefined ? '' : ` (नियम ${ruleIndex + 1})`
    const dry = dryRun ? (outcome === undefined ? ' (ड्राई-रन)' : ` (ड्राई-रन → ${outcome})`) : ''
    const why = reason === undefined ? '' : `: ${short(reason)}`
    return `- #${seq} ${action} ${toolName}${rule}${dry}${why}`
  },
  testHit: (tool, ruleIndex, action, reason) => `"${tool}" नियम ${ruleIndex + 1} से मेल खाता है (${action}): ${short(reason)}`,
  testNoMatch: tool => `"${tool}" किसी नियम से मेल नहीं खाता — कॉल बिना रोक पास होगी।`,
  testBadJson: text => `अमान्य JSON तर्क "${text}": तर्क JSON के रूप में पार्स होने चाहिए।`,
  testUnknownFlag: flag => `अज्ञात /rules test फ़्लैग "${flag}"। ${HI.testUsage}`,
  testBadFlag: flag => `अमान्य /rules test फ़्लैग "${flag}": मान गायब है। ${HI.testUsage}`,
  testUsage: 'उपयोग: /rules test [--cwd <dir>] [--env KEY=मान]... [--agent <चयनकर्ता>]... <टूल> <json-args>, जैसे /rules test bash {"command":"git push origin main"}',
  unreachableWarning: numbers => `चेतावनी: नियम ${numbers.join(', ')} अप्राप्य हैं (पहले वाले सर्व-मिलान नियम से ढके हुए)।`,
  emptySource: '(कोई नियम फ़ाइल नहीं — खाली नियम-समूह)',
}

/** The localized prose tables by language. */
export const UI_PROSE: Readonly<Record<UiLanguage, UiProse>> = { en: EN, zh: ZH, es: ES, pt: PT, hi: HI }

/** `describeRule` match-dimension tokens by language. */
export const DESCRIBE_TOKENS: Readonly<Record<UiLanguage, DescribeTokens>> = {
  en: { allTools: 'all tools', tools: 'tools', agents: 'agents', params: 'params', paths: 'paths', absent: 'absent', when: 'when', platform: 'platform', disabled: 'disabled', tags: 'tags' },
  zh: { allTools: '全部工具', tools: '工具', agents: '代理', params: '参数', paths: '路径', absent: '缺省键', when: '条件', platform: '平台', disabled: '已禁用', tags: '标签' },
  es: { allTools: 'todas las herramientas', tools: 'herramientas', agents: 'agentes', params: 'parámetros', paths: 'rutas', absent: 'ausentes', when: 'cuándo', platform: 'plataforma', disabled: 'deshabilitada', tags: 'etiquetas' },
  pt: { allTools: 'todas as ferramentas', tools: 'ferramentas', agents: 'agentes', params: 'parâmetros', paths: 'caminhos', absent: 'ausentes', when: 'quando', platform: 'plataforma', disabled: 'desativada', tags: 'etiquetas' },
  hi: { allTools: 'सभी टूल', tools: 'टूल', agents: 'एजेंट', params: 'पैरामीटर', paths: 'पथ', absent: 'अनुपस्थित', when: 'शर्त', platform: 'प्लेटफ़ॉर्म', disabled: 'अक्षम', tags: 'टैग' },
}
