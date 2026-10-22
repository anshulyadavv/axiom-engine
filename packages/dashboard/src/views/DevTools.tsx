import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type WorkloadStatusResponse } from '../api';
import { ArrowRight } from 'lucide-react';
import { PageHeader, Button, Badge, ConfirmDialog } from '../components/ui';

export const DevTools = () => {
  const queryClient = useQueryClient();
  const [triggering, setTriggering] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string; runId?: string } | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [ratePerSec, setRatePerSec] = useState(1);
  const [maxConcurrency, setMaxConcurrency] = useState(4);

  const { data: status, refetch: refetchStatus } = useQuery<WorkloadStatusResponse>({
    queryKey: ['workload_status'],
    queryFn: api.getWorkloadStatus,
    refetchInterval: 3000,
  });

  const triggerMutation = useMutation({
    mutationFn: async (type: string) => {
      setTriggering(type);
      setFeedback(null);
      return api.triggerWorkload(type);
    },
    onSuccess: (data, type) => {
      setTriggering(null);
      const runId = data.data?.run_id;
      setFeedback({
        type: 'success',
        message: `Triggered '${type}' execution successfully.`,
        runId
      });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err: any) => {
      setTriggering(null);
      setFeedback({
        type: 'error',
        message: `Failed to trigger: ${err.message}`
      });
    }
  });

  const startMutation = useMutation({
    mutationFn: () => api.startWorkloadGenerator(ratePerSec, maxConcurrency),
    onSuccess: () => {
      refetchStatus();
      setFeedback({
        type: 'info',
        message: `Generator started (${ratePerSec} run/s, concurrency: ${maxConcurrency})`
      });
    },
    onError: (err: any) => {
      setFeedback({
        type: 'error',
        message: `Failed to start generator: ${err.message}`
      });
    }
  });

  const stopMutation = useMutation({
    mutationFn: api.stopWorkloadGenerator,
    onSuccess: () => {
      refetchStatus();
      setFeedback({
        type: 'info',
        message: 'Generator stopped.'
      });
    }
  });

  const cleanupMutation = useMutation({
    mutationFn: api.cleanupWorkload,
    onSuccess: (data) => {
      setShowConfirmReset(false);
      setFeedback({
        type: 'success',
        message: `Cleaned up ${data.data?.cleaned_runs || 0} development runs. Production runs unaffected.`
      });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err: any) => {
      setShowConfirmReset(false);
      setFeedback({
        type: 'error',
        message: `Cleanup error: ${err.message}`
      });
    }
  });

  return (
    <div className="page-container">
      {/* Header */}
      <PageHeader
        title="Development Tools"
        badge={<Badge variant="neutral">Dev</Badge>}
        description="Dispatch test workloads and validate replay semantics through real engine infrastructure."
      />

      {/* Safety Notice */}
      <div className="card" style={{ marginBottom: '1.25rem', backgroundColor: 'var(--bg-surface-elevated)', borderColor: 'var(--border-default)' }}>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          <strong>Isolation:</strong> Controls on this page submit real execution jobs through PostgreSQL, NATS, and the local worker sidecar. Reset operations exclusively purge development benchmark records.
        </div>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div 
          className="card" 
          style={{ 
            marginBottom: '1.25rem',
            borderColor: feedback.type === 'success' ? 'var(--status-success-border)' : feedback.type === 'error' ? 'var(--status-error-border)' : 'var(--accent-border)',
            backgroundColor: feedback.type === 'success' ? 'var(--status-success-bg)' : feedback.type === 'error' ? 'var(--status-error-bg)' : 'var(--accent-subtle)',
            padding: '0.875rem 1.25rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>
              {feedback.message}
            </span>
            {feedback.runId && (
              <Link to={`/runs/${feedback.runId}`} className="btn btn-sm btn-secondary" style={{ gap: '0.25rem' }}>
                Inspect run <ArrowRight size={12} className="link-arrow" />
              </Link>
            )}
          </div>
        </div>
      )}

      {/* 2-Column Grid */}
      <div className="overview-grid-2col">
        {/* Continuous Workload Generator */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Workload generator</span>
            <Badge variant={status?.is_running ? 'success' : 'neutral'}>
              {status?.is_running ? 'Running' : 'Stopped'}
            </Badge>
          </div>

          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
            Continuously dispatches test transactions to verify queue throughput, worker leasing, and state updates.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label>Rate (runs / sec)</label>
              <input 
                type="number" 
                min={1} 
                max={10} 
                value={ratePerSec} 
                onChange={(e) => setRatePerSec(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={status?.is_running}
              />
            </div>
            <div>
              <label>Max concurrency</label>
              <input 
                type="number" 
                min={1} 
                max={20} 
                value={maxConcurrency} 
                onChange={(e) => setMaxConcurrency(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={status?.is_running}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-default)', paddingTop: '1rem' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              Total spawned: <strong className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{status?.total_runs_spawned ?? 0}</strong>
            </div>

            {status?.is_running ? (
              <button 
                className="btn btn-danger" 
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
              >
                Stop generator
              </button>
            ) : (
              <button 
                className="btn btn-primary" 
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                Start generator
              </button>
            )}
          </div>
        </div>

        {/* Single Workflow Triggers */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Individual workflows</span>
          </div>

          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Execute specific deterministic scenarios to verify step execution, error taxonomy, and AI tool calling:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Multi-step order fulfillment</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>3 sequential steps: Validate inventory, charge payment, dispatch tracking.</div>
              </div>
              <button 
                className="btn btn-sm btn-secondary"
                disabled={triggering !== null}
                onClick={() => triggerMutation.mutate('multi_step')}
              >
                {triggering === 'multi_step' ? 'Dispatching...' : 'Dispatch'}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Bounded retry simulation</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Simulates application-level retry loop in user code. Engine retries/backoff are Planned (Phase 2).</div>
              </div>
              <button 
                className="btn btn-sm btn-secondary"
                disabled={triggering !== null}
                onClick={() => triggerMutation.mutate('retry')}
              >
                {triggering === 'retry' ? 'Dispatching...' : 'Dispatch'}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Controlled terminal failure</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Simulates non-recoverable error. Verifies failure classification & error payload.</div>
              </div>
              <button 
                className="btn btn-sm btn-secondary"
                disabled={triggering !== null}
                onClick={() => triggerMutation.mutate('failure')}
              >
                {triggering === 'failure' ? 'Dispatching...' : 'Dispatch'}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>AI incident triage agent</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Runs agent loop with tool calls using deterministic local adapter.</div>
              </div>
              <button 
                className="btn btn-sm btn-secondary"
                disabled={triggering !== null}
                onClick={() => triggerMutation.mutate('ai_agent')}
              >
                {triggering === 'ai_agent' ? 'Dispatching...' : 'Dispatch'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Destructive Dev Reset Section */}
      <div className="card" style={{ borderColor: 'var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Reset Development Workloads
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
              Purges test runs generated by this tool. Production workflows and audit logs remain untouched.
            </div>
          </div>
          <Button 
            variant="danger"
            size="md"
            onClick={() => setShowConfirmReset(true)}
          >
            Reset Dev Runs
          </Button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmDialog
        isOpen={showConfirmReset}
        title="Confirm Reset of Dev Data"
        message="Are you sure you want to clean development workload records?"
        note={
          <span>
            <strong>Safety Guarantee:</strong> This action executes a targeted purge of test workloads tagged with the development tenant. No production workflows, persistent step events, or worker registrations will be removed.
          </span>
        }
        confirmLabel="Yes, Purge Dev Runs"
        variant="danger"
        isLoading={cleanupMutation.isPending}
        onConfirm={() => cleanupMutation.mutate()}
        onCancel={() => setShowConfirmReset(false)}
      />
    </div>
  );
};
