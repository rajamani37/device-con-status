import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { AlertCircle, Loader2 } from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler)

type RawRow = {
  user_id?: string
  device_Id?: string
  con_status?: string | boolean
  con_link?: string
  conn_sts_time?: string | number
  createdAt?: string
  updatedAt?: string
  serial_no?: string
}

type ConnectionRecord = {
  serial: string
  deviceId: string
  status: 'connected' | 'disconnected'
  timestamp: Date
  rawTime?: number
  createdAt?: Date
  updatedAt?: Date
}

const CSV_URL = '/connection_sorted.csv'
const RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '180d', label: 'Last 180 days' },
] as const
type RangeValue = (typeof RANGE_OPTIONS)[number]['value']

function parseDate(raw: string | number | undefined): Date | undefined {
  if (raw === undefined || raw === null) return undefined
  // Prefer ISO date strings if valid
  if (typeof raw === 'string') {
    const iso = new Date(raw)
    if (!Number.isNaN(iso.getTime())) return iso
    const asNumber = Number(raw)
    if (!Number.isNaN(asNumber)) return parseDate(asNumber)
    return undefined
  }
  // numeric timestamp: interpret as seconds if looks like epoch seconds
  const num = Number(raw)
  if (Number.isNaN(num)) return undefined
  if (num > 1e12) return new Date(num) // already ms
  if (num > 1e9) return new Date(num * 1000) // seconds
  return undefined
}

function cleanDeviceId(raw?: string) {
  if (!raw) return ''
  const match = raw.match(/ObjectId\((.*?)\)/)
  if (match && match[1]) return match[1]
  return raw.trim()
}

function normalizeRow(row: RawRow): ConnectionRecord | null {
  const serial = row.serial_no?.trim()
  if (!serial) return null
  const deviceId = cleanDeviceId(row.device_Id)
  const statusBool =
    typeof row.con_status === 'boolean'
      ? row.con_status
      : String(row.con_status).toLowerCase().trim() === 'true'
  const status: ConnectionRecord['status'] = statusBool ? 'connected' : 'disconnected'
  const primaryDate = parseDate(row.conn_sts_time)
  const createdDate = parseDate(row.createdAt)
  const updatedDate = parseDate(row.updatedAt)

  const timestamp = primaryDate ?? updatedDate ?? createdDate
  if (!timestamp) return null

  return {
    serial,
    deviceId,
    status,
    timestamp,
    rawTime: typeof row.conn_sts_time === 'number' ? row.conn_sts_time : Number(row.conn_sts_time),
    createdAt: createdDate,
    updatedAt: updatedDate,
  }
}

type Summary = {
  total: number
  connected: number
  disconnected: number
  uptimePct: number
  firstSeen?: Date
  lastSeen?: Date
  longestConnectedStreak: number
  longestDisconnectedStreak: number
  longestOn?: { start: Date; end: Date; durationMs: number }
  longestOff?: { start: Date; end: Date; durationMs: number }
}

function computeSummary(records: ConnectionRecord[]): Summary {
  if (records.length === 0) {
    return {
      total: 0,
      connected: 0,
      disconnected: 0,
      uptimePct: 0,
      longestConnectedStreak: 0,
      longestDisconnectedStreak: 0,
      longestOn: undefined,
      longestOff: undefined,
    }
  }

  const sorted = [...records].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  let connected = 0
  let disconnected = 0
  let longestConnectedStreak = 0
  let longestDisconnectedStreak = 0
  let currentConnectedStreak = 0
  let currentDisconnectedStreak = 0
  let longestOn: Summary['longestOn']
  let longestOff: Summary['longestOff']

  // Track contiguous periods for cumulative duration calculation
  let currentPeriodStart: Date | null = null
  let currentPeriodState: 'connected' | 'disconnected' | null = null

  sorted.forEach((r, idx) => {
    const next = sorted[idx + 1]

    if (r.status === 'connected') {
      connected += 1
      currentConnectedStreak += 1
      currentDisconnectedStreak = 0
    } else {
      disconnected += 1
      currentDisconnectedStreak += 1
      currentConnectedStreak = 0
    }
    longestConnectedStreak = Math.max(longestConnectedStreak, currentConnectedStreak)
    longestDisconnectedStreak = Math.max(longestDisconnectedStreak, currentDisconnectedStreak)

    // Track contiguous periods
    if (currentPeriodState !== r.status) {
      // State changed - finalize previous period if exists
      if (currentPeriodStart && currentPeriodState) {
        const durationMs = r.timestamp.getTime() - currentPeriodStart.getTime()
        if (currentPeriodState === 'connected') {
          if (!longestOn || durationMs > longestOn.durationMs) {
            longestOn = { start: currentPeriodStart, end: r.timestamp, durationMs }
          }
        } else {
          if (!longestOff || durationMs > longestOff.durationMs) {
            longestOff = { start: currentPeriodStart, end: r.timestamp, durationMs }
          }
        }
      }
      // Start new period
      currentPeriodStart = r.timestamp
      currentPeriodState = r.status
    }

    // Handle the last record - finalize current period if no more records
    if (!next && currentPeriodStart && currentPeriodState) {
      const durationMs = r.timestamp.getTime() - currentPeriodStart.getTime()
      if (currentPeriodState === 'connected') {
        if (!longestOn || durationMs > longestOn.durationMs) {
          longestOn = { start: currentPeriodStart, end: r.timestamp, durationMs }
        }
      } else {
        if (!longestOff || durationMs > longestOff.durationMs) {
          longestOff = { start: currentPeriodStart, end: r.timestamp, durationMs }
        }
      }
    }
  })

  const total = connected + disconnected
  const uptimePct = total > 0 ? Math.round((connected / total) * 1000) / 10 : 0

  return {
    total,
    connected,
    disconnected,
    uptimePct,
    firstSeen: sorted[0]?.timestamp,
    lastSeen: sorted[sorted.length - 1]?.timestamp,
    longestConnectedStreak,
    longestDisconnectedStreak,
    longestOn,
    longestOff,
  }
}

export default function App() {
  const [records, setRecords] = useState<ConnectionRecord[]>([])
  const [selectedSerial, setSelectedSerial] = useState<string>('')
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<RangeValue>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [durationUnit, setDurationUnit] = useState<'seconds' | 'minutes' | 'hours'>('minutes')

  useEffect(() => {
    setLoading(true)
    Papa.parse<RawRow>(CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const cleaned: ConnectionRecord[] = []
        for (const row of results.data) {
          const normalized = normalizeRow(row)
          if (normalized) cleaned.push(normalized)
        }
        cleaned.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        setRecords(cleaned)
        if (cleaned.length > 0) {
          setSelectedSerial(cleaned[0].serial)
        }
        setLoading(false)
      },
      error: (err) => {
        setError(err.message)
        setLoading(false)
      },
    })
  }, [])

  const serialList = useMemo(() => {
    const map = new Map<string, { count: number; connected: number; disconnected: number }>()
    records.forEach((r) => {
      const entry = map.get(r.serial) ?? { count: 0, connected: 0, disconnected: 0 }
      entry.count += 1
      if (r.status === 'connected') entry.connected += 1
      else entry.disconnected += 1
      map.set(r.serial, entry)
    })
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([serial, stats]) => ({ serial, ...stats }))
  }, [records])

  const filteredBySerial = useMemo(
    () => records.filter((r) => r.serial === selectedSerial),
    [records, selectedSerial],
  )

  const filtered = useMemo(() => {
    let current = filteredBySerial

    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null
    const toMs = dateTo ? new Date(dateTo).getTime() : null

    if (fromMs && !Number.isNaN(fromMs)) {
      current = current.filter((r) => r.timestamp.getTime() >= fromMs)
    }
    if (toMs && !Number.isNaN(toMs)) {
      current = current.filter((r) => r.timestamp.getTime() <= toMs)
    }

    if (range === 'all' || current.length === 0) return current

    const end = current[current.length - 1].timestamp.getTime()
    const rangeMap: Record<RangeValue, number> = {
      all: Number.POSITIVE_INFINITY,
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '180d': 180,
    }
    const startMs = end - rangeMap[range] * 24 * 60 * 60 * 1000
    return current.filter((r) => r.timestamp.getTime() >= startMs)
  }, [filteredBySerial, range, dateFrom, dateTo])

  const summary = useMemo(() => computeSummary(filtered), [filtered])

  const chartData = useMemo(() => {
    const labels = filtered.map((r) => r.timestamp.toLocaleString())
    const dataPoints = filtered.map((r) => (r.status === 'connected' ? 1 : 0))
    return {
      labels,
      datasets: [
        {
          label: 'Connection status (1 = connected, 0 = disconnected)',
          data: dataPoints,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.15)',
          fill: true,
          stepped: 'before' as const, // Square wave: step happens at the point
          tension: 0,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
        },
      ],
    }
  }, [filtered])

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          min: -0.05,
          max: 1.05,
          ticks: {
            stepSize: 1,
            callback: (value: number | string) =>
              Number(value) >= 1 ? 'Connected' : Number(value) <= 0 ? 'Disconnected' : '',
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const idx = ctx.dataIndex
              const current = filtered[idx]
              const prev = filtered[idx - 1]
              const status = ctx.raw === 1 ? 'Connected (ON)' : 'Disconnected (OFF)'
              const timeStr = current?.timestamp.toLocaleString()

              let durationStr = ''
              
              if (prev) {
                const currentState = current.status
                const prevState = prev.status
                
                if (prevState !== currentState) {
                  // TRANSITION: Show how long it was in the PREVIOUS state
                  // Find when the previous state started
                  const prevOpposite = prevState === 'connected' ? 'disconnected' : 'connected'
                  let prevStateStartIdx = -1
                  for (let i = idx - 2; i >= 0; i--) {
                    if (filtered[i].status === prevOpposite) {
                      prevStateStartIdx = i
                      break
                    }
                  }
                  const startTime = prevStateStartIdx >= 0 
                    ? filtered[prevStateStartIdx].timestamp.getTime()
                    : prev.timestamp.getTime()
                  const diff = current.timestamp.getTime() - startTime
                  const label = prevState === 'connected' ? 'ON' : 'OFF'
                  durationStr = ` | Was ${label} for: ${formatDuration(diff)}`
                } else {
                  // CONTINUATION: Show cumulative duration of CURRENT state
                  // Find the last opposite state event (when this state started)
                  const oppositeState = currentState === 'connected' ? 'disconnected' : 'connected'
                  let stateStartIdx = -1
                  for (let i = idx - 1; i >= 0; i--) {
                    if (filtered[i].status === oppositeState) {
                      stateStartIdx = i
                      break
                    }
                  }
                  if (stateStartIdx >= 0) {
                    const diff = current.timestamp.getTime() - filtered[stateStartIdx].timestamp.getTime()
                    const label = currentState === 'connected' ? 'ON' : 'OFF'
                    durationStr = ` | ${label} for: ${formatDuration(diff)}`
                  }
                }
              }

              return `${status} @ ${timeStr}${durationStr}`
            },
          },
        },
      },
    }),
    [filtered],
  )

  // Duration chart: shows duration of each state period in configurable time units
  const durationChartData = useMemo(() => {
    if (filtered.length < 2) return { labels: [], datasets: [] }
    
    const divisor = durationUnit === 'seconds' ? 1000 : durationUnit === 'minutes' ? 60000 : 3600000
    const periods: { label: string; duration: number; state: 'connected' | 'disconnected' }[] = []
    
    let periodStart = filtered[0]
    for (let i = 1; i < filtered.length; i++) {
      const current = filtered[i]
      if (current.status !== periodStart.status || i === filtered.length - 1) {
        // End of a period
        const endTime = current.status !== periodStart.status ? current.timestamp : current.timestamp
        const durationMs = endTime.getTime() - periodStart.timestamp.getTime()
        periods.push({
          label: periodStart.timestamp.toLocaleString(),
          duration: durationMs / divisor,
          state: periodStart.status,
        })
        if (current.status !== periodStart.status) {
          periodStart = current
        }
      }
    }
    
    return {
      labels: periods.map((p) => p.label),
      datasets: [
        {
          label: `ON Duration (${durationUnit})`,
          data: periods.map((p) => (p.state === 'connected' ? p.duration : 0)),
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderColor: 'rgb(16, 185, 129)',
          borderWidth: 1,
        },
        {
          label: `OFF Duration (${durationUnit})`,
          data: periods.map((p) => (p.state === 'disconnected' ? p.duration : 0)),
          backgroundColor: 'rgba(244, 63, 94, 0.7)',
          borderColor: 'rgb(244, 63, 94)',
          borderWidth: 1,
        },
      ],
    }
  }, [filtered, durationUnit])

  const durationChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: {
            display: true,
            text: `Duration (${durationUnit})`,
          },
        },
      },
      plugins: {
        legend: { display: true, position: 'top' as const },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const value = ctx.raw as number
              if (value === 0) return ''
              return `${ctx.dataset.label}: ${value.toFixed(2)} ${durationUnit}`
            },
          },
        },
      },
    }),
    [durationUnit],
  )

  const formatDate = (d?: Date) => (d ? d.toLocaleString() : '—')
  const formatDuration = (ms?: number) => {
    if (ms === undefined) return '—'
    if (ms < 60_000) return `${Math.round(ms / 1000)} sec`
    return `${(ms / 60_000).toFixed(1)} min`
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium text-blue-600">Connection Dashboard</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Device connectivity by serial number
          </h1>
          <p className="text-sm text-slate-600">
            Browse serial numbers, view connection timelines, and see quick uptime summaries. Data is loaded
            from <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">connection_sorted.csv</code>.
          </p>
        </header>

        {loading && (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <span className="text-sm text-slate-700">Loading CSV data…</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5" />
            <div>
              <p className="text-sm font-semibold">Failed to load data</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total events</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{records.length}</p>
                <p className="text-xs text-slate-500">Across {serialList.length} serial numbers</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Connected</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-600">{summary.connected}</p>
                <p className="text-xs text-slate-500">Events marked connected</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Disconnected</p>
                <p className="mt-2 text-2xl font-semibold text-rose-600">{summary.disconnected}</p>
                <p className="text-xs text-slate-500">Events marked disconnected</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-slate-500">Uptime %</p>
                <p className="mt-2 text-2xl font-semibold text-blue-600">
                  {summary.uptimePct.toFixed(1)}
                  <span className="text-sm text-slate-500">%</span>
                </p>
                <p className="text-xs text-slate-500">Connected / total</p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[280px,1fr] lg:items-stretch">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm h-full flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">Serial numbers</p>
                  <span className="text-xs text-slate-500">{serialList.length} total</span>
                </div>
                <div className="mt-3">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search serial…"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none ring-0 transition focus:border-blue-400 focus:shadow-sm"
                  />
                </div>
                <div className="mt-3 flex-1 min-h-0 relative">
                  <div className="absolute inset-0 overflow-y-auto pr-1 space-y-2">
                    {serialList
                      .filter((s) => s.serial.toLowerCase().includes(search.toLowerCase()))
                      .map((s) => (
                        <button
                          key={s.serial}
                          onClick={() => setSelectedSerial(s.serial)}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50 ${
                            selectedSerial === s.serial
                              ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{s.serial}</span>
                            <span className="text-[11px] font-semibold text-slate-500">{s.count} evt</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                            <span className="text-emerald-600">● {s.connected}</span>
                            <span className="text-rose-600">● {s.disconnected}</span>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4 flex flex-col h-full">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Selected serial</p>
                      <p className="text-lg font-semibold text-slate-900">
                        {selectedSerial || 'None selected'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span>First seen:</span>
                    <span className="font-medium text-slate-800">{formatDate(summary.firstSeen)}</span>
                    <span className="text-slate-300">|</span>
                    <span>Last seen:</span>
                    <span className="font-medium text-slate-800">{formatDate(summary.lastSeen)}</span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Longest connected streak</p>
                    <p className="mt-1 text-xl font-semibold text-emerald-600">
                      {summary.longestConnectedStreak} events
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Longest disconnected streak</p>
                    <p className="mt-1 text-xl font-semibold text-rose-600">
                      {summary.longestDisconnectedStreak} events
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Total events (serial)</p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{filtered.length}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Largest ON duration</p>
                    <p className="mt-1 text-lg font-semibold text-emerald-600">{formatDuration(summary.longestOn?.durationMs)}</p>
                    <p className="text-[11px] text-slate-500">
                      {summary.longestOn
                        ? `${summary.longestOn.start.toLocaleString()} → ${summary.longestOn.end.toLocaleString()}`
                        : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Largest OFF duration</p>
                    <p className="mt-1 text-lg font-semibold text-rose-600">
                      {formatDuration(summary.longestOff?.durationMs)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {summary.longestOff
                        ? `${summary.longestOff.start.toLocaleString()} → ${summary.longestOff.end.toLocaleString()}`
                        : '—'}
                    </p>
                  </div>
                </div>

                

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-800">State duration chart</p>
                      <p className="text-xs text-slate-500">
                        Duration of each ON/OFF period
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500">Time unit:</span>
                      {(['seconds', 'minutes', 'hours'] as const).map((unit) => (
                        <button
                          key={unit}
                          onClick={() => setDurationUnit(unit)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                            durationUnit === unit
                              ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'
                          }`}
                        >
                          {unit.charAt(0).toUpperCase() + unit.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 h-[320px]">
                    {durationChartData.labels.length > 0 ? (
                      <Bar data={durationChartData} options={durationChartOptions} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        Not enough data to show duration chart.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-800">Connection status timeline</p>
                      <p className="text-xs text-slate-500">
                        {filtered.length > 0 ? `${filtered.length} points` : 'No data'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {RANGE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setRange(opt.value)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                            range === opt.value
                              ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <label className="flex items-center gap-1">
                        <span>From</span>
                        <input
                          type="datetime-local"
                          value={dateFrom}
                          onChange={(e) => setDateFrom(e.target.value)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <span>To</span>
                        <input
                          type="datetime-local"
                          value={dateTo}
                          onChange={(e) => setDateTo(e.target.value)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                        />
                      </label>
                      {(dateFrom || dateTo) && (
                        <button
                          onClick={() => {
                            setDateFrom('')
                            setDateTo('')
                          }}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:border-blue-200 hover:bg-blue-50"
                        >
                          Clear dates
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 h-[320px]">
                    {filtered.length > 0 ? (
                      <Line data={chartData} options={chartOptions} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        Select a serial to view its connection history.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
