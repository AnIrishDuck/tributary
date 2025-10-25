use crate::models::SignatureVerificationRequest;
use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

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
    // Decode the public key from base64 (URL_SAFE only)
    let pubkey_bytes = general_purpose::URL_SAFE
        .decode(&request.pubkey)
        .map_err(CryptoError::Base64DecodeError)?;

    // Decode the signature from base64 (URL_SAFE only)
    let signature_bytes = general_purpose::URL_SAFE
        .decode(&request.signature)
        .map_err(CryptoError::Base64DecodeError)?;

    // Convert to ed25519 verifying key
    let verifying_key =
        VerifyingKey::try_from(pubkey_bytes.as_slice()).map_err(CryptoError::Ed25519Error)?;

    // Convert to signature
    let signature =
        Signature::try_from(signature_bytes.as_slice()).map_err(CryptoError::Ed25519Error)?;

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

/// Compute chain hash (SHA256(prior_hash + body_hash)) - this matches the TypeScript client implementation
/// This function demonstrates the exact same process used in tributary-client for hash computation
pub fn compute_chain_hash(prior_hash: &str, body_data: &[u8]) -> String {
    // Compute body hash first (same as client)
    let body_hash = compute_hash(body_data);

    // Concatenate prior_hash + body_hash, then hash the result (same as client does)
    let concatenated = format!("{}{}", prior_hash, body_hash);
    compute_hash(concatenated.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_compatibility_with_client() {
        // Test the exact same data that the client test uses
        let test_data = "test data for hashing".as_bytes();
        let prior_hash = "abc123def456";

        // Compute using server implementation
        let body_hash = compute_hash(test_data);
        let chain_hash = compute_chain_hash(prior_hash, test_data);

        // These should match exactly what the client produces:
        assert_eq!(
            body_hash,
            "f7eb7961d8a233e6256d3a6257548bbb9293c3a08fb3574c88c7d6b429dbb9f5"
        );
        // Chain hash should be SHA256(prior_hash + body_hash) = SHA256("abc123def456f7eb7961d8a233e6256d3a6257548bbb9293c3a08fb3574c88c7d6b429dbb9f5")
        // = "e8910954652f2957dd5b6f34d88c78ff7f086546e2b94aef687290d409519a67"
        assert_eq!(
            chain_hash,
            "e8910954652f2957dd5b6f34d88c78ff7f086546e2b94aef687290d409519a67"
        );
    }

    #[test]
    fn test_hello_tributary() {
        let test_data = "Hello, Tributary!".as_bytes();
        let prior_hash = "a1b2c3d4e5f";

        let body_hash = compute_hash(test_data);
        let chain_hash = compute_chain_hash(prior_hash, test_data);

        // These should match exactly what the client produces:
        assert_eq!(
            body_hash,
            "692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57"
        );
        // Chain hash should be SHA256(prior_hash + body_hash) = SHA256("a1b2c3d4e5f692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57")
        // = "c6a7678f0c10c4ef797589575b0c8ffc108ee965cf1c06fef71cec3edc867b91"
        assert_eq!(
            chain_hash,
            "c6a7678f0c10c4ef797589575b0c8ffc108ee965cf1c06fef71cec3edc867b91"
        );
    }
}
