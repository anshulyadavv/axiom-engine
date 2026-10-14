import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getApiConfig } from '../api';
import { 
  Link2, 
  Moon, 
  Sun, 
  Monitor, 
  CheckCircle2, 
  BookOpen, 
  ArrowUpRight, 
  AlertCircle, 
  RefreshCw,
  Sliders,
  RotateCcw
} from 'lucide-react';
import { PageHeader, Card, Button, Badge } from '../components/ui';

export const Settings = () => {
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
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
        title="Settings & Configuration"
        description="Configure API connection endpoints, client authentication, and dashboard appearance."
        actions={
          isDirty ? (
            <Badge variant="warning">Unsaved Changes</Badge>
          ) : undefined
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '760px' }}>
        
        {/* Section 1: API Connection */}
        <Card title="API Connection" icon={<Link2 size={16} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label>API Endpoint Base URL</label>
              <input 
                type="text" 
                value={apiUrl} 
                onChange={e => setApiUrl(e.target.value)} 
                placeholder="http://localhost:3000/v1"
                className="font-mono"
              />
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Base URL for the Axiom Engine HTTP REST and SSE live telemetry endpoints.
              </div>
            </div>

            <div>
              <label>Default API Key Token</label>
              <input 
                type="password" 
                value={apiKey} 
                onChange={e => setApiKey(e.target.value)} 
                placeholder="axm_live_••••••••"
                className="font-mono"
              />
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Fallback Bearer authorization header used when no interactive session token is active.
              </div>
            </div>

            {/* Test result feedback banner */}
            {testStatus !== 'idle' && (
              <div style={{
                padding: '0.625rem 0.875rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: testStatus === 'success' ? 'var(--status-success-bg)' : testStatus === 'testing' ? 'var(--bg-surface-elevated)' : 'var(--status-error-bg)',
                border: `1px solid ${testStatus === 'success' ? 'var(--status-success-border)' : testStatus === 'testing' ? 'var(--border-default)' : 'var(--status-error-border)'}`,
                color: testStatus === 'success' ? 'var(--status-success)' : testStatus === 'testing' ? 'var(--text-secondary)' : 'var(--status-error)',
                fontSize: 'var(--font-size-xs)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                {testStatus === 'success' ? <CheckCircle2 size={14} /> : testStatus === 'testing' ? <RefreshCw size={14} className="animate-spin" /> : <AlertCircle size={14} />}
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
                  icon={<RefreshCw size={12} />}
                >
                  Test Connection
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleResetDefaults}
                  icon={<RotateCcw size={12} />}
                >
                  Reset Defaults
                </Button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {saveStatus === 'saved' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--status-success)', fontSize: 'var(--font-size-xs)' }}>
                    <CheckCircle2 size={13} /> Settings saved
                  </span>
                )}
                <Button 
                  variant="primary" 
                  size="sm"
                  onClick={handleSaveApi}
                  disabled={!isDirty || !apiUrl.trim()}
                  isLoading={saveStatus === 'saving'}
                >
                  Save Settings
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Section 2: Appearance */}
        <Card title="Theme & Appearance" icon={<Sliders size={16} />}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              Select your preferred visual appearance. Preferences are preserved across browser sessions.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              <Button 
                variant={theme === 'dark' ? 'primary' : 'secondary'}
                onClick={() => handleThemeChange('dark')}
                icon={<Moon size={14} />}
              >
                Dark Theme
              </Button>
              <Button 
                variant={theme === 'light' ? 'primary' : 'secondary'}
                onClick={() => handleThemeChange('light')}
                icon={<Sun size={14} />}
              >
                Light Theme
              </Button>
              <Button 
                variant={theme === 'system' ? 'primary' : 'secondary'}
                onClick={() => handleThemeChange('system')}
                icon={<Monitor size={14} />}
              >
                System Default
              </Button>
            </div>
          </div>
        </Card>

        {/* Section 3: Architecture Reference Callout */}
        <div style={{
          padding: '1rem 1.25rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <BookOpen size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                Architecture & Distributed System Invariants
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                Learn about synchronous durability points, deterministic replay, and failure taxonomy.
              </div>
            </div>
          </div>

          <Link to="/docs#architecture" className="btn btn-secondary btn-sm" style={{ gap: '0.25rem', flexShrink: 0 }}>
            Read Docs <ArrowUpRight size={12} />
          </Link>
        </div>

      </div>
    </div>
  );
};
