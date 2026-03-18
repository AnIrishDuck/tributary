-- User storage server configuration
-- Allows users to configure a custom storage server URL for their data.
-- The central Supabase instance remains the auth authority.

CREATE TABLE user_storage_servers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  server_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_storage_servers ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own storage server config
CREATE POLICY "Users manage own storage server" ON user_storage_servers
  FOR ALL USING (user_id = auth.uid());

GRANT ALL ON TABLE user_storage_servers TO authenticated;
