import { run, has } from './exec.js'

export function parseWpctl(out) {
  const res = { sinks: [], sources: [] }
  let section = null
  let inAudio = false
  for (const raw of out.split('\n')) {
    const line = raw.replace(/[│├└─]/g, ' ')
    if (/^\S/.test(raw)) inAudio = /^Audio/.test(raw)
    if (!inAudio) continue
    const head = /^\s*(Sinks|Sources|Devices|Filters|Streams|Sink endpoints|Source endpoints):/.exec(line)
    if (head) { section = head[1]; continue }
    if (section !== 'Sinks' && section !== 'Sources') continue
    const m = /^\s*(\*)?\s*(\d+)\.\s+(.*?)\s*(?:\[vol:\s*([\d.]+)(\s*MUTED)?\])?\s*$/.exec(line)
    if (!m) continue
    const item = { id: Number(m[2]), name: m[3].trim(), default: !!m[1], volume: m[4] ? Math.round(Number(m[4]) * 100) : null, muted: !!m[5] }
    ;(section === 'Sinks' ? res.sinks : res.sources).push(item)
  }
  return res
}

export async function audioStatus() {
  if (!has('wpctl')) return { available: false }
  try {
    return { available: true, ...parseWpctl(await run('wpctl', ['status'])) }
  } catch (e) {
    return { available: false, error: e.message }
  }
}

const target = id => (id === 'sink' ? '@DEFAULT_AUDIO_SINK@' : id === 'source' ? '@DEFAULT_AUDIO_SOURCE@' : String(Number(id)))

export async function setVolume(id, percent) {
  await run('wpctl', ['set-volume', '-l', '1.0', target(id), `${Math.max(0, Math.min(100, Math.round(percent)))}%`])
}
export async function setMute(id, muted) { await run('wpctl', ['set-mute', target(id), muted ? '1' : '0']) }
export async function setDefault(id) { await run('wpctl', ['set-default', String(Number(id))]) }
