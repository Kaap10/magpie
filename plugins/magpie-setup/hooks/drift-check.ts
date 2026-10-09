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

export interface FsApi {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding?: string): string;
}

export interface LockfileData {
  method?: string;
  url?: string;
  min_version?: string;
  ref?: string;
  commit?: string;
  sha512?: string;
  source?: string;
  plugins?: string[];
  reconciled?: {
    version?: string;
    at?: string;
    skills?: Record<string, string>;
  };
}

export interface LocalLockfileData {
  source_method?: string;
  source_url?: string;
  source_ref?: string;
  fetched_commit?: string;
  fetched_at?: string;
}

export interface DriftCheckResult {
  isAdopted: boolean;
  hasDrift: boolean;
  lockVersion?: string;
  currentVersion?: string;
  message?: string;
}

export interface Pep440Version {
  epoch: number;
  release: number[];
  pre?: { type: string; num: number };
  post?: number;
  dev?: number;
}

/**
 * Zero-dependency path joiner to comply with strict sandbox module restrictions.
 */
export function joinPath(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p && typeof p === 'string'))
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .filter(Boolean)
    .join('/');
}

/**
 * Parse a PEP 440 version string.
 * Supports epochs (N!), release segments (N.N.N), pre-releases (a/b/rc),
 * post-releases (.postN), and dev-releases (.devN).
 */
export function parsePep440(v: string): Pep440Version | null {
  if (!v || typeof v !== 'string') return null;
  let s = v.trim().replace(/^v/i, '');
  if (!s) return null;

  let epoch = 0;
  const epochMatch = s.match(/^(\d+)!/);
  if (epochMatch) {
    epoch = parseInt(epochMatch[1], 10);
    s = s.slice(epochMatch[0].length);
  }

  // Look for .devN
  let dev: number | undefined = undefined;
  const devMatch = s.match(/[.-]?dev(\d+)?$/i);
  if (devMatch) {
    dev = devMatch[1] !== undefined ? parseInt(devMatch[1], 10) : 0;
    s = s.slice(0, devMatch.index);
  }

  // Look for .postN
  let post: number | undefined = undefined;
  const postMatch = s.match(/[.-]?(post|r|rev)(\d+)?$/i);
  if (postMatch) {
    post = postMatch[2] !== undefined ? parseInt(postMatch[2], 10) : 0;
    s = s.slice(0, postMatch.index);
  }

  // Look for pre-release (a|b|rc|alpha|beta|preview|c)
  let pre: { type: string; num: number } | undefined = undefined;
  const preMatch = s.match(/[.-]?(a|alpha|b|beta|rc|c|preview)(\d+)?$/i);
  if (preMatch) {
    let type = preMatch[1].toLowerCase();
    if (type === 'alpha') type = 'a';
    if (type === 'beta') type = 'b';
    if (type === 'c' || type === 'preview') type = 'rc';
    const num = preMatch[2] !== undefined ? parseInt(preMatch[2], 10) : 0;
    pre = { type, num };
    s = s.slice(0, preMatch.index);
  }

  const parts = s.split('.');
  const release: number[] = [];
  for (const part of parts) {
    if (!part || !/^\d+$/.test(part)) return null;
    release.push(parseInt(part, 10));
  }
  if (release.length === 0) return null;

  return { epoch, release, pre, post, dev };
}

/**
 * Compare two PEP 440 version strings.
 * Returns < 0 if a < b, 0 if a == b, > 0 if a > b.
 */
export function comparePep440(aStr: string, bStr: string): number {
  const a = parsePep440(aStr);
  const b = parsePep440(bStr);

  if (!a || !b) {
    return aStr.localeCompare(bStr);
  }

  if (a.epoch !== b.epoch) {
    return a.epoch - b.epoch;
  }

  const maxLen = Math.max(a.release.length, b.release.length);
  for (let i = 0; i < maxLen; i++) {
    const aVal = a.release[i] ?? 0;
    const bVal = b.release[i] ?? 0;
    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }

  const getPreRank = (v: Pep440Version) => {
    if (!v.pre) return 3;
    if (v.pre.type === 'a') return 0;
    if (v.pre.type === 'b') return 1;
    if (v.pre.type === 'rc') return 2;
    return -1;
  };

  const aPreRank = getPreRank(a);
  const bPreRank = getPreRank(b);

  if (aPreRank !== bPreRank) {
    return aPreRank - bPreRank;
  }

  if (a.pre && b.pre && a.pre.num !== b.pre.num) {
    return a.pre.num - b.pre.num;
  }

  const aPost = a.post ?? -1;
  const bPost = b.post ?? -1;
  if (aPost !== bPost) {
    return aPost - bPost;
  }

  const aDev = a.dev !== undefined ? a.dev : Infinity;
  const bDev = b.dev !== undefined ? b.dev : Infinity;
  if (aDev !== bDev) {
    return aDev - bDev;
  }

  return 0;
}

/**
 * Line-oriented scalar parser for `.apache-magpie.lock` mirroring setup_preflight/lockfile.py.
 */
export function parseLockfile(text: string): LockfileData {
  const lock: LockfileData = { plugins: [] };
  let section: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trimEnd();
    if (!line.trim()) continue;

    const indent = line.length - line.trimStart().length;
    const body = line.trim();

    if (indent === 0) {
      section = null;
      if (body.endsWith(':') && !body.slice(0, -1).includes(':')) {
        const key = body.slice(0, -1).trim();
        if (key === 'plugins') {
          section = 'plugins';
        } else if (key === 'reconciled') {
          section = 'reconciled';
          lock.reconciled = { skills: {} };
        } else {
          throw new Error(`unknown block: ${key}`);
        }
        continue;
      }
      if (!body.includes(':')) {
        throw new Error(`not a key: value line: ${raw}`);
      }
      const [key, ...rest] = body.split(':');
      const val = rest.join(':').trim();
      const trimmedKey = key.trim();
      if (['method', 'url', 'min_version', 'ref', 'commit', 'sha512', 'source'].includes(trimmedKey)) {
        (lock as any)[trimmedKey] = val;
      } else {
        throw new Error(`unknown key: ${trimmedKey}`);
      }
      continue;
    }

    if (section === 'plugins') {
      if (!body.startsWith('- ')) {
        throw new Error(`not a plugins entry: ${raw}`);
      }
      lock.plugins!.push(body.slice(2).trim());
      continue;
    }

    if (section === 'reconciled') {
      if (body === 'skills:') {
        section = 'reconciled.skills';
        continue;
      }
      const [key, ...rest] = body.split(':');
      const val = rest.join(':').trim();
      const trimmedKey = key.trim();
      if (trimmedKey === 'version' || trimmedKey === 'at') {
        (lock.reconciled as any)[trimmedKey] = val;
        continue;
      }
      throw new Error(`unknown reconciled key: ${trimmedKey}`);
    }

    if (section === 'reconciled.skills') {
      const [key, ...rest] = body.split(':');
      const val = rest.join(':').trim();
      if (!val) {
        throw new Error(`skill entry without a hash: ${raw}`);
      }
      lock.reconciled!.skills![key.trim()] = val;
      continue;
    }

    throw new Error(`indented line outside any block: ${raw}`);
  }

  return lock;
}

/**
 * Line-oriented scalar parser for `.apache-magpie.local.lock`.
 */
export function parseLocalLockfile(text: string): LocalLockfileData {
  const local: LocalLockfileData = {};
  const validKeys = new Set(['source_method', 'source_url', 'source_ref', 'fetched_commit', 'fetched_at']);

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trimEnd();
    if (!line.trim()) continue;

    if (line.startsWith(' ') || !line.includes(':')) {
      throw new Error(`not a key: value line: ${raw}`);
    }

    const [key, ...rest] = line.split(':');
    const trimmedKey = key.trim();
    const val = rest.join(':').trim();

    if (!validKeys.has(trimmedKey)) {
      throw new Error(`unknown key: ${trimmedKey}`);
    }

    (local as any)[trimmedKey] = val;
  }

  return local;
}

/**
 * Resolve the plugin version from available plugin manifests via the harness filesystem API.
 */
export function resolvePluginVersion(fsApi: FsApi, pluginDir?: string): string | undefined {
  if (!fsApi || typeof fsApi.existsSync !== 'function' || typeof fsApi.readFileSync !== 'function') {
    return undefined;
  }

  const candidates: string[] = [];

  if (pluginDir) {
    candidates.push(
      joinPath(pluginDir, '.claude-plugin', 'plugin.json'),
      joinPath(pluginDir, 'plugin.json'),
      joinPath(pluginDir, '..', '.claude-plugin', 'plugin.json'),
      joinPath(pluginDir, '..', 'plugin.json')
    );
  }

  for (const candidate of candidates) {
    try {
      if (fsApi.existsSync(candidate)) {
        const raw = fsApi.readFileSync(candidate, 'utf-8');
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
 * Core deterministic drift check between workspace lockfile and installed plugin/snapshot.
 */
export function checkSetupDrift(
  fsApi: FsApi,
  workspaceDir: string,
  pluginDir?: string
): DriftCheckResult {
  try {
    if (!fsApi || typeof fsApi.existsSync !== 'function' || typeof fsApi.readFileSync !== 'function') {
      return {
        isAdopted: false,
        hasDrift: false,
      };
    }

    const lockPath = joinPath(workspaceDir, '.apache-magpie.lock');

    if (!fsApi.existsSync(lockPath)) {
      return {
        isAdopted: false,
        hasDrift: false,
      };
    }

    const content = fsApi.readFileSync(lockPath, 'utf-8').trim();
    if (!content) {
      return {
        isAdopted: true,
        hasDrift: true,
        message:
          'Apache Magpie: Empty `.apache-magpie.lock` detected. Run `/magpie-setup upgrade` to populate.',
      };
    }

    let lockData: LockfileData;
    try {
      lockData = parseLockfile(content);
    } catch {
      return {
        isAdopted: true,
        hasDrift: true,
        message:
          'Apache Magpie: Malformed `.apache-magpie.lock` detected. Run `/magpie-setup upgrade` to repair.',
      };
    }

    const method = lockData.method;

    // 1. Method: marketplace (Adoption Floor semantics)
    if (method === 'marketplace') {
      const minVersion = lockData.min_version;
      if (!minVersion) {
        return {
          isAdopted: true,
          hasDrift: true,
          message:
            'Apache Magpie: Malformed `.apache-magpie.lock` (missing min_version). Run `/magpie-setup upgrade` to repair.',
        };
      }

      const currentVersion = resolvePluginVersion(fsApi, pluginDir);
      if (currentVersion) {
        // Floor semantics: drift only occurs when installed < min_version
        if (comparePep440(currentVersion, minVersion) < 0) {
          return {
            isAdopted: true,
            hasDrift: true,
            lockVersion: minVersion,
            currentVersion,
            message: `Apache Magpie: Installed plugin version (${currentVersion}) is below adoption floor (${minVersion}). Run \`/magpie-setup upgrade\` to reconcile.`,
          };
        }

        return {
          isAdopted: true,
          hasDrift: false,
          lockVersion: minVersion,
          currentVersion,
        };
      }

      return {
        isAdopted: true,
        hasDrift: false,
        lockVersion: minVersion,
      };
    }

    // 2. Snapshot methods (git-tag, git-branch, svn-zip)
    if (method === 'git-tag' || method === 'git-branch' || method === 'svn-zip') {
      const localLockPath = joinPath(workspaceDir, '.apache-magpie.local.lock');
      const committedPin = lockData.ref || lockData.commit;

      if (!fsApi.existsSync(localLockPath)) {
        return {
          isAdopted: true,
          hasDrift: true,
          lockVersion: committedPin,
          message:
            'Apache Magpie: Local snapshot lockfile missing (`.apache-magpie.local.lock`). Run `/magpie-setup upgrade` to fetch snapshot.',
        };
      }

      const localContent = fsApi.readFileSync(localLockPath, 'utf-8').trim();
      if (!localContent) {
        return {
          isAdopted: true,
          hasDrift: true,
          lockVersion: committedPin,
          message:
            'Apache Magpie: Empty `.apache-magpie.local.lock` detected. Run `/magpie-setup upgrade` to refresh.',
        };
      }

      let localData: LocalLockfileData;
      try {
        localData = parseLocalLockfile(localContent);
      } catch {
        return {
          isAdopted: true,
          hasDrift: true,
          lockVersion: committedPin,
          message:
            'Apache Magpie: Malformed `.apache-magpie.local.lock` detected. Run `/magpie-setup upgrade` to repair.',
        };
      }

      if (method === 'git-tag' || method === 'git-branch') {
        const refMismatch = Boolean(lockData.ref && localData.source_ref && lockData.ref !== localData.source_ref);
        const commitMismatch = Boolean(
          lockData.commit && localData.fetched_commit && lockData.commit !== localData.fetched_commit
        );

        if (refMismatch || commitMismatch) {
          const localPin = localData.source_ref || localData.fetched_commit;
          return {
            isAdopted: true,
            hasDrift: true,
            lockVersion: committedPin,
            message: `Apache Magpie: Snapshot drift detected (${localPin} -> ${committedPin}). Run \`/magpie-setup upgrade\` to reconcile snapshot and overrides.`,
          };
        }

        return {
          isAdopted: true,
          hasDrift: false,
          lockVersion: committedPin,
        };
      }

      if (method === 'svn-zip') {
        if (lockData.ref && localData.source_ref && lockData.ref !== localData.source_ref) {
          return {
            isAdopted: true,
            hasDrift: true,
            lockVersion: lockData.ref,
            message: `Apache Magpie: Snapshot drift detected (${localData.source_ref} -> ${lockData.ref}). Run \`/magpie-setup upgrade\` to reconcile snapshot and overrides.`,
          };
        }

        return {
          isAdopted: true,
          hasDrift: false,
          lockVersion: lockData.ref,
        };
      }
    }

    return {
      isAdopted: true,
      hasDrift: true,
      message:
        'Apache Magpie: Malformed `.apache-magpie.lock` (unknown or missing method). Run `/magpie-setup upgrade` to repair.',
    };
  } catch {
    return {
      isAdopted: false,
      hasDrift: false,
    };
  }
}

/**
 * Event hook registration entry point for Claude Code.
 */
export function register(on: any): void {
  let driftNotice: string | null = null;

  // 1. Hook session.start to check for lockfile drift
  on('session.start', async ($: any, e: any, next?: any) => {
    try {
      const fsApi: FsApi = $?.fs;

      const workspaceDir =
        (typeof $?.session?.root === 'function' ? $.session.root() : undefined) ||
        (typeof $?.session?.cwd === 'function' ? $.session.cwd() : undefined) ||
        $?.workspacePath ||
        $?.cwd ||
        '.';

      const pluginDir =
        $?.plugin?.root ||
        $?.pluginPath ||
        '..';

      if (fsApi) {
        const result = checkSetupDrift(fsApi, workspaceDir, pluginDir);

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
      }
    } catch {
      // Safe no-op on exception
    }

    if (typeof next === 'function') {
      return next(e);
    }
  });

  // 2. Hook ui.render to display AbovePrompt drift banner if detected
  on('ui.render', async ($: any, e: any, next?: any) => {
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
