/**
 * KarmaBank API Server
 * 
 * REST API for KarmaBank lending pool - USDC Hackathon
 * 
 * Endpoints:
 * - POST /api/register - Register a new agent
 * - GET /api/credit/:name - Get credit status for an agent
 * - POST /api/borrow - Request a loan
 * - POST /api/repay - Repay a loan
 * - GET /api/pool - Get pool status
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

// Import route handlers
import { registerHandler } from './routes/register';
import { creditHandler } from './routes/credit';
import { borrowHandler } from './routes/borrow';
import { repayHandler } from './routes/repay';
import { poolHandler } from './routes/pool';

// Import services
import { creditLedger } from '../services/ledger';

/**
 * Error response interface
 */
interface ErrorResponse {
  success: false;
  error: string;
  message?: string;
}

/**
 * Health check response
 */
interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

/**
 * Create and configure Express application
 */
export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // Health check endpoint
  app.get('/health', (req: Request, res: Response<HealthResponse>) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // API routes
  app.post('/api/register', registerHandler);
  app.get('/api/credit/:name', creditHandler);
  app.post('/api/borrow', borrowHandler);
  app.post('/api/repay', repayHandler);
  app.get('/api/pool', poolHandler);

  // API info endpoint
  app.get('/api', (req: Request, res: Response) => {
    res.json({
      name: 'KarmaBank API',
      version: '1.0.0',
      description: 'REST API for KarmaBank lending pool - USDC Hackathon',
      endpoints: {
        'POST /api/register': {
          description: 'Register a new agent',
          body: {
            agentName: 'string (e.g., "@agent")',
            walletAddress: 'string (Ethereum address starting with 0x)',
          },
        },
        'GET /api/credit/:name': {
          description: 'Get credit status for an agent',
          params: {
            name: 'string (agent name)',
          },
        },
        'POST /api/borrow': {
          description: 'Request a loan',
          body: {
            agentName: 'string',
            amount: 'number (USDC amount)',
          },
        },
        'POST /api/repay': {
          description: 'Repay a loan',
          body: {
            agentName: 'string',
            amount: 'number (USDC amount)',
            txHash: 'string (optional - transaction hash)',
          },
        },
        'GET /api/pool': {
          description: 'Get pool status',
        },
      },
    });
  });

  // 404 handler
  app.use((req: Request, res: Response<ErrorResponse>) => {
    res.status(404).json({
      success: false,
      error: 'Not found',
      message: `Cannot ${req.method} ${req.path}`,
    });
  });

  // Error handler
  app.use((err: Error, req: Request, res: Response<ErrorResponse>, next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
}

/**
 * Start the API server
 */
export async function startServer(port: number = 3000): Promise<void> {
  const app = createApp();

  // Initialize storage
  creditLedger.initialize();

  const server = app.listen(port, () => {
    console.log(`🚀 KarmaBank API Server started on port ${port}`);
    console.log(`📍 API documentation: http://localhost:${port}/api`);
    console.log(`💚 Health check: http://localhost:${port}/health`);
    console.log('');
    console.log('Available endpoints:');
    console.log('  POST   /api/register');
    console.log('  GET    /api/credit/:name');
    console.log('  POST   /api/borrow');
    console.log('  POST   /api/repay');
    console.log('  GET    /api/pool');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
      console.log('✅ Server shut down gracefully');
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.log('❌ Forced shutdown');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Export app for testing
export default createApp;
