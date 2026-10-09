<script setup>
import { ref } from 'vue'
import { useChart } from './useChart.js'

const props = defineProps({ widget: Object, data: Object })
const el = ref(null)

useChart(el, () => {
  const c = props.widget.config
  const color = c.color || '#8B5CF6'
  const v = Number(props.data?.value ?? 0)
  return {
    series: [{
      type: 'gauge',
      min: Number(c.min ?? 0),
      max: Number(c.max ?? 100),
      startAngle: 220,
      endAngle: -40,
      radius: '95%',
      center: ['50%', '58%'],
      progress: { show: true, width: 14, roundCap: true, itemStyle: { color, shadowColor: color, shadowBlur: document.documentElement.classList.contains('theme-apple') ? 0 : 18 } },
      axisLine: { lineStyle: { width: 14, color: [[1, 'rgba(148,163,184,0.12)']] }, roundCap: true },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      anchor: { show: false },
      title: { show: false },
      detail: {
        valueAnimation: true,
        offsetCenter: [0, '5%'],
        fontSize: 34,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        color: '#fff',
        formatter: val => `${Math.round(val * 10) / 10}{u|${props.data?.unit ?? ''}}`,
        rich: { u: { fontSize: 15, color: '#94a3b8', padding: [0, 0, 0, 4] } },
      },
      data: [{ value: isNaN(v) ? 0 : v }],
    }, {
      type: 'gauge', min: 0, max: 60, startAngle: 220, endAngle: -40, radius: '100%', center: ['50%', '58%'],
      axisLine: { show: false }, progress: { show: false }, pointer: { show: false }, detail: { show: false }, title: { show: false },
      splitLine: { show: false }, axisLabel: { show: false },
      axisTick: { distance: -6, length: 4, splitNumber: 1, lineStyle: { color: 'rgba(34,211,238,0.35)', width: 1 } },
      data: [],
    }],
  }
}, () => [props.data, props.widget.config])
</script>

<template>
  <div ref="el" class="g" />
</template>

<style scoped>
.g { position: absolute; inset: 0; }
</style>
