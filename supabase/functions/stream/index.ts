// Main function to handle all tributary API endpoints

import { Database } from '../shared/database.ts';
import { createRouteHandler } from '../shared/routes.ts';

// Initialize database
const db = new Database();

// Create the route handler with the database
const handler = createRouteHandler(db);

// Export the handler for Supabase Edge Functions
// Supabase Edge Functions automatically wrap this in their own server
export default handler;
