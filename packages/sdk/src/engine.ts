import { WorkflowDefinition, WorkflowContext, StepOptions, ChildWorkflowOptions } from "./types";

export class DeterminismViolation extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DeterminismViolation";
    }
}

export class VersionMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VersionMismatchError";
    }
}

export type SemanticEvent = {
    sequence_number: number;
    type: string;
    data: any;
};

type ReplayMode = "REPLAY" | "LIVE" | "TERMINAL" | "ERROR";

/**
 * StateClient: issues state_request IPC messages and awaits state_result replies.
 *
 * During resume_workflow or execute_step, the Rust host services these inline
 * before sending the terminal Command/StepResult. State is NOT recorded in the
 * semantic event log — it is a direct durable PostgreSQL operation.
 *
 * Replay safety: state values survive worker reassignment. Repeated calls during
 * replay observe the same durable value. No event history mutation occurs.
 */
class StateClient {
    constructor(
        private readonly runId: string,
        private readonly sendRequest: (payload: object) => Promise<any>
    ) {}

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const result = await this.sendRequest({ op: "get", run_id: this.runId, key });
        if (!result.ok) throw new Error(`State get failed: ${result.error}`);
        return result.value as T | undefined;
    }

    async set<T = unknown>(key: string, value: T): Promise<void> {
        const result = await this.sendRequest({ op: "set", run_id: this.runId, key, value });
        if (!result.ok) throw new Error(`State set failed: ${result.error}`);
    }

    async delete(key: string): Promise<void> {
        const result = await this.sendRequest({ op: "delete", run_id: this.runId, key });
        if (!result.ok) throw new Error(`State delete failed: ${result.error}`);
    }
}

export class ContextImpl implements WorkflowContext {
    private replayIndex = 0;
    private mode: ReplayMode = "REPLAY";
    private executedStepIds = new Set<string>();

    // This property holds the command that should be yielded to Rust.
    public command: any | null = null;
    
    // In execute_step mode, we need to know which step closure to invoke.
    private targetStepId: string | null = null;

    // State client — sends state_request IPC messages via the provided callback.
    public state: StateClient;

    constructor(
        private readonly history: SemanticEvent[],
        private readonly executionMode: "resume" | "execute_step",
        targetStepId?: string,
        // Callback for state IPC: sends a state_request payload, receives state_result payload.
        private readonly stateRequestFn: ((payload: object) => Promise<any>) | null = null,
        private readonly runId: string = ""
    ) {
        this.mode = history.length > 0 ? "REPLAY" : "LIVE";
        this.targetStepId = targetStepId || null;

        // Skip WorkflowStarted if it is the first event
        if (this.mode === "REPLAY" && this.history[0]?.type === "WorkflowStarted") {
            this.replayIndex = 1;
        }

        this.state = new StateClient(runId, stateRequestFn || (() => Promise.resolve({ ok: true, value: undefined })));
    }

    private firstReplayLogged = false;

    private consumeEvent(expectedTypes: string[], expectedId?: string): SemanticEvent | null {
        if (this.mode === "LIVE") return null;
        if (this.mode !== "REPLAY") {
            throw new Error(`Cannot consume events in ${this.mode} mode`);
        }
        if (this.replayIndex >= this.history.length) {
            this.mode = "LIVE";
            return null;
        }

        const event = this.history[this.replayIndex];
        
        if (["WorkflowCompleted", "WorkflowFailed", "WorkflowCancelled"].includes(event.type)) {
            this.mode = "TERMINAL";
            this.replayIndex++;
            return event;
        }

        if (!expectedTypes.includes(event.type)) {
            this.mode = "ERROR";
            throw new DeterminismViolation(
                `Replay mismatch at index ${this.replayIndex}: expected one of [${expectedTypes.join(", ")}] but found ${event.type}`
            );
        }

        if (expectedId !== undefined && event.data?.id !== expectedId) {
            this.mode = "ERROR";
            throw new DeterminismViolation(
                `Replay mismatch at index ${this.replayIndex}: expected id "${expectedId}" but found "${event.data?.id}"`
            );
        }

        if (!this.firstReplayLogged) {
            this.firstReplayLogged = true;
            console.error(`[REPLAY_EVENT] timestamp=${new Date().toISOString()} type=${event.type} id=${event.data?.id || ""}`);
        }

        this.replayIndex++;
        return event;
    }

    step = {
        run: async <T>(id: string, fn: () => Promise<T>, options?: StepOptions): Promise<T> => {
            if (this.executedStepIds.has(id)) {
                throw new DeterminismViolation(`Duplicate step ID: ${id}`);
            }
            this.executedStepIds.add(id);

            const event = this.consumeEvent(["StepCompleted", "StepFailed"], id);

            if (event) {
                if (event.type === "StepCompleted") {
                    return event.data.output as T;
                } else {
                    const stepErr = event.data.error;
                    throw typeof stepErr === "string" ? new Error(stepErr) : (stepErr || new Error("Step execution failed"));
                }
            } else {
                // LIVE mode. 
                if (this.executionMode === "resume") {
                    // Halting to schedule step
                    this.command = { command_type: "ScheduleStep", step_id: id, options };
                    // Suspend execution by throwing a specialized Yield error
                    throw new Error("YIELD");
                } else if (this.executionMode === "execute_step") {
                    if (id === this.targetStepId) {
                        // This is the target closure! Execute the real side effect.
                        const result = await fn();
                        this.command = { status: "success", output: result };
                        throw new Error("YIELD");
                    } else {
                        // This shouldn't happen unless execute_step provided the wrong history
                        throw new DeterminismViolation(`Reached unexpected live step ${id} while seeking target ${this.targetStepId}`);
                    }
                }
                throw new Error("YIELD");
            }
        }
    };

    child = {
        run: async <T>(id: string, name: string, version: number, input: any, options?: ChildWorkflowOptions): Promise<T> => {
            if (this.executedStepIds.has(id)) {
                throw new DeterminismViolation(`Duplicate child invocation ID: ${id}`);
            }
            this.executedStepIds.add(id);

            const operationId = id;
            
            const event = this.consumeEvent(["ChildWorkflowCompleted", "ChildWorkflowFailed"], operationId);

            if (event) {
                if (event.type === "ChildWorkflowCompleted") {
                    return event.data.output as T;
                } else {
                    throw event.data.error;
                }
            } else {
                if (this.executionMode === "resume") {
                    this.command = { command_type: "ScheduleChildWorkflow", workflow_name: name, workflow_version: version, input, operation_id: operationId };
                    throw new Error("YIELD");
                } else {
                    // In execute_step mode, we shouldn't reach here if we are just seeking a step
                    throw new DeterminismViolation(`Reached unexpected live child workflow invocation ${name}@${version}`);
                }
            }
        }
    };

    now(): number {
        const event = this.consumeEvent(["TimestampRecorded"]);
        if (event) return event.data.value;

        this.command = { command_type: "RecordTimestamp" };
        throw new Error("YIELD");
    }

    random(): number {
        const event = this.consumeEvent(["RandomRecorded"]);
        if (event) return event.data.value;

        this.command = { command_type: "RecordRandom" };
        throw new Error("YIELD");
    }

    async sleep(duration: string | number): Promise<void> {
        // stub for Phase 2
        throw new Error("Not implemented in Phase 1");
    }

    async waitForSignal(name: string, options?: any): Promise<any> {
        // stub for Phase 2
        throw new Error("Not implemented in Phase 1");
    }
}

export class WorkflowEngine {
    private registry = new Map<string, WorkflowDefinition>();

    register(workflow: WorkflowDefinition) {
        this.registry.set(`${workflow.name}@${workflow.version}`, workflow);
    }

    async resumeWorkflow(
        name: string,
        version: number,
        input: any,
        history: SemanticEvent[],
        runId: string = "",
        stateRequestFn: ((payload: object) => Promise<any>) | null = null
    ): Promise<any> {
        const wf = this.registry.get(`${name}@${version}`);
        if (!wf) throw new VersionMismatchError(`Workflow ${name} at version ${version} not found in worker registry.`);

        const ctx = new ContextImpl(history, "resume", undefined, stateRequestFn, runId);
        try {
            const output = await wf.fn(ctx, input);
            return { command_type: "CompleteWorkflow", output };
        } catch (e: any) {
            if (e.message === "YIELD" && ctx.command) {
                return ctx.command;
            }
            if (e instanceof DeterminismViolation) {
                return { 
                    command_type: "FailWorkflow", 
                    error: { 
                        type: "DETERMINISM_VIOLATION",
                        message: e.message, 
                        details: [{ field: "history", message: "Determinism violation during replay" }] 
                    } 
                };
            }
            if (e instanceof VersionMismatchError) {
                return {
                    command_type: "FailWorkflow",
                    error: {
                        type: "VERSION_MISMATCH",
                        message: e.message,
                        details: []
                    }
                };
            }
            const errorMsg = typeof e === "string" ? e : (e?.message || String(e) || "Workflow execution failed");
            return { 
                command_type: "FailWorkflow", 
                error: { 
                    type: "EXECUTION_ERROR",
                    message: errorMsg,
                    details: []
                } 
            };
        }
    }

    async executeStep(
        name: string,
        version: number,
        input: any,
        history: SemanticEvent[],
        targetStepId: string,
        runId: string = "",
        stateRequestFn: ((payload: object) => Promise<any>) | null = null
    ): Promise<any> {
        const wf = this.registry.get(`${name}@${version}`);
        if (!wf) throw new VersionMismatchError(`Workflow ${name} at version ${version} not found in worker registry.`);

        const ctx = new ContextImpl(history, "execute_step", targetStepId, stateRequestFn, runId);
        try {
            await wf.fn(ctx, input);
            // If the workflow finishes without hitting the target step, it's an error.
            return { 
                status: "failure", 
                error: { 
                    type: "STEP_NOT_FOUND",
                    message: "StepNotFoundError", 
                    details: []
                } 
            };
        } catch (e: any) {
            if (e.message === "YIELD" && ctx.command) {
                return ctx.command;
            }
            if (e instanceof VersionMismatchError) {
                return {
                    status: "failure",
                    error: {
                        type: "VERSION_MISMATCH",
                        message: e.message,
                        details: []
                    }
                };
            }
            return { 
                status: "failure", 
                error: { 
                    type: "STEP_EXECUTION_ERROR",
                    message: e.message,
                    details: []
                } 
            };
        }
    }
}
