import { engine } from "./index";
import { workflow } from "./types";
import { startWorkerLoop } from "./worker";
import { runIncidentTriageAgent } from "./ai/agent";

// 1. MVP 3-step test workflow
const testFlow = workflow<any, any>("test-flow", 1, async (ctx, input) => {
    const step1Result = await ctx.step.run("step1", async () => {
        return "A";
    });

    const step2Result = await ctx.step.run("step2", async () => {
        return step1Result + "B";
    });

    const step3Result = await ctx.step.run("step3", async () => {
        return step2Result + "C";
    });

    return step3Result;
});

// 2. Real multi-step arithmetic & processing pipeline
const multiStepFlow = workflow<any, any>("multi_step_flow", 1, async (ctx, input) => {
    const baseValue = input?.baseNumber || 42;

    const validated = await ctx.step.run("validate_input", async () => {
        if (typeof baseValue !== "number" || isNaN(baseValue)) {
            throw new Error("Invalid baseNumber input: must be a valid number");
        }
        return { valid: true, value: baseValue, timestamp: new Date().toISOString() };
    });

    const computed = await ctx.step.run("compute_transform", async () => {
        const factor = 1.618;
        return {
            original: validated.value,
            scaled: Math.round(validated.value * factor * 100) / 100,
            squared: validated.value * validated.value,
        };
    });

    const summarized = await ctx.step.run("summarize_pipeline", async () => {
        return {
            status: "SUCCESS",
            resultSummary: `Computed baseline ${computed.original} -> scaled ${computed.scaled}`,
            metrics: computed,
            completedAt: new Date().toISOString(),
        };
    });

    return summarized;
});

// 3. Workflow with controlled bounded retry demonstrating transient failure recovery
const retryFlow = workflow<any, any>("retry_flow", 1, async (ctx, input) => {
    let result = null;
    let attempt = 1;
    const maxRetries = input?.maxRetries || 3;

    while (attempt <= maxRetries) {
        try {
            result = await ctx.step.run(`flaky_attempt_${attempt}`, async () => {
                if (attempt < 2) {
                    throw new Error(`UpstreamTransientError: 503 Service Unavailable (attempt ${attempt}/${maxRetries})`);
                }
                return {
                    status: "RESOLVED",
                    attemptsRequired: attempt,
                    data: "Payload successfully acquired after transient recovery",
                    recoveredAt: new Date().toISOString(),
                };
            });
            break;
        } catch (e: any) {
            if (e.message === "YIELD") throw e;
            attempt++;
            if (attempt > maxRetries) throw e;
        }
    }

    return result;
});

// 4. Controlled failing workflow for testing failure observability
const failingFlow = workflow<any, any>("failing_flow", 1, async (ctx, input) => {
    await ctx.step.run("step_preflight_check", async () => {
        return { preflight: "PASSED", timestamp: new Date().toISOString() };
    });

    // Deliberate controlled failure
    await ctx.step.run("failing_processing_step", async () => {
        const targetError = input?.errorMessage || "PaymentGatewayTimeout: upstream 504 Gateway Timeout on credit card capture";
        throw new Error(targetError);
    });

    return { status: "SHOULD_NOT_REACH" };
});

// 5. Bounded delay/sleep workflow
const delayedFlow = workflow<any, any>("delayed_flow", 1, async (ctx, input) => {
    const sleepDurationMs = input?.durationMs || 3000;

    await ctx.step.run("pre_delay_checkpoint", async () => {
        return { phase: "STARTING_DELAY", scheduledDurationMs: sleepDurationMs };
    });

    await ctx.sleep(sleepDurationMs);

    const postDelay = await ctx.step.run("post_delay_verification", async () => {
        return { phase: "COMPLETED", resumedAt: new Date().toISOString() };
    });

    return postDelay;
});

// 6. Real Bounded AI-Agent Incident Triage Workflow
const incidentTriageFlow = workflow<any, any>("incident_triage_agent", 1, async (ctx, input) => {
    const alertInput = {
        incidentId: input?.incidentId || `inc-${Date.now()}`,
        alertType: input?.alertType || "WorkerHeartbeatMissed",
        serviceName: input?.serviceName || "axiom-worker-pool-east",
        errorSnippet: input?.errorSnippet || "Worker heartbeats missed for 120s; lease fencing triggered.",
        runId: input?.runId,
    };

    return await runIncidentTriageAgent(ctx, alertInput);
});

// Register all workflows with the engine
engine.register(testFlow);
engine.register(multiStepFlow);
engine.register(retryFlow);
engine.register(failingFlow);
engine.register(delayedFlow);
engine.register(incidentTriageFlow);

startWorkerLoop();
