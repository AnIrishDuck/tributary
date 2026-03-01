import { TributaryClient, TributaryStream, TributaryLocal } from 'tributary-client';
import {
  getAllNotesWithTitles,
  getAuthoritativeVersionByNoteUuid,
  getNoteBySlug,
  getNoteByVersion,
  createNote,
  createCollection,
  indexAll,
  getLibrary,
  getChildCollections,
  getCollectionBySlugUnderParent,
  getNotesBySlugInCollection,
  getNoteSlugPath,
  titleToSlug,
} from '@tributary/scribe-data';
import type { Collection } from '@tributary/scribe-data';
import fs from 'fs';
import path from 'path';

/**
 * Validate that the local directory structure is correct for syncing
 *
 * @param directory The local directory to validate
 * @throws Error if the directory structure is invalid
 */
export async function validateDirectoryStructure(directory: string): Promise<void> {
  // Check that the directory exists
  if (!fs.existsSync(directory)) {
    throw new Error(`Directory does not exist: ${directory}`);
  }

  // Check that .scribe/ directory exists
  const scribeDir = path.join(directory, '.scribe');
  if (!fs.existsSync(scribeDir)) {
    throw new Error(`Missing required directory: ${scribeDir}`);
  }
}

/**
 * Sync notes between local directory and Tributary Scribe library
 *
 * This function:
 * 1. Validates the local directory structure
 * 2. Syncs with the server to get latest remote changes
 * 3. Reads all markdown files from the sync directory
 * 4. Updates the database with any changes
 * 5. Ensures slug filenames match the computed slug names
 *
 * Notes are laid out in directories reflecting their collection hierarchy:
 *   - Root notes: {slug}.md or {slug}/{uuid}.md (for duplicate slugs)
 *   - Collection notes: {collection-slug}/{note-slug}.md
 *   - Nested collections: {collection-slug}/{sub-collection-slug}/{note-slug}.md
 *
 * @param stream The TributaryStream instance for synced operations
 * @param client The TributaryClient instance for explicit sync operations
 * @param directory The local directory to sync with
 * @param options Sync options
 */
export async function sync(
  stream: TributaryStream,
  client: TributaryClient,
  directory: string,
  options: {
    dryRun?: boolean;
    limit?: number;
  } = {}
): Promise<void> {
  const { dryRun = false, limit = 100 } = options;

  // Validate directory structure first - error immediately if not correct
  await validateDirectoryStructure(directory);

  // 1. Sync with server first to get latest changes
  if (!dryRun) {
    console.log('Syncing with server...');
    const syncStatus = await stream.sync(1000);
    console.log(`Server sync completed: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`);
  }

  // Get local database for index operations
  const localDb = stream.local();

  // 2. Index existing notes and collections so that directory walking
  //    can match collection slugs and note slugs correctly
  const preIndexResult = await indexAll(localDb, { limit });
  if (preIndexResult.indexedCount > 0) {
    console.log(`Pre-indexed ${preIndexResult.indexedCount} slugs`);
  }

  // 3. Read local files and update database
  await syncLocalFilesToDatabase(stream, localDb, directory, { dryRun });

  // 4. Re-index notes and collections (including any newly created notes)
  const reindexResult = await indexAll(localDb, { limit });
  console.log(`Re-indexed ${reindexResult.indexedCount} slugs`);
  if (reindexResult.hasMore) {
    console.log(`Has more to index: ${reindexResult.hasMore}`);
  }

  // 5. Update slugs directory with current database state
  await syncSlugsDirectory(stream, localDb, directory, { dryRun });
}

/**
 * Sync the slugs directory with the current database state.
 *
 * Notes are placed into directories based on their collection slug path:
 * - Root notes (no collection): {slug}.md or {slug}/{uuid}.md for duplicates
 * - Collection notes: {collection-path}/{slug}.md or {collection-path}/{slug}/{uuid}.md
 *
 * Collection directories are created as needed. Empty collection directories are
 * kept (they represent collections with no notes yet).
 *
 * @param stream The TributaryStream instance
 * @param localDb The TributaryLocal instance
 * @param rootDir The sync root directory path
 * @param options Sync options
 */
async function syncSlugsDirectory(
  stream: TributaryStream,
  localDb: TributaryLocal,
  rootDir: string,
  options: {
    dryRun?: boolean;
  }
): Promise<void> {
  const { dryRun = false } = options;

  // Get all notes with their slugs from the authoritative versions
  const noteSlugs = await getAllNotesWithTitles(localDb);

  // Build the full slug path for each note and group by path
  // pathKey → [{block_uuid, slug, pathSegments}]
  interface NoteEntry {
    block_uuid: string;
    slug: string;
    slugPath: string[];
  }
  const noteEntries: NoteEntry[] = [];

  for (const noteSlug of noteSlugs) {
    const block_uuid = noteSlug.block_uuid;
    const slug = noteSlug.slug;

    // Get the full slug path for this note (collection path + note slug)
    const slugPath = await getNoteSlugPath(localDb, block_uuid);

    if (slugPath.length === 0) {
      // Fallback: use just the slug if no path could be computed
      noteEntries.push({ block_uuid, slug, slugPath: [slug] });
    } else {
      noteEntries.push({ block_uuid, slug, slugPath });
    }
  }

  // Group notes by their directory path (all segments except the last, which is the note slug)
  // Within each directory, group by note slug to detect duplicates
  interface DirGroup {
    dirPath: string[];
    slugGroups: Map<string, NoteEntry[]>;
  }
  const dirGroupsMap = new Map<string, DirGroup>();

  for (const entry of noteEntries) {
    const dirSegments = entry.slugPath.slice(0, -1);
    const dirKey = dirSegments.join('/');
    if (!dirGroupsMap.has(dirKey)) {
      dirGroupsMap.set(dirKey, { dirPath: dirSegments, slugGroups: new Map() });
    }
    const dirGroup = dirGroupsMap.get(dirKey)!;
    if (!dirGroup.slugGroups.has(entry.slug)) {
      dirGroup.slugGroups.set(entry.slug, []);
    }
    dirGroup.slugGroups.get(entry.slug)!.push(entry);
  }

  // Track all paths we expect to exist
  const expectedPaths = new Set<string>();
  // Track expected directory paths (for collections)
  const expectedDirs = new Set<string>();

  // Also ensure collection directories exist even if they have no notes
  const library = await getLibrary(localDb);
  if (library) {
    await ensureCollectionDirs(localDb, library.collection_uuid, rootDir, [], expectedDirs, dryRun);
  }

  // Write notes
  for (const [, dirGroup] of dirGroupsMap) {
    const dirFsPath = dirGroup.dirPath.length > 0
      ? path.join(rootDir, ...dirGroup.dirPath)
      : rootDir;

    // Ensure the directory exists
    if (dirGroup.dirPath.length > 0) {
      expectedDirs.add(dirFsPath);
      if (!dryRun) {
        await fs.promises.mkdir(dirFsPath, { recursive: true });
      }
    }

    for (const [slug, notes] of dirGroup.slugGroups) {
      const isDuplicate = notes.length > 1;

      for (const { block_uuid: noteUuid } of notes) {
        // Get the authoritative version of the note
        const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, noteUuid);
        if (!authoritativeVersion) {
          console.warn(`No authoritative version found for note ${noteUuid}`);
          continue;
        }

        // Get the note content
        const note = await getNoteByVersion(stream, noteUuid, (authoritativeVersion as any).version_uuid);

        if (!note) {
          console.warn(`Note not found for version ${(authoritativeVersion as any).version_uuid}`);
          continue;
        }

        let filePath: string;
        if (isDuplicate) {
          // Duplicate slug — write to folder: {dir}/{slug}/{uuid}.md
          const slugDir = path.join(dirFsPath, slug);
          filePath = path.join(slugDir, `${noteUuid}.md`);
          expectedDirs.add(slugDir);
          if (!dryRun) {
            await fs.promises.mkdir(slugDir, { recursive: true });
          }
        } else {
          // Unique slug — write as flat file: {dir}/{slug}.md
          filePath = path.join(dirFsPath, `${slug}.md`);
        }

        expectedPaths.add(filePath);

        if (!dryRun) {
          await fs.promises.writeFile(filePath, note.body, 'utf8');

          // Update file timestamps to match note datetime
          const noteDate = new Date(note.insert_datetime);
          await fs.promises.utimes(filePath, noteDate, noteDate);
        }
      }
    }
  }

  // Clean up files and directories that no longer correspond to any slug or collection
  await cleanDirectory(rootDir, rootDir, expectedPaths, expectedDirs, dryRun);
}

/**
 * Recursively ensure that collection directories exist.
 */
async function ensureCollectionDirs(
  localDb: TributaryLocal,
  parentCollectionUuid: string,
  parentFsDir: string,
  currentPath: string[],
  expectedDirs: Set<string>,
  dryRun: boolean
): Promise<void> {
  const children = await getChildCollections(localDb, parentCollectionUuid);
  for (const child of children) {
    const slug = child.slug;
    if (!slug) continue;
    const childPath = [...currentPath, slug];
    const childFsDir = path.join(parentFsDir, slug);
    expectedDirs.add(childFsDir);
    if (!dryRun) {
      await fs.promises.mkdir(childFsDir, { recursive: true });
    }
    // Recurse into subcollections
    await ensureCollectionDirs(localDb, child.collection_uuid, childFsDir, childPath, expectedDirs, dryRun);
  }
}

/**
 * Clean up files and directories that no longer correspond to any note or collection.
 */
async function cleanDirectory(
  dir: string,
  rootDir: string,
  expectedPaths: Set<string>,
  expectedDirs: Set<string>,
  dryRun: boolean
): Promise<void> {
  if (!fs.existsSync(dir)) return;

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (expectedDirs.has(entryPath)) {
        // This is a known directory (collection or duplicate-slug folder) — recurse into it
        await cleanDirectory(entryPath, rootDir, expectedPaths, expectedDirs, dryRun);
      } else {
        // Unknown directory — remove it
        if (!dryRun) {
          await fs.promises.rm(entryPath, { recursive: true });
        }
      }
    } else if (entry.name.endsWith('.md')) {
      if (!expectedPaths.has(entryPath)) {
        if (!dryRun) {
          await fs.promises.unlink(entryPath);
        }
      }
    }
  }

  // After cleaning, remove the directory if it's empty and not the root
  if (dir !== rootDir) {
    const remaining = await fs.promises.readdir(dir);
    const nonDotEntries = remaining.filter(f => !f.startsWith('.'));
    if (nonDotEntries.length === 0 && !expectedDirs.has(dir)) {
      if (!dryRun) {
        await fs.promises.rm(dir, { recursive: true });
      }
    }
  }
}

/**
 * Sync a single local file to the database, matching by block UUID or slug
 */
async function syncFileToDatabase(
  stream: TributaryStream,
  localDb: TributaryLocal,
  filePath: string,
  blockUuid: string | null,
  fileLabel: string,
  collectionId: string | null,
  options: { dryRun?: boolean }
): Promise<void> {
  const { dryRun = false } = options;

  const content = await fs.promises.readFile(filePath, 'utf8');
  const stats = await fs.promises.stat(filePath);
  const fileMtime = stats.mtime.toISOString();

  if (blockUuid) {
    // Known note — check for content changes
    const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, blockUuid);

    if (authoritativeVersion) {
      const av = authoritativeVersion as any;
      const currentNote = await getNoteByVersion(stream, blockUuid, av.version_uuid);

      if (currentNote) {
        if (currentNote.body !== content) {
          if (!dryRun) {
            await createNote(stream, {
              block_uuid: blockUuid,
              block_type: 'scribe/markdown',
              body: content,
              inserter: 'scribe-cli-sync',
              prior_version_uuid: av.version_uuid,
              collection_id: collectionId,
              insert_datetime: fileMtime,
            });
            console.log(`Updated note ${blockUuid} with new version`);
          } else {
            console.log(`Would update note ${blockUuid} with new version (dry run)`);
          }
        }
      }
    } else {
      console.warn(`Found note without authoritative version: ${blockUuid}`);
    }
  } else {
    // New note
    if (!dryRun) {
      await createNote(stream, {
        block_type: 'scribe/markdown',
        body: content,
        inserter: 'scribe-cli-sync',
        collection_id: collectionId,
        insert_datetime: fileMtime,
      });
      console.log(`Created new note for file: ${fileLabel}`);
    } else {
      console.log(`Would create new note for file: ${fileLabel} (dry run)`);
    }
  }
}

/**
 * Sync local files from the sync directory to the database.
 *
 * Walks the directory tree. At each level:
 * - .md files are matched to notes by slug (scoped to the current collection)
 * - Directories are checked against collection slugs; if a directory matches a
 *   collection, we recurse into it with that collection's UUID as context.
 * - Directories inside a duplicate-slug folder contain UUID-named files.
 *
 * @param stream The TributaryStream instance
 * @param localDb The TributaryLocal instance
 * @param rootDir The sync root directory path
 * @param options Sync options
 */
async function syncLocalFilesToDatabase(
  stream: TributaryStream,
  localDb: TributaryLocal,
  rootDir: string,
  options: {
    dryRun?: boolean;
  }
): Promise<void> {
  // Get the library root to determine collection hierarchy
  const library = await getLibrary(localDb);
  const libraryUuid = library?.collection_uuid ?? null;

  await syncDirectoryLevel(stream, localDb, rootDir, null, libraryUuid, options);
}

/**
 * Convert a slug back to a human-readable title.
 * e.g. "my-recipes" → "My Recipes"
 */
function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Sync a single directory level to the database.
 *
 * @param stream The TributaryStream instance
 * @param localDb The TributaryLocal instance
 * @param dir The directory to process
 * @param collectionId The collection UUID that notes in this directory belong to (null = root)
 * @param parentCollectionUuid The parent collection UUID for looking up child collections (null if no library)
 * @param options Sync options
 */
async function syncDirectoryLevel(
  stream: TributaryStream,
  localDb: TributaryLocal,
  dir: string,
  collectionId: string | null,
  parentCollectionUuid: string | null,
  options: { dryRun?: boolean }
): Promise<void> {
  const { dryRun = false } = options;

  if (!fs.existsSync(dir)) {
    return;
  }

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      const dirName = entry.name;
      const dirPath = path.join(dir, dirName);

      // Check if this directory matches a child collection
      let matchedCollection: Collection | null = null;
      if (parentCollectionUuid) {
        const collectionSlug = await getCollectionBySlugUnderParent(localDb, dirName, parentCollectionUuid);
        if (collectionSlug) {
          matchedCollection = { collection_uuid: collectionSlug.collection_uuid } as Collection;
        }
      }

      if (matchedCollection) {
        // This directory is a collection — recurse with the collection context
        await syncDirectoryLevel(
          stream, localDb, dirPath,
          matchedCollection.collection_uuid,
          matchedCollection.collection_uuid,
          options
        );
      } else {
        // Check if this directory name matches an existing note slug in the
        // current scope — if so, it's a duplicate-slug folder with {uuid}.md files.
        const matchingNoteSlugs = await getNotesBySlugInCollection(localDb, dirName, collectionId);

        if (matchingNoteSlugs.length > 0) {
          // Duplicate-slug folder — files inside are {uuid}.md
          const subFiles = (await fs.promises.readdir(dirPath))
            .filter(f => f.endsWith('.md') && !f.startsWith('.'));

          for (const subFile of subFiles) {
            const filePath = path.join(dirPath, subFile);
            const fileUuid = subFile.slice(0, -3);
            await syncFileToDatabase(stream, localDb, filePath, fileUuid, `${dirName}/${subFile}`, collectionId, { dryRun });
          }
        } else if (parentCollectionUuid) {
          // Unrecognized directory that doesn't correspond to a duplicate slug —
          // create a new collection for it and recurse into it.
          const title = slugToTitle(dirName);
          let newCollectionUuid: string;

          if (!dryRun) {
            const newCollection = await createCollection(stream, {
              title,
              parent_collection_uuid: parentCollectionUuid,
              inserter: 'scribe-cli-sync',
            });
            newCollectionUuid = newCollection.collection_uuid;
            console.log(`Created new collection: ${title}`);
          } else {
            newCollectionUuid = `dry-run-${dirName}`;
            console.log(`Would create new collection: ${title} (dry run)`);
          }

          await syncDirectoryLevel(
            stream, localDb, dirPath,
            newCollectionUuid,
            newCollectionUuid,
            options
          );
        }
      }
    } else if (entry.name.endsWith('.md')) {
      // Flat file — match by slug scoped to the current collection
      const filePath = path.join(dir, entry.name);
      const fileSlug = entry.name.slice(0, -3);

      // Look up existing note by slug in the current collection scope
      const matchingNotes = await getNotesBySlugInCollection(localDb, fileSlug, collectionId);
      const blockUuid = matchingNotes.length > 0 ? matchingNotes[0].block_uuid : null;

      await syncFileToDatabase(stream, localDb, filePath, blockUuid, entry.name, collectionId, { dryRun });
    }
  }
}
