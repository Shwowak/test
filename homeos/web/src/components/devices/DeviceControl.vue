<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { command } from '../../devices.js'
import { errorText } from '../../i18n.js'

const props = defineProps({ device: Object, compact: Boolean, disabled: Boolean })
const { t, n } = useI18n()
const error = ref('')
const caps = computed(() => Object.fromEntries(props.device.capabilities.map(c => [c.id, c])))
const s = computed(() => props.device.state ?? {})
const offline = computed(() => props.device.connection === 'offline')
const measures = computed(() => props.device.capabilities.filter(c => c.kind === 'measurement'))
const binaries = computed(() => props.device.capabilities.filter(c => c.kind === 'binary'))

async function send(cap, value) {
  if (props.disabled) return
  error.value = ''
  try {
    await command(props.device.id, cap, value)
  } catch (e) {
    error.value = errorText(e)
  }
}

const fmt = (v, c) => typeof v === 'number' ? n(v, { maximumFractionDigits: c.quantity === 'temperature' ? 1 : 2 }) : (v ?? '—')
const binText = (id, v) => t(`binary.${id}.${v ? 'on' : 'off'}`, t(`binary.default.${v ? 'on' : 'off'}`))
const adjustTemp = d => {
  const c = caps.value.target_temperature
  const v = Math.min(c.max ?? 30, Math.max(c.min ?? 5, Number(s.value.target_temperature ?? 20) + d * (c.step ?? 0.5)))
  send('target_temperature', v)
}
</script>

<template>
  <div class="ctl no-drag" :class="{ compact, offline }">
    <button v-if="caps.onoff" class="power" :class="{ on: s.onoff }" :disabled="disabled || offline" :aria-pressed="!!s.onoff" @click="send('onoff', !s.onoff)">
      <span class="knob" /><span>{{ s.onoff ? t('switch.on') : t('switch.off') }}</span>
    </button>

    <label v-if="caps.brightness" class="slider">
      <span class="lbl">{{ t('capabilities.brightness') }} <b>{{ s.brightness ?? 0 }} %</b></span>
      <input type="range" min="0" max="100" step="1" :value="s.brightness ?? 0" :disabled="disabled || offline" @change="send('brightness', Number($event.target.value))">
    </label>

    <template v-if="caps.cover">
      <div class="row3">
        <button class="btn" :disabled="disabled || offline" @click="send('cover', 'open')">▲</button>
        <button class="btn" :disabled="disabled || offline" @click="send('cover', 'stop')">■</button>
        <button class="btn" :disabled="disabled || offline" @click="send('cover', 'close')">▼</button>
      </div>
      <label v-if="caps.position" class="slider">
        <span class="lbl">{{ t('capabilities.position') }} <b>{{ s.position ?? '—' }} %</b></span>
        <input type="range" min="0" max="100" step="5" :value="s.position ?? 0" :disabled="disabled || offline" @change="send('position', Number($event.target.value))">
      </label>
    </template>

    <div v-if="caps.target_temperature" class="thermo">
      <button class="btn icon" :disabled="disabled || offline" @click="adjustTemp(-1)">−</button>
      <div class="val"><b>{{ fmt(s.target_temperature, { quantity: 'temperature' }) }}</b><small>°C</small></div>
      <button class="btn icon" :disabled="disabled || offline" @click="adjustTemp(1)">＋</button>
    </div>

    <button v-if="caps.lock" class="power" :class="{ on: s.lock }" :disabled="disabled || offline" @click="send('lock', !s.lock)">
      <span class="knob" /><span>{{ s.lock ? t('capabilities.locked') : t('capabilities.unlocked') }}</span>
    </button>

    <div v-for="c in measures" :key="c.id" class="measure">
      <span class="num">{{ fmt(s[c.id], c) }}</span><span class="unit">{{ c.unit }}</span>
      <span v-if="measures.length > 1 || compact" class="lbl">{{ t('quantities.' + c.quantity, c.quantity) }}</span>
    </div>

    <div v-for="c in binaries" :key="c.id" class="binary" :class="{ active: s[c.id] }">
      <span class="dot" />{{ binText(c.id, s[c.id]) }}
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.ctl { display: flex; flex-direction: column; gap: 12px; }
.ctl.offline { opacity: 0.5; }
.power { min-height: 64px; border: 1px solid var(--line); background: rgba(2, 6, 23, 0.5); display: flex; align-items: center; justify-content: center; gap: 14px; cursor: pointer; font-size: 20px; }
.power .knob { width: 20px; height: 20px; border-radius: 50%; background: #475569; transition: 0.2s; }
.power.on { border-color: var(--gold); background: rgba(245, 158, 11, 0.12); box-shadow: 0 0 30px rgba(245, 158, 11, 0.2) inset; }
.power.on .knob { background: var(--gold); box-shadow: 0 0 14px var(--gold); }
.power:active { transform: scale(0.98); }
.slider { display: flex; flex-direction: column; gap: 8px; }
.lbl { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); }
.lbl b { color: var(--text); font-family: var(--mono); letter-spacing: 0; }
input[type='range'] { width: 100%; height: 44px; accent-color: var(--cyan); }
.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.thermo { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.thermo .val { font-family: var(--mono); font-size: 40px; color: #fff; text-shadow: 0 0 18px rgba(245, 158, 11, 0.5); }
.thermo small { font-size: 16px; color: var(--dim); margin-left: 4px; }
.measure { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.measure .num { font-family: var(--mono); font-size: 40px; color: var(--cyan); text-shadow: 0 0 18px rgba(34, 211, 238, 0.45); }
.compact .measure .num { font-size: 30px; }
.measure .unit { color: var(--dim); }
.measure .lbl { width: 100%; }
.binary { display: flex; align-items: center; gap: 10px; font-size: 18px; }
.binary .dot { width: 12px; height: 12px; border-radius: 50%; background: #475569; }
.binary.active .dot { background: var(--magenta); box-shadow: 0 0 12px var(--magenta); animation: pulse 1.4s infinite; }
@keyframes pulse { 50% { opacity: 0.4; } }
</style>
