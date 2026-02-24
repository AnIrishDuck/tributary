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
  
  // Get all current .md files in the slugs directory (skip dotfiles)
  const existingFiles = fs.existsSync(slugsDir)
    ? (await fs.promises.readdir(slugsDir)).filter(file => file.endsWith('.md') && !file.startsWith('.'))
    : [];
  
  // Create a map of slug -> file names for deduplication
  const slugToFileMap = new Map<string, string>();
  for (const file of existingFiles) {
    // Remove .md extension to get the slug
    const slug = file.slice(0, -3);
    slugToFileMap.set(slug, file);
  }
  
  // Process each note slug
  for (const noteSlug of noteSlugs) {
    const slug = (noteSlug as any).slug;
    const noteUuid = (noteSlug as any).block_uuid;
    
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
    
    // Determine the correct filename based on the slug
    const expectedFilename = `${slug}.md`;
    
    // Check if file with this slug already exists
    if (slugToFileMap.has(slug)) {
      const existingFile = slugToFileMap.get(slug)!;
      
      // If filename matches exactly, update its content and timestamp
      if (existingFile === expectedFilename) {
        if (!dryRun) {
          await fs.promises.writeFile(
            path.join(slugsDir, expectedFilename),
            note.body,
            'utf8'
          );
          
          // Update file timestamps to match note datetime
          const noteDate = new Date(note.insert_datetime);
          await fs.promises.utimes(
            path.join(slugsDir, expectedFilename),
            noteDate,
            noteDate
          );
        }
      } else {
        // Rename the file to match the correct slug
        if (!dryRun) {
          const oldPath = path.join(slugsDir, existingFile);
          const newPath = path.join(slugsDir, expectedFilename);
          await fs.promises.rename(oldPath, newPath);
          await fs.promises.writeFile(newPath, note.body, 'utf8');
          
          // Update file timestamps
          const noteDate = new Date(note.insert_datetime);
          await fs.promises.utimes(newPath, noteDate, noteDate);
        }
      }
    } else {
      // Create new file for this slug
      if (!dryRun) {
        const filePath = path.join(slugsDir, expectedFilename);
        await fs.promises.writeFile(filePath, note.body, 'utf8');
        
        // Update file timestamps to match note datetime
        const noteDate = new Date(note.insert_datetime);
        await fs.promises.utimes(filePath, noteDate, noteDate);
      }
    }
  }
  
  // Remove files that no longer correspond to any slug
  const currentSlugs = new Set(noteSlugs.map((s: any) => s.slug));
  for (const file of existingFiles) {
    const slug = file.slice(0, -3);
    if (!currentSlugs.has(slug)) {
      if (!dryRun) {
        await fs.promises.unlink(path.join(slugsDir, file));
      }
    }
  }
}

/**
 * Sync local files from the sync directory to the database
 *
 * This function reads markdown files from the sync directory and:
 * 1. Creates new notes for files that don't exist in the database
 * 2. Updates existing notes when file content has changed
 * 3. Handles slug-based matching of files to notes
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
  
  // Check if slugs directory exists
  if (!fs.existsSync(slugsDir)) {
    console.log('Sync directory does not exist, skipping local file sync');
    return;
  }

  // Get all markdown files in the sync directory (skip dotfiles)
  const files = (await fs.promises.readdir(slugsDir))
    .filter(file => file.endsWith('.md') && !file.startsWith('.'));
  
  // Process each file
  for (const file of files) {
    const filePath = path.join(slugsDir, file);
    
    // Read file content and get file stats for mtime
    const content = await fs.promises.readFile(filePath, 'utf8');
    const stats = await fs.promises.stat(filePath);
    const fileMtime = stats.mtime.toISOString();
    
    // Extract the slug from the filename (without .md extension)
    const fileSlug = file.slice(0, -3);
    
    // Try to find an existing note that matches this slug
    const existingNoteSlug = await getNoteBySlug(localDb, fileSlug);
    
    if (existingNoteSlug) {
      const ens = existingNoteSlug as any;
      // File corresponds to an existing note, check if content has changed
      const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, ens.block_uuid);
      
      if (authoritativeVersion) {
        const av = authoritativeVersion as any;
        // Get the current version of the note
        const currentNoteResult = await stream.query(
          `SELECT * FROM block WHERE version_uuid = $1`,
          [av.version_uuid]
        );
        
        if (currentNoteResult.rows && currentNoteResult.rows.length > 0) {
          const currentNote = currentNoteResult.rows[0] as any;
          
          if (currentNote.body !== content) {
            // Content has changed, create a new version using file's mtime
            if (!dryRun) {
              await stream.exec(
                `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  ens.block_uuid,
                  'scribe/markdown',
                  uuidv4(),
                  av.version_uuid,
                  fileMtime,
                  'scribe-cli-sync',
                  content
                ]
              );
              console.log(`Updated note ${ens.block_uuid} with new version`);
            } else {
              console.log(`Would update note ${ens.block_uuid} with new version (dry run)`);
            }
          }
        }
      } else {
        // No authoritative version found, this shouldn't happen
        console.warn(`Found note slug without authoritative version: ${fileSlug}`);
      }
    } else {
      // File doesn't correspond to an existing note, create a new note using file's mtime
      if (!dryRun) {
        await stream.exec(
          `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            uuidv4(),
            'scribe/markdown',
            uuidv4(),
            null,
            fileMtime,
            'scribe-cli-sync',
            content
          ]
        );
        console.log(`Created new note for file: ${file}`);
      } else {
        console.log(`Would create new note for file: ${file} (dry run)`);
      }
    }
  }
}
