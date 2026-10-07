<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { GridStack } from 'gridstack'
import { api } from '../api.js'
import WidgetView from './WidgetView.vue'
import WidgetEditor from './WidgetEditor.vue'
import Sheet from './Sheet.vue'

const props = defineProps({ dashboard: Object, editing: Boolean, meta: Object, sources: Array })

const widgets = ref([])
const el = ref(null)
const editorFor = ref(null)
let grid = null

async function load() {
  widgets.value = await api('GET', `/dashboards/${props.dashboard.id}/widgets`)
  await nextTick()
  initGrid()
}

function initGrid() {
  grid?.destroy(false)
  grid = GridStack.init({
    column: 12,
    cellHeight: 90,
    margin: 0,
    float: false,
    staticGrid: !props.editing,
    animate: true,
    columnOpts: { breakpoints: [{ w: 700, c: 1 }, { w: 1100, c: 6 }] },
    draggable: { cancel: '.no-drag' },
    resizable: { handles: 'se' },
  }, el.value)
  grid.on('change', saveLayout)
}

async function saveLayout() {
  if (!props.editing) return
  const layout = grid.getGridItems().map(n => ({
    id: Number(n.gridstackNode.id), x: n.gridstackNode.x, y: n.gridstackNode.y, w: n.gridstackNode.w, h: n.gridstackNode.h,
  }))
  for (const l of layout) Object.assign(widgets.value.find(w => w.id === l.id) ?? {}, l)
  await api('PUT', `/dashboards/${props.dashboard.id}/layout`, layout)
}

watch(() => props.editing, v => grid?.setStatic(!v))

onMounted(load)
onBeforeUnmount(() => grid?.destroy(false))

function addWidget() {
  editorFor.value = { type: 'kpi', title: '', w: 3, h: 2, source_id: null, config: {} }
}

async function saved() {
  editorFor.value = null
  await load()
}
</script>

<template>
  <div :class="`style-${dashboard.style || 'seamless'}`">
    <div ref="el" class="grid-stack">
      <div
        v-for="w in widgets" :key="w.id" class="grid-stack-item"
        :gs-id="w.id" :gs-x="w.x" :gs-y="w.y" :gs-w="w.w" :gs-h="w.h"
      >
        <div class="grid-stack-item-content" :class="{ edit: editing }">
          <WidgetView :widget="w" :editing="editing" />
          <button v-if="editing" class="btn icon cfg no-drag" aria-label="Widget bearbeiten" @click="editorFor = w">⚙</button>
        </div>
      </div>
    </div>

    <button v-if="editing" class="btn primary add" @click="addWidget">＋ Widget hinzufügen</button>

    <Sheet v-if="editorFor" :title="editorFor.id ? 'Widget bearbeiten' : 'Neues Widget'" @close="editorFor = null">
      <WidgetEditor :widget="editorFor" :dashboard-id="dashboard.id" :meta="meta" :sources="sources" @saved="saved" />
    </Sheet>
  </div>
</template>

<style scoped>
.grid-stack { min-height: 200px; }
.style-tiles .grid-stack { border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.edit { outline: 1px dashed rgba(34, 211, 238, 0.35); outline-offset: -1px; cursor: grab; }
.cfg { position: absolute; top: 8px; right: 8px; z-index: 5; min-height: 48px; min-width: 48px; font-size: 20px; }
.add { margin: 18px 0; width: 100%; border-radius: 0; min-height: 72px; font-size: 20px; border-style: dashed; }
</style>
