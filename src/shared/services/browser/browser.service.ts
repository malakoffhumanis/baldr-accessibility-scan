import puppeteer, { type Browser, type Page } from 'puppeteer';

import { createLogger } from '@shared/utils/logger.js';
import type { IAuditOptions } from '@shared/types/audit.types.js';
import type { IAuthConfigs } from '@shared/types/auth.types.js';
import { AuthService } from '@shared/services/auth/auth.service.js';
import type { IBrowserConfig } from '@shared/config/config.js';

const logger = createLogger('browser-service');

/**
 * Configuration required by BrowserService
 */
export interface IBrowserServiceConfig {
  browser: IBrowserConfig;
  env: 'development' | 'production' | 'test';
}

/**
 * Puppeteer browser management service
 */
export class BrowserService {
  private browser: Browser | null = null;
  private authService: AuthService;
  private authConfigs: IAuthConfigs = {};
  private activePagesCount = 0;
  private readonly browserConfig: IBrowserConfig;
  private readonly appEnv: string;
  private readonly allowInsecure: boolean;

  constructor(config?: IBrowserServiceConfig) {
    this.authService = new AuthService();
    this.browserConfig = config?.browser ?? { headless: true };
    this.appEnv = config?.env ?? 'development';
    this.allowInsecure = process.env['BALDR_ALLOW_INSECURE'] === 'true';
  }

  /**
   * Sets the authentication configurations
   */
  setAuthConfigs(authConfigs: IAuthConfigs): void {
    this.authConfigs = authConfigs;
    logger.info(
      { authTypes: Object.keys(authConfigs) },
      'Authentication configurations loaded',
    );
  }

  /**
   * Launches the Puppeteer browser
   */
  async launch(): Promise<Browser> {
    if (this.browser?.connected === true) {
      logger.info('Browser already launched, reusing');
      return this.browser;
    }

    // If the browser exists but is disconnected, clean it up
    if (this.browser) {
      logger.warn('Disconnected browser detected, cleaning up');
      try {
        await this.browser.close();
      } catch (error) {
        logger.error({ error }, 'Error closing disconnected browser');
      }
      this.browser = null;
    }

    // Proxy detection

    const proxyUrl = this.browserConfig.proxy?.url;

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ];

    if (this.allowInsecure) {
      if (this.appEnv === 'production') {
        logger.warn(
          'BALDR_ALLOW_INSECURE=true is IGNORED in production — web security and certificate checks remain enabled',
        );
      } else {
        logger.warn(
          'BALDR_ALLOW_INSECURE=true — disabling web security and certificate checks',
        );
        launchArgs.push(
          '--disable-web-security',
          '--ignore-certificate-errors',
        );
      }
    }

    if (proxyUrl != null && proxyUrl !== '') {
      logger.info({ proxyUrl }, 'Proxy detected');
      launchArgs.push(`--proxy-server=${proxyUrl}`);
    } else {
      logger.info('No proxy detected');
    }

    const headlessMode = this.browserConfig.headless;
    const executablePath = this.browserConfig.executablePath;

    logger.info(
      { executablePath: executablePath ?? 'bundled' },
      'Launching Puppeteer browser...',
    );

    this.browser = await puppeteer.launch({
      headless: headlessMode,
      ...(executablePath != null && executablePath !== ''
        ? { executablePath }
        : {}),
      args: launchArgs,
    });

    // Handle unexpected browser closure
    this.browser.on('disconnected', () => {
      logger.warn('Browser disconnected unexpectedly');
      this.browser = null;
      this.activePagesCount = 0;
    });

    logger.info(
      { headless: headlessMode, env: this.appEnv },
      'Browser launched successfully',
    );

    return this.browser;
  }

  /**
   * Creates a new page with the specified options
   * @param options - Audit options
   */
  async createPage(options: IAuditOptions): Promise<Page> {
    const browser = await this.launch();

    // Create a new page each time
    const page = await browser.newPage();
    this.activePagesCount++;

    logger.info(
      { activePagesCount: this.activePagesCount },
      'New page created',
    );

    // Viewport configuration
    const viewport = options.viewport ?? { width: 1920, height: 1080 };
    await page.setViewport(viewport);

    // Headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    // Timeouts
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(45000);

    // Auto-accept dialogs (beforeunload, alert, confirm, prompt)
    // Prevents blocking when navigating between audit URLs
    page.on('dialog', (dialog) => {
      logger.info(
        { type: dialog.type(), message: dialog.message() },
        'Dialog detected, accepting automatically',
      );
      void dialog.accept();
    });

    logger.info({ viewport }, 'Page configured');

    return page;
  }

  /**
   * Navigates to a URL with authentication handling
   * @param page - Puppeteer page
   * @param url - Target URL
   * @param options - Audit options (contains auth)
   */
  async navigateToUrl(
    page: Page,
    url: string,
    options?: IAuditOptions,
  ): Promise<void> {
    logger.info({ url }, 'Navigating to URL');

    // Handle authentication if specified
    if (
      options?.auth != null &&
      options.auth !== '' &&
      options.auth !== 'none'
    ) {
      const authConfig = this.authConfigs[options.auth];

      if (!authConfig) {
        throw new Error(`Auth configuration '${options.auth}' not found`);
      }

      const authenticated = await this.authService.authenticate(
        page,
        authConfig,
        url,
        options.auth,
      );

      if (!authenticated) {
        throw new Error(`Authentication '${options.auth}' failed`);
      }

      // Verify we're not still on a login page
      const currentUrl = page.url();
      const parsedUrl = new URL(currentUrl);
      const pathSegments = parsedUrl.pathname.toLowerCase().split('/');
      const isStillOnLoginPage =
        pathSegments.includes('login') ||
        pathSegments.includes('connexion') ||
        pathSegments.includes('signin') ||
        parsedUrl.pathname.toLowerCase().includes('/adfs/');
      if (isStillOnLoginPage) {
        throw new Error(
          `Still on authentication page after login: ${currentUrl}`,
        );
      }

      logger.info(
        { url: currentUrl },
        'Authentication successful, on target page',
      );
      return;
    }

    // Simple navigation without authentication
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      logger.info({ url }, 'Page loaded successfully');
    } catch (error) {
      logger.error({ url, error }, 'Navigation error');
      throw new Error(`Failed to load URL: ${url}`, { cause: error });
    }
  }

  /**
   * Waits for the page to be fully loaded
   * @param page - Puppeteer page
   */
  async waitForPageReady(page: Page): Promise<void> {
    logger.info('Waiting for page to fully load');

    try {
      await page.waitForFunction(() => document.readyState === 'complete', {
        timeout: 10000,
      });

      // Wait for spinners/loaders to disappear
      await page
        .waitForFunction(
          () => {
            const spinners = document.querySelectorAll(
              '[class*="spinner"], [class*="loader"], [class*="loading"]',
            );
            return Array.from(spinners).every(
              (el) => window.getComputedStyle(el).display === 'none',
            );
          },
          { timeout: 5000 },
        )
        .catch(() => {
          logger.warn('Timeout waiting for spinners to disappear');
        });

      logger.info('Page ready for analysis');
    } catch (error) {
      logger.warn({ error }, 'Page stability timeout, continuing');
    }
  }

  /**
   * Closes the page
   * @param page - Page to close
   */
  async closePage(page: Page): Promise<void> {
    if (!page.isClosed()) {
      try {
        await page.close();
        this.activePagesCount--;
        logger.info({ activePagesCount: this.activePagesCount }, 'Page closed');
      } catch (error) {
        logger.error({ error }, 'Error closing page');
      }
    }
  }

  /**
   * Closes the browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        this.activePagesCount = 0;
        this.authService.clearSessions();
        logger.info('Browser closed');
      } catch (error) {
        logger.error({ error }, 'Error closing browser');
        this.browser = null;
        this.activePagesCount = 0;
      }
    }
  }

  /**
   * Gets the browser status
   */
  getStatus(): {
    isRunning: boolean;
    activePagesCount: number;
    hasAuthConfigs: boolean;
  } {
    return {
      isRunning: Boolean(this.browser?.connected),
      activePagesCount: this.activePagesCount,
      hasAuthConfigs: Object.keys(this.authConfigs).length > 0,
    };
  }
}
