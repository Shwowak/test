<script setup>
import { ref, nextTick, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'
import { voice, speak, stopSpeaking, startRecording, stopRecording, micAvailable } from '../../speech.js'

const props = defineProps({ autoListen: Boolean })
const { t, locale } = useI18n()
const messages = ref([])
const input = ref('')
const busy = ref(false)
const err = ref('')
const cfg = ref(null)
const list = ref(null)
const TOOL_ICONS = { control_device: '⏻', get_devices: '▦', get_weather: '☀', get_calendar: '▤', get_energy: '⚡', run_automation: '⟳', list_automations: '⟳', show_dashboard: '◈', show_camera: '📷', create_notification: '🔔' }

const micOk = computed(() => micAvailable() && cfg.value?.privacy?.microphone && cfg.value?.stt_url !== '')

onMounted(async () => {
  try { cfg.value = await api('GET', '/ai/settings') } catch {}
  if (props.autoListen && micOk.value) listen()
})

const scroll = () => nextTick(() => { if (list.value) list.value.scrollTop = list.value.scrollHeight })

async function send(text) {
  text = (text ?? input.value).trim()
  if (!text || busy.value) return
  input.value = ''
  err.value = ''
  messages.value.push({ role: 'user', content: text })
  busy.value = true
  scroll()
  try {
    const r = await api('POST', '/ai/chat', { messages: messages.value.map(({ role, content }) => ({ role, content })), lang: locale.value })
    messages.value.push({ role: 'assistant', content: r.reply || '…', actions: r.actions })
    if (cfg.value?.speak !== false) speak(r.reply)
  } catch (e) {
    err.value = errorText(e) + (e.details?.message ? ` – ${e.details.message}` : '')
  } finally {
    busy.value = false
    scroll()
  }
}

async function listen() {
  if (voice.recording) { stopRecording(); return }
  err.value = ''
  try {
    await startRecording(async blob => {
      busy.value = true
      try {
        const r = await fetch('/api/v1/ai/transcribe', { method: 'POST', headers: { 'content-type': blob.type.split(';')[0] }, body: blob, credentials: 'same-origin' })
        const body = await r.json()
        if (!r.ok) throw Object.assign(new Error(body.error), { code: body.error, details: body.details })
        busy.value = false
        if (body.text) send(body.text)
      } catch (e) {
        busy.value = false
        err.value = errorText(e) + (e.details?.message ? ` – ${e.details.message}` : '')
      }
    })
  } catch (e) {
    err.value = t('assistant.mic_denied')
  }
}

const examples = computed(() => t('assistant.examples').split(';'))
</script>

<template>
  <div class="as">
    <div ref="list" class="msgs">
      <div v-if="!messages.length" class="hello">
        <div class="orb" :class="{ live: voice.recording, talk: voice.speaking }" />
        <p>{{ t('assistant.hello') }}</p>
        <div class="ex"><button v-for="x in examples" :key="x" class="btn" @click="send(x)">{{ x }}</button></div>
      </div>
      <div v-for="(m, i) in messages" :key="i" class="m" :class="m.role">
        <div class="bubble">{{ m.content }}</div>
        <div v-if="m.actions?.length" class="acts">
          <span v-for="(a, j) in m.actions" :key="j" class="chip" :class="{ bad: a.result?.error }" :title="JSON.stringify(a.args)">{{ TOOL_ICONS[a.tool] ?? '◈' }} {{ a.result?.device ?? a.result?.automation ?? a.result?.dashboard ?? a.result?.camera ?? t('assistant.tools.' + a.tool, a.tool) }}{{ a.result?.error ? ' ✕' : '' }}</span>
        </div>
      </div>
      <div v-if="busy" class="m assistant"><div class="bubble dots"><span /><span /><span /></div></div>
    </div>
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="cfg && !cfg.model" class="hint">{{ t('assistant.no_model') }}</p>
    <form class="bar" @submit.prevent="send()">
      <button v-if="micOk" type="button" class="btn icon mic" :class="{ rec: voice.recording }" :aria-label="t('assistant.speak')" @click="listen">🎙</button>
      <input v-model="input" :placeholder="voice.recording ? t('assistant.listening') : t('assistant.placeholder')" maxlength="2000" autocomplete="off">
      <button v-if="voice.speaking" type="button" class="btn icon" @click="stopSpeaking">■</button>
      <button class="btn primary" :disabled="busy || !input.trim()">➤</button>
    </form>
  </div>
</template>

<style scoped>
.as { display: flex; flex-direction: column; height: 100%; min-height: 60vh; }
.msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-bottom: 12px; }
.hello { text-align: center; color: var(--dim); margin: auto 0; }
.orb { width: 110px; height: 110px; margin: 10px auto 18px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #67e8f9, #7c3aed 60%, #0b1022 75%); box-shadow: 0 0 40px rgba(34, 211, 238, .45); animation: breathe 4s ease-in-out infinite; }
.orb.live { animation-duration: .8s; box-shadow: 0 0 70px rgba(239, 68, 68, .6); }
.orb.talk { animation-duration: 1.2s; }
.ex { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 14px; }
.ex .btn { font-size: 14px; }
.m { display: flex; flex-direction: column; max-width: 85%; }
.m.user { align-self: flex-end; align-items: flex-end; }
.bubble { padding: 10px 14px; border: 1px solid var(--line); background: rgba(148, 163, 184, .08); white-space: pre-wrap; font-size: 17px; line-height: 1.45; }
.m.user .bubble { background: rgba(34, 211, 238, .14); border-color: rgba(34, 211, 238, .4); }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { font-size: 12px; padding: 2px 8px; border: 1px solid var(--ok); color: var(--ok); }
.chip.bad { border-color: var(--err); color: var(--err); }
.dots { display: flex; gap: 6px; }
.dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); animation: blink 1s infinite; }
.dots span:nth-child(2) { animation-delay: .2s; }
.dots span:nth-child(3) { animation-delay: .4s; }
.bar { display: flex; gap: 8px; align-items: center; padding-top: 10px; border-top: 1px solid var(--line); }
.bar input { flex: 1; min-height: 52px; }
.mic { font-size: 22px; }
.mic.rec { background: rgba(239, 68, 68, .3); border-color: #ef4444; animation: blink 1s infinite; }
.err { color: var(--err); }
.hint { color: var(--warn); }
@keyframes breathe { 50% { transform: scale(1.06); filter: hue-rotate(25deg); } }
@keyframes blink { 50% { opacity: .35; } }
</style>
