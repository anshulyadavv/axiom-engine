import { engine } from "./index";
import { workflow } from "./types";
import { startWorkerLoop } from "./worker";

// MVP 3-step workflow
const mvpFlow = workflow<any, any>("test-flow", 1, async (ctx, input) => {
    // step1 -> returns "A"
    const step1Result = await ctx.step.run("step1", async () => {
        return "A";
    });

    // step2 -> consumes step1 and returns "B"
    const step2Result = await ctx.step.run("step2", async () => {
        return step1Result + "B";
    });

    // step3 -> consumes step2 and returns "C"
    const step3Result = await ctx.step.run("step3", async () => {
        return step2Result + "C";
    });

    return step3Result;
});

engine.register(mvpFlow);
startWorkerLoop();
