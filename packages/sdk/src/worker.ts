import * as readline from "readline";
import { engine } from "./index";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
});

/**
 * Pending state_result resolvers keyed by correlation_id.
 * When Rust replies to a state_request, we look up the resolve callback and fulfill it.
 */
const pendingStateRequests = new Map<string, (result: any) => void>();

/**
 * Queue of incoming lines that arrived while workflow code was executing.
 * Lines that are not state_result messages are queued here for the main loop.
 */
const lineQueue: string[] = [];

/**
 * Returns a stateRequestFn for the given correlation context.
 * This function sends a state_request to Rust via stdout and returns a Promise
 * that resolves when Rust replies with the matching state_result via stdin.
 */
function makeStateRequestFn(sendLine: (line: string) => void): (payload: object) => Promise<any> {
    return async (payload: object): Promise<any> => {
        const correlationId = Math.random().toString(36).slice(2);
        const message = JSON.stringify({
            type: "state_request",
            correlation_id: correlationId,
            payload
        });
        return new Promise<any>((resolve) => {
            pendingStateRequests.set(correlationId, resolve);
            sendLine(message);
        });
    };
}

function sendLine(line: string): void {
    process.stdout.write(line + "\n");
}

export function startWorkerLoop() {
    rl.on("line", async (line) => {
        if (!line.trim()) return;

        let message;
        try {
            message = JSON.parse(line);
        } catch (e) {
            console.error("Failed to parse IPC message:", line);
            return;
        }

        const { type, correlation_id, payload } = message;

        // State results are routed to the pending request resolver, not the main handler.
        if (type === "state_result") {
            const resolve = pendingStateRequests.get(correlation_id);
            if (resolve) {
                pendingStateRequests.delete(correlation_id);
                resolve(payload);
            } else {
                console.error(`Received state_result for unknown correlation_id: ${correlation_id}`);
            }
            return;
        }

        const stateRequestFn = makeStateRequestFn(sendLine);

        try {
            if (type === "resume_workflow") {
                const runId: string = payload.run_id?.id ?? payload.run_id ?? "";
                const result = await engine.resumeWorkflow(
                    payload.workflow_name,
                    payload.workflow_version,
                    payload.input,
                    payload.history,
                    runId,
                    stateRequestFn
                );

                process.stdout.write(JSON.stringify({
                    type: "command",
                    correlation_id,
                    payload: result
                }) + "\n");
            } 
            else if (type === "execute_step") {
                const runId: string = payload.run_id?.id ?? payload.run_id ?? "";
                const result = await engine.executeStep(
                    payload.workflow_name,
                    payload.workflow_version,
                    payload.input,
                    payload.history,
                    payload.step_id,
                    runId,
                    stateRequestFn
                );

                process.stdout.write(JSON.stringify({
                    type: "step_result",
                    correlation_id,
                    payload: result
                }) + "\n");
            }
            else {
                console.error(`Unknown IPC message type: ${type}`);
            }
        } catch (e: any) {
            // Unhandled error in the sidecar itself
            process.stdout.write(JSON.stringify({
                type: "command",
                correlation_id,
                payload: {
                    command_type: "FailWorkflow",
                    error: { 
                        code: "INTERNAL_ERROR",
                        message: e.message || "Internal Sidecar Error",
                        details: [] 
                    }
                }
            }) + "\n");
        }
    });

    console.error("Axiom TS Sidecar started. Listening on stdin.");
}
