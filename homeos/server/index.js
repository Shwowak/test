import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import staticFiles from '@fastify/static'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, seed, verifyPassword } from './db.js'
import { SOURCE_TYPES, redact, mergeSecrets, resolve, callService } from './sources.js'

export const WIDGET_TYPES = {
  clock: { label: 'Uhr & Datum', sources: [], fields: [] },
  text: { label: 'Text / Notiz', sources: [], fields: [{ key: 'text', label: 'Text', type: 'textarea' }] },
  kpi: {
    label: 'Wert (KPI)', sources: ['static', 'rest_json', 'home_assistant'],
    fields: [
      { key: 'value', label: 'Wert (bei festem Wert)', type: 'text', static: true },
      { key: 'path', label: 'JSON-Pfad (z. B. data.temp)', type: 'text', for: ['rest_json'] },
      { key: 'entity_id', label: 'Entity-ID (z. B. sensor.wohnzimmer_temp)', type: 'text', for: ['home_assistant'] },
      { key: 'unit', label: 'Einheit', type: 'text' },
      { key: 'decimals', label: 'Nachkommastellen', type: 'number' },
      { key: 'color', label: 'Farbe', type: 'color' },
    ],
  },
  gauge: {
    label: 'Anzeige (Gauge)', sources: ['static', 'rest_json', 'home_assistant'],
    fields: [
      { key: 'value', label: 'Wert (bei festem Wert)', type: 'number', static: true },
      { key: 'path', label: 'JSON-Pfad', type: 'text', for: ['rest_json'] },
      { key: 'entity_id', label: 'Entity-ID', type: 'text', for: ['home_assistant'] },
      { key: 'min', label: 'Minimum', type: 'number' },
      { key: 'max', label: 'Maximum', type: 'number' },
      { key: 'unit', label: 'Einheit', type: 'text' },
      { key: 'color', label: 'Farbe', type: 'color' },
    ],
  },
  chart: {
    label: 'Diagramm', sources: ['static', 'rest_json'],
    fields: [
      { key: 'values', label: 'Werte, kommagetrennt (bei festem Wert)', type: 'list', static: true },
      { key: 'path', label: 'JSON-Pfad zu einer Zahlenliste', type: 'text', for: ['rest_json'] },
      { key: 'style', label: 'Darstellung', type: 'select', options: { line: 'Linie (Neon)', wave: 'Doppelwelle', bar: 'Balken', spectrum: 'Spektrum (bunt)' } },
      { key: 'unit', label: 'Einheit', type: 'text' },
      { key: 'color', label: 'Farbe', type: 'color' },
    ],
  },
  calendar: {
    label: 'Termine', sources: ['ical'],
    fields: [{ key: 'limit', label: 'Anzahl Termine', type: 'number' }],
  },
  switch: {
    label: 'Schalter', sources: ['home_assistant'],
    fields: [{ key: 'entity_id', label: 'Entity-ID (z. B. light.kueche)', type: 'text', for: ['home_assistant'] }],
  },
  iframe: { label: 'Webseite einbetten', sources: [], fields: [{ key: 'url', label: 'URL', type: 'url' }] },
}

seed()

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
await app.register(cookie)

const SESSION_DAYS = 30
const secure = process.env.HOMEOS_SECURE_COOKIE === 'true'

const json = s => JSON.parse(s || '{}')
const widgetRow = r => r && { ...r, config: json(r.config) }
const sourceRow = r => r && { ...r, config: json(r.config) }

function currentUser(req) {
  const token = req.cookies.homeos_session
  if (!token) return null
  return db.prepare(`SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now()) ?? null
}

app.addHook('preHandler', async (req, reply) => {
  if (!req.url.startsWith('/api/') || req.url === '/api/login') return
  const user = currentUser(req)
  if (!user) return reply.code(401).send({ error: 'Nicht angemeldet' })
  req.user = user
})

app.post('/api/login', async (req, reply) => {
  const { name, password } = req.body ?? {}
  const user = db.prepare('SELECT * FROM users WHERE name = ?').get(String(name ?? ''))
  if (!user || !verifyPassword(String(password ?? ''), user.password)) {
    await new Promise(r => setTimeout(r, 500))
    return reply.code(401).send({ error: 'Benutzer oder Passwort falsch' })
  }
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, Date.now() + SESSION_DAYS * 864e5)
  reply.setCookie('homeos_session', token, { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: SESSION_DAYS * 86400 })
  return { id: user.id, name: user.name, role: user.role }
})

app.post('/api/logout', async (req, reply) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.homeos_session)
  reply.clearCookie('homeos_session', { path: '/' })
  return { ok: true }
})

app.get('/api/me', async req => req.user)

app.get('/api/meta', async () => ({ widgetTypes: WIDGET_TYPES, sourceTypes: SOURCE_TYPES }))

app.get('/api/dashboards', async () => db.prepare('SELECT * FROM dashboards ORDER BY position, id').all())

app.post('/api/dashboards', async req => {
  const { name, icon } = req.body ?? {}
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM dashboards').get().p
  const id = db.prepare('INSERT INTO dashboards (name, icon, position) VALUES (?, ?, ?)').run(String(name || 'Neues Dashboard'), String(icon || '◈'), pos).lastInsertRowid
  return db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id)
})

app.put('/api/dashboards/:id', async (req, reply) => {
  const { name, icon, position } = req.body ?? {}
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id)
  if (!d) return reply.code(404).send({ error: 'Nicht gefunden' })
  db.prepare('UPDATE dashboards SET name = ?, icon = ?, position = ? WHERE id = ?').run(String(name ?? d.name), String(icon ?? d.icon), Number(position ?? d.position), d.id)
  return db.prepare('SELECT * FROM dashboards WHERE id = ?').get(d.id)
})

app.delete('/api/dashboards/:id', async req => {
  db.prepare('DELETE FROM dashboards WHERE id = ?').run(req.params.id)
  return { ok: true }
})

app.get('/api/dashboards/:id/widgets', async req =>
  db.prepare('SELECT * FROM widgets WHERE dashboard_id = ? ORDER BY y, x').all(req.params.id).map(widgetRow))

function validWidget(body) {
  if (!WIDGET_TYPES[body.type]) throw Object.assign(new Error('Unbekannter Widget-Typ'), { statusCode: 422 })
}

app.post('/api/dashboards/:id/widgets', async req => {
  const b = req.body ?? {}
  validWidget(b)
  const id = db.prepare(`INSERT INTO widgets (dashboard_id, type, title, x, y, w, h, source_id, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.params.id, b.type, String(b.title ?? ''), b.x ?? 0, b.y ?? 99, b.w ?? 3, b.h ?? 2, b.source_id ?? null, JSON.stringify(b.config ?? {})).lastInsertRowid
  return widgetRow(db.prepare('SELECT * FROM widgets WHERE id = ?').get(id))
})

app.put('/api/widgets/:id', async (req, reply) => {
  const w = widgetRow(db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id))
  if (!w) return reply.code(404).send({ error: 'Nicht gefunden' })
  const b = { ...w, ...(req.body ?? {}) }
  validWidget(b)
  db.prepare('UPDATE widgets SET type = ?, title = ?, x = ?, y = ?, w = ?, h = ?, source_id = ?, config = ? WHERE id = ?')
    .run(b.type, String(b.title), b.x, b.y, b.w, b.h, b.source_id ?? null, JSON.stringify(b.config ?? {}), w.id)
  return widgetRow(db.prepare('SELECT * FROM widgets WHERE id = ?').get(w.id))
})

app.put('/api/dashboards/:id/layout', async req => {
  const upd = db.prepare('UPDATE widgets SET x = ?, y = ?, w = ?, h = ? WHERE id = ? AND dashboard_id = ?')
  for (const i of req.body ?? []) upd.run(i.x, i.y, i.w, i.h, i.id, req.params.id)
  return { ok: true }
})

app.delete('/api/widgets/:id', async req => {
  db.prepare('DELETE FROM widgets WHERE id = ?').run(req.params.id)
  return { ok: true }
})

app.get('/api/widgets/:id/data', async (req, reply) => {
  const w = widgetRow(db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id))
  if (!w) return reply.code(404).send({ error: 'Nicht gefunden' })
  const s = w.source_id ? sourceRow(db.prepare('SELECT * FROM data_sources WHERE id = ?').get(w.source_id)) : null
  try {
    return await resolve(w, s)
  } catch (e) {
    return reply.code(502).send({ error: e.message })
  }
})

app.post('/api/widgets/:id/action', async (req, reply) => {
  const w = widgetRow(db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id))
  if (!w || w.type !== 'switch') return reply.code(404).send({ error: 'Nicht gefunden' })
  const s = sourceRow(db.prepare('SELECT * FROM data_sources WHERE id = ?').get(w.source_id))
  const domain = w.config.entity_id.split('.')[0]
  try {
    await callService(s, domain, 'toggle', { entity_id: w.config.entity_id })
    return { ok: true }
  } catch (e) {
    return reply.code(502).send({ error: e.message })
  }
})

app.get('/api/sources', async () =>
  db.prepare('SELECT * FROM data_sources ORDER BY name').all().map(sourceRow).map(s => ({ ...s, config: redact(s.config) })))

app.post('/api/sources', async (req, reply) => {
  const { name, type, config } = req.body ?? {}
  if (!SOURCE_TYPES[type]) return reply.code(422).send({ error: 'Unbekannter Quellentyp' })
  const id = db.prepare('INSERT INTO data_sources (name, type, config) VALUES (?, ?, ?)').run(String(name || type), type, JSON.stringify(config ?? {})).lastInsertRowid
  return { id }
})

app.put('/api/sources/:id', async (req, reply) => {
  const s = sourceRow(db.prepare('SELECT * FROM data_sources WHERE id = ?').get(req.params.id))
  if (!s) return reply.code(404).send({ error: 'Nicht gefunden' })
  const { name, config } = req.body ?? {}
  db.prepare('UPDATE data_sources SET name = ?, config = ? WHERE id = ?').run(String(name ?? s.name), JSON.stringify(mergeSecrets(config ?? {}, s.config)), s.id)
  return { ok: true }
})

app.delete('/api/sources/:id', async req => {
  db.prepare('DELETE FROM data_sources WHERE id = ?').run(req.params.id)
  return { ok: true }
})

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')
if (existsSync(webDir)) {
  await app.register(staticFiles, { root: webDir })
  app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Nicht gefunden' }) : reply.sendFile('index.html'))
}

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) })
