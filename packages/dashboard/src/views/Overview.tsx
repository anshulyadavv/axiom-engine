import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getApiConfig } from '../api';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { PageHeader, Button } from '../components/ui';

export const Overview = () => {
  const navigate = useNavigate();
  const { connectionStatus, retry: retryEventStream } = useLiveEvents();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const { data: overview } = useQuery({ 
    queryKey: ['overview'], 
    queryFn: api.getOverview,
    refetchInterval: 5000,
  });

  const { data: runsResponse, isLoading: runsLoading } = useQuery({ 
    queryKey: ['runs', 'recent'], 
    queryFn: () => api.getRuns(undefined, 10),
    refetchInterval: 5000,
  });

  const runs = runsResponse?.data || [];
  const apiReachable = overview?.systemHealth.apiReachable ?? true;
  const apiUrl = overview?.systemHealth.apiUrl || getApiConfig().url;

  const copyRunId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const getRunStatusDetails = (status: string) => {
    switch (status) {
      case 'completed':
        return { variant: 'success', label: 'Completed' };
      case 'failed':
        return { variant: 'error', label: 'Failed' };
      case 'cancelled':
        return { variant: 'warning', label: 'Cancelled' };
      case 'running':
        return { variant: 'info', label: 'Running' };
      case 'pending':
        return { variant: 'neutral', label: 'Pending' };
      default:
        return { variant: 'neutral', label: status.charAt(0).toUpperCase() + status.slice(1) };
    }
  };

  // System status item values
  const postgresStatus = !apiReachable ? 'Not available' : (overview?.systemHealth.postgres || 'Not checked');
  const postgresDot = !apiReachable ? 'neutral' : (postgresStatus === 'Healthy' ? 'success' : postgresStatus === 'Unreachable' ? 'error' : 'neutral');

  const natsStatus = !apiReachable ? 'Not available' : (overview?.systemHealth.nats || 'Not checked');
  const natsDot = !apiReachable ? 'neutral' : (natsStatus === 'Healthy' ? 'success' : natsStatus === 'Unreachable' ? 'error' : 'neutral');

  const workersCount = overview?.systemHealth.workers ?? 0;
  const workerStatus = !apiReachable ? 'Not available' : (workersCount > 0 ? `${workersCount} active` : '0 active');
  const workerDot = !apiReachable ? 'neutral' : (workersCount > 0 ? 'success' : 'neutral');

  const streamStatus = connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'connecting' ? 'Connecting' : connectionStatus === 'reconnecting' ? 'Reconnecting' : 'Disconnected';
  const streamDot = connectionStatus === 'connected' ? 'success' : connectionStatus === 'disconnected' ? 'error' : 'neutral';

  return (
    <div className="page-container">
      {/* Unreachable API Top Banner (Step 4b) */}
      {!apiReachable && (
        <div className="api-reachability-banner" role="alert">
          <span>Cannot reach the API at {apiUrl}. Retrying.</span>
        </div>
      )}

      {/* Page Header (Step 6) */}
      <PageHeader
        title="Overview"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Link to="/dev-tools">
              <Button variant="secondary" size="sm">
                Dev Tools
              </Button>
            </Link>
            <Link to="/workflows">
              <Button variant="primary" size="sm">
                Submit Workflow
              </Button>
            </Link>
          </div>
        }
      />

      {/* 1. Compact KPI Strip (Step 1a, Step 5a, Step 5e) */}
      <div className="kpi-strip">
        {/* Running Executions */}
        <div className="kpi-card interactive" onClick={() => navigate('/runs?status=running')}>
          <div className="kpi-header">
            <span>Running Executions</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value tabular-nums">
              {!apiReachable ? '—' : (overview?.activeRuns ?? 0)}
            </span>
            <span className="kpi-subtext">active leases</span>
          </div>
        </div>

        {/* 24h Completed */}
        <div className="kpi-card interactive" onClick={() => navigate('/runs?status=completed')}>
          <div className="kpi-header">
            <span>24h Completed</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value tabular-nums">
              {!apiReachable ? '—' : (overview?.last24h.completed ?? 0)}
            </span>
          </div>
        </div>

        {/* 24h Failed */}
        <div className="kpi-card interactive" onClick={() => navigate('/runs?status=failed')}>
          <div className="kpi-header">
            <span>24h Failed</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value tabular-nums" style={{ color: (overview?.last24h.failed ?? 0) > 0 ? 'var(--status-error)' : 'inherit' }}>
              {!apiReachable ? '—' : (overview?.last24h.failed ?? 0)}
            </span>
          </div>
        </div>

        {/* Success Rate */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span 
              className="kpi-label-tooltip" 
              tabIndex={0}
              title="Terminal runs only: completed / (completed + failed)."
              aria-label="Success Rate. Tooltip: Terminal runs only: completed / (completed + failed)."
            >
              Success Rate
            </span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value tabular-nums">
              {!apiReachable || overview?.successRatePct == null ? '—' : `${overview.successRatePct.toFixed(1)}%`}
            </span>
          </div>
        </div>

        {/* Avg Duration */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span>Avg Duration</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value tabular-nums">
              {!apiReachable || overview?.avgDurationMs == null ? '—' : `${Math.round(overview.avgDurationMs)}ms`}
            </span>
            <span className="kpi-subtext">per execution</span>
          </div>
        </div>

        {/* Active Workers */}
        <div className="kpi-card interactive" onClick={() => navigate('/workers')}>
          <div className="kpi-header">
            <span>Active Workers</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value tabular-nums">
              {!apiReachable ? '—' : workersCount}
            </span>
            <span className="kpi-subtext">heartbeat &lt; 2m</span>
          </div>
        </div>
      </div>

      {/* 2. Compact System Status Row (Step 5a, Step 6) */}
      <div className="system-status-row">
        <div className="system-status-item">
          <span className="system-status-name">Postgres</span>
          <span className={`status-dot status-dot-${postgresDot}`} />
          <span className="system-status-text">{postgresStatus}</span>
        </div>

        <div className="system-status-item">
          <span className="system-status-name">NATS</span>
          <span className={`status-dot status-dot-${natsDot}`} />
          <span className="system-status-text">{natsStatus}</span>
        </div>

        <div className="system-status-item">
          <span className="system-status-name">{workersCount === 1 ? 'Worker' : 'Workers'}</span>
          <span className={`status-dot status-dot-${workerDot}`} />
          <span className="system-status-text">{workerStatus}</span>
        </div>

        <div className="system-status-item">
          <span className="system-status-name">Event stream</span>
          <span className={`status-dot status-dot-${streamDot}`} />
          <span className="system-status-text">{streamStatus}</span>
          {connectionStatus === 'disconnected' && (
            <button className="btn btn-sm btn-ghost" onClick={retryEventStream} style={{ padding: '0 4px', height: '20px', fontSize: '11px', marginLeft: '4px' }}>
              Retry
            </button>
          )}
        </div>
      </div>

      {/* 3. Recent Runs Table (Step 5a, Step 5d) */}
      <div className="table-wrapper">
        <div className="table-header-bar">
          <span className="table-title">Recent Runs</span>
          <Link to="/runs" className="table-header-link">
            View all <ArrowRight size={12} className="link-arrow" />
          </Link>
        </div>

        <div className="table-container">
          {runsLoading ? (
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              Loading runs...
            </div>
          ) : runs.length === 0 ? (
            <div className="empty-state-simple">
              <span>No workflow executions recorded yet.</span>
              <Link to="/workflows">
                <Button variant="primary" size="sm">Submit workflow</Button>
              </Link>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th style={{ textAlign: 'right' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 10).map((run: any) => {
                  const statusDetails = getRunStatusDetails(run.status);
                  const duration = run.completed_at && (run.started_at || run.created_at)
                    ? new Date(run.completed_at).getTime() - new Date(run.started_at || run.created_at).getTime()
                    : null;
                  const isCopied = copiedId === run.id;

                  return (
                    <tr key={run.id} onClick={() => navigate(`/runs/${run.id}`)} style={{ cursor: 'pointer' }}>
                      <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>
                        <span 
                          onClick={(e) => copyRunId(run.id, e)}
                          title="Click to copy full Run ID"
                          style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: '4px',
                            cursor: 'copy',
                            color: 'var(--text-primary)'
                          }}
                        >
                          {run.id.slice(0, 8)}…
                          {isCopied ? (
                            <Check size={11} style={{ color: 'var(--status-success)' }} />
                          ) : (
                            <Copy size={11} style={{ opacity: 0.45 }} />
                          )}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        <Link 
                          to={`/workflows/${run.workflow_id}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: 'inherit' }}
                        >
                          {run.workflow_name || run.workflow_id?.slice(0, 16) || 'Workflow'}
                        </Link>
                      </td>
                      <td>
                        <span className="status-cell">
                          <span className={`status-dot status-dot-${statusDetails.variant}`} />
                          <span>{statusDetails.label}</span>
                        </span>
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {run.started_at || run.created_at 
                          ? formatDistanceToNow(new Date(run.started_at || run.created_at), { addSuffix: true }) 
                          : '—'}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {duration != null ? `${duration}ms` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
