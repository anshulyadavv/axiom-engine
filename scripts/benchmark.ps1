param(
    [string]$Command = "help",
    [string]$ApiUrl = "http://localhost:3000/v1",
    [string]$ApiKey = "axm_live_dummykey",
    [int]$Runs = 20,
    [int]$Trials = 1,
    [int]$Concurrency = 10,
    [int]$WorkerCount = 1,
    [int]$PollIntervalMs = 0,
    [int]$LeaseTtlMs = 5000,
    [int]$WarmupRuns = 5,
    [string]$LogFile = "worker_throughput.log",
    [switch]$Collect,
    [string]$CollectMode = "steady",
    [switch]$SleepAlways,
    [switch]$SaveResults
)

Add-Type -AssemblyName System.Net.Http

$Headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type"  = "application/json"
}

# Ensure results directory exists
$ResultsDir = Join-Path $PSScriptRoot "..\benchmarks\results"
if (-not (Test-Path $ResultsDir)) {
    New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null
}

function Get-BenchmarkMetadata {
    param(
        [string]$CommandStr,
        [int]$SampleCount,
        [int]$WarmupCount = 0
    )
    $gitCommit = (& git rev-parse HEAD 2>$null).Trim()
    $statusPorcelain = (& git status --porcelain 2>$null | Out-String).Trim()
    $gitDirty = [bool]$statusPorcelain
    if ($gitDirty) {
        $diffText = (& git diff HEAD 2>$null | Out-String)
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($diffText)
        $hashBytes = $hasher.ComputeHash($bytes)
        $gitDiffHash = -join ($hashBytes | ForEach-Object { "{0:x2}" -f $_ })
    } else {
        $gitDiffHash = $null
    }

    return [ordered]@{
        git_commit = $gitCommit
        git_dirty = $gitDirty
        git_diff_hash = $gitDiffHash
        date = (Get-Date).ToString("o")
        command = $CommandStr
        sample_count = $SampleCount
        warmup_count = $WarmupCount
        hardware = [ordered]@{
            cpu = "Intel(R) Core(TM) i3-1005G1 CPU @ 1.20GHz (2 physical cores, 4 logical processors)"
            ram = "7.80 GB (8,375,230,464 bytes)"
            os = "Microsoft Windows 10 Pro (Version 10.0.19045, Build 19045)"
        }
        dependencies = [ordered]@{
            postgres_version = "PostgreSQL 15.19 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit (local Docker Compose; CI uses postgres:16)"
            nats_version = "nats-server: v2.10.29 (Docker)"
        }
    }
}

function Ensure-BenchmarkWorkflow {
    param($Url, $AuthHeaders)
    try {
        $listRes = Invoke-RestMethod -Uri "$Url/workflows?name=benchmark_workflow" -Method Get -Headers $AuthHeaders -ErrorAction Stop
        if ($listRes.data -and $listRes.data.Count -gt 0) {
            return $listRes.data[0].id
        }
    } catch {}

    # Register workflow
    $body = @{
        name = "benchmark_workflow"
        version = 1
        description = "Synthetic workflow for benchmark measurements"
    } | ConvertTo-Json
    $regRes = Invoke-RestMethod -Uri "$Url/workflows" -Method Post -Headers $AuthHeaders -Body $body -ErrorAction Stop
    return $regRes.data.id
}

function Ensure-CrashRecoveryWorkflow {
    param($Url, $AuthHeaders)
    try {
        $listRes = Invoke-RestMethod -Uri "$Url/workflows?name=crash_recovery_workflow" -Method Get -Headers $AuthHeaders -ErrorAction Stop
        if ($listRes.data -and $listRes.data.Count -gt 0) {
            return $listRes.data[0].id
        }
    } catch {}

    # Register workflow
    try {
        $body = @{
            name = "crash_recovery_workflow"
            version = 1
            description = "3-step crash recovery workflow asserting completed steps are not re-executed"
        } | ConvertTo-Json
        $regRes = Invoke-RestMethod -Uri "$Url/workflows" -Method Post -Headers $AuthHeaders -Body $body -ErrorAction Stop
        return $regRes.data.id
    } catch {
        Write-Error "Failed to connect to API at $Url. Is axiom-api running?"
        return $null
    }
}

switch ($Command) {
    "startup" {
        Write-Host "Measuring Workflow Startup Latency..."
        $wfId = Ensure-BenchmarkWorkflow -Url $ApiUrl -AuthHeaders $Headers
        $Start = Get-Date
        $Response = Invoke-RestMethod -Uri "$ApiUrl/workflows/$wfId/runs" -Method Post -Headers $Headers -Body '{}' -ErrorAction Stop
        $End = Get-Date
        $Elapsed = ($End - $Start).TotalMilliseconds
        Write-Host "Started Run ID: $($Response.data.id)"
        Write-Host "Startup Latency: $Elapsed ms"
    }

    { $_ -in "throughput", "api-throughput" } {
        Write-Host "=========================================================="
        Write-Host " Axiom Engine: Run-Creation Requests Accepted Per Second (API Only)"
        Write-Host " NOTE: Measures REST API request acceptance only; does NOT measure workflow completion."
        Write-Host " Launches $Runs run-creation requests with concurrency $Concurrency"
        Write-Host "=========================================================="

        $wfId = Ensure-BenchmarkWorkflow -Url $ApiUrl -AuthHeaders $Headers
        Write-Host "Benchmark workflow UUID: $wfId"

        $runnerJs = @"
const http = require('http');
const { URL } = require('url');

const agent = new http.Agent({ keepAlive: true, maxSockets: $Concurrency });
const url = new URL('$ApiUrl/workflows/$wfId/runs');

async function run() {
    const queue = Array.from({ length: $Runs }, (_, i) => i);
    const latencies = [];
    const runIds = [];
    let errorCount = 0;
    const totalStart = Date.now();

    async function worker() {
        while (queue.length > 0) {
            const i = queue.shift();
            const start = Date.now();
            await new Promise((resolve) => {
                const req = http.request({
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    method: 'POST',
                    agent: agent,
                    headers: {
                        'Authorization': 'Bearer $ApiKey',
                        'Content-Type': 'application/json'
                    }
                }, (res) => {
                    let d = '';
                    res.on('data', chunk => d += chunk);
                    res.on('end', () => {
                        const dur = Date.now() - start;
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            latencies.push(dur);
                            try {
                                const json = JSON.parse(d);
                                runIds.push(json.data.id);
                            } catch (_) {}
                        } else {
                            errorCount++;
                        }
                        resolve();
                    });
                });
                req.on('error', (err) => {
                    errorCount++;
                    resolve();
                });
                req.write('{}');
                req.end();
            });
        }
    }

    const workers = Array.from({ length: $Concurrency }, () => worker());
    await Promise.all(workers);
    const totalDurationSec = (Date.now() - totalStart) / 1000;
    const throughput = latencies.length / totalDurationSec;

    latencies.sort((a, b) => a - b);
    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = latencies.length > 0 ? sum / latencies.length : 0;
    const min = latencies.length > 0 ? latencies[0] : 0;
    const max = latencies.length > 0 ? latencies[latencies.length - 1] : 0;
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.50)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
    const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;

    const result = {
        experiment: "run-creation requests accepted per second (API only)",
        note: "Explicitly measures API run-creation requests accepted per second; does NOT measure workflow completion.",
        timestamp: new Date().toISOString(),
        command: 'powershell -File scripts/benchmark.ps1 -Command throughput -Runs $Runs -Concurrency $Concurrency',
        target_requests: $Runs,
        concurrency: $Concurrency,
        accepted_requests: latencies.length,
        error_count: errorCount,
        total_duration_sec: totalDurationSec,
        run_creation_requests_accepted_per_sec: throughput,
        latency_avg_ms: avg,
        latency_min_ms: min,
        latency_p50_ms: p50,
        latency_p95_ms: p95,
        latency_p99_ms: p99,
        latency_max_ms: max,
        raw_latencies_ms: latencies
    };

    console.log(JSON.stringify(result));
}

run();
"@

        $numTrials = [Math]::Max($Trials, 1)
        $trialThroughputs = New-Object System.Collections.Generic.List[double]
        $trialErrors = New-Object System.Collections.Generic.List[int]
        $trialAccepted = New-Object System.Collections.Generic.List[int]
        $trialResults = @()

        $tmpThroughputJs = Join-Path $PSScriptRoot "throughput_runner.tmp.js"
        Set-Content -Path $tmpThroughputJs -Value $runnerJs -Encoding UTF8
        try {
            for ($t = 1; $t -le $numTrials; $t++) {
                if ($numTrials -gt 1) {
                    Write-Host "`n--- Trial $t of $numTrials ---"
                }
                $jsonOut = node $tmpThroughputJs
                $resultObj = $jsonOut | ConvertFrom-Json
                $trialThroughputs.Add($resultObj.run_creation_requests_accepted_per_sec)
                $trialErrors.Add([int]$resultObj.error_count)
                $trialAccepted.Add([int]$resultObj.accepted_requests)
                $trialResults += $resultObj

                Write-Host "Accepted Requests: $($resultObj.accepted_requests)/$Runs (Errors: $($resultObj.error_count))"
                Write-Host "Total Duration: $($resultObj.total_duration_sec.ToString("0.000")) s"
                Write-Host "Run-creation requests accepted per second (API only): $($resultObj.run_creation_requests_accepted_per_sec.ToString("0.00")) req/sec"
                Write-Host "NOTE: This does NOT measure workflow completion."
                Write-Host "Latency (ms): Min=$($resultObj.latency_min_ms.ToString("0.00")) | Avg=$($resultObj.latency_avg_ms.ToString("0.00")) | p50=$($resultObj.latency_p50_ms.ToString("0.00")) | p95=$($resultObj.latency_p95_ms.ToString("0.00")) | p99=$($resultObj.latency_p99_ms.ToString("0.00")) | Max=$($resultObj.latency_max_ms.ToString("0.00"))"
            }

            if ($numTrials -gt 1) {
                $sortedTp = $trialThroughputs | Sort-Object
                $tpMin = $sortedTp[0]
                $tpMax = $sortedTp[-1]
                $tpMid = [Math]::Floor($sortedTp.Count / 2)
                $tpMed = if ($sortedTp.Count % 2 -eq 0) { ($sortedTp[$tpMid - 1] + $sortedTp[$tpMid]) / 2 } else { $sortedTp[$tpMid] }

                $sortedErr = $trialErrors | Sort-Object
                $errMin = $sortedErr[0]
                $errMax = $sortedErr[-1]
                $errMid = [Math]::Floor($sortedErr.Count / 2)
                $errMed = if ($sortedErr.Count % 2 -eq 0) { ($sortedErr[$errMid - 1] + $sortedErr[$errMid]) / 2 } else { $sortedErr[$errMid] }

                Write-Host "`n=========================================================="
                Write-Host " Throughput Summary Across $numTrials Trials"
                Write-Host "=========================================================="
                Write-Host "Run-creation requests accepted per second (API only):"
                Write-Host "  Min:    $($tpMin.ToString('0.00')) req/sec"
                Write-Host "  Median: $($tpMed.ToString('0.00')) req/sec"
                Write-Host "  Max:    $($tpMax.ToString('0.00')) req/sec"
                Write-Host "Error count (429s):"
                Write-Host "  Min:    $errMin"
                Write-Host "  Median: $errMed"
                Write-Host "  Max:    $errMax"
                Write-Host "=========================================================="
            }

            if ($SaveResults) {
                $outFile = Join-Path $ResultsDir "throughput.json"
                $resultObj | ConvertTo-Json -Depth 5 | Set-Content -Path $outFile -Encoding UTF8
                Write-Host "Raw output saved to: $outFile"
            }
        } finally {
            Remove-Item $tmpThroughputJs -Force -ErrorAction SilentlyContinue
        }
    }

    "e2e-throughput" {
        $numTrials = [Math]::Max($Trials, 1)
        $pollMs = if ($PollIntervalMs -gt 0) { $PollIntervalMs } elseif ($env:AXIOM_SCHEDULER_POLL_MS) { [int]$env:AXIOM_SCHEDULER_POLL_MS } else { 2000 }
        $sleepAlwaysVal = if ($SleepAlways -or ($env:AXIOM_SCHEDULER_SLEEP_ALWAYS -eq "1")) { "1" } else { "0" }

        Write-Host "=========================================================="
        Write-Host " Axiom Engine: End-to-End Workflow Completion Throughput"
        Write-Host " Submitting $Runs runs of the 3-step workflow and measuring wall-clock until all reach Completed"
        Write-Host " Trials: $numTrials | Worker Count: $WorkerCount | Scheduler Poll: $pollMs ms"
        Write-Host " Scheduler Mode: $(if ($sleepAlwaysVal -eq '1') { 'AXIOM_SCHEDULER_SLEEP_ALWAYS=1 (unconditional sleep)' } else { 'Default (repoll immediately on work)' })"
        Write-Host "=========================================================="

        $wfId = Ensure-CrashRecoveryWorkflow -Url $ApiUrl -AuthHeaders $Headers
        if (-not $wfId) {
            Write-Error "Could not resolve 3-step workflow. Is axiom-api running at $ApiUrl?"
            return
        }

        # Helper to reset state in database
        function Reset-BenchmarkDbState {
            & docker exec docker-postgres-1 psql -U axiom -d axiom_engine -c "UPDATE workflow_runs SET status = 'cancelled' WHERE status IN ('pending', 'running'); DELETE FROM outbox_messages;" | Out-Null
        }

        $dbUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgres://axiom:password@localhost:5432/axiom_engine" }
        $natsUrl = if ($env:NATS_URL) { $env:NATS_URL } else { "nats://localhost:4222" }
        $workerBin = Join-Path $PSScriptRoot "..\target\debug\axiom-worker.exe"
        if (-not (Test-Path $workerBin)) {
            Write-Host "Compiling axiom-worker..."
            cargo build --bin axiom-worker | Out-Null
        }

        # Stop any existing workers to ensure isolated environment
        Get-Process -Name "axiom-worker" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500

        $env:DATABASE_URL = $dbUrl
        $env:NATS_URL = $natsUrl
        $env:SIDECAR_PATH = "packages/sdk/dist/app.js"
        $env:AXIOM_SCHEDULER_POLL_MS = $pollMs.ToString()
        $env:AXIOM_SCHEDULER_SLEEP_ALWAYS = $sleepAlwaysVal
        $env:AXIOM_PROMETHEUS_PORT = "9005"

        $workerLog = Join-Path $PSScriptRoot "worker_e2e.log"
        $workerErr = Join-Path $PSScriptRoot "worker_e2e.err"
        Remove-Item $workerLog, $workerErr -Force -ErrorAction SilentlyContinue

        Write-Host "Starting $WorkerCount managed worker process(es)..."
        $workerProcs = @()
        for ($w = 0; $w -lt $WorkerCount; $w++) {
            $wProc = Start-Process -FilePath $workerBin -RedirectStandardOutput $workerLog -RedirectStandardError $workerErr -PassThru
            $workerProcs += $wProc
        }
        Start-Sleep -Milliseconds 1500

        $trialWallClocks = New-Object System.Collections.Generic.List[double]
        $trialThroughputs = New-Object System.Collections.Generic.List[double]
        $allLatencies = New-Object System.Collections.Generic.List[double]
        $allTrialResults = @()

        try {
            for ($trial = 1; $trial -le $numTrials; $trial++) {
                Write-Host "`n--- Trial $trial of $numTrials ---"
                # Reset state between trials
                Reset-BenchmarkDbState
                Start-Sleep -Milliseconds 500

                $runRecords = @()
                $overallStart = Get-Date

                for ($i = 0; $i -lt $Runs; $i++) {
                    $submitTime = Get-Date
                    $body = '{"input": {"step2SleepMs": 0}}'
                    $res = Invoke-RestMethod -Uri "$ApiUrl/workflows/$wfId/runs" -Method Post -Headers $Headers -Body $body -ErrorAction Stop
                    $runRecords += [PSCustomObject]@{
                        RunId = $res.data.id
                        SubmitTime = $submitTime
                        EndTime = $null
                        DurationMs = $null
                        Status = "pending"
                    }
                }

                $remaining = $runRecords.Count
                while ($remaining -gt 0) {
                    Start-Sleep -Milliseconds 200
                    foreach ($rec in $runRecords) {
                        if ($rec.Status -ne "Completed" -and $rec.Status -ne "Failed") {
                            try {
                                $check = Invoke-RestMethod -Uri "$ApiUrl/runs/$($rec.RunId)" -Method Get -Headers $Headers -ErrorAction SilentlyContinue
                                $st = $check.data.status
                                if ($st -eq "Completed" -or $st -eq "Failed") {
                                    $rec.Status = $st
                                    $rec.EndTime = Get-Date
                                    $rec.DurationMs = ($rec.EndTime - $rec.SubmitTime).TotalMilliseconds
                                    if ($st -eq "Completed") {
                                        $remaining--
                                    } else {
                                        Write-Error "Run $($rec.RunId) failed: $($check.data.error)"
                                        $remaining--
                                    }
                                }
                            } catch {}
                        }
                    }
                }

                $overallEnd = Get-Date
                $totalWallClockSec = ($overallEnd - $overallStart).TotalSeconds
                $completedRuns = ($runRecords | Where-Object { $_.Status -eq "Completed" }).Count
                $e2eThroughput = if ($totalWallClockSec -gt 0) { $completedRuns / $totalWallClockSec } else { 0 }

                $durations = ($runRecords | Where-Object { $_.Status -eq "Completed" } | ForEach-Object { $_.DurationMs }) | Sort-Object
                $minMs = if ($durations.Count -gt 0) { $durations[0] } else { 0 }
                $maxMs = if ($durations.Count -gt 0) { $durations[-1] } else { 0 }
                $medMs = if ($durations.Count -gt 0) {
                    $mid = [Math]::Floor($durations.Count / 2)
                    if ($durations.Count % 2 -eq 0) { ($durations[$mid - 1] + $durations[$mid]) / 2 } else { $durations[$mid] }
                } else { 0 }

                $trialWallClocks.Add($totalWallClockSec)
                $trialThroughputs.Add($e2eThroughput)
                foreach ($d in $durations) { $allLatencies.Add($d) }

                Write-Host "Trial $trial Completed: $completedRuns / $Runs runs"
                Write-Host "  Total Wall-Clock Time: $($totalWallClockSec.ToString('0.000')) s"
                Write-Host "  Completed Runs / sec:  $($e2eThroughput.ToString('0.00')) runs/sec"
                Write-Host "  time from submission to Completed (includes queue wait; all runs submitted at once) (ms):"
                Write-Host "    Min: $($minMs.ToString('0.00')) ms | Median: $($medMs.ToString('0.00')) ms | Max: $($maxMs.ToString('0.00')) ms"

                $allTrialResults += [PSCustomObject]@{
                    trial = $trial
                    wall_clock_sec = $totalWallClockSec
                    completed_runs = $completedRuns
                    throughput_runs_per_sec = $e2eThroughput
                    latency_min_ms = $minMs
                    latency_median_ms = $medMs
                    latency_max_ms = $maxMs
                    run_records = $runRecords
                }
            }
        } finally {
            foreach ($wp in $workerProcs) {
                Stop-Process -Id $wp.Id -Force -ErrorAction SilentlyContinue
            }
            Remove-Item $workerLog, $workerErr -Force -ErrorAction SilentlyContinue
        }

        # Calculate multi-trial summary
        $sortedWallClocks = $trialWallClocks | Sort-Object
        $wcMin = $sortedWallClocks[0]
        $wcMax = $sortedWallClocks[-1]
        $wcMid = [Math]::Floor($sortedWallClocks.Count / 2)
        $wcMed = if ($sortedWallClocks.Count % 2 -eq 0) { ($sortedWallClocks[$wcMid - 1] + $sortedWallClocks[$wcMid]) / 2 } else { $sortedWallClocks[$wcMid] }

        $sortedThroughputs = $trialThroughputs | Sort-Object
        $tpMin = $sortedThroughputs[0]
        $tpMax = $sortedThroughputs[-1]
        $tpMid = [Math]::Floor($sortedThroughputs.Count / 2)
        $tpMed = if ($sortedThroughputs.Count % 2 -eq 0) { ($sortedThroughputs[$tpMid - 1] + $sortedThroughputs[$tpMid]) / 2 } else { $sortedThroughputs[$tpMid] }

        $sortedLatencies = $allLatencies | Sort-Object
        $latMin = $sortedLatencies[0]
        $latMax = $sortedLatencies[-1]
        $latMid = [Math]::Floor($sortedLatencies.Count / 2)
        $latMed = if ($sortedLatencies.Count % 2 -eq 0) { ($sortedLatencies[$latMid - 1] + $sortedLatencies[$latMid]) / 2 } else { $sortedLatencies[$latMid] }

        Write-Host "`n=========================================================="
        Write-Host " End-to-End Throughput Summary Across $numTrials Trials"
        Write-Host " Mode: $(if ($sleepAlwaysVal -eq '1') { 'AXIOM_SCHEDULER_SLEEP_ALWAYS=1 (unconditional sleep)' } else { 'Default (repoll immediately on work)' })"
        Write-Host "=========================================================="
        Write-Host "Total Wall-Clock Time (s):"
        Write-Host "  Min:    $($wcMin.ToString('0.000')) s"
        Write-Host "  Median: $($wcMed.ToString('0.000')) s"
        Write-Host "  Max:    $($wcMax.ToString('0.000')) s"
        Write-Host "Completed Runs / sec:"
        Write-Host "  Min:    $($tpMin.ToString('0.00')) runs/sec"
        Write-Host "  Median: $($tpMed.ToString('0.00')) runs/sec"
        Write-Host "  Max:    $($tpMax.ToString('0.00')) runs/sec"
        Write-Host "time from submission to Completed (includes queue wait; all runs submitted at once) (ms):"
        Write-Host "  Min:    $($latMin.ToString('0.00')) ms"
        Write-Host "  Median: $($latMed.ToString('0.00')) ms"
        Write-Host "  Max:    $($latMax.ToString('0.00')) ms"
        Write-Host "=========================================================="

        $meta = Get-BenchmarkMetadata -CommandStr "powershell -File scripts/benchmark.ps1 -Command e2e-throughput -Runs $Runs -WorkerCount $WorkerCount -PollIntervalMs $pollMs -Trials $numTrials$(if ($sleepAlwaysVal -eq '1') { ' -SleepAlways' } else { '' })" -SampleCount ($Runs * $numTrials) -WarmupCount 0

        $resultObj = [ordered]@{
            experiment = "end-to-end workflow completion throughput"
            git_commit = $meta.git_commit
            git_dirty = $meta.git_dirty
            git_diff_hash = $meta.git_diff_hash
            date = $meta.date
            command = $meta.command
            hardware = $meta.hardware
            dependencies = $meta.dependencies
            workflow = "crash_recovery_workflow (3 steps)"
            runs_per_trial = $Runs
            trials_count = $numTrials
            worker_count = $WorkerCount
            scheduler_poll_interval_ms = $pollMs
            scheduler_sleep_always = ($sleepAlwaysVal -eq "1")
            wall_clock_sec = [ordered]@{
                min = $wcMin
                median = $wcMed
                max = $wcMax
                raw = $sortedWallClocks
            }
            completed_runs_per_sec = [ordered]@{
                min = $tpMin
                median = $tpMed
                max = $tpMax
                raw = $sortedThroughputs
            }
            time_from_submission_to_completed_ms = [ordered]@{
                definition = "time from submission to Completed (includes queue wait; all runs submitted at once)"
                min = $latMin
                median = $latMed
                max = $latMax
            }
            trials = $allTrialResults
        }

        if ($SaveResults) {
            $outFile = if ($sleepAlwaysVal -eq "1") { Join-Path $ResultsDir "e2e_throughput_before.json" } else { Join-Path $ResultsDir "e2e_throughput.json" }
            $resultObj | ConvertTo-Json -Depth 6 | Set-Content -Path $outFile -Encoding UTF8
            Write-Host "Raw output saved to: $outFile"
        }
    }

    "outbox-lag" {
        Write-Host "=========================================================="
        Write-Host " Axiom Engine Outbox Lag Analysis"
        Write-Host "=========================================================="

        if ($Collect) {
            $isBurst = ($CollectMode -eq "burst")
            $modeLabel = if ($isBurst) { "burst (offered load above drain rate)" } else { "steady state (~50% of computed drain rate: 50 msgs/s)" }
            Write-Host "Generating and collecting 1,000 outbox relay samples..."
            Write-Host "Mode: $modeLabel"
            Write-Host "Theoretical Drain Rate: 100 msgs/s (50 messages per claim batch, 500 ms sleep between loops in crates/axiom-worker/src/relayer.rs)"

            # Ensure clean initial state in DB (cancel any pending runs from prior throughput tests)
            & docker exec docker-postgres-1 psql -U axiom -d axiom_engine -c "UPDATE workflow_runs SET status = 'cancelled' WHERE status IN ('pending', 'running'); DELETE FROM outbox_messages;" | Out-Null

            $outboxLog = Join-Path $PSScriptRoot "worker_outbox_collect.log"
            Remove-Item $outboxLog -Force -ErrorAction SilentlyContinue

            # 1. Start worker with dedicated log
            $dbUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgres://axiom:password@localhost:5432/axiom_engine" }
            $natsUrl = if ($env:NATS_URL) { $env:NATS_URL } else { "nats://localhost:4222" }
            $workerBin = Join-Path $PSScriptRoot "..\target\debug\axiom-worker.exe"
            $env:DATABASE_URL = $dbUrl
            $env:NATS_URL = $natsUrl
            $env:SIDECAR_PATH = "packages/sdk/dist/app.js"
            $env:AXIOM_PROMETHEUS_PORT = "9003"
            $workerProc = Start-Process -FilePath $workerBin -RedirectStandardOutput $outboxLog -PassThru

            Start-Sleep -Milliseconds 1500

            try {
                if ($isBurst) {
                    # Burst mode: 20 batches of 50 spaced by 250 ms (~200 msgs/s offered load vs 100 msgs/s drain rate)
                    Write-Host "Inserting 1,000 outbox messages in 20 batches of 50 every 250 ms (burst: ~200 msgs/s)..."
                    for ($b = 0; $b -lt 20; $b++) {
                        "INSERT INTO outbox_messages (id, tenant_id, topic, payload, available_at, created_at) SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'axiom.benchmarks', '{}'::jsonb, now(), now() FROM generate_series(1, 50);" | docker exec -i docker-postgres-1 psql -U axiom -d axiom_engine | Out-Null
                        Start-Sleep -Milliseconds 250
                    }
                } else {
                    # Steady-state mode: 40 batches of 25 spaced by 500 ms (~50 msgs/s offered load vs 100 msgs/s drain rate)
                    Write-Host "Inserting 1,000 outbox messages in 40 batches of 25 every 500 ms (steady state: ~50 msgs/s)..."
                    for ($b = 0; $b -lt 40; $b++) {
                        "INSERT INTO outbox_messages (id, tenant_id, topic, payload, available_at, created_at) SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'axiom.benchmarks', '{}'::jsonb, now(), now() FROM generate_series(1, 25);" | docker exec -i docker-postgres-1 psql -U axiom -d axiom_engine | Out-Null
                        Start-Sleep -Milliseconds 500
                    }
                }
                Write-Host "Inserted 1,000 outbox messages into PostgreSQL."

                Write-Host "Waiting for outbox relayer to process 1,000 messages..."
                for ($w = 0; $w -lt 90; $w++) {
                    Start-Sleep -Seconds 1
                    if (Test-Path $outboxLog) {
                        $lines = Get-Content $outboxLog
                        $relayedCount = ($lines | Where-Object { $_ -match '"lag_ms":' -or $_ -match 'lag_ms=' }).Count
                        if ($w % 5 -eq 0 -or $relayedCount -ge 1000) {
                            Write-Host "Relayed so far: $relayedCount / 1000"
                        }
                        if ($relayedCount -ge 1000) {
                            break
                        }
                    }
                }
            } finally {
                Stop-Process -Id $workerProc.Id -Force -ErrorAction SilentlyContinue
                & docker exec docker-postgres-1 psql -U axiom -d axiom_engine -c "DELETE FROM outbox_messages;" | Out-Null
            }
            $LogFile = $outboxLog
        }

        if (-not (Test-Path $LogFile)) {
            Write-Error "Log file $LogFile not found. Please specify -LogFile or pass -Collect."
            return
        }

        Write-Host "Reading outbox relay events from: $LogFile"
        $lags = New-Object System.Collections.Generic.List[double]
        Get-Content $LogFile | ForEach-Object {
            $line = $_
            if ($line -match '"lag_ms":([0-9]+)') {
                $lags.Add([double]$matches[1])
            } elseif ($line -match 'lag_ms=([0-9]+)') {
                $lags.Add([double]$matches[1])
            } elseif ($line -match '"lag_ms":"([0-9]+)"') {
                $lags.Add([double]$matches[1])
            }
        }

        if ($lags.Count -eq 0) {
            Write-Host "No outbox relay events found in $LogFile."
            return
        }

        $sortedLags = $lags | Sort-Object
        $count = $sortedLags.Count
        $minLag = $sortedLags[0]
        $maxLag = $sortedLags[-1]
        $avgLag = ($sortedLags | Measure-Object -Average).Average
        $p50Index = [Math]::Floor($count * 0.50)
        $p95Index = [Math]::Floor($count * 0.95)
        $p99Index = [Math]::Floor($count * 0.99)
        $p50Lag = $sortedLags[[Math]::Min($p50Index, $count - 1)]
        $p95Lag = $sortedLags[[Math]::Min($p95Index, $count - 1)]
        $p99Lag = $sortedLags[[Math]::Min($p99Index, $count - 1)]

        $reportMode = if ($Collect) { if ($CollectMode -eq "burst") { "burst (offered load above drain rate)" } else { "steady state (~50% of computed drain rate)" } } else { "log file evaluation" }
        Write-Host "`n=========================================================="
        Write-Host " Outbox Relay Dispatch Lag Results ($reportMode)"
        Write-Host " Sample Count: $count messages"
        Write-Host "=========================================================="
        Write-Host "Min lag:         $minLag ms"
        Write-Host "Median lag (p50): $p50Lag ms"
        Write-Host "Average lag:     $($avgLag.ToString('0.00')) ms"
        Write-Host "p95 lag:         $p95Lag ms"
        Write-Host "p99 lag:         $p99Lag ms"
        Write-Host "Max lag:         $maxLag ms"
        Write-Host "=========================================================="

        $cmdStr = if ($Collect) { "powershell -File scripts/benchmark.ps1 -Command outbox-lag -Collect -CollectMode $(if ($CollectMode) { $CollectMode } else { 'steady' })" } else { "powershell -File scripts/benchmark.ps1 -Command outbox-lag -LogFile $LogFile" }
        $meta = Get-BenchmarkMetadata -CommandStr $cmdStr -SampleCount $count -WarmupCount 0

        $resultObj = [ordered]@{
            experiment = "outbox relay dispatch lag"
            mode = $reportMode
            git_commit = $meta.git_commit
            git_dirty = $meta.git_dirty
            git_diff_hash = $meta.git_diff_hash
            date = $meta.date
            command = $meta.command
            sample_count = $count
            warmup_count = 0
            hardware = $meta.hardware
            dependencies = $meta.dependencies
            two_timestamps_definition = "Timestamp 1: msg.created_at (PostgreSQL TIMESTAMPTZ when the transactional outbox row was inserted by API or scheduler transaction via SQL now()). Timestamp 2: chrono::Utc::now() (UTC clock in worker OutboxRelayer when the row was claimed and successfully published to NATS JetStream topic axiom.benchmarks). Both PostgreSQL and worker run on the same physical host, so clock skew is negligible."
            drain_rate_notes = "crates/axiom-worker/src/relayer.rs uses claim batch size of 50 messages and sleeps 500 ms between loop iterations. Theoretical maximum drain rate is 50 msgs / 0.5 s = 100 msgs/s."
            log_file = $LogFile
            lag_min_ms = $minLag
            lag_p50_ms = $p50Lag
            lag_avg_ms = $avgLag
            lag_p95_ms = $p95Lag
            lag_p99_ms = $p99Lag
            lag_max_ms = $maxLag
            raw_lags_ms = $sortedLags
        }

        if ($SaveResults) {
            $outFile = Join-Path $ResultsDir "outbox_lag.json"
            $resultObj | ConvertTo-Json -Depth 5 | Set-Content -Path $outFile -Encoding UTF8
            Write-Host "Raw output saved to: $outFile"
        }
    }

    "replay" {
        Write-Host "=========================================================="
        Write-Host " Axiom Engine Replay Overhead Benchmark"
        Write-Host " Measuring warm IPC resume_workflow latency for 10, 100, 1000 events"
        Write-Host " Repetitions per step count: $Runs (min 20) | Warm-up runs: $WarmupRuns"
        Write-Host "=========================================================="

        $runsCount = [Math]::Max($Runs, 20)
        $metaJson = Get-BenchmarkMetadata -CommandStr "powershell -File scripts/benchmark.ps1 -Command replay -Runs $runsCount -WarmupRuns $WarmupRuns" -SampleCount $runsCount -WarmupCount $WarmupRuns | ConvertTo-Json -Depth 5

        $runnerScript = @"
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const metadata = $metaJson;

async function run() {
    const sidecar = spawn('node', ['packages/sdk/dist/app.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const rl = readline.createInterface({ input: sidecar.stdout, terminal: false });

    let pending = null;
    let start = 0n;

    rl.on('line', (line) => {
        if (!line.trim()) return;
        const end = process.hrtime.bigint();
        const elapsedMs = Number(end - start) / 1e6;
        if (pending) {
            const cb = pending;
            pending = null;
            cb({ elapsedMs, response: JSON.parse(line) });
        }
    });

    // Wait 300ms for sidecar process initialization
    await new Promise(r => setTimeout(r, 300));

    async function sendResume(history) {
        const payload = {
            type: 'resume_workflow',
            correlation_id: 'corr-' + Math.random().toString(36).substring(7),
            payload: {
                run_id: '00000000-0000-0000-0000-000000000001',
                workflow_name: 'loop_workflow',
                workflow_version: 1,
                input: { steps: 10000 },
                history: history,
                run_correlation_id: null
            }
        };

        let timer;
        const p = new Promise(resolve => {
            pending = resolve;
            timer = setTimeout(() => {
                pending = null;
                resolve({ finished: false, error: 'Timed out after 10000ms' });
            }, 10000);
        });

        start = process.hrtime.bigint();
        sidecar.stdin.write(JSON.stringify(payload) + '\n');
        const res = await p;
        clearTimeout(timer);
        return res;
    }

    // Warm-up phase (discard first K runs to eliminate V8 cold-start JIT compilation artifacts)
    const warmupCount = $WarmupRuns;
    console.log('Running ' + warmupCount + ' warm-up iterations (discarded from benchmark data)...');
    for (let w = 0; w < warmupCount; w++) {
        const dummyHistory = [];
        for (let i = 0; i < 10; i++) {
            dummyHistory.push({ type: 'StepCompleted', data: { id: 'step_' + i, output: i } });
        }
        await sendResume(dummyHistory);
    }
    console.log('Warm-up complete. Sidecar V8 JIT compiled and memory pools warmed.');

    const stepCounts = [10, 100, 1000];
    const trials = $runsCount;
    const results = {};

    for (const n of stepCounts) {
        process.stdout.write('Measuring ' + n + ' events (' + trials + ' repetitions)... ');
        const history = [];
        for (let i = 0; i < n; i++) {
            history.push({
                type: 'StepCompleted',
                data: { id: 'step_' + i, output: i }
            });
        }

        const timings = [];
        for (let t = 0; t < trials; t++) {
            const res = await sendResume(history);
            if (res.response) {
                timings.push(res.elapsedMs);
            }
        }

        timings.sort((a, b) => a - b);
        const min = timings[0];
        const max = timings[timings.length - 1];
        const mid = Math.floor(timings.length / 2);
        const median = timings.length % 2 === 0 ? (timings[mid - 1] + timings[mid]) / 2 : timings[mid];

        console.log('Min: ' + min.toFixed(4) + ' ms | Median: ' + median.toFixed(4) + ' ms | Max: ' + max.toFixed(4) + ' ms');

        results[n] = {
            events_count: n,
            repetitions: trials,
            min_ms: min,
            median_ms: median,
            max_ms: max,
            raw_timings_ms: timings
        };
    }

    sidecar.kill();

    const outputObj = Object.assign({}, metadata, {
        experiment: "replay overhead",
        timing_definition: "Timing starts when JSON resume_workflow payload is written to the sidecar process stdin pipe and ends when the complete JSON response line (ScheduleStep or CompleteWorkflow) is read and parsed from stdout. Sidecar process spawn and V8 cold start are NOT included (the process is already warm).",
        history_length_definition: "Count of past StepCompleted semantic events in the history array passed to resume_workflow (replaying step_0 through step_{N-1} in loop_workflow).",
        results: results
    });

    const outPath = path.join(__dirname, '..', 'benchmarks', 'results', 'replay_overhead.json');
    fs.writeFileSync(outPath, JSON.stringify(outputObj, null, 2));
    console.log('Raw output saved to: ' + outPath);
}

run();
"@

        $tmpScript = Join-Path $PSScriptRoot "replay_bench_runner.tmp.js"
        Set-Content -Path $tmpScript -Value $runnerScript -Encoding UTF8
        try {
            node $tmpScript
        } finally {
            Remove-Item $tmpScript -Force -ErrorAction SilentlyContinue
        }
    }

    "recovery" {
        Write-Host "=========================================================="
        Write-Host " Axiom Engine Recovery Latency Benchmark"
        Write-Host " Failure recovery test: killing worker mid-step and"
        Write-Host " measuring time until new worker resumes it."
        Write-Host " Repetitions: $Runs (min 10) | Lease TTL: $LeaseTtlMs ms"
        Write-Host "=========================================================="

        $runsCount = if ($Runs -gt 0) { $Runs } else { 10 }
        $dbUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgres://axiom:password@localhost:5432/axiom_engine" }
        $natsUrl = if ($env:NATS_URL) { $env:NATS_URL } else { "nats://localhost:4222" }
        $workerBin = Join-Path $PSScriptRoot "..\target\debug\axiom-worker.exe"
        if (-not (Test-Path $workerBin)) {
            Write-Host "Compiling axiom-worker..."
            cargo build --bin axiom-worker | Out-Null
        }

        $wfId = Ensure-CrashRecoveryWorkflow -Url $ApiUrl -AuthHeaders $Headers
        if (-not $wfId) {
            Write-Host "Cannot run recovery benchmark without active API server at $ApiUrl"
            return
        }

        # Helper to query run state directly from DB
        function Get-RunInfo ($rId) {
            $out = & docker exec docker-postgres-1 psql -U axiom -d axiom_engine -t -A -F ',' -c "SELECT worker_id, fence_token, status, updated_at FROM workflow_runs WHERE id = '$rId';"
            if ($out) {
                $line = ($out -split "`r?`n")[0].Trim()
                $parts = $line.Split(',')
                if ($parts.Count -ge 3) {
                    return [PSCustomObject]@{
                        WorkerId = $parts[0]
                        FenceToken = [int64]$parts[1]
                        Status = $parts[2]
                        UpdatedAt = $parts[3]
                    }
                }
            }
            return $null
        }

        # Helper to check if step has started execution
        function Get-StepStatus ($rId, $sId) {
            $out = & docker exec docker-postgres-1 psql -U axiom -d axiom_engine -t -A -c "SELECT status FROM step_executions WHERE run_id = '$rId' AND step_id = '$sId';"
            if ($out) {
                return ($out -split "`r?`n")[0].Trim()
            }
            return ""
        }

        $measurements = New-Object System.Collections.Generic.List[double]
        $remTtlList = New-Object System.Collections.Generic.List[double]
        $jitterList = New-Object System.Collections.Generic.List[double]
        $spawnReplayList = New-Object System.Collections.Generic.List[double]
        $totRecList = New-Object System.Collections.Generic.List[double]

        for ($trial = 1; $trial -le $runsCount; $trial++) {
            Write-Host "`n--- Trial $trial / $runsCount ---"

            # 1. Start Worker 1
            $w1Log = Join-Path $PSScriptRoot "worker_trial_${trial}_w1.log"
            $w1Err = Join-Path $PSScriptRoot "worker_trial_${trial}_w1.err"
            $recFile = Join-Path $PSScriptRoot "recovery_record_trial_${trial}.log"
            Remove-Item $recFile -Force -ErrorAction SilentlyContinue

            $env:DATABASE_URL = $dbUrl
            $env:NATS_URL = $natsUrl
            $env:SIDECAR_PATH = "packages/sdk/dist/app.js"
            $env:AXIOM_LEASE_TTL_MS = $LeaseTtlMs.ToString()
            $env:AXIOM_PROMETHEUS_PORT = "9001"
            $w1 = Start-Process -FilePath $workerBin -RedirectStandardOutput $w1Log -RedirectStandardError $w1Err -PassThru

            # Wait for worker 1 to initialize
            Start-Sleep -Milliseconds 1200

            # 2. Start crash_recovery_workflow with 6s sleep in step2
            $normRecFile = $recFile.Replace('\', '/')
            $body = "{`"input`": {`"recordFile`": `"$normRecFile`", `"step2SleepMs`": 6000}}"
            $resp = Invoke-RestMethod -Uri "$ApiUrl/workflows/$wfId/runs" -Method Post -Headers $Headers -Body $body -ErrorAction Stop
            $runId = $resp.data.id
            Write-Host "Started Run ID: $runId"

            # 3. Wait until Worker 1 has completed step1 and step2 is in flight
            $inStep = $false
            for ($waitSec = 0; $waitSec -lt 40; $waitSec++) {
                Start-Sleep -Milliseconds 500
                $s1Completed = & docker exec docker-postgres-1 psql -U axiom -d axiom_engine -t -A -c "SELECT COUNT(*) FROM events WHERE run_id = '$runId' AND event_type = 'StepCompleted' AND step_id = 'step1';"
                if ($s1Completed -and [int]$s1Completed.Trim() -ge 1) {
                    $s2Stat = Get-StepStatus -rId $runId -sId "step2"
                    if ($s2Stat -ne "") {
                        # Give consumer 1.2s to be actively in flight on step2
                        Start-Sleep -Milliseconds 1200
                        $inStep = $true
                        break
                    }
                }
            }

            if (-not $inStep) {
                Write-Host "Worker 1 did not enter step2 in time. Skipping trial."
                Stop-Process -Id $w1.Id -Force -ErrorAction SilentlyContinue
                Remove-Item $w1Log, $w1Err, $recFile -Force -ErrorAction SilentlyContinue
                continue
            }

            $preKillInfo = Get-RunInfo -rId $runId
            $preKillFence = $preKillInfo.FenceToken
            Write-Host "Worker 1 completed step1 and is mid-step2 (fence_token=$preKillFence). Killing Worker 1 (kill -9)..."

            # 4. KILL -9 WORKER 1 & CAPTURE LEASE EXPIRES_AT
            $leaseEpochStr = (& docker exec docker-postgres-1 psql -U axiom -d axiom_engine -t -A -c "SELECT extract(epoch from lease_expires_at) FROM workflow_runs WHERE id = '$runId';").Trim()
            $killWallClock = [System.DateTime]::UtcNow
            $killTime = [System.Diagnostics.Stopwatch]::StartNew()
            Stop-Process -Id $w1.Id -Force

            # 5. Start Worker 2
            $w2Log = Join-Path $PSScriptRoot "worker_trial_${trial}_w2.log"
            $w2Err = Join-Path $PSScriptRoot "worker_trial_${trial}_w2.err"
            $env:AXIOM_PROMETHEUS_PORT = "9002"
            $w2 = Start-Process -FilePath $workerBin -RedirectStandardOutput $w2Log -RedirectStandardError $w2Err -PassThru

            Write-Host "Worker 2 started. Waiting for lease expiration and resumption by Worker 2..."

            # 6. Poll for resumption by Worker 2 (fence_token incremented or worker_id changed)
            $resumed = $false
            $elapsedMs = 0
            $timeoutSec = 60

            while ($killTime.Elapsed.TotalSeconds -lt $timeoutSec) {
                Start-Sleep -Milliseconds 250
                $postInfo = Get-RunInfo -rId $runId
                if ($postInfo -and $postInfo.FenceToken -gt $preKillFence) {
                    if (-not $resumed) {
                        $killTime.Stop()
                        $elapsedMs = $killTime.Elapsed.TotalMilliseconds
                        $resumed = $true
                        Write-Host "RESUMED by Worker 2! (new fence_token=$($postInfo.FenceToken), worker=$($postInfo.WorkerId))"
                    }
                }
                if ($postInfo -and $postInfo.Status -eq "completed") {
                    break
                }
            }

            # Stop worker 2
            Stop-Process -Id $w2.Id -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 300

            # 7. Extract Timestamps from Worker 2 and DB
            $leaseExpiresAtUtc = if ($leaseEpochStr) { [DateTimeOffset]::FromUnixTimeMilliseconds([int64]([double]$leaseEpochStr * 1000)).UtcDateTime } else { $null }

            $claimTimeUtc = $null
            if (Test-Path $w2Log) {
                $w2LogLines = Get-Content $w2Log -ErrorAction SilentlyContinue
                foreach ($line in $w2LogLines) {
                    if ($line -match "Acquired lease for run" -and $line -match $runId) {
                        try {
                            $j = $line | ConvertFrom-Json
                            $claimTimeUtc = [System.DateTime]::Parse($j.timestamp, $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
                            break
                        } catch {}
                    }
                }
            }
            if (-not $claimTimeUtc) {
                # Fallback to DB updated_at from when poll_run claimed the lease
                $dbClaimEpoch = (& docker exec docker-postgres-1 psql -U axiom -d axiom_engine -t -A -c "SELECT extract(epoch from updated_at) FROM workflow_runs WHERE id = '$runId';").Trim()
                if ($dbClaimEpoch) {
                    $claimTimeUtc = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]([double]$dbClaimEpoch * 1000)).UtcDateTime
                }
            }

            $replayTimeUtc = $null
            if (Test-Path $w2Err) {
                $w2ErrLines = Get-Content $w2Err -ErrorAction SilentlyContinue
                foreach ($line in $w2ErrLines) {
                    if ($line -match "\[REPLAY_EVENT\]" -and $line -match "timestamp=([^\s]+)") {
                        try {
                            $replayTimeUtc = [System.DateTime]::Parse($matches[1], $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
                            break
                        } catch {}
                    }
                }
            }
            if (-not $replayTimeUtc -and (Test-Path $w2Log)) {
                foreach ($line in $w2LogLines) {
                    if ($line -match "TS yielded ScheduleStep" -and $line -match $runId) {
                        try {
                            $j = $line | ConvertFrom-Json
                            $replayTimeUtc = [System.DateTime]::Parse($j.timestamp, $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
                            break
                        } catch {}
                    }
                }
            }

            # Component intervals
            $remTtl = if ($leaseExpiresAtUtc) { [Math]::Max(0.0, ($leaseExpiresAtUtc - $killWallClock).TotalMilliseconds) } else { 0.0 }
            $jitter = if ($claimTimeUtc -and $leaseExpiresAtUtc) { [Math]::Max(0.0, ($claimTimeUtc - $leaseExpiresAtUtc).TotalMilliseconds) } else { $null }
            $spawnReplay = if ($claimTimeUtc -and $replayTimeUtc) { [Math]::Max(0.0, ($replayTimeUtc - $claimTimeUtc).TotalMilliseconds) } else { $null }
            $totRec = if ($claimTimeUtc) { [Math]::Max(0.0, ($claimTimeUtc - $killWallClock).TotalMilliseconds) } else { $elapsedMs }

            Write-Host "`n  Measured Timestamps (Trial $trial):"
            Write-Host "    (i)   Kill Time:                 $($killWallClock.ToString('yyyy-MM-dd HH:mm:ss.fff')) UTC"
            Write-Host "    (ii)  Lease Expiry:              $($leaseExpiresAtUtc.ToString('yyyy-MM-dd HH:mm:ss.fff')) UTC"
            Write-Host "    (iii) Worker B Lease Claim:      $(if ($claimTimeUtc) { $claimTimeUtc.ToString('yyyy-MM-dd HH:mm:ss.fff') + ' UTC' } else { 'N/A' })"
            Write-Host "    (iv)  First Replayed Event:      $(if ($replayTimeUtc) { $replayTimeUtc.ToString('yyyy-MM-dd HH:mm:ss.fff') + ' UTC' } else { 'N/A' })"
            Write-Host "  Measured Intervals (Trial $trial):"
            Write-Host "    Remaining Lease TTL:             $($remTtl.ToString('0.00')) ms"
            Write-Host "    Scheduler Poll Jitter:           $(if ($jitter -ne $null) { $jitter.ToString('0.00') + ' ms' } else { 'N/A' })"
            Write-Host "    Sidecar Spawn & First Replay:    $(if ($spawnReplay -ne $null) { $spawnReplay.ToString('0.00') + ' ms' } else { 'N/A' })"
            Write-Host "    Total Recovery Latency:          $($totRec.ToString('0.00')) ms"

            # 8. Assert re-execution: Step 1 must have exactly 1 execution record
            if (Test-Path $recFile) {
                $recLines = @(Get-Content $recFile | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $_ | ConvertFrom-Json })
                $s1Execs = @($recLines | Where-Object { $_.step_id -eq "step1" }).Count
                if ($s1Execs -ne 1) {
                    throw "ASSERTION FAILED: Step 1 was re-executed! Found $s1Execs executions instead of exactly 1 in trial $trial."
                }
            } else {
                throw "ASSERTION FAILED: Execution record file $recFile was not created in trial $trial!"
            }

            # Verify events in DB: exactly one StepCompleted for step1, no DeterminismViolation
            $eventsOut = & docker exec docker-postgres-1 psql -U axiom -d axiom_engine -t -A -F ',' -c "SELECT event_type, step_id FROM events WHERE run_id = '$runId';"
            $s1CompletedCount = 0
            foreach ($evLine in ($eventsOut -split "`r?`n")) {
                if ($evLine.Trim() -eq "") { continue }
                $p = $evLine.Split(',')
                if ($p[0] -eq "DeterminismViolation") {
                    throw "ASSERTION FAILED: DeterminismViolation event detected in run history for run $runId!"
                }
                if ($p[0] -eq "StepCompleted" -and $p[1] -eq "step1") {
                    $s1CompletedCount++
                }
            }
            if ($s1CompletedCount -ne 1) {
                throw "ASSERTION FAILED: Found $s1CompletedCount StepCompleted events for step1 in run $runId (expected 1)!"
            }
            Write-Host "RE-EXECUTION ASSERTION PASSED: Step 1 executed exactly once (no re-execution on recovery), 0 DeterminismViolations."

            # Clean up logs
            Remove-Item $w1Log, $w1Err, $w2Log, $w2Err, $recFile -Force -ErrorAction SilentlyContinue

            if ($resumed) {
                $measurements.Add($totRec)
                $remTtlList.Add($remTtl)
                if ($jitter -ne $null) { $jitterList.Add($jitter) }
                if ($spawnReplay -ne $null) { $spawnReplayList.Add($spawnReplay) }
                $totRecList.Add($totRec)
            } else {
                Write-Host "Trial $trial timed out waiting for resumption."
            }
        }

        if ($measurements.Count -gt 0) {
            function Get-Stats ($list) {
                if ($list.Count -eq 0) { return @{ Min = 0; Median = 0; Max = 0 } }
                $s = $list | Sort-Object
                $c = $s.Count
                $medIdx = [Math]::Floor($c * 0.50)
                $med = if ($c % 2 -eq 0) { ($s[$medIdx - 1] + $s[$medIdx]) / 2 } else { $s[$medIdx] }
                return @{ Min = $s[0]; Median = $med; Max = $s[-1] }
            }

            $recStats = Get-Stats $measurements
            $remTtlStats = Get-Stats $remTtlList
            $jitterStats = Get-Stats $jitterList
            $replayStats = Get-Stats $spawnReplayList
            $count = $measurements.Count

            Write-Host "`n=========================================================="
            Write-Host " Recovery Latency Results ($count successful trials)"
            Write-Host " Note: p95/p99 omitted because n < 100; reporting min/median/max only"
            Write-Host "=========================================================="
            Write-Host "Remaining Lease TTL:          Min: $($remTtlStats.Min.ToString("0.00")) ms | Median: $($remTtlStats.Median.ToString("0.00")) ms | Max: $($remTtlStats.Max.ToString("0.00")) ms"
            Write-Host "Scheduler Poll Jitter:        Min: $($jitterStats.Min.ToString("0.00")) ms | Median: $($jitterStats.Median.ToString("0.00")) ms | Max: $($jitterStats.Max.ToString("0.00")) ms"
            Write-Host "Sidecar Spawn & First Replay: Min: $($replayStats.Min.ToString("0.00")) ms | Median: $($replayStats.Median.ToString("0.00")) ms | Max: $($replayStats.Max.ToString("0.00")) ms"
            Write-Host "Total Recovery Latency:       Min: $($recStats.Min.ToString("0.00")) ms | Median: $($recStats.Median.ToString("0.00")) ms | Max: $($recStats.Max.ToString("0.00")) ms"

            $meta = Get-BenchmarkMetadata -CommandStr "powershell -File scripts/benchmark.ps1 -Command recovery -Runs $runsCount -LeaseTtlMs $LeaseTtlMs" -SampleCount $count -WarmupCount 0

            $resultObj = [ordered]@{
                experiment = "worker crash recovery latency"
                git_commit = $meta.git_commit
                git_dirty = $meta.git_dirty
                git_diff_hash = $meta.git_diff_hash
                date = $meta.date
                command = $meta.command
                sample_count = $count
                warmup_count = 0
                hardware = $meta.hardware
                dependencies = $meta.dependencies
                trials_requested = $runsCount
                trials_completed = $count
                min_ms = $recStats.Min
                median_ms = $recStats.Median
                max_ms = $recStats.Max
                breakdown = [ordered]@{
                    lease_ttl_ms = $LeaseTtlMs
                    scheduler_poll_interval_ms = 2000
                    measured_remaining_lease_ttl_ms = [ordered]@{ min = $remTtlStats.Min; median = $remTtlStats.Median; max = $remTtlStats.Max }
                    measured_scheduler_poll_jitter_ms = [ordered]@{ min = $jitterStats.Min; median = $jitterStats.Median; max = $jitterStats.Max }
                    measured_spawn_and_replay_ms = [ordered]@{ min = $replayStats.Min; median = $replayStats.Median; max = $replayStats.Max }
                    measured_total_recovery_ms = [ordered]@{ min = $recStats.Min; median = $recStats.Median; max = $recStats.Max }
                    expected_composition_estimated = [ordered]@{
                        estimated_remaining_lease_ttl_ms = [Math]::Max(0, $LeaseTtlMs - 1200)
                        estimated_scheduler_poll_jitter_ms = "0 to 2000 ms (uniform distribution, average 1000 ms)"
                        estimated_replay_and_spawn_ms = "150 to 300 ms (sidecar spawn + replay of step1)"
                    }
                }
                raw_measurements_ms = ($measurements | Sort-Object)
            }

            if ($SaveResults) {
                $outFile = Join-Path $ResultsDir "recovery_latency.json"
                $resultObj | ConvertTo-Json -Depth 5 | Set-Content -Path $outFile -Encoding UTF8
                Write-Host "Raw output saved to: $outFile"
            } else {
                Write-Host "(SaveResults flag not passed; results not written to JSON yet.)"
            }
        } else {
            Write-Host "No successful recovery trials completed."
        }
    }

    default {
        Write-Host "Axiom Engine Benchmark Tool"
        Write-Host "Available commands:"
        Write-Host "  throughput     - Measure run-creation requests accepted per second (API only)"
        Write-Host "  e2e-throughput - Measure end-to-end workflow completion throughput (all runs reach Completed)"
        Write-Host "  outbox-lag     - Compute p50/p99 outbox dispatch lag from worker log (-Collect to generate 1,000 samples)"
        Write-Host "  replay         - Measure warm IPC replay overhead for 10, 100, 1000 events (discards warmup)"
        Write-Host "  recovery       - Measure worker crash-recovery latency across N failure trials (min/median/max)"
        Write-Host "Options: -Runs [int] -Concurrency [int] -WorkerCount [int] -PollIntervalMs [int] -LeaseTtlMs [int] -WarmupRuns [int] -ApiUrl [string] -ApiKey [string] -LogFile [string] -Collect"
    }
}
