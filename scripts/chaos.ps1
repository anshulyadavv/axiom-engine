param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Command
)

switch ($Command) {
    "postgres-restart" {
        Write-Host "Restarting PostgreSQL..."
        docker compose -f infra/docker/docker-compose.yml restart postgres
    }
    "postgres-stop" {
        Write-Host "Stopping PostgreSQL..."
        docker compose -f infra/docker/docker-compose.yml stop postgres
    }
    "postgres-start" {
        Write-Host "Starting PostgreSQL..."
        docker compose -f infra/docker/docker-compose.yml start postgres
    }
    "nats-restart" {
        Write-Host "Restarting NATS..."
        docker compose -f infra/docker/docker-compose.yml restart nats
    }
    "nats-stop" {
        Write-Host "Stopping NATS..."
        docker compose -f infra/docker/docker-compose.yml stop nats
    }
    "nats-start" {
        Write-Host "Starting NATS..."
        docker compose -f infra/docker/docker-compose.yml start nats
    }
    "worker-kill" {
        Write-Host "Killing axiom-worker processes..."
        Stop-Process -Name "axiom-worker" -Force -ErrorAction SilentlyContinue
        Write-Host "Worker killed."
    }
    "worker-pause" {
        # This requires pssuspend or similar in Windows, but we can just use Stop-Process for kill.
        # Alternatively, we can suspend using a .NET trick or just tell the user it kills instead.
        Write-Host "Pausing is not natively supported without PsSuspend. Please use worker-kill instead or pause via debugger."
    }
    "api-restart" {
        Write-Host "Restarting axiom-api..."
        Stop-Process -Name "axiom-api" -Force -ErrorAction SilentlyContinue
        Write-Host "API killed. Please restart it via your runner."
    }
    "network-isolate-postgres" {
        Write-Host "Isolating PostgreSQL network..."
        docker network disconnect docker_default postgres -f
    }
    "network-restore-postgres" {
        Write-Host "Restoring PostgreSQL network..."
        docker network connect docker_default postgres
    }
    "network-isolate-nats" {
        Write-Host "Isolating NATS network..."
        docker network disconnect docker_default nats -f
    }
    "network-restore-nats" {
        Write-Host "Restoring NATS network..."
        docker network connect docker_default nats
    }
    default {
        Write-Host "Unknown command: $Command"
        Write-Host "Available commands: postgres-restart, nats-restart, worker-kill, api-restart, network-isolate-postgres, network-restore-postgres, network-isolate-nats, network-restore-nats"
    }
}
