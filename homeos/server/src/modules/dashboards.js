import { db, json } from '../core/db.js'
import { notFound, badRequest, requirePerm, HttpError } from '../core/http.js'
import { recordChange } from '../core/versions.js'
import { log } from '../core/logger.js'
import { WIDGET_TYPES, DASHBOARD_STYLES } from './registry.js'
import { resolve, callService } from './sources-adapters.js'
import { generate } from './autogen.js'

const widgetRow = r => r && { ...r, config: json(r.config) }
const sourceRow = r => r && { ...r, config: json(r.config) }
const styleOf = s => (DASHBOARD_STYLES.includes(s) ? s : 'seamless')
const getDashboard = id => db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id)
const getWidget = id => widgetRow(db.prepare('SELECT * FROM widgets WHERE id = ?').get(id))

const dashboardBody = {
  type: 'object',
  properties: { name: { type: 'string', maxLength: 60 }, icon: { type: 'string', maxLength: 8 }, style: { type: 'string' }, position: { type: 'integer' } },
}
const widgetBody = {
  type: 'object',
  properties: {
    type: { type: 'string' }, title: { type: 'string', maxLength: 80 },
    x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 },
    w: { type: 'integer', minimum: 1, maximum: 12 }, h: { type: 'integer', minimum: 1, maximum: 24 },
    source_id: { type: ['integer', 'null'] }, config: { type: 'object' },
  },
}

function validWidget(b) {
  if (!WIDGET_TYPES[b.type]) throw badRequest('widget.type_invalid')
}

export default async function dashboardsModule(app) {
  const view = requirePerm('dashboards.view')
  const edit = requirePerm('dashboards.edit')
  const t = (summary, extra = {}) => ({ tags: ['dashboards'], summary, ...extra })

  app.get('/dashboards', { schema: t('List dashboards'), preHandler: view }, async () =>
    db.prepare('SELECT * FROM dashboards ORDER BY position, id').all())

  app.post('/dashboards', { schema: t('Create dashboard', { body: dashboardBody }), preHandler: edit }, async req => {
    const { name, icon, style } = req.body
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM dashboards').get().p
    const id = db.prepare('INSERT INTO dashboards (name, icon, position, style) VALUES (?, ?, ?, ?)')
      .run(String(name || 'Dashboard'), String(icon || '◈'), pos, styleOf(style)).lastInsertRowid
    recordChange(req.user, 'dashboard', id, 'create', name)
    return getDashboard(id)
  })

  app.post('/dashboards/generate', {
    schema: t('Auto-create dashboards from devices and rooms', { body: { type: 'object', properties: { replace: { type: 'boolean' }, rooms: { type: 'boolean' }, dryRun: { type: 'boolean' } } } }),
    preHandler: [edit, requirePerm('devices.manage')],
  }, async req => {
    const r = generate(req.body ?? {})
    if (!req.body?.dryRun) recordChange(req.user, 'dashboard', r.first, 'create', 'auto')
    return r
  })

  app.put('/dashboards/:id', { schema: t('Update dashboard', { body: dashboardBody }), preHandler: edit }, async req => {
    const d = getDashboard(req.params.id)
    if (!d) throw notFound()
    const b = req.body
    db.prepare('UPDATE dashboards SET name = ?, icon = ?, position = ?, style = ? WHERE id = ?')
      .run(String(b.name ?? d.name), String(b.icon ?? d.icon), Number(b.position ?? d.position), styleOf(b.style ?? d.style), d.id)
    recordChange(req.user, 'dashboard', d.id, 'update', b.name ?? d.name)
    return getDashboard(d.id)
  })

  app.delete('/dashboards/:id', { schema: t('Delete dashboard'), preHandler: edit }, async req => {
    const d = getDashboard(req.params.id)
    if (!d) throw notFound()
    db.prepare('DELETE FROM dashboards WHERE id = ?').run(d.id)
    recordChange(req.user, 'dashboard', d.id, 'delete', d.name)
    return { ok: true }
  })

  app.get('/dashboards/:id/widgets', { schema: t('List widgets of a dashboard'), preHandler: view }, async req =>
    db.prepare('SELECT * FROM widgets WHERE dashboard_id = ? ORDER BY y, x').all(req.params.id).map(widgetRow))

  app.post('/dashboards/:id/widgets', { schema: t('Create widget', { body: { ...widgetBody, required: ['type'] } }), preHandler: edit }, async req => {
    if (!getDashboard(req.params.id)) throw notFound()
    const b = req.body
    validWidget(b)
    const id = db.prepare(`INSERT INTO widgets (dashboard_id, type, title, x, y, w, h, source_id, config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.params.id, b.type, String(b.title ?? ''), b.x ?? 0, b.y ?? 99, b.w ?? 3, b.h ?? 2, b.source_id ?? null, JSON.stringify(b.config ?? {})).lastInsertRowid
    recordChange(req.user, 'widget', id, 'create', b.title || b.type)
    return getWidget(id)
  })

  app.put('/widgets/:id', { schema: t('Update widget', { body: widgetBody }), preHandler: edit }, async req => {
    const w = getWidget(req.params.id)
    if (!w) throw notFound()
    const b = { ...w, ...req.body }
    validWidget(b)
    db.prepare('UPDATE widgets SET type = ?, title = ?, x = ?, y = ?, w = ?, h = ?, source_id = ?, config = ? WHERE id = ?')
      .run(b.type, String(b.title), b.x, b.y, b.w, b.h, b.source_id ?? null, JSON.stringify(b.config ?? {}), w.id)
    recordChange(req.user, 'widget', w.id, 'update', b.title || b.type)
    return getWidget(w.id)
  })

  app.put('/dashboards/:id/layout', {
    schema: t('Save widget positions', { body: { type: 'array', items: { type: 'object', required: ['id', 'x', 'y', 'w', 'h'], properties: { id: { type: 'integer' }, x: { type: 'integer' }, y: { type: 'integer' }, w: { type: 'integer' }, h: { type: 'integer' } } } } }),
    preHandler: edit,
  }, async req => {
    const upd = db.prepare('UPDATE widgets SET x = ?, y = ?, w = ?, h = ? WHERE id = ? AND dashboard_id = ?')
    for (const i of req.body) upd.run(i.x, i.y, i.w, i.h, i.id, req.params.id)
    recordChange(req.user, 'dashboard', Number(req.params.id), 'layout')
    return { ok: true }
  })

  app.delete('/widgets/:id', { schema: t('Delete widget'), preHandler: edit }, async req => {
    const w = getWidget(req.params.id)
    if (!w) throw notFound()
    db.prepare('DELETE FROM widgets WHERE id = ?').run(w.id)
    recordChange(req.user, 'widget', w.id, 'delete', w.title || w.type)
    return { ok: true }
  })

  app.get('/widgets/:id/data', { schema: t('Resolve widget data from its source'), preHandler: view }, async req => {
    const w = getWidget(req.params.id)
    if (!w) throw notFound()
    const s = w.source_id ? sourceRow(db.prepare('SELECT * FROM data_sources WHERE id = ?').get(w.source_id)) : null
    try {
      return await resolve(w, s)
    } catch (e) {
      throw new HttpError(502, 'source.failed', { message: e.message })
    }
  })

  app.post('/widgets/:id/action', { schema: t('Trigger widget action (toggle)'), preHandler: requirePerm('devices.control') }, async req => {
    const w = getWidget(req.params.id)
    if (!w || w.type !== 'switch') throw notFound()
    const s = sourceRow(db.prepare('SELECT * FROM data_sources WHERE id = ?').get(w.source_id))
    try {
      await callService(s, w.config.entity_id.split('.')[0], 'toggle', { entity_id: w.config.entity_id })
    } catch (e) {
      log('devices', 'error', 'device.action_failed', { entity: w.config.entity_id, message: e.message }, req.user.id)
      throw new HttpError(502, 'source.failed', { message: e.message })
    }
    log('devices', 'info', 'device.toggled', { entity: w.config.entity_id }, req.user.id)
    return { ok: true }
  })
}
