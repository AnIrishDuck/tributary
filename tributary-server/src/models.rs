use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Blob {
    pub id: String,
    pub pubkey: String,       // Base64 encoded public key
    pub data: Vec<u8>,        // Encrypted blob data
    pub hash: String,         // Merkle tree hash
    pub prior_hash: String,   // Previous hash in the chain
    pub signature: String,    // Signature for this blob
    pub sequence_number: i32, // Sequence number in the chain
    #[sqlx(default)]
    pub created_at: chrono::NaiveDateTime,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct BlobMetadata {
    pub id: String,
    pub pubkey: String,
    pub hash: String,
    pub prior_hash: String,
    pub signature: String,
    pub sequence_number: i32,
    #[sqlx(default)]
    pub created_at: chrono::NaiveDateTime,
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionInfo {
    pub blob_count: i64,
    pub first_blob_timestamp: Option<chrono::NaiveDateTime>,
    pub last_blob_timestamp: Option<chrono::NaiveDateTime>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SignatureVerificationRequest {
    pub pubkey: String,    // Base64 encoded public key
    pub signature: String, // Base64 encoded signature
    pub data: Vec<u8>,     // Data that was signed
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StaticSiteDirectory {
    pub directory: HashMap<String, StaticSiteFile>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StaticSiteFile {
    pub ix: usize,
    #[serde(rename = "content-type")]
    pub content_type: String,
}
