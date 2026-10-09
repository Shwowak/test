<script setup>
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { store, loadDevices } from '../devices.js'
import DeviceControl from '../components/devices/DeviceControl.vue'
import { features } from '../features.js'

const props = defineProps({ widget: Object, editing: Boolean })
const { t } = useI18n()
const user = inject('user')
if (!store.loaded) loadDevices().catch(() => {})
const device = computed(() => store.devices[props.widget.config.device_id])
</script>

<template>
  <DeviceControl v-if="device" :device="device" compact :disabled="editing || !features.control || !user.permissions.includes('devices.control')" />
  <p v-else class="label">{{ t('devices.not_found') }}</p>
</template>
