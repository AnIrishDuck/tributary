tributary is a system for building personal software applications.

What we call "personal software" has three key characteristics:

- Open source. Auditable and hackable.
- Content blind, dumb servers. Servers used for synchronization follow a very
  simple protocol to ensure data consistency. They see only encrypted data.
- Thick clients. All of the app functionality is handled on the client. We
  package our apps as PWAs for maximum portability.

## Customization

Taken together, this also enables a third key property: customization. Because
practically all functionality is handled by the client, you can easily fork and
modify any tributary app to suit your needs.

You can then deploy and use your custom app (via e.g. vercel) with the stock
tributary storage service.

You could even run your own storage service for synchronization. We have
designed the storage service to be as simple as possible and provide deployment
templates for common services (e.g. supabase).

## Apps

Tributary conceptually is designed to enable a wide variety of applications.

At the moment, we are focused on developing "scribe", an app that maintains and
indexes collections of notes.

We have rough plans for future apps for e.g. photo or location / presence
collections.

## Architecture

A tributary collection has two key components:

- the _app_: code that organizes, maintains, etc the database and presents
  it in a user friendly format
- the _stream_: encrypted database (pglite) replication log that can be
  replayed to recreate the database

### Storage Service

The storage service has two key responsibilities:

- Consistency. The storage service maintains a linear history for all "streams"
  of data to enable sensible client-side data convergence and consistency
  strategies.
- Authorization (and Quotas). We do not have infinite money, storage, or
  bandwidth. We therefore must monitor and cap the data we send and store.

## Layout

This project is organized into several components:

- **supabase** - database migration and serverless functions for the remote
  tributary server
- **tributary-cli** - a typescript cli command useful for debugging and testing
- **tributary-client** - a typescript library that wraps PGLite with
  persistence guarantees
- **apps** - where we maintain official apps
  - **scribe** - a markdown note editor, indexer, and linker

## Development

tributary and its associated apps are developed with much agent assistance.

While we frequently delegate agents to _write_ code, we strongly believe that
we (humans) must maintain a high level of understanding of the how, what, and
why of the code's doings. In other words, we _read_ all of the code that gets
commited. We expect the same of every contribution.

This ultimately means that we have very limited time resources that need to be
carefully allocated.

Our top priority is maintaining our understanding of the codebase. Large PRs (a
rough heuristic being >1000 LoC of real code changes) are antithetical to this
goal and a strain on our limited resources; they will almost certainly be
rejected out of hand. We strongly encourage engaging early (via GitHub issues)
if you would like to make such a change to align on a plan and avoid future
heartbreak.

Code changes will only be approved when we and the contributor have
demonstrated understanding of the change. We expect agent assistance and
comments to be clearly disclosed, and we expect to engage with humans when
discussing the code and any proposed changes.

What seems like an improvement to some may not seem that way to us. We reserve
the right to make that judgement. If there is any doubt on whether a change
will be approved, we strongly encourage discussion via GitHub Issues before
possibly wasting time and/or tokens on a change that will not get merged.

If you disagree: this is an open source project. We may be able to discuss and
find common ground. If not, you are welcome to fork and continue using our or
another storage server.

### Tech Stack

- We write the very minimal reference storage server on top of supabase.
- The core frontend database is pglite.
- For everything frontend, we default to typescript and vite. We use vitest for
  testing.
- For crypto, we default to tweetnacl / tweetnacl-ts.

### Testing
- **ALL COMPONENTS MUST BE THOROUGHLY TESTED**
- **WE NEVER USE MOCKS FOR TESTING**. We prefer fakes where necessary that can
  be easily substituted for the associated clients for thorough integration
  testing.
