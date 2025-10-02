// Utility functions for tributary-server

use base64::{Engine as _, engine::general_purpose};

pub fn encode_base64(data: &[u8]) -> String {
    general_purpose::STANDARD.encode(data)
}

pub fn decode_base64(encoded: &str) -> Result<Vec<u8>, base64::DecodeError> {
    general_purpose::STANDARD.decode(encoded)
}
