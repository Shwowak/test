let count = (await sdk.storage.get('count')) ?? 0

async function publish() {
  await sdk.publish('counter', { count })
}

sdk.onAction('inc', async () => {
  count += Number(sdk.config.step) || 1
  await sdk.storage.set('count', count)
  await publish()
  if (count % 10 === 0) await sdk.notify({ level: 'info', title: 'Zähler', message: `${count} erreicht` })
  return count
})

sdk.onAction('reset', async () => {
  count = 0
  await sdk.storage.set('count', 0)
  await publish()
  return 0
})

if (sdk.config.url) {
  sdk.every(60, async () => {
    const r = await sdk.fetch(sdk.config.url)
    await sdk.publish('remote', await r.json())
  })
}

await publish()
sdk.log('counter started at ' + count)
