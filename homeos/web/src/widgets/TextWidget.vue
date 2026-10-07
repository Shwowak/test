<script setup>
defineProps({ widget: Object })
</script>

<template>
  <p class="t">{{ widget.config.text }}</p>
</template>

<style scoped>
.t { margin: 0; font-size: 20px; line-height: 1.5; white-space: pre-wrap; overflow: auto; height: 100%; }
</style>
