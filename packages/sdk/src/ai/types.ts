export interface IncidentAlertInput {
    incidentId: string;
    alertType: "HighLatency" | "WorkerHeartbeatMissed" | "RunFailureRateHigh" | "DatabaseConnectionPoolExhausted" | "StepTimeout";
    serviceName: string;
    errorSnippet: string;
    runId?: string;
}

export interface SystemHealthContext {
    postgresStatus: "healthy" | "degraded" | "down";
    natsQueueDepth: number;
    redisCacheStatus: "connected" | "unavailable";
    activeWorkersCount: number;
}

export interface IncidentClassification {
    rootCauseCategory: "InfraExhaustion" | "NetworkPartition" | "CodeRegression" | "UpstreamDependencyTimeout";
    severity: "P1" | "P2" | "P3" | "P4";
    confidenceScore: number;
    explanation: string;
}

export interface MitigationPlan {
    actionType: "ScaleWorkers" | "FailoverDatabase" | "RestartWorkerService" | "PurgeStaleLeases" | "ThrottleRateLimit";
    runbookSteps: string[];
    automatedActionRecommended: boolean;
}

export interface AgentTelemetry {
    provider: string;
    modelName: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    modelLatencyMs: number;
    toolsExecuted: string[];
}

export interface TriageAgentResult {
    incidentId: string;
    status: "TRIAGED" | "MITIGATED" | "ESCALATED";
    systemHealth: SystemHealthContext;
    classification: IncidentClassification;
    mitigation: MitigationPlan;
    telemetry: AgentTelemetry;
    triagedAt: string;
}
