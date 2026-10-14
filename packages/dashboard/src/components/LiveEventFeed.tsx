import React from 'react';
import { Link } from 'react-router-dom';
import type { OperationalEvent } from '../api';
import { formatDistanceToNow } from 'date-fns';
import { Activity, Radio, ArrowUpRight, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

interface LiveEventFeedProps {
  events: OperationalEvent[];
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  onClear?: () => void;
}

export const LiveEventFeed: React.FC<LiveEventFeedProps> = ({ events, connectionStatus, onClear }) => {
  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'run':
        return 'badge-info';
      case 'step':
        return 'badge-primary';
      case 'worker':
        return 'badge-success';
      case 'cache':
        return 'badge-warning';
      case 'ai_agent':
        return 'badge-info';
      case 'workflow':
        return 'badge-primary';
      default:
        return 'badge-neutral';
    }
  };

  const getStatusBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return (
          <span className="badge badge-success">
            <span className="badge-dot animate-pulse" />
            SSE LIVE
          </span>
        );
      case 'connecting':
        return (
          <span className="badge badge-warning">
            <RefreshCw size={10} className="animate-spin" />
            CONNECTING...
          </span>
        );
      case 'reconnecting':
        return (
          <span className="badge badge-warning">
            <RefreshCw size={10} className="animate-spin" />
            RECONNECTING...
          </span>
        );
      case 'disconnected':
      default:
        return (
          <span className="badge badge-error">
            <AlertCircle size={10} />
            DISCONNECTED
          </span>
        );
    }
  };

  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="table-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <Activity size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Live Operational Event Stream</span>
          {getStatusBadge()}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <Radio size={24} style={{ color: 'var(--accent)', opacity: 0.8 }} />
                <span>Stream active. Listening for live worker leases, step transitions, and AI events...</span>
              </div>
            ) : (
              <span>Establishing durable telemetry stream connection...</span>
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
                <span className={`badge ${getCategoryBadgeClass(ev.category)}`} style={{ textTransform: 'uppercase', fontSize: '9px', padding: '1px 5px', marginTop: '2px' }}>
                  {ev.category}
                </span>

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
