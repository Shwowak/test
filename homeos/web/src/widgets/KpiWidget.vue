<script setup>
import { computed } from 'vue'

const props = defineProps({ widget: Object, data: Object })
const color = computed(() => props.widget.config.color || '#22D3EE')
const text = computed(() => {
  const v = props.data?.value
  if (v === null || v === undefined) return '—'
  const d = props.widget.config.decimals
  return typeof v === 'number' && d !== undefined && d !== '' ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : String(v)
})
</script>

<template>
  <div class="k">
    <div class="v" :style="{ color, textShadow: `0 0 22px ${color}88` }">{{ text }}<span class="u">{{ data?.unit }}</span></div>
    <div v-if="data?.label" class="label">{{ data.label }}</div>
  </div>
</template>

<style scoped>
.k { height: 100%; display: flex; flex-direction: column; justify-content: center; container-type: size; }
.v { font-family: var(--mono); font-size: clamp(28px, 48cqh, 110px); line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.u { font-size: 0.38em; color: var(--dim); margin-left: 8px; }
</style>
