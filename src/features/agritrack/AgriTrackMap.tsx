import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { Layer } from '@deck.gl/core'
import { ColumnLayer, ScatterplotLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PlayIcon, PauseIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import {
  availableDates,
  provinceSnapshot,
  cropDetail,
  queryTable,
  type AgriTrackRow,
} from '@/integrations/agritrack/client'

/**
 * The stat driving column height and colour. Each declares the field it
 * reads, the unit shown in the legend and tooltip, and whether a high
 * value is good — which decides the direction of the colour ramp, so
 * "lots of rain" and "lots of water stress" don't both read as red.
 */
interface Metric {
  id: string
  label: string
  field: string
  unit: string
  /** True when a larger number is a healthier one. */
  higherIsBetter: boolean
  /** NDVI is the one metric that has no data until Earth Engine is wired. */
  requiresNdvi?: boolean
}

const METRICS: Metric[] = [
  { id: 'rainfall', label: 'Rainfall', field: 'rainfall_mm', unit: 'mm', higherIsBetter: true },
  {
    id: 'soil_moisture',
    label: 'Soil moisture',
    field: 'soil_moisture_est',
    unit: '',
    higherIsBetter: true,
  },
  {
    id: 'water_stress',
    label: 'Water stress',
    field: 'avg_water_stress',
    unit: 'mm',
    higherIsBetter: false,
  },
  { id: 'gdd', label: 'Growing degree days', field: 'avg_gdd', unit: '°Cd', higherIsBetter: true },
  {
    id: 'deficit',
    label: 'Rainfall deficit (30d)',
    field: 'rainfall_deficit_30d',
    unit: 'mm',
    higherIsBetter: true,
  },
  {
    id: 'ndvi',
    label: 'Crop health (NDVI)',
    field: 'avg_ndvi',
    unit: '',
    higherIsBetter: true,
    requiresNdvi: true,
  },
]

/** South Africa, tilted enough that extruded columns read as 3D. */
const INITIAL_VIEW = {
  longitude: 25.0,
  latitude: -29.0,
  zoom: 4.6,
  pitch: 50,
  bearing: -12,
}

/**
 * Dark basemap, defined inline rather than fetched.
 *
 * A remote style is a hard dependency on a third party being up and on
 * the CSP allowing both its style and its tile host — and it buys very
 * little here, because the columns are the subject and a basemap that
 * draws coastlines over them would actively get in the way. Carto's
 * dark raster tiles are free and keyless; if they fail to load the
 * background colour still renders and the data layers still draw, which
 * a style-json failure would have prevented entirely.
 */
const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0d1117' } },
    { id: 'carto', type: 'raster', source: 'carto' },
  ],
}

/** Sequential ramp, low → high. Viridis-like, colourblind-safe. */
const RAMP: [number, number, number][] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
]

function rampColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(scaled))
  const f = scaled - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

function num(value: AgriTrackRow[string]): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function fmt(value: number | null, unit: string): string {
  if (value === null) return '—'
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)
  return unit ? `${rounded} ${unit}` : rounded
}

interface Tooltip {
  x: number
  y: number
  lines: [string, string][]
  title: string
}

export function AgriTrackMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)

  const [dates, setDates] = useState<string[]>([])
  const [dateIndex, setDateIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [snapshot, setSnapshot] = useState<AgriTrackRow[]>([])
  const [bulletins, setBulletins] = useState<AgriTrackRow[]>([])
  const [metricId, setMetricId] = useState('rainfall')
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgriTrackRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const [layers, setLayers] = useState({
    columns: true,
    heatmap: false,
    disease: true,
  })

  const metric = useMemo(
    () => METRICS.find((m) => m.id === metricId) ?? METRICS[0],
    [metricId],
  )
  const activeDate = dates[dateIndex] ?? ''

  // NDVI is absent until Earth Engine credentials are in place. Rather
  // than hiding the layer, it stays selectable and reports "no data yet"
  // — the difference between "nothing grew" and "we haven't measured"
  // is exactly what this view exists to make visible.
  const ndviCount = useMemo(
    () => snapshot.reduce((sum, r) => sum + (num(r.ndvi_crops) ?? 0), 0),
    [snapshot],
  )
  const ndviReady = ndviCount > 0

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [available, bulletinRows] = await Promise.all([
          availableDates(),
          queryTable('disease_bulletins', { limit: 500 }),
        ])
        if (cancelled) return
        setDates(available)
        // Land on the most recent date — the one the user most likely
        // wants — rather than the oldest.
        setDateIndex(Math.max(0, available.length - 1))
        setBulletins(bulletinRows)
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeDate) return
    let cancelled = false
    void (async () => {
      try {
        const rows = await provinceSnapshot(activeDate)
        if (!cancelled) setSnapshot(rows)
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeDate])

  useEffect(() => {
    if (!selected || !activeDate) {
      setDetail([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const rows = await cropDetail(selected, activeDate)
        if (!cancelled) setDetail(rows)
      } catch {
        if (!cancelled) setDetail([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected, activeDate])

  // Playback. Stops at the end rather than looping, so it's clear the
  // series has actually finished rather than silently restarting.
  useEffect(() => {
    if (!playing || dates.length === 0) return
    const timer = window.setInterval(() => {
      setDateIndex((i) => {
        if (i >= dates.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, 700)
    return () => window.clearInterval(timer)
  }, [playing, dates.length])

  // Map init — once. deck.gl rides along as a MapboxOverlay so the
  // basemap handles pan/zoom/pitch and deck just draws into the same
  // WebGL context, which keeps the two perfectly in sync.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLE,
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    // Non-interleaved: interleaving asks deck to share the basemap's
    // draw passes, which needs the style fully parsed before any layer
    // is added. As an overlaid canvas the columns draw regardless of
    // basemap timing — and still track pan/zoom/pitch exactly.
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay)
    mapRef.current = map
    overlayRef.current = overlay

    // The map mounts inside a Suspense boundary in a flex column, so on
    // first paint the container can still measure 0x0 — MapLibre caches
    // that and renders nothing until something forces a re-measure.
    // A ResizeObserver covers both that first layout settle and any
    // later window resize.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)


    return () => {
      observer.disconnect()
      overlay.finalize()
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
  }, [])

  const showTooltip = useCallback(
    (info: { x: number; y: number; object?: AgriTrackRow }) => {
      if (!info.object) {
        setTooltip(null)
        return
      }
      const row = info.object
      const ndviAge = num(row.min_ndvi_age)
      setTooltip({
        x: info.x,
        y: info.y,
        title: String(row.province ?? ''),
        lines: [
          ['Date', String(row.date ?? activeDate)],
          [metric.label, fmt(num(row[metric.field]), metric.unit)],
          ['Rainfall', fmt(num(row.rainfall_mm), 'mm')],
          ['Soil moisture', fmt(num(row.soil_moisture_est), '')],
          ['Water stress', fmt(num(row.avg_water_stress), 'mm')],
          [
            'NDVI',
            num(row.avg_ndvi) === null
              ? 'no data yet'
              : `${fmt(num(row.avg_ndvi), '')} (${ndviAge === null ? 'age unknown' : `${ndviAge}d old`})`,
          ],
          ['Crops tracked', String(num(row.crop_count) ?? '—')],
          ['Frost / heat flags', `${num(row.frost_crops) ?? 0} / ${num(row.heat_crops) ?? 0}`],
        ],
      })
    },
    [activeDate, metric],
  )

  // Column heights are normalised against the current frame's own range
  // rather than a fixed scale, so a quiet day still shows relative
  // differences instead of nine flat stubs.
  const { extent } = useMemo(() => {
    const vals = new Map<string, number>()
    let lo = Infinity
    let hi = -Infinity
    for (const row of snapshot) {
      const v = num(row[metric.field])
      if (v === null) continue
      vals.set(String(row.province), v)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    if (!Number.isFinite(lo)) return { extent: null as [number, number] | null, values: vals }
    return { extent: [lo, hi] as [number, number], values: vals }
  }, [snapshot, metric])

  const normalise = useCallback(
    (v: number | null): number => {
      if (v === null || !extent) return 0
      const [lo, hi] = extent
      if (hi === lo) return 0.5
      const t = (v - lo) / (hi - lo)
      return metric.higherIsBetter ? t : 1 - t
    },
    [extent, metric],
  )

  useEffect(() => {
    if (!overlayRef.current) return

    const deckLayers: Layer[] = []

    if (layers.columns) {
      deckLayers.push(
        new ColumnLayer({
          id: 'province-columns',
          data: snapshot,
          diskResolution: 24,
          radius: 42000,
          extruded: true,
          pickable: true,
          elevationScale: 1,
          getPosition: (d: AgriTrackRow) => [Number(d.longitude), Number(d.latitude)],
          getElevation: (d: AgriTrackRow) => {
            const v = num(d[metric.field])
            if (v === null) return 0
            // Normalised 0-1 mapped into a visible metre range; the
            // absolute number is meaningless, the comparison isn't.
            return 20000 + normalise(v) * 260000
          },
          getFillColor: (d: AgriTrackRow) => {
            const v = num(d[metric.field])
            if (v === null) return [70, 70, 78, 90]
            const [r, g, b] = rampColor(normalise(v))
            return [r, g, b, 210]
          },
          onHover: (info: { x: number; y: number; object?: AgriTrackRow }) => showTooltip(info),
          onClick: (info: { object?: unknown }) => {
            const row = info.object as AgriTrackRow | undefined
            setSelected(row ? String(row.province) : null)
          },
          updateTriggers: {
            getElevation: [metric.id, extent],
            getFillColor: [metric.id, extent],
          },
        }),
      )
    }

    if (layers.heatmap) {
      // Weighted by how many crops each province tracks — a standing
      // proxy for production concentration, which is the one thing here
      // that doesn't vary by date.
      deckLayers.push(
        new HeatmapLayer({
          id: 'production-heatmap',
          data: snapshot,
          getPosition: (d: AgriTrackRow) => [Number(d.longitude), Number(d.latitude)],
          getWeight: (d: AgriTrackRow) => num(d.crop_count) ?? 1,
          radiusPixels: 90,
          intensity: 1,
          threshold: 0.05,
        }),
      )
    }

    if (layers.disease) {
      // Bulletins carry a province name, not a coordinate, so they're
      // pinned to that province's point. Rendered as a distinct ringed
      // dot rather than another column so they never read as a metric.
      const located = bulletins
        .map((b) => {
          const province = String(b.province_affected ?? '')
          const match = snapshot.find((s) => String(s.province) === province)
          if (!match) return null
          return { ...b, longitude: match.longitude, latitude: match.latitude }
        })
        .filter(Boolean) as AgriTrackRow[]

      deckLayers.push(
        new ScatterplotLayer({
          id: 'disease-markers',
          data: located,
          pickable: true,
          stroked: true,
          filled: true,
          radiusMinPixels: 7,
          radiusMaxPixels: 14,
          getPosition: (d: AgriTrackRow) => [Number(d.longitude), Number(d.latitude)],
          getRadius: 20000,
          getFillColor: [220, 60, 70, 230],
          getLineColor: [255, 220, 220, 255],
          lineWidthMinPixels: 2,
          onHover: (info: { x: number; y: number; object?: unknown }) => {
            const row = info.object as AgriTrackRow | undefined
            if (!row) {
              setTooltip(null)
              return
            }
            setTooltip({
              x: info.x,
              y: info.y,
              title: String(row.disease_name ?? 'Disease bulletin'),
              lines: [
                ['Province', String(row.province_affected ?? '—')],
                ['Category', String(row.category ?? '—')],
                ['Published', String(row.date_published ?? '—')],
                ['Summary', String(row.summary ?? '—').slice(0, 120)],
              ],
            })
          },
        }),
      )
    }

    overlayRef.current.setProps({ layers: deckLayers })
  }, [snapshot, bulletins, layers, metric, normalise, extent, showTooltip])

  const legendStops = useMemo(() => {
    if (!extent) return []
    const [lo, hi] = extent
    return [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      t,
      color: rampColor(t),
      // Undo the good/bad inversion so the printed number matches the
      // swatch it sits under.
      value: metric.higherIsBetter ? lo + (hi - lo) * t : hi - (hi - lo) * t,
    }))
  }, [extent, metric])

  return (
    // `isolate` + an opaque background are both load-bearing. The map
    // renders inside Udaan's translucent glass panel, whose
    // backdrop-filter promotes its ancestors to their own compositing
    // layers. A WebGL canvas with no stacking context of its own gets
    // composited *behind* that frosted pane and never becomes visible,
    // even though MapLibre reports the map as loaded and the canvas has
    // real dimensions. Giving this subtree its own stacking context and
    // something opaque to paint onto is what puts the canvas in front.
    <div className="relative isolate h-full min-h-0 w-full overflow-hidden rounded-lg bg-[#0d1117]">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {error && (
        <div className="absolute left-4 top-4 z-20 rounded-md bg-black/70 px-3 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {/* Layer + metric panel */}
      <div className="absolute left-4 top-4 z-10 w-60 rounded-lg border border-white/10 bg-black/70 p-3 backdrop-blur">
        <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-white/50">Layers</p>
        <div className="mb-3 flex flex-col gap-1.5">
          {(
            [
              ['columns', 'Province columns'],
              ['heatmap', 'Production density'],
              ['disease', 'Disease alerts'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-xs text-white/80">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(e) => setLayers((s) => ({ ...s, [key]: e.target.checked }))}
              />
              {label}
              {key === 'disease' && bulletins.length === 0 && (
                <span className="text-white/40">(none)</span>
              )}
            </label>
          ))}
        </div>

        <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-white/50">Metric</p>
        <div className="flex flex-col gap-1">
          {METRICS.map((m) => {
            const disabled = m.requiresNdvi && !ndviReady
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => setMetricId(m.id)}
                className={[
                  'rounded px-2 py-1 text-left text-xs',
                  m.id === metricId
                    ? 'bg-white/15 text-white'
                    : disabled
                      ? 'cursor-not-allowed text-white/25'
                      : 'text-white/70 hover:bg-white/10',
                ].join(' ')}
              >
                {m.label}
                {disabled && <span className="ml-1 text-2xs-alt">no data yet</span>}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        {extent && (
          <div className="mt-3 border-t border-white/10 pt-2">
            <p className="mb-1 text-2xs text-white/50">
              {metric.label}
              {metric.unit ? ` (${metric.unit})` : ''}
            </p>
            <div className="flex">
              {legendStops.map((s) => (
                <div key={s.t} className="flex-1">
                  <div
                    className="h-2"
                    style={{ background: `rgb(${s.color[0]},${s.color[1]},${s.color[2]})` }}
                  />
                  <p className="mt-0.5 text-center text-3xs text-white/60">
                    {s.value.toFixed(Math.abs(s.value) >= 100 ? 0 : 1)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {metric.requiresNdvi && !ndviReady && (
          <p className="mt-2 text-2xs-alt leading-snug text-white/40">
            NDVI layers stay empty until Earth Engine credentials are configured.
          </p>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="absolute right-4 top-4 z-10 max-h-[60%] w-72 overflow-y-auto rounded-lg border border-white/10 bg-black/75 p-3 backdrop-blur">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-white">{selected}</p>
              <p className="text-2xs text-white/50">{activeDate}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-white/50 hover:text-white"
            >
              ✕
            </button>
          </div>
          {detail.length === 0 && <p className="text-xs text-white/50">No crop rows for this date.</p>}
          {detail.map((c) => {
            const ndvi = num(c.ndvi_value)
            const age = num(c.ndvi_age_days)
            return (
              <div key={String(c.crop_id)} className="mb-2 border-t border-white/10 pt-2">
                <p className="text-xs text-white/90">{String(c.crop_name)}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-2xs">
                  <dt className="text-white/45">GDD</dt>
                  <dd className="text-white/80">
                    {fmt(num(c.gdd_accumulated), '')}
                    {num(c.maturity_gdd_threshold) !== null && (
                      <span className="text-white/40"> / {fmt(num(c.maturity_gdd_threshold), '')}</span>
                    )}
                  </dd>
                  <dt className="text-white/45">Water stress</dt>
                  <dd className="text-white/80">{fmt(num(c.water_stress_gap), 'mm')}</dd>
                  <dt className="text-white/45">NDVI</dt>
                  <dd className={ndvi === null ? 'text-white/35' : 'text-white/80'}>
                    {ndvi === null ? 'no data yet' : fmt(ndvi, '')}
                  </dd>
                  <dt className="text-white/45">NDVI age</dt>
                  <dd className={age === null ? 'text-white/35' : 'text-white/80'}>
                    {age === null ? '—' : `${age} d`}
                    {age !== null && age > 10 && <span className="text-amber-300"> stale</span>}
                  </dd>
                  <dt className="text-white/45">Flags</dt>
                  <dd className="text-white/80">
                    {[c.frost_risk_flag ? 'frost' : null, c.heat_stress_flag ? 'heat' : null]
                      .filter(Boolean)
                      .join(', ') || 'none'}
                  </dd>
                </dl>
              </div>
            )
          })}
        </div>
      )}

      {/* Time slider */}
      <div className="absolute inset-x-4 bottom-4 z-10 rounded-lg border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPlaying((p) => !p)}
            disabled={dates.length < 2}
            aria-label={playing ? 'Pause playback' : 'Play through dates'}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <input
            type="range"
            min={0}
            max={Math.max(0, dates.length - 1)}
            value={dateIndex}
            onChange={(e) => {
              setPlaying(false)
              setDateIndex(Number(e.target.value))
            }}
            disabled={dates.length < 2}
            className="h-1 flex-1 accent-white"
          />
          <span className="w-24 shrink-0 text-right text-xs tabular-nums text-white/80">
            {activeDate || '—'}
          </span>
        </div>
        <p className="mt-1 text-2xs-alt text-white/40">
          {dates.length === 0
            ? 'No dates collected yet — run the collector.'
            : `${dateIndex + 1} of ${dates.length} collected days`}
        </p>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-30 max-w-xs rounded-md border border-white/15 bg-black/85 px-2.5 py-2 text-2xs shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <p className="mb-1 text-white">{tooltip.title}</p>
          {tooltip.lines.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="text-white/45">{k}</span>
              <span className="text-white/85">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
