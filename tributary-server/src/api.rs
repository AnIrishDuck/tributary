use crate::crypto::verify_signature;
use crate::db::Database;
use crate::models::{Blob, SignatureVerificationRequest};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use chrono::Utc;
use hex;
use serde_json::json;
use sha2::{Digest, Sha256};

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
    let body_hash = {
        let mut hasher = Sha256::new();
        hasher.update(&body);
        let result = hasher.finalize();
        hex::encode(result)
    };

    // The expected hash is just prior_hash + body_hash concatenated
    let expected_hash = format!("{}{}", latest_blob.hash, body_hash);

    // Validate that the provided hash matches our expectation
    if provided_hash != expected_hash {
        // Hash mismatch - client is out of sync
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Hash mismatch - possible chain mismatch",
                "expected_hash": expected_hash,
                "provided_hash": provided_hash,
                "latest_sequence_number": latest_blob.sequence_number,
                "latest_hash": latest_blob.hash
            })),
        );
    }

    // Create the data that should have been signed (prior_hash + body_hash)
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
                "created_at": blob.created_at.to_string()
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
