use crate::crypto::{compute_chain_hash, compute_hash, verify_signature};
use crate::db::Database;
use crate::models::{Blob, SignatureVerificationRequest};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{Json, Response},
};
use chrono::Utc;
use serde_json::{json, Value};
use std::collections::HashMap;

// Helper function to compute a deterministic ID for a public key
fn compute_pubkey_id(pubkey: &str) -> String {
    // The 'pubkey' parameter is already the base64-encoded public key (URL-decoded from path)
    // We want to use this directly in the ID to match the pubkey field in the database
    pubkey.to_string()
}

// POST /:encoded_pubkey
#[axum::debug_handler]
pub async fn store_blob(
    State(db): State<Database>,
    Path(encoded_pubkey): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> (StatusCode, Json<serde_json::Value>) {
    println!(
        "DEBUG: Received blob storage request for pubkey: {}",
        encoded_pubkey
    );
    println!("DEBUG: Body length: {} bytes", body.len());
    // DEBUG: Print first 16 bytes of the body for comparison
    let preview_bytes: Vec<u8> = body.slice(0..std::cmp::min(16, body.len())).to_vec();
    println!("DEBUG: First 16 bytes of body: {:?}", preview_bytes);

    // Extract headers
    let provided_hash = match headers.get("X-Tributary-Hash") {
        Some(hash) => match hash.to_str() {
            Ok(h) => h,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "Invalid X-Tributary-Hash header"})),
                )
            }
        },
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Missing X-Tributary-Hash header"})),
            )
        }
    };

    let signature = match headers.get("X-Tributary-Authorization") {
        Some(sig) => match sig.to_str() {
            Ok(s) => s,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "Invalid X-Tributary-Authorization header"})),
                )
            }
        },
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Missing X-Tributary-Authorization header"})),
            )
        }
    };

    // Get the previous blob to compute the chain
    let latest_blob = match db.get_latest_blob(&encoded_pubkey).await {
        Ok(Some(blob)) => blob,
        Ok(None) => {
            // This is the first blob in the chain
            crate::models::BlobMetadata {
                id: String::new(),
                pubkey: encoded_pubkey.clone(),
                hash: String::new(),
                prior_hash: String::new(),
                signature: String::new(),
                sequence_number: 0,
                created_at: Utc::now().naive_utc(),
                data: vec![],
            }
        }
        Err(e) => {
            eprintln!("Database error: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to retrieve latest blob"})),
            );
        }
    };

    // Compute the body hash
    let body_hash = compute_hash(&body);
    println!("DEBUG: Computed body hash: {}", body_hash);

    // The expected hash is computed using chain hash function - this ensures fixed-length hashes
    let expected_hash = compute_chain_hash(&latest_blob.hash, &body);
    println!("DEBUG: Computed expected hash: {}", expected_hash);

    // Validate that the provided hash matches our expectation
    if provided_hash != expected_hash {
        // Hash mismatch - client is out of sync
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Hash mismatch - possible chain mismatch",
                "expected_hash": expected_hash,
                "provided_hash": provided_hash,
                "body_hash": body_hash,  // Include the computed body hash
                "latest_sequence_number": latest_blob.sequence_number,
                "latest_hash": latest_blob.hash
            })),
        );
    }

    // Create the data that should have been signed (the hash)
    let expected_data_to_sign = expected_hash.as_bytes().to_vec();

    // Verify the signature against the expected data
    let verification_request = SignatureVerificationRequest {
        pubkey: encoded_pubkey.clone(),
        signature: signature.to_string(),
        data: expected_data_to_sign,
    };

    match verify_signature(&verification_request) {
        Ok(true) => {
            // Signature is valid, proceed with storing
            let next_sequence_number = latest_blob.sequence_number + 1;
            // Generate the blob ID as pubkey hash + sequence number
            let pubkey_id = compute_pubkey_id(&encoded_pubkey);
            let blob_id = format!("{}:{}", pubkey_id, next_sequence_number);

            let blob = Blob {
                id: blob_id.clone(),
                pubkey: encoded_pubkey.clone(),
                data: body.to_vec(),
                hash: expected_hash.to_string(),
                prior_hash: latest_blob.hash.clone(),
                signature: signature.to_string(),
                sequence_number: next_sequence_number,
                created_at: Utc::now().naive_utc(),
            };

            match db.store_blob(&blob).await {
                Ok(true) => {
                    // Successfully inserted new blob
                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": "stored",
                            "id": blob_id,
                            "pubkey": encoded_pubkey,
                            "sequence_number": blob.sequence_number,
                            "hash": blob.hash
                        })),
                    )
                }
                Ok(false) => {
                    // Blob already exists (conflict)
                    (
                        StatusCode::CONFLICT,
                        Json(json!({"error": "Blob already exists"})),
                    )
                }
                Err(e) => {
                    eprintln!("Database error: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": "Failed to store blob"})),
                    )
                }
            }
        }
        Ok(false) => {
            // On signature verification failure, return latest blob info to help client sync
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid signature - possible chain mismatch",
                    "latest_sequence_number": latest_blob.sequence_number,
                    "latest_hash": latest_blob.hash
                })),
            )
        }
        Err(e) => {
            eprintln!("Signature verification error: {}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Signature verification failed"})),
            )
        }
    }
}

// GET /:encoded_pubkey/:id
#[axum::debug_handler]
pub async fn retrieve_blob(
    State(db): State<Database>,
    Path((encoded_pubkey, id)): Path<(String, String)>,
) -> (StatusCode, Json<serde_json::Value>) {
    match db.retrieve_blob(&encoded_pubkey, &id).await {
        Ok(Some(blob)) => (
            StatusCode::OK,
            Json(json!({
                "id": blob.id,
                "pubkey": blob.pubkey,
                "data": blob.data,
                "hash": blob.hash,
                "prior_hash": blob.prior_hash,
                "signature": blob.signature,
                "sequence_number": blob.sequence_number,
                "created_at": blob.created_at.to_string()
            })),
        ),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Blob not found"})),
        ),
        Err(e) => {
            eprintln!("Database error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to retrieve blob"})),
            )
        }
    }
}

// GET /:encoded_pubkey/info
#[axum::debug_handler]
pub async fn get_collection_info(
    State(db): State<Database>,
    Path(encoded_pubkey): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    match db.get_collection_info(&encoded_pubkey).await {
        Ok(info) => (
            StatusCode::OK,
            Json(json!({
                "pubkey": encoded_pubkey,
                "blob_count": info.blob_count,
                "first_blob_timestamp": info.first_blob_timestamp.map(|ts| ts.to_string()),
                "last_blob_timestamp": info.last_blob_timestamp.map(|ts| ts.to_string()),
            })),
        ),
        Err(e) => {
            eprintln!("Database error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to retrieve collection info"})),
            )
        }
    }
}

// GET /:encoded_pubkey/latest
#[axum::debug_handler]
pub async fn get_latest_blob(
    State(db): State<Database>,
    Path(encoded_pubkey): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    match db.get_latest_blob(&encoded_pubkey).await {
        Ok(Some(blob)) => (
            StatusCode::OK,
            Json(json!({
                "id": blob.id,
                "pubkey": blob.pubkey,
                "hash": blob.hash,
                "prior_hash": blob.prior_hash,
                "signature": blob.signature,
                "sequence_number": blob.sequence_number,
                "created_at": blob.created_at.to_string(),
                "data": blob.data
            })),
        ),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "No blobs found for this pubkey"})),
        ),
        Err(e) => {
            eprintln!("Database error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to retrieve latest blob"})),
            )
        }
    }
}

// GET /:encoded_pubkey/static/:path
#[axum::debug_handler]
pub async fn serve_static_file(
    State(db): State<Database>,
    Path((encoded_pubkey, path)): Path<(String, String)>,
) -> Response {
    // First, get the latest blob to check if it contains the static site directory
    let latest_blob = match db.get_latest_blob(&encoded_pubkey).await {
        Ok(Some(blob)) => blob,
        Ok(None) => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(axum::body::Body::from("Collection not found"))
                .unwrap();
        }
        Err(e) => {
            eprintln!("Database error: {}", e);
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(axum::body::Body::from("Failed to retrieve collection info"))
                .unwrap();
        }
    };

    // Parse the latest blob data as JSON to see if it's a static site directory
    let json_value: Value = match serde_json::from_slice(&latest_blob.data) {
        Ok(value) => value,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(axum::body::Body::from("Not a static site"))
                .unwrap();
        }
    };

    // Check if it has the directory structure
    let directory_obj = match json_value.get("directory") {
        Some(dir) => dir,
        None => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(axum::body::Body::from("Not a static site"))
                .unwrap();
        }
    };

    // Parse the directory structure
    let static_site_dir: HashMap<String, crate::models::StaticSiteFile> =
        match serde_json::from_value(directory_obj.clone()) {
            Ok(dir) => dir,
            Err(_) => {
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(axum::body::Body::from("Invalid directory structure"))
                    .unwrap();
            }
        };

    // Check if the requested path exists in the directory
    let static_file_info = match static_site_dir.get(&path) {
        Some(info) => info,
        None => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(axum::body::Body::from("File not found"))
                .unwrap();
        }
    };

    // Get the blob corresponding to the file index
    let blob_id = format!("{}:{}", encoded_pubkey, static_file_info.ix + 1); // 1-indexed sequence numbers
    let blob = match db.retrieve_blob(&encoded_pubkey, &blob_id).await {
        Ok(Some(blob)) => blob,
        Ok(None) => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(axum::body::Body::from("File blob not found"))
                .unwrap();
        }
        Err(e) => {
            eprintln!("Database error: {}", e);
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(axum::body::Body::from("Failed to retrieve file"))
                .unwrap();
        }
    };

    // Return the blob data with the specified content type
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", &static_file_info.content_type)
        .body(axum::body::Body::from(blob.data))
        .unwrap()
}
