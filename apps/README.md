This contains official "apps" used to organize tributary data.

The typical source structure for apps looks like this (e.g. the catalog app):

- apps/catalog/catalog-data  - core data definitions (e.g. migrations) and operations
- apps/catalog/catalog-cli   - command line tool for viewing and modifying catalog
- apps/catalog/catalog-react - browser app for catalog exposing the UI. 

# CLI Conventions

The CLI for apps defaults to storing the database for that app in the local home
directory with the app id: `~/.local/state/<app id>/`
