import { reactive } from 'vue'
import { api } from './api.js'
import { listeners } from './devices.js'

export const plugins = reactive({ list: [], loaded: false })
const dataSubs = new Map()

export async function loadPlugins() {
  plugins.list = await api('GET', '/plugins')
  plugins.loaded = true
}

export const loc = (v, locale) => v && typeof v === 'object' ? v[locale] ?? v.en ?? v.de ?? Object.values(v)[0] : v ?? ''

export function pluginWidgets(locale) {
  return plugins.list.filter(p => p.enabled).flatMap(p => (p.manifest.widgets ?? []).map(w => ({
    value: `${p.id}/${w.id}`, label: `${p.manifest.icon ?? '◈'} ${loc(p.manifest.name, locale)} · ${loc(w.name, locale) || w.id}`,
  })))
}

export function subscribeData(id, fn) {
  if (!dataSubs.has(id)) dataSubs.set(id, new Set())
  dataSubs.get(id).add(fn)
  return () => dataSubs.get(id)?.delete(fn)
}

listeners.add((type, p) => {
  if (type === 'plugin.data') for (const fn of dataSubs.get(p.id) ?? []) fn(p.key, p.data)
  else if (type === 'plugin.status') {
    const x = plugins.list.find(x => x.id === p.id)
    if (x) x.status = { ...x.status, state: p.state, error: p.error }
  } else if (type === 'config.changed' && p.entity === 'plugin') loadPlugins().catch(() => {})
})
