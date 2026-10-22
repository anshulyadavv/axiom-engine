import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button, Badge, EmptyState, type BadgeVariant } from '../components/ui';

export const WorkflowDetail = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [inputJson, setInputJson] = useState('{}');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: wf, isLoading: wfLoading } = useQuery({ 
    queryKey: ['workflow', id], 
    queryFn: () => api.getWorkflow(id!) 
  });

  const { data: runsResponse } = useQuery({ 
    queryKey: ['runs'], 
    queryFn: () => api.getRuns() 
  });

  const wfRuns = (runsResponse?.data || []).filter((r: any) => r.workflow_id === id);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showModal) {
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const startRunMutation = useMutation({
    mutationFn: () => {
      setErrorMsg(null);
      let parsed;
      try {
        parsed = JSON.parse(inputJson);
      } catch (e: any) {
        throw new Error('Invalid JSON payload: ' + e.message);
      }
      return api.startRun(id!, parsed);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setShowModal(false);
      setInputJson('{}');
    },
    onError: (err: any) => {
      setErrorMsg(err.message);
    }
  });

  const getStatusDetails = (status: string): { variant: BadgeVariant; label: string } => {
    switch (status) {
      case 'completed': return { variant: 'success', label: 'Completed' };
      case 'failed': return { variant: 'error', label: 'Failed' };
      case 'cancelled': return { variant: 'warning', label: 'Cancelled' };
      case 'running': return { variant: 'info', label: 'Running' };
      default: return { variant: 'neutral', label: status.charAt(0).toUpperCase() + status.slice(1) };
    }
  };

  if (wfLoading || !wf) {
    return (
      <div className="page-container">
        <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading workflow definition...
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Back button */}
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/workflows">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={13} className="back-arrow" />}>
            Back to workflows
          </Button>
        </Link>
      </div>

      {/* Header Card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
              <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600 }}>{wf.name}</h1>
              <Badge variant="neutral">v{wf.version}</Badge>
            </div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              {wf.description || 'No description provided.'}
            </p>
          </div>

          <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
            Start Execution
          </Button>
        </div>
      </div>

      {/* Associated Runs Table */}
      <div className="table-wrapper">
        <div className="table-header-bar">
          <div className="table-header-title">
            <span>Executions</span>
            {wfRuns.length > 0 && (
              <Badge variant="neutral">{wfRuns.length} runs</Badge>
            )}
          </div>
        </div>

        <div className="table-container">
          {wfRuns.length === 0 ? (
            <EmptyState
              title="No executions recorded"
              description="This workflow has not been executed yet. Click Start Execution to trigger a run."
              action={
                <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
                  Start Execution
                </Button>
              }
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Duration</th>
                  <th style={{ textAlign: 'right' }}>Attempts</th>
                  <th>Started</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {wfRuns.map((run: any) => {
                  const statusInfo = getStatusDetails(run.status);
                  const duration = run.completed_at && (run.started_at || run.created_at)
                    ? new Date(run.completed_at).getTime() - new Date(run.started_at || run.created_at).getTime()
                    : null;

                  return (
                    <tr key={run.id}>
                      <td className="font-mono">
                        <Link to={`/runs/${run.id}`} style={{ color: 'var(--accent)' }}>
                          {run.id}
                        </Link>
                      </td>
                      <td>
                        <Badge variant={statusInfo.variant}>
                          {statusInfo.label}
                        </Badge>
                      </td>
                      <td className="tabular-nums" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {duration != null ? `${duration}ms` : '—'}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {run.attempts ?? 1}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {run.started_at || run.created_at 
                          ? formatDistanceToNow(new Date(run.started_at || run.created_at), { addSuffix: true }) 
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Link to={`/runs/${run.id}`} className="btn btn-sm btn-ghost" style={{ gap: '0.25rem' }}>
                          Inspect <ArrowRight size={12} className="link-arrow" />
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

      {/* Start Run Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Start Execution: {wf.name}</span>
              <button 
                className="btn btn-sm btn-ghost" 
                onClick={() => setShowModal(false)}
                aria-label="Close dialog"
                style={{ padding: '0.25rem' }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {errorMsg && (
                <div style={{ padding: '0.625rem', backgroundColor: 'var(--status-error-bg)', border: '1px solid var(--status-error-border)', borderRadius: 'var(--radius-sm)', color: 'var(--status-error)', fontSize: 'var(--font-size-xs)' }}>
                  {errorMsg}
                </div>
              )}
              <div>
                <label>Input Arguments (JSON format)</label>
                <textarea 
                  value={inputJson} 
                  onChange={e => setInputJson(e.target.value)} 
                  rows={6}
                  className="font-mono"
                  style={{ fontSize: '12px' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button 
                variant="primary" 
                onClick={() => startRunMutation.mutate()} 
                isLoading={startRunMutation.isPending}
              >
                Submit Run
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
