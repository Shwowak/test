import { getDevice, deviceHistory } from '../devices/engine.js'
import { fetchMail } from './imap.js'
export const SOURCE_TYPES = {
  static: { fields: [] },
  rest_json: {
    fields: [
      { key: 'url', type: 'url', required: true },
      { key: 'headers', type: 'json' },
    ],
  },
  home_assistant: {
    fields: [
      { key: 'url', type: 'url', required: true },
      { key: 'token', type: 'secret', required: true },
    ],
  },
  ical: {
    fields: [{ key: 'url', type: 'url', required: true }],
  },
  imap: {
    fields: [
      { key: 'host', type: 'text', required: true },
      { key: 'port', type: 'text' },
      { key: 'user', type: 'text', required: true },
      { key: 'password', type: 'secret', required: true },
      { key: 'tls', type: 'select', options: ['yes', 'no'] },
      { key: 'folder', type: 'text' },
    ],
  },
}

const SECRET_KEYS = Object.values(SOURCE_TYPES).flatMap(t => t.fields.filter(f => f.type === 'secret').map(f => f.key))

export function redact(config) {
  const out = { ...config }
  for (const k of SECRET_KEYS) if (out[k]) out[k] = '••••••'
  return out
}

export function mergeSecrets(next, prev) {
  const out = { ...next }
  for (const k of SECRET_KEYS) if (out[k] === '••••••') out[k] = prev[k]
  return out
}

const cache = new Map()

async function fetchCached(key, ttlMs, fn) {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const value = await fn()
  cache.set(key, { value, expires: Date.now() + ttlMs })
  return value
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function pick(obj, path) {
  if (!path) return obj
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function parseIcalDate(v) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/)
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`
  return { date: new Date(iso), allDay: !m[4] }
}

export function parseIcal(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/)
  const events = []
  let ev = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {}
    else if (line === 'END:VEVENT') { if (ev?.start) events.push(ev); ev = null }
    else if (ev) {
      const i = line.indexOf(':')
      const key = line.slice(0, i).split(';')[0]
      const val = line.slice(i + 1)
      if (key === 'SUMMARY') ev.title = val.replace(/\\,/g, ',').replace(/\\n/g, ' ')
      if (key === 'LOCATION') ev.location = val.replace(/\\,/g, ',')
      if (key === 'DTSTART') { const p = parseIcalDate(val); if (p) { ev.start = p.date.toISOString(); ev.allDay = p.allDay } }
      if (key === 'DTEND') { const p = parseIcalDate(val); if (p) ev.end = p.date.toISOString() }
      if (key === 'RRULE') ev.rrule = Object.fromEntries(val.split(';').map(x => x.split('=')))
      if (key === 'EXDATE') for (const d of val.split(',')) { const p = parseIcalDate(d); if (p) (ev.exdates ??= []).push(p.date.getTime()) }
      if (key === 'RECURRENCE-ID') ev.recurrence = true
    }
  }
  return events
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

export function expandEvents(events, from, to) {
  const out = []
  for (const e of events) {
    const start = Date.parse(e.start)
    const dur = e.end ? Date.parse(e.end) - start : 0
    if (!e.rrule) { if (start + dur >= from && start <= to) out.push(e); continue }
    const r = e.rrule
    const interval = Number(r.INTERVAL) || 1
    const until = r.UNTIL ? parseIcalDate(r.UNTIL)?.date.getTime() ?? to : to
    const count = Number(r.COUNT) || Infinity
    const byday = r.BYDAY ? r.BYDAY.split(',').map(d => DAYS[d.slice(-2)]) : null
    const ex = new Set(e.exdates ?? [])
    let n = 0
    const push = t => {
      n++
      if (t + dur >= from && t <= to && !ex.has(t)) out.push({ ...e, rrule: undefined, exdates: undefined, start: new Date(t).toISOString(), end: e.end ? new Date(t + dur).toISOString() : undefined })
    }
    const d = new Date(start)
    for (let i = 0; i < 5000 && n < count; i++) {
      const t = d.getTime()
      if (t > until || t > to) break
      if (r.FREQ === 'WEEKLY' && byday) {
        const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay())
        for (const wd of byday.sort()) {
          const x = new Date(weekStart); x.setDate(weekStart.getDate() + wd)
          const xt = x.getTime()
          if (xt >= start && xt <= until && n < count) push(xt)
        }
        d.setDate(d.getDate() + 7 * interval)
        continue
      }
      push(t)
      if (r.FREQ === 'DAILY') d.setDate(d.getDate() + interval)
      else if (r.FREQ === 'WEEKLY') d.setDate(d.getDate() + 7 * interval)
      else if (r.FREQ === 'MONTHLY') d.setMonth(d.getMonth() + interval)
      else if (r.FREQ === 'YEARLY') d.setFullYear(d.getFullYear() + interval)
      else break
    }
  }
  return out
}

export async function resolve(widget, source) {
  const wc = widget.config
  if (wc.device_id && wc.capability) {
    const d = getDevice(wc.device_id)
    if (!d) throw new Error('device not found')
    const c = d.capabilities.find(x => x.id === wc.capability)
    const unit = wc.unit || c?.unit || ''
    if (widget.type === 'chart') {
      const h = deviceHistory(d.id, wc.capability, Number(wc.range) || 24)
      const v = d.state[wc.capability]
      return { values: h.length > 1 ? h : typeof v === 'number' ? [v, v] : h, unit }
    }
    return { value: d.state[wc.capability] ?? null, unit, offline: d.connection === 'offline' }
  }
  if (!source || source.type === 'static') {
    return { value: wc.value ?? null, values: wc.values ?? null, unit: wc.unit ?? '' }
  }
  const sc = source.config
  if (source.type === 'rest_json') {
    const data = await fetchCached(`rest:${source.id}`, (wc.refresh ?? 30) * 1000, () => getJson(sc.url, sc.headers ?? {}))
    const v = pick(data, wc.path)
    return Array.isArray(v) ? { values: v.map(Number), unit: wc.unit ?? '' } : { value: v, unit: wc.unit ?? '' }
  }
  if (source.type === 'home_assistant') {
    if (!wc.entity_id) throw new Error('entity_id missing')
    const base = sc.url.replace(/\/$/, '')
    const st = await fetchCached(`ha:${source.id}:${wc.entity_id}`, 5000, () =>
      getJson(`${base}/api/states/${encodeURIComponent(wc.entity_id)}`, { Authorization: `Bearer ${sc.token}` }))
    return { value: isNaN(Number(st.state)) ? st.state : Number(st.state), unit: wc.unit || st.attributes?.unit_of_measurement || '', label: st.attributes?.friendly_name }
  }
  if (source.type === 'ical') {
    const text = await fetchCached(`ical:${source.id}`, 5 * 60 * 1000, async () => {
      const res = await fetch(String(sc.url).trim().replace(/^webcals?:\/\//i, 'https://'), { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'SmartBoard/1.0' } })
      if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? `HTTP ${res.status} – Kalender-Adresse ungültig oder nicht freigegeben (geheime iCal-Adresse verwenden)` : `HTTP ${res.status}`)
      return res.text()
    })
    const now = Date.now() - 60 * 60 * 1000
    const events = expandEvents(parseIcal(text), now, Date.now() + 90 * 86400000)
      .sort((a, b) => a.start.localeCompare(b.start)).slice(0, wc.limit ?? 8)
    return { events }
  }
  if (source.type === 'imap') {
    return fetchCached(`imap:${source.id}:${wc.limit ?? 6}`, 2 * 60 * 1000, () => fetchMail(sc, Number(wc.limit) || 6))
  }
  throw new Error(`unknown source type ${source.type}`)
}

export async function callService(source, domain, service, data) {
  if (source?.type !== 'home_assistant') throw new Error('switch requires home_assistant')
  const base = source.config.url.replace(/\/$/, '')
  const res = await fetch(`${base}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${source.config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  cache.clear()
}
