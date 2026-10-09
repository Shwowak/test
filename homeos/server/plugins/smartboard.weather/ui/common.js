window.WX = {
  icon(code, day = true) {
    if (code === 0) return day ? '☀' : '☾'
    if (code <= 2) return day ? '⛅' : '☁'
    if (code === 3) return '☁'
    if (code <= 48) return '🌫'
    if (code <= 57) return '🌦'
    if (code <= 67) return '🌧'
    if (code <= 77) return '❄'
    if (code <= 82) return '🌧'
    if (code <= 86) return '🌨'
    return '⛈'
  },
  text(code, lang) {
    const de = { 0: 'Klar', 1: 'Überwiegend klar', 2: 'Teilweise bewölkt', 3: 'Bedeckt', 45: 'Nebel', 48: 'Reifnebel', 51: 'Leichter Niesel', 53: 'Niesel', 55: 'Starker Niesel', 61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen', 66: 'Gefrierender Regen', 67: 'Gefrierender Regen', 71: 'Leichter Schnee', 73: 'Schnee', 75: 'Starker Schnee', 77: 'Schneegriesel', 80: 'Schauer', 81: 'Schauer', 82: 'Heftige Schauer', 85: 'Schneeschauer', 86: 'Schneeschauer', 95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel' }
    const en = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' }
    return (lang === 'en' ? en : de)[code] ?? ''
  },
  deg(units) { return units === 'imperial' ? '°F' : '°' },
}
