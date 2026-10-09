import { Readable } from 'node:stream'
import { db } from '../core/db.js'
import { notFound, requirePerm, HttpError } from '../core/http.js'
import { getSetting, setSetting } from '../core/settings.js'
import { recordChange } from '../core/versions.js'
import { log } from '../core/logger.js'

const go2rtcUrl = () => {
  const u = getSetting('go2rtc')?.url || process.env.SMARTBOARD_GO2RTC_URL || (process.env.SMARTBOARD_HAL === '1' ? 'http://127.0.0.1:1984' : '')
  return u.replace(/\/$/, '')
}
const streamName = id => `sb_${id}`
const kindOf = source => /^https?:\/\//i.test(source) ? (/mjpe?g|video\.cgi|stream/i.test(source) ? 'mjpeg' : 'snapshot') : 'stream'
const redact = source => source.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:••••@')
const cameraRow = (r, full = false) => r && { id: r.id, name: r.name, kind: r.kind, room_id: r.room_id, enabled: !!r.enabled, sort: r.sort, source: full ? r.source : redact(r.source) }

async function register(cam) {
  const g = go2rtcUrl()
  if (!g || cam.kind !== 'stream') return
  const url = `${g}/api/streams?name=${encodeURIComponent(streamName(cam.id))}&src=${encodeURIComponent(cam.source)}`
  const r = await fetch(url, { method: 'PUT', signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error(`go2rtc ${r.status}`)
}

export async function syncCameras() {
  for (const c of db.prepare("SELECT * FROM cameras WHERE enabled = 1 AND kind = 'stream'").all()) {
    try { await register(c) } catch (e) { log('cameras', 'warning', 'camera.register_failed', { camera: c.name, error: e.message }) }
  }
}

function guard() {
  if (!getSetting('privacy')?.cameras) throw new HttpError(403, 'privacy.cameras_off')
}

async function upstream(cam, live) {
  if (cam.kind === 'stream') {
    const g = go2rtcUrl()
    if (!g) throw new HttpError(409, 'cameras.no_go2rtc')
    return `${g}/api/${live ? 'stream.mjpeg' : 'frame.jpeg'}?src=${encodeURIComponent(streamName(cam.id))}`
  }
  if (live && cam.kind !== 'mjpeg') return null
  return cam.source
}

export default async function camerasModule(app) {
  const s = (summary, extra = {}) => ({ tags: ['cameras'], summary, ...extra })
  const body = { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, source: { type: 'string', minLength: 4, maxLength: 1000 }, room_id: { type: ['integer', 'null'] }, enabled: { type: 'boolean' }, sort: { type: 'integer' } } }

  app.get('/cameras', { schema: s('List cameras'), preHandler: requirePerm('cameras.view') }, async () => ({
    enabled: !!getSetting('privacy')?.cameras, go2rtc: go2rtcUrl() || null,
    cameras: db.prepare('SELECT * FROM cameras ORDER BY sort, name').all().map(r => cameraRow(r)),
  }))

  app.put('/cameras/settings', { schema: s('go2rtc URL', { body: { type: 'object', properties: { go2rtc: { type: 'string', maxLength: 300 } } } }), preHandler: requirePerm('cameras.manage') }, async req => {
    setSetting('go2rtc', { url: req.body.go2rtc ?? '' })
    await syncCameras()
    return { ok: true }
  })

  app.post('/cameras', { schema: s('Add camera (rtsp://, rtmp://, onvif://, homekit://, ffmpeg:… via go2rtc; http(s) snapshot or MJPEG URL directly)', { body: { ...body, required: ['name', 'source'] } }), preHandler: requirePerm('cameras.manage') }, async req => {
    const b = req.body
    const id = db.prepare('INSERT INTO cameras (name, source, kind, room_id, enabled, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b.name, b.source, kindOf(b.source), b.room_id ?? null, b.enabled === false ? 0 : 1, b.sort ?? 0).lastInsertRowid
    const cam = db.prepare('SELECT * FROM cameras WHERE id = ?').get(id)
    recordChange(req.user, 'camera', id, 'create', b.name)
    try { await register(cam) } catch (e) { log('cameras', 'warning', 'camera.register_failed', { camera: cam.name, error: e.message }) }
    return cameraRow(cam)
  })

  app.put('/cameras/:id', { schema: s('Update camera', { body }), preHandler: requirePerm('cameras.manage') }, async req => {
    const cur = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id)
    if (!cur) throw notFound()
    const b = { ...cur, ...req.body }
    if (req.body.source?.includes('••••')) b.source = cur.source
    db.prepare('UPDATE cameras SET name = ?, source = ?, kind = ?, room_id = ?, enabled = ?, sort = ? WHERE id = ?')
      .run(b.name, b.source, kindOf(b.source), b.room_id ?? null, b.enabled ? 1 : 0, b.sort ?? 0, cur.id)
    const cam = db.prepare('SELECT * FROM cameras WHERE id = ?').get(cur.id)
    recordChange(req.user, 'camera', cur.id, 'update', cam.name)
    try { await register(cam) } catch {}
    return cameraRow(cam)
  })

  app.delete('/cameras/:id', { schema: s('Remove camera'), preHandler: requirePerm('cameras.manage') }, async req => {
    const cur = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id)
    if (!cur) throw notFound()
    db.prepare('DELETE FROM cameras WHERE id = ?').run(cur.id)
    recordChange(req.user, 'camera', cur.id, 'delete', cur.name)
    const g = go2rtcUrl()
    if (g && cur.kind === 'stream') fetch(`${g}/api/streams?src=${encodeURIComponent(streamName(cur.id))}`, { method: 'DELETE' }).catch(() => {})
    return { ok: true }
  })

  const proxy = live => async (req, reply) => {
    guard()
    const cam = db.prepare('SELECT * FROM cameras WHERE id = ? AND enabled = 1').get(req.params.id)
    if (!cam) throw notFound()
    const url = await upstream(cam, live)
    if (!url) throw new HttpError(409, 'cameras.no_live')
    const ctrl = new AbortController()
    req.raw.on('close', () => ctrl.abort())
    let r
    try {
      const u = new URL(url)
      const headers = {}
      if (u.username) { headers.authorization = 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64'); u.username = ''; u.password = '' }
      r = await fetch(u, { headers, signal: live ? ctrl.signal : AbortSignal.timeout(10000) })
    } catch (e) {
      throw new HttpError(502, 'cameras.unreachable', { message: e.message })
    }
    if (!r.ok || !r.body) throw new HttpError(502, 'cameras.unreachable', { message: `HTTP ${r.status}` })
    reply.header('cache-control', 'no-store').type(r.headers.get('content-type') ?? (live ? 'multipart/x-mixed-replace' : 'image/jpeg'))
    return reply.send(Readable.fromWeb(r.body))
  }

  app.get('/cameras/:id/snapshot', { schema: s('Current image (JPEG)'), preHandler: requirePerm('cameras.view') }, proxy(false))
  app.get('/cameras/:id/live', { schema: s('Live MJPEG stream'), preHandler: requirePerm('cameras.view') }, proxy(true))
}
