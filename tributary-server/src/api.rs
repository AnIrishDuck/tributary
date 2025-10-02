use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use serde_json::json;
use crate::models::{SignatureVerificationRequest, Blob};
use crate::crypto::{verify_signature, compute_merkle_hash};
use crate::db::Database;
use chrono::Utc;
use base64::{Engine as _, engine::general_purpose};

// POST /:encoded_pubkey/:id
#[axum::debug_handler]
pub async fn store_blob(
    State(db): State<Database>,
    Path((encoded_pubkey, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> (StatusCode, Json<serde_json::Value>) {
    // Extract headers
    let body_hash = match headers.get("X-Tributary-Hash") {
        Some(hash) => match hash.to_str() {
            Ok(h) => h,
            Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid X-Tributary-Hash header"}))),
        },
        None => return (StatusCode::BAD_REQUEST, Json(json!({"error": "Missing X-Tributary-Hash header"}))),
    };
    
    let signature = match headers.get("X-Tributary-Authorization") {
        Some(sig) => match sig.to_str() {
            Ok(s) => s,
            Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid X-Tributary-Authorization header"}))),
        },
        None => return (StatusCode::BAD_REQUEST, Json(json!({"error": "Missing X-Tributary-Authorization header"}))),
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
        },
        Err(e) => {
            eprintln!("Database error: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to retrieve latest blob"})));
        }
    };
    
    // Compute the Merkle tree hash (chain hash)
    let tree_hash = compute_merkle_hash(&latest_blob.hash, body_hash);
    
    // Create the data to be signed (includes the tree hash)
    let data_to_sign = format!("{}:{}", tree_hash, general_purpose::STANDARD.encode(&body));
    let data_to_sign_bytes = data_to_sign.as_bytes().to_vec();
    
    // Verify the signature
    let verification_request = SignatureVerificationRequest {
        pubkey: encoded_pubkey.clone(),
        signature: signature.to_string(),
        data: data_to_sign_bytes.clone(),
    };
    
    match verify_signature(&verification_request) {
        Ok(true) => {
            // Signature is valid, proceed with storing
            let blob = Blob {
                id: id.clone(),
                pubkey: encoded_pubkey.clone(),
                data: body.to_vec(),
                hash: tree_hash.to_string(),
                prior_hash: latest_blob.hash.clone(),
                signature: signature.to_string(),
                sequence_number: latest_blob.sequence_number + 1,
                created_at: Utc::now().naive_utc(),
            };
            
            match db.store_blob(&blob).await {
                Ok(true) => {
                    // Successfully inserted new blob
                    (StatusCode::OK, Json(json!({
                        "status": "stored",
                        "id": id,
                        "pubkey": encoded_pubkey,
                        "sequence_number": blob.sequence_number,
                        "hash": blob.hash
                    })))
                },
                Ok(false) => {
                    // Blob already exists (conflict)
                    (StatusCode::CONFLICT, Json(json!({"error": "Blob already exists"})))
                },
                Err(e) => {
                    eprintln!("Database error: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to store blob"})))
                }
            }
        },
        Ok(false) => (StatusCode::UNAUTHORIZED, Json(json!({"error": "Invalid signature"}))),
        Err(e) => {
            eprintln!("Signature verification error: {}", e);
            (StatusCode::BAD_REQUEST, Json(json!({"error": "Signature verification failed"})))
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
        Ok(Some(blob)) => {
            (StatusCode::OK, Json(json!({
                "id": blob.id,
                "pubkey": blob.pubkey,
                "data": blob.data,
                "hash": blob.hash,
                "prior_hash": blob.prior_hash,
                "signature": blob.signature,
                "sequence_number": blob.sequence_number,
                "created_at": blob.created_at.to_string()
            })))
        },
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "Blob not found"}))),
        Err(e) => {
            eprintln!("Database error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to retrieve blob"})))
        }
    }
}
