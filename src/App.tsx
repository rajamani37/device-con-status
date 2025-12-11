import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
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
import { AlertCircle, Loader2, ChevronLeft, ChevronRight, X, Info } from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler)

const ENV_CONFIG = {
  staging: {
    label: 'Staging',
    url: 'https://ftp.iinvsys.com:55576/core1/spl',
  },
  production: {
    label: 'Production Innomate',
    url: 'https://innomate.iinvsys.com/core',
  },
} as const

type EnvType = keyof typeof ENV_CONFIG

// API Response types
type SerialSearchResponse = {
  status: string
  page: number
  limit: number
  total: number
  total_pages: number
  data: { serial_no: string; device_id: string }[]
}

type ConnectionDataResponse = {
  status: string
  message: string
  data: {
    user_id: string | null
    con_status: boolean
    con_link: number | null
    conn_sts_time: number
    _id: string
    device_Id: string
    createdAt: string
    updatedAt: string
  }[]
  count: number
}

type SerialItem = {
  serial_no: string
  device_id: string
}

type DeviceSwitch = {
  switch_id: string
  switch_name: string
  switch_type: string
  switch_image: string
  enrg_id: string
  src_name: boolean
  timer_dur: number
  set_timer: boolean
}

type AssociatedUser = {
  _id: string
  username: string
  user_role: string
  is_email_verified?: boolean
  is_mobile_verified?: boolean
  dob?: string | null
  gender?: string | null
}

type DeviceDetails = {
  location_id: string
  node_type: string
  entry_flg: boolean
  cur_firm_vrs: string
  hw_vrs: string
  svr_ota: boolean
  token: string
  secondAdmin: string
  BLE_mac: string
  router_ssid: string
  router_mac: string
  brand_name: string
  model_name: string
  capacity: number | null
  auto_onoff_enable: boolean
  sch_ovr_auto_onoff: boolean
  high_temp_thrs: number
  low_temp_thrs: number
  cold_power_on_cnt: number
  recvr_reset_cnt: number
  app_svr_con_cnt: number
  svr_con_count: number
  tot_svr_con_on_dur: number
  tot_app_svr_device_on_dur: number
  tot_app_svr_con_on_dur: number
  dev_app_last_discon_time: string | number | null
  dev_svr_last_discon_time: string | number | null
  skt_session_cnt: number
  log_print_cnt: number
  tot_energy_consume: number | null
  active_pwr_accum_val: number | null
  idle_pwr_accum_val: number | null
  build_number: number
  avg_rssi: number | null
  dev_con_cnt: number
  conn_status: string
  region: string
  timezone: string
  periodic_on_off: boolean
  _id: string
  serial_no: string
  switches: DeviceSwitch[]
  createdAt: string
  updatedAt: string
  latitude: number
  longitude: number
}

type DeviceInfoResponse = {
  status: string
  device_details: DeviceDetails
  associated_users: AssociatedUser[]
}

type ConnectionRecord = {
  serial: string
  deviceId: string
  status: 'connected' | 'disconnected'
  timestamp: Date
  rawTime: number
  createdAt?: Date
  updatedAt?: Date
}
const RANGE_OPTIONS = [
  { value: 'today', label: 'This day' },
  { value: 'yesterday', label: 'Previous day' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'custom', label: 'Custom' },
] as const
type RangeValue = (typeof RANGE_OPTIONS)[number]['value']

const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Dubai', label: 'UAE (UTC+4)' },
  { value: 'Asia/Kolkata', label: 'India (UTC+5:30)' },
] as const
type TimezoneValue = (typeof TIMEZONE_OPTIONS)[number]['value']

const LOG_PAGE_SIZE = 20
const LOGS_BASE_URL = 'http://localhost:3030'
const LOGS_INDEX = 'innomate-uae'
const LOG_QUERY_OPTIONS = [
  {
    value: 'relay-27-panelsession',
    label: 'Relay 27 panel session',
    template: 'container.name : "device-svr" AND message: ("r 1 SERIAL_PLACEHOLDER 27" AND "27")',
  },
  {
    value: 'relay-18-status',
    label: 'Relay 18 status',
    template: 'container.name : "device-svr" AND message: "r 1 SERIAL_PLACEHOLDER 18"',
  },
] as const
type LogQueryValue = (typeof LOG_QUERY_OPTIONS)[number]['value']

type LogEntry = {
  id: string
  timestamp?: string | null
  message: string
  rlsSts: boolean | null
  relayStartTime?: number | null
  relayDuration?: number | null
}

function extractRlsSts(message: string): boolean | null {
  const match = message.match(/"rls_sts"\s*:\s*(true|false)/i)
  if (match) return match[1].toLowerCase() === 'true'
  return null
}

function extractRelayMeta(message: string): { relayStartTime: number | null; relayDuration: number | null } {
  const startMatch = message.match(/"relay_start_time"\s*:\s*(\d+)/i)
  const durationMatch = message.match(/"duration"\s*:\s*(\d+)/i)
  return {
    relayStartTime: startMatch ? Number(startMatch[1]) : null,
    relayDuration: durationMatch ? Number(durationMatch[1]) : null,
  }
}

function cleanLogMessage(message: string): string {
  // Drop leading timestamp and tags like "[09.12.2025 ...] [LOG]   "
  const trimmed = message.replace(/^\[[^\]]+\]\s*\[LOG\]\s*/i, '').trim()
  return trimmed.length > 0 ? trimmed : message
}

// Helper to calculate epoch range based on selected time range
function getEpochRange(range: RangeValue, dateFrom: string, dateTo: string): { fromEpoch: number; toEpoch: number } {
  const now = new Date()
  const toEpoch = Math.floor(now.getTime() / 1000)
  let fromEpoch: number

  if (range === 'custom') {
    fromEpoch = dateFrom ? Math.floor(new Date(dateFrom).getTime() / 1000) : toEpoch - 7 * 24 * 60 * 60
    const customTo = dateTo ? Math.floor(new Date(dateTo).getTime() / 1000) : toEpoch
    return { fromEpoch, toEpoch: customTo }
  }

  if (range === 'today') {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    fromEpoch = Math.floor(todayStart.getTime() / 1000)
  } else if (range === 'yesterday') {
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    fromEpoch = Math.floor(yesterdayStart.getTime() / 1000)
    return { fromEpoch, toEpoch: Math.floor(todayStart.getTime() / 1000) }
  } else if (range === '24h') {
    fromEpoch = toEpoch - 24 * 60 * 60
  } else if (range === '7d') {
    fromEpoch = toEpoch - 7 * 24 * 60 * 60
  } else {
    fromEpoch = toEpoch - 24 * 60 * 60
  }

  return { fromEpoch, toEpoch }
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
  // Serial list state (from API)
  const [serialList, setSerialList] = useState<SerialItem[]>([])
  const [serialPage, setSerialPage] = useState(1)
  const [serialTotalPages, setSerialTotalPages] = useState(1)
  const [serialTotal, setSerialTotal] = useState(0)
  const [serialLoading, setSerialLoading] = useState(true)
  
  // Selected device state
  const [selectedSerial, setSelectedSerial] = useState<string>('')
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  
  // Connection records state (from API)
  const [records, setRecords] = useState<ConnectionRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  
  // Filter state
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [range, setRange] = useState<RangeValue>('7d')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  
  // UI state
  const [error, setError] = useState<string | null>(null)
  const [durationUnit, setDurationUnit] = useState<'seconds' | 'minutes' | 'hours'>('minutes')
  const [timezone, setTimezone] = useState<TimezoneValue>('UTC')
  const [env, setEnv] = useState<EnvType>('staging')

  // Logs state
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logPage, setLogPage] = useState(1)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [logHasMore, setLogHasMore] = useState(false)
  const [logQueryValue, setLogQueryValue] = useState<LogQueryValue>(LOG_QUERY_OPTIONS[0].value)
  
  // Device details modal state
  const [showDeviceModal, setShowDeviceModal] = useState(false)
  const [deviceDetails, setDeviceDetails] = useState<DeviceDetails | null>(null)
  const [associatedUsers, setAssociatedUsers] = useState<AssociatedUser[]>([])
  const [deviceDetailsLoading, setDeviceDetailsLoading] = useState(false)

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [timezone],
  )

  const formatInTimezone = useCallback(
    (d?: Date) => {
      if (!d) return '—'
      return dateFormatter.format(d)
    },
    [dateFormatter],
  )

  const formatEpochInTimezone = useCallback(
    (epochSeconds?: number | null) => {
      if (!epochSeconds) return '—'
      return formatInTimezone(new Date(epochSeconds * 1000))
    },
    [formatInTimezone],
  )

  const formatDurationSeconds = useCallback((seconds?: number | null) => {
    if (seconds === null || seconds === undefined) return '—'
    if (seconds < 60) return `${seconds}s`
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const parts = []
    if (hrs) parts.push(`${hrs}h`)
    if (mins) parts.push(`${mins}m`)
    if (secs || parts.length === 0) parts.push(`${secs}s`)
    return parts.join(' ')
  }, [])

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchDebounced(search)
      setSerialPage(1) // Reset to page 1 on new search
    }, 400)
    return () => clearTimeout(timer)
  }, [search])

  // Fetch serial numbers from API
  useEffect(() => {
    const fetchSerials = async () => {
      setSerialLoading(true)
      setError(null)
      try {
        const searchParam = searchDebounced || 'SPL'
        const url = `${ENV_CONFIG[env].url}/devices/search_serialno?search=${encodeURIComponent(searchParam)}&page=${serialPage}&limit=20`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: SerialSearchResponse = await res.json()
        setSerialList(data.data)
        setSerialTotalPages(data.total_pages)
        setSerialTotal(data.total)
        
        // Auto-select first serial if none selected
        if (!selectedSerial && data.data.length > 0) {
          setSelectedSerial(data.data[0].serial_no)
          setSelectedDeviceId(data.data[0].device_id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch serial numbers')
      } finally {
        setSerialLoading(false)
      }
    }
    fetchSerials()
  }, [searchDebounced, serialPage, env])

  // Fetch connection data when device or range changes
  useEffect(() => {
    if (!selectedDeviceId) {
      setRecords([])
      return
    }

    const fetchConnectionData = async () => {
      setRecordsLoading(true)
      try {
        const { fromEpoch, toEpoch } = getEpochRange(range, dateFrom, dateTo)
        const res = await fetch(`${ENV_CONFIG[env].url}/device_Maintainance/get_deviceConnection_data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_Id: selectedDeviceId,
            fromEpoch,
            toEpoch,
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: ConnectionDataResponse = await res.json()
        
        const parsed: ConnectionRecord[] = data.data.map((item) => ({
          serial: selectedSerial,
          deviceId: item.device_Id,
          status: item.con_status ? 'connected' : 'disconnected',
          timestamp: new Date(item.conn_sts_time * 1000),
          rawTime: item.conn_sts_time,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        }))
        
        // Sort by timestamp ascending
        parsed.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        setRecords(parsed)
      } catch (err) {
        console.error('Failed to fetch connection data:', err)
        setRecords([])
      } finally {
        setRecordsLoading(false)
      }
    }
    fetchConnectionData()
  }, [selectedDeviceId, selectedSerial, range, dateFrom, dateTo, env])

  // Handle serial selection
  const handleSelectSerial = (serial: string, deviceId: string) => {
    setSelectedSerial(serial)
    setSelectedDeviceId(deviceId)
    setLogPage(1)
  }

  // Fetch logs for selected serial
  useEffect(() => {
    const fetchLogs = async () => {
      if (!selectedSerial) {
        setLogs([])
        setLogHasMore(false)
        return
      }

      setLogsLoading(true)
      setLogsError(null)
      try {
        const selectedQuery = LOG_QUERY_OPTIONS.find((opt) => opt.value === logQueryValue) ?? LOG_QUERY_OPTIONS[0]
        const query = selectedQuery.template.replace('SERIAL_PLACEHOLDER', selectedSerial)
        const offset = (logPage - 1) * LOG_PAGE_SIZE
        const url = `${LOGS_BASE_URL}/logs/search?index=${encodeURIComponent(
          LOGS_INDEX,
        )}&query=${encodeURIComponent(query)}&offset=${offset}&limit=${LOG_PAGE_SIZE}&start_time=2025-08-10T00:00:00.000Z&end_time=2026-08-18T23:59:59.999Z`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: any[] = await res.json()
        const parsed: LogEntry[] = data.map((item) => {
          const msg = item?._source?.message || item?.message || ''
          const relayMeta = extractRelayMeta(msg)
          return {
            id: item?._id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: item?._source?.['@timestamp'] || null,
            message: cleanLogMessage(msg),
            rlsSts: extractRlsSts(msg),
            relayStartTime: relayMeta.relayStartTime,
            relayDuration: relayMeta.relayDuration,
          }
        })
        setLogs(parsed)
        setLogHasMore(parsed.length === LOG_PAGE_SIZE)
      } catch (err) {
        console.error('Failed to fetch logs:', err)
        setLogs([])
        setLogHasMore(false)
        setLogsError(err instanceof Error ? err.message : 'Failed to fetch logs')
      } finally {
        setLogsLoading(false)
      }
    }
    fetchLogs()
  }, [selectedSerial, logPage, logQueryValue])

  // Reset log page when query selection changes
  useEffect(() => {
    setLogPage(1)
  }, [logQueryValue])

  const logCounts = useMemo(() => {
    let trueCount = 0
    let falseCount = 0
    logs.forEach((l) => {
      if (l.rlsSts === true) trueCount += 1
      else if (l.rlsSts === false) falseCount += 1
    })
    return { trueCount, falseCount }
  }, [logs])

  // Fetch device details for modal
  const fetchDeviceDetails = async (serialNo: string) => {
    setDeviceDetailsLoading(true)
    setShowDeviceModal(true)
    setDeviceDetails(null)
    setAssociatedUsers([])
    
    try {
      const res = await fetch(`${ENV_CONFIG[env].url}/devices/deviceinfo?serial_no=${encodeURIComponent(serialNo)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: DeviceInfoResponse = await res.json()
      setDeviceDetails(data.device_details)
      setAssociatedUsers(data.associated_users || [])
    } catch (err) {
      console.error('Failed to fetch device details:', err)
    } finally {
      setDeviceDetailsLoading(false)
    }
  }

  // The filtered records are now directly from API (already filtered by range via epoch)
  const filtered = records

  const summary = useMemo(() => computeSummary(filtered), [filtered])

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
          label: formatInTimezone(periodStart.timestamp),
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
  }, [filtered, durationUnit, formatInTimezone])

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

  const formatDate = (d?: Date) => formatInTimezone(d)
  const formatDuration = (ms?: number) => {
    if (ms === undefined) return '—'
    if (ms < 60_000) return `${Math.round(ms / 1000)} sec`
    return `${(ms / 60_000).toFixed(1)} min`
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-blue-600">Connection Dashboard</p>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Environment:</span>
              <select
                value={env}
                onChange={(e) => setEnv(e.target.value as EnvType)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
              >
                {Object.entries(ENV_CONFIG).map(([key, config]) => (
                  <option key={key} value={key}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Device connectivity by serial number
          </h1>
          <p className="text-sm text-slate-600">
            Browse serial numbers, view connection timelines, and see quick uptime summaries.
          </p>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5" />
            <div>
              <p className="text-sm font-semibold">Failed to load data</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        <>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total events</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{records.length}</p>
              <p className="text-xs text-slate-500">{serialTotal} serial numbers found</p>
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
                <span className="text-xs text-slate-500">{serialTotal} total</span>
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
                {serialLoading ? (
                  <div className="flex items-center justify-center h-20">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  </div>
                ) : (
                  <div className="absolute inset-0 overflow-y-auto pr-1 space-y-2">
                    {serialList.map((s) => (
                      <button
                        key={s.device_id}
                        onClick={() => handleSelectSerial(s.serial_no, s.device_id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50 ${
                          selectedSerial === s.serial_no
                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        <span className="text-sm font-medium">{s.serial_no}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Pagination */}
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <button
                  onClick={() => setSerialPage((p) => Math.max(1, p - 1))}
                  disabled={serialPage <= 1}
                  className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-3 w-3" /> Prev
                </button>
                <span className="text-xs text-slate-500">
                  Page {serialPage} of {serialTotalPages}
                </span>
                <button
                  onClick={() => setSerialPage((p) => Math.min(serialTotalPages, p + 1))}
                  disabled={serialPage >= serialTotalPages}
                  className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="h-3 w-3" />
                </button>
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
                  {selectedSerial && (
                    <button
                      onClick={() => fetchDeviceDetails(selectedSerial)}
                      className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                    >
                      <Info className="h-3.5 w-3.5" />
                      Device Details
                    </button>
                  )}
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
                        ? `${formatInTimezone(summary.longestOn.start)} → ${formatInTimezone(summary.longestOn.end)}`
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
                        ? `${formatInTimezone(summary.longestOff.start)} → ${formatInTimezone(summary.longestOff.end)}`
                        : '—'}
                    </p>
                  </div>
                </div>

                

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-800">State duration chart</p>
                      <p className="text-xs text-slate-500">
                        Duration of each ON/OFF period • {filtered.length} events
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
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={range}
                        onChange={(e) => setRange(e.target.value as RangeValue)}
                        className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
                      >
                        {RANGE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <label className="flex items-center gap-1">
                        <span>Timezone</span>
                        <select
                          value={timezone}
                          onChange={(e) => setTimezone(e.target.value as TimezoneValue)}
                          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
                        >
                          {TIMEZONE_OPTIONS.map((tz) => (
                            <option key={tz.value} value={tz.value}>
                              {tz.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {range === 'custom' && (
                        <>
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
                              Clear
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 h-[320px]">
                    {recordsLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                      </div>
                    ) : durationChartData.labels.length > 0 ? (
                      <Bar data={durationChartData} options={durationChartOptions} />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        {selectedSerial ? 'No data for selected range.' : 'Select a serial to view data.'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-800">Device logs</p>
                      <p className="text-xs text-slate-500">
                        Messages for <span className="font-semibold text-slate-700">{selectedSerial || '—'}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="flex items-center gap-2">
                        <span className="text-slate-600">Query</span>
                        <select
                          value={logQueryValue}
                          onChange={(e) => setLogQueryValue(e.target.value as LogQueryValue)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                        >
                          {LOG_QUERY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                        rls_sts true: {logCounts.trueCount}
                      </span>
                      <span className="rounded-full bg-rose-50 px-3 py-1 font-medium text-rose-700">
                        rls_sts false: {logCounts.falseCount}
                      </span>
                    </div>
                  </div>

                  {logsError && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {logsError}
                    </div>
                  )}

                  <div className="mt-3 h-[280px] rounded-lg border border-slate-100 bg-slate-50/60">
                    {logsLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                      </div>
                    ) : logs.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        {selectedSerial ? 'No logs found for this serial.' : 'Select a serial to view logs.'}
                      </div>
                    ) : (
                      <div className="h-full overflow-y-auto">
                        <ul className="divide-y divide-slate-200 text-sm text-slate-800">
                          {logs.map((log) => (
                            <li key={log.id} className="px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] text-slate-500">
                                  {log.timestamp ? formatInTimezone(new Date(log.timestamp)) : '—'}
                                </span>
                                {log.rlsSts !== null && (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                      log.rlsSts
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                        : 'bg-rose-50 text-rose-700 border border-rose-100'
                                    }`}
                                  >
                                    rls_sts: {log.rlsSts ? 'true' : 'false'}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-slate-800">{log.message}</p>
                              {(log.relayStartTime || log.relayDuration) && (
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                                  {log.relayStartTime && (
                                    <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                                      Start: {formatEpochInTimezone(log.relayStartTime)}
                                    </span>
                                  )}
                                  {log.relayDuration !== null && log.relayDuration !== undefined && (
                                    <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
                                      Duration: {formatDurationSeconds(log.relayDuration)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <button
                      onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                      disabled={logPage <= 1 || logsLoading}
                      className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ChevronLeft className="h-3 w-3" /> Prev
                    </button>
                    <span className="text-xs text-slate-500">Page {logPage}</span>
                    <button
                      onClick={() => setLogPage((p) => p + 1)}
                      disabled={!logHasMore || logsLoading}
                      className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </>

        {/* Device Details Modal */}
        {showDeviceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-xl">
              {/* Modal Header */}
              <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Device Details: {deviceDetails?.serial_no || selectedSerial}
                </h2>
                <button
                  onClick={() => setShowDeviceModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6">
                {deviceDetailsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  </div>
                ) : deviceDetails ? (
                  <div className="space-y-6">
                    {/* Basic Info */}
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-800">Basic Information</h3>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Serial No</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.serial_no}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Firmware</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">v{deviceDetails.cur_firm_vrs}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Hardware</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">v{deviceDetails.hw_vrs}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Build Number</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.build_number}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Region</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.region || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Timezone</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.timezone || '—'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Network Info */}
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-800">Network</h3>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">BLE MAC</p>
                          <p className="mt-1 text-sm font-mono font-medium text-slate-900">{deviceDetails.BLE_mac || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Router SSID</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.router_ssid || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Router MAC</p>
                          <p className="mt-1 text-sm font-mono font-medium text-slate-900">{deviceDetails.router_mac || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Conn Status</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.conn_status}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Avg RSSI</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.avg_rssi ?? '—'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Connection Count</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.dev_con_cnt}</p>
                        </div>
                      </div>
                    </div>

                    {/* Counters */}
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-800">Counters & Statistics</h3>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Cold Power On</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.cold_power_on_cnt}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Receiver Reset</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.recvr_reset_cnt}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Server Conn</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.svr_con_count}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">App Server Conn</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.app_svr_con_cnt}</p>
                        </div>
                      </div>
                    </div>

                    {/* Settings */}
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-800">Settings</h3>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">High Temp</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.high_temp_thrs}°C</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Low Temp</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.low_temp_thrs}°C</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Auto On/Off</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.auto_onoff_enable ? 'Yes' : 'No'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Server OTA</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{deviceDetails.svr_ota ? 'Yes' : 'No'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Switches */}
                    {deviceDetails.switches && deviceDetails.switches.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-slate-800">Switches</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {deviceDetails.switches.map((sw) => (
                            <div key={sw.switch_id} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-900">{sw.switch_name}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                                  {sw.switch_type}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500">ID: {sw.switch_id}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Associated Users */}
                    {associatedUsers.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-slate-800">Associated Users</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {associatedUsers.map((user) => (
                            <div key={user._id} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-slate-900">{user.username}</span>
                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                  {user.user_role}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                                <div className="flex flex-col">
                                  <span className="text-slate-400 uppercase text-[10px]">Email Verified</span>
                                  <span className={user.is_email_verified ? "text-emerald-600 font-medium" : "text-slate-600"}>
                                    {user.is_email_verified ? 'Yes' : 'No'}
                                  </span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-slate-400 uppercase text-[10px]">Mobile Verified</span>
                                  <span className={user.is_mobile_verified ? "text-emerald-600 font-medium" : "text-slate-600"}>
                                    {user.is_mobile_verified ? 'Yes' : 'No'}
                                  </span>
                                </div>
                                {user.gender && (
                                  <div className="flex flex-col">
                                    <span className="text-slate-400 uppercase text-[10px]">Gender</span>
                                    <span>{user.gender}</span>
                                  </div>
                                )}
                                {user.dob && (
                                  <div className="flex flex-col">
                                    <span className="text-slate-400 uppercase text-[10px]">DOB</span>
                                    <span>{user.dob}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Timestamps */}
                    <div className="border-t border-slate-100 pt-4">
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                        <span>Created: {new Date(deviceDetails.createdAt).toLocaleString()}</span>
                        <span>Updated: {new Date(deviceDetails.updatedAt).toLocaleString()}</span>
                        {deviceDetails.latitude && deviceDetails.longitude && (
                          <span>Location: {deviceDetails.latitude.toFixed(4)}, {deviceDetails.longitude.toFixed(4)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-sm text-slate-500">
                    Failed to load device details.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
