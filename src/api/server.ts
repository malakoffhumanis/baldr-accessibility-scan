#!/usr/bin/env node

import 'dotenv/config';
import type { Socket } from 'node:net';

import { createLogger } from '@shared/utils/logger.js';
import { loadConfig } from '@shared/config/config.js';
import { setRuntimeMode } from '@shared/config/runtime-mode.js';
import { createApp } from './app.js';

// Server mode (the default) enforces the mandatory API_KEYS check in loadConfig.
setRuntimeMode('server');

const logger = createLogger('server');
const config = loadConfig();

const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Starts the HTTP server with proper graceful shutdown.
 */
const startServer = (): void => {
  const { app, journeyController } = createApp(config);

  const server = app.listen(config.port, () => {
    logger.info(
      {
        env: config.env,
        port: config.port,
        llmConfigured: Boolean(config.llmProvider),
        proxy: config.proxy?.url ?? 'none',
      },
      `Server started on port ${config.port.toString()} in ${config.env} mode`,
    );
  });

  // Cap request duration to prevent infinite hangs (e.g. Puppeteer loop)
  server.setTimeout(config.serverTimeoutMs);

  // Track active connections for drain on shutdown
  const connections = new Set<Socket>();
  server.on('connection', (conn: Socket) => {
    connections.add(conn);
    conn.on('close', () => {
      connections.delete(conn);
    });
  });

  const shutdownController = new AbortController();
  let shuttingDown = false;

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received: initiating graceful shutdown`);

    // Hard deadline: force exit after timeout
    const forceTimer = setTimeout(() => {
      logger.error('Forcing shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    // Signal in-flight work to abort
    shutdownController.abort();

    // Stop accepting new connections
    server.close();

    // Destroy idle keep-alive connections so server.close() can complete
    for (const conn of connections) {
      conn.end();
    }

    // Wait briefly for connections to drain, then force-destroy stragglers
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    for (const conn of connections) {
      conn.destroy();
    }

    // Cleanup browser (kills Chromium)
    try {
      await journeyController.cleanup();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err: unknown) {
      logger.error({ error: err }, 'Error during cleanup');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  // Export for testing
  (
    server as unknown as { shutdownController: AbortController }
  ).shutdownController = shutdownController;
};

startServer();
