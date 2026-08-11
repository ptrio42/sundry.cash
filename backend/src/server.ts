/**
 * Express server for expense tracking API
 * Main entry point for the backend application
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import expenseRoutes from './routes/expenses';
import importRoutes from './routes/import';
import receiptRoutes from './routes/receipts';
import authRoutes from './routes/auth';
import budgetRoutes from './routes/budgets';
import categoryRoutes from './routes/categories';
import currencyRoutes from './routes/currencies';
import fxRoutes from './routes/fx';
import settingsRoutes from './routes/settings';
import insightsRoutes from './routes/insights';
import { requireAuth } from './middleware/auth';
import { closeDatabase } from './config/database';

// Initialize Express app
const app: Application = express();
const PORT = process.env.PORT || 5000;

// nginx is the only way in for a Docker/LAN install, so without this every
// client shares one apparent IP and the login rate limiter would throttle the
// whole network as a single caller. One hop = the bundled reverse proxy.
app.set('trust proxy', 1);

// Security headers. contentSecurityPolicy is off because this process only
// serves JSON and receipt images — the frontend (and its CSP) is nginx's job,
// and a default CSP here would apply to responses that never render as pages.
app.use(helmet({ contentSecurityPolicy: false }));

// Middleware
app.use(cors()); // Enable CORS for frontend
app.use(express.json({ limit: '1mb' })); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // Parse URL-encoded bodies

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API Routes (auth routes are public; expenses/import require a token when enabled)
app.use('/api/auth', authRoutes);
app.use('/api/expenses', requireAuth, expenseRoutes);
app.use('/api/import', requireAuth, importRoutes);
app.use('/api/receipts', requireAuth, receiptRoutes);
app.use('/api/budgets', requireAuth, budgetRoutes);
app.use('/api/categories', requireAuth, categoryRoutes);
app.use('/api/currencies', requireAuth, currencyRoutes);
app.use('/api/fx', requireAuth, fxRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/insights', requireAuth, insightsRoutes);

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'Sundry API',
    version: '1.0.0',
    endpoints: {
      expenses: '/api/expenses',
      import: '/api/import',
      health: '/api/health'
    }
  });
});

// 404 handler for unknown routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start the server only when run directly — not when imported by tests
// (importing `app` should not bind a port or register signal handlers).
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
    console.log(`📊 API available at http://localhost:${PORT}/api/expenses`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`${signal} signal received: closing HTTP server`);
    server.close(() => {
      console.log('HTTP server closed');
      closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
