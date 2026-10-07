<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const now = ref(new Date())
let t
onMounted(() => { t = setInterval(() => (now.value = new Date()), 1000) })
onBeforeUnmount(() => clearInterval(t))

const time = d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
const sec = d => String(d.getSeconds()).padStart(2, '0')
const date = d => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <div class="c">
    <div class="t">{{ time(now) }}<span class="s">{{ sec(now) }}</span></div>
    <div class="d">{{ date(now) }}</div>
  </div>
</template>

<style scoped>
.c { height: 100%; display: flex; flex-direction: column; justify-content: center; container-type: size; }
.t { font-family: var(--mono); font-size: clamp(36px, 38cqh, 140px); font-weight: 300; line-height: 1; color: #fff; text-shadow: 0 0 24px rgba(34, 211, 238, 0.55); }
.s { font-size: 0.35em; color: var(--cyan); margin-left: 8px; vertical-align: top; }
.d { margin-top: 10px; font-size: clamp(15px, 10cqh, 28px); color: var(--dim); }
</style>
