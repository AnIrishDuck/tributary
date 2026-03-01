# Scribe Linking System

The Scribe app provides a powerful internal linking system that allows notes to reference each other using markdown links. This document explains how the linking system works, from link detection to resolution.

## Overview

Scribe uses note slugs as the basis for internal linking. When users create markdown links with targets that don't contain `/` or start with `#`, Scribe interprets these as references to other notes by their slugs.

## Link Detection

The linking system identifies internal note references through markdown link syntax:

```markdown
[Link Text](link-target)
```

A target is considered an internal note reference if it:
- Does not contain a forward slash (`/`)
- Does not start with a hash (`#`)
- Is not an absolute URL (http://, https://, etc.)

Examples:
- `[My Note](my-note)` → Internal link to slug `my-note`
- `[Recipe](beef-stew)` → Internal link to slug `beef-stew`
- `[Note](abcd-note)` → Internal link to prefixed slug `abcd-note`
- `[External](http://example.com)` → External link (not processed)
- `[Tag](#tag)` → Tag link (processed separately)
- `[File](path/to/file.md)` → File link (not processed as internal note link)

## Tag Links

Scribe supports tagging notes using special markdown link syntax. Tags are created using the format `[#tagname](#tagname)` where both the link text and target start with `#` and are identical.

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
1. Scans note content for markdown links matching the tag pattern
2. Extracts the tag name from valid tag links
3. Stores tags in the `block_tag` index table
4. Removes tags that are no longer present in note updates

## Link Resolution Process

When resolving internal links, Scribe follows these steps:

### 1. Link Identification
During note processing and sync operations, the system scans note content for markdown links that match the internal link criteria.

### 2. Slug Lookup
The link target is looked up via the synced `block.slug` column (joined through
the `authoritative_version` table) to find matching notes:
- The system searches for exact slug matches
- Both base slugs and prefixed slugs are supported

### 3. Resolution Outcomes
Depending on the lookup results, one of three outcomes occurs:

#### Direct Match
- **Condition**: Exactly one note matches the slug
- **Action**: Link resolves directly to that note
- **Example**: `[Recipe](beef-stew)` links to the note with slug `beef-stew`

#### Duplicate Slug Match
- **Condition**: Multiple notes share the same slug
- **Action**: Link resolves to a duplicate slug listing page showing each matching document's UUID and title
- **Example**: `[Note](same-title)` resolves to a listing of all notes with slug `same-title`, from which the user selects the intended target

#### No Match
- **Condition**: No notes match the slug
- **Action**: Link is treated as broken/invalid
- **Example**: `[Missing](nonexistent)` has no target note

## Duplicate Slug Handling

Multiple notes may share the same slug. When a link target matches more than
one note, the client presents a duplicate slug listing page:

### Resolution Process
1. The synced `block.slug` column is queried (via `authoritative_version`) for all notes matching the slug
2. All matching notes are presented with their UUID and title
3. The user selects the intended target

### Example
If two notes both have the slug `same-title`:
- Note A: `8f4187cb-...` with title "Same Title (Work)"
- Note B: `a72626cf-...` with title "Same Title (Personal)"

The link resolves to a listing page. The user can then navigate to the
specific note via `slug/same-title/[uuid]`.

## Link Validation

Scribe provides link validation to help maintain note integrity:

### Broken Link Detection
- Links that don't resolve to any note are flagged as broken
- The CLI can report broken links during sync operations
- Editors can highlight broken links for user attention

### Link Integrity
- Links are automatically validated during indexing
- When notes are renamed or deleted, affected links are identified
- Users can be notified of link changes that might affect their notes

## Integration with Slug System

The linking system works closely with the slug system:

### Slug Dependencies
- Every internal link depends on accurate slugs
- Slugs are synced properties on the `block` and `collection` tables, so they
  are available on every client without local indexing
- Because slugs are fixed at creation and only change via explicit user action,
  links are stable across title edits

### Duplicate Slug Impact
- Links to a slug shared by multiple entities resolve to a collision page
- Links to a unique slug resolve directly to that entity
- Users can link to a specific note unambiguously via `slug/[uuid]`

## Future Enhancements

Planned improvements to the linking system:

1. **Backlink Tracking**: Track which notes link to each note
2. **Link Graph Visualization**: Visual representation of note relationships
3. **Automatic Link Suggestions**: Suggest relevant notes to link to while editing
4. **Link Validation Reports**: Detailed reports of broken or ambiguous links
5. **Refactoring Tools**: Tools to help update links when notes are reorganized
