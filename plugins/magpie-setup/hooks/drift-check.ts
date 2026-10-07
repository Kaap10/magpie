// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

/**
 * Apache Magpie — Setup Drift Check Mod (Claude Code).
 *
 * Hooks `session.start` to deterministically verify whether the current
 * workspace has drifted from the installed Magpie plugin version or gitignored
 * snapshot, without burning prompt tokens on every session turn.
 *
 * Implements Pilot 1 of RFC-AI-0004 Claude Code Mods (Issue #1497).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LockfileData {
  version?: string;
  ref?: string;
  snapshot_commit?: string;
  snapshot_hash?: string;
  [key: string]: unknown;
}

export interface DriftCheckResult {
  isAdopted: boolean;
  hasDrift: boolean;
  lockVersion?: string;
  currentVersion?: string;
  message?: string;
}

/**
 * Resolve the plugin version from available plugin manifests.
 */
export function resolvePluginVersion(pluginDir?: string): string | undefined {
  const candidates: string[] = [];

  if (pluginDir) {
    candidates.push(
      path.join(pluginDir, '.claude-plugin', 'plugin.json'),
      path.join(pluginDir, 'plugin.json'),
      path.join(pluginDir, '..', '.claude-plugin', 'plugin.json'),
      path.join(pluginDir, '..', 'plugin.json')
    );
  }

  // Check standard environment paths
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.PLUGIN_ROOT;
  if (pluginRoot) {
    candidates.push(
      path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
      path.join(pluginRoot, 'plugin.json')
    );
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.version === 'string' && parsed.version.trim()) {
          return parsed.version.trim();
        }
      }
    } catch {
      // Continue searching next candidate
    }
  }

  return undefined;
}

/**
 * Core deterministic drift check between workspace lockfile and installed plugin.
 */
export function checkSetupDrift(
  workspaceDir: string,
  pluginDir?: string
): DriftCheckResult {
  try {
    const lockPath = path.join(workspaceDir, '.apache-magpie.lock');

    // If no lockfile is present, this is not an adopted workspace
    if (!fs.existsSync(lockPath)) {
      return {
        isAdopted: false,
        hasDrift: false,
      };
    }

    const content = fs.readFileSync(lockPath, 'utf-8').trim();
    if (!content) {
      return {
        isAdopted: true,
        hasDrift: true,
        message:
          'Apache Magpie: Empty `.apache-magpie.lock` detected. Run `/magpie-setup upgrade` to populate.',
      };
    }

    let lockData: LockfileData = {};
    try {
      lockData = JSON.parse(content);
    } catch {
      // Malformed lockfile counts as drift needing reconciliation
      return {
        isAdopted: true,
        hasDrift: true,
        message:
          'Apache Magpie: Malformed `.apache-magpie.lock` detected. Run `/magpie-setup upgrade` to repair.',
      };
    }

    const currentVersion = resolvePluginVersion(pluginDir);
    const lockVersion = lockData.version || lockData.ref || undefined;

    // If both versions are known and differ, drift is detected
    if (currentVersion && lockVersion && currentVersion !== lockVersion) {
      return {
        isAdopted: true,
        hasDrift: true,
        lockVersion,
        currentVersion,
        message: `Apache Magpie: Snapshot drift detected (${lockVersion} -> ${currentVersion}). Run \`/magpie-setup upgrade\` to reconcile the snapshot and overrides.`,
      };
    }

    return {
      isAdopted: true,
      hasDrift: false,
      lockVersion,
      currentVersion,
    };
  } catch {
    // Fail closed/silently on unhandled errors to avoid crashing session start
    return {
      isAdopted: false,
      hasDrift: false,
    };
  }
}

/**
 * Event hook registration entry point for Claude Code.
 */
export function register(on: any, options?: any): void {
  if (typeof on !== 'function') {
    return;
  }

  let driftNotice: string | null = null;

  // 1. Hook session.start to check for lockfile drift
  on('session.start', async ($: any, e: any, next?: any) => {
    try {
      // Check session.cwd, session.root (worktree root), or process.cwd()
      const workspaceDir =
        (typeof $?.session?.root === 'function' ? $.session.root() : undefined) ||
        (typeof $?.session?.cwd === 'function' ? $.session.cwd() : undefined) ||
        $?.workspacePath ||
        $?.cwd ||
        process.cwd();

      const pluginDir =
        $?.plugin?.root ||
        $?.pluginPath ||
        process.env.CLAUDE_PLUGIN_ROOT ||
        path.resolve(__dirname, '..');

      const result = checkSetupDrift(workspaceDir, pluginDir);

      if (result.hasDrift && result.message) {
        driftNotice = result.message;

        if (typeof $?.ui?.invalidate === 'function') {
          $.ui.invalidate('ui.render');
        } else if (typeof $?.ui?.toast === 'function') {
          $.ui.toast(result.message, { level: 'info' });
        } else if (typeof $?.ui?.banner === 'function') {
          $.ui.banner(result.message);
        }
      }
    } catch {
      // Safe no-op on exception
    }

    if (typeof next === 'function') {
      return next(e);
    }
  });

  // 2. Hook ui.render to display AbovePrompt drift banner if detected
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next?: any) => {
    if (driftNotice && typeof $?.ui?.resolve === 'function') {
      try {
        const { Box, Text } = $.ui.resolve(e);
        if (Box && Text) {
          return next({
            ...e,
            view: Box({
              padding: 0,
              children: [
                Text({
                  text: `⚠ ${driftNotice}`,
                  color: 'yellow',
                  bold: true,
                }),
              ],
            }),
          });
        }
      } catch {
        // Fallback cleanly to next
      }
    }

    if (typeof next === 'function') {
      return next(e);
    }
  });
}

export default register;
