import tls from 'node:tls'
import net from 'node:net'

const quote = s => `"${String(s).replace(/(["\\])/g, '\\$1')}"`

export function decodeWords(s) {
  return String(s ?? '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_, cs, enc, txt) => {
    const buf = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64')
      : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1')
    try { return new TextDecoder(cs).decode(buf) } catch { return buf.toString() }
  })
}

const fromName = v => {
  const s = decodeWords(v).trim()
  return s.match(/^"?([^"<]+?)"?\s*<[^>]+>$/)?.[1]?.trim() || s.replace(/[<>]/g, '')
}

export function parseFetch(text) {
  const out = []
  for (const part of text.split(/\r?\n(?=\* \d+ FETCH)/)) {
    const m = part.match(/^\* (\d+) FETCH/)
    if (!m) continue
    const flags = part.match(/FLAGS \(([^)]*)\)/)?.[1] ?? ''
    const hdr = part.replace(/\r?\n[ \t]+/g, ' ')
    const h = k => hdr.match(new RegExp(`^${k}:\\s*(.*)$`, 'im'))?.[1]?.trim() ?? ''
    const d = new Date(h('Date'))
    out.push({ seq: Number(m[1]), from: fromName(h('From')), subject: decodeWords(h('Subject')), date: isNaN(d) ? null : d.toISOString(), unread: !/\\Seen/.test(flags) })
  }
  return out.sort((a, b) => b.seq - a.seq)
}

export function fetchMail({ host, port, user, password, tls: secure = 'yes', folder = 'INBOX' }, limit = 6) {
  return new Promise((resolve, reject) => {
    const p = Number(port) || (secure === 'no' ? 143 : 993)
    const sock = secure === 'no' ? net.connect(p, host) : tls.connect({ host, port: p, servername: host })
    let buf = ''
    let n = 0
    let pending = null
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('timeout')) }, 15000)
    const done = (err, val) => { clearTimeout(timer); sock.end(); err ? reject(err) : resolve(val) }
    const cmd = line => new Promise((res, rej) => {
      const tag = `a${++n}`
      pending = { tag, res, rej }
      buf = ''
      sock.write(`${tag} ${line}\r\n`)
    })
    sock.setEncoding('latin1')
    sock.on('error', e => done(e))
    sock.on('data', chunk => {
      buf += chunk
      if (!pending) {
        if (/\r\n$/.test(buf)) { const g = greet; greet = null; g?.() }
        return
      }
      const m = buf.match(new RegExp(`(^|\\r\\n)${pending.tag} (OK|NO|BAD)([^\\r\\n]*)\\r\\n$`))
      if (!m) return
      const { res, rej } = pending
      pending = null
      m[2] === 'OK' ? res(Buffer.from(buf, 'latin1').toString('utf8')) : rej(new Error(m[3].trim() || m[2]))
    })
    let greet = async () => {
      try {
        await cmd(`LOGIN ${quote(user)} ${quote(password)}`)
        const ex = await cmd(`EXAMINE ${quote(folder)}`)
        const total = Number(ex.match(/\* (\d+) EXISTS/)?.[1] ?? 0)
        const unseen = (await cmd('SEARCH UNSEEN')).match(/\* SEARCH([\d ]*)/)?.[1]?.trim().split(/\s+/).filter(Boolean).length ?? 0
        let messages = []
        if (total > 0 && limit > 0) {
          const from = Math.max(1, total - limit + 1)
          messages = parseFetch(await cmd(`FETCH ${from}:${total} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`))
        }
        cmd('LOGOUT').catch(() => {})
        done(null, { unread: unseen, total, messages })
      } catch (e) { done(e) }
    }
  })
}
