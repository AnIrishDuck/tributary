use axum::{
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use tributary_server::api;
use tributary_server::db::Database;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tributary_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Initialize database
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost:5432/postgres".to_string());
    let db = Database::new(&database_url).await?;

    // Build our application with routes
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/:encoded_pubkey/:id", post(api::store_blob))
        .route("/:encoded_pubkey/:id", get(api::retrieve_blob))
        .route("/:encoded_pubkey/info", get(api::get_collection_info))
        .with_state(db)
        .layer(TraceLayer::new_for_http());

    // Get the server address from environment or use default
    let server_address =
        std::env::var("SERVER_ADDRESS").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
    let addr: SocketAddr = server_address.parse()?;

    println!("Starting Tributary server at {}", addr);

    // Run the server
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;

    Ok(())
}

async fn health_check() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "status": "healthy",
            "service": "tributary-server"
        })),
    )
}
