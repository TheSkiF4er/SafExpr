/**
 * SafExpr – Plugin index
 *
 * Central export for all built-in SafExpr plugins.
 *
 * This module:
 *  - Re-exports individual plugins (collections, datetime).
 *  - Defines a small “plugin” type for composition.
 *  - Provides a helper to apply multiple plugins in one call.
 *
 * Typical usage:
 *
 *   import { createEngine } from '../core/engine';
 *   import {
 *     collectionsPlugin,
 *     datetimePlugin,
 *     applyPlugins,
 *   } from '../plugins';
 *
 *   const engine = applyPlugins(
 *     createEngine(),
 *     collectionsPlugin,
 *     (eng) => datetimePlugin(eng, { prefix: 'dt_' }),
 *   );
 *
 *   const expr = engine.compile<{ nums: number[] }, number>(
 *     'sum(nums) / count(nums)',
 *   );
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import type { Engine } from '../core/engine';

/////////////////////////////
// Individual plugin exports
/////////////////////////////

export { collectionsPlugin } from './collections';
export type { CollectionsPluginOptions } from './collections';

export { datetimePlugin } from './datetime';
export type { DatetimePluginOptions, TimeZoneMode } from './datetime';

/////////////////////////////
// Plugin composition types
/////////////////////////////

/**
 * A generic SafExpr “plugin” – a function that takes an Engine and returns
 * a new Engine (usually with extra helper functions registered).
 *
 * Example:
 *
 *   const mathPlugin: Plugin = (engine) =>
 *     engine.withFunction('square', (x: number) => x * x);
 */
export type Plugin = (engine: Engine) => Engine;

/**
 * A plugin that accepts extra configuration.
 *
 * Example:
 *
 *   const prefixedCollections: ConfigurablePlugin<{ prefix?: string }> =
 *     (options) => (engine) => collectionsPlugin(engine, options);
 */
export type ConfigurablePlugin<Options = unknown> = (
  options: Options,
) => Plugin;

/////////////////////////////
// Helper: applyPlugins    //
/////////////////////////////

/**
 * Apply one or more plugins to an Engine in sequence.
 *
 * This is a small convenience for composition:
 *
 *   const engine = applyPlugins(
 *     createEngine({ maxEvalOperations: 1000 }),
 *     collectionsPlugin,
 *     (e) => datetimePlugin(e, { prefix: 'dt_' }),
 *   );
 *
 * The plugins are applied left-to-right:
 *   engine' = pN(...(p2(p1(engine)))).
 */
export function applyPlugins(engine: Engine, ...plugins: Plugin[]): Engine {
  return plugins.reduce((eng, plugin) => plugin(eng), engine);
}

/////////////////////////////
// Helper: createPluginSet //
/////////////////////////////

/**
 * Utility for defining named plugin sets in your application.
 *
 * Example:
 *
 *   // plugins/rules.ts
 *   import {
 *     collectionsPlugin,
 *     datetimePlugin,
 *     createPluginSet,
 *   } from 'safexpr/src/plugins';
 *
 *   export const rulesPlugins = createPluginSet(
 *     'rules',
 *     collectionsPlugin,
 *     (engine) => datetimePlugin(engine, { prefix: 'dt_' }),
 *   );
 *
 *   // usage:
 *   const engine = rulesPlugins.attach(createEngine());
 */
export interface PluginSet {
  /**
   * Human-readable name for debugging / logging.
   */
  readonly name: string;

  /**
   * The plugins that belong to this set.
   */
  readonly plugins: readonly Plugin[];

  /**
   * Apply all plugins in this set to the given engine.
   *
   * Equivalent to:
   *   applyPlugins(engine, ...plugins)
   */
  attach(engine: Engine): Engine;
}

/**
 * Create a named plugin set for easier reuse.
 */
export function createPluginSet(
  name: string,
  ...plugins: Plugin[]
): PluginSet {
  const frozenPlugins = [...plugins] as const;

  return {
    name,
    plugins: frozenPlugins,
    attach(engine: Engine): Engine {
      return applyPlugins(engine, ...frozenPlugins);
    },
  };
}
