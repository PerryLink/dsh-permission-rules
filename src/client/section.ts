/**
 * The "Permission Rules" settings page: network-policy summary (mode
 * mapping, proxy liveness), block counters, the recent interception list
 * (source tool + target domain), and the rule editor over known rule
 * sources. All data arrives through the `permissionRules` Remote
 * namespace; the page holds no state beyond the selected file and the
 * draft text. Written with `React.createElement` only — the client
 * bundle is plain JavaScript.
 * @module dsh-permission-rules/client/section
 */

import * as React from 'react'
import type { ReactElement } from 'react'
import type { PermissionRulesLocaleKey } from './locales.ts'
import type { PermissionRulesSnapshot, RulesReadResult, RulesReloadResult, RulesSaveResult } from '../wire.ts'

/** Functions the registration injects (wired to the Remote namespace in `./index.ts`). */
export interface PermissionRulesSectionInjected {
  /** Read the network-policy snapshot. */
  status: () => Promise<PermissionRulesSnapshot>
  /** Read one known rule file. */
  rulesRead: (path: string) => Promise<RulesReadResult>
  /** Validate and write one known rule file. */
  rulesSave: (path: string, text: string) => Promise<RulesSaveResult>
  /** Re-read every cached workspace chain. */
  reload: () => Promise<RulesReloadResult>
  /** The locale-bound translator. */
  t: T
}

/** One bound dictionary. */
export type T = (key: PermissionRulesLocaleKey, vars?: Record<string, string | number>) => string

/** The shell supplies `close`; everything else arrives through the slot injection. */
export type PermissionRulesSectionProps = PermissionRulesSectionInjected & {
  close: () => void
}

/** One select option for the rule-file picker. */
interface SourceOption {
  path: string
  label: string
}

const HEADER: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: '16px 0 8px' }
const ROW: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const LABEL: React.CSSProperties = { fontSize: 13, color: 'var(--dsh-color-text-secondary, #666)', minWidth: 110 }
const VALUE: React.CSSProperties = { fontSize: 13 }
const MONO: React.CSSProperties = { fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 12 }
const TEXTAREA: React.CSSProperties = { width: '100%', minHeight: 260, fontFamily: 'var(--dsh-font-mono, monospace)', fontSize: 12, whiteSpace: 'pre', overflow: 'auto' }
const NOTICE_OK: React.CSSProperties = { fontSize: 13, color: 'var(--dsh-color-success, #1a7f37)' }
const NOTICE_ERR: React.CSSProperties = { fontSize: 13, color: 'var(--dsh-color-error, #c62828)' }
const TABLE: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
const CELL: React.CSSProperties = { borderBottom: '1px solid var(--dsh-color-border, #ddd)', padding: '4px 6px', textAlign: 'left', verticalAlign: 'top' }

/** The settings section component. */
export function PermissionRulesSection({ close, t, ...injected }: PermissionRulesSectionProps): ReactElement {
  void close
  const [snapshot, setSnapshot] = React.useState<PermissionRulesSnapshot | undefined>(undefined)
  const [loadError, setLoadError] = React.useState<string | undefined>(undefined)
  const [sources, setSources] = React.useState<SourceOption[]>([])
  const [selected, setSelected] = React.useState<string | undefined>(undefined)
  const [text, setText] = React.useState('')
  const [dirty, setDirty] = React.useState(false)
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | undefined>(undefined)

  const refresh = React.useCallback(() => {
    void injected.status().then(next => {
      setSnapshot(next)
      setLoadError(undefined)
      setSources(next.sources.map(source => ({
        path: source.path,
        label: source.cwd === null ? source.path : source.path.replace(source.cwd, '.'),
      })))
      setSelected(current => current === undefined && next.sources.length > 0 ? next.sources[0]?.path : current)
    }).catch(error => {
      setLoadError(error instanceof Error ? error.message : String(error))
    })
  }, [injected.status])

  React.useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const loadFile = React.useCallback((path: string) => {
    setSelected(path)
    setDirty(false)
    setNotice(undefined)
    void injected.rulesRead(path).then(result => {
      setText(result.error ?? result.text)
      if (result.error !== null && result.error !== undefined) setNotice({ ok: false, text: result.error })
    })
  }, [injected])

  const saveFile = React.useCallback(() => {
    if (selected === undefined || !dirty) return
    setNotice(undefined)
    void injected.rulesSave(selected, text).then(result => {
      setNotice(result.ok
        ? { ok: true, text: t('editorSaved', { reloaded: result.reloaded ?? 0 }) }
        : { ok: false, text: t('editorFailed', { error: result.error ?? t('unknown') }) })
      if (result.ok) {
        setDirty(false)
        refresh()
      }
    })
  }, [injected, selected, text, dirty, t, refresh])

  const reloadAll = React.useCallback(() => {
    setNotice(undefined)
    void injected.reload().then(result => {
      setNotice(result.ok
        ? { ok: true, text: t('editorSaved', { reloaded: 0 }) }
        : { ok: false, text: t('editorFailed', { error: result.error ?? t('unknown') }) })
      refresh()
    })
  }, [injected, t, refresh])

  const picker = React.createElement('select', {
    style: { ...MONO, maxWidth: 420 },
    value: selected ?? '',
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
      const path = event.target.value
      if (path !== '') loadFile(path)
    },
  }, sources.map(source => React.createElement('option', { key: source.path, value: source.path }, source.label)))

  const children: React.ReactNode[] = []

  // Policy summary.
  children.push(React.createElement('div', { key: 'policy-title', style: HEADER }, t('policyTitle')))
  if (snapshot === undefined) {
    children.push(React.createElement('div', { key: 'loading', style: VALUE }, loadError === undefined ? '…' : loadError))
  } else {
    const modeText = `${snapshot.mode}${snapshot.sandboxMode === null ? '' : ` (${t('preset')}: ${snapshot.sandboxMode})`}${snapshot.configuredMode === 'auto' ? '' : ` — ${t('configured')}: ${snapshot.configuredMode}`}`
    children.push(React.createElement('div', { key: 'mode', style: ROW },
      React.createElement('span', { style: LABEL }, t('mode')),
      React.createElement('span', { style: VALUE }, modeText)))
    const proxyText = snapshot.enabled
      ? snapshot.proxyActive ? t('proxyActive', { port: snapshot.proxyPort }) : t('proxyInactive')
      : t('proxyDisabled')
    children.push(React.createElement('div', { key: 'proxy', style: ROW },
      React.createElement('span', { style: LABEL }, t('proxy')),
      React.createElement('span', { style: VALUE }, proxyText)))
    children.push(React.createElement('div', { key: 'counters', style: ROW },
      React.createElement('span', { style: LABEL }, t('counters')),
      React.createElement('span', { style: VALUE }, `${snapshot.denied} ${t('denied')} · ${snapshot.askBlocked} ${t('askBlocked')}`)))
  }

  // Recent blocks.
  children.push(React.createElement('div', { key: 'recent-title', style: HEADER }, t('recentTitle')))
  if (snapshot === undefined || snapshot.recent.length === 0) {
    children.push(React.createElement('div', { key: 'no-blocks', style: VALUE }, t('noBlocks')))
  } else {
    const rows = snapshot.recent.map(block => React.createElement('tr', { key: `${block.time}-${block.domain}` },
      React.createElement('td', { style: CELL }, new Date(block.time).toLocaleTimeString()),
      React.createElement('td', { style: CELL }, block.tool + (block.attributed ? '' : ` (${t('blockUnattributed')})`)),
      React.createElement('td', { style: CELL }, `${block.scheme ?? '?'}://${block.domain}${block.port === null ? '' : `:${block.port}`}`),
      React.createElement('td', { style: CELL }, block.matched
        ? t('blockBy', { index: (block.ruleIndex ?? 0) + 1 })
        : t('blockDefault')),
      React.createElement('td', { style: CELL }, block.action),
      React.createElement('td', { style: CELL }, block.reason ?? '')))
    children.push(React.createElement('table', { key: 'recent-table', style: TABLE },
      React.createElement('tbody', undefined, rows)))
  }

  // Rule editor.
  children.push(React.createElement('div', { key: 'editor-title', style: HEADER }, t('editorTitle')))
  children.push(React.createElement('div', { key: 'editor-picker', style: ROW },
    React.createElement('span', { style: LABEL }, t('editorPath')),
    picker,
    React.createElement('button', { type: 'button', onClick: () => { if (selected !== undefined) loadFile(selected) } }, t('editorLoad')),
    React.createElement('button', { type: 'button', onClick: reloadAll }, t('editorReload'))))
  if (selected === undefined) {
    children.push(React.createElement('div', { key: 'editor-empty', style: VALUE }, t('editorEmpty')))
  } else {
    children.push(React.createElement('textarea', {
      key: 'editor-text',
      style: TEXTAREA,
      value: text,
      spellCheck: false,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(event.target.value)
        setDirty(true)
        setNotice(undefined)
      },
    }))
    children.push(React.createElement('div', { key: 'editor-actions', style: { ...ROW, marginTop: 8 } },
      React.createElement('button', { type: 'button', disabled: !dirty, onClick: saveFile }, t('editorSave')),
      dirty === true ? React.createElement('span', { style: VALUE }, '●') : null,
      notice === undefined ? null : React.createElement('span', {
        key: 'notice',
        style: notice.ok ? NOTICE_OK : NOTICE_ERR,
      }, notice.text)))
  }

  return React.createElement('div', { style: { padding: '0 4px 24px' } }, ...children)
}
