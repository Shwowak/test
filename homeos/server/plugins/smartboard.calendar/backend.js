const COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa']
let events = []
let stop = null
const reminded = new Set()

function tzOffset(ms, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).map(x => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms
  } catch { return 0 }
}

function parseDate(value, params, defTz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (!h || params.VALUE === 'DATE') return { ms: Date.UTC(+y, +mo - 1, +d), allDay: true }
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  if (z) return { ms: wall, allDay: false }
  const tz = params.TZID || defTz
  const guess = wall - tzOffset(wall, tz)
  return { ms: wall - tzOffset(guess, tz), allDay: false }
}

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

const unescape = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

function parseICS(text, defTz) {
  const out = []
  let cur = null
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue }
    if (line === 'END:VEVENT') { if (cur?.start) out.push(cur); cur = null; continue }
    if (!cur) continue
    const i = line.indexOf(':')
    if (i < 0) continue
    const [name, ...ps] = line.slice(0, i).split(';')
    const params = Object.fromEntries(ps.map(p => p.split('=')).map(([k, v]) => [k.toUpperCase(), (v ?? '').replace(/"/g, '')]))
    const value = line.slice(i + 1)
    switch (name.toUpperCase()) {
      case 'DTSTART': cur.start = parseDate(value, params, defTz); break
      case 'DTEND': cur.end = parseDate(value, params, defTz); break
      case 'DURATION': cur.duration = value; break
      case 'SUMMARY': cur.title = unescape(value); break
      case 'LOCATION': cur.location = unescape(value); break
      case 'UID': cur.uid = value; break
      case 'RRULE': cur.rrule = Object.fromEntries(value.split(';').map(p => p.split('='))); break
      case 'EXDATE': for (const v of value.split(',')) { const d = parseDate(v, params, defTz); if (d) cur.exdates.push(d.ms) } break
      case 'RECURRENCE-ID': cur.recurrenceId = parseDate(value, params, defTz)?.ms; break
      case 'STATUS': cur.status = value; break
    }
  }
  return out
}

function durationMs(ev) {
  if (ev.end) return ev.end.ms - ev.start.ms
  const m = /P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/.exec(ev.duration ?? '')
  if (m && ev.duration) return ((+m[1] || 0) * 7 * 86400 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000
  return ev.start.allDay ? 86400000 : 3600000
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function expand(ev, from, to) {
  const dur = durationMs(ev)
  const make = ms => ({ title: ev.title ?? '—', location: ev.location ?? null, start: ms, end: ms + dur, allDay: ev.start.allDay })
  if (!ev.rrule) return ev.start.ms < to && ev.start.ms + dur > from ? [make(ev.start.ms)] : []
  const r = ev.rrule
  const interval = Math.max(1, Number(r.INTERVAL) || 1)
  const count = r.COUNT ? Number(r.COUNT) : Infinity
  const until = r.UNTIL ? parseDate(r.UNTIL, {}, 'UTC')?.ms ?? Infinity : Infinity
  const byday = r.BYDAY ? r.BYDAY.split(',').map(x => DAYS.indexOf(x.slice(-2))).filter(x => x >= 0) : null
  const out = []
  const base = new Date(ev.start.ms)
  let n = 0
  for (let step = 0; step < 3000 && n < count; step++) {
    const d = new Date(base)
    if (r.FREQ === 'DAILY') d.setUTCDate(base.getUTCDate() + step * interval)
    else if (r.FREQ === 'WEEKLY') d.setUTCDate(base.getUTCDate() + step * 7 * interval)
    else if (r.FREQ === 'MONTHLY') d.setUTCMonth(base.getUTCMonth() + step * interval)
    else if (r.FREQ === 'YEARLY') d.setUTCFullYear(base.getUTCFullYear() + step * interval)
    else break
    const candidates = []
    if (r.FREQ === 'WEEKLY' && byday) {
      const weekStart = new Date(d)
      weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay())
      for (const wd of byday.sort()) { const c = new Date(weekStart); c.setUTCDate(weekStart.getUTCDate() + wd); if (c >= base) candidates.push(c.getTime()) }
    } else candidates.push(d.getTime())
    for (const ms of candidates) {
      if (ms > until || n >= count) break
      n++
      if (ms >= to) return out
      if (ms + dur > from && !ev.exdates.includes(ms)) out.push(make(ms))
    }
    if (d.getTime() > to) break
  }
  return out
}

function sources() {
  return (sdk.config.urls ?? []).map(String).map(s => s.trim()).filter(Boolean).map((s, i) => {
    const [a, b] = s.includes('|') ? s.split('|').map(x => x.trim()) : [null, s]
    return { name: a || new URL(b.replace(/^webcal:/, 'https:')).hostname, url: b.replace(/^webcal:/, 'https:'), color: COLORS[i % COLORS.length] }
  })
}

async function update() {
  const loc = await sdk.location()
  const from = Date.now() - 86400000
  const to = Date.now() + Math.max(1, Number(sdk.config.days) || 14) * 86400000
  const all = []
  const errors = []
  for (const src of sources()) {
    try {
      const r = await sdk.fetch(src.url, { timeout: 20000 })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const parsed = parseICS(await r.text(), loc.timezone)
      const overrides = new Set(parsed.filter(e => e.recurrenceId).map(e => e.uid + ':' + e.recurrenceId))
      for (const ev of parsed) {
        if (ev.status === 'CANCELLED') continue
        for (const o of expand(ev, from, to)) {
          if (!ev.recurrenceId && overrides.has(ev.uid + ':' + o.start)) continue
          all.push({ ...o, calendar: src.name, color: src.color })
        }
      }
    } catch (e) {
      errors.push({ calendar: src.name, error: e.message })
    }
  }
  events = all.sort((a, b) => a.start - b.start).slice(0, 500)
  await sdk.publish('events', { updated: new Date().toISOString(), timezone: loc.timezone, events, errors, calendars: sources().map(({ name, color }) => ({ name, color })) })
}

function remind() {
  const min = Number(sdk.config.remind) || 0
  if (!min || !sdk.permissions.includes('notifications')) return
  const now = Date.now()
  for (const e of events) {
    if (e.allDay) continue
    const key = e.title + e.start
    if (e.start - now <= min * 60000 && e.start > now && !reminded.has(key)) {
      reminded.add(key)
      const at = new Intl.DateTimeFormat(sdk.lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(e.start))
      sdk.notify({ level: 'info', title: e.title, message: `${at}${e.location ? ' · ' + e.location : ''} · ${e.calendar}` })
    }
  }
}

function schedule() {
  stop?.()
  stop = sdk.every(Math.max(5, Number(sdk.config.interval) || 15) * 60, update)
}

sdk.onConfig(schedule)
sdk.onAction('refresh', async () => { await update(); return events.length })
sdk.every(30, remind)
schedule()
