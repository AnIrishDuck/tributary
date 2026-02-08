-- Fix RLS policies to work with anon access
-- Allow anon access for testing

-- Drop existing policies
DROP POLICY IF EXISTS "Users can insert their own blobs" ON blobs;
DROP POLICY IF EXISTS "Users can select their own blobs" ON blobs;
DROP POLICY IF EXISTS "Users can update their own blobs" ON blobs;
DROP POLICY IF EXISTS "Users can delete their own blobs" ON blobs;

-- Grant permissions to anon users
GRANT ALL ON TABLE blobs TO anon;

-- Create permissive policies for anon access
CREATE POLICY "Allow anon access for testing" ON blobs
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Make sure RLS is enabled (it should be already)
ALTER TABLE blobs ENABLE ROW LEVEL SECURITY;
