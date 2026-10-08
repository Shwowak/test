const rad = Math.PI / 180

function julian(date) {
  return date.getTime() / 86400000 + 2440587.5
}

export function sunTimes(date, lat, lon) {
  const n = Math.round(julian(date) - 2451545.0 + 0.0008 - lon / 360)
  const jStar = n - lon / 360
  const M = (357.5291 + 0.98560028 * jStar) % 360
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad)
  const lambda = (M + C + 180 + 102.9372) % 360
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad)
  const decl = Math.asin(Math.sin(lambda * rad) * Math.sin(23.44 * rad))
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl))
  if (cosH > 1 || cosH < -1) return { sunrise: null, sunset: null }
  const H = Math.acos(cosH) / rad
  const toDate = j => new Date((j - 2440587.5) * 86400000)
  return { sunrise: toDate(jTransit - H / 360), sunset: toDate(jTransit + H / 360) }
}

export function isDark(now, lat, lon) {
  const { sunrise, sunset } = sunTimes(now, lat, lon)
  if (!sunrise) return false
  return now < sunrise || now > sunset
}
