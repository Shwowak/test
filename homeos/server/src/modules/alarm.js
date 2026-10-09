import { randomBytes, timingSafeEqual } from 'node:crypto'
import { bus } from '../core/events.js'
import { log } from '../core/logger.js'
import { getSetting, setSetting } from '../core/settings.js'
import { requirePerm, notFound } from '../core/http.js'
import { recordChange } from '../core/versions.js'
import { setPower } from '../system/display.js'

const DEFAULTS = { enabled: false, secret: '', monitor_url: '', duration: 30, sound: true, sound_seconds: 20, screen_on: true }
export const alarmConfig = () => ({ ...DEFAULTS, ...(getSetting('alarm') ?? {}) })

let active = null
let timer = null

const pick = (o, keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((x, p) => x?.[p], o)
    if (v != null && v !== '') return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return ''
}

export function parseAlarm(body = {}) {
  const b = typeof body === 'string' ? { message: body } : body
  return {
    title: pick(b, ['keyword', 'stichwort', 'title', 'event', 'alarm.keyword', 'alarm.title', 'subject', 'name']).slice(0, 120) || 'Alarm',
    text: pick(b, ['message', 'text', 'meldung', 'description', 'alarm.message', 'alarm.text', 'body', 'content']).slice(0, 2000),
    address: pick(b, ['address', 'adresse', 'einsatzort', 'location', 'alarm.address', 'alarm.location']).slice(0, 300),
    units: pick(b, ['units', 'fahrzeuge', 'groups', 'alarm.units']).slice(0, 300),
  }
}

export function startAlarm(data, source = 'webhook') {
  const cfg = alarmConfig()
  const now = Date.now()
  active = { id: now, ...data, source, started: new Date(now).toISOString(), until: now + cfg.duration * 60000, monitor_url: cfg.monitor_url, sound: cfg.sound, sound_seconds: cfg.sound_seconds }
  clearTimeout(timer)
  timer = setTimeout(() => endAlarm('timeout'), cfg.duration * 60000)
  timer.unref?.()
  if (cfg.screen_on && process.env.SMARTBOARD_HAL === '1') setPower(true).catch(() => {})
  bus.emit('ui.command', { action: 'display', state: 'on' })
  bus.emit('alarm', active)
  log('system', 'warning', 'alarm.started', { title: active.title, source })
  return active
}

export function endAlarm(by = 'user') {
  if (!active) return
  clearTimeout(timer)
  log('system', 'info', 'alarm.ended', { title: active.title, by })
  active = null
  bus.emit('alarm', null)
}

const sameSecret = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export default async function alarmModule(app) {
  const manage = requirePerm('users.manage')
  const t = (summary, extra = {}) => ({ tags: ['alarm'], summary, ...extra })
  const cfgBody = { type: 'object', properties: {
    enabled: { type: 'boolean' }, monitor_url: { type: 'string', maxLength: 1000 }, duration: { type: 'integer', minimum: 1, maximum: 720 },
    sound: { type: 'boolean' }, sound_seconds: { type: 'integer', minimum: 0, maximum: 600 }, screen_on: { type: 'boolean' }, regenerate: { type: 'boolean' },
  } }

  app.get('/alarm', { schema: t('Active alarm or null'), preHandler: requirePerm('dashboards.view') }, async () => ({ active }))

  app.post('/alarm/end', { schema: t('End active alarm'), preHandler: requirePerm('dashboards.view') }, async () => { endAlarm(); return { ok: true } })

  app.get('/alarm/config', { schema: t('Alarm settings'), preHandler: manage }, async () => alarmConfig())

  app.put('/alarm/config', { schema: t('Update alarm settings', { body: cfgBody }), preHandler: manage }, async req => {
    const { regenerate, ...b } = req.body
    const next = { ...alarmConfig(), ...b }
    if (b.monitor_url && !/^https:\/\//.test(b.monitor_url)) next.monitor_url = ''
    if (regenerate || !next.secret) next.secret = randomBytes(18).toString('base64url')
    setSetting('alarm', next)
    recordChange(req.user, 'settings', null, 'update', 'alarm')
    return next
  })

  app.post('/alarm/test', { schema: t('Trigger test alarm'), preHandler: manage }, async () =>
    startAlarm({ title: 'Probealarm', text: 'Dies ist ein Test des Einsatzmonitors.', address: '', units: '' }, 'test'))

  app.post('/alarm/hook/:secret', { schema: t('Incoming alarm webhook (GroupAlarm, DIVERA, alamos, any JSON)'), config: { public: true } }, async req => {
    const cfg = alarmConfig()
    if (!cfg.enabled || !cfg.secret || !sameSecret(String(req.params.secret), cfg.secret)) throw notFound()
    const body = req.body ?? {}
    if (body.end === true || body.status === 'closed' || body.event === 'alarm_closed') { endAlarm('webhook'); return { ok: true } }
    startAlarm(parseAlarm(body))
    return { ok: true }
  })
}
