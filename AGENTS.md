# Agents

Guidelines for AI agents working on this codebase.

## Project overview

Tributary is a system for creating collections of end-to-end encrypted data.
See README.md for architecture details.

## Layout

- **supabase/** — database migrations and Deno edge functions
- **tributary-client/** — TypeScript library wrapping PGLite with persistence
- **tributary-cli/** — TypeScript CLI for debugging and testing
- **apps/scribe/** — markdown document editor app (scribe-data, scribe-cli, scribe-react)
- **cli-tests/** — bash integration test scripts

## Dependencies & building

Run `make deps` to install all dependencies (respects correct ordering for
local references). Run `make build-all` to build everything. See `make help`
for all available targets.

## Testing

Run `make test` to run all tests. Components can be tested individually:

- `make test-client` — tributary-client (vitest)
- `make test-cli-scripts` — cli-tests (bash scripts)

**We never use mocks.** We prefer fakes that can be substituted for real clients
for thorough integration testing.

## Crypto

We use **url-safe base64** (not standard base64) almost everywhere. Use
libraries like `urlsafe-base64` — not standard base64 utils. Stop and ask the
user if you think standard base64 is needed.

For TypeScript crypto: tweetnacl / tweetnacl-ts.

## Fetching library docs

For Rust crates: `cd <package-dir> && ../doc-cargo <crate-name>` — this dumps
HTML docs into `.agent-docs/<crate-name>`.

For TypeScript / npm packages: ask the user for help if you're having trouble
with a dependency.

## Postgres

Test database credentials are in `tributary-server/.env`.

## Important

- **Do not start servers.** The environment is a Docker container. Ask the user
  if you need a server running.
- All components must be thoroughly tested.
