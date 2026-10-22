import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type CacheStatsSnapshot, type AiTelemetrySnapshot } from '../api';
import { Badge } from './ui/Badge';

export const TelemetryCards: React.FC = () => {
  const { data: cacheStats, isLoading: cacheLoading } = useQuery<CacheStatsSnapshot>({
    queryKey: ['cache_telemetry'],
    queryFn: api.getCacheTelemetry,
    refetchInterval: 5000,
  });

  const { data: aiStats, isLoading: aiLoading } = useQuery<AiTelemetrySnapshot>({
    queryKey: ['ai_telemetry'],
    queryFn: api.getAiTelemetry,
    refetchInterval: 5000,
  });

  const isLocalAdapter = !aiStats?.active_provider || 
    aiStats.is_test_adapter || 
    aiStats.active_provider.includes('local') || 
    aiStats.active_provider === 'local-deterministic-adapter';

  return (
    <div className="overview-grid-integrations">
      {/* Redis cache */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Redis cache</span>
          <Badge variant={cacheStats?.is_connected ? 'success' : 'neutral'}>
            {cacheStats?.is_connected ? 'Connected' : 'Not configured'}
          </Badge>
        </div>

        {cacheLoading ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
            Querying cache...
          </div>
        ) : cacheStats?.is_connected ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.625rem', marginBottom: '0.875rem' }}>
              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Hit Ratio</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {cacheStats.hit_ratio_pct != null ? `${cacheStats.hit_ratio_pct.toFixed(1)}%` : '—'}
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Hits / Misses</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <span style={{ color: 'var(--status-success)' }}>{cacheStats.hits}</span> / <span style={{ color: 'var(--text-muted)' }}>{cacheStats.misses}</span>
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Avg Read Latency</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {cacheStats.avg_read_latency_ms != null ? `${cacheStats.avg_read_latency_ms.toFixed(2)}ms` : '—'}
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Memory</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {cacheStats.used_memory_human || '—'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-default)', paddingTop: '0.5rem' }}>
              <span>Writes: <strong className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{cacheStats.writes}</strong></span>
              <span>Evictions: <strong className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{cacheStats.evicted_keys ?? 0}</strong></span>
              <span>Errors: <strong className="tabular-nums" style={{ color: cacheStats.errors > 0 ? 'var(--status-error)' : 'var(--text-secondary)' }}>{cacheStats.errors}</strong></span>
              <span>Source: PostgreSQL</span>
            </div>
          </div>
        ) : (
          <div style={{ padding: '0.875rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            Redis caching is optional and currently offline. All workflow executions continue through PostgreSQL without interruption.
          </div>
        )}
      </div>

      {/* AI triage */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">AI triage</span>
          <Badge variant="neutral">
            {isLocalAdapter ? 'Local (deterministic)' : 'External'}
          </Badge>
        </div>

        {aiLoading ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
            Querying AI status...
          </div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.625rem', marginBottom: '0.875rem' }}>
              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Invocations</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {aiStats?.total_invocations || 0}
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tool Calls</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {aiStats?.total_tool_calls || 0}
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Total Tokens</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {aiStats?.total_tokens || 0}
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 0.625rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Avg Latency</div>
                <div className="tabular-nums" style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {aiStats?.avg_latency_ms != null ? `${Math.round(aiStats.avg_latency_ms)}ms` : '—'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-default)', paddingTop: '0.5rem' }}>
              <span>Provider: <strong className="font-mono" style={{ color: 'var(--text-secondary)' }}>{isLocalAdapter ? 'Local adapter' : (aiStats?.active_provider || 'External')}</strong></span>
              <span>Successful: <strong className="tabular-nums" style={{ color: 'var(--status-success)' }}>{aiStats?.successful_invocations || 0}</strong></span>
              <span>Failed: <strong className="tabular-nums" style={{ color: (aiStats?.failed_invocations || 0) > 0 ? 'var(--status-error)' : 'var(--text-secondary)' }}>{aiStats?.failed_invocations || 0}</strong></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
