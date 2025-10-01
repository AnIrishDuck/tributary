The server is the foundation of the tributary system.

It uses postgres (supabase) as its data persistence layer.

At its core, it is a simple stream persistence library that verifies cryptographic signatures.

API sketch:

- POST /{encoded-pubkey}/{id}
  Request Headers:
    X-Tributary-Hash: {tree hash}
    X-Tributary-Authorization: {signature}
  .. body is a binary blob, almost always encrypted ..
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

