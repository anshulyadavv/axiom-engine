# Workflow Authoring

Axiom Engine uses a TypeScript sidecar to execute workflows robustly. Workflows must be deterministic and durably event-sourced.

## Defining a Workflow

Define your workflow function and register it using the `workflow` helper from `@axiom/sdk`.

```typescript
import { WorkflowContext, workflow } from '@axiom/sdk';

export async function my_workflow(ctx: WorkflowContext, input: any) {
    const result = await ctx.step.run('step_1', async () => {
        return { success: true };
    });
    return result;
}

export const myWorkflow = workflow('my_workflow', 1, my_workflow);
```

## Durable Steps

All external side effects (HTTP calls, DB updates, filesystem operations) MUST be wrapped in `ctx.step.run()`. Completed steps are never re-run on replay; a step that was in flight during a crash may run again, so use idempotency keys. On failure and retry, Axiom Engine will skip already completed steps and immediately return the durably recorded output from PostgreSQL.

```typescript
import { WorkflowContext, workflow } from '@axiom/sdk';

export async function paymentWorkflow(ctx: WorkflowContext, input: { orderId: string }) {
    const payment = await ctx.step.run(
        'charge_payment',
        async () => {
            return { transactionId: 'txn_123', status: 'succeeded' };
        },
        { idempotencyKey: `charge-${input.orderId}`, timeoutMs: 30000 }
    );
    return payment;
}

export const paymentWorkflowDef = workflow('payment_workflow', 1, paymentWorkflow);
```

## Replay Constraints

Workflows run in a replay execution model. When a worker fails and another takes over, the TS code is executed from the beginning.
- Do NOT use `Math.random()`, `Date.now()`, or other non-deterministic APIs outside of a step. Use deterministic runtime helpers `ctx.now()` and `ctx.random()` instead.
- Do NOT mutate global state.
- Do NOT perform background async operations (`setTimeout`) that drift execution.
- Note: `ctx.sleep()` and `ctx.waitForSignal()` are Phase 2 capabilities (stubs that throw in Phase 1).

```typescript
import { WorkflowContext, workflow } from '@axiom/sdk';

export async function deterministicWorkflow(ctx: WorkflowContext, input: any) {
    const timestamp = ctx.now();
    const randomVal = ctx.random();
    const result = await ctx.step.run('step_deterministic', async () => {
        return { timestamp, randomVal, input };
    });
    return result;
}

export const deterministicWorkflowDef = workflow('deterministic_workflow', 1, deterministicWorkflow);
```

## Child Workflows

You can spawn a child workflow that executes identically to a parent, but with independent execution tracking.
`ctx.child.run()` accepts an operation ID, child workflow name, workflow version, and input payload:

```typescript
import { WorkflowContext, workflow } from '@axiom/sdk';

export async function parentWorkflow(ctx: WorkflowContext, input: any) {
    const childResult = await ctx.child.run('child_1', 'child_workflow_name', 1, { data: 123 });
    return childResult;
}

export const parentWorkflowDef = workflow('parent_workflow', 1, parentWorkflow);
```

Axiom strictly guarantees parent suspension until the child finishes.

## Workflow-Local State

Axiom Engine provides durable workflow-local state scoped per run that survives worker reassignment.

```typescript
import { WorkflowContext, workflow } from '@axiom/sdk';

export async function statefulWorkflow(ctx: WorkflowContext, input: any) {
    await ctx.state.set('status', 'processing');
    const val = await ctx.state.get<string>('status');
    await ctx.state.delete('status');
    return { val };
}

export const statefulWorkflowDef = workflow('stateful_workflow', 1, statefulWorkflow);
```

## Timers and Signals (Phase 2)

Timer delays and external signals are defined on the context:

```typescript
import { WorkflowContext, workflow } from '@axiom/sdk';

export async function sleepWorkflow(ctx: WorkflowContext, input: any) {
    // Note: ctx.sleep is a Phase 1 stub that throws "Not implemented in Phase 1"
    await ctx.sleep(1000);
}

export const sleepWorkflowDef = workflow('sleep_workflow', 1, sleepWorkflow);
```

## Error Handling and Retries

If a step throws an error, Axiom will fail the workflow run or retry based on configuration (retries are an operational concern managed by the runtime or can be handled inside your step function).

## Versioning Rules

Axiom tightly binds runs to workflow versions (numeric: `1`, `2`, etc.). If you change the underlying TS code logically, you must register it as a new version. In-flight runs will continue executing against the version they were started on.
