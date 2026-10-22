import React from 'react';
import { Link } from 'react-router-dom';
import type { OperationalEvent } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { Badge, type BadgeVariant } from './ui/Badge';

interface LiveEventFeedProps {
  events: OperationalEvent[];
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  onClear?: () => void;
  onRetry?: () => void;
}

export const LiveEventFeed: React.FC<LiveEventFeedProps> = ({ 
  events, 
  connectionStatus, 
  onClear,
  onRetry 
}) => {
  const getCategoryVariant = (category: string): BadgeVariant => {
    switch (category) {
      case 'run':
        return 'info';
      case 'step':
        return 'info';
      case 'worker':
        return 'success';
      case 'cache':
        return 'warning';
      case 'ai_agent':
        return 'info';
      case 'workflow':
        return 'info';
      default:
        return 'neutral';
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'run': return 'Run';
      case 'step': return 'Step';
      case 'worker': return 'Worker';
      case 'cache': return 'Cache';
      case 'ai_agent': return 'AI';
      case 'workflow': return 'Workflow';
      default: return category.charAt(0).toUpperCase() + category.slice(1);
    }
  };

  const getStatusBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Badge variant="success">Connected</Badge>;
      case 'connecting':
        return <Badge variant="neutral">Connecting</Badge>;
      case 'reconnecting':
        return <Badge variant="neutral">Reconnecting</Badge>;
      case 'disconnected':
      default:
        return <Badge variant="error">Disconnected</Badge>;
    }
  };

  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="table-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Event stream</span>
          {getStatusBadge()}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {connectionStatus === 'disconnected' && onRetry && (
            <button className="btn btn-sm btn-secondary" onClick={onRetry}>
              Retry
            </button>
          )}
          {events.length > 0 && onClear && (
            <button className="btn btn-sm btn-ghost" onClick={onClear} title="Clear buffer">
              Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ maxHeight: '340px', minHeight: '260px', overflowY: 'auto' }}>
        {events.length === 0 ? (
          <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
            {connectionStatus === 'connected' ? (
              <span>Stream connected. Listening for events...</span>
            ) : connectionStatus === 'disconnected' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <span>Stream disconnected.</span>
                {onRetry && (
                  <button className="btn btn-sm btn-secondary" onClick={onRetry}>
                    Retry connection
                  </button>
                )}
              </div>
            ) : (
              <span>Connecting to event stream...</span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {events.slice(0, 30).map((ev) => (
              <div 
                key={ev.event_id}
                style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start', 
                  gap: '0.625rem', 
                  padding: '0.625rem 1rem', 
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 'var(--font-size-xs)'
                }}
              >
                <Badge variant={getCategoryVariant(ev.category)} withDot={false} style={{ fontSize: '10px', padding: '1px 5px', marginTop: '2px' }}>
                  {getCategoryLabel(ev.category)}
                </Badge>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '2px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ev.event_type}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                      {formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', wordBreak: 'break-word', lineHeight: 1.4 }}>
                    {ev.summary}
                  </div>
                  {(ev.run_id || ev.correlation_id || ev.worker_id) && (
                    <div style={{ marginTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '11px', color: 'var(--text-muted)' }}>
                      {ev.run_id && (
                        <span>
                          Run: <Link to={`/runs/${ev.run_id}`} className="font-mono text-accent" style={{ textDecoration: 'underline' }}>{ev.run_id.slice(0, 8)}</Link>
                        </span>
                      )}
                      {ev.step_id && <span>Step: <span className="font-mono">{ev.step_id}</span></span>}
                      {ev.worker_id && <span>Worker: <span className="font-mono">{ev.worker_id.slice(0, 8)}</span></span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
