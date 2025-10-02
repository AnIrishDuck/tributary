use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::util::ServiceExt; // for `oneshot` and `ready`
use axum::body::to_bytes;

mod helpers;
use helpers::TestUser;

// Integration tests for tributary-server
#[tokio::test]
async fn test_health_check() {
    let app = create_test_app().await;
    
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["status"], "healthy");
}

#[tokio::test]
async fn test_store_and_retrieve_blob() {
    let app = create_test_app().await;
    
    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!("test_store_and_retrieve_blob: Using pubkey: {}", user.pubkey_base64);
    
    // Create test data
    let test_data = b"Hello, Tributary!";
    let (body_hash, hash, signature) = user.sign_chained_data("", test_data); // Empty prior hash for first blob
    
    let blob_id = "test-blob-1";
    
    // Store the blob
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id))
                .header("X-Tributary-Hash", &body_hash)  // Send body hash, not tree hash
                .header("X-Tributary-Authorization", &signature)
                .body(Body::from(&test_data[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["status"], "stored");
    assert_eq!(body["id"], blob_id);
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["sequence_number"], 1);
    
    // Retrieve the blob
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["id"], blob_id);
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["hash"], hash);
    assert_eq!(body["prior_hash"], "");
    assert_eq!(body["sequence_number"], 1);
    
    let returned_data = body["data"].as_array().unwrap();
    let returned_bytes: Vec<u8> = returned_data.iter().map(|x| x.as_u64().unwrap() as u8).collect();
    assert_eq!(returned_bytes, test_data);
}

#[tokio::test]
async fn test_store_blob_with_invalid_signature() {
    let app = create_test_app().await;
    
    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!("test_store_blob_with_invalid_signature: Using pubkey: {}", user.pubkey_base64);
    
    // Create test data
    let test_data = b"Hello, Tributary!";
    let body_hash = user.compute_hash(test_data);
    
    // Create an invalid signature (from a different key)
    let attacker = TestUser::new();
    let (_, _, invalid_signature) = attacker.sign_chained_data("", test_data);
    
    let blob_id = "test-blob-2";
    
    // Try to store the blob with invalid signature
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id))
                .header("X-Tributary-Hash", &body_hash)
                .header("X-Tributary-Authorization", &invalid_signature)
                .body(Body::from(&test_data[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    // Should get UNAUTHORIZED for invalid signature
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_cannot_overwrite_blob() {
    let app = create_test_app().await;
    
    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!("test_cannot_overwrite_blob: Using pubkey: {}", user.pubkey_base64);
    
    // Create test data
    let test_data1 = b"First version";
    let (body_hash1, hash1, signature1) = user.sign_chained_data("", test_data1);
    
    let test_data2 = b"Second version";
    let body_hash2 = user.compute_hash(test_data2);
    let (_, _, signature2) = user.sign_chained_data(&hash1, test_data2);
    
    let blob_id = "test-blob-3";
    
    // Store the first version
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id))
                .header("X-Tributary-Hash", &body_hash1)  // Send body hash, not tree hash
                .header("X-Tributary-Authorization", &signature1)
                .body(Body::from(&test_data1[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    // First insert should succeed
    assert_eq!(response.status(), StatusCode::OK);

    // Try to store a second version with the same ID
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id))
                .header("X-Tributary-Hash", &body_hash2)
                .header("X-Tributary-Authorization", &signature2)
                .body(Body::from(&test_data2[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    // Second insert should return CONFLICT
    assert_eq!(response.status(), StatusCode::CONFLICT);
    
    // Retrieve the blob - should still be the first version
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["hash"], hash1);
    
    let returned_data = body["data"].as_array().unwrap();
    let returned_bytes: Vec<u8> = returned_data.iter().map(|x| x.as_u64().unwrap() as u8).collect();
    assert_eq!(returned_bytes, test_data1);
}

#[tokio::test]
async fn test_retrieve_nonexistent_blob() {
    let app = create_test_app().await;
    
    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!("test_retrieve_nonexistent_blob: Using pubkey: {}", user.pubkey_base64);
    
    let blob_id = "nonexistent-blob";
    
    // Try to retrieve a blob that doesn't exist
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    // If the body is empty, that's okay for a 404
    if !body_bytes.is_empty() {
        let body: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(body["error"], "Blob not found");
    }
}

#[tokio::test]
async fn test_chained_hashing_and_merkle_tree() {
    let app = create_test_app().await;
    
    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!("test_chained_hashing_and_merkle_tree: Using pubkey: {}", user.pubkey_base64);
    
    // Create first blob
    let test_data1 = b"First blob in chain";
    let (body_hash1, hash1, signature1) = user.sign_chained_data("", test_data1); // Empty prior hash for first blob
    
    let blob_id1 = "chain-blob-1";
    
    // Store the first blob
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id1))
                .header("X-Tributary-Hash", &body_hash1)  // Send body hash, not tree hash
                .header("X-Tributary-Authorization", &signature1)
                .body(Body::from(&test_data1[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    
    // Create second blob (should use hash1 as prior hash)
    let test_data2 = b"Second blob in chain";
    let (body_hash2, hash2, signature2) = user.sign_chained_data(&hash1, test_data2); // Use hash1 as prior hash
    
    let blob_id2 = "chain-blob-2";
    
    // Store the second blob
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id2))
                .header("X-Tributary-Hash", &body_hash2)  // Send body hash, not tree hash
                .header("X-Tributary-Authorization", &signature2)
                .body(Body::from(&test_data2[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["status"], "stored");
    assert_eq!(body["id"], blob_id2);
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["sequence_number"], 2);
    
    // Retrieve the second blob and verify chaining
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id2))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["id"], blob_id2);
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["hash"], hash2);
    assert_eq!(body["prior_hash"], hash1); // Should match the first blob's hash
    assert_eq!(body["sequence_number"], 2);
    
    let returned_data = body["data"].as_array().unwrap();
    let returned_bytes: Vec<u8> = returned_data.iter().map(|x| x.as_u64().unwrap() as u8).collect();
    assert_eq!(returned_bytes, test_data2);
}

#[tokio::test]
async fn test_signature_verification_in_chain() {
    let app = create_test_app().await;
    
    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!("test_signature_verification_in_chain: Using pubkey: {}", user.pubkey_base64);
    
    // Create first blob
    let test_data1 = b"First blob for signature test";
    let (body_hash1, hash1, signature1) = user.sign_chained_data("", test_data1);
    
    let blob_id1 = "signature-test-1";
    
    // Store the first blob
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id1))
                .header("X-Tributary-Hash", &body_hash1)  // Send body hash, not tree hash
                .header("X-Tributary-Authorization", &signature1)
                .body(Body::from(&test_data1[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    
    // Create second blob with valid signature
    let test_data2 = b"Second blob for signature test";
    let (body_hash2, _hash2, signature2) = user.sign_chained_data(&hash1, test_data2);
    
    let blob_id2 = "signature-test-2";
    
    // Store the second blob
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id2))
                .header("X-Tributary-Hash", &body_hash2)
                .header("X-Tributary-Authorization", &signature2)
                .body(Body::from(&test_data2[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    
    // Try to store a third blob with an invalid signature
    let test_data3 = b"Third blob with invalid signature";
    let body_hash3 = user.compute_hash(test_data3);
    
    // Create an invalid signature by signing with wrong data
    let (_, _, invalid_signature) = user.sign_chained_data(&hash1, test_data3); // Wrong prior hash
    
    let blob_id3 = "signature-test-3";
    
    // Try to store with invalid signature
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}/{}", url_encoded_pubkey, blob_id3))
                .header("X-Tributary-Hash", &body_hash3)
                .header("X-Tributary-Authorization", &invalid_signature)
                .body(Body::from(&test_data3[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    // Should get UNAUTHORIZED for invalid signature
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// Helper function to create a test app
async fn create_test_app() -> axum::Router {
    use tributary_server::api;
    use tributary_server::db::Database;
    
    // Use a test database with the correct connection details from .env
    let database_url = "postgresql://postgres:your-super-secret-and-long-postgres-password@supabase-db:5432/postgres".to_string();
    
    let db = Database::new(&database_url).await.expect("Failed to connect to test database");
    
    // Clear any existing test data to prevent interference between tests
    db.clear_all_test_data().await.expect("Failed to clear test data");
    
    axum::Router::new()
        .route("/health", axum::routing::get(health_check))
        .route("/:encoded_pubkey/:id", axum::routing::post(api::store_blob))
        .route("/:encoded_pubkey/:id", axum::routing::get(api::retrieve_blob))
        .with_state(db)
}

async fn health_check() -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::OK,
        axum::Json(serde_json::json!({
            "status": "healthy",
            "service": "tributary-server"
        }))
    )
}
