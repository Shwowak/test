<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { useChart } from '../../widgets/useChart.js'

const props = defineProps({ device: Object })
const { t } = useI18n()
const caps = computed(() => props.device.capabilities.filter(c => c.kind === 'measurement'))
const cap = ref(caps.value[0]?.id ?? null)
const hours = ref(24)
const series = ref([])
const el = ref(null)
const RANGES = [1, 6, 24, 168, 720]

async function load() {
  if (!cap.value) return
  series.value = await api('GET', `/devices/${props.device.id}/history?cap=${encodeURIComponent(cap.value)}&hours=${hours.value}`).catch(() => [])
}
onMounted(load)
watch([cap, hours], load)

useChart(el, () => {
  const unit = caps.value.find(c => c.id === cap.value)?.unit ?? ''
  return {
    grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: v => `${v} ${unit}` },
    xAxis: { type: 'time', axisLabel: { color: '#8e8e93', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(148,163,184,0.2)' } } },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.08)', type: 'dashed' } }, axisLabel: { color: '#8e8e93', fontSize: 10 } },
    series: [{ type: 'line', data: series.value, showSymbol: false, smooth: 0.3, lineStyle: { width: 2, color: '#0A84FF' }, areaStyle: { color: 'rgba(10,132,255,0.15)' } }],
  }
}, series)
</script>

<template>
  <div v-if="caps.length" class="hist">
    <div class="row">
      <select v-if="caps.length > 1" v-model="cap"><option v-for="c in caps" :key="c.id" :value="c.id">{{ t('quantities.' + c.quantity, c.quantity) }}</option></select>
      <span class="grow" />
      <button v-for="h in RANGES" :key="h" class="btn" :class="{ active: hours === h }" @click="hours = h">{{ t('history.r' + h) }}</button>
    </div>
    <div ref="el" class="chart" />
    <p v-if="!series.length" class="hint">{{ t('history.empty') }}</p>
  </div>
</template>

<style scoped>
.hist { margin: 18px 0; }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.row .btn { min-height: 38px; padding: 0 12px; font-size: 14px; }
.chart { height: 220px; }
</style>
