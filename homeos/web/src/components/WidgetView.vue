<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { api } from '../api.js'
import ClockWidget from '../widgets/ClockWidget.vue'
import TextWidget from '../widgets/TextWidget.vue'
import KpiWidget from '../widgets/KpiWidget.vue'
import GaugeWidget from '../widgets/GaugeWidget.vue'
import ChartWidget from '../widgets/ChartWidget.vue'
import CalendarWidget from '../widgets/CalendarWidget.vue'
import SwitchWidget from '../widgets/SwitchWidget.vue'
import IframeWidget from '../widgets/IframeWidget.vue'

const props = defineProps({ widget: Object, editing: Boolean })

const components = {
  clock: ClockWidget, text: TextWidget, kpi: KpiWidget, gauge: GaugeWidget,
  chart: ChartWidget, calendar: CalendarWidget, switch: SwitchWidget, iframe: IframeWidget,
}
const needsData = ['kpi', 'gauge', 'chart', 'calendar', 'switch']

const data = ref(null)
const error = ref('')
let timer = null

const comp = computed(() => components[props.widget.type])

async function refresh() {
  if (!needsData.includes(props.widget.type)) return
  try {
    data.value = await api('GET', `/widgets/${props.widget.id}/data`)
    error.value = ''
  } catch (e) {
    error.value = e.message
  }
}

function schedule() {
  clearInterval(timer)
  refresh()
  timer = setInterval(refresh, Math.max(5, props.widget.config.refresh ?? 30) * 1000)
}

onMounted(schedule)
onBeforeUnmount(() => clearInterval(timer))
watch(() => props.widget, schedule, { deep: true })
</script>

<template>
  <div class="w">
    <div v-if="widget.title" class="label title">{{ widget.title }}</div>
    <div class="content">
      <component :is="comp" :widget="widget" :data="data" :editing="editing" @changed="refresh" />
    </div>
    <div v-if="error" class="err" :title="error">⚠ {{ error }}</div>
  </div>
</template>

<style scoped>
.w { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 16px 18px; }
.title { flex: none; margin-bottom: 6px; font-size: 11px; display: flex; align-items: center; gap: 8px; padding-right: 52px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.content { flex: 1; min-height: 0; position: relative; }
.err { position: absolute; left: 12px; right: 12px; bottom: 10px; font-size: 12px; color: #fda4af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title::before { content: ''; width: 6px; height: 6px; flex: none; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
</style>
