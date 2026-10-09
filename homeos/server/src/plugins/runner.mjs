import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const pending = new Map()
const actions = new Map()
const listeners = new Map()
const configHandlers = []
let nextId = 1
let boot = null

const call = (method, ...args) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  process.send({ t: 'call', id, method, args })
})

const realFetch = globalThis.fetch
const MAX_BODY = 5 * 1024 * 1024
async function limitedFetch(url, opts = {}) {
  const u = new URL(url)
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('only http(s) allowed')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeout ?? 15000, 60000))
  try {
    const r = await realFetch(u, { method: opts.method ?? 'GET', headers: opts.headers, body: opts.body, signal: ctrl.signal, redirect: 'follow' })
    const reader = r.body?.getReader()
    const chunks = []
    let size = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BODY) { ctrl.abort(); throw new Error('response too large') }
      chunks.push(value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers), text: async () => text, json: async () => JSON.parse(text) }
  } finally {
    clearTimeout(timer)
  }
}

function makeSdk(init) {
  const has = p => init.granted.includes(p)
  const need = p => { if (!has(p)) throw new Error(`permission ${p} not granted`) }
  const timers = new Set()
  const sdk = {
    id: init.manifest.id,
    manifest: JSON.parse(JSON.stringify(init.manifest)),
    config: init.config,
    lang: init.lang,
    permissions: [...init.granted],
    log: (message, data) => call('log', String(message), data ?? null),
    publish: (key, data) => call('publish', String(key), data),
    onAction: (name, fn) => { actions.set(String(name), fn) },
    onConfig: fn => { configHandlers.push(fn) },
    on: (event, fn) => {
      if (event === 'device.state') need('devices:read')
      else throw new Error(`unknown event ${event}`)
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(fn)
      call('subscribe', event)
    },
    every: (seconds, fn) => {
      const run = () => Promise.resolve().then(fn).catch(e => sdk.log('error: ' + (e?.message ?? e)))
      run()
      const t = setInterval(run, Math.max(10, Number(seconds) || 60) * 1000)
      timers.add(t)
      return () => { clearInterval(t); timers.delete(t) }
    },
    fetch: (url, opts) => { need('internet'); return limitedFetch(url, opts) },
    storage: {
      get: key => { need('storage'); return call('storage.get', String(key)) },
      set: (key, value) => { need('storage'); return call('storage.set', String(key), value) },
      delete: key => { need('storage'); return call('storage.delete', String(key)) },
    },
    notify: n => { need('notifications'); return call('notify', n) },
    location: () => { need('location'); return call('location') },
    devices: {
      list: () => { need('devices:read'); return call('devices.list') },
      get: id => { need('devices:read'); return call('devices.get', Number(id)) },
      command: (id, capability, value) => { need('devices:control'); return call('devices.command', Number(id), String(capability), value) },
    },
  }
  return Object.freeze(sdk)
}

process.on('message', async msg => {
  if (msg.t === 'init') {
    boot = msg
    const sdk = makeSdk(msg)
    for (const k of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) delete globalThis[k]
    for (const k of ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen', 'kill', 'chdir', 'setuid', 'setgid']) try { delete process[k] } catch {}
    const context = vm.createContext({
      sdk, console: { log: (...a) => sdk.log(a.join(' ')), error: (...a) => sdk.log('error: ' + a.join(' ')), warn: (...a) => sdk.log('warn: ' + a.join(' ')) },
      setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, structuredClone, atob, btoa,
    }, { name: msg.manifest.id, codeGeneration: { strings: false, wasm: false } })
    try {
      const code = readFileSync(msg.file, 'utf8')
      new vm.Script(`(async () => {\n${code}\n})()`, { filename: msg.manifest.backend }).runInContext(context, { timeout: 5000 })
        .catch(e => { process.send({ t: 'fatal', error: e?.message ?? String(e) }) })
      process.send({ t: 'ready' })
    } catch (e) {
      process.send({ t: 'fatal', error: e.message })
    }
  } else if (msg.t === 'res') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result)
  } else if (msg.t === 'action') {
    const fn = actions.get(msg.name)
    try {
      if (!fn) throw new Error(`unknown action ${msg.name}`)
      process.send({ t: 'action.res', id: msg.id, result: (await fn(msg.payload)) ?? null })
    } catch (e) {
      process.send({ t: 'action.res', id: msg.id, error: e?.message ?? String(e) })
    }
  } else if (msg.t === 'event') {
    for (const fn of listeners.get(msg.event) ?? []) Promise.resolve().then(() => fn(msg.payload)).catch(() => {})
  } else if (msg.t === 'config') {
    if (boot) Object.assign(boot.config, msg.config)
    for (const fn of configHandlers) Promise.resolve().then(() => fn(msg.config)).catch(() => {})
  }
})

process.on('disconnect', () => process.exit(0))
