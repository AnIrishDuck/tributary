import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetPasswordPage from '../src/pages/SetPasswordPage'
import { Session, SupabaseClient } from '@supabase/supabase-js'
import { TributaryClient } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import { TestFakeServer } from './test-server'

// Use TestFakeServer + in-memory PGlite directly (same pattern as sync.test.ts)
// so writes succeed without a real auth token.
function createTestClient() {
  const server = new TestFakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server, db: pglite })
  return { client, server }
}

function createMockSession(email: string = 'alice@example.com'): Session {
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'user-123',
      email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }
}

function createMockSupabase(updateUserResult?: { data?: any; error: any }) {
  return {
    auth: {
      updateUser: vi.fn().mockResolvedValue(
        updateUserResult ?? { data: { user: {} }, error: null }
      ),
    },
  } as unknown as SupabaseClient
}

describe('SetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the set password form', () => {
    const session = createMockSession()
    const supabase = createMockSupabase()
    const { client } = createTestClient()
    const onComplete = vi.fn()

    render(
      <SetPasswordPage supabase={supabase} session={session} client={client} onComplete={onComplete} />
    )

    expect(screen.getByRole('heading', { name: 'Set Your Password' })).toBeInTheDocument()
    expect(screen.getByLabelText('New Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set Password' })).toBeInTheDocument()
  })

  it('should show error when no email in session', () => {
    const session = createMockSession()
    // @ts-ignore — intentionally remove email
    session.user.email = undefined
    const supabase = createMockSupabase()
    const { client } = createTestClient()
    const onComplete = vi.fn()

    render(
      <SetPasswordPage supabase={supabase} session={session} client={client} onComplete={onComplete} />
    )

    expect(screen.getByText(/No email found in session/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set Password' })).not.toBeInTheDocument()
  })

  it('should show error when passwords do not match', async () => {
    const user = userEvent.setup()
    const session = createMockSession()
    const supabase = createMockSupabase()
    const { client } = createTestClient()
    const onComplete = vi.fn()

    render(
      <SetPasswordPage supabase={supabase} session={session} client={client} onComplete={onComplete} />
    )

    await user.type(screen.getByLabelText('New Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'different456')
    await user.click(screen.getByRole('button', { name: 'Set Password' }))

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('should show error when password is too short', async () => {
    const user = userEvent.setup()
    const session = createMockSession()
    const supabase = createMockSupabase()
    const { client } = createTestClient()
    const onComplete = vi.fn()

    render(
      <SetPasswordPage supabase={supabase} session={session} client={client} onComplete={onComplete} />
    )

    await user.type(screen.getByLabelText('New Password'), 'short')
    await user.type(screen.getByLabelText('Confirm Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Set Password' }))

    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('should show loading state during submission', async () => {
    const user = userEvent.setup()
    const session = createMockSession()
    // Make updateUser hang so we can observe loading state
    const supabase = createMockSupabase()
    ;(supabase.auth.updateUser as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))
    const { client } = createTestClient()
    const onComplete = vi.fn()

    render(
      <SetPasswordPage supabase={supabase} session={session} client={client} onComplete={onComplete} />
    )

    await user.type(screen.getByLabelText('New Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Set Password' }))

    expect(screen.getByText('Setting up...')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('should call onComplete on successful submission', async () => {
    const user = userEvent.setup()
    const session = createMockSession()
    const supabase = createMockSupabase()
    const { client } = createTestClient()
    const onComplete = vi.fn()

    render(
      <SetPasswordPage supabase={supabase} session={session} client={client} onComplete={onComplete} />
    )

    await user.type(screen.getByLabelText('New Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Set Password' }))

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })

    // Verify Supabase password was updated with a derived auth key (base64 string)
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      password: expect.stringMatching(/^[A-Za-z0-9+/=]{44}$/),
    })

    // Verify home stream was set
    const homeStream = await client.getHomeStream()
    expect(homeStream).toBeTruthy()
  })

  it('should show error when Supabase updateUser fails', async () => {
    const user = userEvent.setup()
    const session = createMockSession()
    const supabase = createMockSupabase({
      data: null,
      error: { message: 'Password too weak' },
    })
    const { client } = createTestClient()
    const onComplete = vi.fn()

    render(
      <SetPasswordPage supabase={supabase} session={session} client={client} onComplete={onComplete} />
    )

    await user.type(screen.getByLabelText('New Password'), 'password123')
    await user.type(screen.getByLabelText('Confirm Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Set Password' }))

    await waitFor(() => {
      expect(screen.getByText(/Failed to set password: Password too weak/)).toBeInTheDocument()
    }, { timeout: 3000 })

    expect(onComplete).not.toHaveBeenCalled()
  })
})
