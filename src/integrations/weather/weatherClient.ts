/**
 * Weather integration — Open-Meteo (free, no API key required).
 * https://open-meteo.com/
 */

export interface HourlyForecast {
  time: string // "HH:mm"
  temperatureC: number
}

export interface WeatherSnapshot {
  locationLabel: string
  temperatureC: number
  feelsLikeC: number
  humidityPct: number
  windKph: number
  sunrise: string // "HH:mm"
  sunset: string // "HH:mm"
  hourly: HourlyForecast[]
}

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

function formatHour(iso: string): string {
  return iso.slice(11, 16)
}

export async function fetchWeather(
  city: string,
  signal?: AbortSignal,
): Promise<WeatherSnapshot> {
  const geoRes = await fetch(
    `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1`,
    { signal },
  )
  if (!geoRes.ok) throw new Error('Geocoding request failed')
  const geoData = await geoRes.json()
  const place = geoData.results?.[0]
  if (!place) throw new Error(`No location found for "${city}"`)

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m',
    hourly: 'temperature_2m',
    daily: 'sunrise,sunset',
    timezone: 'auto',
    forecast_days: '1',
  })

  const forecastRes = await fetch(`${FORECAST_URL}?${params}`, { signal })
  if (!forecastRes.ok) throw new Error('Forecast request failed')
  const data = await forecastRes.json()

  const nowHour = new Date().getHours()
  const hourly: HourlyForecast[] = (data.hourly?.time ?? [])
    .map((t: string, i: number) => ({
      time: formatHour(t),
      temperatureC: Math.round(data.hourly.temperature_2m[i]),
    }))
    .slice(nowHour, nowHour + 6)

  return {
    locationLabel: [place.name, place.admin1, place.country]
      .filter(Boolean)
      .join(', '),
    temperatureC: Math.round(data.current.temperature_2m),
    feelsLikeC: Math.round(data.current.apparent_temperature),
    humidityPct: Math.round(data.current.relative_humidity_2m),
    windKph: Math.round(data.current.wind_speed_10m),
    sunrise: formatHour(data.daily.sunrise[0]),
    sunset: formatHour(data.daily.sunset[0]),
    hourly,
  }
}

/**
 * Model-readable summary — the shape a local-model "what's the weather"
 * query or morning debrief should consume.
 */
export function summarizeWeather(snapshot: WeatherSnapshot) {
  return {
    location: snapshot.locationLabel,
    temperatureC: snapshot.temperatureC,
    feelsLikeC: snapshot.feelsLikeC,
    humidityPct: snapshot.humidityPct,
    windKph: snapshot.windKph,
    sunrise: snapshot.sunrise,
    sunset: snapshot.sunset,
  }
}
