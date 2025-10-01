This is a simple CLI that interacts with the `tributary-server`

For simplicity, it stores private keys as locally encoded files and refers to
those for all cli parameters.

This command serves as a test wrapper for the core functionality of
`tributary-replicate`.

It exposes an interface for raw sql commands on the database behind a given
tributary collection:

- `tributary-cli psql --readkey keyfile 'SELECT * FROM table'`
- `tributary-cli psql --writekey keyfile 'INSERT VALUES(..) INTO table'`
- `tributary-cli psql --local local.db --writekey keyfile 'INSERT VALUES(..) INTO table'`

If no database is specified, it replicates the entire stream into an in-memory
database. This could obviously take some time with large streams.
