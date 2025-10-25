// Utility functions for tributary-server

use base64::{engine::general_purpose, Engine as _};

pub fn encode_base64(data: &[u8]) -> String {
    general_purpose::URL_SAFE.encode(data)
}

pub fn decode_base64(encoded: &str) -> Result<Vec<u8>, base64::DecodeError> {
    general_purpose::URL_SAFE.decode(encoded)
}
