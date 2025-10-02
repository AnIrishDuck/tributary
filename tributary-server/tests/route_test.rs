use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::util::ServiceExt; // for `oneshot` and `ready`
use axum::Json;
use serde_json::json;

async fn test_get_handler() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(json!({"method": "GET"})))
}

async fn test_post_handler() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(json!({"method": "POST"})))
}

#[tokio::test]
async fn test_route_combining() {
    let app = axum::Router::new()
        .route("/test/:id", axum::routing::get(test_get_handler).post(test_post_handler));
    
    // Test GET request
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/test/123")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    println!("GET response status: {}", response.status());
    
    // Test POST request
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/test/123")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    println!("POST response status: {}", response.status());
}
