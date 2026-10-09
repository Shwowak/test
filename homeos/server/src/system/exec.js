import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const cache = new Map()

export function has(cmd) {
  if (!cache.has(cmd)) cache.set(cmd, (process.env.PATH ?? '/usr/bin:/bin').split(':').some(d => existsSync(join(d, cmd))))
  return cache.get(cmd)
}

export function sessionEnv() {
  const uid = process.getuid?.()
  const runtime = process.env.XDG_RUNTIME_DIR ?? (uid !== undefined ? `/run/user/${uid}` : null)
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C' }
  if (runtime && existsSync(runtime)) {
    env.XDG_RUNTIME_DIR = runtime
    if (!env.WAYLAND_DISPLAY) {
      const sock = readdirSync(runtime).find(n => /^wayland-\d+$/.test(n))
      if (sock) env.WAYLAND_DISPLAY = sock
    }
    if (!env.DBUS_SESSION_BUS_ADDRESS && existsSync(join(runtime, 'bus'))) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(runtime, 'bus')}`
  }
  return env
}

export class ExecError extends Error {
  constructor(cmd, message, code) { super(message); this.cmd = cmd; this.exitCode = code }
}

export function run(cmd, args = [], { timeout = 10000, input } = {}) {
  return new Promise((resolve, reject) => {
    if (!has(cmd)) return reject(new ExecError(cmd, `${cmd} not installed`, 127))
    const child = execFile(cmd, args, { timeout, env: sessionEnv(), maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new ExecError(cmd, (stderr || err.message).toString().trim().split('\n').pop().slice(0, 300), err.code))
      resolve(stdout.toString())
    })
    if (input !== undefined) { child.stdin.end(input) }
  })
}

let userns = null
export function canIsolateNetwork() {
  if (userns === null) {
    try { userns = has('unshare') && spawnSync('unshare', ['--user', '--map-root-user', '--net', 'true'], { timeout: 3000 }).status === 0 } catch { userns = false }
  }
  return userns
}
