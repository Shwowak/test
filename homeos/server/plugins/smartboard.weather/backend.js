let stop = null
const warned = new Set()

async function update() {
  const loc = await sdk.location()
  const imp = sdk.config.units === 'imperial'
  const q = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon, timezone: loc.timezone || 'auto', forecast_days: '7',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,is_day,precipitation',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_gusts_10m_max',
    temperature_unit: imp ? 'fahrenheit' : 'celsius', wind_speed_unit: imp ? 'mph' : 'kmh',
  })
  const r = await sdk.fetch('https://api.open-meteo.com/v1/forecast?' + q)
  if (!r.ok) throw new Error('open-meteo ' + r.status)
  const d = await r.json()
  const now = Date.now()
  const hours = d.hourly.time.map((t, i) => ({ t, temp: d.hourly.temperature_2m[i], rain: d.hourly.precipitation_probability[i], code: d.hourly.weather_code[i] }))
    .filter(h => new Date(h.t).getTime() > now - 3600000).slice(0, 24)
  const days = d.daily.time.map((t, i) => ({
    date: t, code: d.daily.weather_code[i], max: d.daily.temperature_2m_max[i], min: d.daily.temperature_2m_min[i],
    rain: d.daily.precipitation_sum[i], rainProb: d.daily.precipitation_probability_max[i], gusts: d.daily.wind_gusts_10m_max[i],
    sunrise: d.daily.sunrise[i], sunset: d.daily.sunset[i],
  }))
  const c = d.current
  await sdk.publish('weather', {
    place: loc.name, units: imp ? 'imperial' : 'metric', updated: new Date().toISOString(),
    current: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, code: c.weather_code, wind: c.wind_speed_10m, gusts: c.wind_gusts_10m, day: !!c.is_day, precip: c.precipitation },
    hours, days,
  })
  if (sdk.config.warn !== false && sdk.permissions.includes('notifications')) {
    const today = days[0]
    const storm = [95, 96, 99].includes(today.code) ? 'thunder' : today.gusts >= (imp ? 47 : 75) ? 'storm' : null
    if (storm && !warned.has(today.date + storm)) {
      warned.add(today.date + storm)
      const text = storm === 'thunder'
        ? { de: 'Gewitter erwartet', en: 'Thunderstorms expected' }
        : { de: `Sturmböen bis ${Math.round(today.gusts)} ${imp ? 'mph' : 'km/h'}`, en: `Gusts up to ${Math.round(today.gusts)} ${imp ? 'mph' : 'km/h'}` }
      await sdk.notify({ level: 'warning', title: sdk.lang === 'en' ? 'Weather alert' : 'Wetterwarnung', message: text[sdk.lang] ?? text.de })
    }
  }
}

function schedule() {
  stop?.()
  stop = sdk.every(Math.max(5, Number(sdk.config.interval) || 15) * 60, update)
}

sdk.onConfig(schedule)
sdk.onAction('refresh', async () => { await update(); return true })
schedule()
