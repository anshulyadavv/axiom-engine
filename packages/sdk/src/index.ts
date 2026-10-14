import { WorkflowEngine } from "./engine";

const engine = new WorkflowEngine();

// Very simple worker sidecar implementation
async function startWorker() {
    console.log("Axiom sidecar started.");
    
    // In a real worker, this would read from stdin/stdout continuously.
    // For now, we will expose the engine to allow testing.
    return engine;
}

export { engine, startWorker };
export * from "./types";
export * from "./engine";
export * from "./client";
export * from "./ai/types";
export * from "./ai/agent";

