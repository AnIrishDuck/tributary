import { Kysely } from 'kysely';
import { Database } from '@tributary/scribe-data/dist/types.js';
import { 
  getAllBlockSlugs, 
  getBlocksByTag, 
  getAllTags,
  getAuthoritativeVersionByBlockUuid,
  getBlockBySlug,
  extractTitleFromMarkdown,
  titleToSlug,
  extractTagsFromMarkdown,
  generateUniqueSlug,
  indexSlugs
} from '@tributary/scribe-data/dist/indexing.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TributaryClient } from 'tributary-client';

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
  
  // Check that slugs/ directory exists
  const slugsDir = path.join(directory, 'slugs');
  if (!fs.existsSync(slugsDir)) {
    throw new Error(`Missing required directory: ${slugsDir}`);
  }
  
  // Check that indexed/ directory exists
  const indexedDir = path.join(directory, 'indexed');
  if (!fs.existsSync(indexedDir)) {
    throw new Error(`Missing required directory: ${indexedDir}`);
  }
  
  // Check that indexed/READ-ONLY.md file exists
  const readOnlyFile = path.join(indexedDir, 'READ-ONLY.md');
  if (!fs.existsSync(readOnlyFile)) {
    throw new Error(`Missing required file: ${readOnlyFile}`);
  }
  
  // Check that indexed/tags/ directory exists
  const tagsDir = path.join(indexedDir, 'tags');
  if (!fs.existsSync(tagsDir)) {
    throw new Error(`Missing required directory: ${tagsDir}`);
  }
  
  // Check that indexed/links/ directory exists
  const linksDir = path.join(indexedDir, 'links');
  if (!fs.existsSync(linksDir)) {
    throw new Error(`Missing required directory: ${linksDir}`);
  }
  
  // Check that db/ directory exists
  const dbDir = path.join(directory, 'db');
  if (!fs.existsSync(dbDir)) {
    throw new Error(`Missing required directory: ${dbDir}`);
  }
}

/**
 * Sync documents between local directory and Tributary Scribe collection
 * 
 * This function:
 * 1. Validates the local directory structure
 * 2. Syncs with the server to get latest remote changes
 * 3. Reads all markdown files from the slugs/ directory
 * 4. Updates the database with any changes
 * 5. Writes out indexed files (tags, links) to the indexed/ directory
 * 6. Ensures slug filenames match the computed slug names
 * 
 * @param db The Kysely database instance (wrapped with TributaryClient for block operations)
 * @param client The TributaryClient instance for explicit sync operations
 * @param directory The local directory to sync with
 * @param options Sync options
 */
export async function sync(
  db: Kysely<Database>,
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
    await client.sync();
    console.log('Server sync completed');
  }
  
  // 2. Read local files and update database
  await syncLocalFilesToDatabase(db, path.join(directory, 'slugs'), { dryRun });
  
  // 3. Re-index any newly added/updated blocks
  const reindexResult = await indexSlugs(db, { limit });
  console.log(`Re-indexed ${reindexResult.indexedCount} slugs`);
  if (reindexResult.hasMore) {
    console.log(`Has more to index: ${reindexResult.hasMore}`);
  }
  
  // 4. Update slugs directory with current database state
  await syncSlugsDirectory(db, path.join(directory, 'slugs'), { dryRun });

  // 5. Generate tag index files
  await syncTagIndexFiles(db, path.join(directory, 'indexed', 'tags'), { dryRun });

  // 6. Generate link target files
  await syncLinkTargetFiles(db, path.join(directory, 'indexed', 'links'), { dryRun });
  
  // 7. Update READ-ONLY warning file
  if (!dryRun) {
    const readOnlyPath = path.join(directory, 'indexed', 'READ-ONLY.md');
    const readOnlyContent = `# READ-ONLY

Files and directories in this directory are managed automatically by Scribe.
They will be overwritten or removed during sync operations.
Do not manually edit or add files here.
`;
    await fs.promises.writeFile(readOnlyPath, readOnlyContent);
  }
}

/**
 * Sync the slugs directory with the current database state
 * 
 * @param db The Kysely database instance
 * @param slugsDir The slugs directory path
 * @param options Sync options
 */
async function syncSlugsDirectory(
  db: Kysely<Database>,
  slugsDir: string,
  options: {
    dryRun?: boolean;
  }
): Promise<void> {
  const { dryRun = false } = options;
  
  // Get all current slugs from the database
  const blockSlugs = await getAllBlockSlugs(db);
  
  // Get all current files in the slugs directory
  const existingFiles = fs.existsSync(slugsDir) 
    ? (await fs.promises.readdir(slugsDir)).filter(file => file.endsWith('.md'))
    : [];
  
  // Map slugs to their corresponding block UUIDs
  const slugToBlockUuid = new Map<string, string>();
  for (const slug of blockSlugs) {
    slugToBlockUuid.set(slug.slug, slug.block_uuid);
  }
  
  // Create a map of slug -> file names for deduplication
  const slugToFileMap = new Map<string, string>();
  for (const file of existingFiles) {
    // Remove .md extension to get the slug
    const slug = file.slice(0, -3);
    slugToFileMap.set(slug, file);
  }
  
  // Process each block slug
  for (const blockSlug of blockSlugs) {
    const slug = blockSlug.slug;
    const blockUuid = blockSlug.block_uuid;
    
    // Get the authoritative version of the block
    const authoritativeVersion = await getAuthoritativeVersionByBlockUuid(db, blockUuid);
    if (!authoritativeVersion) {
      console.warn(`No authoritative version found for block ${blockUuid}`);
      continue;
    }
    
    // Get the block content
    const block = await db
      .selectFrom('block')
      .selectAll()
      .where('version_uuid', '=', authoritativeVersion.version_uuid)
      .executeTakeFirst();
    
    if (!block) {
      console.warn(`Block not found for version ${authoritativeVersion.version_uuid}`);
      continue;
    }
    
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
            block.body,
            'utf8'
          );
          
          // Update file timestamps to match block datetime
          const blockDate = new Date(block.insert_datetime);
          const time = blockDate.getTime() / 1000;
          await fs.promises.utimes(
            path.join(slugsDir, expectedFilename),
            blockDate,
            blockDate
          );
        }
      } else {
        // Rename the file to match the correct slug
        if (!dryRun) {
          const oldPath = path.join(slugsDir, existingFile);
          const newPath = path.join(slugsDir, expectedFilename);
          await fs.promises.rename(oldPath, newPath);
          await fs.promises.writeFile(newPath, block.body, 'utf8');
          
          // Update file timestamps
          const blockDate = new Date(block.insert_datetime);
          await fs.promises.utimes(newPath, blockDate, blockDate);
        }
      }
    } else {
      // Create new file for this slug
      if (!dryRun) {
        const filePath = path.join(slugsDir, expectedFilename);
        await fs.promises.writeFile(filePath, block.body, 'utf8');
        
        // Update file timestamps to match block datetime
        const blockDate = new Date(block.insert_datetime);
        await fs.promises.utimes(filePath, blockDate, blockDate);
      }
    }
  }
  
  // Remove files that no longer correspond to any slug
  const currentSlugs = new Set(blockSlugs.map(s => s.slug));
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
 * Generate tag index files in the tags directory
 * 
 * @param db The Kysely database instance
 * @param tagsDir The tags directory path
 * @param options Sync options
 */
async function syncTagIndexFiles(
  db: Kysely<Database>,
  tagsDir: string,
  options: {
    dryRun?: boolean;
  }
): Promise<void> {
  const { dryRun = false } = options;
  
  // Get all unique tags
  const tags = await getAllTags(db);
  
  // Process each tag
  for (const tag of tags) {
    // Get all blocks with this tag
    const blocksWithTag = await getBlocksByTag(db, tag.tag);
    
    // Get slugs for these blocks
    const slugs = [];
    for (const block of blocksWithTag) {
      const blockSlug = await db
        .selectFrom('block_slug')
        .select(['slug', 'title'])
        .where('block_uuid', '=', block.block_uuid)
        .executeTakeFirst();
      
      if (blockSlug) {
        slugs.push({
          slug: blockSlug.slug,
          title: blockSlug.title
        });
      }
    }
    
    // Generate markdown content for the tag index
    let content = `# Tag: ${tag.tag}

Documents tagged with \`#${tag.tag}\`:

`;
    
    for (const slug of slugs) {
      content += `- [${slug.title}](${slug.slug})\n`;
    }
    
    // Write the tag index file
    if (!dryRun) {
      const tagFile = path.join(tagsDir, `${tag.tag}.md`);
      await fs.promises.writeFile(tagFile, content, 'utf8');
    }
  }
  
  // Remove tag files that no longer correspond to any tag
  if (fs.existsSync(tagsDir)) {
    const existingTagFiles = (await fs.promises.readdir(tagsDir))
      .filter(file => file.endsWith('.md'));
    
    const currentTags = new Set(tags.map(t => `${t.tag}.md`));
    for (const file of existingTagFiles) {
      if (!currentTags.has(file)) {
        if (!dryRun) {
          await fs.promises.unlink(path.join(tagsDir, file));
        }
      }
    }
  }
}

/**
 * Generate link target files in the links directory for disambiguation
 * 
 * @param db The Kysely database instance
 * @param linksDir The links directory path
 * @param options Sync options
 */
async function syncLinkTargetFiles(
  db: Kysely<Database>,
  linksDir: string,
  options: {
    dryRun?: boolean;
  }
): Promise<void> {
  const { dryRun = false } = options;
  
  // Find slugs that have multiple blocks with the same name
  // Group slugs by their base name (without UUID prefix)
  const slugGroups = new Map<string, Array<{ slug: string; title: string; block_uuid: string }>>();
  
  const allSlugs = await getAllBlockSlugs(db);
  for (const blockSlug of allSlugs) {
    // Extract base name by removing UUID prefix if present
    let baseName = blockSlug.slug;
    if (baseName.includes('-')) {
      const parts = baseName.split('-');
      // If first part looks like a UUID fragment, remove it
      if (parts[0].length <= 8 && /^[0-9a-f]+$/.test(parts[0])) {
        baseName = parts.slice(1).join('-');
      }
    }
    
    if (!slugGroups.has(baseName)) {
      slugGroups.set(baseName, []);
    }
    slugGroups.get(baseName)!.push({
      slug: blockSlug.slug,
      title: blockSlug.title,
      block_uuid: blockSlug.block_uuid
    });
  }
  
  // Process groups with multiple entries
  for (const [baseName, slugs] of slugGroups.entries()) {
    if (slugs.length > 1) {
      // Generate disambiguation page
      let content = `# Multiple documents found for: ${baseName}

There are multiple documents with similar names. Please select the correct one:

`;
      
      for (const slug of slugs) {
        content += `- [${slug.title}](${slug.slug})\n`;
      }
      
      // Write the link target file
      if (!dryRun) {
        const linkFile = path.join(linksDir, `${baseName}.md`);
        await fs.promises.writeFile(linkFile, content, 'utf8');
      }
    }
  }
  
  // Remove link files that no longer correspond to ambiguous links
  if (fs.existsSync(linksDir)) {
    const existingLinkFiles = (await fs.promises.readdir(linksDir))
      .filter(file => file.endsWith('.md'));
    
    const currentAmbiguousLinks = new Set<string>();
    for (const [baseName, slugs] of slugGroups.entries()) {
      if (slugs.length > 1) {
        currentAmbiguousLinks.add(`${baseName}.md`);
      }
    }
    
    for (const file of existingLinkFiles) {
      if (!currentAmbiguousLinks.has(file)) {
        if (!dryRun) {
          await fs.promises.unlink(path.join(linksDir, file));
        }
      }
    }
  }
}

/**
 * Sync local files from the slugs directory to the database
 * 
 * This function reads markdown files from the slugs directory and:
 * 1. Creates new blocks for files that don't exist in the database
 * 2. Updates existing blocks when file content has changed
 * 3. Handles slug-based matching of files to blocks
 * 
 * @param db The Kysely database instance
 * @param slugsDir The slugs directory path
 * @param options Sync options
 */
async function syncLocalFilesToDatabase(
  db: Kysely<Database>,
  slugsDir: string,
  options: {
    dryRun?: boolean;
  }
): Promise<void> {
  const { dryRun = false } = options;
  
  // Check if slugs directory exists
  if (!fs.existsSync(slugsDir)) {
    console.log('Slugs directory does not exist, skipping local file sync');
    return;
  }
  
  // Get all markdown files in the slugs directory
  const files = (await fs.promises.readdir(slugsDir))
    .filter(file => file.endsWith('.md'));
  
  // Process each file
  for (const file of files) {
    const filePath = path.join(slugsDir, file);
    
    // Read file content
    const content = await fs.promises.readFile(filePath, 'utf8');
    
    // Extract title from content to determine slug
    const title = extractTitleFromMarkdown(content);
    const baseSlug = title ? titleToSlug(title) : null;
    
    // Extract the slug from the filename (without .md extension)
    const fileSlug = file.slice(0, -3);
    
    // Try to find an existing block that matches this slug
    const existingBlockSlug = await getBlockBySlug(db, fileSlug);
    
    if (existingBlockSlug) {
      // File corresponds to an existing block, check if content has changed
      const authoritativeVersion = await getAuthoritativeVersionByBlockUuid(db, existingBlockSlug.block_uuid);
      
      if (authoritativeVersion) {
        // Get the current version of the block
        const currentBlock = await db
          .selectFrom('block')
          .selectAll()
          .where('version_uuid', '=', authoritativeVersion.version_uuid)
          .executeTakeFirst();
        
        if (currentBlock && currentBlock.body !== content) {
          // Content has changed, create a new version
          if (!dryRun) {
            const now = new Date().toISOString();
            const newVersion = {
              block_uuid: existingBlockSlug.block_uuid,
              block_type: 'scribe/markdown',
              version_uuid: uuidv4(),
              prior_version_uuid: authoritativeVersion.version_uuid,
              insert_datetime: now,
              inserter: 'scribe-cli-sync',
              body: content
            };
            
            await db.insertInto('block').values(newVersion).execute();
            console.log(`Updated block ${existingBlockSlug.block_uuid} with new version`);
          } else {
            console.log(`Would update block ${existingBlockSlug.block_uuid} with new version (dry run)`);
          }
        }
      } else {
        // No authoritative version found, this shouldn't happen
        console.warn(`Found block slug without authoritative version: ${fileSlug}`);
      }
    } else {
      // File doesn't correspond to an existing block, create a new block
      if (!dryRun) {
        const now = new Date().toISOString();
        const newBlock = {
          block_uuid: uuidv4(),
          block_type: 'scribe/markdown',
          version_uuid: uuidv4(),
          prior_version_uuid: null,
          insert_datetime: now,
          inserter: 'scribe-cli-sync',
          body: content
        };
        
        await db.insertInto('block').values(newBlock).execute();
        console.log(`Created new block for file: ${file}`);
      } else {
        console.log(`Would create new block for file: ${file} (dry run)`);
      }
    }
  }
}
