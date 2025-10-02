use tributary_server::db::Database;

#[tokio::test]
async fn test_database_connection() {
    // Use a test database with the correct connection details
    let database_url = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://postgres:your-super-secret-and-long-postgres-password@supabase-db:5432/postgres".to_string());

    println!("Attempting to connect to database: {}", database_url);

    let db_result = Database::new(&database_url).await;

    match db_result {
        Ok(_db) => {
            println!("Successfully connected to database");
            assert!(true);
        }
        Err(e) => {
            println!("Failed to connect to database: {}", e);
            panic!("Database connection failed: {}", e);
        }
    }
}
