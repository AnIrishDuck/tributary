-- Fix function_search_path_mutable warnings by setting search_path on all functions.
-- Fix rls_policy_always_true warning on blobs INSERT policy.

-- 1. Recreate functions with SET search_path = ''

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.get_collection_info(input_pubkey TEXT)
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
    FROM public.blobs
    WHERE pubkey = input_pubkey;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.get_latest_blob(input_pubkey TEXT)
RETURNS SETOF public.blobs AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM public.blobs
    WHERE pubkey = input_pubkey
    ORDER BY sequence_number DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.clear_test_data()
RETURNS void AS $$
BEGIN
    DELETE FROM public.blobs
    WHERE id LIKE 'test-%' OR id LIKE 'chain-%' OR id LIKE 'signature-test-%';
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.get_blob_by_index(input_pubkey TEXT, blob_index INTEGER)
RETURNS SETOF public.blobs AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM public.blobs
    WHERE pubkey = input_pubkey
    AND sequence_number = blob_index
    ORDER BY sequence_number;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 2. Tighten INSERT RLS policy: require owner_id = auth.uid()
--    The edge function uses the service role (bypasses RLS), so this only
--    affects direct client inserts where we want ownership enforced.

DROP POLICY IF EXISTS "Authenticated users can insert blobs" ON blobs;
CREATE POLICY "Authenticated users can insert blobs" ON blobs
    FOR INSERT TO authenticated
    WITH CHECK (owner_id = auth.uid());
