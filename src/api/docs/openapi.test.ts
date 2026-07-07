import { describe, it, expect } from 'vitest';

import { openApiDocument } from './openapi.js';

describe('openApiDocument', () => {
  it('has correct openapi version', () => {
    expect(openApiDocument.openapi).toBe('3.0.3');
  });

  it('has info with title and version', () => {
    expect(openApiDocument.info.title).toContain('BALDR');
    expect(openApiDocument.info.version).toBe('1.0.0');
  });

  it('has paths defined', () => {
    expect(openApiDocument.paths).toBeDefined();
  });

  it('registers POST /api/v1/journey path', () => {
    expect(openApiDocument.paths['/api/v1/journey']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/journey']?.post).toBeDefined();
  });

  it('registers GET /api/v1/health path', () => {
    expect(openApiDocument.paths['/api/v1/health']).toBeDefined();
    expect(openApiDocument.paths['/api/v1/health']?.get).toBeDefined();
  });

  it('registers GET /api/v1/health/diagnostic path', () => {
    expect(openApiDocument.paths['/api/v1/health/diagnostic']).toBeDefined();
  });

  it('registers GET /metrics path', () => {
    expect(openApiDocument.paths['/metrics']).toBeDefined();
  });

  it('has servers configured', () => {
    expect(openApiDocument.servers).toBeDefined();
    expect(openApiDocument.servers!.length).toBeGreaterThan(0);
  });

  it('has tags defined', () => {
    expect(openApiDocument.tags).toBeDefined();
    expect(openApiDocument.tags!.length).toBeGreaterThan(0);
  });

  it('has component schemas', () => {
    expect(openApiDocument.components?.schemas).toBeDefined();
  });
});
