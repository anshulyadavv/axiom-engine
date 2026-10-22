import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getApiConfig } from '../api';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { PageHeader, Card, Button, Badge } from '../components/ui';
import { TelemetryCards } from '../components/TelemetryCards';

export const Settings = () => {
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [initialUrl, setInitialUrl] = useState('');
  const [initialKey, setInitialKey] = useState('');
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    const config = getApiConfig();
    setApiUrl(config.url);
    setInitialUrl(config.url);
    setApiKey(config.key);
    setInitialKey(config.key);
    setTheme((localStorage.getItem('theme') as any) || 'dark');
  }, []);

  const isDirty = apiUrl !== initialUrl || apiKey !== initialKey;

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const baseUrl = apiUrl.replace(/\/v1\/?$/, '');
      const res = await fetch(`${baseUrl}/ready`);
      if (res.ok) {
        setTestStatus('success');
        setTestMessage('Successfully reached API /ready endpoint.');
      } else {
        setTestStatus('failed');
        setTestMessage(`API responded with HTTP status ${res.status}.`);
      }
    } catch (e: any) {
      setTestStatus('failed');
      setTestMessage(e.message || 'Network error: could not connect to API.');
    }
  };

  const handleSaveApi = () => {
    if (!apiUrl.trim()) {
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    localStorage.setItem('axiom_api_url', apiUrl.trim());
    localStorage.setItem('axiom_api_key', apiKey.trim());
    setInitialUrl(apiUrl.trim());
    setInitialKey(apiKey.trim());
    setSaveStatus('saved');
    setTimeout(() => {
      setSaveStatus('idle');
    }, 3000);
  };

  const handleResetDefaults = () => {
    const defaultUrl = 'http://localhost:3000/v1';
    const defaultKey = 'axm_live_dummykey';
    setApiUrl(defaultUrl);
    setApiKey(defaultKey);
  };

  const handleThemeChange = (newTheme: 'system' | 'light' | 'dark') => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    
    if (newTheme === 'dark' || (newTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title="Settings"
        description="API endpoints, client authentication, and theme preferences."
        actions={
          isDirty ? (
            <Badge variant="warning">Unsaved changes</Badge>
          ) : undefined
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '760px' }}>
        
        {/* Section 1: API Connection */}
        <Card title="API connection">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label>API endpoint base URL</label>
              <input 
                type="text" 
                value={apiUrl} 
                onChange={e => setApiUrl(e.target.value)} 
                placeholder="http://localhost:3000/v1"
                className="font-mono"
              />
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Base URL for the Axiom Engine HTTP REST and SSE live event endpoints.
              </div>
            </div>

            <div>
              <label>Default API key token</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input 
                  type={showApiKey ? "text" : "password"} 
                  value={apiKey} 
                  onChange={e => setApiKey(e.target.value)} 
                  placeholder="axm_live_••••••••"
                  className="font-mono"
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(prev => !prev)}
                  title={showApiKey ? "Hide API key" : "View API key"}
                  aria-label={showApiKey ? "Hide API key" : "View API key"}
                  className="btn btn-ghost"
                  style={{
                    position: 'absolute',
                    right: '4px',
                    height: '24px',
                    width: '28px',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                  }}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Fallback Bearer authorization header used when no interactive session token is active.
              </div>
            </div>

            {testStatus !== 'idle' && (
              <div style={{
                padding: '0.625rem 0.875rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: testStatus === 'success' ? 'var(--status-success-bg)' : testStatus === 'testing' ? 'var(--bg-surface-elevated)' : 'var(--status-error-bg)',
                border: `1px solid ${testStatus === 'success' ? 'var(--status-success-border)' : testStatus === 'testing' ? 'var(--border-default)' : 'var(--status-error-border)'}`,
                color: testStatus === 'success' ? 'var(--status-success)' : testStatus === 'testing' ? 'var(--text-secondary)' : 'var(--status-error)',
                fontSize: 'var(--font-size-xs)',
              }}>
                <span>{testStatus === 'testing' ? 'Testing connectivity to API...' : testMessage}</span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.75rem', borderTop: '1px solid var(--border-default)', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button 
                  variant="secondary" 
                  size="sm"
                  onClick={handleTestConnection}
                  isLoading={testStatus === 'testing'}
                >
                  Test connection
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleResetDefaults}
                >
                  Reset defaults
                </Button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {saveStatus === 'saved' && (
                  <span style={{ color: 'var(--status-success)', fontSize: 'var(--font-size-xs)' }}>
                    Settings saved
                  </span>
                )}
                <Button 
                  variant="primary" 
                  size="sm"
                  onClick={handleSaveApi}
                  disabled={!isDirty || !apiUrl.trim()}
                  isLoading={saveStatus === 'saving'}
                >
                  Save settings
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Section 2: Appearance */}
        <Card title="Appearance">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              Select your preferred visual appearance. Preferences are preserved across browser sessions.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              <Button 
                variant={theme === 'dark' ? 'primary' : 'secondary'}
                onClick={() => handleThemeChange('dark')}
              >
                Dark
              </Button>
              <Button 
                variant={theme === 'light' ? 'primary' : 'secondary'}
                onClick={() => handleThemeChange('light')}
              >
                Light
              </Button>
              <Button 
                variant={theme === 'system' ? 'primary' : 'secondary'}
                onClick={() => handleThemeChange('system')}
              >
                System
              </Button>
            </div>
          </div>
        </Card>

        {/* Section 3: Experimental (Step 5b) */}
        <div>
          <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            Experimental
          </h2>
          <TelemetryCards />
        </div>

        {/* Section 4: Architecture Reference Callout */}
        <div style={{
          padding: '1rem 1.25rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
              Architecture & System Invariants
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              Durability points, deterministic replay, and failure taxonomy.
            </div>
          </div>

          <Link to="/docs#architecture" className="btn btn-secondary btn-sm" style={{ gap: '0.25rem', flexShrink: 0 }}>
            Read docs <ArrowRight size={12} className="link-arrow" />
          </Link>
        </div>

      </div>
    </div>
  );
};
