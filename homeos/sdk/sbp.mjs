#!/usr/bin/env node
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, sep, resolve } from 'node:path'
import { zipSync } from 'fflate'

const [cmd, ...args] = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }

function readDir(dir) {
  const files = new Map()
  const walk = d => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.') || n === 'node_modules' || n.endsWith('.sbp')) continue
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else files.set(relative(dir, p).split(sep).join('/'), readFileSync(p))
    }
  }
  walk(dir)
  return files
}

function digest(files) {
  const h = createHash('sha256')
  for (const name of [...files.keys()].filter(n => n !== 'SIGNATURE').sort()) {
    h.update(name + '\0' + createHash('sha256').update(files.get(name)).digest('hex') + '\n')
  }
  return h.digest()
}

if (cmd === 'keygen') {
  const out = opt('out', 'smartboard-dev')
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  writeFileSync(out + '.key', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  writeFileSync(out + '.pub', pub + '\n')
  console.log(`Private key: ${out}.key (geheim halten)\nPublic key (in SmartBoard unter Plugins → Vertrauenswürdige Schlüssel eintragen):\n${pub}`)
} else if (cmd === 'pack') {
  const dir = resolve(args[0] ?? '.')
  const files = readDir(dir)
  if (!files.has('manifest.json')) { console.error('manifest.json fehlt'); process.exit(1) }
  files.delete('SIGNATURE')
  const m = JSON.parse(files.get('manifest.json'))
  const keyFile = opt('key')
  if (keyFile) {
    const key = createPrivateKey(readFileSync(keyFile))
    const pub = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64')
    const sig = sign(null, digest(files), key).toString('base64')
    files.set('SIGNATURE', Buffer.from(JSON.stringify({ key: pub, sig, signer: opt('signer', m.author ?? null) })))
  }
  const out = opt('out', `${m.id}-${m.version}.sbp`)
  writeFileSync(out, zipSync(Object.fromEntries([...files].map(([k, v]) => [k, new Uint8Array(v)])), { level: 9 }))
  console.log(`${out} (${files.size} Dateien${keyFile ? ', signiert' : ', NICHT signiert'})`)
} else {
  console.log(`SmartBoard Plugin-Werkzeug
  node sbp.mjs keygen [--out name]              Schlüsselpaar erzeugen
  node sbp.mjs pack <ordner> [--key name.key]   Plugin packen (und signieren) → .sbp`)
  if (cmd) process.exit(1)
}
