import { db, json } from '../core/db.js'
import { bus } from '../core/events.js'
import { log } from '../core/logger.js'
import { notify } from '../core/notify.js'
import { getSetting } from '../core/settings.js'
import { getDevice, commandDevice } from '../devices/engine.js'
import { sunTimes, isDark } from './sun.js'

export const TRIGGER_TYPES = {
  time: { fields: [{ key: 'at', type: 'time' }, { key: 'days', type: 'weekdays' }] },
  sun: { fields: [{ key: 'event', type: 'select', options: ['sunrise', 'sunset'] }, { key: 'offset', type: 'number' }] },
  interval: { fields: [{ key: 'minutes', type: 'number' }] },
  device_state: { fields: [{ key: 'device_id', type: 'device' }, { key: 'capability', type: 'capability' }, { key: 'op', type: 'select', options: ['changed', 'eq', 'ne', 'gt', 'lt', 'becomes_true', 'becomes_false'] }, { key: 'value', type: 'value' }] },
  device_connection: { fields: [{ key: 'device_id', type: 'device' }, { key: 'to', type: 'select', options: ['offline', 'online'] }] },
  startup: { fields: [] },
}

export const CONDITION_TYPES = {
  time_between: { fields: [{ key: 'from', type: 'time' }, { key: 'to', type: 'time' }] },
  weekday: { fields: [{ key: 'days', type: 'weekdays' }] },
  dark: { fields: [{ key: 'is', type: 'select', options: ['dark', 'light'] }] },
  device_state: { fields: [{ key: 'device_id', type: 'device' }, { key: 'capability', type: 'capability' }, { key: 'op', type: 'select', options: ['eq', 'ne', 'gt', 'lt', 'is_true', 'is_false'] }, { key: 'value', type: 'value' }] },
}

export const ACTION_TYPES = {
  device_command: { fields: [{ key: 'device_id', type: 'device' }, { key: 'capability', type: 'capability', writable: true }, { key: 'value', type: 'value' }] },
  notify: { fields: [{ key: 'level', type: 'select', options: ['info', 'warning', 'critical', 'emergency'] }, { key: 'title', type: 'text' }, { key: 'message', type: 'text' }] },
  dashboard: { fields: [{ key: 'dashboard_id', type: 'dashboard' }] },
  display: { fields: [{ key: 'state', type: 'select', options: ['on', 'dim', 'off'] }] },
  sound: { fields: [{ key: 'tone', type: 'select', options: ['chime', 'alert', 'alarm'] }] },
  camera: { fields: [{ key: 'camera_id', type: 'camera' }, { key: 'seconds', type: 'number' }] },
  speak: { fields: [{ key: 'text', type: 'text' }] },
  delay: { fields: [{ key: 'seconds', type: 'number' }] },
  run_automation: { fields: [{ key: 'automation_id', type: 'automation' }] },
}

export const automationRow = r => r && {
  ...r, enabled: !!r.enabled, triggers: json(r.triggers || '[]'), conditions: json(r.conditions || '[]'), actions: json(r.actions || '[]'),
}

function local(date = new Date()) {
  const tz = getSetting('timezone')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(date).map(p => [p.type, p.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return { hm: `${parts.hour}:${parts.minute}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: wd }
}

const toMinutes = hm => {
  const [h, m] = String(hm ?? '00:00').split(':').map(Number)
  return h * 60 + (m || 0)
}

function compare(op, actual, expected) {
  const num = v => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v)
  const a = num(actual)
  const e = num(expected)
  switch (op) {
    case 'eq': return String(a) === String(e)
    case 'ne': return String(a) !== String(e)
    case 'gt': return Number(a) > Number(e)
    case 'lt': return Number(a) < Number(e)
    case 'is_true': return a === true
    case 'is_false': return a === false
    default: return false
  }
}

function checkConditions(conditions, now = new Date()) {
  const l = local(now)
  for (const c of conditions) {
    if (c.type === 'time_between') {
      const f = toMinutes(c.from)
      const t = toMinutes(c.to)
      const inside = f <= t ? l.minutes >= f && l.minutes < t : l.minutes >= f || l.minutes < t
      if (!inside) return false
    } else if (c.type === 'weekday') {
      if (Array.isArray(c.days) && c.days.length && !c.days.includes(l.weekday)) return false
    } else if (c.type === 'dark') {
      const loc = getSetting('location')
      if (isDark(now, loc.lat, loc.lon) !== (c.is !== 'light')) return false
    } else if (c.type === 'device_state') {
      const d = getDevice(c.device_id)
      if (!d || !compare(c.op, d.state?.[c.capability], c.value)) return false
    }
  }
  return true
}

const fill = (text, ctx) => String(text ?? '').replace(/\{(\w+)(?:\.(\w+))?\}/g, (m, a, b) => {
  const v = b ? ctx[a]?.[b] : ctx[a]
  return v === undefined || v === null ? m : typeof v === 'object' ? JSON.stringify(v) : String(v)
})

const recentRuns = new Map()

async function runActions(a, ctx, depth) {
  for (const act of a.actions) {
    switch (act.type) {
      case 'device_command': {
        let value = act.value
        const d = getDevice(act.device_id)
        const c = d?.capabilities.find(x => x.id === act.capability)
        if (c?.value === 'boolean') value = value === true || value === 'true' || value === 'on' || value === 1
        else if (c?.value === 'number') value = Number(value)
        const r = await commandDevice(act.device_id, act.capability, value, null)
        if (r.error) throw new Error(`${d?.name ?? act.device_id}: ${r.error}${r.message ? ' ' + r.message : ''}`)
        break
      }
      case 'notify':
        notify({ level: act.level, title: fill(act.title || a.name, ctx), message: fill(act.message, ctx), source: `automation:${a.id}` })
        break
      case 'dashboard':
        bus.emit('ui.command', { action: 'dashboard', dashboard_id: Number(act.dashboard_id) })
        break
      case 'display':
        bus.emit('ui.command', { action: 'display', state: act.state })
        break
      case 'sound':
        bus.emit('ui.command', { action: 'sound', tone: act.tone })
        break
      case 'camera':
        bus.emit('ui.command', { action: 'camera', camera_id: Number(act.camera_id), seconds: Number(act.seconds) || 60 })
        break
      case 'speak':
        bus.emit('ui.command', { action: 'speak', text: fill(act.text, ctx) })
        break
      case 'delay':
        await new Promise(r => setTimeout(r, Math.min(Number(act.seconds) || 0, 3600) * 1000))
        break
      case 'run_automation':
        if (depth < 3) await runAutomation(Number(act.automation_id), { trigger: `automation:${a.id}`, force: false, depth: depth + 1 })
        break
    }
  }
}

export async function runAutomation(id, { trigger = 'manual', force = false, depth = 0, ctx = {} } = {}) {
  if (!getSetting('features')?.automations) return { skipped: 'feature_disabled' }
  const a = automationRow(db.prepare('SELECT * FROM automations WHERE id = ?').get(id))
  if (!a) return { error: 'not_found' }
  if (!force) {
    if (!a.enabled) return { skipped: 'disabled' }
    if (a.cooldown && a.last_run && Date.now() - Date.parse(a.last_run) < a.cooldown * 1000) return { skipped: 'cooldown' }
    if (!checkConditions(a.conditions)) return { skipped: 'conditions' }
  }
  const now = Date.now()
  const runs = (recentRuns.get(id) ?? []).filter(t => now - t < 60000)
  if (runs.length >= 20) {
    log('automations', 'error', 'automation.loop_blocked', { automation: a.name })
    return { skipped: 'rate_limit' }
  }
  recentRuns.set(id, [...runs, now])
  const started = Date.now()
  let error = null
  try {
    await runActions(a, { ...ctx, automation: { name: a.name } }, depth)
  } catch (e) {
    error = e.message
  }
  const ts = new Date().toISOString()
  db.prepare('UPDATE automations SET last_run = ?, run_count = run_count + 1 WHERE id = ?').run(ts, a.id)
  db.prepare('INSERT INTO automation_runs (automation_id, ts, trigger, ok, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .run(a.id, ts, trigger, error ? 0 : 1, error, Date.now() - started)
  db.prepare('DELETE FROM automation_runs WHERE automation_id = ? AND id <= (SELECT MAX(id) FROM automation_runs WHERE automation_id = ?) - 200').run(a.id, a.id)
  log('automations', error ? 'error' : 'info', error ? 'automation.failed' : 'automation.ran', { automation: a.name, trigger, error })
  bus.emit('automation.ran', { id: a.id, ok: !error, error, ts })
  return error ? { error: 'automation.failed', message: error } : { ok: true }
}

function enabledWith(type) {
  return db.prepare('SELECT * FROM automations WHERE enabled = 1').all().map(automationRow).filter(a => a.triggers.some(t => t.type === type))
}

const prevState = new Map()

function onDeviceState({ id, state, connection }) {
  const before = prevState.get(id) ?? { state: undefined, connection: undefined }
  prevState.set(id, { state: { ...state }, connection })
  const device = getDevice(id)
  for (const a of enabledWith('device_state').concat(enabledWith('device_connection'))) {
    for (const t of a.triggers) {
      if (Number(t.device_id) !== id) continue
      let hit = false
      if (t.type === 'device_connection') hit = before.connection !== undefined && before.connection !== connection && connection === t.to
      else if (t.type === 'device_state') {
        if (before.state === undefined) continue
        const old = before.state?.[t.capability]
        const cur = state?.[t.capability]
        if (JSON.stringify(old) === JSON.stringify(cur)) continue
        if (t.op === 'changed') hit = true
        else if (t.op === 'becomes_true') hit = cur === true && old !== true
        else if (t.op === 'becomes_false') hit = cur === false && old !== false
        else hit = compare(t.op, cur, t.value) && !compare(t.op, old, t.value)
      }
      if (hit) {
        runAutomation(a.id, { trigger: `${t.type}:${device?.name ?? id}`, ctx: { device: { name: device?.name, id }, value: state?.[t.capability] } })
        break
      }
    }
  }
}

const fired = new Set()

function tick() {
  const now = new Date()
  const l = local(now)
  const key = `${now.toISOString().slice(0, 10)}T${l.hm}`
  const loc = getSetting('location')
  const sun = sunTimes(now, loc.lat, loc.lon)
  for (const a of db.prepare('SELECT * FROM automations WHERE enabled = 1').all().map(automationRow)) {
    for (const [i, t] of a.triggers.entries()) {
      let hit = false
      if (t.type === 'time') hit = t.at === l.hm && (!t.days?.length || t.days.includes(l.weekday))
      else if (t.type === 'interval') hit = Number(t.minutes) > 0 && Math.floor(now.getTime() / 60000) % Number(t.minutes) === 0
      else if (t.type === 'sun' && sun[t.event]) {
        const at = new Date(sun[t.event].getTime() + (Number(t.offset) || 0) * 60000)
        hit = local(at).hm === l.hm
      }
      const fk = `${a.id}:${i}:${key}`
      if (hit && !fired.has(fk)) {
        fired.add(fk)
        runAutomation(a.id, { trigger: t.type })
      }
    }
  }
  if (fired.size > 5000) fired.clear()
}

let timer = null

export function startAutomations() {
  for (const r of db.prepare('SELECT id, state, connection FROM devices').all()) prevState.set(r.id, { state: json(r.state), connection: r.connection })
  bus.on('device.state', onDeviceState)
  timer = setInterval(tick, 15000)
  timer.unref()
  setTimeout(() => {
    for (const a of enabledWith('startup')) runAutomation(a.id, { trigger: 'startup' })
  }, 5000).unref()
}

export function stopAutomations() {
  bus.off('device.state', onDeviceState)
  clearInterval(timer)
}

export { checkConditions as _checkConditions, compare as _compare, local as _local }
