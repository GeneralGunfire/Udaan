import { useEffect, useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { SunIcon, GlobeIcon } from '@/shared/icons'
import {
  fetchWeather,
  fetchWeatherAtCurrentLocation,
  type WeatherSnapshot,
} from '@/integrations/weather/weatherClient'

// Fallback only — used when the user denies/lacks geolocation, since a
// forecast still needs *some* coordinates to query.
const FALLBACK_CITY = 'Cape Town'

export function WeatherWidget() {
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchWeatherAtCurrentLocation(controller.signal)
      .then(setSnapshot)
      .catch((err) => {
        if (err.name === 'AbortError') return
        // Geolocation denied/unavailable — fall back to a default city
        // rather than showing an error for what's a very common,
        // non-fatal case (permission prompt dismissed, etc.).
        fetchWeather(FALLBACK_CITY, controller.signal)
          .then(setSnapshot)
          .catch((fallbackErr) => {
            if (fallbackErr.name !== 'AbortError') setError('Weather unavailable')
          })
      })
    return () => controller.abort()
  }, [])

  if (error) {
    return (
      <GlassPanel className="flex flex-col items-center justify-center gap-1 py-6">
        <p className="text-text-tertiary text-[12px]">{error}</p>
      </GlassPanel>
    )
  }

  if (!snapshot) {
    return (
      <GlassPanel className="flex flex-col items-center justify-center gap-1 py-6">
        <p className="text-text-tertiary text-[12px]">Loading weather…</p>
      </GlassPanel>
    )
  }

  return (
    <GlassPanel className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-text-tertiary flex items-center gap-1.5 text-[11px]">
            <GlobeIcon width={12} height={12} />
            {snapshot.locationLabel}
          </div>
          <div className="font-display text-text-primary mt-1 text-[34px] leading-none font-semibold">
            {snapshot.temperatureC}°
          </div>
          <div className="text-text-tertiary mt-1 text-[11px]">
            Feels like {snapshot.feelsLikeC}°
          </div>
        </div>
        <SunIcon width={28} height={28} className="text-brand-teal" />
      </div>

      {snapshot.hourly.length > 0 && (
        <div className="border-glass-border flex justify-between border-t pt-3">
          {snapshot.hourly.map((h) => (
            <div key={h.time} className="flex flex-col items-center gap-1">
              <span className="text-text-tertiary text-[10px]">{h.time}</span>
              <span className="text-text-secondary text-[12px] font-medium tabular-nums">
                {h.temperatureC}°
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="border-glass-border grid grid-cols-2 gap-2 border-t pt-3 text-[11px]">
        <Stat label="Sunrise" value={snapshot.sunrise} />
        <Stat label="Sunset" value={snapshot.sunset} />
        <Stat label="Wind" value={`${snapshot.windKph} km/h`} />
        <Stat label="Humidity" value={`${snapshot.humidityPct}%`} />
      </div>
    </GlassPanel>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-secondary font-medium">{value}</span>
    </div>
  )
}
