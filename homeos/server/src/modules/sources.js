import { db, json } from '../core/db.js'
import { notFound, badRequest, requirePerm } from '../core/http.js'
import { recordChange } from '../core/versions.js'
import { SOURCE_TYPES, redact, mergeSecrets } from './sources-adapters.js'

const sourceRow = r => r && { ...r, config: json(r.config) }
const body = { type: 'object', properties: { name: { type: 'string', maxLength: 80 }, type: { type: 'string' }, config: { type: 'object' } } }

export default async function sourcesModule(app) {
  const t = (summary, extra = {}) => ({ tags: ['sources'], summary, ...extra })
  const edit = requirePerm('sources.edit')

  app.get('/sources', { schema: t('List data sources (secrets redacted)'), preHandler: requirePerm('sources.view') }, async () =>
    db.prepare('SELECT * FROM data_sources ORDER BY name').all().map(sourceRow).map(s => ({ ...s, config: redact(s.config) })))

  app.post('/sources', { schema: t('Create data source', { body: { ...body, required: ['type'] } }), preHandler: edit }, async req => {
    const { name, type, config } = req.body
    if (!SOURCE_TYPES[type] || type === 'static') throw badRequest('source.type_invalid')
    const id = db.prepare('INSERT INTO data_sources (name, type, config) VALUES (?, ?, ?)').run(String(name || type), type, JSON.stringify(config ?? {})).lastInsertRowid
    recordChange(req.user, 'source', id, 'create', name || type)
    return { id }
  })

  app.put('/sources/:id', { schema: t('Update data source', { body }), preHandler: edit }, async req => {
    const s = sourceRow(db.prepare('SELECT * FROM data_sources WHERE id = ?').get(req.params.id))
    if (!s) throw notFound()
    const { name, config } = req.body
    db.prepare('UPDATE data_sources SET name = ?, config = ? WHERE id = ?').run(String(name ?? s.name), JSON.stringify(mergeSecrets(config ?? {}, s.config)), s.id)
    recordChange(req.user, 'source', s.id, 'update', name ?? s.name)
    return { ok: true }
  })

  app.delete('/sources/:id', { schema: t('Delete data source'), preHandler: edit }, async req => {
    const s = db.prepare('SELECT * FROM data_sources WHERE id = ?').get(req.params.id)
    if (!s) throw notFound()
    db.prepare('DELETE FROM data_sources WHERE id = ?').run(s.id)
    recordChange(req.user, 'source', s.id, 'delete', s.name)
    return { ok: true }
  })
}
