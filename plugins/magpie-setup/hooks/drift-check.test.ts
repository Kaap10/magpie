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

import { describe, test } from 'claude-code/testing';
import {
  checkSetupDrift,
  resolvePluginVersion,
  parseLockfile,
  parseLocalLockfile,
  parsePep440,
  comparePep440,
  joinPath,
  register,
  type FsApi,
} from './drift-check.ts';

/**
 * In-memory Mock filesystem fulfilling FsApi without Node built-in imports.
 */
class MockFs implements FsApi {
  private files = new Map<string, string>();

  set(filePath: string, content: string): void {
    this.files.set(filePath.replace(/\\/g, '/'), content);
  }

  existsSync(filePath: string): boolean {
    return this.files.has(filePath.replace(/\\/g, '/'));
  }

  readFileSync(filePath: string, _encoding?: string): string {
    const val = this.files.get(filePath.replace(/\\/g, '/'));
    if (val === undefined) {
      throw new Error(`ENOENT: no such file: ${filePath}`);
    }
    return val;
  }
}

function assert(condition: any, message?: string): void {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertStrictEqual(actual: any, expected: any, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

function assertDeepStrictEqual(actual: any, expected: any): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected deep equality: ${JSON.stringify(expected)} !== ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn: () => void, pattern?: RegExp): void {
  let threw = false;
  try {
    fn();
  } catch (err: any) {
    threw = true;
    if (pattern && !pattern.test(err?.message || '')) {
      throw new Error(`Expected error matching ${pattern} but got: ${err?.message}`);
    }
  }
  if (!threw) {
    throw new Error('Expected function to throw an error');
  }
}

describe('drift-check mod (Pilot 1)', () => {
  const workspaceDir = '/test/workspace';
  const pluginDir = '/test/plugin';

  function createTestEnv(): MockFs {
    const fs = new MockFs();
    fs.set(
      joinPath(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'magpie-setup',
        version: '0.9.0',
      })
    );
    return fs;
  }

  describe('PEP 440 parsing and comparison', () => {
    test('correctly compares numeric release segments (0.10.0 > 0.9.0)', () => {
      assert(comparePep440('0.10.0', '0.9.0') > 0);
      assert(comparePep440('0.9.0', '0.10.0') < 0);
      assertStrictEqual(comparePep440('0.9.0', '0.9.0'), 0);
    });

    test('correctly orders development releases (0.2.0 > 0.2.0.dev202609110041)', () => {
      assert(comparePep440('0.2.0', '0.2.0.dev202609110041') > 0);
      assert(comparePep440('0.2.0.dev202609110041', '0.2.0') < 0);
      assert(comparePep440('0.9.0.dev202609262258', '0.2.0') > 0);
    });

    test('correctly orders pre-releases, final releases, and post-releases', () => {
      assert(comparePep440('1.0.0a1', '1.0.0b1') < 0);
      assert(comparePep440('1.0.0b1', '1.0.0rc1') < 0);
      assert(comparePep440('1.0.0rc1', '1.0.0') < 0);
      assert(comparePep440('1.0.0.post1', '1.0.0') > 0);
    });

    test('parses epochs and complex versions correctly', () => {
      assert(comparePep440('1!0.1.0', '0.9.0') > 0);
      assertStrictEqual(parsePep440('invalid-version'), null);
    });
  });

  describe('YAML scalar lockfile parsing', () => {
    test('parses standard marketplace YAML lockfile with comments and list', () => {
      const yaml = `# .apache-magpie.lock — committed; the project's floor.
method:       marketplace
url:          apache/magpie
min_version:  0.2.0

plugins:
  - magpie-setup
  - magpie-utilities
`;
      const lock = parseLockfile(yaml);
      assertStrictEqual(lock.method, 'marketplace');
      assertStrictEqual(lock.url, 'apache/magpie');
      assertStrictEqual(lock.min_version, '0.2.0');
      assertDeepStrictEqual(lock.plugins, ['magpie-setup', 'magpie-utilities']);
    });

    test('parses git-tag snapshot YAML lockfile', () => {
      const yaml = `method: git-tag
url:    https://github.com/apache/magpie.git
ref:    v1.0.0
commit: abc1234
`;
      const lock = parseLockfile(yaml);
      assertStrictEqual(lock.method, 'git-tag');
      assertStrictEqual(lock.ref, 'v1.0.0');
      assertStrictEqual(lock.commit, 'abc1234');
    });

    test('parses local fingerprint lockfile (.apache-magpie.local.lock)', () => {
      const yaml = `# .apache-magpie.local.lock
source_method:  git-tag
source_url:     https://github.com/apache/magpie.git
source_ref:     v1.0.0
fetched_commit: abc1234
fetched_at:     2026-10-07T00:00:00Z
`;
      const local = parseLocalLockfile(yaml);
      assertStrictEqual(local.source_method, 'git-tag');
      assertStrictEqual(local.source_ref, 'v1.0.0');
      assertStrictEqual(local.fetched_commit, 'abc1234');
    });

    test('throws on malformed YAML syntax', () => {
      assertThrows(() => parseLockfile('invalid line without colon'), /not a key: value line/);
      assertThrows(() => parseLockfile('unknown_key: value'), /unknown key/);
      assertThrows(() => parseLocalLockfile('unknown_local_key: value'), /unknown key/);
    });
  });

  describe('checkSetupDrift workflow verification', () => {
    test('returns not adopted when .apache-magpie.lock does not exist', () => {
      const fs = createTestEnv();
      const result = checkSetupDrift(fs, workspaceDir, pluginDir);
      assertStrictEqual(result.isAdopted, false);
      assertStrictEqual(result.hasDrift, false);
      assertStrictEqual(result.message, undefined);
    });

    test('detects drift when lockfile is completely empty', () => {
      const fs = createTestEnv();
      fs.set(joinPath(workspaceDir, '.apache-magpie.lock'), '');

      const result = checkSetupDrift(fs, workspaceDir, pluginDir);
      assertStrictEqual(result.isAdopted, true);
      assertStrictEqual(result.hasDrift, true);
      assert(result.message?.includes('Empty `.apache-magpie.lock`'));
    });

    test('detects drift when lockfile contains invalid / malformed YAML', () => {
      const fs = createTestEnv();
      fs.set(
        joinPath(workspaceDir, '.apache-magpie.lock'),
        'invalid yaml content {{{ no colons'
      );

      const result = checkSetupDrift(fs, workspaceDir, pluginDir);
      assertStrictEqual(result.isAdopted, true);
      assertStrictEqual(result.hasDrift, true);
      assert(result.message?.includes('Malformed `.apache-magpie.lock`'));
    });

    test('satisfies marketplace floor when installed version meets or exceeds min_version', () => {
      const fs = createTestEnv();
      const lockContent = `method:       marketplace
url:          apache/magpie
min_version:  0.2.0

plugins:
  - magpie-setup
`;
      fs.set(joinPath(workspaceDir, '.apache-magpie.lock'), lockContent);

      const result = checkSetupDrift(fs, workspaceDir, pluginDir);
      assertStrictEqual(result.isAdopted, true);
      assertStrictEqual(result.hasDrift, false);
      assertStrictEqual(result.lockVersion, '0.2.0');
      assertStrictEqual(result.currentVersion, '0.9.0');
      assertStrictEqual(result.message, undefined);
    });

    test('detects drift when installed plugin is below marketplace adoption floor', () => {
      const fs = createTestEnv();
      const lockContent = `method:       marketplace
url:          apache/magpie
min_version:  1.0.0

plugins:
  - magpie-setup
`;
      fs.set(joinPath(workspaceDir, '.apache-magpie.lock'), lockContent);

      const result = checkSetupDrift(fs, workspaceDir, pluginDir);
      assertStrictEqual(result.isAdopted, true);
      assertStrictEqual(result.hasDrift, true);
      assertStrictEqual(result.lockVersion, '1.0.0');
      assertStrictEqual(result.currentVersion, '0.9.0');
      assert(result.message?.includes('below adoption floor (1.0.0)'));
    });

    test('detects missing local snapshot lockfile for git-tag method', () => {
      const fs = createTestEnv();
      const lockContent = `method: git-tag
url:    https://github.com/apache/magpie.git
ref:    v1.0.0
`;
      fs.set(joinPath(workspaceDir, '.apache-magpie.lock'), lockContent);

      const result = checkSetupDrift(fs, workspaceDir, pluginDir);
      assertStrictEqual(result.isAdopted, true);
      assertStrictEqual(result.hasDrift, true);
      assert(result.message?.includes('Local snapshot lockfile missing'));
    });

    test('returns no drift when git-tag snapshot matches .apache-magpie.local.lock', () => {
      const fs = createTestEnv();
      const lockContent = `method: git-tag
url:    https://github.com/apache/magpie.git
ref:    v1.0.0
`;
      const localContent = `source_method:  git-tag
source_url:     https://github.com/apache/magpie.git
source_ref:     v1.0.0
`;
      fs.set(joinPath(workspaceDir, '.apache-magpie.lock'), lockContent);
      fs.set(joinPath(workspaceDir, '.apache-magpie.local.lock'), localContent);

      const result = checkSetupDrift(fs, workspaceDir, pluginDir);
      assertStrictEqual(result.isAdopted, true);
      assertStrictEqual(result.hasDrift, false);
      assertStrictEqual(result.lockVersion, 'v1.0.0');
      assertStrictEqual(result.message, undefined);
    });

    test('detects snapshot drift when .apache-magpie.local.lock ref differs from committed pin', () => {
      const fs = createTestEnv();
      const lockContent = `method: git-tag
url:    https://github.com/apache/magpie.git
ref:    v1.1.0
`;
      const localContent = `source_method:  git-tag
source_url:     https://github.com/apache/magpie.git
source_ref:     v1.0.0
`;
      fs.set(joinPath(workspaceDir, '.apache-magpie.lock'), lockContent);
      fs.set(joinPath(workspaceDir, '.apache-magpie.local.lock'), localContent);

      const result = checkSetupDrift(fs, workspaceDir, pluginDir);
      assertStrictEqual(result.isAdopted, true);
      assertStrictEqual(result.hasDrift, true);
      assert(result.message?.includes('Snapshot drift detected (v1.0.0 -> v1.1.0)'));
    });

    test('resolves plugin version correctly from candidate paths', () => {
      const fs = createTestEnv();
      const version = resolvePluginVersion(fs, pluginDir);
      assertStrictEqual(version, '0.9.0');
    });
  });

  describe('Claude Code hook registration and AbovePrompt UI', () => {
    test('registers session.start and ui.render hooks and renders Box/Text view on drift', async () => {
      const fs = createTestEnv();
      const lockContent = `method:       marketplace
url:          apache/magpie
min_version:  1.0.0

plugins:
  - magpie-setup
`;
      fs.set(joinPath(workspaceDir, '.apache-magpie.lock'), lockContent);

      const registeredHooks = new Map<string, Function>();
      const mockOn = (event: string, ...args: any[]) => {
        const handler = args[args.length - 1];
        registeredHooks.set(event, handler);
      };

      register(mockOn);

      assert(registeredHooks.has('session.start'));
      assert(registeredHooks.has('ui.render'));

      let uiInvalidated = false;
      const mock$ = {
        fs,
        session: {
          root: () => workspaceDir,
          cwd: () => workspaceDir,
        },
        plugin: {
          root: pluginDir,
        },
        ui: {
          invalidate: (target: string) => {
            if (target === 'ui.render') {
              uiInvalidated = true;
            }
          },
          resolve: () => ({
            Box: (props: any) => ({ type: 'Box', ...props }),
            Text: (props: any) => ({ type: 'Text', ...props }),
          }),
        },
      };

      // 1. Fire session.start
      const sessionStartHandler = registeredHooks.get('session.start')!;
      await sessionStartHandler(mock$);

      assertStrictEqual(uiInvalidated, true);

      // 2. Fire ui.render for AbovePrompt
      const uiRenderHandler = registeredHooks.get('ui.render')!;
      const renderedResult = await uiRenderHandler(mock$);

      assertStrictEqual(renderedResult?.type, 'Box');
      const textChild = renderedResult?.children?.[0];
      assertStrictEqual(textChild?.type, 'Text');
      assert(textChild?.text?.includes('below adoption floor (1.0.0)'));
      assert(textChild?.text?.includes('/magpie-setup upgrade'));
    });

    test('remains silent when session starts without drift (installed 0.9.0 >= floor 0.2.0)', async () => {
      const fs = createTestEnv();
      const lockContent = `method:       marketplace
url:          apache/magpie
min_version:  0.2.0

plugins:
  - magpie-setup
`;
      fs.set(joinPath(workspaceDir, '.apache-magpie.lock'), lockContent);

      const registeredHooks = new Map<string, Function>();
      register((event: string, ...args: any[]) => {
        registeredHooks.set(event, args[args.length - 1]);
      });

      let uiInvalidated = false;
      const mock$ = {
        fs,
        session: {
          root: () => workspaceDir,
          cwd: () => workspaceDir,
        },
        plugin: {
          root: pluginDir,
        },
        ui: {
          invalidate: () => {
            uiInvalidated = true;
          },
          resolve: () => ({
            Box: (props: any) => props,
            Text: (props: any) => props,
          }),
        },
      };

      const sessionStartHandler = registeredHooks.get('session.start')!;
      await sessionStartHandler(mock$);
      assertStrictEqual(uiInvalidated, false);

      const uiRenderHandler = registeredHooks.get('ui.render')!;
      const renderedResult = await uiRenderHandler(mock$);

      assertStrictEqual(renderedResult, undefined);
    });
  });
});
