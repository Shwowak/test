export class JsonWs {
  constructor(url, { onMessage, onOpen, onClose }) {
    this.url = url; this.onMessage = onMessage; this.onOpen = onOpen; this.onClose = onClose
    this.pending = new Map(); this.seq = 0; this.retry = 1000; this.stopped = false; this.ws = null
  }

  connect() {
    if (this.stopped) return
    let ws
    try { ws = new WebSocket(this.url) } catch (e) { this.onClose?.(e.message); return this.reconnect() }
    this.ws = ws
    const guard = setTimeout(() => { if (ws.readyState !== 1) { ws.onclose = null; try { ws.close() } catch {} ; this.onClose?.('timeout'); this.reconnect() } }, 10000)
    ws.onopen = () => { clearTimeout(guard); this.retry = 1000; this.onOpen?.() }
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data) } catch { return } ; this.onMessage(m) }
    ws.onclose = () => {
      clearTimeout(guard)
      for (const p of this.pending.values()) p.reject(new Error('closed'))
      this.pending.clear()
      this.onClose?.()
      this.reconnect()
    }
    ws.onerror = () => {}
  }

  reconnect() {
    if (this.stopped) return
    setTimeout(() => this.connect(), this.retry)
    this.retry = Math.min(this.retry * 2, 60000)
  }

  send(msg, idKey = 'messageId') {
    const id = String(++this.seq)
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== 1) return reject(new Error('not_connected'))
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout')) }, 30000)
      this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v) }, reject: e => { clearTimeout(t); reject(e) } })
      this.ws.send(JSON.stringify({ ...msg, [idKey]: id }))
    })
  }

  settle(id, ok, value, error) {
    const p = this.pending.get(String(id))
    if (!p) return false
    this.pending.delete(String(id))
    ok ? p.resolve(value) : p.reject(new Error(error || 'failed'))
    return true
  }

  close() { this.stopped = true; try { this.ws?.close() } catch {} }
}
