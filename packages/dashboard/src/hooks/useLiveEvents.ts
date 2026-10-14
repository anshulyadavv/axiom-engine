import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiConfig, api, type OperationalEvent } from '../api';

export type LiveConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export function useLiveEvents() {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>('connecting');
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch initial snapshot of recent events on mount
  useEffect(() => {
    let mounted = true;
    api.getRecentEvents(30)
      .then((snapshot) => {
        if (mounted && snapshot && snapshot.length > 0) {
          setEvents(snapshot);
          setLastEventTime(new Date(snapshot[0].timestamp));
        }
      })
      .catch((err) => console.warn('Failed to load recent events snapshot:', err));

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const config = getApiConfig();
    const sessionToken = localStorage.getItem('axiom_session_token');
    const apiKey = localStorage.getItem('axiom_api_key') || config.key || 'axm_live_dummykey';
    const authParam = sessionToken 
      ? `token=${encodeURIComponent(sessionToken)}` 
      : `api_key=${encodeURIComponent(apiKey)}`;
    const streamUrl = `${config.url}/events/stream?${authParam}`;

    let es: EventSource | null = null;
    let reconnectTimeout: any = null;
    let attemptCount = 0;

    function connect() {
      setConnectionStatus(attemptCount === 0 ? 'connecting' : 'reconnecting');
      try {
        es = new EventSource(streamUrl, { withCredentials: true });
        eventSourceRef.current = es;

        es.onopen = () => {
          setConnectionStatus('connected');
          attemptCount = 0;
        };

        es.onmessage = (messageEvent) => {
          try {
            const parsed: OperationalEvent = JSON.parse(messageEvent.data);
            setEvents((prev) => [parsed, ...prev.filter(e => e.event_id !== parsed.event_id)].slice(0, 100));
            setLastEventTime(new Date(parsed.timestamp));

            // Reactively invalidate affected dashboard queries
            queryClient.invalidateQueries({ queryKey: ['overview'] });
            if (parsed.category === 'run' || parsed.category === 'step') {
              queryClient.invalidateQueries({ queryKey: ['runs'] });
            }
            if (parsed.category === 'worker') {
              queryClient.invalidateQueries({ queryKey: ['workers'] });
            }
            if (parsed.category === 'cache') {
              queryClient.invalidateQueries({ queryKey: ['cache_telemetry'] });
            }
            if (parsed.category === 'ai_agent') {
              queryClient.invalidateQueries({ queryKey: ['ai_telemetry'] });
            }
            if (parsed.category === 'workflow') {
              queryClient.invalidateQueries({ queryKey: ['workflows'] });
            }
          } catch (e) {
            // Heartbeat or malformed comment
          }
        };

        es.onerror = () => {
          attemptCount++;
          setConnectionStatus('reconnecting');
          if (es) {
            es.close();
          }
          // Exponential backoff capped at 8s
          const delay = Math.min(1000 * Math.pow(1.5, attemptCount), 8000);
          reconnectTimeout = setTimeout(() => {
            connect();
          }, delay);
        };
      } catch (err) {
        setConnectionStatus('disconnected');
      }
    }

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [queryClient]);

  return {
    events,
    connectionStatus,
    lastEventTime,
    clearEvents: () => setEvents([])
  };
}
