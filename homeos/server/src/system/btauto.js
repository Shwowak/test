import { readFileSync } from 'node:fs'
import { db } from '../core/db.js'
import { log } from '../core/logger.js'
import * as bt from './bluetooth.js'

export const btAuto = { active: false, searching: false, paired: [], last: null }

const tried = new Map()
const isInput = d => /^input-/.test(d.icon ?? '') || /keyboard|tastatur|mouse|maus|trackpad/i.test(d.name ?? '')
const setupNeeded = () => db.prepare('SELECT COUNT(*) c FROM users').get().c === 0
const uptimeMin = () => { try { return Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) / 60 } catch { return 0 } }

async function round() {
  const st = await bt.bluetoothStatus()
  if (!st.available) return uptimeMin() < 15
  const hasInput = st.devices.some(d => d.paired && isInput(d))
  btAuto.active = setupNeeded() || (!hasInput && uptimeMin() < 15)
  if (!btAuto.active) return true
  if (!st.powered) await bt.power(true).catch(() => {})
  btAuto.searching = true
  const found = await bt.scan(12).catch(() => st)
  btAuto.searching = false
  for (const d of found.devices ?? []) {
    if (!isInput(d) || d.connected || Date.now() - (tried.get(d.address) ?? 0) < 30000) continue
    tried.set(d.address, Date.now())
    try {
      if (d.paired) await bt.connect(d.address)
      else await bt.pair(d.address)
      if (!btAuto.paired.includes(d.name)) btAuto.paired.push(d.name)
      btAuto.last = d.name
      log('bluetooth', 'info', 'bluetooth.pair', { address: d.address, name: d.name, auto: true })
    } catch {}
  }
  return true
}

export function startBtAuto() {
  const loop = async () => {
    let again = true
    try { again = await round() } catch {}
    if (again) setTimeout(loop, btAuto.active ? 2000 : 60000).unref()
  }
  setTimeout(loop, 3000).unref()
}
