use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::util::ServiceExt;

mod helpers;
use helpers::TestUser;

#[tokio::test]
async fn test_static_site_functionality() {
    let app = create_test_app().await;

    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();

    // Create test blobs for the static site
    // Blob 1: HTML content
    let html_content = b"<html><body><h1>Hello World</h1></body></html>".to_vec();
    let (_body_hash1, tree_hash1, signature1) = user.sign_chained_data("", &html_content);

    // Store the first blob (HTML file)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash1)
                .header("X-Tributary-Authorization", &signature1)
                .body(Body::from(html_content.clone()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Blob 2: JSON content
    let json_content = br#"{"message": "Hello from JSON"}"#.to_vec();
    let (_body_hash2, tree_hash2, signature2) = user.sign_chained_data(&tree_hash1, &json_content);

    // Store the second blob (JSON file)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash2)
                .header("X-Tributary-Authorization", &signature2)
                .body(Body::from(json_content.clone()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Blob 3: PNG content (mock)
    let png_content = b"PNG mock content".to_vec();
    let (_body_hash3, tree_hash3, signature3) = user.sign_chained_data(&tree_hash2, &png_content);

    // Store the third blob (PNG file)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash3)
                .header("X-Tributary-Authorization", &signature3)
                .body(Body::from(png_content.clone()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Create the directory structure as the final blob
    let directory_structure = json!({
        "directory": {
            "index.html": { "ix": 0, "content-type": "text/html" },
            "data.json": { "ix": 1, "content-type": "application/json" },
            "image.png": { "ix": 2, "content-type": "image/png" }
        }
    });

    let directory_bytes = serde_json::to_vec(&directory_structure).unwrap();
    let (_body_hash4, tree_hash4, signature4) =
        user.sign_chained_data(&tree_hash3, &directory_bytes);

    // Store the directory structure as the final blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash4)
                .header("X-Tributary-Authorization", &signature4)
                .body(Body::from(directory_bytes.clone()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Now test serving static files
    // Test serving index.html
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/{}/static/index.html", url_encoded_pubkey))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response.headers().get("content-type").unwrap();
    assert_eq!(content_type, "text/html");

    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(body_bytes.as_ref(), html_content.as_slice());

    // Test serving data.json
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/{}/static/data.json", url_encoded_pubkey))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response.headers().get("content-type").unwrap();
    assert_eq!(content_type, "application/json");

    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(body_bytes.as_ref(), json_content.as_slice());

    // Test serving image.png
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/{}/static/image.png", url_encoded_pubkey))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response.headers().get("content-type").unwrap();
    assert_eq!(content_type, "image/png");

    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(body_bytes.as_ref(), png_content.as_slice());

    // Test serving a non-existent file
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/{}/static/nonexistent.html", url_encoded_pubkey))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // Test serving from a collection that doesn't have a static site
    let user2 = TestUser::new();
    let url_encoded_pubkey2 = user2.get_url_encoded_pubkey();

    // Create just a single blob without directory structure
    let simple_content = b"Simple content".to_vec();
    let (_body_hash, tree_hash, signature) = user2.sign_chained_data("", &simple_content);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey2))
                .header("X-Tributary-Hash", &tree_hash)
                .header("X-Tributary-Authorization", &signature)
                .body(Body::from(simple_content))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Try to access static content from this collection
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/{}/static/anything.html", url_encoded_pubkey2))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

// Helper function to create a test app
async fn create_test_app() -> axum::Router {
    use tributary_server::api;
    use tributary_server::db::Database;

    // Use a test database with the correct connection details from .env
    let database_url = "postgresql://postgres:your-super-secret-and-long-postgres-password@supabase-db:5432/postgres".to_string();

    let db = Database::new(&database_url)
        .await
        .expect("Failed to connect to test database");

    // Clear any existing test data to prevent interference between tests
    db.clear_all_test_data()
        .await
        .expect("Failed to clear test data");

    axum::Router::new()
        .route("/health", axum::routing::get(health_check))
        .route("/:encoded_pubkey", axum::routing::post(api::store_blob))
        .route(
            "/:encoded_pubkey/:id",
            axum::routing::get(api::retrieve_blob),
        )
        .route(
            "/:encoded_pubkey/info",
            axum::routing::get(api::get_collection_info),
        )
        .route(
            "/:encoded_pubkey/latest",
            axum::routing::get(api::get_latest_blob),
        )
        .route(
            "/:encoded_pubkey/static/*path",
            axum::routing::get(api::serve_static_file),
        )
        .with_state(db)
}

async fn health_check() -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "status": "healthy",
            "service": "tributary-server"
        })),
    )
}
