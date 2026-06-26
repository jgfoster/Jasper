import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getTranscriptChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('GemStone Transcript');
  }
  return channel;
}

export function appendTranscript(text: string): void {
  if (!text) return;
  getTranscriptChannel().appendLine(text);
}

export function showTranscript(): void {
  getTranscriptChannel().show(true);
}

/**
 * Test-only: drop the cached channel so each test starts from a clean slate.
 * The channel is a module-level singleton created once per process; without
 * resetting it, a test that asserts createOutputChannel was called (after the
 * suite's vi.clearAllMocks() wipes the call record) only passes if it happens to
 * be the first test to touch the channel — an order dependency under
 * sequence.shuffle. Not used by production code.
 */
export function _resetTranscriptChannelForTests(): void {
  channel = undefined;
}
