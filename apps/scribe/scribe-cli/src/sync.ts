import { TributaryClient, TributaryStream, TributaryLocal } from 'tributary-client';
import {
  getAllNoteSlugs,
  getAuthoritativeVersionByNoteUuid,
  getNoteBySlug,
  indexSlugs
} from '@tributary/scribe-data/dist/indexing.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
  
  // 2. Read local files and update database
  await syncLocalFilesToDatabase(stream, localDb, directory, { dryRun });

  // 3. Re-index any newly added/updated notes
  const reindexResult = await indexSlugs(localDb, { limit });
  console.log(`Re-indexed ${reindexResult.indexedCount} slugs`);
  if (reindexResult.hasMore) {
    console.log(`Has more to index: ${reindexResult.hasMore}`);
  }

  // 4. Update slugs directory with current database state
  await syncSlugsDirectory(stream, localDb, directory, { dryRun });
}

/**
 * Sync the slugs directory with the current database state
 *
 * Notes with unique slugs are written as flat files: {slug}.md
 * Notes with duplicate slugs are written in folders: {slug}/{uuid}.md
 *
 * @param stream The TributaryStream instance
 * @param localDb The TributaryLocal instance
 * @param slugsDir The slugs directory path
 * @param options Sync options
 */
async function syncSlugsDirectory(
  stream: TributaryStream,
  localDb: TributaryLocal,
  slugsDir: string,
  options: {
    dryRun?: boolean;
  }
): Promise<void> {
  const { dryRun = false } = options;

  // Get all current slugs from the database
  const noteSlugs = await getAllNoteSlugs(localDb);

  // Group notes by slug to detect duplicates
  const slugGroups = new Map<string, Array<{ block_uuid: string; slug: string }>>();
  for (const noteSlug of noteSlugs) {
    const slug = (noteSlug as any).slug;
    const block_uuid = (noteSlug as any).block_uuid;
    if (!slugGroups.has(slug)) {
      slugGroups.set(slug, []);
    }
    slugGroups.get(slug)!.push({ block_uuid, slug });
  }

  // Track which paths we expect to exist after sync
  const expectedPaths = new Set<string>();

  // Process each slug group
  for (const [slug, notes] of slugGroups) {
    const isDuplicate = notes.length > 1;

    for (const { block_uuid: noteUuid } of notes) {
      // Get the authoritative version of the note
      const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, noteUuid);
      if (!authoritativeVersion) {
        console.warn(`No authoritative version found for note ${noteUuid}`);
        continue;
      }

      // Get the note content
      const noteResult = await stream.query(
        `SELECT * FROM block WHERE version_uuid = $1`,
        [(authoritativeVersion as any).version_uuid]
      );

      if (!noteResult.rows || noteResult.rows.length === 0) {
        console.warn(`Note not found for version ${(authoritativeVersion as any).version_uuid}`);
        continue;
      }

      const note = noteResult.rows[0] as any;

      let filePath: string;
      if (isDuplicate) {
        // Duplicate slug — write to folder: {slug}/{uuid}.md
        const slugDir = path.join(slugsDir, slug);
        filePath = path.join(slugDir, `${noteUuid}.md`);
        if (!dryRun) {
          await fs.promises.mkdir(slugDir, { recursive: true });
        }
      } else {
        // Unique slug — write as flat file: {slug}.md
        filePath = path.join(slugsDir, `${slug}.md`);
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

  // Clean up files and directories that no longer correspond to any slug
  if (fs.existsSync(slugsDir)) {
    const entries = await fs.promises.readdir(slugsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const entryPath = path.join(slugsDir, entry.name);

      if (entry.isDirectory()) {
        // Check if this directory corresponds to a duplicate slug group
        const slug = entry.name;
        if (!slugGroups.has(slug) || slugGroups.get(slug)!.length <= 1) {
          // Directory no longer needed (slug is unique or gone)
          if (!dryRun) {
            await fs.promises.rm(entryPath, { recursive: true });
          }
        } else {
          // Clean up UUID files inside the directory that no longer belong
          const subFiles = await fs.promises.readdir(entryPath);
          for (const subFile of subFiles) {
            const subPath = path.join(entryPath, subFile);
            if (!expectedPaths.has(subPath)) {
              if (!dryRun) {
                await fs.promises.unlink(subPath);
              }
            }
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
      const currentNoteResult = await stream.query(
        `SELECT * FROM block WHERE version_uuid = $1`,
        [av.version_uuid]
      );

      if (currentNoteResult.rows && currentNoteResult.rows.length > 0) {
        const currentNote = currentNoteResult.rows[0] as any;

        if (currentNote.body !== content) {
          if (!dryRun) {
            await stream.exec(
              `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [blockUuid, 'scribe/markdown', uuidv4(), av.version_uuid, fileMtime, 'scribe-cli-sync', content]
            );
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
      await stream.exec(
        `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uuidv4(), 'scribe/markdown', uuidv4(), null, fileMtime, 'scribe-cli-sync', content]
      );
      console.log(`Created new note for file: ${fileLabel}`);
    } else {
      console.log(`Would create new note for file: ${fileLabel} (dry run)`);
    }
  }
}

/**
 * Sync local files from the sync directory to the database
 *
 * Reads both flat files ({slug}.md) and files inside slug folders ({slug}/{uuid}.md).
 *
 * @param stream The TributaryStream instance
 * @param localDb The TributaryLocal instance
 * @param slugsDir The sync directory path
 * @param options Sync options
 */
async function syncLocalFilesToDatabase(
  stream: TributaryStream,
  localDb: TributaryLocal,
  slugsDir: string,
  options: {
    dryRun?: boolean;
  }
): Promise<void> {
  const { dryRun = false } = options;

  if (!fs.existsSync(slugsDir)) {
    console.log('Sync directory does not exist, skipping local file sync');
    return;
  }

  const entries = await fs.promises.readdir(slugsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      // Slug folder — files inside are {uuid}.md
      const slugDir = path.join(slugsDir, entry.name);
      const subFiles = (await fs.promises.readdir(slugDir))
        .filter(f => f.endsWith('.md') && !f.startsWith('.'));

      for (const subFile of subFiles) {
        const filePath = path.join(slugDir, subFile);
        // Extract UUID from filename (remove .md extension)
        const fileUuid = subFile.slice(0, -3);
        await syncFileToDatabase(stream, localDb, filePath, fileUuid, `${entry.name}/${subFile}`, { dryRun });
      }
    } else if (entry.name.endsWith('.md')) {
      // Flat file — match by slug
      const filePath = path.join(slugsDir, entry.name);
      const fileSlug = entry.name.slice(0, -3);

      const existingNoteSlug = await getNoteBySlug(localDb, fileSlug);
      const blockUuid = existingNoteSlug ? (existingNoteSlug as any).block_uuid : null;

      await syncFileToDatabase(stream, localDb, filePath, blockUuid, entry.name, { dryRun });
    }
  }
}
