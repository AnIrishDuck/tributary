-- Create the blobs table for tributary-fn
CREATE TABLE IF NOT EXISTS blobs (
    id TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    data BYTEA NOT NULL,
    hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    prior_hash TEXT NOT NULL DEFAULT '',
    signature TEXT NOT NULL DEFAULT '',
    sequence_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (pubkey, id)
);

-- Create an index on sequence_number for efficient retrieval of latest blobs
CREATE INDEX IF NOT EXISTS idx_blobs_sequence_number ON blobs (pubkey, sequence_number DESC);

-- Create an index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_blobs_created_at ON blobs (pubkey, created_at);

-- Enable row level security
ALTER TABLE blobs ENABLE ROW LEVEL SECURITY;

-- Create policies for row level security
-- Policy to allow users to insert their own blobs
CREATE POLICY "Users can insert their own blobs" ON blobs
    FOR INSERT
    WITH CHECK (pubkey = auth.uid()::text OR pubkey = auth.jwt() ->> 'email');

-- Policy to allow users to select their own blobs
CREATE POLICY "Users can select their own blobs" ON blobs
    FOR SELECT
    USING (pubkey = auth.uid()::text OR pubkey = auth.jwt() ->> 'email');

-- Policy to allow users to update their own blobs (if needed)
CREATE POLICY "Users can update their own blobs" ON blobs
    FOR UPDATE
    USING (pubkey = auth.uid()::text OR pubkey = auth.jwt() ->> 'email');

-- Policy to allow users to delete their own blobs
CREATE POLICY "Users can delete their own blobs" ON blobs
    FOR DELETE
    USING (pubkey = auth.uid()::text OR pubkey = auth.jwt() ->> 'email');

-- Grant necessary permissions to authenticated users
GRANT ALL ON TABLE blobs TO authenticated;

-- Add a trigger function to automatically update the created_at field
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger to automatically update created_at on updates
CREATE TRIGGER update_blobs_updated_at BEFORE UPDATE ON blobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a function to get collection information
CREATE OR REPLACE FUNCTION get_collection_info(input_pubkey TEXT)
RETURNS TABLE(
    blob_count BIGINT,
    first_blob_timestamp TIMESTAMP,
    last_blob_timestamp TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as blob_count,
        MIN(created_at) as first_blob_timestamp,
        MAX(created_at) as last_blob_timestamp
    FROM blobs 
    WHERE pubkey = input_pubkey;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get the latest blob for a pubkey
CREATE OR REPLACE FUNCTION get_latest_blob(input_pubkey TEXT)
RETURNS SETOF blobs AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM blobs
    WHERE pubkey = input_pubkey
    ORDER BY sequence_number DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create a function to clear test data (useful for development/testing)
CREATE OR REPLACE FUNCTION clear_test_data()
RETURNS void AS $$
BEGIN
    DELETE FROM blobs 
    WHERE id LIKE 'test-%' OR id LIKE 'chain-%' OR id LIKE 'signature-test-%';
END;
$$ LANGUAGE plpgsql;

-- Create a function to serve static files from the blob storage
-- This function retrieves a specific blob by its index for static site serving
CREATE OR REPLACE FUNCTION get_blob_by_index(input_pubkey TEXT, blob_index INTEGER)
RETURNS SETOF blobs AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM blobs
    WHERE pubkey = input_pubkey 
    AND sequence_number = blob_index
    ORDER BY sequence_number;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions on functions to authenticated users
GRANT EXECUTE ON FUNCTION get_collection_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_latest_blob(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_test_data() TO authenticated;
GRANT EXECUTE ON FUNCTION get_blob_by_index(TEXT, INTEGER) TO authenticated;
