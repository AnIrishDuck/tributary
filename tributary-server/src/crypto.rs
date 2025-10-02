use ed25519_dalek::{VerifyingKey, Signature, Verifier};
use sha2::{Sha256, Digest};
use base64::{Engine as _, engine::general_purpose};
use crate::models::SignatureVerificationRequest;

#[derive(Debug)]
pub enum CryptoError {
    Base64DecodeError(base64::DecodeError),
    Ed25519Error(ed25519_dalek::SignatureError),
}

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CryptoError::Base64DecodeError(e) => write!(f, "Base64 decode error: {}", e),
            CryptoError::Ed25519Error(e) => write!(f, "Ed25519 error: {}", e),
        }
    }
}

impl std::error::Error for CryptoError {}

pub fn verify_signature(request: &SignatureVerificationRequest) -> Result<bool, CryptoError> {
    // Decode the public key from base64
    let pubkey_bytes = general_purpose::STANDARD.decode(&request.pubkey)
        .map_err(CryptoError::Base64DecodeError)?;
    
    // Decode the signature from base64
    let signature_bytes = general_purpose::STANDARD.decode(&request.signature)
        .map_err(CryptoError::Base64DecodeError)?;
    
    // Convert to ed25519 verifying key
    let verifying_key = VerifyingKey::try_from(pubkey_bytes.as_slice())
        .map_err(CryptoError::Ed25519Error)?;
    
    // Convert to signature
    let signature = Signature::try_from(signature_bytes.as_slice())
        .map_err(CryptoError::Ed25519Error)?;
    
    // Verify the signature
    match verifying_key.verify(&request.data, &signature) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

pub fn compute_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)
}

pub fn compute_merkle_hash(prior_hash: &str, body_hash: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prior_hash.as_bytes());
    hasher.update(body_hash.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}
