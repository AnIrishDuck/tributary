# Tributary MVP Implementation Plan

## Overview

This document outlines the implementation plan for a Minimum Viable Product (MVP) of Tributary, focusing on three core components:
- **tributary-server**: Rust server for storing encrypted binary streams
- **tributary-cli**: TypeScript CLI for debugging and testing
- **tributary-client**: Core TypeScript client library that wraps PGLite and ensures server persistence

## 1. tributary-server (Rust)

### 1.0 Dependencies
- We'll need to collaborate to figure out how to get the Supabase ports
  forwarded into your VM.

### 1.1 Core Requirements
- REST API for storing and retrieving encrypted binary streams
- PostgreSQL (Supabase) as persistence layer
- Cryptographic signature verification using ed25519_dalek
- Merkle tree structure for data integrity

### 1.2 API Endpoints
- `POST /{encoded-pubkey}/{id}` - Store encrypted blob with signature verification
- `GET /{encoded-pubkey}/{id}` - Retrieve encrypted blob with signature

### 1.3 Implementation Steps

#### Phase 1: Project Setup
- Initialize Rust project with Cargo
- Add dependencies: actix-web, tokio, ed25519-dalek, sha2, serde, postgresql connection
- Setup basic project structure and configuration

#### Phase 2: Core Data Models
- Define data structures for:
  - Encrypted blob storage
  - Signature verification
  - Merkle tree hash computation
- Implement cryptographic utilities for:
  - Signature verification
  - Hash computation
  - Key encoding/decoding

#### Phase 3: Database Integration
- Setup PostgreSQL connection using sqlx or diesel
- Create database schema for blob storage
- Implement data access layer

#### Phase 4: API Implementation
- Implement POST endpoint with signature verification
- Implement GET endpoint with signature generation
- Add request validation and error handling
- Implement proper HTTP status codes

#### Phase 5: Testing
- Unit tests for cryptographic functions
- Integration tests for API endpoints
- Test signature validation with valid/invalid signatures

## 2. tributary-client (TypeScript)

### 2.1 Core Requirements
- Core TypeScript client library that wraps PGLite
- Ensures server persistence of write operations before committing locally
- Secure communication with tributary-server
- Cryptographic signing using tweetnacl-ts

### 2.2 Implementation Steps

#### Phase 1: Project Setup
- Initialize TypeScript project with npm
- Add dependencies: pglite, tweetnacl-ts, axios/fetch for HTTP requests
- Setup build system with TypeScript compiler
- Configure testing framework (Vitest)

#### Phase 2: Core Functionality
- Implement PGLite wrapper with persistence guarantees
- Create cryptographic signing utilities with tweetnacl-ts
- Implement HTTP client for server communication
- Design transaction confirmation mechanism

#### Phase 3: Persistence Guarantee Logic
- Implement write operation queuing
- Add server confirmation requirement before local commit
- Handle network failures and retries
- Implement conflict resolution mechanisms

#### Phase 4: Security Implementation
- Implement proper nonce generation
- Add key management utilities
- Ensure all data is encrypted before transmission
- Add validation for all cryptographic operations

#### Phase 5: Testing
- Unit tests for cryptographic functions
- Integration tests with mocked PGLite
- End-to-end tests with tributary-server
- Failure scenario testing

## 3. tributary-cli (TypeScript)

### 3.1 Core Requirements
- Command-line interface for Tributary operations
- Local key management (private key storage)
- SQL command execution on Tributary collections
- Integration with tributary client library for database operations

### 3.2 Implementation Steps

#### Phase 1: Project Setup
- Initialize TypeScript project with npm
- Add dependencies: commander.js for CLI parsing, pglite, tweetnacl-ts
- Setup build system and testing framework

#### Phase 2: Key Management
- Implement key file reading/writing utilities
- Create key generation functionality
- Implement key validation and encoding/decoding

#### Phase 3: CLI Interface
- Implement psql command with flags:
  - --readkey: For read operations
  - --writekey: For write operations
  - --local: For local database operations
- Add command parsing and validation

#### Phase 4: Database Integration
- Implement SQL execution functionality
- Integrate with tributary client library for remote operations
- Add in-memory database support for temporary operations

#### Phase 5: Testing
- Unit tests for CLI command parsing
- Integration tests with tributary client library
- End-to-end tests with tributary-server

## 4. Integration and Testing

### 4.1 Component Integration
- Ensure tributary-cli can communicate with tributary-server through tributary client library
- Test end-to-end flow: CLI → Tributary Client → Server → Database
- Verify cryptographic signatures at each step

### 4.2 Security Testing
- Validate signature verification on server
- Test key rotation scenarios
- Verify encryption/decryption consistency

### 4.3 Performance Testing
- Test with large binary blobs
- Validate batch processing performance
- Measure replication latency

## 5. Documentation

### 5.1 API Documentation
- Document all REST endpoints with examples
- Provide signature generation/validation examples
- Document error responses

### 5.2 User Guides
- tributary-cli usage guide with examples
- tributary client library configuration guide
- Key management best practices

### 5.3 Developer Documentation
- Architecture overview
- Cryptographic implementation details
- Testing guidelines

## 6. Deployment Considerations

### 6.1 tributary-server
- Docker containerization
- Environment-based configuration
- Database migration scripts
- Health check endpoints

### 6.2 tributary-cli
- npm package publication
- Installation instructions
- Cross-platform compatibility

### 6.3 tributary client library
- npm package publication
- Browser compatibility testing
- Integration examples with popular frameworks

## 7. Timeline

### Week 1-2: tributary-server MVP
- Basic Rust project setup
- PostgreSQL integration
- Initial API implementation
- Basic cryptographic functions

### Week 3-4: tributary client library MVP
- TypeScript project setup
- PGLite wrapper implementation
- HTTP communication layer
- Cryptographic signing implementation
- Persistence guarantee mechanisms

### Week 5-6: tributary-cli MVP
- CLI framework implementation
- Key management utilities
- SQL execution functionality
- Integration with tributary client library

### Week 7: Integration and Testing
- End-to-end integration testing
- Security validation
- Performance optimization
- Documentation

## 8. Success Criteria

- tributary-server accepts signed POST requests and returns signed GET responses
- tributary client library ensures server persistence before local commits
- tributary-cli can execute SQL commands on Tributary collections
- All components pass security validation
- Comprehensive test coverage (minimum 80%)
