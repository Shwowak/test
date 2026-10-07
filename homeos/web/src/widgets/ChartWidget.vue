<script setup>
import { ref } from 'vue'
import { useChart, echarts } from './useChart.js'

const props = defineProps({ widget: Object, data: Object })
const el = ref(null)

useChart(el, () => {
  const c = props.widget.config
  const color = c.color || '#EC4899'
  const values = props.data?.values ?? []
  const bar = c.style === 'bar'
  return {
    grid: { left: 8, right: 8, top: 10, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(15,23,42,0.95)', borderColor: color, textStyle: { color: '#e2e8f0' }, valueFormatter: v => `${v} ${props.data?.unit ?? ''}` },
    xAxis: { type: 'category', data: values.map((_, i) => i + 1), show: false, boundaryGap: bar },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(148,163,184,0.08)' } }, axisLabel: { color: '#64748b' } },
    series: [bar
      ? {
          type: 'bar', data: values, barWidth: '55%',
          itemStyle: { borderRadius: [4, 4, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color }, { offset: 1, color: color + '22' }]), shadowColor: color, shadowBlur: 10 },
        }
      : {
          type: 'line', data: values, smooth: true, symbol: 'none',
          lineStyle: { width: 3, color, shadowColor: color, shadowBlur: 16 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + '55' }, { offset: 1, color: color + '00' }]) },
        }],
  }
}, () => [props.data, props.widget.config])
</script>

<template>
  <div ref="el" class="ch" />
</template>

<style scoped>
.ch { position: absolute; inset: 0; }
</style>
