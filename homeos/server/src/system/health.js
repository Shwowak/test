import { monitorEventLoopDelay } from 'node:perf_hooks'
import { readFileSync, statfsSync } from 'node:fs'
import { loadavg, totalmem, freemem, cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { db } from '../core/db.js'
import { log } from '../core/logger.js'
import { notify } from '../core/notify.js'
import { getSetting } from '../core/settings.js'
import { run, has } from './exec.js'
import { displayConnected } from './setupnet.js'

const DATA = dirname(resolve(process.env.HOMEOS_DB ?? './data/homeos.db'))
const device = () => process.env.SMARTBOARD_HAL === '1'
const loop = monitorEventLoopDelay({ resolution: 20 })
loop.enable()

export const health = { samples: [], findings: [], fixes: [], slow: [] }
const notified = new Map()
const TEXT = {
  slow_core: d => `SmartBoard reagiert langsam (${d.ms} ms Verzögerung).`,
  low_memory: d => `Arbeitsspeicher fast voll (${d.pct} %).`,
  low_disk: d => `Speicherplatz fast voll (frei: ${d.free_mb} MB).`,
  hot: d => `Gerät ist heiß (${d.temp} °C) – Belüftung prüfen.`,
  undervoltage: () => 'Unterspannung – das Netzteil ist zu schwach. Offizielles Raspberry-Pi-Netzteil verwenden.',
  kiosk_down: () => 'Die Bildschirmanzeige läuft nicht – wird automatisch neu gestartet.',
}

const readNum = p => { try { return Number(readFileSync(p, 'utf8').trim()) } catch { return null } }

async function processMem(pattern) {
  try {
    const out = await run('ps', ['-eo', 'rss=,args='], { timeout: 4000 })
    return out.split('\n').filter(l => pattern.test(l)).reduce((n, l) => n + Number(l.trim().split(/\s+/)[0] || 0) * 1024, 0)
  } catch { return null }
}

async function serviceState(unit) {
  if (!device() || !has('systemctl')) return null
  try { return (await run('systemctl', ['is-active', unit], { timeout: 4000 })).trim() } catch (e) { return 'inactive' }
}

async function throttled() {
  if (!has('vcgencmd')) return null
  try { return parseInt((await run('vcgencmd', ['get_throttled'], { timeout: 3000 })).split('=')[1], 16) } catch { return null }
}

export async function sample() {
  const mem = { total: totalmem(), free: freemem(), process: process.memoryUsage().rss }
  let disk = null
  try { const f = statfsSync(DATA); disk = { total: f.blocks * f.bsize, free: f.bavail * f.bsize } } catch {}
  const s = {
    ts: Date.now(),
    loop_p99_ms: Math.round(loop.percentile(99) / 1e6),
    loop_max_ms: Math.round(loop.max / 1e6),
    load: loadavg()[0], cpus: cpus().length,
    mem, disk,
    temp: readNum('/sys/class/thermal/thermal_zone0/temp') / 1000 || null,
    throttled: await throttled(),
    browser_mem: device() ? await processMem(/chrom/i) : null,
    kiosk: await serviceState('smartboard-kiosk.service'),
    go2rtc: await serviceState('smartboard-go2rtc.service'),
  }
  loop.reset()
  health.samples.push(s)
  if (health.samples.length > 360) health.samples.shift()
  return s
}

function finding(id, level, data = {}, fix = null) {
  return { id, level, data, fix }
}

export function analyse(s) {
  const out = []
  const recent = health.samples.slice(-3)
  if (recent.length === 3 && recent.every(x => x.loop_p99_ms > 300)) out.push(finding('slow_core', 'warning', { ms: s.loop_p99_ms }, 'restart_plugins'))
  if (s.load > s.cpus * 1.5) out.push(finding('high_load', 'warning', { load: s.load.toFixed(2), cpus: s.cpus }))
  const memPct = 1 - s.mem.free / s.mem.total
  if (memPct > 0.92) out.push(finding('low_memory', 'error', { pct: Math.round(memPct * 100) }, device() ? 'restart_kiosk' : null))
  if (s.browser_mem && s.browser_mem > s.mem.total * 0.55) out.push(finding('browser_memory', 'warning', { mb: Math.round(s.browser_mem / 1048576) }, 'restart_kiosk'))
  if (s.disk && s.disk.free / s.disk.total < 0.05) out.push(finding('low_disk', 'error', { free_mb: Math.round(s.disk.free / 1048576) }, 'cleanup'))
  if (s.temp && s.temp > 80) out.push(finding('hot', s.temp > 85 ? 'error' : 'warning', { temp: Math.round(s.temp) }))
  if (s.throttled) {
    if (s.throttled & 0x1) out.push(finding('undervoltage', 'error', {}))
    else if (s.throttled & 0x10000) out.push(finding('undervoltage_past', 'warning', {}))
    if (s.throttled & 0x4) out.push(finding('throttled', 'warning', {}))
  }
  if (device() && displayConnected() && s.kiosk && s.kiosk !== 'active' && s.kiosk !== 'activating') out.push(finding('kiosk_down', 'error', { state: s.kiosk }, 'restart_kiosk'))
  const pluginErrors = db.prepare("SELECT COUNT(*) n FROM logs WHERE category = 'plugins' AND level = 'error' AND ts > ?").get(new Date(Date.now() - 600000).toISOString()).n
  if (pluginErrors > 20) out.push(finding('plugin_errors', 'warning', { n: pluginErrors }, 'restart_plugins'))
  const httpSlow = health.slow.filter(x => Date.now() - x.ts < 600000)
  if (httpSlow.length > 5) out.push(finding('slow_requests', 'warning', { n: httpSlow.length, worst: httpSlow.sort((a, b) => b.ms - a.ms)[0]?.url }))
  const errs = db.prepare("SELECT COUNT(*) n FROM logs WHERE level IN ('error', 'critical') AND ts > ?").get(new Date(Date.now() - 600000).toISOString()).n
  if (errs > 50) out.push(finding('many_errors', 'warning', { n: errs }))
  health.findings = out
  return out
}

let fixHandlers = {}
export function registerFixes(handlers) { fixHandlers = { ...fixHandlers, ...handlers } }

const lastFix = new Map()
export async function applyFix(name, by = 'auto') {
  const fn = fixHandlers[name]
  if (!fn) throw new Error(`unknown fix ${name}`)
  const at = Date.now()
  const result = await fn()
  lastFix.set(name, at)
  health.fixes.unshift({ ts: at, name, by, result: result ?? 'ok' })
  health.fixes.length = Math.min(health.fixes.length, 50)
  log('system', 'warning', 'health.fixed', { fix: name, by, result: result ?? 'ok' })
  return result ?? 'ok'
}

registerFixes({
  async restart_kiosk() { await run('systemctl', ['restart', 'smartboard-kiosk.service'], { timeout: 20000 }); return 'kiosk restarted' },
  async cleanup() {
    const keep = (table, n) => db.prepare(`DELETE FROM ${table} WHERE id <= (SELECT MAX(id) FROM ${table}) - ?`).run(n).changes
    const removed = keep('logs', 20000) + keep('config_versions', 300) + keep('notifications', 500)
    db.exec('VACUUM')
    return `${removed} rows removed`
  },
})

export function startHealth() {
  const tick = async () => {
    try {
      const s = await sample()
      const found = analyse(s)
      const auto = getSetting('health')?.autofix !== false
      for (const f of found) {
        if (auto && f.fix && Date.now() - (lastFix.get(f.fix) ?? 0) > 15 * 60000) await applyFix(f.fix).catch(e => log('system', 'error', 'health.fix_failed', { fix: f.fix, error: e.message }))
        if (f.level === 'error' && Date.now() - (notified.get(f.id) ?? 0) > 6 * 3600000) {
          notified.set(f.id, Date.now())
          notify({ level: 'warning', title: 'Diagnose', message: TEXT[f.id]?.(f.data) ?? f.id, source: 'health' })
        }
      }
    } catch (e) {
      log('system', 'error', 'health.failed', { error: e.message })
    }
  }
  setTimeout(tick, 15000).unref()
  setInterval(tick, 30000).unref()
}

export function trackRequest(url, ms) {
  if (ms < 2000 || /\/(live|events)\b/.test(url)) return
  health.slow.push({ ts: Date.now(), url: url.split('?')[0], ms: Math.round(ms) })
  if (health.slow.length > 100) health.slow.shift()
  log('system', 'warning', 'http.slow', { url: url.split('?')[0], ms: Math.round(ms) })
}

export async function diagnosticBundle() {
  const journal = {}
  if (device() && has('journalctl')) {
    for (const u of ['smartboard-core', 'smartboard-kiosk', 'smartboard-update', 'smartboard-go2rtc', 'NetworkManager', 'bluetooth']) {
      try { journal[u] = (await run('journalctl', ['-u', u, '-n', '200', '--no-pager', '-o', 'short-iso'], { timeout: 8000 })).split('\n') } catch (e) { journal[u] = [e.message] }
    }
  }
  let update = null
  try { update = JSON.parse(readFileSync(`${DATA}/update.json`, 'utf8')) } catch {}
  return {
    created: new Date().toISOString(), version: process.env.npm_package_version, node: process.version, device: device(),
    health: { current: health.samples.at(-1), findings: health.findings, fixes: health.fixes, slow: health.slow.slice(-50), history: health.samples.slice(-120) },
    update,
    logs: db.prepare('SELECT ts, category, level, message, data FROM logs ORDER BY id DESC LIMIT 1000').all(),
    plugins: db.prepare('SELECT id, version, enabled FROM plugins').all(),
    counts: Object.fromEntries(['users', 'devices', 'dashboards', 'widgets', 'automations', 'cameras'].map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])),
    journal,
  }
}
