import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type WorkloadStatusResponse } from '../api';
import { ReloadIcon } from '@radix-ui/react-icons';
import { Badge } from './ui/Badge';

export const WorkloadManager = () => {
  const queryClient = useQueryClient();
  const [triggering, setTriggering] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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
      setFeedback(`Triggered ${type} (Run: ${data.data?.run_id?.slice(0, 8)}...)`);
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setTimeout(() => setFeedback(null), 5000);
    },
    onError: (err: any) => {
      setTriggering(null);
      setFeedback(`Error: ${err.message}`);
      setTimeout(() => setFeedback(null), 5000);
    }
  });

  const startMutation = useMutation({
    mutationFn: () => api.startWorkloadGenerator(1, 4),
    onSuccess: () => {
      refetchStatus();
      setFeedback('Continuous generator started (1 run/s, max concurrency 4)');
      setTimeout(() => setFeedback(null), 4000);
    },
    onError: (err: any) => {
      setFeedback(`Start failed: ${err.message}`);
      setTimeout(() => setFeedback(null), 4000);
    }
  });

  const stopMutation = useMutation({
    mutationFn: api.stopWorkloadGenerator,
    onSuccess: () => {
      refetchStatus();
      setFeedback('Generator stopped');
      setTimeout(() => setFeedback(null), 4000);
    }
  });

  const cleanupMutation = useMutation({
    mutationFn: api.cleanupWorkload,
    onSuccess: (data) => {
      setFeedback(`Cleaned up ${data.data?.cleaned_runs || 0} dev runs`);
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setTimeout(() => setFeedback(null), 4000);
    },
    onError: (err: any) => {
      setFeedback(`Cleanup failed: ${err.message}`);
      setTimeout(() => setFeedback(null), 4000);
    }
  });

  return (
    <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>Dev workload generator</span>
          <Badge variant={status?.is_running ? 'success' : 'neutral'}>
            {status?.is_running ? 'Running' : 'Stopped'}
          </Badge>
          {status && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              ({status.rate_per_sec} r/s, {status.total_runs_spawned} spawned)
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {status?.is_running ? (
            <button 
              className="btn btn-danger" 
              style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.75rem' }}
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              Stop generator
            </button>
          ) : (
            <button 
              className="btn btn-primary" 
              style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.75rem' }}
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
            >
              Start generator
            </button>
          )}

          <button 
            className="btn btn-ghost" 
            style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem' }}
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
            title="Clean up test workflows and runs"
          >
            Reset dev data
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 500, marginRight: '0.25rem' }}>Trigger Workflow:</span>
        
        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('multi_step')}
        >
          {triggering === 'multi_step' && <ReloadIcon className="animate-spin" width={12} height={12} />}
          Multi-Step
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('retry')}
        >
          {triggering === 'retry' && <ReloadIcon className="animate-spin" width={12} height={12} />}
          Bounded Retry
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('failure')}
        >
          {triggering === 'failure' && <ReloadIcon className="animate-spin" width={12} height={12} />}
          Controlled Failure
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('delayed')}
        >
          {triggering === 'delayed' && <ReloadIcon className="animate-spin" width={12} height={12} />}
          Delayed Step
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem', borderColor: 'var(--accent)', background: 'var(--accent-subtle)' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('ai_agent')}
        >
          {triggering === 'ai_agent' && <ReloadIcon className="animate-spin" width={12} height={12} />}
          AI Agent
        </button>
      </div>

      {feedback && (
        <div style={{ marginTop: '0.75rem', fontSize: 'var(--text-xs)', color: feedback.startsWith('Error') || feedback.startsWith('Cleanup failed') ? 'var(--status-error)' : 'var(--status-success)', fontWeight: 500 }}>
          {feedback}
        </div>
      )}
    </div>
  );
};
