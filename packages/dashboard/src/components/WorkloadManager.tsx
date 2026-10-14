import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type WorkloadStatusResponse } from '../api';
import { PlayIcon, StopIcon, ReloadIcon, TrashIcon, LightningBoltIcon, MagicWandIcon, ExclamationTriangleIcon, CheckCircledIcon } from '@radix-ui/react-icons';

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
      setFeedback('Continuous generator stopped');
      setTimeout(() => setFeedback(null), 4000);
    }
  });

  const cleanupMutation = useMutation({
    mutationFn: api.cleanupWorkload,
    onSuccess: (data) => {
      setFeedback(`Cleaned up ${data.data?.cleaned_runs || 0} dev runs`);
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setTimeout(() => setFeedback(null), 5000);
    },
    onError: (err: any) => {
      setFeedback(`Cleanup failed: ${err.message}`);
      setTimeout(() => setFeedback(null), 4000);
    }
  });

  return (
    <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: 'var(--text-base)' }}>
            <LightningBoltIcon width={16} height={16} color="var(--accent)" />
            <span>Development Workload Generator</span>
            <span className="badge badge-warning" style={{ fontSize: '10px' }}>DEV ONLY</span>
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Submit genuine workflows through the real engine pipeline to generate real operational telemetry.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {status?.is_running ? (
            <button 
              className="btn btn-secondary" 
              onClick={() => stopMutation.mutate()} 
              disabled={stopMutation.isPending}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--error)' }}
            >
              <StopIcon width={14} height={14} /> Stop Generator
            </button>
          ) : (
            <button 
              className="btn btn-secondary" 
              onClick={() => startMutation.mutate()} 
              disabled={startMutation.isPending}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--success)' }}
            >
              <PlayIcon width={14} height={14} /> Auto Generator (1/s)
            </button>
          )}

          <button 
            className="btn btn-ghost" 
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
            title="Clean dev workload runs"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-tertiary)' }}
          >
            <TrashIcon width={14} height={14} /> Reset Dev Runs
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
          {triggering === 'multi_step' ? <ReloadIcon className="animate-spin" width={12} height={12} /> : <CheckCircledIcon width={12} height={12} color="var(--success)" />}
          &nbsp;Multi-Step
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('retry')}
        >
          {triggering === 'retry' ? <ReloadIcon className="animate-spin" width={12} height={12} /> : <ReloadIcon width={12} height={12} color="var(--warning)" />}
          &nbsp;Bounded Retry
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('failure')}
        >
          {triggering === 'failure' ? <ReloadIcon className="animate-spin" width={12} height={12} /> : <ExclamationTriangleIcon width={12} height={12} color="var(--error)" />}
          &nbsp;Controlled Failure
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('delayed')}
        >
          {triggering === 'delayed' ? <ReloadIcon className="animate-spin" width={12} height={12} /> : <LightningBoltIcon width={12} height={12} color="var(--accent)" />}
          &nbsp;Delayed Step
        </button>

        <button 
          className="btn btn-secondary" 
          style={{ fontSize: 'var(--text-xs)', padding: '0.35rem 0.65rem', borderColor: 'var(--accent)', background: 'var(--accent-subtle)' }}
          disabled={triggering !== null}
          onClick={() => triggerMutation.mutate('ai_agent')}
        >
          {triggering === 'ai_agent' ? <ReloadIcon className="animate-spin" width={12} height={12} /> : <MagicWandIcon width={12} height={12} color="var(--accent)" />}
          &nbsp;AI Incident Triage Agent
        </button>
      </div>

      {feedback && (
        <div style={{ marginTop: '0.75rem', fontSize: 'var(--text-xs)', color: feedback.startsWith('Error') || feedback.startsWith('Cleanup failed') ? 'var(--error)' : 'var(--success)', fontWeight: 500 }}>
          {feedback}
        </div>
      )}
    </div>
  );
};
