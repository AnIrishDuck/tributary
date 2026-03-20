-- Account config: per-user key/value registry
-- Max 64 entries per user, 256 chars per key and value

CREATE TABLE IF NOT EXISTS account_config (
    owner_id UUID NOT NULL,
    key TEXT NOT NULL CHECK (char_length(key) <= 256),
    value TEXT NOT NULL CHECK (char_length(value) <= 256),
    PRIMARY KEY (owner_id, key)
);

-- Enable RLS
ALTER TABLE account_config ENABLE ROW LEVEL SECURITY;

-- Users can read their own config
CREATE POLICY "Users can read own config" ON account_config
    FOR SELECT TO authenticated
    USING (owner_id = auth.uid());

-- Users can insert their own config
CREATE POLICY "Users can insert own config" ON account_config
    FOR INSERT TO authenticated
    WITH CHECK (owner_id = auth.uid());

-- Users can update their own config
CREATE POLICY "Users can update own config" ON account_config
    FOR UPDATE TO authenticated
    USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Users can delete their own config
CREATE POLICY "Users can delete own config" ON account_config
    FOR DELETE TO authenticated
    USING (owner_id = auth.uid());

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE account_config TO authenticated;
