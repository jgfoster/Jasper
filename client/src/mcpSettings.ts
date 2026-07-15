// Reads MCP-related settings during/after the `gemstone.mcp.*` → `jasper.mcp.*`
// rename. VS Code cannot migrate a user's settings.json across a config-key
// rename, so we bridge at read time: prefer the new `jasper.mcp.<key>` value,
// but fall back to an explicitly-set legacy `gemstone.mcp.<key>` value so users
// who configured these before the rename don't silently lose them.
import * as vscode from 'vscode';

const NEW_SECTION = 'jasper';
const OLD_SECTION = 'gemstone';

interface InspectResult<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

interface ConfigLike {
  get<T>(section: string, defaultValue: T): T;
  inspect<T>(section: string): InspectResult<T> | undefined;
}

export type GetConfiguration = (section: string) => ConfigLike;

const defaultGetConfiguration: GetConfiguration = (section) =>
  vscode.workspace.getConfiguration(section) as unknown as ConfigLike;

/** True when the user set this key at any scope (not merely the contributed default). */
function isExplicitlySet<T>(config: ConfigLike, key: string): boolean {
  const i = config.inspect<T>(key);
  return (
    !!i &&
    (i.globalValue !== undefined ||
      i.workspaceValue !== undefined ||
      i.workspaceFolderValue !== undefined)
  );
}

/**
 * Read `jasper.mcp.<key>`, falling back to an explicitly-set legacy
 * `gemstone.mcp.<key>` when the new key has not been set. `getConfiguration` is
 * injectable for tests.
 */
export function readMcpSetting<T>(
  key: string,
  defaultValue: T,
  getConfiguration: GetConfiguration = defaultGetConfiguration,
): T {
  const dotted = `mcp.${key}`;
  const newCfg = getConfiguration(NEW_SECTION);
  if (isExplicitlySet(newCfg, dotted)) {
    return newCfg.get<T>(dotted, defaultValue);
  }
  const oldCfg = getConfiguration(OLD_SECTION);
  if (isExplicitlySet(oldCfg, dotted)) {
    return oldCfg.get<T>(dotted, defaultValue);
  }
  return defaultValue;
}
