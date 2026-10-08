<script setup>
import { ref, computed } from 'vue'
import { api } from '../api.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({ widget: Object, data: Object, editing: Boolean })
const emit = defineEmits(['changed'])
const busy = ref(false)
const on = computed(() => props.data?.value === 'on')

async function toggle() {
  if (props.editing || busy.value) return
  busy.value = true
  try {
    await api('POST', `/widgets/${props.widget.id}/action`)
    emit('changed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button class="sw no-drag" :class="{ on, busy }" :aria-pressed="on" @click="toggle">
    <span class="knob" />
    <span class="state">{{ data ? (on ? t('switch.on') : data.value === 'off' ? t('switch.off') : data.value) : '…' }}</span>
  </button>
</template>

<style scoped>
.sw { width: 100%; height: 100%; min-height: 64px; border: 1px solid var(--line); border-radius: 14px; background: rgba(2, 6, 23, 0.5); display: flex; align-items: center; justify-content: center; gap: 16px; cursor: pointer; font-size: 22px; }
.knob { width: 22px; height: 22px; border-radius: 50%; background: #475569; transition: 0.2s; }
.on { border-color: var(--gold); background: rgba(245, 158, 11, 0.12); box-shadow: 0 0 30px rgba(245, 158, 11, 0.25) inset; }
.on .knob { background: var(--gold); box-shadow: 0 0 16px var(--gold); }
.busy { opacity: 0.6; }
.sw:active { transform: scale(0.97); }
</style>
