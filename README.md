tributary is a system for creating collections of end-to-end encrypted data.

A tributary collection has two key components:

- the _app_: code that organizes, maintains, etc the database and presents
  it in a user friendly format
- the _stream_: encrypted database (pglite) replication log that can be
  replayed to recreate the database

For example, for notes we are going to create a "scribe" app that maintains
documents. Other apps may be more appropriate for e.g. photo or location /
presence collections.

## Layout

This project is organized into several components:

- **tributary-server** - a rust server responsible for storing the raw encrypted
  binary streams and blobs
- **tributary-cli** - a typescript cli command useful for debugging and testing
- **tributary-client** - a typescript library that wraps PGLite with persistence guarantees
- **tributary-catalog** - a react application for listing and managing all user
  collections.
- **apps** - where we maintain official apps
  - **scribe** - a markdown document editor, indexer, and linker

## Tech Stack

- We write the very minimal backend in rust.
- The core frontend database is pglite.
- For everything frontend, we default to typescript and vite. We use vitest for
  testing.
- For crypto, we default to tweetnacl / tweetnacl-ts. Good wrappers are not
  available for these in rust, so we need to use the `ed25519_dalek` and `sha2`
  crates directly.

## Testing
- **ALL COMPONENTS MUST BE THOROUGHLY TESTED**
- **WE NEVER USE MOCKS FOR TESTING**. We prefer fakes where necessary that can
  be easily substituted for the associated clients for thorough integration
  testing.
