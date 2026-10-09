<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { cams, loadCameras } from '../cameras.js'

const props = defineProps({ widget: Object, editing: Boolean, cameraId: Number, fill: Boolean })
const { t } = useI18n()
const id = computed(() => props.cameraId ?? Number(props.widget?.config?.camera_id))
const cam = computed(() => cams.list.find(c => c.id === id.value))
const live = computed(() => cam.value && (cam.value.kind === 'mjpeg' || (cam.value.kind === 'stream' && cams.go2rtc)))
const tick = ref(Date.now())
const failed = ref(false)
let timer = null

onMounted(() => { if (!cams.loaded) loadCameras().catch(() => {}) })
function schedule() {
  clearInterval(timer)
  if (cam.value && !live.value) timer = setInterval(() => { tick.value = Date.now() }, 2000)
}
watch(cam, schedule, { immediate: true })
onBeforeUnmount(() => clearInterval(timer))
const src = computed(() => cam.value && (live.value ? `/api/v1/cameras/${cam.value.id}/live` : `/api/v1/cameras/${cam.value.id}/snapshot?t=${tick.value}`))
</script>

<template>
  <div class="cam" :class="{ fill }">
    <p v-if="cams.loaded && !cams.enabled" class="label">🔒 {{ t('cameras.privacy_off') }}</p>
    <p v-else-if="cams.loaded && !cam" class="label">{{ t('cameras.not_found') }}</p>
    <template v-else-if="cam">
      <img v-if="!editing" v-show="!failed" :src="src" :alt="cam.name" @error="failed = true" @load="failed = false">
      <div v-else class="ph">📷 {{ cam.name }}</div>
      <span class="tag"><i class="dot" />{{ cam.name }}</span>
      <p v-if="failed" class="label err">{{ t('cameras.offline') }}</p>
    </template>
  </div>
</template>

<style scoped>
.cam { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; }
.cam img { width: 100%; height: 100%; object-fit: cover; }
.cam.fill img { object-fit: contain; }
.ph { color: var(--dim); font-size: 20px; }
.tag { position: absolute; left: 10px; top: 8px; font-size: 13px; letter-spacing: .1em; padding: 2px 8px; background: rgba(0, 0, 0, .55); color: #fff; display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px #ef4444; animation: blink 1.5s infinite; }
.err { position: absolute; bottom: 8px; color: var(--err); }
@keyframes blink { 50% { opacity: .3; } }
</style>
