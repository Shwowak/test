import { networkInterfaces, hostname } from 'node:os'
import { readFileSync as readF, writeFileSync as writeF, rmSync as rmF } from 'node:fs'
import { run, has } from './exec.js'

function splitTerse(line) {
  const out = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) { cur += line[++i]; continue }
    if (line[i] === ':') { out.push(cur); cur = ''; continue }
    cur += line[i]
  }
  out.push(cur)
  return out
}

const terse = (out, keys) => out.split('\n').filter(Boolean).map(l => Object.fromEntries(splitTerse(l).map((v, i) => [keys[i], v])))

export async function networkStatus() {
  const addrs = Object.entries(networkInterfaces()).filter(([n]) => n !== 'lo').map(([name, list]) => ({ name, addresses: list.filter(a => !a.internal).map(a => `${a.address}/${a.netmask}`) }))
  const base = { hostname: hostname(), interfaces: addrs, managed: has('nmcli') }
  if (!has('nmcli')) return base
  const devices = terse(await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']), ['device', 'type', 'state', 'connection'])
    .filter(d => ['wifi', 'ethernet'].includes(d.type))
  for (const d of devices) {
    try {
      const info = terse(await run('nmcli', ['-t', '-f', 'IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,GENERAL.HWADDR', 'device', 'show', d.device]), ['k', 'v'])
      d.ip = info.filter(x => x.k.startsWith('IP4.ADDRESS')).map(x => x.v)
      d.gateway = info.find(x => x.k === 'IP4.GATEWAY')?.v || null
      d.dns = info.filter(x => x.k.startsWith('IP4.DNS')).map(x => x.v)
      d.mac = info.find(x => x.k === 'GENERAL.HWADDR')?.v ?? null
    } catch {}
  }
  let radio = null
  try { radio = (await run('nmcli', ['radio', 'wifi'])).trim() === 'enabled' } catch {}
  const saved = terse(await run('nmcli', ['-t', '-f', 'NAME,UUID,TYPE,AUTOCONNECT', 'connection', 'show']), ['name', 'uuid', 'type', 'autoconnect'])
    .filter(c => ['802-11-wireless', '802-3-ethernet', 'wifi', 'ethernet', 'vpn', 'wireguard'].includes(c.type))
  return { ...base, devices, wifiEnabled: radio, saved }
}

export async function wifiScan(rescan = true) {
  const out = await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY,FREQ', 'device', 'wifi', 'list', '--rescan', rescan ? 'yes' : 'no'], { timeout: 30000 })
  const best = new Map()
  for (const n of terse(out, ['inUse', 'ssid', 'signal', 'security', 'freq'])) {
    if (!n.ssid) continue
    const cur = { ssid: n.ssid, signal: Number(n.signal), secure: !!n.security && n.security !== '--', security: n.security, active: n.inUse === '*', band: Number.parseInt(n.freq) >= 5000 ? '5 GHz' : '2.4 GHz' }
    const prev = best.get(n.ssid)
    if (!prev || cur.active || (!prev.active && cur.signal > prev.signal)) best.set(n.ssid, cur)
  }
  return [...best.values()].sort((a, b) => b.active - a.active || b.signal - a.signal)
}

export async function wifiConnect(ssid, password, hidden = false) {
  if (typeof ssid !== 'string' || !ssid || ssid.length > 64) throw new Error('invalid ssid')
  const args = ['device', 'wifi', 'connect', ssid]
  if (password) args.push('password', String(password))
  if (hidden) args.push('hidden', 'yes')
  await run('nmcli', args, { timeout: 45000 })
}

export async function wifiRadio(on) {
  await run('nmcli', ['radio', 'wifi', on ? 'on' : 'off'])
}

export async function forget(uuid) {
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new Error('invalid uuid')
  await run('nmcli', ['connection', 'delete', 'uuid', uuid])
}

export async function setHostname(name) {
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(name)) throw new Error('invalid hostname')
  await run('hostnamectl', ['set-hostname', name])
}

const WG = 'sbwg0'

export async function wgStatus() {
  if (!has('nmcli')) return { available: false }
  const conns = terse(await run('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show']), ['name', 'type', 'device'])
  const c = conns.find(x => x.name === WG)
  if (!c) return { available: true, configured: false }
  let ip = null
  try { ip = (await run('nmcli', ['-g', 'IP4.ADDRESS', 'connection', 'show', WG])).trim() || null } catch {}
  return { available: true, configured: true, active: !!c.device, ip }
}

export async function wgImport(conf) {
  const text = String(conf ?? '')
  if (!/\[Interface\]/i.test(text) || !/\[Peer\]/i.test(text) || !/PrivateKey\s*=/i.test(text)) throw new Error('invalid wireguard config')
  if (text.length > 20000) throw new Error('config too large')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'sbwg-'))
  const file = join(dir, `${WG}.conf`)
  try {
    writeFileSync(file, text, { mode: 0o600 })
    try { await run('nmcli', ['connection', 'delete', WG]) } catch {}
    await run('nmcli', ['connection', 'import', 'type', 'wireguard', 'file', file])
    await run('nmcli', ['connection', 'modify', WG, 'connection.autoconnect', 'yes'])
    try { await run('nmcli', ['connection', 'up', WG]) } catch {}
  } finally { rmSync(dir, { recursive: true, force: true }) }
  return wgStatus()
}

export async function wgSet(on) {
  await run('nmcli', ['connection', on ? 'up' : 'down', WG])
  return wgStatus()
}

export async function wgRemove() {
  try { await run('nmcli', ['connection', 'delete', WG]) } catch {}
  return wgStatus()
}

export async function sshStatus() {
  if (!has('systemctl')) return { available: false }
  let active = false
  try { active = (await run('systemctl', ['is-active', 'ssh.service'])).trim() === 'active' } catch {}
  return { available: true, active, users: loginUsers() }
}

function loginUsers() {
  try {
    return readF('/etc/passwd', 'utf8').split('\n').map(l => l.split(':'))
      .filter(f => Number(f[2]) >= 1000 && Number(f[2]) < 65534 && f[0] !== 'smartboard' && !/nologin|false$/.test(f[6] ?? '')).map(f => f[0])
  } catch { return [] }
}

export async function sshPassword(user, password) {
  if (!loginUsers().includes(user)) throw new Error('unknown user')
  if (typeof password !== 'string' || password.length < 8 || /[\n\r]/.test(password)) throw new Error('password.too_short')
  const dir = '/var/lib/smartboard'
  rmF(`${dir}/passwd.res`, { force: true })
  writeF(`${dir}/passwd.req`, `${user}\n${password}\n`, { mode: 0o600 })
  try { await run('systemctl', ['start', 'smartboard-passwd.service']) } finally { rmF(`${dir}/passwd.req`, { force: true }) }
  const res = readF(`${dir}/passwd.res`, 'utf8').trim()
  rmF(`${dir}/passwd.res`, { force: true })
  if (res !== 'ok') throw new Error(res)
  return { ok: true }
}

export async function sshSet(on) {
  if (on) await run('systemctl', ['start', 'ssh.service'])
  else {
    try { await run('systemctl', ['stop', 'ssh.socket']) } catch {}
    await run('systemctl', ['stop', 'ssh.service'])
  }
  return sshStatus()
}
