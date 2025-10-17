This is a simple CLI that interacts with the `tributary-server`

For simplicity, it stores private keys as locally encoded files and refers to
those for all cli parameters.

This command serves as a test wrapper for the core functionality of
`tributary-client`.

# key

tributary-cli exposes a basic interface for key management:

- `tributary key generate`
  .. adds the key to the client and prints the url safe base64 encoded stream id to stdout ..
- `tributary key list`
  .. display the table of tracked streams in the local tributary database ..
- `tributary key export [stream_id]`
  .. prints url safe base64 encoded private key ..
- `tributary key import`
  .. imports url safe base64 encoded private key to local database and runs a full sync ..

Note that `key export` and `key import` can be used to transfer keys between databases:

- `tributary key export --db a.db [stream_id] | tributary key import --db b.db` 

# psql

tributary-cli exposes an interface for raw sql commands on the database behind a given
tributary stream:

- `tributary psql [stream_id] 'SELECT * FROM table'`
  .. prints query result to stdout ..
- `tributary psql [stream_id] 'INSERT VALUES(..) INTO table'`
- `tributary psql --db local.db [stream_id] 'INSERT VALUES(..) INTO table'`

# static sites

the static site functionality for tributary-cli is no longer supported
