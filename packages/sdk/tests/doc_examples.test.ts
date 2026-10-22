import { WorkflowContext, workflow, WorkflowEngine } from "@axiom/sdk";

// ============================================================================
// Verbatim Workflow Examples from docs/WORKFLOW_AUTHORING.md
// ============================================================================

// Example 1: Defining a Workflow
export async function my_workflow(ctx: WorkflowContext, input: any) {
    const result = await ctx.step.run('step_1', async () => {
        return { success: true };
    });
    return result;
}

export const myWorkflow = workflow('my_workflow', 1, my_workflow);

// Example 2: Durable Steps with StepOptions
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

// Example 3: Replay Constraints & Deterministic APIs
export async function deterministicWorkflow(ctx: WorkflowContext, input: any) {
    const timestamp = ctx.now();
    const randomVal = ctx.random();
    const result = await ctx.step.run('step_deterministic', async () => {
        return { timestamp, randomVal, input };
    });
    return result;
}

export const deterministicWorkflowDef = workflow('deterministic_workflow', 1, deterministicWorkflow);

// Example 4: Child Workflows
export async function parentWorkflow(ctx: WorkflowContext, input: any) {
    const childResult = await ctx.child.run('child_1', 'child_workflow_name', 1, { data: 123 });
    return childResult;
}

export const parentWorkflowDef = workflow('parent_workflow', 1, parentWorkflow);

// Example 5: Workflow-Local State
export async function statefulWorkflow(ctx: WorkflowContext, input: any) {
    await ctx.state.set('status', 'processing');
    const val = await ctx.state.get<string>('status');
    await ctx.state.delete('status');
    return { val };
}

export const statefulWorkflowDef = workflow('stateful_workflow', 1, statefulWorkflow);

// Example 6: Timers (Phase 2 Stub)
export async function sleepWorkflow(ctx: WorkflowContext, input: any) {
    // Note: ctx.sleep is a Phase 1 stub that throws "Not implemented in Phase 1"
    await ctx.sleep(1000);
}

export const sleepWorkflowDef = workflow('sleep_workflow', 1, sleepWorkflow);

// Example 7: README.md Headline Example Verbatim
export const orderWorkflow = workflow(
  "order-processing",
  1,
  async (ctx, input: { orderId: string; total: number; email: string }) => {
    const order = await ctx.step.run(
      "fetch-order",
      async () => ({ id: input.orderId, total: input.total, email: input.email })
    );

    const payment = await ctx.step.run(
      "charge-payment",
      async () => ({ transactionId: "txn_123", status: "succeeded" }),
      { idempotencyKey: `charge-${order.id}` }
    );

    await ctx.state.set("order-status", "payment-verified");

    await ctx.step.run(
      "send-confirmation",
      async () => ({ sent: true, recipient: order.email })
    );

    return { orderId: order.id, paymentId: payment.transactionId };
  }
);


// ============================================================================
// Verification Tests
// ============================================================================

describe("WORKFLOW_AUTHORING.md Verbatim Examples Test", () => {
    let engine: WorkflowEngine;

    beforeEach(() => {
        engine = new WorkflowEngine();
    });

    it("verifies my_workflow yields ScheduleStep and replays to completion", async () => {
        engine.register(myWorkflow);

        // First execution yields ScheduleStep
        const cmd1 = await engine.resumeWorkflow("my_workflow", 1, {}, []);
        expect(cmd1).toEqual({
            command_type: "ScheduleStep",
            step_id: "step_1",
            options: undefined
        });

        // Replay with step completed
        const history = [
            { sequence_number: 1, type: "WorkflowStarted", data: { input: {} } },
            { sequence_number: 2, type: "StepCompleted", data: { id: "step_1", output: { success: true } } }
        ];
        const cmd2 = await engine.resumeWorkflow("my_workflow", 1, {}, history);
        expect(cmd2).toEqual({
            command_type: "CompleteWorkflow",
            output: { success: true }
        });
    });

    it("verifies paymentWorkflow includes idempotencyKey and timeout options", async () => {
        engine.register(paymentWorkflowDef);

        const cmd = await engine.resumeWorkflow("payment_workflow", 1, { orderId: "ord-999" }, []);
        expect(cmd).toEqual({
            command_type: "ScheduleStep",
            step_id: "charge_payment",
            options: {
                idempotencyKey: "charge-ord-999",
                timeoutMs: 30000
            }
        });
    });

    it("verifies deterministicWorkflow uses ctx.now() and ctx.random()", async () => {
        engine.register(deterministicWorkflowDef);

        // First step requests timestamp
        const cmd1 = await engine.resumeWorkflow("deterministic_workflow", 1, { data: "test" }, []);
        expect(cmd1).toEqual({ command_type: "RecordTimestamp" });

        // With recorded timestamp, requests random
        const history = [
            { sequence_number: 1, type: "WorkflowStarted", data: {} },
            { sequence_number: 2, type: "TimestampRecorded", data: { value: 1700000000000 } }
        ];
        const cmd2 = await engine.resumeWorkflow("deterministic_workflow", 1, { data: "test" }, history);
        expect(cmd2).toEqual({ command_type: "RecordRandom" });

        // With both recorded, schedules step
        history.push({ sequence_number: 3, type: "RandomRecorded", data: { value: 0.42 } });
        const cmd3 = await engine.resumeWorkflow("deterministic_workflow", 1, { data: "test" }, history);
        expect(cmd3).toEqual({
            command_type: "ScheduleStep",
            step_id: "step_deterministic",
            options: undefined
        });
    });

    it("verifies parentWorkflow schedules child workflow and resumes with child output", async () => {
        engine.register(parentWorkflowDef);

        const cmd1 = await engine.resumeWorkflow("parent_workflow", 1, {}, []);
        expect(cmd1).toEqual({
            command_type: "ScheduleChildWorkflow",
            workflow_name: "child_workflow_name",
            workflow_version: 1,
            input: { data: 123 },
            operation_id: "child_1"
        });

        const history = [
            { sequence_number: 1, type: "WorkflowStarted", data: {} },
            { sequence_number: 2, type: "ChildWorkflowCompleted", data: { id: "child_1", output: { done: true } } }
        ];
        const cmd2 = await engine.resumeWorkflow("parent_workflow", 1, {}, history);
        expect(cmd2).toEqual({
            command_type: "CompleteWorkflow",
            output: { done: true }
        });
    });

    it("verifies statefulWorkflow performs get, set, and delete operations", async () => {
        engine.register(statefulWorkflowDef);

        const stateStore = new Map<string, any>();
        const mockStateRequest = async (payload: any) => {
            if (payload.op === "get") {
                return { ok: true, value: stateStore.get(payload.key) };
            } else if (payload.op === "set") {
                stateStore.set(payload.key, payload.value);
                return { ok: true };
            } else if (payload.op === "delete") {
                stateStore.delete(payload.key);
                return { ok: true };
            }
            return { ok: false, error: "unknown op" };
        };

        const cmd = await engine.resumeWorkflow(
            "stateful_workflow",
            1,
            {},
            [],
            "run-123",
            mockStateRequest
        );

        expect(cmd).toEqual({
            command_type: "CompleteWorkflow",
            output: { val: "processing" }
        });
        expect(stateStore.has("status")).toBe(false);
    });

    it("verifies sleepWorkflow throws Phase 1 not implemented error", async () => {
        engine.register(sleepWorkflowDef);

        const cmd = await engine.resumeWorkflow("sleep_workflow", 1, {}, []);
        expect(cmd).toEqual({
            command_type: "FailWorkflow",
            error: {
                type: "EXECUTION_ERROR",
                message: "Not implemented in Phase 1",
                details: []
            }
        });
    });

    it("verifies README orderWorkflow executes and replays to completion", async () => {
        engine.register(orderWorkflow);

        const input = { orderId: "ord-101", total: 4999, email: "customer@example.com" };
        const cmd1 = await engine.resumeWorkflow("order-processing", 1, input, []);
        expect(cmd1).toEqual({
            command_type: "ScheduleStep",
            step_id: "fetch-order",
            options: undefined
        });

        // Replay with fetch-order and charge-payment completed
        const history = [
            { sequence_number: 1, type: "WorkflowStarted", data: { input } },
            { sequence_number: 2, type: "StepCompleted", data: { id: "fetch-order", output: { id: "ord-101", total: 4999, email: "customer@example.com" } } },
            { sequence_number: 3, type: "StepCompleted", data: { id: "charge-payment", output: { transactionId: "txn_123", status: "succeeded" } } },
            { sequence_number: 4, type: "StepCompleted", data: { id: "send-confirmation", output: { sent: true, recipient: "customer@example.com" } } }
        ];

        const stateStore = new Map<string, any>();
        const mockStateRequest = async (payload: any) => {
            if (payload.op === "set") {
                stateStore.set(payload.key, payload.value);
                return { ok: true };
            }
            return { ok: false };
        };

        const cmd2 = await engine.resumeWorkflow("order-processing", 1, input, history, "run-ord-1", mockStateRequest);
        expect(cmd2).toEqual({
            command_type: "CompleteWorkflow",
            output: { orderId: "ord-101", paymentId: "txn_123" }
        });
        expect(stateStore.get("order-status")).toBe("payment-verified");
    });
});

