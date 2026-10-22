import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { format } from 'date-fns';
import { Copy, Check, ChevronRight, ArrowLeft } from 'lucide-react';
import { Button, Badge } from '../components/ui';

export const RunDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'events' | 'steps'>('events');
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

  const { data: run, isLoading, isError, error } = useQuery({ 
    queryKey: ['run', id], 
    queryFn: () => api.getRun(id!) 
  });

  const toggleStep = (stepKey: string) => {
    setExpandedSteps(prev => ({ ...prev, [stepKey]: !prev[stepKey] }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sanitizePayload = (obj: any): string => {
    if (!obj) return 'null';
    try {
      const sanitized = JSON.parse(JSON.stringify(obj, (key, value) => {
        if (/password|secret|token|apikey|authorization/i.test(key)) {
          return '******** [REDACTED]';
        }
        return value;
      }));
      return JSON.stringify(sanitized, null, 2);
    } catch {
      return String(obj);
    }
  };

  const durationMs = useMemo(() => {
    if (!run?.started_at && !run?.created_at) return null;
    const start = new Date(run.started_at || run.created_at).getTime();
    if (!run.completed_at) return null;
    const end = new Date(run.completed_at).getTime();
    return Math.max(0, end - start);
  }, [run]);

  if (isLoading) {
    return (
      <div className="page-container">
        <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading run details...
        </div>
      </div>
    );
  }

  if (isError || !run) {
    return (
      <div className="page-container">
        <div style={{ marginBottom: '1rem' }}>
          <Link to="/runs">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={13} className="back-arrow" />}>
              Back to runs
            </Button>
          </Link>
        </div>
        <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          {error instanceof Error ? error.message : 'Run not found or failed to load.'}
        </div>
      </div>
    );
  }

  let statusVariant: 'success' | 'error' | 'warning' | 'info' | 'neutral' = 'neutral';
  let statusText = 'Pending';
  if (run.status === 'completed') {
    statusVariant = 'success';
    statusText = 'Completed';
  } else if (run.status === 'failed') {
    statusVariant = 'error';
    statusText = 'Failed';
  } else if (run.status === 'cancelled') {
    statusVariant = 'warning';
    statusText = 'Cancelled';
  } else if (run.status === 'running') {
    statusVariant = 'info';
    statusText = 'Running';
  }

  const fenceToken = run.fence_token != null ? run.fence_token : '—';
  const leaseHolder = run.worker_id ? run.worker_id : 'None';

  return (
    <div className="page-container">
      {/* Back button */}
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/runs">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={13} className="back-arrow" />}>
            Back to runs
          </Button>
        </Link>
      </div>

      {/* Header Card (Step 8) */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
              <Badge variant={statusVariant}>
                {statusText}
              </Badge>
              <span className="font-mono" style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
                {run.id}
              </span>
              <button 
                className="btn btn-sm btn-ghost" 
                onClick={() => copyToClipboard(run.id)}
                title="Copy Run ID"
                style={{ padding: '2px 6px' }}
              >
                {copied ? <Check size={12} style={{ color: 'var(--status-success)' }} /> : <Copy size={12} />}
              </button>
            </div>

            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              Workflow: <Link to={`/workflows/${run.workflow_id}`} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{run.workflow_name || run.workflow_id}</Link>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Duration</div>
              <div className="tabular-nums" style={{ fontSize: 'var(--font-size-base)', fontWeight: 600 }}>
                {durationMs != null ? `${durationMs}ms` : 'In progress'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Fence Token</div>
              <div className="tabular-nums font-mono" style={{ fontSize: 'var(--font-size-base)', fontWeight: 600 }}>
                {fenceToken}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Lease Holder</div>
              <div className="font-mono" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                {leaseHolder}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Started</div>
              <div className="tabular-nums" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                {run.started_at || run.created_at ? format(new Date(run.started_at || run.created_at), 'yyyy-MM-dd HH:mm:ss') : '—'}
              </div>
            </div>
            {run.completed_at && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Completed</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                  {format(new Date(run.completed_at), 'yyyy-MM-dd HH:mm:ss')}
                </div>
              </div>
            )}
          </div>
        </div>

        {run.status === 'failed' && (
          <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', backgroundColor: 'var(--status-error-bg)', border: '1px solid var(--status-error-border)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ color: 'var(--status-error)', fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
              Execution failure
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {run.error || 'Execution encountered a terminal error.'}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-default)' }}>
        <button 
          className={`filter-tab ${activeTab === 'events' ? 'active' : ''}`}
          style={{ padding: '0.5rem 1rem', borderBottom: activeTab === 'events' ? '2px solid var(--accent)' : 'none' }}
          onClick={() => setActiveTab('events')}
        >
          Events ({run.events?.length || 0})
        </button>
        <button 
          className={`filter-tab ${activeTab === 'steps' ? 'active' : ''}`}
          style={{ padding: '0.5rem 1rem', borderBottom: activeTab === 'steps' ? '2px solid var(--accent)' : 'none' }}
          onClick={() => setActiveTab('steps')}
        >
          Steps ({run.steps?.length || 0})
        </button>
      </div>

      {/* Tab: Events Table (Step 8: Plain table of events) */}
      {activeTab === 'events' && (
        <div className="table-wrapper">
          <div className="table-container">
            {!run.events || run.events.length === 0 ? (
              <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
                No events recorded for this run.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '80px' }}>Seq</th>
                    <th>Event Type</th>
                    <th>Timestamp</th>
                    <th>Step</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {run.events.map((ev: any, idx: number) => (
                    <tr key={ev.id || idx}>
                      <td className="tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>
                        {ev.sequence_number != null ? ev.sequence_number : idx + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {ev.event_type || ev.type}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {ev.timestamp ? format(new Date(ev.timestamp), 'yyyy-MM-dd HH:mm:ss.SSS') : '—'}
                      </td>
                      <td className="font-mono" style={{ fontSize: '12px' }}>
                        {ev.step_id || '—'}
                      </td>
                      <td className="font-mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data || ev.payload || {})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Tab: Steps Timeline */}
      {activeTab === 'steps' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {!run.steps || run.steps.length === 0 ? (
            <div className="card" style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              No discrete step checkpoints recorded for this execution.
            </div>
          ) : (
            run.steps.map((step: any, idx: number) => {
              const stepKey = `step-${step.step_id}-${step.attempt || idx}`;
              const isExpanded = !!expandedSteps[stepKey];

              let stepVariant: 'success' | 'error' | 'info' = 'info';
              let stepLabel = 'Running';
              if (step.status === 'completed') {
                stepVariant = 'success';
                stepLabel = 'Completed';
              } else if (step.status === 'failed') {
                stepVariant = 'error';
                stepLabel = 'Failed';
              }

              return (
                <div key={stepKey} className="step-card">
                  <div 
                    style={{ 
                      padding: '0.75rem 1rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                    onClick={() => toggleStep(stepKey)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <ChevronRight size={14} className={`disclosure-chevron ${isExpanded ? 'expanded' : ''}`} />
                      <span className="font-mono" style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                        {step.step_id}
                      </span>
                      <Badge variant={stepVariant}>
                        {stepLabel}
                      </Badge>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', fontSize: 'var(--font-size-xs)' }}>
                      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        Attempt {step.attempt ?? 1}
                      </span>
                      <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {step.duration_ms != null ? `${step.duration_ms}ms` : '—'}
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-default)', backgroundColor: 'var(--bg-surface-elevated)' }}>
                      {step.error && (
                        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: 'var(--status-error-bg)', border: '1px solid var(--status-error-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--status-error)' }}>
                          <strong>Error:</strong> {step.error}
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Step Input</label>
                          <pre className="font-mono" style={{ fontSize: '11px', padding: '0.5rem', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', maxHeight: '160px' }}>
                            {sanitizePayload(step.input)}
                          </pre>
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Step Output</label>
                          <pre className="font-mono" style={{ fontSize: '11px', padding: '0.5rem', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', maxHeight: '160px' }}>
                            {sanitizePayload(step.output)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
