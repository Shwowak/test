import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import staticFiles from '@fastify/static'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import websocket from '@fastify/websocket'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedAdmin, userFromToken } from './src/core/auth.js'
import { seedDemo } from './src/core/seed.js'
import { log } from './src/core/logger.js'
import authModule from './src/modules/auth.js'
import usersModule from './src/modules/users.js'
import dashboardsModule from './src/modules/dashboards.js'
import sourcesModule from './src/modules/sources.js'
import adminModule from './src/modules/admin.js'
import devicesModule from './src/modules/devices.js'
import { startAll } from './src/devices/engine.js'
import automationsModule from './src/modules/automations.js'
import { startAutomations } from './src/automation/engine.js'
import pluginsModule from './src/modules/plugins.js'
import hardwareModule, { isDevice } from './src/modules/hardware.js'
import aiModule from './src/modules/ai.js'
import camerasModule, { syncCameras } from './src/modules/cameras.js'
import { keepOutputs } from './src/system/display.js'
import { startBtAuto } from './src/system/btauto.js'
import { startSetupNet } from './src/system/setupnet.js'
import { startHealth, registerFixes, trackRequest } from './src/system/health.js'
import { startPlugin } from './src/plugins/host.js'
import { db as database } from './src/core/db.js'
import { startPlugins, stopPlugins } from './src/plugins/host.js'

process.env.npm_package_version ??= JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

seedAdmin()
seedDemo()

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: process.env.HOMEOS_TRUST_PROXY === 'true' })
await app.register(cookie)
await app.register(websocket)

await app.register(swagger, {
  openapi: {
    info: { title: 'SmartBoard OS API', version: 'v1' },
    components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'homeos_session' } } },
    security: [{ session: [] }],
  },
})
await app.register(swaggerUi, { routePrefix: '/api/docs' })

app.addHook('onResponse', async (req, reply) => trackRequest(req.url, reply.elapsedTime))

app.setErrorHandler((err, req, reply) => {
  if (err.validation) return reply.code(422).send({ error: 'validation', details: err.message })
  const status = err.statusCode ?? 500
  if (status >= 500) log('errors', 'error', 'http.error', { url: req.url, message: err.message }, req.user?.id)
  reply.code(status).send({ error: err.code && typeof err.code === 'string' ? err.code : 'internal', details: err.details })
})

app.register(async api => {
  api.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.config?.public) return
    const user = userFromToken(req.cookies.homeos_session)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    req.user = user
  })
  api.get('/health', { schema: { tags: ['system'], summary: 'Liveness probe' }, config: { public: true } }, async () => ({ ok: true, version: process.env.npm_package_version ?? null }))
  for (const m of [authModule, usersModule, dashboardsModule, sourcesModule, adminModule, devicesModule, automationsModule, pluginsModule, hardwareModule, aiModule, camerasModule]) await api.register(m)
}, { prefix: '/api/v1' })

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')
if (existsSync(webDir)) {
  await app.register(staticFiles, { root: webDir })
  app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not_found' }) : reply.sendFile('index.html'))
}

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) })
startAll()
startAutomations()
startPlugins()
syncCameras().catch(() => {})
registerFixes({ async restart_plugins() { const ids = database.prepare('SELECT id FROM plugins WHERE enabled = 1').all().map(r => r.id); ids.forEach(startPlugin); return `${ids.length} plugins restarted` } })
startHealth()
if (isDevice()) { keepOutputs(); startBtAuto(); startSetupNet() }
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { stopPlugins(); process.exit(0) })
log('system', 'info', 'system.started', { version: process.env.npm_package_version })
