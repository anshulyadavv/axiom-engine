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

    // Maximum consecutive reconnect attempts before transitioning honestly to 'disconnected'
    const MAX_RECONNECT_ATTEMPTS = 4;
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;
    let attemptCount = 0;

    function connect() {
      if (attemptCount >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionStatus('disconnected');
        return;
      }

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

            // Invalidate affected dashboard queries
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
          } catch {
            // Heartbeat comment
          }
        };

        es.onerror = () => {
          attemptCount++;
          if (es) {
            es.close();
          }

          if (attemptCount >= MAX_RECONNECT_ATTEMPTS) {
            setConnectionStatus('disconnected');
            return;
          }

          setConnectionStatus('reconnecting');
          const delay = Math.min(1000 * Math.pow(1.5, attemptCount), 8000);
          reconnectTimeout = setTimeout(() => {
            connect();
          }, delay);
        };
      } catch {
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

  const retry = () => {
    // Force re-trigger of effect
    setConnectionStatus('connecting');
    const config = getApiConfig();
    const sessionToken = localStorage.getItem('axiom_session_token');
    const apiKey = localStorage.getItem('axiom_api_key') || config.key || 'axm_live_dummykey';
    const authParam = sessionToken 
      ? `token=${encodeURIComponent(sessionToken)}` 
      : `api_key=${encodeURIComponent(apiKey)}`;
    const streamUrl = `${config.url}/events/stream?${authParam}`;
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const es = new EventSource(streamUrl, { withCredentials: true });
    eventSourceRef.current = es;
    es.onopen = () => setConnectionStatus('connected');
    es.onerror = () => {
      es.close();
      setConnectionStatus('disconnected');
    };
  };

  return {
    events,
    connectionStatus,
    lastEventTime,
    clearEvents: () => setEvents([]),
    retry
  };
}
