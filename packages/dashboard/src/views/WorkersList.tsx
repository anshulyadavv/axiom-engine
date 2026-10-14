import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatDistanceToNow, format } from 'date-fns';
import { Cpu, Terminal, RefreshCw, AlertTriangle } from 'lucide-react';
import { PageHeader, Button, Badge } from '../components/ui';

export const WorkersList = () => {
  const { data: workers = [], isLoading, refetch, isFetching } = useQuery({ 
    queryKey: ['workers'], 
    queryFn: api.getWorkers,
    refetchInterval: 5000,
  });

  return (
    <div className="page-container">
      {/* Header */}
      <PageHeader
        title="Worker Fleet"
        description="Active worker execution fleet, heartbeat telemetry, and node status."
        actions={
          <Button 
            variant="secondary" 
            size="sm" 
            icon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />} 
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="card" style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Discovering active worker fleet...
        </div>
      ) : workers.length === 0 ? (
        /* Meaningful Empty / Offline Guidance State */
        <div className="card" style={{ borderColor: 'var(--status-warning-border)', backgroundColor: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.25rem' }}>
            <div style={{ padding: '0.625rem', backgroundColor: 'var(--status-warning-bg)', borderRadius: 'var(--radius-md)', color: 'var(--status-warning)' }}>
              <AlertTriangle size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                No Active Worker Nodes Detected
              </h2>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Workflow execution leases cannot be dispatched to NATS JetStream without at least one online worker process.
              </p>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              <Terminal size={14} style={{ color: 'var(--accent)' }} />
              Start a Worker Node (PowerShell / Windows CMD):
            </div>
            <pre className="font-mono" style={{ fontSize: '12px', padding: '0.75rem', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', color: 'var(--accent)' }}>
              cargo run -p axiom-worker
            </pre>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Ensure <code>DATABASE_URL</code>, <code>NATS_URL</code>, and <code>SIDECAR_PATH</code> are configured in your <code>.env</code> file.
            </div>
          </div>
        </div>
      ) : (
        /* Workers Table */
        <div className="table-wrapper">
          <div className="table-header-bar">
            <div className="table-header-title">
              <Cpu size={16} style={{ color: 'var(--accent)' }} />
              <span>Registered Worker Fleet</span>
              <Badge variant="success">{workers.length} online</Badge>
            </div>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Worker ID</th>
                  <th>Status</th>
                  <th>Hostname</th>
                  <th>PID</th>
                  <th>Version</th>
                  <th>Last Heartbeat</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker: any) => {
                  const lastSeen = worker.last_heartbeat ? new Date(worker.last_heartbeat) : null;
                  const isStale = lastSeen ? (Date.now() - lastSeen.getTime()) > 120000 : true;

                  const meta = worker.metadata || {};

                  return (
                    <tr key={worker.id}>
                      <td className="font-mono" style={{ fontWeight: 600 }}>
                        {worker.id}
                      </td>
                      <td>
                        <Badge variant={isStale ? 'warning' : 'success'} dot>
                          {isStale ? 'STALE' : 'HEALTHY'}
                        </Badge>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {meta.hostname || 'localhost'}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {meta.pid || '—'}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {meta.version || '0.1.0'}
                      </td>
                      <td className="tabular-nums" style={{ color: isStale ? 'var(--status-warning)' : 'var(--text-secondary)' }}>
                        {lastSeen ? formatDistanceToNow(lastSeen, { addSuffix: true }) : '—'}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {worker.registered_at ? format(new Date(worker.registered_at), 'yyyy-MM-dd HH:mm') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
