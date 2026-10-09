import { networkInterfaces, hostname } from 'node:os'
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
