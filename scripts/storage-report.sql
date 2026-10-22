-- storage-report.sql
-- Reports storage growth for Axiom Engine

SELECT
    (SELECT count(*) FROM workflows) AS workflows_count,
    (SELECT count(*) FROM workflow_runs) AS runs_count,
    (SELECT count(*) FROM step_executions) AS steps_count,
    (SELECT count(*) FROM events) AS events_count,
    (SELECT count(*) FROM workflow_run_state) AS state_count,
    (SELECT count(*) FROM outbox_messages) AS outbox_count,
    pg_size_pretty(pg_database_size('axiom_engine')) AS total_db_size;
