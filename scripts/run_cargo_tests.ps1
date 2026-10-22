$env:DATABASE_URL = "postgres://axiom:password@localhost:5432/axiom_engine"
$env:NATS_URL = "nats://localhost:4222"
cargo test --workspace -- --test-threads=1
