// Database module for tributary-server
// This module will handle all database operations

use sqlx::PgPool;
use crate::models::{Blob, BlobMetadata};
use std::sync::Arc;

#[derive(Clone)]
pub struct Database {
    pool: Arc<PgPool>,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPool::connect(database_url).await?;
        // Create tables if they don't exist
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS blobs (
                id TEXT NOT NULL,
                pubkey TEXT NOT NULL,
                data BYTEA NOT NULL,
                hash TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (pubkey, id)
            )
            "#,
        )
        .execute(&pool)
        .await?;
        
        Ok(Database { pool: Arc::new(pool) })
    }
    
    pub async fn store_blob(&self, blob: &Blob) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO blobs (id, pubkey, data, hash, created_at) VALUES ($1, $2, $3, $4, $5) 
             ON CONFLICT (pubkey, id) DO NOTHING"
        )
        .bind(&blob.id)
        .bind(&blob.pubkey)
        .bind(&blob.data)
        .bind(&blob.hash)
        .bind(blob.created_at)
        .execute(&*self.pool)
        .await?;

        // Check if a row was inserted (0 means conflict, 1 means inserted)
        let rows_affected = result.rows_affected();
        Ok(rows_affected > 0)
    }
    
    pub async fn retrieve_blob(&self, pubkey: &str, id: &str) -> Result<Option<Blob>, sqlx::Error> {
        let result = sqlx::query_as::<_, Blob>(
            "SELECT id, pubkey, data, hash, created_at FROM blobs WHERE pubkey = $1 AND id = $2"
        )
        .bind(pubkey)
        .bind(id)
        .fetch_optional(&*self.pool)
        .await?;
        
        Ok(result)
    }
    
    pub async fn get_blob_metadata(&self, pubkey: &str, id: &str) -> Result<Option<BlobMetadata>, sqlx::Error> {
        let result = sqlx::query_as::<_, BlobMetadata>(
            "SELECT id, pubkey, hash, created_at FROM blobs WHERE pubkey = $1 AND id = $2"
        )
        .bind(pubkey)
        .bind(id)
        .fetch_optional(&*self.pool)
        .await?;
        
        Ok(result)
    }
}
