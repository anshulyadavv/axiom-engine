use clap::{Parser, Subcommand};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Client;
use serde_json::Value;
use std::env;

#[derive(Parser)]
#[command(name = "axiom")]
#[command(about = "Axiom Engine CLI", version = "0.1.0")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Output format
    #[arg(long, global = true)]
    json: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Workflow operations
    Workflow {
        #[command(subcommand)]
        command: WorkflowCommands,
    },
    /// Run operations
    Run {
        #[command(subcommand)]
        command: RunCommands,
    },
    /// View logs (not currently supported by backend)
    Logs,
    /// View workers (not currently supported by backend)
    Workers,
}

#[derive(Subcommand)]
enum WorkflowCommands {
    /// List available workflows
    List {
        #[arg(short, long)]
        name: Option<String>,
    },
    /// Start a new workflow run
    Run {
        /// Name of the workflow
        name: String,
        /// Explicit workflow version
        #[arg(short, long)]
        version: i32,
        /// JSON input payload
        #[arg(short, long)]
        input: Option<String>,
    },
    /// Inspect workflow details
    Inspect {
        /// Name of the workflow
        name: String,
    },
}

#[derive(Subcommand)]
enum RunCommands {
    /// Inspect a workflow run
    Inspect {
        /// Run ID
        id: String,
    },
    /// Cancel a workflow run
    Cancel {
        /// Run ID
        id: String,
    },
}

struct ApiClient {
    base_url: String,
    client: Client,
}

impl ApiClient {
    fn new(base_url: Option<String>, api_key: Option<String>) -> anyhow::Result<Self> {
        let base_url = base_url.unwrap_or_else(|| {
            env::var("AXIOM_API_URL").unwrap_or_else(|_| "http://localhost:8000".to_string())
        });
        let api_key = api_key.unwrap_or_else(|| env::var("AXIOM_API_KEY").unwrap_or_default());

        let mut headers = HeaderMap::new();
        if !api_key.is_empty() {
            let auth_value = HeaderValue::from_str(&format!("Bearer {}", api_key))
                .map_err(|_| anyhow::anyhow!("Invalid AXIOM_API_KEY formatting"))?;
            headers.insert(AUTHORIZATION, auth_value);
        }

        let client = Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(10))
            .build()?;

        Ok(Self { base_url, client })
    }

    async fn handle_response(&self, res: reqwest::Response) -> anyhow::Result<Value> {
        let status = res.status();
        let body: Value = res.json().await.unwrap_or(serde_json::json!({}));
        if status.is_success() {
            Ok(body)
        } else {
            let msg = if let Some(err) = body.get("error") {
                format!(
                    "{}: {}",
                    err.get("code")
                        .and_then(|v| v.as_str())
                        .unwrap_or("UNKNOWN"),
                    err.get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error")
                )
            } else {
                format!("HTTP {}", status)
            };
            anyhow::bail!("API Request Failed: {}", msg);
        }
    }

    async fn get(&self, path: &str) -> anyhow::Result<Value> {
        let res = self
            .client
            .get(&format!("{}{}", self.base_url, path))
            .send()
            .await?;
        self.handle_response(res).await
    }

    async fn post(&self, path: &str, body: &Value) -> anyhow::Result<Value> {
        let res = self
            .client
            .post(&format!("{}{}", self.base_url, path))
            .json(body)
            .send()
            .await?;
        self.handle_response(res).await
    }
}

async fn find_workflow_by_name(
    api: &ApiClient,
    name: &str,
    exact_version: Option<i32>,
) -> anyhow::Result<Value> {
    let res = api.get(&format!("/v1/workflows?name={}", name)).await?;
    let data = res
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow::anyhow!("Invalid response"))?;

    let mut matches: Vec<Value> = data.iter().cloned().collect();
    if let Some(v) = exact_version {
        matches.retain(|w| w.get("version").and_then(|val| val.as_i64()) == Some(v as i64));
    } else {
        // Sort by version desc
        matches.sort_by_key(|w| w.get("version").and_then(|v| v.as_i64()).unwrap_or(0));
        matches.reverse();
    }

    if matches.is_empty() {
        if let Some(v) = exact_version {
            anyhow::bail!("Workflow '{}' at version {} not found", name, v);
        } else {
            anyhow::bail!("Workflow '{}' not found", name);
        }
    }

    Ok(matches.first().unwrap().clone())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let api = ApiClient::new(None, None)?;

    match cli.command {
        Commands::Workflow { command } => match command {
            WorkflowCommands::List { name } => {
                let mut path = "/v1/workflows".to_string();
                if let Some(n) = name {
                    path = format!("{}?name={}", path, n);
                }
                let res = api.get(&path).await?;
                if cli.json {
                    println!("{}", serde_json::to_string_pretty(&res)?);
                } else {
                    let data = res.get("data").and_then(|v| v.as_array()).unwrap();
                    if data.is_empty() {
                        println!("No workflows found.");
                    } else {
                        let mut table = comfy_table::Table::new();
                        table.set_header(vec!["ID", "Name", "Version", "Status", "Created At"]);
                        for row in data {
                            table.add_row(vec![
                                row.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                                row.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                                &row.get("version")
                                    .and_then(|v| v.as_i64())
                                    .unwrap_or(0)
                                    .to_string(),
                                row.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                                row.get("created_at").and_then(|v| v.as_str()).unwrap_or(""),
                            ]);
                        }
                        println!("{table}");
                    }
                }
            }
            WorkflowCommands::Run {
                name,
                version,
                input,
            } => {
                let wf = find_workflow_by_name(&api, &name, Some(version)).await?;
                let wf_id = wf.get("id").and_then(|v| v.as_str()).unwrap();

                let input_json: Option<Value> = if let Some(i) = input {
                    Some(
                        serde_json::from_str(&i)
                            .map_err(|_| anyhow::anyhow!("Invalid JSON input"))?,
                    )
                } else {
                    None
                };

                let body = serde_json::json!({
                    "input": input_json
                });

                let res = api
                    .post(&format!("/v1/workflows/{}/runs", wf_id), &body)
                    .await?;

                if cli.json {
                    println!("{}", serde_json::to_string_pretty(&res)?);
                } else {
                    let data = res.get("data").unwrap();
                    println!("Successfully started workflow run!");
                    println!(
                        "Run ID:          {}",
                        data.get("id").and_then(|v| v.as_str()).unwrap_or("")
                    );
                    println!("Workflow Name:   {}", name);
                    println!(
                        "Bound Version:   {}",
                        data.get("workflow_version")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0)
                    );
                    println!(
                        "Status:          {}",
                        data.get("status").and_then(|v| v.as_str()).unwrap_or("")
                    );
                }
            }
            WorkflowCommands::Inspect { name } => {
                let wf = find_workflow_by_name(&api, &name, None).await?;
                let wf_id = wf.get("id").and_then(|v| v.as_str()).unwrap();
                let res = api.get(&format!("/v1/workflows/{}", wf_id)).await?;

                if cli.json {
                    println!("{}", serde_json::to_string_pretty(&res)?);
                } else {
                    let data = res.get("data").unwrap();
                    println!("Workflow Inspect");
                    println!("----------------");
                    println!(
                        "ID:           {}",
                        data.get("id").and_then(|v| v.as_str()).unwrap_or("")
                    );
                    println!(
                        "Name:         {}",
                        data.get("name").and_then(|v| v.as_str()).unwrap_or("")
                    );
                    println!(
                        "Version:      {}",
                        data.get("version").and_then(|v| v.as_i64()).unwrap_or(0)
                    );
                    println!(
                        "Status:       {}",
                        data.get("status").and_then(|v| v.as_str()).unwrap_or("")
                    );
                    println!(
                        "Created At:   {}",
                        data.get("created_at")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                    );

                    if let Some(stats) = data.get("stats") {
                        println!("\nAnalytics:");
                        println!(
                            "Total Runs:   {}",
                            stats
                                .get("total_runs")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0)
                        );
                        println!(
                            "Active Runs:  {}",
                            stats
                                .get("active_runs")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0)
                        );
                        println!(
                            "Success Rate: {:.2}%",
                            stats
                                .get("success_rate")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0)
                                * 100.0
                        );
                    }
                }
            }
        },
        Commands::Run { command } => match command {
            RunCommands::Inspect { id } => {
                let res = api.get(&format!("/v1/runs/{}", id)).await?;
                if cli.json {
                    println!("{}", serde_json::to_string_pretty(&res)?);
                } else {
                    let data = res.get("data").unwrap();
                    println!("Run Inspect");
                    println!("-----------");
                    println!(
                        "Run ID:           {}",
                        data.get("id").and_then(|v| v.as_str()).unwrap_or("")
                    );
                    println!(
                        "Workflow Name:    {}",
                        data.get("workflow_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                    );
                    println!(
                        "Workflow Version: {}",
                        data.get("workflow_version")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0)
                    );
                    println!(
                        "Status:           {}",
                        data.get("status").and_then(|v| v.as_str()).unwrap_or("")
                    );
                    println!(
                        "Created At:       {}",
                        data.get("created_at")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                    );
                    if let Some(err) = data.get("error") {
                        if !err.is_null() {
                            println!(
                                "Error:            {}",
                                serde_json::to_string(err).unwrap_or_default()
                            );
                        }
                    }

                    if let Some(steps) = data.get("steps").and_then(|v| v.as_array()) {
                        if !steps.is_empty() {
                            println!("\nSteps:");
                            let mut table = comfy_table::Table::new();
                            table.set_header(vec!["Step ID", "Attempt", "Status", "Duration (ms)"]);
                            for step in steps {
                                table.add_row(vec![
                                    step.get("step_id").and_then(|v| v.as_str()).unwrap_or(""),
                                    &step
                                        .get("attempt")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0)
                                        .to_string(),
                                    step.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                                    &step
                                        .get("duration_ms")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0)
                                        .to_string(),
                                ]);
                            }
                            println!("{table}");
                        }
                    }
                }
            }
            RunCommands::Cancel { id } => {
                let body = serde_json::json!({});
                let res = api.post(&format!("/v1/runs/{}/cancel", id), &body).await?;
                if cli.json {
                    println!("{}", serde_json::to_string_pretty(&res)?);
                } else {
                    let data = res.get("data").unwrap();
                    println!("Run {} cancelled successfully.", id);
                    println!(
                        "New Status: {}",
                        data.get("status").and_then(|v| v.as_str()).unwrap_or("")
                    );
                }
            }
        },
        Commands::Logs => {
            if cli.json {
                println!(r#"{{"error":"Logs feature is not supported by the backend API yet."}}"#);
            } else {
                println!("Error: Logs feature is not supported by the backend API yet.");
            }
        }
        Commands::Workers => {
            if cli.json {
                println!(
                    r#"{{"error":"Worker discovery/status is not exposed by the backend API yet."}}"#
                );
            } else {
                println!("Error: Worker discovery/status is not exposed by the backend API yet.");
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_api_client_auth_header() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/v1/workflows"))
            .and(header("Authorization", "Bearer test-secret-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": []})))
            .mount(&mock_server)
            .await;

        let api =
            ApiClient::new(Some(mock_server.uri()), Some("test-secret-key".to_string())).unwrap();

        let res = api.get("/v1/workflows").await.unwrap();
        assert_eq!(res.get("data").unwrap().as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_non_2xx_error_parsing() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/v1/workflows"))
            .respond_with(ResponseTemplate::new(403).set_body_json(json!({
                "error": {
                    "code": "FORBIDDEN",
                    "message": "Invalid API key"
                }
            })))
            .mount(&mock_server)
            .await;

        let api = ApiClient::new(Some(mock_server.uri()), None).unwrap();

        let err = api.get("/v1/workflows").await.unwrap_err();
        assert_eq!(
            err.to_string(),
            "API Request Failed: FORBIDDEN: Invalid API key"
        );
    }

    #[tokio::test]
    async fn test_find_workflow_by_name_exact_version() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/v1/workflows"))
            .and(query_param("name", "test-flow"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [
                    { "id": "uuid-1", "name": "test-flow", "version": 1 },
                    { "id": "uuid-2", "name": "test-flow", "version": 2 }
                ]
            })))
            .mount(&mock_server)
            .await;

        let api = ApiClient::new(Some(mock_server.uri()), None).unwrap();

        let wf = find_workflow_by_name(&api, "test-flow", Some(1))
            .await
            .unwrap();
        assert_eq!(wf.get("id").unwrap().as_str().unwrap(), "uuid-1");
    }

    #[tokio::test]
    async fn test_find_workflow_by_name_latest_version() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/v1/workflows"))
            .and(query_param("name", "test-flow"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [
                    { "id": "uuid-1", "name": "test-flow", "version": 1 },
                    { "id": "uuid-2", "name": "test-flow", "version": 2 }
                ]
            })))
            .mount(&mock_server)
            .await;

        let api = ApiClient::new(Some(mock_server.uri()), None).unwrap();

        let wf = find_workflow_by_name(&api, "test-flow", None)
            .await
            .unwrap();
        assert_eq!(wf.get("id").unwrap().as_str().unwrap(), "uuid-2");
    }
}
