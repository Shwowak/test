import { existsSync } from 'node:fs'
import { db } from '../core/db.js'
import { bus } from '../core/events.js'
import { can } from '../core/auth.js'
import { log } from '../core/logger.js'
import { notify } from '../core/notify.js'
import { getSetting } from '../core/settings.js'
import { getDevice, commandDevice } from '../devices/engine.js'
import { runAutomation } from '../automation/engine.js'

export function aiConfig() {
  const c = { ...getSetting('ai') }
  if (!c.url) c.url = c.provider === 'openai' ? 'http://localhost:1234/v1' : process.env.HOMEOS_OLLAMA_URL ?? (inDocker() ? 'http://host.docker.internal:11434' : 'http://localhost:11434')
  c.url = c.url.replace(/\/$/, '')
  return c
}

let docker = null
function inDocker() {
  if (docker === null) { docker = !!process.env.container || existsSync('/.dockerenv') }
  return docker
}

const pluginData = (id, key) => {
  const r = db.prepare('SELECT value FROM plugin_data WHERE plugin_id = ? AND key = ?').get(id, key)
  return r ? JSON.parse(r.value) : null
}

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

function devices() {
  const rooms = Object.fromEntries(db.prepare('SELECT id, name FROM rooms').all().map(r => [r.id, r.name]))
  return db.prepare('SELECT id FROM devices WHERE adopted = 1 AND hidden = 0').all().map(r => getDevice(r.id)).filter(Boolean)
    .map(d => ({ ...d, room: rooms[d.room_id] ?? null }))
}

function findDevice(ref) {
  const list = devices()
  if (ref === undefined || ref === null || ref === '') return null
  if (/^\d+$/.test(String(ref))) return list.find(d => d.id === Number(ref)) ?? null
  const q = norm(ref)
  return list.find(d => norm(d.name) === q)
    ?? list.find(d => norm(`${d.room ?? ''} ${d.name}`).includes(q) || q.includes(norm(d.name)))
    ?? list.find(d => q.split(' ').every(w => norm(`${d.room ?? ''} ${d.name}`).includes(w)))
    ?? null
}

const summary = d => ({
  id: d.id, name: d.name, room: d.room, type: d.type, online: d.connection !== 'offline',
  state: d.state, controls: d.capabilities.filter(c => c.writable).map(c => c.id + (c.value === 'number' ? ` (${c.min ?? ''}-${c.max ?? ''}${c.unit ?? ''})` : c.value === 'boolean' ? ' (true/false)' : c.options ? ` (${c.options.join('/')})` : '')),
})

export const TOOLS = [
  { name: 'get_devices', perm: 'devices.view', description: 'List smart home devices with current state. Optional filter by room or text.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'room or device name filter' } } },
    run: ({ query }) => {
      const q = norm(query)
      return devices().filter(d => !q || norm(`${d.room ?? ''} ${d.name} ${d.type}`).includes(q)).slice(0, 40).map(summary)
    } },
  { name: 'control_device', perm: 'devices.control', description: 'Switch or set a device. capability e.g. onoff (true/false), brightness (0-100), position (0-100), target_temperature, cover (open/close/stop), lock (true/false).',
    parameters: { type: 'object', required: ['device', 'capability', 'value'], properties: {
      device: { type: 'string', description: 'device name (optionally with room) or id' }, capability: { type: 'string' }, value: { description: 'new value' } } },
    run: async ({ device, capability, value }, user) => {
      const d = findDevice(device)
      if (!d) return { error: `device "${device}" not found` }
      const c = d.capabilities.find(x => x.id === capability) ?? d.capabilities.find(x => x.kind === capability)
      if (!c) return { error: `device "${d.name}" has no capability ${capability}`, available: d.capabilities.filter(x => x.writable).map(x => x.id) }
      let v = value
      if (c.value === 'boolean') v = v === true || ['true', 'on', 'an', 'ein', '1', 1].includes(typeof v === 'string' ? v.toLowerCase() : v)
      else if (c.value === 'number') v = Number(v)
      const r = await commandDevice(d.id, c.id, v, user)
      return r.error ? { error: r.error } : { ok: true, device: d.name, room: d.room, capability: c.id, value: v }
    } },
  { name: 'get_weather', description: 'Current weather and forecast for the configured location.', parameters: { type: 'object', properties: {} },
    run: () => {
      const w = pluginData('smartboard.weather', 'weather')
      if (!w) return { error: 'weather plugin has no data' }
      return { place: w.place, units: w.units, current: w.current, days: w.days.slice(0, 5).map(d => ({ date: d.date, min: d.min, max: d.max, rain_probability: d.rainProb, code: d.code })) }
    } },
  { name: 'get_calendar', description: 'Upcoming calendar events.', parameters: { type: 'object', properties: { days: { type: 'number' } } },
    run: ({ days = 7 }) => {
      const c = pluginData('smartboard.calendar', 'events')
      if (!c) return { error: 'calendar plugin has no data' }
      const until = Date.now() + Math.min(Number(days) || 7, 60) * 86400000
      const fmt = new Intl.DateTimeFormat('de-DE', { timeZone: c.timezone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      return c.events.filter(e => e.end > Date.now() && e.start < until).slice(0, 30).map(e => ({ title: e.title, start: fmt.format(new Date(e.start)), all_day: e.allDay, location: e.location, calendar: e.calendar }))
    } },
  { name: 'get_energy', description: 'Current power flow (W) and today\'s energy totals (kWh, cost, self-sufficiency).', parameters: { type: 'object', properties: {} },
    run: () => pluginData('smartboard.energy', 'energy') ?? { error: 'energy plugin not configured' } },
  { name: 'list_automations', perm: 'automations.view', description: 'List automations (rules).', parameters: { type: 'object', properties: {} },
    run: () => db.prepare('SELECT id, name, enabled, last_run FROM automations ORDER BY name').all() },
  { name: 'run_automation', perm: 'automations.manage', description: 'Run an automation now by name or id.', parameters: { type: 'object', required: ['automation'], properties: { automation: { type: 'string' } } },
    run: async ({ automation }) => {
      const list = db.prepare('SELECT id, name FROM automations').all()
      const a = list.find(x => String(x.id) === String(automation)) ?? list.find(x => norm(x.name) === norm(automation)) ?? list.find(x => norm(x.name).includes(norm(automation)))
      if (!a) return { error: 'automation not found', available: list.map(x => x.name) }
      return { automation: a.name, ...(await runAutomation(a.id, { trigger: 'assistant', force: true })) }
    } },
  { name: 'show_dashboard', description: 'Show a dashboard on the display by name.', parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    run: ({ name }) => {
      const list = db.prepare('SELECT id, name FROM dashboards').all()
      const d = list.find(x => norm(x.name) === norm(name)) ?? list.find(x => norm(x.name).includes(norm(name)))
      if (!d) return { error: 'dashboard not found', available: list.map(x => x.name) }
      bus.emit('ui.command', { action: 'dashboard', dashboard_id: d.id })
      return { ok: true, dashboard: d.name }
    } },
  { name: 'show_camera', perm: 'cameras.view', description: 'Show a camera live view full screen.', parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    run: ({ name }) => {
      if (!getSetting('privacy')?.cameras) return { error: 'cameras are disabled in privacy settings' }
      const list = db.prepare('SELECT id, name FROM cameras WHERE enabled = 1').all()
      const c = list.find(x => norm(x.name) === norm(name)) ?? list.find(x => norm(x.name).includes(norm(name)))
      if (!c) return { error: 'camera not found', available: list.map(x => x.name) }
      bus.emit('ui.command', { action: 'camera', camera_id: c.id })
      return { ok: true, camera: c.name }
    } },
  { name: 'create_notification', perm: 'notifications.manage', description: 'Create a notification / reminder on the display.',
    parameters: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, message: { type: 'string' }, level: { type: 'string', enum: ['info', 'warning'] } } },
    run: ({ title, message, level }, user) => ({ id: notify({ level: level === 'warning' ? 'warning' : 'info', title, message, source: `assistant:${user.name}` }).id }) },
]

function systemPrompt(user, lang) {
  const tz = getSetting('timezone')
  const loc = getSetting('location')
  const now = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date())
  const rooms = db.prepare('SELECT name FROM rooms ORDER BY position, name').all().map(r => r.name).join(', ') || '—'
  return (lang === 'en'
    ? `You are the assistant of the SmartBoard smart display in the home of ${user.display_name || user.name}. Answer briefly (1-3 sentences, suitable for speech), in English.`
    : `Du bist der Assistent des SmartBoard-Displays im Zuhause von ${user.display_name || user.name}. Antworte kurz (1–3 Sätze, gut vorlesbar), auf Deutsch, per Du.`)
    + `\nNow: ${now} (${tz}). Location: ${loc.name ?? ''} (${loc.lat}, ${loc.lon}). Rooms: ${rooms}.`
    + '\nUse the tools to look up or change things – never invent device states, weather or appointments. When the user asks to switch something, call control_device directly; use get_devices first only if the device is unclear. After acting, confirm in one short sentence.'
}

async function llm(cfg, messages, tools) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120000)
  try {
    if (cfg.provider === 'openai') {
      const r = await fetch(`${cfg.url}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', ...(cfg.api_key ? { authorization: `Bearer ${cfg.api_key}` } : {}) },
        body: JSON.stringify({ model: cfg.model, messages, tools: tools.map(t => ({ type: 'function', function: t })), temperature: 0.3 }),
      })
      if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const m = (await r.json()).choices?.[0]?.message ?? {}
      return { content: m.content ?? '', tool_calls: (m.tool_calls ?? []).map(c => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) })), raw: m }
    }
    const r = await fetch(`${cfg.url}/api/chat`, {
      method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages, tools: tools.map(t => ({ type: 'function', function: t })), stream: false, options: { temperature: 0.3 } }),
    })
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const m = (await r.json()).message ?? {}
    return { content: m.content ?? '', tool_calls: (m.tool_calls ?? []).map(c => ({ name: c.function.name, args: typeof c.function.arguments === 'string' ? safeJson(c.function.arguments) : c.function.arguments ?? {} })), raw: m }
  } finally {
    clearTimeout(timer)
  }
}

const safeJson = s => { try { return JSON.parse(s || '{}') } catch { return {} } }
const stripThink = s => String(s ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()

export async function chat(user, history, lang = 'de') {
  const cfg = aiConfig()
  if (!cfg.model) throw Object.assign(new Error('no model configured'), { code: 'ai.no_model' })
  const tools = TOOLS.filter(t => !t.perm || can(user, t.perm))
  const defs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }))
  const messages = [{ role: 'system', content: systemPrompt(user, lang) }, ...history.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))]
  const actions = []
  for (let round = 0; round < 6; round++) {
    const res = await llm(cfg, messages, defs)
    if (!res.tool_calls.length) {
      log('ai', 'info', 'ai.answered', { tools: actions.map(a => a.tool), model: cfg.model }, user.id)
      return { reply: stripThink(res.content), actions }
    }
    messages.push(cfg.provider === 'openai' ? res.raw : { role: 'assistant', content: res.content ?? '', tool_calls: res.raw.tool_calls })
    for (const call of res.tool_calls) {
      const tool = tools.find(t => t.name === call.name)
      let result
      try { result = tool ? await tool.run(call.args ?? {}, user) : { error: `unknown tool ${call.name}` } } catch (e) { result = { error: e.message } }
      actions.push({ tool: call.name, args: call.args, result })
      const content = JSON.stringify(result).slice(0, 6000)
      messages.push(cfg.provider === 'openai' ? { role: 'tool', tool_call_id: call.id, content } : { role: 'tool', tool_name: call.name, content })
    }
  }
  return { reply: lang === 'en' ? 'Sorry, that took too many steps.' : 'Das hat zu viele Schritte gebraucht – bitte anders formulieren.', actions }
}

export async function listModels() {
  const cfg = aiConfig()
  const ctrl = AbortSignal.timeout(8000)
  if (cfg.provider === 'openai') {
    const r = await fetch(`${cfg.url}/models`, { signal: ctrl, headers: cfg.api_key ? { authorization: `Bearer ${cfg.api_key}` } : {} })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return (await r.json()).data.map(m => ({ name: m.id }))
  }
  const r = await fetch(`${cfg.url}/api/tags`, { signal: ctrl })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()).models.map(m => ({ name: m.name, size: m.size }))
}
