use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use urlencoding;

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
        let pubkey_base64 = general_purpose::URL_SAFE.encode(pubkey_bytes);

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
        general_purpose::URL_SAFE.encode(signature.to_bytes())
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

        // The hash is just prior_hash + body_hash concatenated
        let hash = format!("{}{}", prior_hash, body_hash);

        // Sign the concatenated hash
        let signature = self.signing_key.sign(hash.as_bytes());
        let signature_base64 = general_purpose::URL_SAFE.encode(signature.to_bytes());

        (body_hash, hash, signature_base64)
    }
}
