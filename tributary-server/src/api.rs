use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use serde_json::json;
use crate::models::{SignatureVerificationRequest, Blob};
use crate::crypto::verify_signature;
use crate::db::Database;
use chrono::Utc;

// POST /:encoded_pubkey/:id
#[axum::debug_handler]
pub async fn store_blob(
    State(db): State<Database>,
    Path((encoded_pubkey, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> (StatusCode, Json<serde_json::Value>) {
    // Extract headers
    let tree_hash = match headers.get("X-Tributary-Hash") {
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
    
    // Verify the signature
    let verification_request = SignatureVerificationRequest {
        pubkey: encoded_pubkey.clone(),
        signature: signature.to_string(),
        data: body.to_vec(),
    };
    
    match verify_signature(&verification_request) {
        Ok(true) => {
            // Signature is valid, proceed with storing
            let blob = Blob {
                id: id.clone(),
                pubkey: encoded_pubkey.clone(),
                data: body.to_vec(),
                hash: tree_hash.to_string(),
                created_at: Utc::now().naive_utc(),
            };
            
            match db.store_blob(&blob).await {
                Ok(true) => {
                    // Successfully inserted new blob
                    (StatusCode::OK, Json(json!({
                        "status": "stored",
                        "id": id,
                        "pubkey": encoded_pubkey
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
