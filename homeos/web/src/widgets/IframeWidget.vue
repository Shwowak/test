<script setup>
defineProps({ widget: Object, editing: Boolean })
</script>

<template>
  <iframe v-if="widget.config.url" :src="widget.config.url" :style="{ pointerEvents: editing ? 'none' : 'auto' }" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer" />
  <p v-else class="label">{{ $t('widget.no_url') }}</p>
</template>

<style scoped>
iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 10px; background: #fff; }
</style>
