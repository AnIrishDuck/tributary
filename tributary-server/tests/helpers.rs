use ed25519_dalek::{SigningKey, Signer};
use rand::rngs::OsRng;
use base64::{Engine as _, engine::general_purpose};
use sha2::{Sha256, Digest};
use urlencoding;
use tributary_server::crypto::{compute_merkle_hash};

pub struct TestUser {
    pub signing_key: SigningKey,
    pub pubkey_base64: String,
}

impl TestUser {
    pub fn new() -> Self {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();
        let pubkey_bytes = verifying_key.to_bytes();
        let pubkey_base64 = general_purpose::STANDARD.encode(pubkey_bytes);
        
        Self {
            signing_key,
            pubkey_base64,
        }
    }
    
    pub fn get_url_encoded_pubkey(&self) -> String {
        urlencoding::encode(&self.pubkey_base64).to_string()
    }
    
    pub fn _sign_data(&self, data: &[u8]) -> String {
        let signature = self.signing_key.sign(data);
        general_purpose::STANDARD.encode(signature.to_bytes())
    }
    
    pub fn compute_hash(&self, data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let result = hasher.finalize();
        hex::encode(result)
    }
    
    pub fn sign_chained_data(&self, prior_hash: &str, data: &[u8]) -> (String, String, String) {
        // Compute body hash
        let body_hash = self.compute_hash(data);
        
        // Compute Merkle tree hash
        let tree_hash = compute_merkle_hash(prior_hash, &body_hash);
        
        // Create the data to be signed (same as in the API)
        let data_to_sign = format!("{}:{}", tree_hash, general_purpose::STANDARD.encode(data));
        let data_to_sign_bytes = data_to_sign.as_bytes();
        
        // Sign the data
        let signature = self.signing_key.sign(data_to_sign_bytes);
        let signature_base64 = general_purpose::STANDARD.encode(signature.to_bytes());
        
        (body_hash, tree_hash, signature_base64)
    }
}
