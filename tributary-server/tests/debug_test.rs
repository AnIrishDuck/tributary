use axum::{body::Body, http::Request};
use tower::util::ServiceExt; // for `oneshot` and `ready`

#[tokio::test]
async fn debug_route_matching() {
    use tributary_server::api;
    use tributary_server::db::Database;

    // Use a test database with the correct connection details from .env
    let database_url = "postgresql://postgres:your-super-secret-and-long-postgres-password@supabase-db:5432/postgres".to_string();

    let db_result = Database::new(&database_url).await;
    assert!(db_result.is_ok(), "Failed to connect to database");
    let db = db_result.unwrap();

    let app = axum::Router::new()
        .route("/health", axum::routing::get(|| async { "Health check" }))
        .route("/:encoded_pubkey/:id", axum::routing::post(api::store_blob))
        .route(
            "/:encoded_pubkey/:id",
            axum::routing::get(api::retrieve_blob),
        )
        .with_state(db);

    // Test a simple GET request first
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/some-pubkey/some-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    println!("GET response status: {}", response.status());

    // Test a simple POST request with proper headers
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/some-pubkey/some-id")
                .header("X-Tributary-Hash", "some-hash")
                .header("X-Tributary-Authorization", "some-signature")
                .body(Body::from("test data"))
                .unwrap(),
        )
        .await
        .unwrap();

    println!("POST response status: {}", response.status());

    // Test another POST request that should work (no body, missing headers)
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/some-pubkey/some-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    println!("POST response status (no headers): {}", response.status());
}
