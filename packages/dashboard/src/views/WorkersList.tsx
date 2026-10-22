import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatDistanceToNow, format } from 'date-fns';
import { PageHeader, Button, Badge } from '../components/ui';

export const WorkersList = () => {
  const { data: workers = [], isLoading, refetch, isFetching } = useQuery({ 
    queryKey: ['workers'], 
    queryFn: api.getWorkers,
    refetchInterval: 5000,
  });

  const workerTitle = workers.length === 1 ? 'Worker' : 'Workers';

  return (
    <div className="page-container">
      {/* Header */}
      <PageHeader
        title={workerTitle}
        description="Active worker processes, heartbeat timestamps, and node status."
        actions={
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isFetching}
            isLoading={isFetching}
          >
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="card" style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Discovering active worker processes...
        </div>
      ) : workers.length === 0 ? (
        <div className="card" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              No Active Worker Nodes Detected
            </h2>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Workflow execution leases require at least one active worker process connected to NATS and Postgres.
            </p>
          </div>

          <div style={{ backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              Start a worker node:
            </div>
            <pre className="font-mono" style={{ fontSize: '12px', padding: '0.75rem', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', color: 'var(--text-primary)' }}>
              cargo run -p axiom-worker
            </pre>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Ensure DATABASE_URL, NATS_URL, and SIDECAR_PATH are configured.
            </div>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <div className="table-header-bar">
            <div className="table-header-title">
              <span>Registered Workers</span>
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
                  <th style={{ textAlign: 'right' }}>PID</th>
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
                        <Badge variant={isStale ? 'warning' : 'success'}>
                          {isStale ? 'Stale' : 'Healthy'}
                        </Badge>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {meta.hostname || 'localhost'}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
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
