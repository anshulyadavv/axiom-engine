import { WorkflowEngine } from "../src/engine";
import { workflow } from "../src/types";

describe("WorkflowEngine", () => {
    let engine: WorkflowEngine;

    beforeEach(() => {
        engine = new WorkflowEngine();
    });

    it("should start a workflow and yield a ScheduleStep command", async () => {
        let sideEffectExecuted = false;

        const testFlow = workflow<any, any>("test-flow", 1, async (ctx, input) => {
            const result = await ctx.step.run("step1", async () => {
                sideEffectExecuted = true;
                return { hello: input.name };
            });
            return result;
        });

        engine.register(testFlow);

        const command = await engine.resumeWorkflow("test-flow", 1, { name: "world" }, []);

        // It should yield ScheduleStep without executing the side effect
        expect(command).toEqual({
            command_type: "ScheduleStep",
            step_id: "step1",
            options: undefined
        });
        expect(sideEffectExecuted).toBe(false);
    });

    it("should replay a completed step and complete the workflow", async () => {
        let sideEffectExecuted = false;

        const testFlow = workflow<any, any>("test-flow", 1, async (ctx, input) => {
            const result = await ctx.step.run("step1", async () => {
                sideEffectExecuted = true;
                return { hello: input.name };
            });
            return result;
        });

        engine.register(testFlow);

        const history = [
            { sequence_number: 1, type: "WorkflowStarted", data: { input: { name: "world" } } },
            { sequence_number: 2, type: "StepCompleted", data: { id: "step1", output: { hello: "world" } } }
        ];

        const command = await engine.resumeWorkflow("test-flow", 1, { name: "world" }, history);

        // It should yield CompleteWorkflow without executing the side effect
        expect(command).toEqual({
            command_type: "CompleteWorkflow",
            output: { hello: "world" }
        });
        expect(sideEffectExecuted).toBe(false);
    });

    it("should execute a stateless closure when executeStep is called", async () => {
        let sideEffectExecuted = false;
        let sideEffectArgs: any = null;

        const testFlow = workflow<any, any>("test-flow", 1, async (ctx, input) => {
            // First step is already completed in history
            const step1Result = await ctx.step.run("step1", async () => {
                return "step1-done";
            });

            // Second step is the target
            const result = await ctx.step.run("step2", async () => {
                sideEffectExecuted = true;
                sideEffectArgs = { input, step1Result };
                return "step2-done";
            });

            return result;
        });

        engine.register(testFlow);

        const history = [
            { sequence_number: 1, type: "StepCompleted", data: { id: "step1", output: "step1-done" } }
        ];

        // Call executeStep directly targeting step2
        const result = await engine.executeStep("test-flow", 1, { name: "world" }, history, "step2");

        expect(result).toEqual({
            status: "success",
            output: "step2-done"
        });

        // The side effect MUST have executed this time, because it was the target!
        expect(sideEffectExecuted).toBe(true);
        // It must have successfully reconstructed the local variables (input, step1Result)
        expect(sideEffectArgs).toEqual({
            input: { name: "world" },
            step1Result: "step1-done"
        });
    });

    it("should throw DeterminismViolation for duplicate step IDs", async () => {
        const testFlow = workflow("test-flow", 1, async (ctx, input) => {
            await ctx.step.run("step1", async () => "A");
            await ctx.step.run("step1", async () => "B"); // Duplicate!
        });

        engine.register(testFlow);

        const history = [
            { sequence_number: 1, type: "StepCompleted", data: { id: "step1", output: "A" } }
        ];

        const command = await engine.resumeWorkflow("test-flow", 1, {}, history);

        expect(command).toEqual({
            command_type: "FailWorkflow",
            error: {
                message: "Duplicate step ID: step1",
                type: "DETERMINISM_VIOLATION",
                details: [{ field: "history", message: "Determinism violation during replay" }]
            }
        });
    });
    it("should yield ScheduleChildWorkflow with deterministic operation ID", async () => {
        const testFlow = workflow("parent-flow", 1, async (ctx, input) => {
            const result = await ctx.child.run("my-child-id", "child-flow", 1, input);
            return result;
        });

        engine.register(testFlow);

        const command = await engine.resumeWorkflow("parent-flow", 1, { test: 123 }, []);

        expect(command).toEqual({
            command_type: "ScheduleChildWorkflow",
            workflow_name: "child-flow",
            workflow_version: 1,
            input: { test: 123 },
            operation_id: "my-child-id"
        });
    });

    it("should resume parent when ChildWorkflowCompleted is in history", async () => {
        const testFlow = workflow("parent-flow", 1, async (ctx, input) => {
            const result = await ctx.child.run("my-child-id", "child-flow", 1, input);
            return { parentResult: result };
        });

        engine.register(testFlow);

        const history = [
            { sequence_number: 1, type: "ChildWorkflowCompleted", data: { id: "my-child-id", output: { hello: "child" } } }
        ];

        const command = await engine.resumeWorkflow("parent-flow", 1, {}, history);

        expect(command).toEqual({
            command_type: "CompleteWorkflow",
            output: { parentResult: { hello: "child" } }
        });
    });

    it("should throw when ChildWorkflowFailed is in history", async () => {
        const testFlow = workflow("parent-flow", 1, async (ctx, input) => {
            try {
                await ctx.child.run("my-child-id", "child-flow", 1, input);
                return "SUCCESS";
            } catch (e: any) {
                return { caughtError: e.message };
            }
        });

        engine.register(testFlow);

        const history = [
            { sequence_number: 1, type: "ChildWorkflowFailed", data: { id: "my-child-id", error: { message: "child failed" } } }
        ];

        const command = await engine.resumeWorkflow("parent-flow", 1, {}, history);

        expect(command).toEqual({
            command_type: "CompleteWorkflow",
            output: { caughtError: "child failed" }
        });
    });
});
