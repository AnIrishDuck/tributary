This is a simple CLI that interacts with the `tributary-server`

For simplicity, it stores private keys as locally encoded files and refers to
those for all cli parameters.

This command serves as a test wrapper for the core functionality of
`tributary-client`.

# Environment Variables

- `TRIBUTARY_URL` - The URL of the Tributary server to connect to. Defaults to `http://tributary:8080`.

# key

tributary-cli exposes a basic interface for key management:

- `tributary key generate <app-id>`
  .. adds the key to the client and the stream id ..
- `tributary key list <app-id>`
  .. display the table of tracked streams in the local tributary database for the specified app..
- `tributary key show <app-id>/<stream_id>`
  .. prints schema info from local key database for the specified app and stream..
- `tributary key export <app-id>/<stream_id>`
  .. prints url-base64 encoded private key to stdout for the specified app and stream..
- `tributary key import <app-id>`
  .. imports url-base64 encoded private key to local database via stdin for the specified app..

Note that all keys are managed through the TributaryClient and stored in the database.

Note that `key export` and `key import` can be used to transfer keys between databases:

- `tributary key export scribe/af12d... | tributary key import scribe`

# psql

tributary-cli exposes an interface for raw sql commands on the database behind a given
tributary stream:

- `tributary psql <app-id>/<stream_id> 'SELECT * FROM table'`
  .. prints query result to stdout ..
- `tributary psql <app-id>/<stream_id> 'INSERT VALUES(..) INTO table'`
- `tributary psql --db local-db/ <app-id>/<stream_id> 'INSERT VALUES(..) INTO table'`

The database directory defaults to `~/.local/state/[app-id]/`.

# static sites

the static site functionality for tributary-cli is no longer supported
