import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Zap, 
  Cpu, 
  ArrowUpRight, 
  Server, 
  Database, 
  Radio, 
  Activity, 
  AlertTriangle 
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { formatDistanceToNow, format, subDays, startOfDay } from 'date-fns';
import { TelemetryCards } from '../components/TelemetryCards';
import { LiveEventFeed } from '../components/LiveEventFeed';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { PageHeader, Button, EmptyState } from '../components/ui';

export const Overview = () => {
  const navigate = useNavigate();
  const { events, connectionStatus, clearEvents } = useLiveEvents();
  
  const { data: overview, isLoading: overviewLoading } = useQuery({ 
    queryKey: ['overview'], 
    queryFn: api.getOverview,
    refetchInterval: 5000,
  });

  const { data: runsResponse, isLoading: runsLoading } = useQuery({ 
    queryKey: ['runs'], 
    queryFn: () => api.getRuns(undefined, 25),
    refetchInterval: 5000,
  });

  const runs = runsResponse?.data || [];
  const loading = overviewLoading && runsLoading;

  // Compute 7-day timeseries data from durable runs
  const activityData = useMemo(() => {
    const timeMap = new Map<number, { date: string; total: number; completed: number; failed: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = startOfDay(subDays(new Date(), i));
      timeMap.set(d.getTime(), { date: format(d, 'MMM dd'), total: 0, completed: 0, failed: 0 });
    }

    runs.forEach((r: any) => {
      const rawDate = r.created_at || r.started_at;
      if (!rawDate) return;
      const day = startOfDay(new Date(rawDate)).getTime();
      if (timeMap.has(day)) {
        const item = timeMap.get(day)!;
        item.total++;
        if (r.status === 'completed') item.completed++;
        if (r.status === 'failed') item.failed++;
      }
    });

    return Array.from(timeMap.values());
  }, [runs]);

  // Terminal outcome breakdown counts
  const outcomeStats = useMemo(() => {
    let completed = overview?.last24h.completed ?? 0;
    let failed = overview?.last24h.failed ?? 0;
    let running = overview?.activeRuns ?? 0;

    // Fall back to runs array if overview counts are zero but runs exist
    if (completed === 0 && failed === 0 && runs.length > 0) {
      completed = runs.filter((r: any) => r.status === 'completed').length;
      failed = runs.filter((r: any) => r.status === 'failed').length;
      running = runs.filter((r: any) => r.status === 'running' || r.status === 'pending').length;
    }

    const totalTerminal = completed + failed;
    return { completed, failed, running, totalTerminal };
  }, [overview, runs]);

  return (
    <div className="page-container">
      {/* Page Header */}
      <PageHeader
        title="Orchestration & Observability"
        description="Real-time execution metrics, telemetry health, and active workflow fleet status."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Link to="/dev-tools">
              <Button variant="secondary" size="sm" icon={<Zap size={14} style={{ color: 'var(--accent)' }} />}>
                Dev Tools
              </Button>
            </Link>
            <Link to="/workflows">
              <Button variant="primary" size="sm" icon={<Play size={14} />}>
                Submit Workflow
              </Button>
            </Link>
          </div>
        }
      />

      {/* 1. Compact KPI Strip */}
      <div className="kpi-strip">
        {/* Running Executions */}
        <div className="kpi-card interactive" onClick={() => navigate('/runs?status=running')}>
          <div className="kpi-header">
            <span>Running Executions</span>
            <Clock size={14} style={{ color: 'var(--status-info)' }} />
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value">{overview?.activeRuns ?? 0}</span>
            <span className="kpi-subtext">active leases</span>
          </div>
        </div>

        {/* 24h Completed */}
        <div className="kpi-card interactive" onClick={() => navigate('/runs?status=completed')}>
          <div className="kpi-header">
            <span>24h Completed</span>
            <CheckCircle2 size={14} style={{ color: 'var(--status-success)' }} />
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value">{overview?.last24h.completed ?? 0}</span>
            <span className="kpi-subtext">terminal runs</span>
          </div>
        </div>

        {/* 24h Failed */}
        <div className="kpi-card interactive" onClick={() => navigate('/runs?status=failed')}>
          <div className="kpi-header">
            <span>24h Failed</span>
            <XCircle size={14} style={{ color: 'var(--status-error)' }} />
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value" style={{ color: (overview?.last24h.failed ?? 0) > 0 ? 'var(--status-error)' : 'inherit' }}>
              {overview?.last24h.failed ?? 0}
            </span>
            <span className="kpi-subtext">failures</span>
          </div>
        </div>

        {/* Success Rate */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span>Success Rate</span>
            <Activity size={14} style={{ color: 'var(--status-success)' }} />
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value">
              {overview?.successRatePct != null ? `${overview.successRatePct.toFixed(1)}%` : '—'}
            </span>
            <span className="kpi-subtext">terminal window</span>
          </div>
        </div>

        {/* Avg Duration */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span>Avg Duration</span>
            <Zap size={14} style={{ color: 'var(--accent)' }} />
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value">
              {overview?.avgDurationMs != null ? `${Math.round(overview.avgDurationMs)}ms` : '—'}
            </span>
            <span className="kpi-subtext">per execution</span>
          </div>
        </div>

        {/* Active Workers */}
        <div className="kpi-card interactive" onClick={() => navigate('/workers')}>
          <div className="kpi-header">
            <span>Active Workers</span>
            <Cpu size={14} style={{ color: (overview?.systemHealth.workers ?? 0) > 0 ? 'var(--status-success)' : 'var(--status-warning)' }} />
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value">{overview?.systemHealth.workers ?? 0}</span>
            <span className="kpi-subtext">heartbeat &lt; 2m</span>
          </div>
        </div>
      </div>

      {/* 2. Recent Persisted Executions Table */}
      <div className="table-wrapper" style={{ marginBottom: '1.25rem' }}>
        <div className="table-header-bar">
          <div className="table-header-title">
            <Clock size={16} style={{ color: 'var(--accent)' }} />
            <span>Recent Executions</span>
            <span className="badge badge-neutral">{runs.length} runs</span>
          </div>
          <Link to="/runs" className="btn btn-sm btn-ghost" style={{ gap: '0.25rem' }}>
            View all executions <ArrowUpRight size={14} />
          </Link>
        </div>

        <div className="table-container">
          {runs.length === 0 ? (
            <EmptyState
              title="No workflow executions found"
              description="No recent workflow executions recorded yet. Submit a workflow or run a test scenario to populate data."
              action={
                <Link to="/workflows">
                  <Button variant="secondary" size="sm">Explore Workflows</Button>
                </Link>
              }
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Run ID</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Attempts</th>
                  <th>Started At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 8).map((run: any) => {
                  let badgeType = 'badge-info';
                  if (run.status === 'completed') badgeType = 'badge-success';
                  if (run.status === 'failed') badgeType = 'badge-error';
                  if (run.status === 'cancelled') badgeType = 'badge-warning';

                  const duration = run.completed_at && (run.started_at || run.created_at)
                    ? new Date(run.completed_at).getTime() - new Date(run.started_at || run.created_at).getTime()
                    : null;

                  return (
                    <tr key={run.id}>
                      <td style={{ fontWeight: 500 }}>
                        <Link to={`/workflows/${run.workflow_id}`}>
                          {run.workflow_name || run.workflow_id?.slice(0, 16) || 'Workflow'}
                        </Link>
                      </td>
                      <td className="font-mono">
                        <Link to={`/runs/${run.id}`} style={{ color: 'var(--accent)' }}>
                          {run.id.slice(0, 8)}...
                        </Link>
                      </td>
                      <td>
                        <span className={`badge ${badgeType}`}>
                          <span className="badge-dot" />
                          {run.status}
                        </span>
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {duration != null ? `${duration}ms` : '—'}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {run.attempts ?? 1}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {run.started_at || run.created_at 
                          ? formatDistanceToNow(new Date(run.started_at || run.created_at), { addSuffix: true }) 
                          : '—'}
                      </td>
                      <td>
                        <Link to={`/runs/${run.id}`} className="btn btn-sm btn-ghost" style={{ padding: '0.2rem 0.5rem' }}>
                          Inspect
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 3 & 4. Execution Activity Chart & Outcome Breakdown */}
      <div className="overview-grid-2col">
        {/* Execution Activity (7 Days) */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <Activity size={16} style={{ color: 'var(--accent)' }} />
              Execution Activity (7 Days)
            </span>
            <span className="badge badge-neutral">Durable Log</span>
          </div>

          <div style={{ height: '220px', width: '100%', marginTop: '0.75rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="chartTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="chartFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--status-error)" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="var(--status-error)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="date" 
                  stroke="var(--border-default)" 
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }} 
                  tickLine={false} 
                  axisLine={false} 
                />
                <YAxis 
                  stroke="var(--border-default)" 
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }} 
                  tickLine={false} 
                  axisLine={false} 
                  allowDecimals={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--bg-surface)', 
                    border: '1px solid var(--border-default)', 
                    borderRadius: '6px', 
                    color: 'var(--text-primary)',
                    boxShadow: 'var(--shadow-md)',
                    fontSize: '12px'
                  }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                />
                <Area type="monotone" dataKey="total" stroke="var(--accent)" strokeWidth={2} fillOpacity={1} fill="url(#chartTotal)" name="Total Runs" />
                <Area type="monotone" dataKey="failed" stroke="var(--status-error)" strokeWidth={2} fillOpacity={1} fill="url(#chartFail)" name="Failed Runs" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Outcome Breakdown (Compact Bar Representation) */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <CheckCircle2 size={16} style={{ color: 'var(--status-success)' }} />
              Terminal Outcome Breakdown
            </span>
            <span className="badge badge-neutral tabular-nums">{outcomeStats.totalTerminal} terminal runs</span>
          </div>

          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {/* Completed Bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', marginBottom: '0.375rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-secondary)' }}>
                    <span className="badge-dot" style={{ backgroundColor: 'var(--status-success)' }} /> Completed Runs
                  </span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>{outcomeStats.completed}</span>
                </div>
                <div style={{ height: '8px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      height: '100%', 
                      backgroundColor: 'var(--status-success)', 
                      width: outcomeStats.totalTerminal > 0 ? `${(outcomeStats.completed / outcomeStats.totalTerminal) * 100}%` : '0%' 
                    }} 
                  />
                </div>
              </div>

              {/* Failed Bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', marginBottom: '0.375rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-secondary)' }}>
                    <span className="badge-dot" style={{ backgroundColor: 'var(--status-error)' }} /> Failed Runs
                  </span>
                  <span className="tabular-nums" style={{ fontWeight: 600, color: outcomeStats.failed > 0 ? 'var(--status-error)' : 'inherit' }}>{outcomeStats.failed}</span>
                </div>
                <div style={{ height: '8px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      height: '100%', 
                      backgroundColor: 'var(--status-error)', 
                      width: outcomeStats.totalTerminal > 0 ? `${(outcomeStats.failed / outcomeStats.totalTerminal) * 100}%` : '0%' 
                    }} 
                  />
                </div>
              </div>

              {/* Running / Active Leases */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', marginBottom: '0.375rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-secondary)' }}>
                    <span className="badge-dot" style={{ backgroundColor: 'var(--status-info)' }} /> Currently Running
                  </span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>{outcomeStats.running}</span>
                </div>
                <div style={{ height: '8px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      height: '100%', 
                      backgroundColor: 'var(--status-info)', 
                      width: outcomeStats.running > 0 ? '100%' : '0%' 
                    }} 
                  />
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1.25rem', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', fontSize: '11px', color: 'var(--text-muted)' }}>
              <strong>Calculation Invariant:</strong> Success rate denominator includes only confirmed terminal runs (Completed + Failed). Ongoing executions are excluded until a terminal state transition occurs.
            </div>
          </div>
        </div>
      </div>

      {/* 5 & 6. System Infrastructure Health & Live Operational Event Stream */}
      <div className="overview-grid-2col">
        {/* System Health */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <Server size={16} style={{ color: 'var(--accent)' }} />
              System Infrastructure Readiness
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <Database size={16} style={{ color: 'var(--text-secondary)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>PostgreSQL</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Durable transactional state store & event journal</div>
                </div>
              </div>
              <span className={`badge ${overview?.systemHealth.postgres === 'ok' ? 'badge-success' : 'badge-error'}`}>
                <span className="badge-dot" />
                {overview?.systemHealth.postgres?.toUpperCase() || 'UNKNOWN'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <Activity size={16} style={{ color: 'var(--text-secondary)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>NATS JetStream</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Work queue broker & message dispatch</div>
                </div>
              </div>
              <span className={`badge ${overview?.systemHealth.nats === 'ok' ? 'badge-success' : 'badge-error'}`}>
                <span className="badge-dot" />
                {overview?.systemHealth.nats?.toUpperCase() || 'UNKNOWN'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <Cpu size={16} style={{ color: 'var(--text-secondary)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Worker Runtime Fleet</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Rust orchestration worker + TypeScript sidecar</div>
                </div>
              </div>
              <span className={`badge ${(overview?.systemHealth.workers ?? 0) > 0 ? 'badge-success' : 'badge-warning'}`}>
                <span className="badge-dot" />
                {(overview?.systemHealth.workers ?? 0) > 0 ? `${overview?.systemHealth.workers} Active Node(s)` : 'Offline'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <Radio size={16} style={{ color: 'var(--text-secondary)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Live SSE Telemetry Stream</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Event transport: /v1/events/stream</div>
                </div>
              </div>
              <span className={`badge ${connectionStatus === 'connected' ? 'badge-success' : connectionStatus === 'connecting' ? 'badge-warning' : 'badge-error'}`}>
                <span className="badge-dot" />
                {connectionStatus.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Live SSE Operational Event Feed */}
        <LiveEventFeed events={events} connectionStatus={connectionStatus} onClear={clearEvents} />
      </div>

      {/* 7. Compact Integration Summaries (Redis & AI) */}
      <TelemetryCards />
    </div>
  );
};
