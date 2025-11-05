// Main function to handle all tributary API endpoints

import { Database } from '../shared/database.ts';
import { createRouteHandler } from '../shared/routes.ts';

// Initialize database
const db = new Database();

// Create the route handler with the database
const handler = createRouteHandler(db);

Deno.serve(handler);
