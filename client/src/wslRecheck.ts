import * as vscode from 'vscode';
import { getWslInfoAsync, invalidateWslCache, type WslInfo } from './wslBridge';

/**
 * Forget what Jasper knows about WSL, look again, and set the
 * `gemstone.wslAvailable` context the Databases view's "requires WSL2" welcome
 * reads. Installing or removing WSL happens outside VS Code, so this is how
 * either one reaches Jasper without a reload. Refresh Versions and the
 * Databases & Versions panel's Refresh both call it, so they cannot drift apart.
 */
export async function recheckWsl(): Promise<WslInfo> {
  invalidateWslCache();
  const info = await getWslInfoAsync();
  await vscode.commands.executeCommand('setContext', 'gemstone.wslAvailable', info.available);
  return info;
}
