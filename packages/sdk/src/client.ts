import axios, { AxiosInstance } from "axios";

export interface AxiomClientOptions {
    baseUrl: string;
    apiKey: string;
}

export class AxiomClient {
    private api: AxiosInstance;

    constructor(options: AxiomClientOptions) {
        this.api = axios.create({
            baseURL: options.baseUrl,
            headers: {
                "Authorization": `Bearer ${options.apiKey}`,
                "Content-Type": "application/json",
            }
        });
    }

    async registerWorkflow(definition: { name: string, version: number }): Promise<any> {
        const response = await this.api.post("/v1/workflows", definition);
        return response.data;
    }

    async startRun(workflowId: string, input: any): Promise<{ id: string }> {
        const response = await this.api.post(`/v1/workflows/${workflowId}/runs`, { input });
        return response.data;
    }

    async getRun(runId: string): Promise<any> {
        const response = await this.api.get(`/v1/runs/${runId}`);
        return response.data;
    }
}
