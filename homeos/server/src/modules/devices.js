import { db, json } from '../core/db.js'
import { bus } from '../core/events.js'
import { notFound, badRequest, requirePerm, HttpError } from '../core/http.js'
import { recordChange } from '../core/versions.js'
import { log } from '../core/logger.js'
import { userFromToken, can } from '../core/auth.js'
import { DEVICE_TYPES, CAPABILITY_KINDS } from '../devices/model.js'
import {
  ADAPTERS, deviceRow, integrationRow, redactConfig, mergeConfigSecrets, startIntegration, stopIntegration,
  integrationStatus, getDevice, commandDevice, testIntegration, invalidate,
} from '../devices/engine.js'
import { REST_DEVICE_FIELDS, restDefinition } from '../devices/adapters/rest.js'

const withLive = r => {
  const d = deviceRow(r)
  const l = getDevice(d.id)
  return l ? { ...d, state: l.state, connection: l.connection, battery: l.battery, last_seen: l.last_seen } : d
}

function roomByName(name) {
  if (!name) return null
  const r = db.prepare('SELECT id FROM rooms WHERE lower(name) = lower(?)').get(name)
  if (r) return r.id
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM rooms').get().p
  return db.prepare('INSERT INTO rooms (name, position) VALUES (?, ?)').run(name, pos).lastInsertRowid
}

export default async function devicesModule(app) {
  const view = requirePerm('devices.view')
  const manage = requirePerm('devices.manage')
  const tag = t => (summary, extra = {}) => ({ tags: [t], summary, ...extra })
  const tR = tag('rooms')
  const tI = tag('integrations')
  const tD = tag('devices')

  app.get('/rooms', { schema: tR('List rooms'), preHandler: view }, async () => db.prepare('SELECT * FROM rooms ORDER BY position, id').all())

  const roomBody = { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 60 }, icon: { type: 'string', maxLength: 8 }, position: { type: 'integer' } } }

  app.post('/rooms', { schema: tR('Create room', { body: { ...roomBody, required: ['name'] } }), preHandler: manage }, async req => {
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM rooms').get().p
    const id = db.prepare('INSERT INTO rooms (name, icon, position) VALUES (?, ?, ?)').run(req.body.name, req.body.icon ?? '▢', pos).lastInsertRowid
    recordChange(req.user, 'room', id, 'create', req.body.name)
    return db.prepare('SELECT * FROM rooms WHERE id = ?').get(id)
  })

  app.put('/rooms/:id', { schema: tR('Update room', { body: roomBody }), preHandler: manage }, async req => {
    const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id)
    if (!r) throw notFound()
    const b = req.body
    db.prepare('UPDATE rooms SET name = ?, icon = ?, position = ? WHERE id = ?').run(b.name ?? r.name, b.icon ?? r.icon, b.position ?? r.position, r.id)
    recordChange(req.user, 'room', r.id, 'update', b.name ?? r.name)
    return db.prepare('SELECT * FROM rooms WHERE id = ?').get(r.id)
  })

  app.delete('/rooms/:id', { schema: tR('Delete room (devices keep existing)'), preHandler: manage }, async req => {
    const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id)
    if (!r) throw notFound()
    db.prepare('DELETE FROM rooms WHERE id = ?').run(r.id)
    invalidate()
    recordChange(req.user, 'room', r.id, 'delete', r.name)
    return { ok: true }
  })

  app.get('/integrations', { schema: tI('List integrations with live status'), preHandler: view }, async () =>
    db.prepare('SELECT * FROM integrations ORDER BY name').all().map(integrationRow).map(i => ({
      ...i, config: redactConfig(i.config), status: integrationStatus(i.id),
      devices: db.prepare('SELECT COUNT(*) c FROM devices WHERE integration_id = ?').get(i.id).c,
    })))

  const intBody = { type: 'object', properties: { name: { type: 'string', maxLength: 80 }, adapter: { type: 'string' }, config: { type: 'object' }, enabled: { type: 'boolean' } } }

  app.post('/integrations/test', { schema: tI('Test connection without saving', { body: { ...intBody, required: ['adapter', 'config'] } }), preHandler: manage }, async req => {
    let config = req.body.config
    if (req.body.id) {
      const prev = integrationRow(db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.body.id))
      if (prev) config = mergeConfigSecrets(config, prev.config)
    }
    return testIntegration(req.body.adapter, config)
  })

  app.post('/integrations', { schema: tI('Create integration', { body: { ...intBody, required: ['adapter'] } }), preHandler: manage }, async req => {
    const { adapter, name, config, enabled } = req.body
    if (!ADAPTERS[adapter]) throw badRequest('integration.adapter_invalid')
    const id = db.prepare('INSERT INTO integrations (adapter, name, config, enabled) VALUES (?, ?, ?, ?)')
      .run(adapter, name || adapter, JSON.stringify(config ?? {}), enabled === false ? 0 : 1).lastInsertRowid
    recordChange(req.user, 'integration', id, 'create', name || adapter)
    startIntegration(id)
    return { id }
  })

  app.put('/integrations/:id', { schema: tI('Update integration', { body: intBody }), preHandler: manage }, async req => {
    const i = integrationRow(db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id))
    if (!i) throw notFound()
    const b = req.body
    const config = b.config ? mergeConfigSecrets(b.config, i.config) : i.config
    db.prepare('UPDATE integrations SET name = ?, config = ?, enabled = ? WHERE id = ?')
      .run(b.name ?? i.name, JSON.stringify(config), b.enabled === undefined ? Number(i.enabled) : Number(b.enabled), i.id)
    recordChange(req.user, 'integration', i.id, 'update', b.name ?? i.name)
    startIntegration(i.id)
    return { ok: true }
  })

  app.delete('/integrations/:id', { schema: tI('Delete integration and its devices'), preHandler: manage }, async req => {
    const i = db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id)
    if (!i) throw notFound()
    await stopIntegration(i.id)
    db.prepare('DELETE FROM integrations WHERE id = ?').run(i.id)
    invalidate()
    recordChange(req.user, 'integration', i.id, 'delete', i.name)
    return { ok: true }
  })

  app.get('/devices', {
    schema: tD('List devices', { querystring: { type: 'object', properties: { room_id: { type: 'integer' }, adopted: { type: 'boolean' }, integration_id: { type: 'integer' } } } }),
    preHandler: view,
  }, async req => {
    const where = ['hidden = 0']
    const args = []
    if (req.query.room_id !== undefined) { where.push('room_id = ?'); args.push(req.query.room_id) }
    if (req.query.adopted !== undefined) { where.push('adopted = ?'); args.push(Number(req.query.adopted)) }
    if (req.query.integration_id !== undefined) { where.push('integration_id = ?'); args.push(req.query.integration_id) }
    return db.prepare(`SELECT * FROM devices WHERE ${where.join(' AND ')} ORDER BY name`).all(...args).map(withLive)
  })

  app.get('/devices/:id', { schema: tD('Get device'), preHandler: view }, async req => {
    const r = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id)
    if (!r) throw notFound()
    return withLive(r)
  })

  app.post('/devices', {
    schema: tD('Create manual device (REST integrations)', { body: { type: 'object', required: ['integration_id', 'name', 'meta'], properties: { integration_id: { type: 'integer' }, name: { type: 'string', maxLength: 80 }, room_id: { type: ['integer', 'null'] }, meta: { type: 'object' } } } }),
    preHandler: manage,
  }, async req => {
    const i = integrationRow(db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.body.integration_id))
    if (!i || !ADAPTERS[i.adapter]?.manualDevices) throw badRequest('integration.no_manual_devices')
    const m = req.body.meta
    if (!m.state_url) throw badRequest('validation')
    const def = restDefinition(m)
    const id = db.prepare(`INSERT INTO devices (integration_id, native_id, name, type, capabilities, meta, room_id, adopted)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(i.id, `manual-${Date.now()}`, req.body.name, def.type, JSON.stringify(def.capabilities), JSON.stringify(m), req.body.room_id ?? null).lastInsertRowid
    recordChange(req.user, 'device', id, 'create', req.body.name)
    startIntegration(i.id)
    return withLive(db.prepare('SELECT * FROM devices WHERE id = ?').get(id))
  })

  app.put('/devices/:id', {
    schema: tD('Rename / assign room / groups / adopt / hide', { body: { type: 'object', properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 }, room_id: { type: ['integer', 'null'] }, type: { type: 'string', enum: DEVICE_TYPES },
      groups: { type: 'array', items: { type: 'string', maxLength: 40 } }, adopted: { type: 'boolean' }, hidden: { type: 'boolean' },
    } } }),
    preHandler: manage,
  }, async req => {
    const d = deviceRow(db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id))
    if (!d) throw notFound()
    const b = req.body
    let room = b.room_id === undefined ? d.room_id : b.room_id
    if (b.adopted && !d.adopted && room == null && d.meta.area) room = roomByName(d.meta.area)
    db.prepare('UPDATE devices SET name = ?, room_id = ?, type = ?, groups = ?, adopted = ?, hidden = ? WHERE id = ?').run(
      b.name ?? d.name, room, b.type ?? d.type, JSON.stringify(b.groups ?? d.groups),
      Number(b.adopted ?? d.adopted), Number(b.hidden ?? d.hidden), d.id)
    invalidate(d.id)
    recordChange(req.user, 'device', d.id, b.adopted && !d.adopted ? 'adopt' : 'update', b.name ?? d.name)
    return withLive(db.prepare('SELECT * FROM devices WHERE id = ?').get(d.id))
  })

  app.post('/devices/adopt', {
    schema: tD('Adopt several discovered devices', { body: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } }, rooms_from_area: { type: 'boolean' } } } }),
    preHandler: manage,
  }, async req => {
    let n = 0
    for (const id of req.body.ids) {
      const d = deviceRow(db.prepare('SELECT * FROM devices WHERE id = ? AND adopted = 0').get(id))
      if (!d) continue
      const room = d.room_id ?? (req.body.rooms_from_area !== false ? roomByName(d.meta.area) : null)
      db.prepare('UPDATE devices SET adopted = 1, room_id = ? WHERE id = ?').run(room, d.id)
      invalidate(d.id)
      n++
    }
    if (n) recordChange(req.user, 'device', null, 'adopt', `${n}`)
    return { adopted: n }
  })

  app.delete('/devices/:id', { schema: tD('Remove device (re-discovered devices reappear as new)'), preHandler: manage }, async req => {
    const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id)
    if (!d) throw notFound()
    db.prepare('DELETE FROM devices WHERE id = ?').run(d.id)
    invalidate(d.id)
    recordChange(req.user, 'device', d.id, 'delete', d.name)
    return { ok: true }
  })

  app.post('/devices/:id/command', {
    schema: tD('Send command to a capability', { body: { type: 'object', required: ['capability', 'value'], properties: { capability: { type: 'string' }, value: {} } } }),
    preHandler: requirePerm('devices.control'),
  }, async req => {
    const r = await commandDevice(req.params.id, req.body.capability, req.body.value, req.user)
    if (r.error === 'not_found') throw notFound()
    if (r.error) throw new HttpError(r.error === 'device.command_failed' ? 502 : 422, r.error, { message: r.message })
    return r
  })

  app.get('/devices/meta/registry', { schema: tD('Device types, capability kinds, adapters') , preHandler: view }, async () => ({
    types: DEVICE_TYPES, capabilities: CAPABILITY_KINDS,
    adapters: Object.fromEntries(Object.entries(ADAPTERS).map(([k, A]) => [k, { fields: A.fields, manualDevices: !!A.manualDevices }])),
    restDeviceFields: REST_DEVICE_FIELDS,
  }))

  app.get('/events', { websocket: true, schema: { tags: ['events'], summary: 'Live events (device.state, device.discovered, integration.status)' }, config: { public: true } }, (socket, req) => {
    const user = userFromToken(req.cookies.homeos_session)
    if (!user || !can(user, 'devices.view')) return socket.close(4401, 'unauthorized')
    const send = type => payload => socket.readyState === 1 && socket.send(JSON.stringify({ type, payload }))
    const handlers = { 'device.state': send('device.state'), 'device.discovered': send('device.discovered'), 'integration.status': send('integration.status'), 'config.changed': send('config.changed') }
    for (const [e, h] of Object.entries(handlers)) bus.on(e, h)
    const ping = setInterval(() => socket.readyState === 1 && socket.ping(), 30000)
    socket.on('close', () => {
      clearInterval(ping)
      for (const [e, h] of Object.entries(handlers)) bus.off(e, h)
    })
  })

  bus.on('device.discovered', d => log('devices', 'info', 'device.discovered', { device: d.name }))
}
