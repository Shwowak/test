import { onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, GaugeChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, BarChart, GaugeChart, GridComponent, TooltipComponent, CanvasRenderer])

export { echarts }

export function useChart(el, buildOption, deps) {
  let chart = null
  let ro = null
  const render = () => chart?.setOption(buildOption(), true)
  onMounted(() => {
    chart = echarts.init(el.value, null, { renderer: 'canvas' })
    render()
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(el.value)
  })
  onBeforeUnmount(() => { ro?.disconnect(); chart?.dispose() })
  watch(deps, render, { deep: true })
}
