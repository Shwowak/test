import { db, json } from '../core/db.js'
import { bus } from '../core/events.js'
import { log } from '../core/logger.js'
import { validateCommand } from './model.js'
import HomeAssistantAdapter from './adapters/homeassistant.js'
import MqttAdapter from './adapters/mqtt.js'
import ModbusAdapter from './adapters/modbus.js'
import RestAdapter from './adapters/rest.js'
import Zigbee2MqttAdapter from './adapters/zigbee2mqtt.js'
import ZwaveJsAdapter from './adapters/zwavejs.js'
import MatterAdapter from './adapters/matter.js'
import KnxAdapter from './adapters/knx.js'
import EvccAdapter from './adapters/evcc.js'
import ProxmoxAdapter from './adapters/proxmox.js'

export const ADAPTERS = { home_assistant: HomeAssistantAdapter, mqtt: MqttAdapter, rest: RestAdapter, zigbee2mqtt: Zigbee2MqttAdapter, zwavejs: ZwaveJsAdapter, matter: MatterAdapter, knx: KnxAdapter, modbus: ModbusAdapter, evcc: EvccAdapter, proxmox: ProxmoxAdapter }

const SECRET_KEYS = new Set(Object.values(ADAPTERS).flatMap(A => A.fields.filter(f => f.type === 'secret').map(f => f.key)))
export const redactConfig = c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, SECRET_KEYS.has(k) && v ? '••••••' : v]))
export const mergeConfigSecrets = (next, prev) => Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v === '••••••' ? prev[k] : v]))

export const deviceRow = r => r && {
  ...r, groups: json(r.groups || '[]'), capabilities: json(r.capabilities || '[]'), state: json(r.state), meta: json(r.meta),
  adopted: !!r.adopted, hidden: !!r.hidden,
}

const running = new Map()
const status = new Map()
const persistQueue = new Map()

function flushState() {
  if (!persistQueue.size) return
  const upd = db.prepare('UPDATE devices SET state = ?, connection = ?, battery = COALESCE(?, battery), last_seen = ? WHERE id = ?')
  for (const [id, d] of persistQueue) upd.run(JSON.stringify(d.state), d.connection, d.battery ?? null, d.last_seen, id)
  persistQueue.clear()
}
setInterval(flushState, 2000).unref()
process.on('beforeExit', flushState)

const live = new Map()

function getLive(id) {
  if (!live.has(id)) {
    const r = deviceRow(db.prepare('SELECT * FROM devices WHERE id = ?').get(id))
    if (!r) return null
    live.set(id, r)
  }
  return live.get(id)
}

export function invalidate(id) {
  if (id === undefined) live.clear()
  else live.delete(id)
}

function makeContext(integration) {
  const iid = integration.id
  const find = nativeId => db.prepare('SELECT id FROM devices WHERE integration_id = ? AND native_id = ?').get(iid, nativeId)?.id
  return {
    upsert(nativeId, info, state, extra = {}) {
      const existing = find(nativeId)
      if (!existing) {
        const id = db.prepare(`INSERT INTO devices (integration_id, native_id, name, type, manufacturer, model, capabilities, state, meta, connection, battery, last_seen, adopted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          iid, nativeId, info.name, info.type, info.manufacturer ?? null, info.model ?? null,
          JSON.stringify(info.capabilities), JSON.stringify(state ?? {}), JSON.stringify(info.meta ?? {}),
          extra.connection ?? 'unknown', extra.battery ?? null, new Date().toISOString(), integration.config.auto_adopt ? 1 : 0).lastInsertRowid
        bus.emit('device.discovered', { id, integration_id: iid, name: info.name })
        return
      }
      db.prepare('UPDATE devices SET capabilities = ?, manufacturer = COALESCE(?, manufacturer), model = COALESCE(?, model), meta = ? WHERE id = ?')
        .run(JSON.stringify(info.capabilities), info.manufacturer ?? null, info.model ?? null, JSON.stringify({ ...json(db.prepare('SELECT meta FROM devices WHERE id = ?').get(existing).meta), ...info.meta }), existing)
      invalidate(existing)
      if (state) this.update(nativeId, state, extra)
    },
    update(nativeId, statePatch, extra = {}) {
      const id = find(nativeId)
      if (!id) return
      const d = getLive(id)
      const prevConn = d.connection
      if (statePatch) d.state = { ...d.state, ...statePatch }
      if (extra.connection) d.connection = extra.connection
      if (extra.battery != null) d.battery = extra.battery
      d.last_seen = new Date().toISOString()
      persistQueue.set(id, d)
      if (prevConn !== d.connection && prevConn !== 'unknown') log('devices', d.connection === 'offline' ? 'warning' : 'info', `device.${d.connection}`, { device: d.name })
      bus.emit('device.state', { id, state: d.state, connection: d.connection, battery: d.battery, last_seen: d.last_seen })
    },
    devices() {
      return db.prepare('SELECT * FROM devices WHERE integration_id = ?').all(iid).map(deviceRow)
    },
    setStatus(s, error = null, info = {}) {
      const prev = status.get(iid)?.status
      status.set(iid, { status: s, error, info, since: new Date().toISOString() })
      if (prev !== s) {
        log('devices', s === 'error' ? 'error' : s === 'disconnected' ? 'warning' : 'info', `integration.${s}`, { integration: integration.name, error })
        bus.emit('integration.status', { id: iid, status: s, error })
      }
    },
  }
}

export const integrationRow = r => r && { ...r, config: json(r.config), enabled: !!r.enabled }

export async function startIntegration(id) {
  await stopIntegration(id)
  const i = integrationRow(db.prepare('SELECT * FROM integrations WHERE id = ?').get(id))
  if (!i || !i.enabled) return
  const A = ADAPTERS[i.adapter]
  if (!A) return
  const ctx = makeContext(i)
  const inst = new A(i, ctx)
  running.set(id, inst)
  ctx.setStatus('connecting')
  try {
    await inst.start()
  } catch (e) {
    ctx.setStatus('error', e.message)
  }
}

export async function stopIntegration(id) {
  const inst = running.get(id)
  if (!inst) return
  running.delete(id)
  status.delete(id)
  try { await inst.stop() } catch {}
}

export async function startAll() {
  for (const { id } of db.prepare('SELECT id FROM integrations WHERE enabled = 1').all()) startIntegration(id)
}

export async function integrationAction(id, action, value) {
  const inst = running.get(id)
  const method = inst?.constructor.actions?.[action]
  if (!method) throw new Error('action_unavailable')
  return inst[method](value)
}

export const integrationStatus = id => status.get(id) ?? { status: 'stopped' }

export function getDevice(id) {
  const d = getLive(Number(id))
  return d ? { ...d } : null
}

export async function commandDevice(id, capId, value, user) {
  const d = getDevice(id)
  if (!d) return { error: 'not_found' }
  const problem = validateCommand(d, capId, value)
  if (problem) return { error: problem }
  const inst = running.get(d.integration_id)
  if (!inst) return { error: 'integration.not_running' }
  try {
    await inst.command(d, capId, value)
    log('devices', 'info', 'device.command', { device: d.name, capability: capId, value }, user?.id)
    return { ok: true }
  } catch (e) {
    log('devices', 'error', 'device.command_failed', { device: d.name, capability: capId, message: e.message }, user?.id)
    return { error: 'device.command_failed', message: e.message }
  }
}

export async function testIntegration(adapter, config) {
  const A = ADAPTERS[adapter]
  if (!A) throw new Error('adapter_unknown')
  return new Promise(resolve => {
    let found = 0
    let done = false
    const ctx = {
      upsert: () => { found++ },
      update: () => {},
      devices: () => [],
      setStatus: (s, error) => {
        if (done) return
        if (s === 'connected') { done = true; finish({ ok: true }) }
        if (s === 'error') { done = true; finish({ ok: false, error }) }
      },
    }
    const inst = new A({ id: 0, name: 'test', adapter, config }, ctx)
    const finish = async r => {
      clearTimeout(timer)
      await new Promise(x => setTimeout(x, 1500))
      try { await inst.stop() } catch {}
      resolve({ ...r, found })
    }
    const timer = setTimeout(() => { if (!done) { done = true; finish({ ok: false, error: 'timeout' }) } }, 12000)
    inst.start().catch(e => { if (!done) { done = true; finish({ ok: false, error: e.message }) } })
  })
}
