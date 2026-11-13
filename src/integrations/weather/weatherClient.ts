const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

export interface DailyWeather {
  date: string
  weatherCode: number
  highC: number
  lowC: number
  precipitationChancePct: number
  precipitationSumMm: number
  windMaxKph: number
  humidityPct: number
}

export interface WeatherSnapshot {
  locationLabel: string
  daily: DailyWeather[]
  /** epoch ms this snapshot was fetched — lets callers show "as of" and cache-age. */
  fetchedAt: number
}

/**
 * Real device location via the browser Geolocation API (works the same in
 * a Tauri webview as a normal browser — no native plugin needed). Falls
 * back to rejecting rather than a hardcoded city — callers decide what to
 * show on failure.
 */
function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation is not available in this environment.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => reject(new Error(`Could not get your location: ${err.message}`)),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 },
    )
  })
}

/** 7-day daily forecast (temps, precip chance/amount, wind, humidity) for the device's current location. */
export async function fetchWeeklyWeatherAtCurrentLocation(
  signal?: AbortSignal,
): Promise<WeatherSnapshot> {
  const position = await getCurrentPosition()
  const params = new URLSearchParams({
    latitude: String(position.coords.latitude),
    longitude: String(position.coords.longitude),
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean',
    forecast_days: '7',
    timezone: 'auto',
  })

  const res = await fetch(`${FORECAST_URL}?${params}`, { signal })
  if (!res.ok) throw new Error('Weather request failed')
  const data = await res.json()

  const daily: DailyWeather[] = data.daily.time.map((date: string, i: number) => ({
    date,
    weatherCode: data.daily.weather_code[i],
    highC: Math.round(data.daily.temperature_2m_max[i]),
    lowC: Math.round(data.daily.temperature_2m_min[i]),
    precipitationChancePct: Math.round(data.daily.precipitation_probability_max?.[i] ?? 0),
    precipitationSumMm: Math.round((data.daily.precipitation_sum?.[i] ?? 0) * 10) / 10,
    windMaxKph: Math.round(data.daily.wind_speed_10m_max?.[i] ?? 0),
    humidityPct: Math.round(data.daily.relative_humidity_2m_mean?.[i] ?? 0),
  }))

  return { locationLabel: 'Your location', daily, fetchedAt: Date.now() }
}

/** Maps Open-Meteo WMO weather codes to a compact glyph — no icon library dependency. */
export function weatherCodeToGlyph(code: number): string {
  if (code === 0) return '☀'
  if (code <= 2) return '🌤'
  if (code === 3) return '☁'
  if (code <= 48) return '🌫'
  if (code <= 57) return '🌦'
  if (code <= 67) return '🌧'
  if (code <= 77) return '🌨'
  if (code <= 82) return '🌧'
  if (code <= 86) return '🌨'
  return '⛈'
}

/** Human-readable label for a WMO weather code. */
export function weatherCodeToLabel(code: number): string {
  if (code === 0) return 'Clear sky'
  if (code <= 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Rain showers'
  if (code <= 86) return 'Snow showers'
  return 'Thunderstorm'
}
