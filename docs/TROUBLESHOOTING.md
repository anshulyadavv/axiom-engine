# Troubleshooting Guide

## Database Connection Failures
**Symptom**: Services crash on boot or log massive `PoolTimedOut` errors.
**Resolution**: Verify `DATABASE_URL` is correct. Check network policies (Kubernetes) or Security Groups (AWS). Ensure connection limits are not exhausted (default max pool size is 50).

## NATS Connectivity
**Symptom**: Workflow runs are stuck in `pending` and never reach a worker. Log shows `Failed to connect to NATS`.
**Resolution**: Check `NATS_URL`. Validate that the NATS server has JetStream explicitly enabled (`-js` flag).

## Workflow Version Mismatch
**Symptom**: Errors relating to `Step execution failed` during replay or worker logs indicating `workflow_version mismatch`.
**Resolution**: Check that you are not mutating the logic of a previously registered version. If you updated the workflow code, you MUST bump the version string in `ctx.workflow` registration.

## Failed Steps
**Symptom**: Workflow execution halts, or status shows `failed`.
**Resolution**: Look at the run detail in the Dashboard. Find the failing step in the Execution Timeline. Check the raw `SemanticHistory` for the explicit `StepFailed` error trace. Determine if it was an intermittent external API error or a code logic bug. 

## Child Workflow Waiting/Failure
**Symptom**: Parent workflow blocks forever.
**Resolution**: Ensure the child workflow was actually started (check parent's Timeline for `ChildWorkflowStarted`). Drill into the child run via the Dashboard. If the child failed, verify the parent TS sidecar has a `try/catch` block wrapping `ctx.child()`. 

## Authentication and Tenant Access Failures
**Symptom**: API returns `401 Unauthorized` or `404 Not Found`.
**Resolution**: Ensure `Authorization: Bearer <API_KEY>` is set. Axiom strictly isolates resources by `tenant_id`. You cannot fetch another tenant's runs even if you possess their Run ID.

## Worker Restart and Recovery
**Symptom**: Runs appear paused for a long time.
**Resolution**: Did a worker crash? The lease timeout is ~15 seconds. If runs do not recover after 30-45 seconds, ensure that there is at least one healthy worker container running and connected to NATS/Postgres.
