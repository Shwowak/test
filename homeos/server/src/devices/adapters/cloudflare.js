import { cap, measurement } from '../model.js'

const API = 'https://api.cloudflare.com/client/v4'
const QUERY = `query($zone: String!, $since: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
  httpRequests1hGroups(limit: 48, filter: { datetime_geq: $since }) {
    sum { requests cachedRequests bytes threats pageViews responseStatusMap { edgeResponseStatus requests } }
    uniq { uniques }
  } } } }`

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d

export function summarize(groups = []) {
  const s = { requests: 0, cached: 0, bytes: 0, threats: 0, views: 0, visitors: 0, e4: 0, e5: 0 }
  for (const g of groups) {
    s.requests += g.sum?.requests ?? 0
    s.cached += g.sum?.cachedRequests ?? 0
    s.bytes += g.sum?.bytes ?? 0
    s.threats += g.sum?.threats ?? 0
    s.views += g.sum?.pageViews ?? 0
    s.visitors += g.uniq?.uniques ?? 0
    for (const r of g.sum?.responseStatusMap ?? []) {
      if (r.edgeResponseStatus >= 500) s.e5 += r.requests
      else if (r.edgeResponseStatus >= 400) s.e4 += r.requests
    }
  }
  return {
    requests: s.requests, visitors: s.visitors, page_views: s.views, threats: s.threats,
    traffic: round(s.bytes / 1073741824, 2), cached: s.requests ? round((s.cached / s.requests) * 100) : 0,
    errors_4xx: s.e4, errors_5xx: s.e5, error_rate: s.requests ? round(((s.e4 + s.e5) / s.requests) * 100, 2) : 0,
  }
}

export const tunnelState = status => ({ healthy: 'online', degraded: 'degraded', down: 'offline', inactive: 'offline' }[status] ?? 'unknown')

const ZONE_CAPS = [
  measurement('requests', ''), measurement('visitors', ''), measurement('page_views', ''), measurement('traffic', 'GB'),
  measurement('cached', '%'), measurement('threats', ''), measurement('errors_4xx', ''), measurement('errors_5xx', ''), measurement('error_rate', '%'),
]

export default class CloudflareAdapter {
  static fields = [
    { key: 'token', type: 'secret', required: true },
    { key: 'zones', type: 'text' },
    { key: 'interval', type: 'number' },
  ]

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.known = new Set()
  }

  async api(path, opts = {}) {
    const r = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.success === false || j.errors?.length) throw new Error(j.errors?.[0]?.message ?? `HTTP ${r.status}`)
    return j
  }

  add(id, info) {
    if (this.known.has(id)) return
    this.ctx.upsert(id, { manufacturer: 'Cloudflare', meta: { area: 'Cloudflare' }, ...info })
    this.known.add(id)
  }

  async poll() {
    try {
      const wanted = String(this.cfg.zones ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      const zones = (await this.api('/zones?per_page=50')).result.filter(z => !wanted.length || wanted.includes(z.name.toLowerCase()))
      const since = new Date(Date.now() - 24 * 3600000).toISOString()
      let n = 0
      for (const z of zones) {
        const res = await this.api('/graphql', { method: 'POST', body: JSON.stringify({ query: QUERY, variables: { zone: z.id, since } }) }).catch(e => ({ err: e }))
        const id = `zone/${z.id}`
        this.add(id, { name: z.name, type: 'sensor', capabilities: ZONE_CAPS, model: `Zone · ${z.plan?.name ?? ''}`.trim() })
        if (res.err) { this.ctx.update(id, {}, { connection: 'offline' }); continue }
        this.ctx.update(id, summarize(res.data?.viewer?.zones?.[0]?.httpRequests1hGroups), { connection: z.status === 'active' ? 'online' : 'offline' })
        n++
      }
      const accounts = [...new Set(zones.map(z => z.account?.id).filter(Boolean))]
      for (const acc of accounts) {
        const tunnels = await this.api(`/accounts/${acc}/cfd_tunnel?is_deleted=false&per_page=50`).then(r => r.result).catch(() => [])
        for (const tu of tunnels) {
          const id = `tunnel/${tu.id}`
          this.add(id, { name: `Tunnel ${tu.name}`, type: 'other', capabilities: [cap('status', 'text'), cap('online', 'binary'), measurement('connections', '')], model: 'Cloudflare Tunnel' })
          this.ctx.update(id, { status: tu.status, online: tu.status === 'healthy', connections: tu.connections?.length ?? 0 }, { connection: tunnelState(tu.status) === 'online' ? 'online' : 'offline' })
          n++
        }
      }
      this.ctx.setStatus('connected', null, { devices: n })
    } catch (e) {
      this.ctx.setStatus('error', e.message)
    }
  }

  async start() {
    await this.poll()
    this.timer = setInterval(() => this.poll(), Math.max(60, Number(this.cfg.interval) || 300) * 1000)
  }

  async command() { throw new Error('readonly') }

  async stop() { clearInterval(this.timer) }
}
