The server is the foundation of the tributary system.

It uses postgres (supabase) as its data persistence layer.

At its core, it is a simple stream persistence library that verifies cryptographic signatures.

API sketch:

- GET /{encoded-pubkey}/info
  .. body is JSON: `{"end": <last_id>}` ..
- POST /{encoded-pubkey}
  Request Headers:
    X-Tributary-Hash: {tree hash}
    X-Tributary-Authorization: {signature}
  .. body is a binary blob, almost always encrypted ..
  .. The blob ID is automatically generated as {pubkey}:{sequence_number} ..
- GET /{encoded-pubkey}/{id}
  Response Headers:
    X-Tributary-Hash: {tree hash}
    X-Tributary-Signature: {signature}
  .. body is a binary blob, almost always encrypted ..

The signed data is a recursive merkle tree structure. We concatentate two hashes together:

- prior entry tree hash
- current body hash

The resulting hash is the new `X-Tributary-Hash` value for this entry, which is
signed by the public key. On POST, it goes into `X-Tributary-Authorization`. On
GET, it is returned in `X-Tributary-Signature`

The server **must reject** posts that do not have a valid hash or signature.

Each blob is identified by an ID that consists of the public key + sequence number:
- First blob: `{pubkey}:1`
- Second blob: `{pubkey}:2`
- etc.

# Static Sites

The server must also be able to serve unencrypted streams as static sites.

To make a stream serve a static site, the last entry in the stream must be JSON
and have this structure:

```
{
  "directory": {
     "value.html": { "ix": 0, "content-type": "text/html" },
     "bundle.json": { "ix": 1, "content-type": "application/json" },
     "photos/photo.png": { "ix": 2, "content-type": "img/png" }
  }
}
```

In this example, this record would be entry index 3 on the stream.

The server then knows how to respond to GET requests on `/{encoded-pubkey}/static/{path}`:

- `GET /{encoded-pubkey}/static/value.html` => entry 0, content type text/html
- `GET /{encoded-pubkey}/static/bundle.json` => entry 1, content type application/json
- `GET /{encoded-pubkey}/static/photos/photo.png` => entry 2, content type application/json

