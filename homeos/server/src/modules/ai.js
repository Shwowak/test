import { requirePerm, HttpError } from '../core/http.js'
import { getSetting, setSetting } from '../core/settings.js'
import { recordChange } from '../core/versions.js'
import { log } from '../core/logger.js'
import { can } from '../core/auth.js'
import { chat, listModels, aiConfig } from '../ai/assistant.js'

const SECRET = '••••••'

export default async function aiModule(app) {
  const s = (summary, extra = {}) => ({ tags: ['ai'], summary, ...extra })

  app.addContentTypeParser(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4'], { parseAs: 'buffer', bodyLimit: 15 * 1024 * 1024 }, (req, body, done) => done(null, body))

  app.get('/ai/settings', { schema: s('Assistant settings'), preHandler: requirePerm('ai.use') }, async req => {
    const c = aiConfig()
    const out = { ...c, api_key: c.api_key ? SECRET : '', privacy: getSetting('privacy') }
    if (!can(req.user, 'system.manage')) { delete out.api_key; delete out.url }
    return out
  })

  app.put('/ai/settings', {
    schema: s('Update assistant settings', { body: { type: 'object', properties: {
      provider: { type: 'string', enum: ['ollama', 'openai'] }, url: { type: 'string', maxLength: 300 }, model: { type: 'string', maxLength: 200 }, api_key: { type: 'string', maxLength: 300 },
      stt_url: { type: 'string', maxLength: 300 }, stt_model: { type: 'string', maxLength: 100 }, tts_url: { type: 'string', maxLength: 300 }, tts_model: { type: 'string', maxLength: 100 }, tts_voice: { type: 'string', maxLength: 100 },
      speak: { type: 'boolean' }, privacy: { type: 'object', properties: { cameras: { type: 'boolean' }, microphone: { type: 'boolean' } } },
    } } }),
    preHandler: requirePerm('system.manage'),
  }, async req => {
    const { privacy, ...ai } = req.body
    const cur = getSetting('ai')
    if (ai.api_key === SECRET) delete ai.api_key
    setSetting('ai', { ...cur, ...ai })
    if (privacy) setSetting('privacy', { ...getSetting('privacy'), ...privacy })
    recordChange(req.user, 'settings', null, 'update', 'ai')
    return { ok: true }
  })

  app.get('/ai/models', { schema: s('Models available at the LLM server'), preHandler: requirePerm('system.manage') }, async () => {
    try { return await listModels() } catch (e) { throw new HttpError(422, 'ai.unreachable', { message: e.message, url: aiConfig().url }) }
  })

  app.post('/ai/chat', {
    schema: s('Ask the assistant (tool calling, acts with the permissions of the user)', { body: { type: 'object', required: ['messages'], properties: {
      messages: { type: 'array', maxItems: 40, items: { type: 'object', required: ['role', 'content'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string', maxLength: 4000 } } } },
      lang: { type: 'string', maxLength: 5 },
    } } }),
    preHandler: requirePerm('ai.use'),
  }, async req => {
    if (!getSetting('features')?.assistant) throw new HttpError(403, 'feature.disabled', { feature: 'assistant' })
    try {
      return await chat(req.user, req.body.messages, req.body.lang ?? req.user.locale ?? 'de')
    } catch (e) {
      if (e.code === 'ai.no_model') throw new HttpError(409, 'ai.no_model')
      log('ai', 'error', 'ai.failed', { error: e.message }, req.user.id)
      throw new HttpError(502, 'ai.unreachable', { message: e.name === 'AbortError' ? 'timeout' : e.message, url: aiConfig().url })
    }
  })

  app.post('/ai/transcribe', { schema: s('Speech to text (raw audio body, OpenAI-compatible STT server)'), preHandler: requirePerm('ai.use') }, async req => {
    const c = aiConfig()
    if (!getSetting('privacy')?.microphone) throw new HttpError(403, 'privacy.microphone_off')
    if (!c.stt_url) throw new HttpError(409, 'ai.no_stt')
    if (!Buffer.isBuffer(req.body)) throw new HttpError(422, 'ai.bad_audio')
    const form = new FormData()
    const type = req.headers['content-type']?.split(';')[0] ?? 'audio/webm'
    form.append('file', new Blob([req.body], { type }), `speech.${type.split('/')[1] ?? 'webm'}`)
    form.append('model', c.stt_model || 'whisper-1')
    form.append('language', (req.user.locale ?? 'de').slice(0, 2))
    try {
      const r = await fetch(`${c.stt_url.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', body: form, headers: c.api_key ? { authorization: `Bearer ${c.api_key}` } : {}, signal: AbortSignal.timeout(60000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      return { text: ((await r.json()).text ?? '').trim() }
    } catch (e) {
      throw new HttpError(502, 'ai.stt_failed', { message: e.message })
    }
  })

  app.post('/ai/speak', { schema: s('Text to speech (OpenAI-compatible TTS server), returns audio', { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 2000 } } } }), preHandler: requirePerm('ai.use') }, async (req, reply) => {
    const c = aiConfig()
    if (!c.tts_url) throw new HttpError(409, 'ai.no_tts')
    try {
      const r = await fetch(`${c.tts_url.replace(/\/$/, '')}/audio/speech`, {
        method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', ...(c.api_key ? { authorization: `Bearer ${c.api_key}` } : {}) },
        body: JSON.stringify({ model: c.tts_model || 'tts-1', voice: c.tts_voice || 'alloy', input: req.body.text, response_format: 'mp3' }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return reply.type(r.headers.get('content-type') ?? 'audio/mpeg').send(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      throw new HttpError(502, 'ai.tts_failed', { message: e.message })
    }
  })
}
