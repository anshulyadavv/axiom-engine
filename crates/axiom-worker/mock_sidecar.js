
        const { engine, startWorkerLoop } = require("../../packages/sdk/dist/index.js");
        const { startWorkerLoop: loopStart } = require("../../packages/sdk/dist/worker.js");
        
        // Register a test flow
        engine.register({
            name: "test-flow",
            version: 1,
            fn: async (ctx, input) => {
                const s1 = await ctx.step.run("step-1", async () => "S1");
                const s2 = await ctx.step.run("step-2", async () => "S2");
                const s3 = await ctx.step.run("step-3", async () => "S3");
                return { s1, s2, s3 };
            }
        });
        
        loopStart();
    