This is a simple CLI that interacts with the `tributary-server`

For simplicity, it stores private keys as locally encoded files and refers to
those for all cli parameters.

This command serves as a test wrapper for the core functionality of
`tributary-client`.

# key

tributary-cli exposes a basic interface for key management:

- `tributary-cli key generate key.read key.write`
  .. prints the base64 encoded pubkey to stdout ..

# psql

tributary-cli exposes an interface for raw sql commands on the database behind a given
tributary collection:

- `tributary-cli psql --read-key key.read 'SELECT * FROM table'`
  .. prints query result to stdout ..
- `tributary-cli psql --write-key key.write 'INSERT VALUES(..) INTO table'`
- `tributary-cli psql --db local.db --write-key key.write 'INSERT VALUES(..) INTO table'`

If no database is specified, it fetches the entire stream into an in-memory
database. This could obviously take some time with large streams.

# static sites

tributary-cli also enables the upload and retrieval of static sites:

- `tributary-cli static up --write-key key.write static_root`
  .. uploads files, creates and puts directory listing, dumps directory json entry to stdout..
- `tributary-cli static ls --write-key key.write`
  .. fetches and prints the directory listing for the static site ..
- `tributary-cli static cat --write-key key.write path/to/doc.html`
  .. fetches and prints the doc to stdout ..
