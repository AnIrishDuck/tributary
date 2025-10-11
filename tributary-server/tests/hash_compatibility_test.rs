// This file demonstrates the exact hash process used by tributary-server
// and verifies that tributary-client produces identical results

use sha2::{Digest, Sha256};

/// Compute SHA256 hash of data - matches tributary-client implementation
/// This function demonstrates the exact same process used in compute_hash in tributary-server/src/crypto.rs
pub fn compute_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)
}

/// Compute chain hash (SHA256(prior_hash + body_hash)) - matches updated tributary-client implementation
/// This function demonstrates the exact same process used in tributary-server/src/api.rs after the fix
pub fn compute_chain_hash(prior_hash: &str, body_data: &[u8]) -> String {
    // Compute body hash first
    let body_hash = compute_hash(body_data);

    // Concatenate prior_hash + body_hash, then hash the result
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
        // body_hash should be "f7eb7961d8a233e6256d3a6257548bbb9293c3a08fb3574c88c7d6b429dbb9f5"
        // chain_hash should be SHA256(prior_hash + body_hash) = SHA256("abc123def456f7eb7961d8a233e6256d3a6257548bbb9293c3a08fb3574c88c7d6b429dbb9f5")
        // = "e8910954652f2957dd5b6f34d88c78ff7f086546e2b94aef687290d409519a67"

        assert_eq!(
            body_hash,
            "f7eb7961d8a233e6256d3a6257548bbb9293c3a08fb3574c88c7d6b429dbb9f5"
        );
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
        // body_hash should be "692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57"
        // chain_hash should be SHA256(prior_hash + body_hash) = SHA256("a1b2c3d4e5f692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57")
        // = "c6a7678f0c10c4ef797589575b0c8ffc108ee965cf1c06fef71cec3edc867b91"

        assert_eq!(
            body_hash,
            "692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57"
        );
        assert_eq!(
            chain_hash,
            "c6a7678f0c10c4ef797589575b0c8ffc108ee965cf1c06fef71cec3edc867b91"
        );
    }

    #[test]
    fn test_chain_hash_without_prior() {
        // Test chain hash computation when there is no prior hash (first entry)
        let test_data = "First entry".as_bytes();
        let prior_hash = ""; // Empty prior hash for first entry

        let body_hash = compute_hash(test_data);
        let chain_hash = compute_chain_hash(prior_hash, test_data);

        // For first entry with empty prior hash:
        // body_hash should be "7749435cc893289da9df793cdb29ba90e082e57e6a60f4019b1d22f57bc3bf40"
        // chain_hash should be SHA256("" + body_hash) = SHA256("7749435cc893289da9df793cdb29ba90e082e57e6a60f4019b1d22f57bc3bf40")
        // = "f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641"

        assert_eq!(
            body_hash,
            "7749435cc893289da9df793cdb29ba90e082e57e6a60f4019b1d22f57bc3bf40"
        );
        assert_eq!(
            chain_hash,
            "f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641"
        );
    }

    #[test]
    fn test_chain_hash_with_real_prior() {
        // Test chain hash computation with a real prior hash (simulating actual chaining)
        let test_data = "Second entry".as_bytes();
        let prior_hash = "f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641"; // hash from previous test

        let body_hash = compute_hash(test_data);
        let chain_hash = compute_chain_hash(prior_hash, test_data);

        // This tests actual chaining with real hashes, not faked ones
        // body_hash should be "f5f5fd73d02a1535460e64279b2aa672309c80b129f28efe2ab523f32d1e91be"
        // chain_hash should be SHA256(prior_hash + body_hash) = SHA256("f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641f5f5fd73d02a1535460e64279b2aa672309c80b129f28efe2ab523f32d1e91be")
        // = "b17d1dcc5867c9dbaf798b1d7cd91168a362702d4acfd0f8f997c7390aaf65f9"

        assert_eq!(
            body_hash,
            "f5f5fd73d02a1535460e64279b2aa672309c80b129f28efe2ab523f32d1e91be"
        );
        assert_eq!(
            chain_hash,
            "b17d1dcc5867c9dbaf798b1d7cd91168a362702d4acfd0f8f997c7390aaf65f9"
        );
    }
}
