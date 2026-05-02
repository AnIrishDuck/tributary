import React, { useState } from 'react'
import { SupabaseClient, Session } from '@supabase/supabase-js'
import { TributaryClient, deriveAuthKey, deriveStreamSeed } from 'tributary-client'
import nacl from 'tweetnacl'
import { CONFIG } from '../config'
import { createHomeLibrary } from 'scribe-data'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import { getErrorMessage } from 'scribe-react-common/src/utils/errors'

interface SetPasswordPageProps {
  supabase: SupabaseClient
  session: Session
  client: TributaryClient
  onComplete: () => void
}

export default function SetPasswordPage({ supabase, session, client, onComplete }: SetPasswordPageProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const email = session.user.email
  if (!email) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-sm w-full">
          <div className="card p-8 text-center">
            <p className="text-red-600">No email found in session. Cannot set password.</p>
          </div>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 1. Derive auth key and stream seed
      const authKey = await deriveAuthKey(password, email!)
      const streamSeed = await deriveStreamSeed(password, email!, CONFIG.APP_ID)

      // 2. Update Supabase password to the derived auth key
      const { error: updateError } = await supabase.auth.updateUser({ password: authKey })
      if (updateError) {
        throw new Error(`Failed to set password: ${updateError.message}`)
      }

      // 3. Create home library with derived keypair
      const keyPair = nacl.sign.keyPair.fromSeed(streamSeed)
      await createHomeLibrary(client, 'Home', keyPair)

      // 4. Done — App.tsx re-enters normal flow
      onComplete()
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'An unexpected error occurred'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-sm w-full">
        <div className="card p-8">
          <div className="text-center mb-6">
            <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <LockClosedIcon className="w-6 h-6 text-blue-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Set Your Password</h1>
            <p className="text-sm text-gray-600 mt-2">
              Choose a password to secure your account and encrypt your library.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Setting up...' : 'Set Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
