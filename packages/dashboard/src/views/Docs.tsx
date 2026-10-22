import React, { useState, useEffect } from 'react';
import { PageHeader, Badge, Card } from '../components/ui';

interface CodeSnippetProps {
  code: string;
  language?: string;
}

const CodeSnippet: React.FC<CodeSnippetProps> = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: 'relative', margin: '0.75rem 0' }}>
      <pre className="font-mono" style={{
        backgroundColor: 'var(--bg-app)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem 1rem',
        fontSize: '12px',
        color: 'var(--text-primary)',
        overflowX: 'auto',
        lineHeight: 1.5,
      }}>
        <code>{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="btn btn-ghost btn-sm"
        style={{
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          padding: '0.25rem 0.5rem',
          fontSize: '11px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
        }}
        title="Copy to clipboard"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
};

export const Docs: React.FC = () => {
  const [activeSection, setActiveSection] = useState('overview');

  const sections = [
    { id: 'overview', title: '1. Overview' },
    { id: 'concepts', title: '2. Core Concepts' },
    { id: 'quickstart', title: '3. Getting Started' },
    { id: 'pages', title: '4. Understanding Each Page' },
    { id: 'devtools', title: '5. Development Tools' },
    { id: 'security', title: '6. Configuration & Security' },
    { id: 'troubleshooting', title: '7. Troubleshooting' },
    { id: 'architecture', title: '8. Architecture & Guarantees' },
  ];

  const scrollTo = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (window.location.hash) {
      const hash = window.location.hash.replace('#', '');
      scrollTo(hash);
    }
  }, []);

  // Scrollspy: Link scroll position to active section in Table of Contents
  useEffect(() => {
    const scrollContainer = document.querySelector('.main-content');

    const updateActiveSectionOnScroll = () => {
      const offsetThreshold = 140; // px below top navbar
      let currentSection = sections[0].id;

      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= offsetThreshold) {
            currentSection = section.id;
          }
        }
      }

      // If scrolled near the bottom of main-content, activate the last section
      if (scrollContainer) {
        const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 50;
        if (atBottom) {
          currentSection = sections[sections.length - 1].id;
        }
      }

      setActiveSection(currentSection);
    };

    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', updateActiveSectionOnScroll, { passive: true });
    }
    window.addEventListener('scroll', updateActiveSectionOnScroll, { passive: true });

    // Initial check
    updateActiveSectionOnScroll();

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', updateActiveSectionOnScroll);
      }
      window.removeEventListener('scroll', updateActiveSectionOnScroll);
    };
  }, []);

  return (
    <div className="page-container" style={{ maxWidth: '1440px' }}>
      <PageHeader
        title="Documentation & User Guide"
        description="Complete operational manual, runtime concepts, local development workflow, and troubleshooting diagnostics."
        badge={<Badge variant="primary" withDot={false}>v2.0-alpha</Badge>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '2rem', alignItems: 'flex-start' }}>
        {/* Table of Contents Nav */}
        <div style={{
          position: 'sticky',
          top: '72px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '0.875rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.375rem 0.5rem' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Sections
            </span>
            <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>
              {sections.find(s => s.id === activeSection)?.title.split('.')[0] || '1'}/8
            </span>
          </div>
          {sections.map(s => {
            const isActive = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`nav-item ${isActive ? 'active' : ''}`}
                style={{
                  textAlign: 'left',
                  width: '100%',
                  padding: '0.4375rem 0.625rem',
                  fontSize: 'var(--font-size-xs)',
                  justifyContent: 'flex-start',
                }}
              >
                <span>{s.title}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem', minWidth: 0 }}>
          
          {/* Section 1: Overview */}
          <section id="overview" style={{ scrollMarginTop: '80px' }}>
            <Card title="1. Overview">
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p>
                  <strong>Axiom Engine</strong> is a self-hostable durable execution runtime for Workflows-as-Code. It allows developers to define long-running, multi-step asynchronous processes in standard TypeScript, guaranteeing that state transitions survive process restarts, node crashes, and transient network outages.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                  <div style={{ padding: '0.875rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>What Problems Does It Solve?</div>
                    <ul style={{ paddingLeft: '1.25rem', margin: 0, fontSize: 'var(--font-size-xs)' }}>
                      <li>Eliminates bespoke state machines, cron queues, and saga databases.</li>
                      <li>Survives server crashes mid-workflow without re-executing already-completed steps.</li>
                      <li>Ensures deterministic replay and strict lease fencing across worker nodes.</li>
                    </ul>
                  </div>
                  <div style={{ padding: '0.875rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Definitions vs. Executions</div>
                    <ul style={{ paddingLeft: '1.25rem', margin: 0, fontSize: 'var(--font-size-xs)' }}>
                      <li><strong>Workflow Definition:</strong> A registered code blueprint identified by name and semver version.</li>
                      <li><strong>Workflow Run:</strong> A specific execution instance with a unique UUID, inputs, outputs, and a durable step history journal.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </Card>
          </section>

          {/* Section 2: Core Concepts */}
          <section id="concepts" style={{ scrollMarginTop: '80px' }}>
            <Card title="2. Core Concepts & Semantics">
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Workflow Runs and Steps</h3>
                  <p>
                    Workflows are composed of discrete steps executed sequentially or concurrently. When a step completes, its return value is serialized and durably committed to the <code>step_executions</code> journal in PostgreSQL. If a worker node crashes during a subsequent step, a replacement worker replays the workflow from the beginning; completed steps immediately resolve from the journal without repeating external network requests or side effects.
                  </p>
                </div>

                <div>
                  <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Worker Scheduling & Fence Tokens</h3>
                  <p>
                    Workers acquire exclusive execution leases from PostgreSQL. Each lease acquisition increments a monotonic <code>fence_token</code>. If a worker becomes unresponsive or experiences a network partition, its lease expires. When a new worker acquires the lease with an incremented fence token, any delayed writes from the split-brain worker are rejected at the database boundary.
                  </p>
                </div>

                <div>
                  <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Dispatch & Storage Topology</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                      <strong>PostgreSQL:</strong> Single durable source of truth for workflow states, step journals, leases, and outbox messages.
                    </div>
                    <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                      <strong>NATS JetStream:</strong> High-throughput distributed work queue broker for dispatching execution intents to worker nodes.
                    </div>
                    <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                      <strong>Redis (Optional):</strong> Fail-soft operational cache for fast telemetry snapshots, query acceleration, and rate-limiting.
                    </div>
                  </div>
                </div>

                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--status-warning-bg)', border: '1px solid var(--status-warning-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)' }}>
                  <strong>Execution Guarantees:</strong> Axiom Engine guarantees <em>at-least-once</em> step execution with deterministic state replay. Non-idempotent third-party side effects (e.g., external credit card processing) must incorporate an idempotency key derived from the <code>run_id</code> and <code>step_id</code>.
                </div>
              </div>
            </Card>
          </section>

          {/* Section 3: Getting Started */}
          <section id="quickstart" style={{ scrollMarginTop: '80px' }}>
            <Card title="3. Getting Started (Local Development Sequence)">
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p>
                  Follow this verified step-by-step sequence to start all dependencies and execute workflows locally:
                </p>

                <div>
                  <strong>Step 1: Start Infrastructure Containers</strong>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Launch PostgreSQL, NATS JetStream, and Redis using Docker Compose:</p>
                  <CodeSnippet code="docker compose up -d postgres nats redis" />
                </div>

                <div>
                  <strong>Step 2: Build the TypeScript SDK Sidecar</strong>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Compile the SDK worker entrypoint used by the Rust orchestrator:</p>
                  <CodeSnippet code="pnpm --filter sdk build" />
                </div>

                <div>
                  <strong>Step 3: Start the Axiom API Server (Port 3000)</strong>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Initializes database schema and starts the REST & SSE telemetry server:</p>
                  <CodeSnippet code="cargo run -p axiom-api" />
                </div>

                <div>
                  <strong>Step 4: Start the Axiom Worker Process</strong>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Launches the Rust worker node with the TypeScript execution sidecar:</p>
                  <CodeSnippet code='$env:SIDECAR_PATH = "packages/sdk/dist/app.js"; cargo run -p axiom-worker' />
                </div>

                <div>
                  <strong>Step 5: Start the Dashboard Console (Port 5173)</strong>
                  <CodeSnippet code="pnpm --filter dashboard dev" />
                </div>

                <div>
                  <strong>Step 6: Submit a Workflow Run</strong>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Submit an execution via the REST API or the in-app Dev Tools view:</p>
                  <CodeSnippet code={`curl.exe -X POST http://localhost:3000/v1/workload/trigger \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer axm_live_dummykey" \\
  -d '{"workload_type": "multi_step"}'`} />
                </div>
              </div>
            </Card>
          </section>

          {/* Section 4: Understanding Each Page */}
          <section id="pages" style={{ scrollMarginTop: '80px' }}>
            <Card title="4. Understanding Each Console Page">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Overview:</strong> Executive operational cockpit. Shows active leases, 24-hour completed/failed totals, success rate calculated strictly over terminal runs, 7-day activity chart, outcome breakdown, infrastructure readiness, live SSE telemetry feed, and Redis/AI integration cards.
                </div>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Workflows:</strong> Registry of all recognized workflow definitions. Displays workflow names, versions, descriptions, and allows manual execution dispatch with custom JSON input payloads.
                </div>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Executions (Runs):</strong> Searchable and filterable table of all persisted execution instances. Clicking an execution opens the detailed timeline, showing individual step durations, attempt counts, collapsible inputs/outputs, and raw journal events.
                </div>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Worker Fleet:</strong> Monitor active worker nodes, registered hostnames, process IDs (PID), runtime versions, and heartbeat freshness (&lt;120s timeout). Provides actionable launch commands if no nodes are detected.
                </div>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Development Tools:</strong> Isolated test workbench to trigger verified workloads (multi-step order flow, exponential retry, controlled failure, and AI triage agent). Includes a protected dev-run cleanup action requiring explicit confirmation.
                </div>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>API Keys:</strong> Manage scoped Bearer API tokens for programmatic submission. Newly generated secret keys are displayed exactly once in a security modal and can be revoked on demand.
                </div>
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Settings:</strong> Configure API endpoint URLs, default client credentials, and theme preferences (Dark, Light, System).
                </div>
              </div>
            </Card>
          </section>

          {/* Section 5: Development Tools */}
          <section id="devtools" style={{ scrollMarginTop: '80px' }}>
            <Card title="5. Development & Testing Tools">
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p>
                  The Development Tools view (<code>/dev-tools</code>) allows engineers to exercise the live execution pipeline with pre-configured scenarios:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <strong>Multi-Step Order:</strong> 3 sequential steps (validate, charge, ship). Verifies lease fencing, sequential step progression, and outbox emission.
                  </div>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <strong>Bounded Retry (Simulation):</strong> Demonstrates application-level try/catch retry in workflow code recovering on attempt 2. Engine-level step retries and exponential backoff policies are Planned (Phase 2).
                  </div>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <strong>Controlled Failure:</strong> Simulates an unrecoverable business failure. Verifies error serialization, failure tagging, and terminal state transitions.
                  </div>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <strong>AI Incident Triage:</strong> Executes a multi-step agent loop with tool calls using the local deterministic adapter. Verifies tool call counts and token telemetry.
                  </div>
                </div>
                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)' }}>
                  <strong>Safe Data Cleanup:</strong> Resetting development runs targets only synthetic executions created by the development workload generator. Production tenant executions and durable audit logs are never modified.
                </div>
              </div>
            </Card>
          </section>

          {/* Section 6: Configuration & Security */}
          <section id="security" style={{ scrollMarginTop: '80px' }}>
            <Card title="6. Configuration, Authentication & Security">
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p>
                  Axiom Engine implements defense-in-depth security for all operational interfaces:
                </p>
                <ul style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li><strong>Argon2id Password Hashing:</strong> User account passwords are protected using industry-standard salted Argon2id hashes with unique nonces.</li>
                  <li><strong>Session Cookies & CSRF:</strong> Browser sessions utilize <code>HttpOnly</code>, <code>SameSite=Lax</code> cookies combined with cryptographic CSRF token validation headers.</li>
                  <li><strong>Scoped Bearer API Keys:</strong> Automated callers pass Bearer tokens via the <code>Authorization: Bearer &lt;key&gt;</code> HTTP header.</li>
                  <li><strong>First-Admin Bootstrap:</strong> The <code>/v1/auth/bootstrap</code> endpoint allows initializing the primary administrator account and permanently locks itself once an admin exists.</li>
                  <li><strong>Payload Sanitization:</strong> The dashboard automatically redacts fields containing sensitive patterns (e.g., <code>password</code>, <code>secret</code>, <code>token</code>, <code>apikey</code>) from step input/output inspector panels.</li>
                </ul>
              </div>
            </Card>
          </section>

          {/* Section 7: Troubleshooting */}
          <section id="troubleshooting" style={{ scrollMarginTop: '80px' }}>
            <Card title="7. Troubleshooting & Diagnostics">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--status-error)', marginBottom: '0.25rem' }}>Issue: API Server Unreachable or Responding with 500</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', lineHeight: 1.5 }}>
                    Verify port 3000 availability. Ensure PostgreSQL container is running on port 5432 and database <code>axiom_engine</code> is accessible. Check connection strings in <code>.env</code>.
                  </div>
                </div>

                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--status-warning)', marginBottom: '0.25rem' }}>Issue: Active Workers Shows 0 / Worker Offline</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', lineHeight: 1.5 }}>
                    Ensure <code>axiom-worker</code> is started. Check that the worker process can reach NATS on port 4222 and PostgreSQL on port 5432. Workers send heartbeats every 15s; if a process halts, it is marked stale after 120s.
                  </div>
                </div>

                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--status-warning)', marginBottom: '0.25rem' }}>Issue: Live Telemetry Stream Disconnected</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', lineHeight: 1.5 }}>
                    Verify authentication headers or API keys in Settings. EventSource connections to <code>/v1/events/stream</code> require valid credentials.
                  </div>
                </div>

                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Issue: Sidecar IPC Connection Refused</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', lineHeight: 1.5 }}>
                    Verify the environment variable <code>SIDECAR_PATH</code> points to the compiled JavaScript entrypoint (e.g. <code>packages/sdk/dist/app.js</code>). Run <code>pnpm --filter sdk build</code> if the file is missing.
                  </div>
                </div>
              </div>
            </Card>
          </section>

          {/* Section 8: Architecture & Guarantees */}
          <section id="architecture" style={{ scrollMarginTop: '80px' }}>
            <Card title="8. Architecture & Guarantees">
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p>
                  Axiom Engine adheres to strict distributed-systems engineering rules:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <strong>Correctness &gt; Performance:</strong> Every critical state transition has a synchronous durability point in PostgreSQL before acknowledgment.
                  </div>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <strong>Deterministic Replay:</strong> Workflows must be pure functions of their step inputs and history. No hidden distributed ambiguity or un-journaled randomness.
                  </div>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)' }}>
                    <strong>Fail-Soft Integrations:</strong> Redis cache outages never interrupt core workflow execution. Direct PostgreSQL persistence serves as the resilient fallback.
                  </div>
                </div>
              </div>
            </Card>
          </section>

        </div>
      </div>
    </div>
  );
};
