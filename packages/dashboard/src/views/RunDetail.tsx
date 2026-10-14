import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { formatDistanceToNow, format } from 'date-fns';
import { 
  Clock, 
  Copy, 
  Check, 
  ArrowLeft, 
  ChevronDown, 
  ChevronRight, 
  AlertTriangle, 
  Activity,
  Layers
} from 'lucide-react';
import { Button, Badge } from '../components/ui';

export const RunDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'events'>('timeline');
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

  const { data: run, isLoading } = useQuery({ 
    queryKey: ['run', id], 
    queryFn: () => api.getRunTimeline(id!) 
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

  if (isLoading || !run) {
    return (
      <div className="page-container">
        <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading execution timeline...
        </div>
      </div>
    );
  }

  let statusVariant: 'success' | 'error' | 'warning' | 'info' = 'info';
  if (run.status === 'completed') statusVariant = 'success';
  if (run.status === 'failed') statusVariant = 'error';
  if (run.status === 'cancelled') statusVariant = 'warning';

  return (
    <div className="page-container">
      {/* Back button & Breadcrumb */}
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/runs">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
            Back to Executions
          </Button>
        </Link>
      </div>

      {/* Header Card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
              <Badge variant={statusVariant} dot>
                {run.status?.toUpperCase()}
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
                {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
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
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Attempts</div>
              <div className="tabular-nums" style={{ fontSize: 'var(--font-size-base)', fontWeight: 600 }}>
                {run.attempts ?? 1}
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

        {/* Failure summary banner if run failed */}
        {run.status === 'failed' && (
          <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', backgroundColor: 'var(--status-error-bg)', border: '1px solid var(--status-error-border)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--status-error)', fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
              <AlertTriangle size={16} /> Terminal Execution Failure
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {run.error || 'The workflow encountered a non-recoverable error during step execution.'}
            </div>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-default)' }}>
        <button 
          className={`filter-tab ${activeTab === 'timeline' ? 'active' : ''}`}
          style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: activeTab === 'timeline' ? '2px solid var(--accent)' : 'none' }}
          onClick={() => setActiveTab('timeline')}
        >
          <Layers size={14} style={{ display: 'inline', marginRight: '4px' }} /> Step Timeline ({run.steps?.length || 0})
        </button>
        <button 
          className={`filter-tab ${activeTab === 'events' ? 'active' : ''}`}
          style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: activeTab === 'events' ? '2px solid var(--accent)' : 'none' }}
          onClick={() => setActiveTab('events')}
        >
          <Activity size={14} style={{ display: 'inline', marginRight: '4px' }} /> Journal Events ({run.events?.length || 0})
        </button>
      </div>

      {/* Tab 1: Step Timeline */}
      {activeTab === 'timeline' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {!run.steps || run.steps.length === 0 ? (
            <div className="card" style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No discrete step checkpoints recorded for this execution.
            </div>
          ) : (
            run.steps.map((step: any, idx: number) => {
              const stepKey = `step-${step.step_id}-${step.attempt || idx}`;
              const isExpanded = !!expandedSteps[stepKey];

              let stepVariant: 'success' | 'error' | 'info' = 'info';
              if (step.status === 'completed') stepVariant = 'success';
              if (step.status === 'failed') stepVariant = 'error';

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
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-mono" style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                      {step.step_id}
                    </span>
                    <Badge variant={stepVariant} dot>
                      {step.status}
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
                          <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Step Input Payload</label>
                          <pre className="font-mono" style={{ fontSize: '11px', padding: '0.5rem', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', maxHeight: '160px' }}>
                            {sanitizePayload(step.input)}
                          </pre>
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Step Output Payload</label>
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

      {/* Tab 2: Journal Events */}
      {activeTab === 'events' && (
        <div className="table-wrapper">
          <div className="table-container">
            {!run.events || run.events.length === 0 ? (
              <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No journal events captured for this execution.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Seq</th>
                    <th>Event Type</th>
                    <th>Timestamp</th>
                    <th>Payload / Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {run.events.map((ev: any, idx: number) => (
                    <tr key={idx}>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)', width: '60px' }}>
                        #{idx + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {ev.type || ev.event_type}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {ev.timestamp ? format(new Date(ev.timestamp), 'HH:mm:ss.SSS') : '—'}
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
    </div>
  );
};
