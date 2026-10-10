<script setup>
import { ref, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { store, loadDevices } from '../../devices.js'
import { errorText } from '../../i18n.js'
import DeviceControl from './DeviceControl.vue'
import DeviceHistory from './DeviceHistory.vue'

const props = defineProps({ device: Object })
const emit = defineEmits(['close'])
const { t, d: fd } = useI18n()
const user = inject('user')
const can = p => user.value?.permissions?.includes(p)
const form = ref({ name: props.device.name, room_id: props.device.room_id, type: props.device.type, groups: props.device.groups.join(', ') })
const error = ref('')
const integration = computed(() => store.integrations.find(i => i.id === props.device.integration_id))

async function save() {
  error.value = ''
  try {
    await api('PUT', `/devices/${props.device.id}`, {
      name: form.value.name, room_id: form.value.room_id, type: form.value.type,
      groups: form.value.groups.split(',').map(s => s.trim()).filter(Boolean),
    })
    await loadDevices()
    emit('close')
  } catch (e) {
    error.value = errorText(e)
  }
}

async function remove() {
  if (!confirm(t('devices.confirm_delete', { name: props.device.name }))) return
  await api('DELETE', `/devices/${props.device.id}`)
  await loadDevices()
  emit('close')
}
</script>

<template>
  <DeviceControl :device="device" :disabled="!can('devices.control')" />
  <DeviceHistory :device="device" />

  <form v-if="can('devices.manage')" class="form" @submit.prevent="save">
    <div class="field"><label>{{ t('common.name') }}</label><input v-model="form.name" required maxlength="80"></div>
    <div class="field">
      <label>{{ t('rooms.room') }}</label>
      <select v-model="form.room_id">
        <option :value="null">{{ t('rooms.none') }}</option>
        <option v-for="r in store.rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
    </div>
    <div class="field">
      <label>{{ t('devices.type') }}</label>
      <select v-model="form.type"><option v-for="ty in store.registry?.types ?? []" :key="ty" :value="ty">{{ t('deviceTypes.' + ty) }}</option></select>
    </div>
    <div class="field"><label>{{ t('devices.groups') }}</label><input v-model="form.groups" :placeholder="t('devices.groups_placeholder')"></div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="btn danger" @click="remove">{{ t('common.delete') }}</button>
      <span class="grow" />
      <button class="btn primary">{{ t('common.save') }}</button>
    </div>
  </form>

  <dl class="info">
    <dt>{{ t('devices.connection') }}</dt><dd :class="device.connection">{{ t('connection.' + device.connection) }}</dd>
    <dt>{{ t('devices.integration') }}</dt><dd>{{ integration?.name ?? '#' + device.integration_id }}</dd>
    <dt>{{ t('devices.manufacturer') }}</dt><dd>{{ device.manufacturer ?? '—' }}</dd>
    <dt>{{ t('devices.model') }}</dt><dd>{{ device.model ?? '—' }}</dd>
    <dt>{{ t('devices.id') }}</dt><dd class="mono">{{ device.native_id }}</dd>
    <dt v-if="device.battery != null">{{ t('devices.battery') }}</dt><dd v-if="device.battery != null">{{ Math.round(device.battery) }} %</dd>
    <dt>{{ t('devices.last_seen') }}</dt><dd>{{ device.last_seen ? fd(new Date(device.last_seen), 'long') : '—' }}</dd>
    <dt>{{ t('devices.capabilities') }}</dt><dd>{{ device.capabilities.map(c => t('capabilities.' + c.id, c.id)).join(', ') }}</dd>
  </dl>
</template>

<style scoped>
.form { margin-top: 24px; }
.row { display: flex; gap: 10px; }
.grow { flex: 1; }
.info { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin-top: 24px; font-size: 15px; }
.info dt { color: var(--dim); }
.info dd { margin: 0; }
.online { color: #86efac; }
.offline { color: #fda4af; }
.mono { font-family: var(--mono); font-size: 13px; word-break: break-all; }
</style>
