This is a simple CLI that interacts with the `tributary-server`

For simplicity, it stores private keys as locally encoded files and refers to
those for all cli parameters.

This command serves as a test wrapper for the core functionality of
`tributary-client`.

# key

tributary-cli exposes a basic interface for key management:

GOOSE: there is no key name, these get inserted directly into the database by the 
relevant TributaryClient methods. Also, the operations should be verbs, not --options
as they are currently implemented:
- `tributary key generate [app-id]`
  .. adds the key to the client and the stream id ..
- `tributary key list [app-id]`
  .. display the table of tracked streams in the local tributary database ..
- `tributary key show [app-id]/[stream_id]`
  .. prints schema info from local key database ..
- `tributary key export [app-id]/[stream_id]`
  .. prints url-base64 encoded private key to stdout ..
- `tributary key import [app-id]`
  .. imports url-base64 encoded private key to local database via stdin ..

GOOSE: no, these keys are stored directly in the database via the relevant
methods on `TributaryClient`.
Note that all keys are stored in `~/.local/state/[app-id]/keys/` directory.

Note that `key export` and `key import` can be used to transfer keys between databases:

- `tributary key export keymaster/af12d... | tributary key import scribe`

# psql

tributary-cli exposes an interface for raw sql commands on the database behind a given
tributary stream:

GOOSE: the slashes between [app-id] and [stream_id] were intentional here, ensure the cli
works as documented
- `tributary psql [app-id]/[stream_id] 'SELECT * FROM table'`
  .. prints query result to stdout ..
- `tributary psql [app-id]/[stream_id] 'INSERT VALUES(..) INTO table'`
- `tributary psql --db local-db/ [app-id]/[stream_id] 'INSERT VALUES(..) INTO table'`

The database directory defaults to `~/.local/state/[app-id]/`.

# static sites

the static site functionality for tributary-cli is no longer supported
