<script setup>
import { ref, onMounted, inject, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'
import { speak } from '../../speech.js'

const { t } = useI18n()
const user = inject('user')
const canManage = computed(() => user.value?.permissions?.includes('system.manage'))
const s = ref(null)
const models = ref([])
const msg = ref('')
const err = ref('')

async function load() {
  s.value = await api('GET', '/ai/settings')
  if (canManage.value) loadModels()
}
async function loadModels() {
  err.value = ''
  try { models.value = await api('GET', '/ai/models') } catch (e) { models.value = []; err.value = errorText(e) + (e.details?.message ? ` – ${e.details.message} (${e.details.url})` : '') }
}
onMounted(load)

async function save() {
  msg.value = ''
  err.value = ''
  try {
    const { privacy, ...ai } = s.value
    await api('PUT', '/ai/settings', { ...ai, privacy })
    msg.value = t('plugins.saved')
    await load()
  } catch (e) { err.value = errorText(e) }
}
const gb = n => n ? ` · ${(n / 1e9).toFixed(1)} GB` : ''
</script>

<template>
  <form v-if="s" @submit.prevent="save">
    <h3>{{ t('ai.privacy') }}</h3>
    <label class="chk"><input v-model="s.privacy.microphone" type="checkbox" :disabled="!canManage"> 🎙 {{ t('ai.allow_mic') }}</label>
    <label class="chk"><input v-model="s.privacy.cameras" type="checkbox" :disabled="!canManage"> 📷 {{ t('ai.allow_cameras') }}</label>

    <template v-if="canManage">
      <h3>{{ t('ai.llm') }}</h3>
      <p class="hint">{{ t('ai.llm_hint') }}</p>
      <div class="two">
        <div class="field"><label>{{ t('ai.provider') }}</label><select v-model="s.provider"><option value="ollama">Ollama</option><option value="openai">{{ t('ai.openai_compat') }}</option></select></div>
        <div class="field"><label>URL</label><input v-model="s.url" :placeholder="s.provider === 'ollama' ? 'http://host.docker.internal:11434' : 'http://localhost:1234/v1'"></div>
      </div>
      <div class="two">
        <div class="field">
          <label>{{ t('ai.model') }}</label>
          <div class="row">
            <select v-if="models.length" v-model="s.model" class="grow"><option value="">—</option><option v-for="m in models" :key="m.name" :value="m.name">{{ m.name }}{{ gb(m.size) }}</option></select>
            <input v-else v-model="s.model" class="grow" placeholder="qwen2.5:7b">
            <button type="button" class="btn icon" :title="t('ai.reload')" @click="loadModels">⟳</button>
          </div>
        </div>
        <div v-if="s.provider === 'openai'" class="field"><label>API-Key</label><input v-model="s.api_key" type="password" autocomplete="off"></div>
      </div>
      <p class="hint">{{ t('ai.model_hint') }}</p>

      <h3>{{ t('ai.voice') }}</h3>
      <p class="hint">{{ t('ai.voice_hint') }}</p>
      <div class="two">
        <div class="field"><label>{{ t('ai.stt_url') }}</label><input v-model="s.stt_url" placeholder="http://host.docker.internal:8000/v1"></div>
        <div class="field"><label>{{ t('ai.stt_model') }}</label><input v-model="s.stt_model" placeholder="Systran/faster-whisper-small"></div>
        <div class="field"><label>{{ t('ai.tts_url') }}</label><input v-model="s.tts_url" placeholder="http://host.docker.internal:8000/v1"></div>
        <div class="field"><label>{{ t('ai.tts_model') }} / {{ t('ai.tts_voice') }}</label><div class="row"><input v-model="s.tts_model" class="grow" placeholder="speaches-ai/piper-de_DE-thorsten-medium"><input v-model="s.tts_voice" class="grow" placeholder="thorsten"></div></div>
      </div>
      <label class="chk"><input v-model="s.speak" type="checkbox"> {{ t('ai.speak_replies') }}</label>
      <button type="button" class="btn" @click="speak(t('ai.test_sentence'))">♪ {{ t('ai.test_voice') }}</button>
    </template>

    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="msg" class="msg">{{ msg }}</p>
    <div v-if="canManage" class="row end"><button class="btn primary">{{ t('common.save') }}</button></div>
  </form>
</template>

<style scoped>
h3 { font-weight: 400; margin: 22px 0 8px; }
.hint { color: var(--dim); font-size: 14px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row { display: flex; gap: 8px; align-items: center; }
.row.end { justify-content: flex-end; margin-top: 16px; }
.grow { flex: 1; min-width: 0; }
.chk { display: flex; gap: 10px; align-items: center; padding: 6px 0; }
.err { color: var(--err); }
.msg { color: var(--cyan); }
@media (max-width: 700px) { .two { grid-template-columns: 1fr; } }
</style>
