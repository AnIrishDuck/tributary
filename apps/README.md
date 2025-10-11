This contains official "apps" used to organize tributary data.

The typical source structure for apps looks like this (e.g. the catalog app):

- apps/catalog-data  - core data definitions (e.g. migrations) and operations
- apps/catalog-cli   - command line tool for viewing and modifying catalog
- apps/catalog-react - browser app for catalog exposing the UI. 

# Deploying App Bundles

App UIs are typically static sites built via e.g. Vite.

They utilize the static stream layout functionality built into
`tributary-server`.

Thus, they can be uploaded with `tributary-cli static`
