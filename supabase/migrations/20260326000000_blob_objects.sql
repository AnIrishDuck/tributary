-- Blob objects: content-addressed immutable binary blobs with merkle-tree verification
-- These are large encrypted files stored via TUS upload, distinct from the existing
-- stream "blobs" table which stores small chain-linked data entries.

CREATE TABLE IF NOT EXISTS blob_objects (
  root_hash TEXT PRIMARY KEY,
  owner_id UUID NOT NULL,
  domain TEXT NOT NULL,
  size BIGINT NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blob_objects_owner ON blob_objects (owner_id);
CREATE INDEX IF NOT EXISTS idx_blob_objects_domain ON blob_objects (domain);

ALTER TABLE blob_objects ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own blob objects
CREATE POLICY blob_objects_select_own ON blob_objects
  FOR SELECT USING (owner_id = auth.uid());

-- Allow authenticated users to insert their own blob objects
CREATE POLICY blob_objects_insert_own ON blob_objects
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Tracking table for in-progress TUS uploads
CREATE TABLE IF NOT EXISTS blob_uploads (
  root_hash TEXT PRIMARY KEY,
  owner_id UUID NOT NULL,
  domain TEXT NOT NULL,
  size BIGINT NOT NULL,
  chunk_count INTEGER NOT NULL,
  chunks_uploaded INTEGER DEFAULT 0,
  tus_upload_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blob_uploads_owner ON blob_uploads (owner_id);

ALTER TABLE blob_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY blob_uploads_select_own ON blob_uploads
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY blob_uploads_insert_own ON blob_uploads
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY blob_uploads_update_own ON blob_uploads
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY blob_uploads_delete_own ON blob_uploads
  FOR DELETE USING (owner_id = auth.uid());
