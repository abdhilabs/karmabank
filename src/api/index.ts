/**
 * KarmaBank API Entry Point
 * 
 * Starts the REST API server for KarmaBank lending pool
 */

import { startServer } from './server';

// Get port from environment or default to 3000
const PORT = parseInt(process.env.API_PORT || '3000', 10);

// Start the server
startServer(PORT).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
