import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, has } from './exec.js'
import { getSetting, setSetting } from '../core/settings.js'

const BL = process.env.SMARTBOARD_BACKLIGHT_DIR ?? '/sys/class/backlight'
let ddcDisplays = null

const readNum = p => Number(readFileSync(p, 'utf8').trim())

function backlights() {
  if (!existsSync(BL)) return []
  return readdirSync(BL).map(name => {
    const dir = join(BL, name)
    try {
      const max = readNum(join(dir, 'max_brightness'))
      return { id: `bl:${name}`, kind: 'backlight', name, brightness: Math.round(readNum(join(dir, 'brightness')) / max * 100), power: existsSync(join(dir, 'bl_power')) ? readNum(join(dir, 'bl_power')) === 0 : true, writable: true, max }
    } catch { return null }
  }).filter(Boolean)
}

async function ddc() {
  if (!has('ddcutil')) return []
  if (ddcDisplays === null) {
    try {
      const out = await run('ddcutil', ['detect', '--brief'], { timeout: 20000 })
      ddcDisplays = [...out.matchAll(/Display (\d+)[\s\S]*?Monitor:\s*([^\n]*)/g)].map(m => ({ n: m[1], name: m[2].trim() }))
    } catch { ddcDisplays = [] }
  }
  const out = []
  for (const d of ddcDisplays) {
    let brightness = null
    try {
      const v = await run('ddcutil', ['--display', d.n, '--terse', 'getvcp', '10'], { timeout: 8000 })
      const m = /VCP 10 C (\d+) (\d+)/.exec(v)
      if (m) brightness = Math.round(Number(m[1]) / Number(m[2]) * 100)
    } catch {}
    out.push({ id: `ddc:${d.n}`, kind: 'ddc', name: d.name || `Monitor ${d.n}`, brightness, power: true, writable: brightness !== null })
  }
  return out
}

export function parseRandr(text) {
  const out = []
  let cur = null
  let inModes = false
  for (const line of text.split('\n')) {
    const head = /^(\S+)(?: "(.*)")?/.exec(line)
    if (head && !line.startsWith(' ')) { cur = { name: head[1], description: head[2] ?? '', enabled: true, transform: 'normal', scale: 1, modes: [] }; out.push(cur); inModes = false; continue }
    if (!cur) continue
    const kv = /^\s+(Enabled|Transform|Scale):\s*(.*)$/.exec(line)
    if (kv) {
      inModes = false
      if (kv[1] === 'Enabled') cur.enabled = kv[2].trim() === 'yes'
      if (kv[1] === 'Transform') cur.transform = kv[2].trim()
      if (kv[1] === 'Scale') cur.scale = Number(kv[2])
      continue
    }
    if (/^\s+Modes:/.test(line)) { inModes = true; continue }
    const m = inModes && /^\s+(\d+)x(\d+) px, ([\d.]+) Hz(.*)$/.exec(line)
    if (m) cur.modes.push({ width: Number(m[1]), height: Number(m[2]), refresh: Number(m[3]), current: /current/.test(m[4]) })
    else if (/^\s+\S+:/.test(line)) inModes = false
  }
  return out
}

async function outputs() {
  if (!has('wlr-randr')) return []
  try {
    let list
    try { list = JSON.parse(await run('wlr-randr', ['--json'], { timeout: 5000 })) } catch { list = parseRandr(await run('wlr-randr', [], { timeout: 5000 })) }
    return list.map(o => ({
      name: o.name, description: o.description, enabled: o.enabled, transform: o.transform ?? 'normal', scale: o.scale,
      mode: o.modes?.find(m => m.current) ?? null, modes: (o.modes ?? []).map(m => ({ width: m.width, height: m.height, refresh: Math.round(m.refresh) })),
    }))
  } catch { return [] }
}

export async function displayStatus() {
  return { panels: [...backlights(), ...(await ddc())], outputs: await outputs() }
}

export async function setBrightness(id, percent) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent))))
  if (id.startsWith('bl:')) {
    const name = id.slice(3)
    if (!/^[\w.-]+$/.test(name)) throw new Error('invalid panel')
    const dir = join(BL, name)
    const max = readNum(join(dir, 'max_brightness'))
    writeFileSync(join(dir, 'brightness'), String(Math.max(p === 0 ? 0 : 1, Math.round(max * p / 100))))
  } else if (id.startsWith('ddc:')) {
    await run('ddcutil', ['--display', id.slice(4).replace(/\D/g, ''), 'setvcp', '10', String(p)], { timeout: 10000 })
  } else throw new Error('invalid panel')
}

export async function setPower(on) {
  for (const b of backlights()) {
    const f = join(BL, b.name, 'bl_power')
    if (existsSync(f)) try { writeFileSync(f, on ? '0' : '4') } catch {}
  }
  for (const d of ddcDisplays ?? []) {
    try { await run('ddcutil', ['--display', d.n, 'setvcp', 'D6', on ? '01' : '04'], { timeout: 10000 }) } catch {}
  }
}

const TRANSFORMS = ['normal', '90', '180', '270', 'flipped', 'flipped-90', 'flipped-180', 'flipped-270']
export async function setOutput(name, { transform, scale, mode }) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('invalid output')
  const args = ['--output', name]
  if (transform) { if (!TRANSFORMS.includes(transform)) throw new Error('invalid transform'); args.push('--transform', transform) }
  if (scale) args.push('--scale', String(Math.max(0.5, Math.min(4, Number(scale)))))
  if (mode) { if (!/^\d+x\d+(@\d+(\.\d+)?Hz)?$/.test(mode)) throw new Error('invalid mode'); args.push('--mode', mode) }
  await run('wlr-randr', args)
  const saved = getSetting('outputs') ?? {}
  saved[name] = { ...saved[name], ...(transform && { transform }), ...(scale && { scale: Number(scale) }), ...(mode && { mode }) }
  setSetting('outputs', saved)
}

export function keepOutputs() {
  const tick = async () => {
    const saved = getSetting('outputs') ?? {}
    if (!Object.keys(saved).length) return
    for (const o of await outputs()) {
      const want = saved[o.name]
      if (!want) continue
      const cur = o.mode ? `${o.mode.width}x${o.mode.height}` : null
      if ((want.transform && want.transform !== o.transform) || (want.scale && Math.abs(want.scale - o.scale) > 0.01) || (want.mode && !want.mode.startsWith(cur ?? '-'))) {
        const args = ['--output', o.name]
        if (want.transform) args.push('--transform', want.transform)
        if (want.scale) args.push('--scale', String(want.scale))
        if (want.mode) args.push('--mode', want.mode)
        await run('wlr-randr', args).catch(() => {})
      }
    }
  }
  setInterval(() => tick().catch(() => {}), 10000).unref()
}
