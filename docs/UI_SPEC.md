# Axiom Engine — Dashboard / UI Specification

## 1. Design Philosophy

The Axiom dashboard is a **developer console for infrastructure software**.
It must feel like a tool built for engineers who care about reliability,
not a marketing-driven SaaS product.

### Principles

- **High information density**: Show more data, fewer decorations.
- **Technical precision**: Use exact timestamps, durations, IDs. Never round
  away information.
- **Clean hierarchy**: Clear visual hierarchy through typography and spacing,
  not color or animation.
- **Minimal chrome**: Reduce visual noise. Every pixel earns its place.
- **Fast**: The UI must feel instant. Optimize perceived performance.
- **Keyboard-friendly**: Power users navigate by keyboard.
- **Accessible**: WCAG 2.1 AA compliance.

### What This Is NOT

- Not a flashy SaaS dashboard with gradient cards and emojis.
- Not a low-information "status page" with three big numbers.
- Not a drag-and-drop workflow builder.

### Visual References

Think: Grafana, Datadog, Linear, Vercel dashboard, Railway dashboard.
Precision tooling. Dense information. Restrained aesthetics.

## 2. Technology

- **Framework**: React (TypeScript)
- **Build**: Vite
- **Styling**: CSS Modules or vanilla CSS. No Tailwind unless explicitly
  requested.
- **State Management**: React Query (TanStack Query) for server state.
  Zustand or React context for UI state.
- **Routing**: React Router
- **Real-Time**: WebSocket client for live updates.
- **Charts**: Recharts or similar lightweight charting library.
- **Typography**: Inter (Google Fonts) as primary typeface.
- **Icons**: Lucide React (consistent, clean icon set).

## 3. Color System

### Dark Mode (Primary)

```css
--bg-primary:     hsl(225, 15%, 8%);    /* Main background */
--bg-secondary:   hsl(225, 15%, 11%);   /* Card/panel background */
--bg-tertiary:    hsl(225, 12%, 15%);   /* Elevated surfaces */
--bg-hover:       hsl(225, 12%, 18%);   /* Hover state */

--text-primary:   hsl(225, 10%, 93%);   /* Primary text */
--text-secondary: hsl(225, 10%, 60%);   /* Secondary text */
--text-tertiary:  hsl(225, 10%, 40%);   /* Muted text */

--border:         hsl(225, 12%, 18%);   /* Borders and dividers */
--border-subtle:  hsl(225, 12%, 14%);   /* Subtle separators */

--accent:         hsl(210, 100%, 60%);  /* Primary accent (links, active) */
--accent-hover:   hsl(210, 100%, 65%);  /* Accent hover */
--accent-muted:   hsl(210, 50%, 20%);   /* Accent background */

--success:        hsl(145, 65%, 50%);   /* Success / completed */
--success-bg:     hsl(145, 40%, 12%);
--warning:        hsl(38, 90%, 55%);    /* Warning / retrying */
--warning-bg:     hsl(38, 40%, 12%);
--error:          hsl(0, 70%, 55%);     /* Error / failed */
--error-bg:       hsl(0, 40%, 12%);
--info:           hsl(200, 80%, 55%);   /* Info / running */
--info-bg:        hsl(200, 40%, 12%);
```

### Light Mode (Secondary)

Provide a light mode but optimize for dark mode first. Most infrastructure
engineers prefer dark mode.

## 4. Typography

```css
--font-sans:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono:    'JetBrains Mono', 'Fira Code', 'Consolas', monospace;

--text-xs:      0.75rem;    /* 12px — labels, metadata */
--text-sm:      0.8125rem;  /* 13px — secondary text, table cells */
--text-base:    0.875rem;   /* 14px — primary body text */
--text-lg:      1rem;       /* 16px — section headers */
--text-xl:      1.25rem;    /* 20px — page titles */
--text-2xl:     1.5rem;     /* 24px — major headings */
```

Note: Base text is 14px, not 16px. Infrastructure dashboards work better
at slightly smaller text sizes for density.

## 5. Layout

### Navigation

Left sidebar, collapsible. Fixed position.

```
┌─────────────────────────────────────────────────┐
│ ◆ Axiom                              [search]   │
├──────────┬──────────────────────────────────────┤
│          │                                       │
│ Overview │     Main Content Area                │
│ Workflows│                                       │
│ Runs     │                                       │
│ Workers  │                                       │
│ Queues   │                                       │
│ Metrics  │                                       │
│ Logs     │                                       │
│          │                                       │
│ ──────── │                                       │
│ Settings │                                       │
│ API Keys │                                       │
│ Docs     │                                       │
│          │                                       │
└──────────┴──────────────────────────────────────┘
```

### Responsive Behavior

- **≥1200px**: Sidebar + full content.
- **768-1199px**: Collapsed sidebar (icons only) + content.
- **<768px**: Hidden sidebar (hamburger menu) + full-width content.

## 6. Views

### 6.1 Overview

**Purpose**: System health at a glance.

**Contents**:
- Active workflow runs (count).
- Workflows started / completed / failed in last 24h.
- Success rate trend (sparkline).
- Average duration trend (sparkline).
- Worker status summary.
- Recent failures (last 5, linked to run detail).
- System health indicators (Postgres, NATS, workers).

### 6.2 Workflows List

**Purpose**: Browse and filter workflow definitions.

**Contents**:
- Filterable table:
  | Name | Version | Status | Total Runs | Active | Success Rate | Avg Duration | Last Run |
- Click row → Workflow Detail.
- Search by name.
- Filter by status.
- Sort by any column.

### 6.3 Workflow Detail

**Purpose**: Detailed view of a specific workflow.

**Contents**:
- Header: Workflow name, version, status, description.
- Stats cards: Total runs, active runs, success rate, failure rate,
  avg duration, p95 duration.
- Run distribution chart (runs over time, stacked by status).
- Recent runs table (paginated).
- Retry policy display.
- Timeout configuration.

### 6.4 Run Detail

**Purpose**: Detailed view of a single workflow run.

**This is a flagship view.** It must be excellent.

**Contents**:
- Header: Run ID, workflow name, status badge, duration, timestamps.
- **Execution Timeline** (see 6.5).
- Step list:
  ```
  ✓ fetch-order        45ms    completed
  ✓ charge-payment     312ms   completed (attempt 2 of 3)
  ⏳ send-confirmation  —       running
  ○ finalize            —       pending
  ```
- Each step expandable to show:
  - Input (JSON, collapsible)
  - Output (JSON, collapsible)
  - Error details (if failed)
  - Attempt history (if retried)
  - Duration per attempt
  - Operation ID / idempotency key
- Metadata panel: correlation ID, worker ID, workflow version.
- Event history (see 6.6).
- Actions: Cancel (with confirmation dialog).

### 6.5 Execution Timeline

**Purpose**: Visual timeline of workflow execution.

**This is the showpiece component.**

```
Time ──────────────────────────────────────────────────►

WorkflowStarted ─┐
                  │
Step Pending ─────┤ fetch-order
StepCompleted ────┘ (45ms)
                  │
Step Pending ─────┤ charge-payment
StepFailed ───────┤ (attempt 1, 198ms) ← error: timeout
Retrying ─────────┤ (backoff: 2s)
Step Pending ─────┤ charge-payment
StepCompleted ────┘ (attempt 2, 312ms)
                  │
Timer Scheduled ──┤ sleep (24h)
                  │ ··· 24 hours ···
TimerFired ───────┤
                  │
Step Pending ─────┤ send-confirmation
Step Running ─────┤ ← currently executing
```

*(Note: The timeline UI combines Semantic Events from the `events` table with Operational State from the `step_executions` and `timers` tables to provide a complete view.)*

**Requirements**:
- Horizontal timeline with events positioned by time.
- Swim lanes for concurrent steps (if supported).
- Color-coded by event type (success=green, failure=red, timer=blue, etc.).
- Hover for details.
- Click event to expand details.
- Zoom and pan for long-running workflows.
- Clearly show gaps (sleep periods, retry delays).
- Show replay/recovery events with a distinct visual marker.

### 6.6 Event History

**Purpose**: Full append-only event log for a run.

**Contents**:
- Chronological list of events.
- Each event shows: sequence number, event type, timestamp, relevant data.
- Filterable by event type.
- JSON viewer for event data.
- Copy event data to clipboard.

### 6.7 Workers

**Purpose**: Worker fleet status.

**Contents**:
- Worker table:
  | ID | Status | Active Runs | Last Heartbeat | Uptime |
- Active/draining/offline indicators.
- Click for worker detail (recent runs, error rate).

### 6.8 Metrics

**Purpose**: System performance metrics.

**Contents**:
- Workflow throughput (started/completed/failed per minute).
- Step execution latency (p50, p95, p99).
- Queue latency (time from scheduled to started).
- Retry rate.
- Worker utilization.
- Time range selector (1h, 6h, 24h, 7d, 30d).

### 6.9 Settings

**Purpose**: System configuration.

**Contents**:
- General settings.
- Default retry policies.
- Retention settings.
- Notification configuration (future).

### 6.10 API Keys

**Purpose**: Manage API keys.

**Contents**:
- Key list: name, prefix, permissions, created, last used, status.
- Create key (shows full key exactly once).
- Revoke key (with confirmation).
- Edit key permissions.

## 7. State Communication

Every asynchronous operation must show its state:

| State | Visual |
|-------|--------|
| Loading | Skeleton loader (not spinner). |
| Success | Data displayed. Brief success toast for mutations. |
| Empty | "No workflows found." with action suggestion. |
| Error | Inline error message with retry action. |
| Offline | Banner: "Connection lost. Reconnecting..." |
| Reconnecting | Banner with animated indicator. |
| Stale | Subtle indicator: "Last updated 2m ago" |

### Error Display

Errors must explain:
1. **What happened**: "Failed to load workflow runs."
2. **Why** (if known): "The server returned a 503 error."
3. **What to do**: "Retry" button or "Check server status."

### Destructive Actions

- Run cancellation: Confirmation dialog.
- API key revocation: Confirmation dialog with key name shown.
- Workflow archival: Confirmation dialog.

### Real-Time Updates

- WebSocket connection for run detail and event history.
- Automatic reconnection with exponential backoff.
- Visual indicator during reconnection.
- Stale data indicator when disconnected.
- New events animate into the timeline and event list.

## 8. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl + K` | Global search |
| `⌘/Ctrl + /` | Show keyboard shortcuts |
| `←` / `→` | Navigate between views |
| `j` / `k` | Navigate list items |
| `Enter` | Open selected item |
| `Esc` | Close modal / go back |

## 9. Performance Requirements

- **First Contentful Paint**: < 1.5s.
- **Time to Interactive**: < 3s.
- **API response rendering**: < 200ms after data arrives.
- **WebSocket event rendering**: < 100ms after event received.
- **Large list (1000+ items)**: Virtualized rendering.

## 10. Accessibility

- All interactive elements focusable and operable by keyboard.
- ARIA labels for icons and non-text content.
- Color is not the sole means of conveying information (icons + color).
- Sufficient contrast ratios (WCAG AA).
- Focus indicators visible.
- Screen reader tested for critical flows.
