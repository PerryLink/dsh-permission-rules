/**
 * Settings-page copy for `dsh-permission-rules`, `en`/`zh` (the two UI
 * language codes the harness locale registry accepts today).
 * @module dsh-permission-rules/client/locales
 */

export type PermissionRulesLocaleKey =
  | 'nav'
  | 'policyTitle'
  | 'mode'
  | 'preset'
  | 'configured'
  | 'proxy'
  | 'proxyActive'
  | 'proxyInactive'
  | 'proxyDisabled'
  | 'counters'
  | 'denied'
  | 'askBlocked'
  | 'recentTitle'
  | 'noBlocks'
  | 'blockBy'
  | 'blockDefault'
  | 'blockUnattributed'
  | 'editorTitle'
  | 'editorPath'
  | 'editorLoad'
  | 'editorSave'
  | 'editorReload'
  | 'editorEmpty'
  | 'editorSaved'
  | 'editorFailed'
  | 'editorUntitled'
  | 'unknown'

export const en: Record<PermissionRulesLocaleKey, string> = {
  nav: 'Permission Rules',
  policyTitle: 'Network policy',
  mode: 'Mode',
  preset: 'Sandbox preset',
  configured: 'Configured',
  proxy: 'Proxy',
  proxyActive: 'active on 127.0.0.1:{port}',
  proxyInactive: 'INACTIVE (bind failed — shell network policy is not enforced)',
  proxyDisabled: 'network policy disabled',
  counters: 'Blocks',
  denied: 'denied',
  askBlocked: 'ask-blocked',
  recentTitle: 'Recent blocks',
  noBlocks: 'No network blocks recorded yet.',
  blockBy: 'rule {index}',
  blockDefault: 'mode default',
  blockUnattributed: 'unattributed',
  editorTitle: 'Rule editor',
  editorPath: 'Rule file',
  editorLoad: 'Load',
  editorSave: 'Save',
  editorReload: 'Reload rules',
  editorEmpty: 'Choose a rule file to edit. The editor only touches rule files the plugin already loads.',
  editorSaved: 'Saved and reloaded ({reloaded} workspace(s)).',
  editorFailed: 'Save rejected: {error}',
  editorUntitled: '(new file)',
  unknown: 'Unknown error',
}

export const zh: Record<PermissionRulesLocaleKey, string> = {
  nav: '权限规则',
  policyTitle: '网络策略',
  mode: '模式',
  preset: '沙箱预设',
  configured: '显式配置',
  proxy: '代理',
  proxyActive: '运行于 127.0.0.1:{port}',
  proxyInactive: '未激活（绑定失败——shell 网络策略未生效）',
  proxyDisabled: '网络策略已停用',
  counters: '拦截',
  denied: '拒绝',
  askBlocked: '待审批阻断',
  recentTitle: '近期拦截',
  noBlocks: '尚未记录任何网络拦截。',
  blockBy: '规则 {index}',
  blockDefault: '模式默认',
  blockUnattributed: '未归属',
  editorTitle: '规则编辑器',
  editorPath: '规则文件',
  editorLoad: '载入',
  editorSave: '保存',
  editorReload: '重载规则',
  editorEmpty: '选择要编辑的规则文件。编辑器只能读写插件已加载的规则文件。',
  editorSaved: '已保存并重载（{reloaded} 个工作区）。',
  editorFailed: '保存被拒绝：{error}',
  editorUntitled: '（新文件）',
  unknown: '未知错误',
}
