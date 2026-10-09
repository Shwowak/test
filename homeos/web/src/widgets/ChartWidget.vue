<script setup>
import { ref } from 'vue'
import { useChart, echarts } from './useChart.js'

const props = defineProps({ widget: Object, data: Object })
const el = ref(null)

const SPECTRUM = ['#22D3EE', '#3B82F6', '#8B5CF6', '#EC4899', '#F43F5E', '#F59E0B', '#FACC15', '#22C55E']
const grad = (dir, stops) => new echarts.graphic.LinearGradient(...(dir === 'h' ? [0, 0, 1, 0] : [0, 0, 0, 1]), stops.map((c, i) => ({ offset: i / (stops.length - 1), color: c })))

function neonLine(values, c1, c2, width = 3) {
  return {
    type: 'line', data: values, smooth: 0.45, symbol: 'none',
    lineStyle: { width, color: grad('h', [c1, c2]), shadowColor: c1, shadowBlur: document.documentElement.classList.contains('theme-apple') ? 0 : 18 },
    areaStyle: { color: grad('v', [c1 + '55', c1 + '00']) },
  }
}

useChart(el, () => {
  const c = props.widget.config
  const color = c.color || '#EC4899'
  const values = props.data?.values ?? []
  const style = c.style || 'line'
  const isBar = style === 'bar' || style === 'spectrum'
  let series
  if (style === 'spectrum') {
    series = [{
      type: 'bar', data: values.map((v, i) => {
        const col = SPECTRUM[i % SPECTRUM.length]
        return { value: v, itemStyle: { color: grad('v', [col, col + '10']), shadowColor: col, shadowBlur: document.documentElement.classList.contains('theme-apple') ? 0 : 12 } }
      }), barWidth: '45%',
    }]
  } else if (style === 'bar') {
    series = [{ type: 'bar', data: values, barWidth: '35%', itemStyle: { color: grad('v', [color, color + '10']), shadowColor: color, shadowBlur: document.documentElement.classList.contains('theme-apple') ? 0 : 12 } }]
  } else if (style === 'wave') {
    const shadow = values.map((v, i) => Number(((values[(i + 2) % values.length] ?? v) * 0.75).toFixed(2)))
    series = [neonLine(shadow, '#3B82F6', '#8B5CF6', 2), neonLine(values, color, '#8B5CF6', 3)]
  } else {
    series = [neonLine(values, color, '#22D3EE')]
  }
  return {
    grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(8,13,26,0.95)', borderColor: color, textStyle: { color: '#e2e8f0', fontFamily: 'ui-monospace, monospace' }, valueFormatter: v => `${v} ${props.data?.unit ?? ''}` },
    xAxis: { type: 'category', data: values.map((_, i) => i + 1), boundaryGap: isBar, axisLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } }, axisTick: { show: false }, axisLabel: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(148,163,184,0.07)', type: 'dashed' } }, axisLabel: { color: '#475569', fontSize: 10, fontFamily: 'ui-monospace, monospace' } },
    series,
  }
}, () => [props.data, props.widget.config])
</script>

<template>
  <div ref="el" class="ch" />
</template>

<style scoped>
.ch { position: absolute; inset: 0; }
</style>
