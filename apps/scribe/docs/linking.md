# Scribe Linking System

The Scribe app provides a powerful internal linking system that allows documents to reference each other using markdown links. This document explains how the linking system works, from link detection to resolution.

## Overview

Scribe uses document slugs as the basis for internal linking. When users create markdown links with targets that don't contain `/` or start with `#`, Scribe interprets these as references to other documents by their slugs.

## Link Detection

The linking system identifies internal document references through markdown link syntax:

```markdown
[Link Text](link-target)
```

A target is considered an internal document reference if it:
- Does not contain a forward slash (`/`)
- Does not start with a hash (`#`)
- Is not an absolute URL (http://, https://, etc.)

Examples:
- `[My Document](my-document)` → Internal link to slug `my-document`
- `[Recipe](beef-stew)` → Internal link to slug `beef-stew`
- `[Note](abcd-note)` → Internal link to prefixed slug `abcd-note`
- `[External](http://example.com)` → External link (not processed)
- `[Tag](#tag)` → Tag link (processed separately)
- `[File](path/to/file.md)` → File link (not processed as internal document link)

## Tag Links

Scribe supports tagging documents using special markdown link syntax. Tags are created using the format `[#tagname](#tagname)` where both the link text and target start with `#` and are identical.

### Tag Restrictions

Tags must adhere to specific restrictions:
- Tags must not contain a colon (`:`) as this is reserved for protocol identifiers
- Tags must not contain a forward slash (`/`) as this is reserved for relative path navigation
- Tags must not contain whitespace characters
- Tags are case-sensitive

Examples:
- Valid tags: `[#work](#work)`, `[#important](#important)`, `[#2023](#2023)`
- Invalid tags: `[#http://example.com](#http://example.com)`, `[#path/to/resource](#path/to/resource)`

### Tag Extraction Process

The tag extraction process:
1. Scans document content for markdown links matching the tag pattern
2. Extracts the tag name from valid tag links
3. Stores tags in the `block_tag` index table
4. Removes tags that are no longer present in document updates

## Link Resolution Process

When resolving internal links, Scribe follows these steps:

### 1. Link Identification
During document processing and sync operations, the system scans document content for markdown links that match the internal link criteria.

### 2. Slug Lookup
The link target is looked up in the `block_slug` table to find matching documents:
- The system searches for exact slug matches
- Both base slugs and prefixed slugs are supported

### 3. Resolution Outcomes
Depending on the lookup results, one of three outcomes occurs:

#### Direct Match
- **Condition**: Exactly one document matches the slug
- **Action**: Link resolves directly to that document
- **Example**: `[Recipe](beef-stew)` links to the document with slug `beef-stew`

#### Ambiguous Match
- **Condition**: Multiple documents match the base slug (typically during conflict resolution)
- **Action**: Link resolves to a disambiguation page listing all possible targets
- **Example**: `[Note](same-title)` may resolve to a page listing all documents with base slug `same-title`

#### No Match
- **Condition**: No documents match the slug
- **Action**: Link is treated as broken/invalid
- **Example**: `[Missing](nonexistent)` has no target document

## Disambiguation Handling

When multiple documents could match a link target, Scribe automatically generates disambiguation pages:

### Disambiguation Process
1. A disambiguation page is created in the `indexed/links/` directory
2. The page lists all documents with matching base slugs
3. Each entry includes the full document title and unique slug
4. Users can navigate to the correct document from this page

### Example
If two documents both have the base slug `same-title`:
- Document A: `abcd-same-title` with title "Same Title (Work)"
- Document B: `1234-same-title` with title "Same Title (Personal)"

A disambiguation page at `indexed/links/same-title.md` would contain:
```markdown
# Multiple documents found for: same-title

There are multiple documents with similar names. Please select the correct one:

- [Same Title (Work)](abcd-same-title)
- [Same Title (Personal)](1234-same-title)
```

## Link Validation

Scribe provides link validation to help maintain document integrity:

### Broken Link Detection
- Links that don't resolve to any document are flagged as broken
- The CLI can report broken links during sync operations
- Editors can highlight broken links for user attention

### Link Integrity
- Links are automatically validated during indexing
- When documents are renamed or deleted, affected links are identified
- Users can be notified of link changes that might affect their documents

## Integration with Slug System

The linking system works closely with the slug system:

### Slug Dependencies
- Every internal link depends on accurate slug generation
- When slugs change due to conflict resolution, links are automatically updated
- The `block_slug` table serves as the authoritative lookup for link resolution

### Conflict Impact
- When slug conflicts are resolved by adding UUID prefixes, existing links may need updating
- Links to base slugs continue to work if they remain unique
- Links to specific prefixed slugs remain stable

## Future Enhancements

Planned improvements to the linking system:

1. **Backlink Tracking**: Track which documents link to each document
2. **Link Graph Visualization**: Visual representation of document relationships
3. **Automatic Link Suggestions**: Suggest relevant documents to link to while editing
4. **Link Validation Reports**: Detailed reports of broken or ambiguous links
5. **Refactoring Tools**: Tools to help update links when documents are reorganized
