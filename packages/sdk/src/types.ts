// Type definitions for Axiom SDK
export type StepOptions = {
    idempotencyKey?: string;
    timeoutMs?: number;
    // other retry configs deferred
};

export interface ChildWorkflowOptions {
    // any future child options (e.g. timeout)
}

export interface WorkflowContext<TInput = any> {
    step: {
        run<T>(id: string, fn: () => Promise<T>, options?: StepOptions): Promise<T>;
    };
    child: {
        run<T>(id: string, name: string, version: number, input: any, options?: ChildWorkflowOptions): Promise<T>;
    };
    /** Durable workflow-local state. Scoped to this run. Survives worker reassignment. */
    state: {
        /** Get the current value for a key. Returns undefined if not set. */
        get<T = unknown>(key: string): Promise<T | undefined>;
        /** Atomically upsert a value. Replay-safe: idempotent at DB level. */
        set<T = unknown>(key: string, value: T): Promise<void>;
        /** Delete a key. Idempotent: does not throw if absent. */
        delete(key: string): Promise<void>;
    };
    now(): number;
    random(): number;
    sleep(duration: string | number): Promise<void>;
    waitForSignal(name: string, options?: any): Promise<any>;
}

export type WorkflowFunction<TInput = any, TOutput = any> = (
    ctx: WorkflowContext<TInput>,
    input: TInput
) => Promise<TOutput>;

export interface WorkflowDefinition<TInput = any, TOutput = any> {
    name: string;
    version: number;
    fn: WorkflowFunction<TInput, TOutput>;
}

export function workflow<TInput, TOutput>(
    name: string,
    version: number,
    fn: WorkflowFunction<TInput, TOutput>
): WorkflowDefinition<TInput, TOutput> {
    return { name, version, fn };
}
