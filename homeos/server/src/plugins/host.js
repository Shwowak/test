import { fork } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, json } from '../core/db.js'
import { bus } from '../core/events.js'
import { log } from '../core/logger.js'
import { notify } from '../core/notify.js'
import { getSetting } from '../core/settings.js'
import { getDevice, commandDevice } from '../devices/engine.js'
import { readDir, validateManifest } from './package.js'

const here = dirname(fileURLToPath(import.meta.url))
const RUNNER = join(here, 'runner.mjs')
export const BUILTIN_DIR = resolve(here, '..', '..', 'plugins')
export const USER_DIR = resolve(process.env.HOMEOS_PLUGIN_DIR ?? join(dirname(resolve(process.env.HOMEOS_DB ?? './data/homeos.db')), 'plugins'))

const procs = new Map()
const status = new Map()

export const pluginRow = r => r && {
  id: r.id, version: r.version, source: r.source, enabled: !!r.enabled, verified: !!r.verified, signer: r.signer,
  manifest: json(r.manifest), granted: json(r.granted), config: json(r.config), installed_at: r.installed_at, updated_at: r.updated_at,
  status: status.get(r.id) ?? { state: 'stopped' },
}

export const getPlugin = id => pluginRow(db.prepare('SELECT * FROM plugins WHERE id = ?').get(id))
export const pluginDir = p => p.source === 'builtin' ? join(BUILTIN_DIR, p.id) : join(USER_DIR, p.id)

function setStatus(id, state, error = null) {
  status.set(id, { state, error, since: new Date().toISOString(), restarts: status.get(id)?.restarts ?? 0 })
  bus.emit('plugin.status', { id, state, error })
}

function defaults(manifest) {
  return Object.fromEntries((manifest.config ?? []).filter(f => f.default !== undefined).map(f => [f.key, f.default]))
}

export function syncBuiltins() {
  if (!existsSync(BUILTIN_DIR)) return
  const now = new Date().toISOString()
  for (const id of readDirNames(BUILTIN_DIR)) {
    try {
      const files = readDir(join(BUILTIN_DIR, id))
      const m = validateManifest(JSON.parse(files.get('manifest.json').toString('utf8')), files)
      const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(m.id)
      if (!row) {
        db.prepare('INSERT INTO plugins (id, version, manifest, source, enabled, granted, config, verified, signer, installed_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, ?, ?)')
          .run(m.id, m.version, JSON.stringify(m), 'builtin', JSON.stringify(m.permissions ?? []), JSON.stringify(defaults(m)), 'SmartBoard', now, now)
      } else if (row.source === 'builtin' && (row.version !== m.version || row.manifest !== JSON.stringify(m))) {
        const granted = json(row.granted).filter(p => (m.permissions ?? []).includes(p))
        const old = json(row.manifest).permissions ?? []
        const added = (m.permissions ?? []).filter(p => !old.includes(p))
        db.prepare('UPDATE plugins SET version = ?, manifest = ?, granted = ?, config = ?, updated_at = ? WHERE id = ?')
          .run(m.version, JSON.stringify(m), JSON.stringify([...granted, ...added]), JSON.stringify({ ...defaults(m), ...json(row.config) }), now, m.id)
      }
    } catch (e) {
      log('plugins', 'error', 'plugin.load_failed', { plugin: id, error: e.message })
    }
  }
}

function readDirNames(dir) {
  return existsSync(dir) ? readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory()) : []
}

async function handleCall(p, method, args) {
  const has = perm => p.granted.includes(perm)
  const need = perm => { if (!has(perm)) throw new Error(`permission ${perm} not granted`) }
  switch (method) {
    case 'log':
      log('plugins', String(args[0]).startsWith('error') ? 'error' : 'info', 'plugin.log', { plugin: p.id, message: String(args[0]).slice(0, 500) })
      return null
    case 'publish': {
      const value = JSON.stringify(args[1] ?? null)
      if (value.length > 512 * 1024) throw new Error('data too large')
      const ts = new Date().toISOString()
      db.prepare('INSERT INTO plugin_data (plugin_id, key, value, ts) VALUES (?, ?, ?, ?) ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, ts = excluded.ts')
        .run(p.id, args[0], value, ts)
      bus.emit('plugin.data', { id: p.id, key: args[0], data: args[1] ?? null, ts })
      return null
    }
    case 'storage.get': {
      need('storage')
      const r = db.prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?').get(p.id, args[0])
      return r ? JSON.parse(r.value) : null
    }
    case 'storage.set': {
      need('storage')
      const value = JSON.stringify(args[1] ?? null)
      const used = db.prepare('SELECT COALESCE(SUM(LENGTH(value)), 0) AS n FROM plugin_storage WHERE plugin_id = ? AND key != ?').get(p.id, args[0]).n
      if (used + value.length > 5 * 1024 * 1024) throw new Error('storage quota exceeded')
      db.prepare('INSERT INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?) ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value').run(p.id, args[0], value)
      return null
    }
    case 'storage.delete':
      need('storage')
      db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?').run(p.id, args[0])
      return null
    case 'notify': {
      need('notifications')
      const n = args[0] ?? {}
      const level = ['info', 'warning', 'critical'].includes(n.level) ? n.level : 'info'
      return notify({ level, title: String(n.title ?? p.id).slice(0, 200), message: n.message ? String(n.message) : null, source: `plugin:${p.id}` }).id
    }
    case 'location':
      need('location')
      return { ...getSetting('location'), timezone: getSetting('timezone') }
    case 'devices.list':
      need('devices:read')
      return db.prepare('SELECT id FROM devices WHERE adopted = 1 AND hidden = 0').all().map(r => publicDevice(getDevice(r.id)))
    case 'devices.get':
      need('devices:read')
      return publicDevice(getDevice(args[0]))
    case 'devices.command': {
      need('devices:control')
      const r = await commandDevice(args[0], args[1], args[2], null)
      if (r.error) throw new Error(r.error)
      return true
    }
    case 'subscribe':
      return null
    default:
      throw new Error(`unknown method ${method}`)
  }
}

const publicDevice = d => d && { id: d.id, name: d.name, type: d.type, room_id: d.room_id, capabilities: d.capabilities, state: d.state, connection: d.connection, battery: d.battery }

export function startPlugin(id) {
  stopPlugin(id)
  const p = getPlugin(id)
  if (!p || !p.enabled) return setStatus(id, 'stopped')
  const dir = pluginDir(p)
  if (!existsSync(join(dir, 'manifest.json'))) return setStatus(id, 'error', 'files_missing')
  if (!p.manifest.backend) return setStatus(id, 'running')
  const file = join(dir, p.manifest.backend)
  const child = fork(RUNNER, [], {
    execArgv: ['--experimental-permission', `--allow-fs-read=${RUNNER}`, `--allow-fs-read=${dir}`, '--max-old-space-size=96', '--disable-warning=ExperimentalWarning'],
    env: { NODE_ENV: 'production', TZ: process.env.TZ ?? '' }, serialization: 'json', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  const entry = { child, actions: new Map(), nextId: 1, stderr: '' }
  procs.set(id, entry)
  setStatus(id, 'starting')
  child.stderr.on('data', d => { entry.stderr = (entry.stderr + d).slice(-2000) })
  child.on('message', async msg => {
    const cur = getPlugin(id)
    if (!cur) return
    if (msg.t === 'ready') setStatus(id, 'running')
    else if (msg.t === 'fatal') setStatus(id, 'error', msg.error)
    else if (msg.t === 'call') {
      try {
        child.send({ t: 'res', id: msg.id, result: await handleCall(cur, msg.method, msg.args ?? []) })
      } catch (e) {
        if (child.connected) child.send({ t: 'res', id: msg.id, error: e.message })
      }
    } else if (msg.t === 'action.res') {
      const a = entry.actions.get(msg.id)
      if (a) { entry.actions.delete(msg.id); msg.error ? a.reject(new Error(msg.error)) : a.resolve(msg.result) }
    }
  })
  child.on('exit', code => {
    if (procs.get(id)?.child !== child) return
    procs.delete(id)
    for (const a of entry.actions.values()) a.reject(new Error('plugin stopped'))
    const st = status.get(id) ?? {}
    const restarts = (st.restarts ?? 0) + 1
    const err = st.state === 'error' ? st.error : `exit ${code}${entry.stderr ? ': ' + entry.stderr.trim().split('\n').pop() : ''}`
    status.set(id, { state: 'error', error: err, since: new Date().toISOString(), restarts })
    bus.emit('plugin.status', { id, state: 'error', error: err })
    log('plugins', 'error', 'plugin.crashed', { plugin: id, error: err })
    if (restarts <= 5 && getPlugin(id)?.enabled) setTimeout(() => { if (!procs.has(id)) startPlugin(id) }, Math.min(2 ** restarts * 1000, 60000)).unref()
  })
  child.send({ t: 'init', manifest: p.manifest, config: p.config, granted: p.granted, lang: 'de', file })
}

export function stopPlugin(id) {
  const e = procs.get(id)
  if (!e) return
  procs.delete(id)
  e.child.kill()
  setStatus(id, 'stopped')
}

export function resetRestarts(id) {
  const st = status.get(id)
  if (st) st.restarts = 0
}

export function pushConfig(id) {
  const e = procs.get(id)
  const p = getPlugin(id)
  if (e && p) e.child.send({ t: 'config', config: p.config })
}

export function callAction(id, name, payload) {
  const e = procs.get(id)
  if (!e) return Promise.reject(new Error('plugin not running'))
  return new Promise((resolve, reject) => {
    const aid = e.nextId++
    e.actions.set(aid, { resolve, reject })
    e.child.send({ t: 'action', id: aid, name, payload: payload ?? null })
    setTimeout(() => { if (e.actions.delete(aid)) reject(new Error('timeout')) }, 20000).unref()
  })
}

export function installFiles(id, files) {
  mkdirSync(USER_DIR, { recursive: true })
  const target = join(USER_DIR, id)
  const tmp = target + '.new'
  rmSync(tmp, { recursive: true, force: true })
  for (const [name, data] of files) {
    const p = join(tmp, name)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, data)
  }
  rmSync(target, { recursive: true, force: true })
  renameSync(tmp, target)
}

export function removeFiles(id) {
  rmSync(join(USER_DIR, id), { recursive: true, force: true })
}

export function pluginFile(p, path) {
  const dir = pluginDir(p)
  const full = resolve(dir, path)
  if (!full.startsWith(dir + '/') || !existsSync(full)) return null
  return readFileSync(full)
}

function onDeviceState(payload) {
  for (const [id, e] of procs) {
    const p = getPlugin(id)
    if (p?.granted.includes('devices:read') && e.child.connected) e.child.send({ t: 'event', event: 'device.state', payload })
  }
}

export function startPlugins() {
  syncBuiltins()
  for (const r of db.prepare('SELECT id FROM plugins WHERE enabled = 1').all()) startPlugin(r.id)
  bus.on('device.state', onDeviceState)
  bus.on('config.restored', () => {
    for (const id of [...procs.keys()]) stopPlugin(id)
    syncBuiltins()
    for (const r of db.prepare('SELECT id FROM plugins WHERE enabled = 1').all()) startPlugin(r.id)
  })
}

export function stopPlugins() {
  for (const id of [...procs.keys()]) stopPlugin(id)
}
