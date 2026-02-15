#!/usr/bin/env node

/**
 * Simple script to list blocks in a Tributary Scribe collection
 * This is a standalone implementation that doesn't rely on the complex dependency tree
 */

import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

async function listBlocks(directory, options = {}) {
  const { dbPath, limit = 100, type } = options;
  
  // Use db/ directory within the checkout if dbPath is not explicitly provided
  let pglitePath;
  if (dbPath) {
    pglitePath = dbPath;
  } else {
    // Use db/ directory within the checkout directory
    pglitePath = path.join(directory, 'db');
  }
  
  // Check if database directory exists
  if (!fs.existsSync(pglitePath)) {
    console.error(`Database directory does not exist: ${pglitePath}`);
    process.exit(1);
  }
  
  try {
    // Create PGlite instance
    const pglite = new PGlite(pglitePath);
    
    // Connect to the database
    await pglite.exec('SELECT 1'); // Simple test connection
    
    // Check if block table exists
    const tableResult = await pglite.exec(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='block'
    `);
    
    if (tableResult.rows.length === 0) {
      console.log('No blocks found (block table does not exist).');
      return;
    }
    
    // Build query
    let query = `
      SELECT block_uuid, block_type, version_uuid, insert_datetime, inserter
      FROM block
    `;
    
    const params = [];
    
    // Add type filter if specified
    if (type) {
      query += ` WHERE block_type = $1`;
      params.push(type);
    }
    
    query += ` ORDER BY insert_datetime DESC LIMIT ${parseInt(limit) || 100}`;
    
    // Execute query
    const result = await pglite.exec(query, params);
    
    console.log('Blocks in stream:');
    console.log('=================');
    
    if (result.rows.length === 0) {
      console.log('No blocks found.');
      return;
    }
    
    // Display blocks in a formatted table
    console.log('Block UUID                            Type              Version UUID                          Inserted At                  Inserter');
    console.log('-----------------------------------------------------------------------------------------------------------------------------');
    
    for (const row of result.rows) {
      const blockUuid = (row.block_uuid || '').substring(0, 36);
      const blockType = (row.block_type || '').substring(0, 17).padEnd(17, ' ');
      const versionUuid = (row.version_uuid || '').substring(0, 36);
      const insertDatetime = (row.insert_datetime || '').substring(0, 30).padEnd(28, ' ');
      const inserter = (row.inserter || '').substring(0, 20).padEnd(20, ' ');
      
      console.log(`${blockUuid} ${blockType} ${versionUuid} ${insertDatetime} ${inserter}`);
    }
    
    console.log(`\nTotal blocks: ${result.rows.length}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const directory = args[0];

if (!directory) {
  console.error('Usage: list-blocks <directory> [--db <path>] [--limit <number>] [--type <type>]');
  process.exit(1);
}

// Parse options
const options = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--db' && args[i + 1]) {
    options.dbPath = args[i + 1];
    i++;
  } else if (args[i] === '--limit' && args[i + 1]) {
    options.limit = args[i + 1];
    i++;
  } else if (args[i] === '--type' && args[i + 1]) {
    options.type = args[i + 1];
    i++;
  }
}

listBlocks(directory, options);
