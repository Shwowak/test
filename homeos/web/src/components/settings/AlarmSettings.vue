<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'

const { t } = useI18n()
const cfg = ref(null)
const msg = ref('')
const err = ref('')
const hook = computed(() => cfg.value?.secret ? `${location.origin}/api/v1/alarm/hook/${cfg.value.secret}` : '')

onMounted(async () => {
  cfg.value = await api('GET', '/alarm/config')
  if (!cfg.value.secret) cfg.value = await api('PUT', '/alarm/config', {})
})

async function save(extra = {}) {
  err.value = ''; msg.value = ''
  try {
    const { secret, ...body } = cfg.value
    cfg.value = await api('PUT', '/alarm/config', { ...body, duration: Number(body.duration), sound_seconds: Number(body.sound_seconds), ...extra })
    msg.value = t('common.saved')
  } catch (e) { err.value = errorText(e) }
}
const test = () => api('POST', '/alarm/test').catch(e => { err.value = errorText(e) })
const copy = () => navigator.clipboard?.writeText(hook.value).then(() => { msg.value = t('alarm.copied') }).catch(() => {})
</script>

<template>
  <form v-if="cfg" @submit.prevent="save()">
    <p class="hint">{{ t('alarm.hint') }}</p>
    <label class="check"><input v-model="cfg.enabled" type="checkbox"> {{ t('alarm.enabled') }}</label>
    <div class="field">
      <label>{{ t('alarm.monitor_url') }}</label>
      <input v-model="cfg.monitor_url" type="url" placeholder="https://app.groupalarm.com/monitor/…">
      <small class="hint">{{ t('alarm.monitor_help') }}</small>
    </div>
    <div class="field">
      <label>{{ t('alarm.webhook') }}</label>
      <div class="row"><input :value="hook" readonly @focus="$event.target.select()"><button type="button" class="btn" @click="copy">⧉</button></div>
      <small class="hint">{{ t('alarm.webhook_help') }}</small>
    </div>
    <div class="field"><label>{{ t('alarm.duration') }}</label><input v-model="cfg.duration" type="number" min="1" max="720"></div>
    <label class="check"><input v-model="cfg.screen_on" type="checkbox"> {{ t('alarm.screen_on') }}</label>
    <label class="check"><input v-model="cfg.sound" type="checkbox"> {{ t('alarm.sound') }}</label>
    <div v-if="cfg.sound" class="field"><label>{{ t('alarm.sound_seconds') }}</label><input v-model="cfg.sound_seconds" type="number" min="0" max="600"></div>
    <p v-if="msg" class="hint">{{ msg }}</p>
    <p v-if="err" class="error">{{ err }}</p>
    <div class="row">
      <button type="button" class="btn" @click="save({ regenerate: true })">{{ t('alarm.regenerate') }}</button>
      <button type="button" class="btn" :disabled="!cfg.enabled" @click="test">{{ t('alarm.test') }}</button>
      <span class="grow" />
      <button class="btn primary">{{ t('common.save') }}</button>
    </div>
  </form>
</template>
