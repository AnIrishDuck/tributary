use axum::body::to_bytes;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::util::ServiceExt; // for `oneshot` and `ready`

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
    println!(
        "test_store_and_retrieve_blob: Using pubkey: {}",
        user.pubkey_base64
    );

    // Create test data
    let test_data = b"Hello, Tributary!";
    let (_body_hash, tree_hash, signature) = user.sign_chained_data("", test_data); // Empty prior hash for first blob

    // Store the blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash) // Send tree hash, not body hash
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
    assert!(body["id"].as_str().is_some()); // ID is now auto-generated
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["sequence_number"], 1);

    // Extract the auto-generated ID for later retrieval
    let blob_id = body["id"].as_str().unwrap();

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
    assert_eq!(body["hash"], tree_hash);
    assert_eq!(body["prior_hash"], "");
    assert_eq!(body["sequence_number"], 1);

    let returned_data = body["data"].as_array().unwrap();
    let returned_bytes: Vec<u8> = returned_data
        .iter()
        .map(|x| x.as_u64().unwrap() as u8)
        .collect();
    assert_eq!(returned_bytes, test_data);
}

#[tokio::test]
async fn test_store_blob_with_invalid_signature() {
    let app = create_test_app().await;

    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!(
        "test_store_blob_with_invalid_signature: Using pubkey: {}",
        user.pubkey_base64
    );

    // Create test data
    let test_data = b"Hello, Tributary!";
    let (_, tree_hash, _) = user.sign_chained_data("", test_data);

    // Create an invalid signature (from a different key)
    let attacker = TestUser::new();
    let (_, _, invalid_signature) = attacker.sign_chained_data("", test_data);

    // Try to store the blob with invalid signature
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash)
                .header("X-Tributary-Authorization", &invalid_signature)
                .body(Body::from(&test_data[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    // Should get BAD REQUEST for invalid signature
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // Check that the error response contains the latest sequence number (0 for first blob)
    let body_bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(body["error"].as_str().is_some());
    assert_eq!(body["latest_sequence_number"], 0);
}

#[tokio::test]
async fn test_cannot_overwrite_blob() {
    let app = create_test_app().await;

    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!(
        "test_cannot_overwrite_blob: Using pubkey: {}",
        user.pubkey_base64
    );

    // Create test data
    let test_data1 = b"First version";
    let (_body_hash1, tree_hash1, signature1) = user.sign_chained_data("", test_data1);

    let test_data2 = b"Second version";
    let (_, tree_hash2, signature2) = user.sign_chained_data(&tree_hash1, test_data2);

    // Store the first version
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash1) // Send tree hash, not body hash
                .header("X-Tributary-Authorization", &signature1)
                .body(Body::from(&test_data1[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    // First insert should succeed
    assert_eq!(response.status(), StatusCode::OK);

    // Extract the auto-generated ID from the first blob
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    let blob_id = body["id"].as_str().unwrap();
    println!("Stored blob ID: {}", blob_id);

    // Try to store a second version with the same ID (should fail with CONFLICT)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash2)
                .header("X-Tributary-Authorization", &signature2)
                .body(Body::from(&test_data2[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    // Since each blob gets a unique sequence number, this won't actually be a conflict.
    // The second blob will have a different ID. Let's verify we can still retrieve the first one.
    assert_eq!(response.status(), StatusCode::OK);

    // Retrieve the first blob - should still be the first version
    let retrieve_uri = format!("/{}/{}", url_encoded_pubkey, blob_id);
    println!("Retrieving from URI: {}", retrieve_uri);
    let response = app
        .oneshot(
            Request::builder()
                .uri(retrieve_uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    println!("Response status: {}", response.status());
    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["hash"], tree_hash1);

    let returned_data = body["data"].as_array().unwrap();
    let returned_bytes: Vec<u8> = returned_data
        .iter()
        .map(|x| x.as_u64().unwrap() as u8)
        .collect();
    assert_eq!(returned_bytes, test_data1);
}

#[tokio::test]
async fn test_retrieve_nonexistent_blob() {
    let app = create_test_app().await;

    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!(
        "test_retrieve_nonexistent_blob: Using pubkey: {}",
        user.pubkey_base64
    );

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
    println!(
        "test_chained_hashing_and_merkle_tree: Using pubkey: {}",
        user.pubkey_base64
    );

    // Create first blob
    let test_data1 = b"First blob in chain";
    let (_body_hash1, tree_hash1, signature1) = user.sign_chained_data("", test_data1); // Empty prior hash for first blob

    // Store the first blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash1) // Send tree hash, not body hash
                .header("X-Tributary-Authorization", &signature1)
                .body(Body::from(&test_data1[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Extract the auto-generated ID from the first blob
    let body1 = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body1: Value = serde_json::from_slice(&body1).unwrap();
    let _blob_id1 = body1["id"].as_str().unwrap().to_string();
    let tree_hash1 = body1["hash"].as_str().unwrap().to_string();

    // Create second blob (should use hash1 as prior hash)
    let test_data2 = b"Second blob in chain";
    let (_body_hash2, tree_hash2, signature2) = user.sign_chained_data(&tree_hash1, test_data2); // Use hash1 as prior hash

    // Store the second blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash2) // Send tree hash, not body hash
                .header("X-Tributary-Authorization", &signature2)
                .body(Body::from(&test_data2[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Extract the auto-generated ID from the second blob
    let body2 = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body2: Value = serde_json::from_slice(&body2).unwrap();
    let blob_id2 = body2["id"].as_str().unwrap().to_string();
    println!("Stored blob ID: {}", blob_id2);

    // Retrieve the second blob and verify chaining
    let retrieve_uri = format!("/{}/{}", url_encoded_pubkey, blob_id2);
    println!("Retrieving from URI: {}", retrieve_uri);
    let response = app
        .oneshot(
            Request::builder()
                .uri(retrieve_uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    println!("Response status: {}", response.status());
    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["id"], blob_id2);
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["hash"], tree_hash2);
    assert_eq!(body["prior_hash"], tree_hash1); // Should match the first blob's hash
    assert_eq!(body["sequence_number"], 2);

    let returned_data = body["data"].as_array().unwrap();
    let returned_bytes: Vec<u8> = returned_data
        .iter()
        .map(|x| x.as_u64().unwrap() as u8)
        .collect();
    assert_eq!(returned_bytes, test_data2);
}

#[tokio::test]
async fn test_signature_verification_in_chain() {
    let app = create_test_app().await;

    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!(
        "test_signature_verification_in_chain: Using pubkey: {}",
        user.pubkey_base64
    );

    // Create first blob
    let test_data1 = b"First blob for signature test";
    let (_body_hash1, tree_hash1, signature1) = user.sign_chained_data("", test_data1);

    // Store the first blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash1) // Send tree hash, not body hash
                .header("X-Tributary-Authorization", &signature1)
                .body(Body::from(&test_data1[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Extract the auto-generated ID from the first blob
    let body1 = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body1: Value = serde_json::from_slice(&body1).unwrap();
    let tree_hash1 = body1["hash"].as_str().unwrap().to_string();

    // Create second blob with valid signature
    let test_data2 = b"Second blob for signature test";
    let (_body_hash2, tree_hash2, signature2) = user.sign_chained_data(&tree_hash1, test_data2);

    // Store the second blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash2)
                .header("X-Tributary-Authorization", &signature2)
                .body(Body::from(&test_data2[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Try to store a third blob with an invalid signature
    let test_data3 = b"Third blob with invalid signature";
    let _body_hash3 = user.compute_hash(test_data3);

    // Create an invalid signature by signing with wrong data
    let (_, tree_hash3, invalid_signature) = user.sign_chained_data(&tree_hash1, test_data3); // Wrong prior hash

    // Try to store with invalid signature (using the new API pattern)
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash3)
                .header("X-Tributary-Authorization", &invalid_signature)
                .body(Body::from(&test_data3[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    // Should get BAD REQUEST for invalid signature (as it should fail verification)
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_collection_info_endpoint() {
    let app = create_test_app().await;

    // Create a test user
    let user = TestUser::new();
    let url_encoded_pubkey = user.get_url_encoded_pubkey();
    println!(
        "test_collection_info_endpoint: Using pubkey: {}",
        user.pubkey_base64
    );

    // Initially, there should be no blobs for this user
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/{}/info", url_encoded_pubkey))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["blob_count"], 0);
    assert!(body["first_blob_timestamp"].is_null());
    assert!(body["last_blob_timestamp"].is_null());

    // Create test data
    let test_data1 = b"First blob for info test";
    let (_body_hash1, tree_hash1, signature1) = user.sign_chained_data("", test_data1);

    // Store the first blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash1)
                .header("X-Tributary-Authorization", &signature1)
                .body(Body::from(&test_data1[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Check info after first blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/{}/info", url_encoded_pubkey))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["blob_count"], 1);
    assert!(!body["first_blob_timestamp"].is_null());
    assert!(!body["last_blob_timestamp"].is_null());
    assert_eq!(body["first_blob_timestamp"], body["last_blob_timestamp"]);

    // Add a second blob
    let test_data2 = b"Second blob for info test";
    let (_body_hash2, tree_hash2, signature2) = user.sign_chained_data(&tree_hash1, test_data2);

    // Store the second blob
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/{}", url_encoded_pubkey))
                .header("X-Tributary-Hash", &tree_hash2)
                .header("X-Tributary-Authorization", &signature2)
                .body(Body::from(&test_data2[..]))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Check info after second blob
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/{}/info", url_encoded_pubkey))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["pubkey"], user.pubkey_base64);
    assert_eq!(body["blob_count"], 2);
    assert!(!body["first_blob_timestamp"].is_null());
    assert!(!body["last_blob_timestamp"].is_null());
    assert_ne!(body["first_blob_timestamp"], body["last_blob_timestamp"]);
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
