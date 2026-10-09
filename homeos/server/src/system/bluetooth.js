import { run, has } from './exec.js'

const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i
const check = mac => { if (!MAC.test(mac)) throw new Error('invalid address'); return mac.toUpperCase() }
const bt = (args, timeout = 10000) => run('bluetoothctl', args, { timeout })

function parseInfo(out) {
  const get = k => new RegExp(`^\\s*${k}:\\s*(.*)$`, 'm').exec(out)?.[1]?.trim()
  return {
    name: get('Name') ?? get('Alias') ?? null, icon: get('Icon') ?? null,
    paired: get('Paired') === 'yes', trusted: get('Trusted') === 'yes', connected: get('Connected') === 'yes',
    battery: Number(/Battery Percentage:\s*0x[0-9a-f]+ \((\d+)\)/i.exec(out)?.[1]) || null, rssi: Number(get('RSSI')) || null,
  }
}

export async function bluetoothStatus() {
  if (!has('bluetoothctl')) return { available: false }
  let show = ''
  try { show = await bt(['show']) } catch (e) { return { available: false, error: e.message } }
  if (!/Controller/.test(show)) return { available: false }
  const devices = []
  for (const m of (await bt(['devices'])).matchAll(/^Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2}) (.*)$/gim)) {
    let info = {}
    try { info = parseInfo(await bt(['info', m[1]])) } catch {}
    devices.push({ address: m[1], ...info, name: info.name ?? m[2] })
  }
  return {
    available: true, powered: /Powered: yes/.test(show), discoverable: /Discoverable: yes/.test(show),
    name: /Alias: (.*)/.exec(show)?.[1]?.trim() ?? null,
    devices: devices.sort((a, b) => b.connected - a.connected || b.paired - a.paired || (b.rssi ?? -999) - (a.rssi ?? -999)),
  }
}

export async function scan(seconds = 8) {
  await bt(['--timeout', String(Math.max(3, Math.min(20, seconds))), 'scan', 'on'], (seconds + 5) * 1000).catch(() => {})
  return bluetoothStatus()
}

export async function power(on) { await bt(['power', on ? 'on' : 'off']) }

export async function pair(mac) {
  mac = check(mac)
  await bt(['--agent', 'NoInputNoOutput', 'pair', mac], 30000).catch(e => { if (!/AlreadyExists/.test(e.message)) throw e })
  await bt(['trust', mac])
  await bt(['connect', mac], 20000).catch(() => {})
}

export async function connect(mac) { await bt(['connect', check(mac)], 20000) }
export async function disconnect(mac) { await bt(['disconnect', check(mac)]) }
export async function remove(mac) { await bt(['remove', check(mac)]) }
