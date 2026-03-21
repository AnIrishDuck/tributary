/**
 * Root seed persistence helpers.
 *
 * The root seed is equivalent to the signing private key — storing it in
 * localStorage puts it on the same trust boundary as the Supabase refresh
 * token that's already there.  Scoped per Supabase user ID so multiple
 * accounts can coexist.
 *
 * Draft clearing lives here too because drafts and the root seed are the
 * two categories of sensitive data that must be wiped from localStorage
 * on logout / when enabling encrypted storage.
 */

import * as base64url from 'urlsafe-base64'
import { deleteAllDrafts } from 'scribe-react-note/src/drafts/draftStorage'

// ---------------------------------------------------------------------------
// Root seed key helpers
// ---------------------------------------------------------------------------

const ROOT_SEED_STORAGE_PREFIX = 'scribe-root-seed'
const LEGACY_ROOT_SEED_KEY = 'scribe-root-seed'

function rootSeedKey(userId: string | undefined): string {
  return userId ? `${ROOT_SEED_STORAGE_PREFIX}-${userId}` : LEGACY_ROOT_SEED_KEY
}

// ---------------------------------------------------------------------------
// Root seed CRUD
// ---------------------------------------------------------------------------

export function persistRootSeed(seed: Uint8Array, userId: string | undefined) {
  localStorage.setItem(rootSeedKey(userId), base64url.encode(Buffer.from(seed)))
}

export function loadPersistedRootSeed(userId: string | undefined): Uint8Array | null {
  const key = rootSeedKey(userId)
  let raw = localStorage.getItem(key)
  if (!raw && userId) {
    // Migration: check the legacy unscoped key
    raw = localStorage.getItem(LEGACY_ROOT_SEED_KEY)
    if (raw) {
      // Migrate to scoped key and remove legacy
      localStorage.setItem(key, raw)
      localStorage.removeItem(LEGACY_ROOT_SEED_KEY)
    }
  }
  if (!raw) return null
  return new Uint8Array(base64url.decode(raw))
}

export function clearRootSeed(userId: string | undefined) {
  localStorage.removeItem(rootSeedKey(userId))
  // Also remove the legacy unscoped key in case it was never migrated
  localStorage.removeItem(LEGACY_ROOT_SEED_KEY)
}

// ---------------------------------------------------------------------------
// Draft clearing
// ---------------------------------------------------------------------------

/**
 * Remove all draft note bodies from localStorage.
 *
 * Drafts store the full plaintext note body and are auto-saved every few
 * seconds.  They must be cleared on logout and when enabling encrypted
 * storage to prevent leaking note content to a passive attacker with
 * access to localStorage.
 */
export function clearDrafts() {
  deleteAllDrafts()
}
