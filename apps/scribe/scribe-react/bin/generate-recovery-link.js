#!/usr/bin/env node

// Generates a password recovery link for a user without sending an email.
// Requires the Supabase service role key (admin access).
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx \
//     node bin/generate-recovery-link.js user@example.com [--redirect-to https://app.example.com]

import { createClient } from '@supabase/supabase-js'

const email = process.argv.find((arg, i) => i >= 2 && !arg.startsWith('--'))
const redirectIdx = process.argv.indexOf('--redirect-to')
const redirectTo = redirectIdx !== -1 ? process.argv[redirectIdx + 1] : undefined

if (!email) {
  console.error('Usage: generate-recovery-link.js <email> [--redirect-to <url>]')
  console.error('')
  console.error('Environment variables:')
  console.error('  SUPABASE_URL               Supabase project URL (required)')
  console.error('  SUPABASE_SERVICE_ROLE_KEY   Service role key (required)')
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const options = { type: 'recovery', email }
if (redirectTo) {
  options.options = { redirectTo }
}

const { data, error } = await supabase.auth.admin.generateLink(options)

if (error) {
  console.error('Error generating recovery link:', error.message)
  process.exit(1)
}

console.log(data.properties.action_link)
