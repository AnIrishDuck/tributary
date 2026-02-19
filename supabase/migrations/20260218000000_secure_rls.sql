-- Add owner/origin tracking columns
ALTER TABLE blobs ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE blobs ADD COLUMN IF NOT EXISTS origin TEXT;
CREATE INDEX IF NOT EXISTS idx_blobs_owner_id ON blobs (owner_id);

-- Drop all permissive testing policies
DROP POLICY IF EXISTS "Allow anon access for testing" ON blobs;
DROP POLICY IF EXISTS "Users can insert their own blobs" ON blobs;
DROP POLICY IF EXISTS "Users can select their own blobs" ON blobs;
DROP POLICY IF EXISTS "Users can update their own blobs" ON blobs;
DROP POLICY IF EXISTS "Users can delete their own blobs" ON blobs;

-- Re-enable RLS
ALTER TABLE blobs ENABLE ROW LEVEL SECURITY;

-- Reads: public (data is encrypted, pubkey is required to find anything)
CREATE POLICY "Anyone can read blobs" ON blobs FOR SELECT USING (true);

-- Inserts: authenticated only (safety net; edge fn bypasses RLS via service role)
CREATE POLICY "Authenticated users can insert blobs" ON blobs FOR INSERT TO authenticated WITH CHECK (true);

-- Updates: authenticated, own blobs only
CREATE POLICY "Authenticated users can update their own blobs" ON blobs FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- No DELETE policy = no deletes through RLS

-- Fix grants: revoke anon write access, keep anon read
REVOKE ALL ON TABLE blobs FROM anon;
GRANT SELECT ON TABLE blobs TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE blobs TO authenticated;
GRANT EXECUTE ON FUNCTION get_collection_info(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_latest_blob(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_blob_by_index(TEXT, INTEGER) TO anon;
