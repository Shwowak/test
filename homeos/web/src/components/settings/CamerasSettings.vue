<script setup>
import { ref, onMounted, inject, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'
import { store, loadDevices } from '../../devices.js'
import { cams, loadCameras } from '../../cameras.js'
import CameraWidget from '../../widgets/CameraWidget.vue'

const { t } = useI18n()
const user = inject('user')
const canManage = computed(() => user.value?.permissions?.includes('cameras.manage'))
const form = ref(null)
const go2rtc = ref('')
const err = ref('')
const msg = ref('')

onMounted(async () => {
  await loadCameras()
  go2rtc.value = cams.go2rtc ?? ''
  if (!store.loaded) loadDevices().catch(() => {})
})

const call = async fn => { err.value = ''; msg.value = ''; try { await fn(); await loadCameras() } catch (e) { err.value = errorText(e) } }
const save = () => call(async () => {
  const f = form.value
  const body = { name: f.name, source: f.source, room_id: f.room_id ?? null, enabled: f.enabled !== false }
  if (f.id) await api('PUT', `/cameras/${f.id}`, body)
  else await api('POST', '/cameras', body)
  form.value = null
})
const remove = c => { if (confirm(t('cameras.confirm_delete', { name: c.name }))) call(() => api('DELETE', `/cameras/${c.id}`)) }
const saveGo2rtc = () => call(async () => { await api('PUT', '/cameras/settings', { go2rtc: go2rtc.value }); msg.value = t('plugins.saved') })
</script>

<template>
  <div>
    <p v-if="!cams.enabled" class="warn">🔒 {{ t('cameras.privacy_off_hint') }}</p>
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="msg" class="msg">{{ msg }}</p>

    <div class="grid">
      <div v-for="c in cams.list" :key="c.id" class="card">
        <div class="prev"><CameraWidget :camera-id="c.id" /></div>
        <div class="row">
          <div class="grow"><b>{{ c.name }}</b><small>{{ t('cameras.kinds.' + c.kind) }} · {{ c.source }}</small></div>
          <template v-if="canManage">
            <button class="btn icon" @click="form = { ...c }">✎</button>
            <button class="btn icon" @click="remove(c)">✕</button>
          </template>
        </div>
      </div>
    </div>
    <button v-if="canManage" class="btn primary" @click="form = { name: '', source: '', room_id: null, enabled: true }">＋ {{ t('cameras.add') }}</button>

    <form v-if="form" class="card edit" @submit.prevent="save">
      <div class="field"><label>{{ t('common.name') }}</label><input v-model="form.name" required maxlength="80"></div>
      <div class="field"><label>{{ t('cameras.source') }}</label><input v-model="form.source" required placeholder="rtsp://user:pass@192.168.1.50:554/stream1"></div>
      <small class="hint">{{ t('cameras.source_hint') }}</small>
      <div class="field"><label>{{ t('devices.room') }}</label><select v-model="form.room_id"><option :value="null">—</option><option v-for="r in store.rooms" :key="r.id" :value="r.id">{{ r.name }}</option></select></div>
      <div class="row"><button type="button" class="btn" @click="form = null">{{ t('common.cancel') }}</button><span class="grow" /><button class="btn primary">{{ t('common.save') }}</button></div>
    </form>

    <template v-if="canManage">
      <h3>go2rtc</h3>
      <p class="hint">{{ t('cameras.go2rtc_hint') }}</p>
      <form class="row field" @submit.prevent="saveGo2rtc"><input v-model="go2rtc" class="grow" placeholder="http://host.docker.internal:1984"><button class="btn">{{ t('common.save') }}</button></form>
    </template>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-bottom: 12px; }
.card { border: 1px solid var(--line); background: rgba(2, 6, 23, .4); }
.prev { position: relative; aspect-ratio: 16 / 9; }
.row { display: flex; gap: 8px; align-items: center; padding: 8px 10px; }
.row small { display: block; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.grow { flex: 1; min-width: 0; }
.edit { padding: 12px; margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.hint { color: var(--dim); font-size: 14px; }
.warn { color: var(--warn); }
.err { color: var(--err); }
.msg { color: var(--cyan); }
h3 { font-weight: 400; margin: 24px 0 6px; }
</style>
