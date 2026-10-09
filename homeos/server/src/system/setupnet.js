import { randomInt, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { networkInterfaces, hostname } from 'node:os'
import { db } from '../core/db.js'
import { log } from '../core/logger.js'
import { isLocalIp } from '../core/settings.js'
import { run, has } from './exec.js'

export const setupState = {
  code: String(randomInt(100000, 999999)),
  hotspot: null,
}

export const setupNeeded = () => db.prepare('SELECT COUNT(*) c FROM users').get().c === 0
const uptime = () => { try { return Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) } catch { return 9999 } }

export function displayConnected() {
  try {
    return readdirSync('/sys/class/drm').some(n => /^card\d+-/.test(n) && readFileSync(`/sys/class/drm/${n}/status`, 'utf8').trim() === 'connected')
  } catch { return true }
}
export const headless = () => process.env.SMARTBOARD_HAL === '1' && !displayConnected() && uptime() < 1800

let failures = 0
export function setupAllowed(req) {
  if (isLocalIp(req.ip)) return true
  if (headless()) return true
  const code = req.headers['x-setup-code'] ?? req.body?.code
  if (!code) return false
  if (String(code) === setupState.code) return true
  if (++failures >= 10) { failures = 0; setupState.code = String(randomInt(100000, 999999)); log('auth', 'warning', 'setup.code_rotated', { ip: req.ip }) }
  return false
}

export function addresses() {
  return Object.entries(networkInterfaces()).filter(([n]) => n !== 'lo' && !n.startsWith('docker'))
    .flatMap(([, l]) => l.filter(a => a.family === 'IPv4' && !a.internal).map(a => a.address))
}

export async function online() {
  if (!has('nmcli')) return addresses().length > 0
  try {
    const out = await run('nmcli', ['-t', '-f', 'TYPE,STATE,CONNECTION', 'device'])
    return out.split('\n').some(l => /^(wifi|ethernet):connected:/.test(l) && !l.endsWith(':sb-setup'))
  } catch { return false }
}

export async function startHotspot() {
  if (setupState.hotspot || !has('nmcli')) return
  const ssid = `SmartBoard-${randomBytes(2).toString('hex').toUpperCase()}`
  const password = String(randomInt(10000000, 99999999))
  try {
    await run('nmcli', ['device', 'wifi', 'hotspot', 'ifname', 'wlan0', 'con-name', 'sb-setup', 'ssid', ssid, 'password', password], { timeout: 30000 })
    setupState.hotspot = { ssid, password, url: 'http://10.42.0.1' }
    log('network', 'info', 'setup.hotspot', { ssid })
  } catch (e) {
    log('network', 'warning', 'setup.hotspot_failed', { error: e.message })
  }
}

export async function stopHotspot() {
  if (!setupState.hotspot) return
  setupState.hotspot = null
  await run('nmcli', ['connection', 'down', 'sb-setup']).catch(() => {})
  await run('nmcli', ['connection', 'delete', 'sb-setup']).catch(() => {})
}

export function setupInfo() {
  const ips = addresses().filter(a => !a.startsWith('10.42.'))
  return {
    needed: setupNeeded(), code: setupState.code, hotspot: setupState.hotspot,
    urls: [`http://${hostname()}.local`, ...ips.map(ip => `http://${ip}`)],
  }
}

export function startSetupNet() {
  const tick = async () => {
    if (!setupNeeded()) { await stopHotspot(); return }
    const on = await online()
    if (on && setupState.hotspot) await stopHotspot()
    if (!on && !setupState.hotspot && uptime() > 60) await startHotspot()
    setTimeout(() => tick().catch(() => {}), 15000).unref()
  }
  setTimeout(() => tick().catch(() => {}), 20000).unref()
}
