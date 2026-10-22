# Axiom Engine — Research

## Research Question

> How can a Workflows-as-Code runtime provide durable execution and
> deterministic replay under crash and distributed-worker failure?

## Planned Experiments

### Experiment 1: Recovery Latency

Measure time from worker crash to workflow resumption.

Variables:
- Event history length (10, 100, 1000, 10000 events)
- Number of concurrent workflows recovering
- Database load

### Experiment 2: Replay Overhead

Measure the overhead of replay vs direct execution.

Variables:
- Number of completed steps to replay
- Step output size
- History serialization format

### Experiment 3: Execution Strategy Comparison

Compare three execution strategies:

| Strategy | Description |
|----------|-------------|
| A. Naive retry | Re-execute entire workflow from scratch |
| B. Checkpoint-based | Serialize full workflow state at checkpoints |
| C. Event history replay | Replay from append-only event log (Axiom's approach) |

Measure:
- Recovery latency
- Storage overhead
- Throughput
- Correctness under failure
- Duplicate execution rate

### Experiment 4: Timer Recovery

Measure timer accuracy after scheduler restart.

Variables:
- Number of pending timers
- Timer due time distribution
- Scheduler downtime duration

### Experiment 5: Duplicate Execution Behavior

Measure how often steps are unnecessarily re-executed under various failure
scenarios.

Variables:
- Failure injection rate
- Failure timing (before/during/after step)
- NATS message duplication rate

## Methodology

- All experiments will use reproducible benchmarks.
- Each experiment will document: hypothesis, setup, procedure, results,
  analysis.
- Raw data will be stored in `/docs/research/data/`.
- Results will not be manufactured. If a result is unexpected, it will be
  documented and investigated.
