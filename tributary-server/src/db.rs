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
        
        // Add new columns if they don't exist (for backward compatibility)
        let _ = sqlx::query(
            r#"
            ALTER TABLE blobs 
            ADD COLUMN IF NOT EXISTS prior_hash TEXT NOT NULL DEFAULT ''
            "#,
        )
        .execute(&pool)
        .await;
        
        let _ = sqlx::query(
            r#"
            ALTER TABLE blobs 
            ADD COLUMN IF NOT EXISTS signature TEXT NOT NULL DEFAULT ''
            "#,
        )
        .execute(&pool)
        .await;
        
        let _ = sqlx::query(
            r#"
            ALTER TABLE blobs 
            ADD COLUMN IF NOT EXISTS sequence_number INTEGER NOT NULL DEFAULT 0
            "#,
        )
        .execute(&pool)
        .await;
        
        Ok(Database { pool: Arc::new(pool) })
    }
    
    pub async fn clear_all_test_data(&self) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM blobs WHERE id LIKE 'test-%' OR id LIKE 'chain-%' OR id LIKE 'signature-test-%'")
            .execute(&*self.pool)
            .await?;
        Ok(())
    }
    
    pub async fn store_blob(&self, blob: &Blob) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO blobs (id, pubkey, data, hash, prior_hash, signature, sequence_number, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             ON CONFLICT (pubkey, id) DO NOTHING"
        )
        .bind(&blob.id)
        .bind(&blob.pubkey)
        .bind(&blob.data)
        .bind(&blob.hash)
        .bind(&blob.prior_hash)
        .bind(&blob.signature)
        .bind(blob.sequence_number)
        .bind(blob.created_at)
        .execute(&*self.pool)
        .await?;

        // Check if a row was inserted (0 means conflict, 1 means inserted)
        let rows_affected = result.rows_affected();
        Ok(rows_affected > 0)
    }
    
    pub async fn retrieve_blob(&self, pubkey: &str, id: &str) -> Result<Option<Blob>, sqlx::Error> {
        let result = sqlx::query_as::<_, Blob>(
            "SELECT id, pubkey, data, hash, prior_hash, signature, sequence_number, created_at FROM blobs WHERE pubkey = $1 AND id = $2"
        )
        .bind(pubkey)
        .bind(id)
        .fetch_optional(&*self.pool)
        .await?;
        
        Ok(result)
    }
    
    pub async fn get_blob_metadata(&self, pubkey: &str, id: &str) -> Result<Option<BlobMetadata>, sqlx::Error> {
        let result = sqlx::query_as::<_, BlobMetadata>(
            "SELECT id, pubkey, hash, prior_hash, signature, sequence_number, created_at FROM blobs WHERE pubkey = $1 AND id = $2"
        )
        .bind(pubkey)
        .bind(id)
        .fetch_optional(&*self.pool)
        .await?;
        
        Ok(result)
    }
    
    pub async fn get_latest_blob(&self, pubkey: &str) -> Result<Option<BlobMetadata>, sqlx::Error> {
        let result = sqlx::query_as::<_, BlobMetadata>(
            "SELECT id, pubkey, hash, prior_hash, signature, sequence_number, created_at 
             FROM blobs 
             WHERE pubkey = $1 
             ORDER BY sequence_number DESC 
             LIMIT 1"
        )
        .bind(pubkey)
        .fetch_optional(&*self.pool)
        .await?;
        
        Ok(result)
    }
}
