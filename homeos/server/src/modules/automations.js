import { db } from '../core/db.js'
import { notFound, badRequest, requirePerm, HttpError } from '../core/http.js'
import { recordChange } from '../core/versions.js'
import { notify, acknowledge, listNotifications, NOTIFICATION_LEVELS } from '../core/notify.js'
import { allSettings, setSetting } from '../core/settings.js'
import { sunTimes } from '../automation/sun.js'
import { TRIGGER_TYPES, CONDITION_TYPES, ACTION_TYPES, automationRow, runAutomation } from '../automation/engine.js'

const blockList = types => ({
  type: 'array', maxItems: 30,
  items: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: Object.keys(types) } }, additionalProperties: true },
})

const automationBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 }, enabled: { type: 'boolean' }, cooldown: { type: 'integer', minimum: 0, maximum: 86400 },
    triggers: blockList(TRIGGER_TYPES), conditions: blockList(CONDITION_TYPES), actions: blockList(ACTION_TYPES),
  },
}

export default async function automationsModule(app) {
  const tN = (summary, extra = {}) => ({ tags: ['notifications'], summary, ...extra })
  const tA = (summary, extra = {}) => ({ tags: ['automations'], summary, ...extra })
  const tS = (summary, extra = {}) => ({ tags: ['settings'], summary, ...extra })

  app.get('/notifications', {
    schema: tN('List notifications', { querystring: { type: 'object', properties: { open: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } } } }),
    preHandler: requirePerm('notifications.view'),
  }, async req => listNotifications(req.query))

  app.post('/notifications', {
    schema: tN('Create notification (manual / external)', { body: { type: 'object', required: ['title'], properties: { level: { type: 'string', enum: NOTIFICATION_LEVELS }, title: { type: 'string', maxLength: 200 }, message: { type: 'string', maxLength: 2000 } } } }),
    preHandler: requirePerm('notifications.manage'),
  }, async req => notify({ ...req.body, source: `user:${req.user.name}` }))

  app.post('/notifications/ack', {
    schema: tN('Acknowledge notifications', { body: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } }, all: { type: 'boolean' } } } }),
    preHandler: requirePerm('notifications.manage'),
  }, async req => {
    const ids = req.body.all ? db.prepare('SELECT id FROM notifications WHERE acknowledged_at IS NULL').all().map(r => r.id) : req.body.ids ?? []
    return { acknowledged: acknowledge(ids, req.user) }
  })

  app.get('/automations/meta', { schema: tA('Trigger, condition and action types'), preHandler: requirePerm('automations.view') }, async () => ({
    triggers: TRIGGER_TYPES, conditions: CONDITION_TYPES, actions: ACTION_TYPES,
  }))

  app.get('/automations', { schema: tA('List automations'), preHandler: requirePerm('automations.view') }, async () =>
    db.prepare('SELECT * FROM automations ORDER BY name').all().map(automationRow))

  app.post('/automations', { schema: tA('Create automation', { body: { ...automationBody, required: ['name'] } }), preHandler: requirePerm('automations.manage') }, async req => {
    const b = req.body
    const id = db.prepare('INSERT INTO automations (name, enabled, cooldown, triggers, conditions, actions) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b.name, b.enabled === false ? 0 : 1, b.cooldown ?? 0, JSON.stringify(b.triggers ?? []), JSON.stringify(b.conditions ?? []), JSON.stringify(b.actions ?? [])).lastInsertRowid
    recordChange(req.user, 'automation', id, 'create', b.name)
    return automationRow(db.prepare('SELECT * FROM automations WHERE id = ?').get(id))
  })

  app.put('/automations/:id', { schema: tA('Update automation', { body: automationBody }), preHandler: requirePerm('automations.manage') }, async req => {
    const a = automationRow(db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id))
    if (!a) throw notFound()
    const b = { ...a, ...req.body }
    db.prepare('UPDATE automations SET name = ?, enabled = ?, cooldown = ?, triggers = ?, conditions = ?, actions = ? WHERE id = ?')
      .run(b.name, Number(b.enabled), b.cooldown ?? 0, JSON.stringify(b.triggers), JSON.stringify(b.conditions), JSON.stringify(b.actions), a.id)
    recordChange(req.user, 'automation', a.id, 'update', b.name)
    return automationRow(db.prepare('SELECT * FROM automations WHERE id = ?').get(a.id))
  })

  app.delete('/automations/:id', { schema: tA('Delete automation'), preHandler: requirePerm('automations.manage') }, async req => {
    const a = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id)
    if (!a) throw notFound()
    db.prepare('DELETE FROM automations WHERE id = ?').run(a.id)
    recordChange(req.user, 'automation', a.id, 'delete', a.name)
    return { ok: true }
  })

  app.post('/automations/:id/run', { schema: tA('Run actions now (ignores triggers and conditions)'), preHandler: requirePerm('automations.manage') }, async req => {
    const r = await runAutomation(Number(req.params.id), { trigger: `manual:${req.user.name}`, force: true })
    if (r.error === 'not_found') throw notFound()
    if (r.error) throw new HttpError(422, r.error, { message: r.message })
    return r
  })

  app.get('/automations/:id/runs', { schema: tA('Run history'), preHandler: requirePerm('automations.view') }, async req =>
    db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT 50').all(req.params.id))

  app.get('/settings', { schema: tS('General settings incl. location and sun times') }, async () => {
    const s = allSettings()
    const sun = sunTimes(new Date(), s.location.lat, s.location.lon)
    return { ...s, sun }
  })

  app.put('/settings', {
    schema: tS('Update general settings', { body: { type: 'object', properties: {
      location: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lon: { type: 'number', minimum: -180, maximum: 180 }, name: { type: 'string', maxLength: 80 } } },
      timezone: { type: 'string', maxLength: 64 },
      autologin: { type: ['object', 'null'], properties: { user_id: { type: 'integer' }, scope: { type: 'string', enum: ['device', 'lan'] } } },
    } } }),
    preHandler: requirePerm('users.manage'),
  }, async req => {
    if (req.body.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: req.body.timezone }) } catch { throw badRequest('timezone.invalid') }
      setSetting('timezone', req.body.timezone)
    }
    if (req.body.location) setSetting('location', req.body.location)
    if (req.body.autologin !== undefined) {
      const a = req.body.autologin
      if (a?.user_id && !db.prepare('SELECT id FROM users WHERE id = ?').get(a.user_id)) throw badRequest('user.not_found')
      setSetting('autologin', a?.user_id ? { user_id: a.user_id, scope: a.scope ?? 'device' } : null)
    }
    recordChange(req.user, 'settings', null, 'update')
    return allSettings()
  })
}
