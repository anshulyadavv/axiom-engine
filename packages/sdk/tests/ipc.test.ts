import { spawn } from "child_process";
import * as path from "path";
import * as readline from "readline";

describe("IPC Protocol E2E Contract", () => {
    jest.setTimeout(20000);
    let child: any;
    let rl: readline.Interface;
    let responses: string[] = [];
    let resolveNextResponse: ((line: string) => void) | null = null;

    beforeAll(() => {
        // Run the actual built app entrypoint
        child = spawn("node", [path.join(__dirname, "../dist/app.js")], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        rl = readline.createInterface({
            input: child.stdout,
            terminal: false,
        });

        rl.on("line", (line) => {
            if (resolveNextResponse) {
                const r = resolveNextResponse;
                resolveNextResponse = null;
                r(line);
            } else {
                responses.push(line);
            }
        });
    });

    afterAll(() => {
        child.kill();
    });

    const sendAndReceive = async (message: any): Promise<any> => {
        return new Promise((resolve) => {
            if (responses.length > 0) {
                resolve(JSON.parse(responses.shift()!));
            } else {
                resolveNextResponse = (line) => resolve(JSON.parse(line));
            }
            child.stdin.write(JSON.stringify(message) + "\n");
        });
    };

    it("A. resume_workflow with empty history -> ScheduleStep", async () => {
        const res = await sendAndReceive({
            type: "resume_workflow",
            correlation_id: "corr-1",
            payload: {
                run_id: "run-1",
                workflow_name: "test-flow",
                workflow_version: 1,
                input: {},
                history: []
            }
        });
        expect(res.correlation_id).toBe("corr-1");
        expect(res.type).toBe("command");
        expect(res.payload.command_type).toBe("ScheduleStep");
        expect(res.payload.step_id).toBe("step1");
    });

    it("B. execute_step for that step -> step_result success", async () => {
        const res = await sendAndReceive({
            type: "execute_step",
            correlation_id: "corr-2",
            payload: {
                run_id: "run-1",
                step_id: "step1",
                attempt: 1,
                workflow_name: "test-flow",
                workflow_version: 1,
                input: {},
                history: []
            }
        });
        expect(res.correlation_id).toBe("corr-2");
        expect(res.type).toBe("step_result");
        expect(res.payload.status).toBe("success");
        expect(res.payload.output).toBe("A");
    });

    it("C. resume_workflow with WorkflowStarted + StepCompleted(A) -> ScheduleStep(B)", async () => {
        const history = [
            { type: "WorkflowStarted", sequence_number: 1, data: { input: {} } },
            { type: "StepCompleted", sequence_number: 2, data: { id: "step1", output: "A" } }
        ];
        const res = await sendAndReceive({
            type: "resume_workflow",
            correlation_id: "corr-3",
            payload: {
                run_id: "run-1",
                workflow_name: "test-flow",
                workflow_version: 1,
                input: {},
                history
            }
        });
        expect(res.correlation_id).toBe("corr-3");
        expect(res.type).toBe("command");
        expect(res.payload.command_type).toBe("ScheduleStep");
        expect(res.payload.step_id).toBe("step2");
    });

    it("D. resume_workflow with completed A+B+C -> CompleteWorkflow", async () => {
        const history = [
            { type: "WorkflowStarted", sequence_number: 1, data: { input: {} } },
            { type: "StepCompleted", sequence_number: 2, data: { id: "step1", output: "A" } },
            { type: "StepCompleted", sequence_number: 3, data: { id: "step2", output: "AB" } },
            { type: "StepCompleted", sequence_number: 4, data: { id: "step3", output: "ABC" } }
        ];
        const res = await sendAndReceive({
            type: "resume_workflow",
            correlation_id: "corr-4",
            payload: {
                run_id: "run-1",
                workflow_name: "test-flow",
                workflow_version: 1,
                input: {},
                history
            }
        });
        expect(res.correlation_id).toBe("corr-4");
        expect(res.type).toBe("command");
        expect(res.payload.command_type).toBe("CompleteWorkflow");
        expect(res.payload.output).toBe("ABC");
    });

    it("E. wrong workflow_name -> FailWorkflow", async () => {
        const res = await sendAndReceive({
            type: "resume_workflow",
            correlation_id: "corr-5",
            payload: {
                run_id: "run-1",
                workflow_name: "bad-flow",
                workflow_version: 1,
                input: {},
                history: []
            }
        });
        expect(res.correlation_id).toBe("corr-5");
        expect(res.type).toBe("command");
        expect(res.payload.command_type).toBe("FailWorkflow");
        expect(res.payload.error.message).toContain("not found");
    });

    it("F. incompatible workflow_version -> FailWorkflow", async () => {
        const res = await sendAndReceive({
            type: "resume_workflow",
            correlation_id: "corr-6",
            payload: {
                run_id: "run-1",
                workflow_name: "test-flow",
                workflow_version: 999,
                input: {},
                history: []
            }
        });
        expect(res.correlation_id).toBe("corr-6");
        expect(res.type).toBe("command");
        expect(res.payload.command_type).toBe("FailWorkflow");
        expect(res.payload.error.message).toContain("Workflow test-flow at version 999 not found");
    });

    it("G. duplicate step ID -> DeterminismViolation / FailWorkflow", async () => {
        // Intentionally provide a history where step1 completed, but then provide another step1
        const history = [
            { type: "WorkflowStarted", sequence_number: 1, data: { input: {} } },
            { type: "StepCompleted", sequence_number: 2, data: { id: "step1", output: "A" } },
            { type: "StepCompleted", sequence_number: 3, data: { id: "step1", output: "A" } }
        ];
        const res = await sendAndReceive({
            type: "resume_workflow",
            correlation_id: "corr-7",
            payload: {
                run_id: "run-1",
                workflow_name: "test-flow",
                workflow_version: 1,
                input: {},
                history
            }
        });
        expect(res.correlation_id).toBe("corr-7");
        expect(res.type).toBe("command");
        expect(res.payload.command_type).toBe("FailWorkflow");
        expect(res.payload.error.type).toBe("DETERMINISM_VIOLATION");
        expect(res.payload.error.message).toContain("Replay mismatch");
    });
});