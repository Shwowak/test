import { reactive } from 'vue'
import { i18n } from './i18n.js'

export const voice = reactive({ recording: false, speaking: false, ttsServer: true })
let audioEl = null

export async function speak(text) {
  if (!text) return
  stopSpeaking()
  voice.speaking = true
  if (voice.ttsServer) {
    try {
      const r = await fetch('/api/v1/ai/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), credentials: 'same-origin' })
      if (r.status === 409) voice.ttsServer = false
      else if (r.ok) {
        const url = URL.createObjectURL(await r.blob())
        audioEl = new Audio(url)
        audioEl.onended = audioEl.onerror = () => { voice.speaking = false; URL.revokeObjectURL(url) }
        await audioEl.play()
        return
      }
    } catch {}
  }
  if (!('speechSynthesis' in window)) { voice.speaking = false; return }
  const u = new SpeechSynthesisUtterance(text)
  const lang = i18n.global.locale.value
  u.lang = lang === 'en' ? 'en-GB' : `${lang}-${lang.toUpperCase()}`
  const v = speechSynthesis.getVoices().find(x => x.lang.startsWith(lang))
  if (v) u.voice = v
  u.onend = u.onerror = () => { voice.speaking = false }
  speechSynthesis.speak(u)
}

export function stopSpeaking() {
  audioEl?.pause()
  audioEl = null
  if ('speechSynthesis' in window) speechSynthesis.cancel()
  voice.speaking = false
}

export const micAvailable = () => !!navigator.mediaDevices?.getUserMedia && window.isSecureContext && typeof MediaRecorder !== 'undefined'

let rec = null
let stream = null
let silenceTimer = null

export async function startRecording(onDone, maxSeconds = 12) {
  stopSpeaking()
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) ?? ''
  rec = new MediaRecorder(stream, type ? { mimeType: type } : {})
  const chunks = []
  rec.ondataavailable = e => e.data.size && chunks.push(e.data)
  rec.onstop = () => {
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    voice.recording = false
    clearTimeout(silenceTimer)
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
    rec = null
    if (blob.size > 1000) onDone(blob)
  }
  rec.start()
  voice.recording = true
  autoStop(stream)
  silenceTimer = setTimeout(stopRecording, maxSeconds * 1000)
}

function autoStop(s) {
  try {
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    ctx.createMediaStreamSource(s).connect(an)
    const buf = new Uint8Array(an.fftSize)
    let spoke = false
    let quietSince = Date.now()
    const tick = () => {
      if (!voice.recording) { ctx.close(); return }
      an.getByteTimeDomainData(buf)
      const level = Math.max(...buf.map(v => Math.abs(v - 128)))
      if (level > 12) { spoke = true; quietSince = Date.now() }
      if (spoke && Date.now() - quietSince > 1400) { stopRecording(); ctx.close(); return }
      requestAnimationFrame(tick)
    }
    tick()
  } catch {}
}

export function stopRecording() {
  if (rec && rec.state !== 'inactive') rec.stop()
}
