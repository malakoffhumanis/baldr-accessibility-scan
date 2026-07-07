import { describe, it, expect } from 'vitest';

import {
  EMPTY_BUSINESS_SELECTORS,
  buildStableAttributes,
  appendClickableSelectors,
  loadBusinessSelectors,
  type BusinessSelectorsConfig,
} from './business-selectors.config.js';

const BASE_STABLE_ATTRIBUTES = [
  'data-testid',
  'data-cy',
  'data-test',
  'data-action',
  'data-target',
  'data-id',
  'data-key',
];

describe('business-selectors.config', () => {
  describe('EMPTY_BUSINESS_SELECTORS', () => {
    it('should expose all-empty arrays', () => {
      expect(EMPTY_BUSINESS_SELECTORS).toEqual({
        clickableSelectors: [],
        containerClasses: [],
        containerAttributes: [],
        stableAttributes: [],
        ajaxTriggerAttributes: [],
      });
    });
  });

  describe('loadBusinessSelectors', () => {
    it('should return empty lists for all fields when no env is provided', () => {
      const cfg = loadBusinessSelectors({});

      expect(cfg).toEqual({
        clickableSelectors: [],
        containerClasses: [],
        containerAttributes: [],
        stableAttributes: [],
        ajaxTriggerAttributes: [],
      });
    });

    it('should parse comma-separated BUSINESS_CLICKABLE_SELECTORS into a trimmed list', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CLICKABLE_SELECTORS: ' [data-x-code] , .clickable ',
      });

      expect(cfg.clickableSelectors).toEqual(['[data-x-code]', '.clickable']);
    });

    it('should parse comma-separated BUSINESS_CONTAINER_CLASSES into a trimmed list', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CONTAINER_CLASSES: 'menu-folder , submenu',
      });

      expect(cfg.containerClasses).toEqual(['menu-folder', 'submenu']);
    });

    it('should parse comma-separated BUSINESS_STABLE_ATTRIBUTES into a trimmed list', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_STABLE_ATTRIBUTES: 'data-x-id , data-x-key',
      });

      expect(cfg.stableAttributes).toEqual(['data-x-id', 'data-x-key']);
    });

    it('should parse comma-separated BUSINESS_AJAX_TRIGGER_ATTRIBUTES into a trimmed list', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_AJAX_TRIGGER_ATTRIBUTES: 'data-x-ajax , data-x-load',
      });

      expect(cfg.ajaxTriggerAttributes).toEqual(['data-x-ajax', 'data-x-load']);
    });

    it('should drop empty segments when parsing lists', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CLICKABLE_SELECTORS: 'a,,b,',
      });

      expect(cfg.clickableSelectors).toEqual(['a', 'b']);
    });

    it('should parse BUSINESS_CONTAINER_ATTRIBUTES into {name,value} objects', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CONTAINER_ATTRIBUTES: 'data-x-type=submenu, data-role=group',
      });

      expect(cfg.containerAttributes).toEqual([
        { name: 'data-x-type', value: 'submenu' },
        { name: 'data-role', value: 'group' },
      ]);
    });

    it('should trim whitespace around container attribute names and values', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CONTAINER_ATTRIBUTES: '  data-x-type  =  submenu  ',
      });

      expect(cfg.containerAttributes).toEqual([
        { name: 'data-x-type', value: 'submenu' },
      ]);
    });

    it('should drop container attribute entries without an "="', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CONTAINER_ATTRIBUTES: 'data-x-type=submenu, no-equals-here',
      });

      expect(cfg.containerAttributes).toEqual([
        { name: 'data-x-type', value: 'submenu' },
      ]);
    });

    it('should drop container attribute entries with an empty name', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CONTAINER_ATTRIBUTES: '=orphan, data-ok=value',
      });

      expect(cfg.containerAttributes).toEqual([
        { name: 'data-ok', value: 'value' },
      ]);
    });

    it('should keep everything after the first "=" in container attribute values', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CONTAINER_ATTRIBUTES: 'data-x=a=b=c',
      });

      expect(cfg.containerAttributes).toEqual([
        { name: 'data-x', value: 'a=b=c' },
      ]);
    });

    it('should produce an empty container-attributes list when none are valid', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CONTAINER_ATTRIBUTES: 'no-equals, =orphan, ,',
      });

      expect(cfg.containerAttributes).toEqual([]);
    });

    it('should parse all fields together from a fully populated env', () => {
      const cfg = loadBusinessSelectors({
        BUSINESS_CLICKABLE_SELECTORS: '[data-x-code]',
        BUSINESS_CONTAINER_CLASSES: 'menu-folder',
        BUSINESS_CONTAINER_ATTRIBUTES: 'data-x-type=submenu',
        BUSINESS_STABLE_ATTRIBUTES: 'data-x-id',
        BUSINESS_AJAX_TRIGGER_ATTRIBUTES: 'data-x-ajax',
      });

      expect(cfg).toEqual({
        clickableSelectors: ['[data-x-code]'],
        containerClasses: ['menu-folder'],
        containerAttributes: [{ name: 'data-x-type', value: 'submenu' }],
        stableAttributes: ['data-x-id'],
        ajaxTriggerAttributes: ['data-x-ajax'],
      });
    });
  });

  describe('buildStableAttributes', () => {
    it('should place business stable attributes before the universal base attributes', () => {
      const cfg: BusinessSelectorsConfig = {
        ...EMPTY_BUSINESS_SELECTORS,
        stableAttributes: ['data-x-id', 'data-x-key'],
      };

      expect(buildStableAttributes(cfg)).toEqual([
        'data-x-id',
        'data-x-key',
        ...BASE_STABLE_ATTRIBUTES,
      ]);
    });

    it('should return exactly the base attributes when no business ones are configured', () => {
      expect(buildStableAttributes(EMPTY_BUSINESS_SELECTORS)).toEqual(
        BASE_STABLE_ATTRIBUTES,
      );
    });
  });

  describe('appendClickableSelectors', () => {
    it('should return the base unchanged when clickableSelectors is empty', () => {
      const base = 'a, button';

      expect(appendClickableSelectors(base, EMPTY_BUSINESS_SELECTORS)).toBe(
        base,
      );
    });

    it('should append clickable selectors joined with ", " to the base', () => {
      const cfg: BusinessSelectorsConfig = {
        ...EMPTY_BUSINESS_SELECTORS,
        clickableSelectors: ['[data-x-code]', '.clickable'],
      };

      expect(appendClickableSelectors('a, button', cfg)).toBe(
        'a, button, [data-x-code], .clickable',
      );
    });
  });
});
