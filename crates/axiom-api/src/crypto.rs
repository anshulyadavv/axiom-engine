use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::RngCore;
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Password hashing error: {0}")]
    Hashing(String),
    #[error("Invalid password")]
    InvalidPassword,
    #[error("Encryption error: {0}")]
    Encryption(String),
    #[error("Decryption error: {0}")]
    Decryption(String),
    #[error("Invalid key length: expected 32 bytes")]
    InvalidKeyLength,
}

/// Hashes a password using Argon2id with a cryptographically secure random salt.
pub fn hash_password(password: &str) -> Result<String, CryptoError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| CryptoError::Hashing(e.to_string()))
}

/// Verifies a password against an Argon2id hash string in constant time.
pub fn verify_password(password: &str, password_hash: &str) -> Result<(), CryptoError> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| CryptoError::Hashing(e.to_string()))?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| CryptoError::InvalidPassword)
}

/// Generates a cryptographically secure random token (e.g. for session IDs or CSRF tokens).
pub fn generate_secure_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Computes SHA-256 hex digest of a token (used to store session token hashes).
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Encrypts plaintext using AES-256-GCM with a randomly generated 96-bit nonce.
/// Returns (ciphertext, nonce).
pub fn encrypt_aes_gcm(plaintext: &[u8], master_key: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    let key = Key::<Aes256Gcm>::from_slice(master_key);
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| CryptoError::Encryption(format!("{:?}", e)))?;

    Ok((ciphertext, nonce_bytes.to_vec()))
}

/// Decrypts ciphertext using AES-256-GCM with the specified 96-bit nonce.
pub fn decrypt_aes_gcm(ciphertext: &[u8], nonce: &[u8], master_key: &[u8; 32]) -> Result<Vec<u8>, CryptoError> {
    if nonce.len() != 12 {
        return Err(CryptoError::Decryption("Invalid nonce length: expected 12 bytes".into()));
    }
    let key = Key::<Aes256Gcm>::from_slice(master_key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| CryptoError::Decryption(format!("{:?}", e)))
}

/// Resolves the 32-byte master encryption key from environment variable or deterministic dev fallback.
pub fn resolve_master_key() -> [u8; 32] {
    if let Ok(key_str) = std::env::var("AXIOM_MASTER_KEY") {
        let mut hasher = Sha256::new();
        hasher.update(key_str.as_bytes());
        let result = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&result);
        key
    } else {
        // Deterministic development default key
        let mut hasher = Sha256::new();
        hasher.update(b"axiom-engine-development-master-key-seed");
        let result = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&result);
        key
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_hash_and_verify() {
        let password = "SuperSecretPassword123!";
        let hash = hash_password(password).expect("hashing should succeed");
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password(password, &hash).is_ok());
        assert!(verify_password("wrong_password", &hash).is_err());
    }

    #[test]
    fn test_aes_gcm_encrypt_decrypt() {
        let master_key = resolve_master_key();
        let plaintext = b"sk-ant-api03-secret-key-material";
        let (ciphertext, nonce) = encrypt_aes_gcm(plaintext, &master_key).expect("encryption succeeds");
        assert_ne!(ciphertext, plaintext);
        assert_eq!(nonce.len(), 12);

        let decrypted = decrypt_aes_gcm(&ciphertext, &nonce, &master_key).expect("decryption succeeds");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_token_generation() {
        let t1 = generate_secure_token();
        let t2 = generate_secure_token();
        assert_ne!(t1, t2);
        assert_eq!(t1.len(), 64);
        assert_eq!(hash_token(&t1), hash_token(&t1));
    }
}
