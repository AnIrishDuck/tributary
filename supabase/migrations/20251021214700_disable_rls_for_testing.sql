-- Completely disable RLS for the blobs table for testing
-- This allows anon access to work properly

-- Check current RLS status and disable if enabled
ALTER TABLE blobs DISABLE ROW LEVEL SECURITY;

-- Make sure anon users have all permissions
GRANT ALL ON TABLE blobs TO anon;
