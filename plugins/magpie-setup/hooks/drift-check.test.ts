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

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  checkSetupDrift,
  resolvePluginVersion,
  parseLockfile,
  parseLocalLockfile,
  parsePep440,
  comparePep440,
  register,
} from './drift-check.ts';

describe('drift-check mod (Pilot 1)', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let pluginDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-mod-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    pluginDir = path.join(tmpDir, 'plugin');

    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });

    // Mock plugin manifest with version 0.9.0
    fs.writeFileSync(
      path.join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'magpie-setup',
        version: '0.9.0',
      })
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('PEP 440 parsing and comparison', () => {
    it('correctly compares numeric release segments (0.10.0 > 0.9.0)', () => {
      assert.ok(comparePep440('0.10.0', '0.9.0') > 0);
      assert.ok(comparePep440('0.9.0', '0.10.0') < 0);
      assert.strictEqual(comparePep440('0.9.0', '0.9.0'), 0);
    });

    it('correctly orders development releases (0.2.0 > 0.2.0.dev202609110041)', () => {
      assert.ok(comparePep440('0.2.0', '0.2.0.dev202609110041') > 0);
      assert.ok(comparePep440('0.2.0.dev202609110041', '0.2.0') < 0);
      assert.ok(comparePep440('0.9.0.dev202609262258', '0.2.0') > 0);
    });

    it('correctly orders pre-releases, final releases, and post-releases', () => {
      assert.ok(comparePep440('1.0.0a1', '1.0.0b1') < 0);
      assert.ok(comparePep440('1.0.0b1', '1.0.0rc1') < 0);
      assert.ok(comparePep440('1.0.0rc1', '1.0.0') < 0);
      assert.ok(comparePep440('1.0.0.post1', '1.0.0') > 0);
    });

    it('parses epochs and complex versions correctly', () => {
      assert.ok(comparePep440('1!0.1.0', '0.9.0') > 0);
      assert.strictEqual(parsePep440('invalid-version'), null);
    });
  });

  describe('YAML scalar lockfile parsing', () => {
    it('parses standard marketplace YAML lockfile with comments and list', () => {
      const yaml = `# .apache-magpie.lock — committed; the project's floor.
method:       marketplace
url:          apache/magpie
min_version:  0.2.0

plugins:
  - magpie-setup
  - magpie-utilities
`;
      const lock = parseLockfile(yaml);
      assert.strictEqual(lock.method, 'marketplace');
      assert.strictEqual(lock.url, 'apache/magpie');
      assert.strictEqual(lock.min_version, '0.2.0');
      assert.deepStrictEqual(lock.plugins, ['magpie-setup', 'magpie-utilities']);
    });

    it('parses git-tag snapshot YAML lockfile', () => {
      const yaml = `method: git-tag
url:    https://github.com/apache/magpie.git
ref:    v1.0.0
commit: abc1234
`;
      const lock = parseLockfile(yaml);
      assert.strictEqual(lock.method, 'git-tag');
      assert.strictEqual(lock.ref, 'v1.0.0');
      assert.strictEqual(lock.commit, 'abc1234');
    });

    it('parses local fingerprint lockfile (.apache-magpie.local.lock)', () => {
      const yaml = `# .apache-magpie.local.lock
source_method:  git-tag
source_url:     https://github.com/apache/magpie.git
source_ref:     v1.0.0
fetched_commit: abc1234
fetched_at:     2026-10-07T00:00:00Z
`;
      const local = parseLocalLockfile(yaml);
      assert.strictEqual(local.source_method, 'git-tag');
      assert.strictEqual(local.source_ref, 'v1.0.0');
      assert.strictEqual(local.fetched_commit, 'abc1234');
    });

    it('throws on malformed YAML syntax', () => {
      assert.throws(() => parseLockfile('invalid line without colon'), /not a key: value line/);
      assert.throws(() => parseLockfile('unknown_key: value'), /unknown key/);
      assert.throws(() => parseLocalLockfile('unknown_local_key: value'), /unknown key/);
    });
  });

  describe('checkSetupDrift workflow verification', () => {
    it('returns not adopted when .apache-magpie.lock does not exist', () => {
      const result = checkSetupDrift(workspaceDir, pluginDir);
      assert.strictEqual(result.isAdopted, false);
      assert.strictEqual(result.hasDrift, false);
      assert.strictEqual(result.message, undefined);
    });

    it('detects drift when lockfile is completely empty', () => {
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.lock'), '');

      const result = checkSetupDrift(workspaceDir, pluginDir);
      assert.strictEqual(result.isAdopted, true);
      assert.strictEqual(result.hasDrift, true);
      assert.ok(result.message?.includes('Empty `.apache-magpie.lock`'));
    });

    it('detects drift when lockfile contains invalid / malformed YAML', () => {
      fs.writeFileSync(
        path.join(workspaceDir, '.apache-magpie.lock'),
        'invalid yaml content {{{ no colons'
      );

      const result = checkSetupDrift(workspaceDir, pluginDir);
      assert.strictEqual(result.isAdopted, true);
      assert.strictEqual(result.hasDrift, true);
      assert.ok(result.message?.includes('Malformed `.apache-magpie.lock`'));
    });

    it('satisfies marketplace floor when installed version meets or exceeds min_version', () => {
      // Lock floor: 0.2.0, Installed: 0.9.0
      const lockContent = `method:       marketplace
url:          apache/magpie
min_version:  0.2.0

plugins:
  - magpie-setup
`;
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.lock'), lockContent);

      const result = checkSetupDrift(workspaceDir, pluginDir);
      assert.strictEqual(result.isAdopted, true);
      assert.strictEqual(result.hasDrift, false);
      assert.strictEqual(result.lockVersion, '0.2.0');
      assert.strictEqual(result.currentVersion, '0.9.0');
      assert.strictEqual(result.message, undefined);
    });

    it('detects drift when installed plugin is below marketplace adoption floor', () => {
      // Lock floor: 1.0.0, Installed: 0.9.0
      const lockContent = `method:       marketplace
url:          apache/magpie
min_version:  1.0.0

plugins:
  - magpie-setup
`;
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.lock'), lockContent);

      const result = checkSetupDrift(workspaceDir, pluginDir);
      assert.strictEqual(result.isAdopted, true);
      assert.strictEqual(result.hasDrift, true);
      assert.strictEqual(result.lockVersion, '1.0.0');
      assert.strictEqual(result.currentVersion, '0.9.0');
      assert.ok(result.message?.includes('below adoption floor (1.0.0)'));
    });

    it('detects missing local snapshot lockfile for git-tag method', () => {
      const lockContent = `method: git-tag
url:    https://github.com/apache/magpie.git
ref:    v1.0.0
`;
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.lock'), lockContent);

      const result = checkSetupDrift(workspaceDir, pluginDir);
      assert.strictEqual(result.isAdopted, true);
      assert.strictEqual(result.hasDrift, true);
      assert.ok(result.message?.includes('Local snapshot lockfile missing'));
    });

    it('returns no drift when git-tag snapshot matches .apache-magpie.local.lock', () => {
      const lockContent = `method: git-tag
url:    https://github.com/apache/magpie.git
ref:    v1.0.0
`;
      const localContent = `source_method:  git-tag
source_url:     https://github.com/apache/magpie.git
source_ref:     v1.0.0
`;
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.lock'), lockContent);
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.local.lock'), localContent);

      const result = checkSetupDrift(workspaceDir, pluginDir);
      assert.strictEqual(result.isAdopted, true);
      assert.strictEqual(result.hasDrift, false);
      assert.strictEqual(result.lockVersion, 'v1.0.0');
      assert.strictEqual(result.message, undefined);
    });

    it('detects snapshot drift when .apache-magpie.local.lock ref differs from committed pin', () => {
      const lockContent = `method: git-tag
url:    https://github.com/apache/magpie.git
ref:    v1.1.0
`;
      const localContent = `source_method:  git-tag
source_url:     https://github.com/apache/magpie.git
source_ref:     v1.0.0
`;
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.lock'), lockContent);
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.local.lock'), localContent);

      const result = checkSetupDrift(workspaceDir, pluginDir);
      assert.strictEqual(result.isAdopted, true);
      assert.strictEqual(result.hasDrift, true);
      assert.ok(result.message?.includes('Snapshot drift detected (v1.0.0 -> v1.1.0)'));
    });

    it('resolves plugin version correctly from candidate paths', () => {
      const version = resolvePluginVersion(pluginDir);
      assert.strictEqual(version, '0.9.0');
    });
  });

  describe('Claude Code hook registration and AbovePrompt UI', () => {
    it('registers session.start and ui.render hooks and renders Box/Text view on drift', async () => {
      // Marketplace floor 1.0.0 vs installed 0.9.0 triggers drift
      const lockContent = `method:       marketplace
url:          apache/magpie
min_version:  1.0.0

plugins:
  - magpie-setup
`;
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.lock'), lockContent);

      const registeredHooks = new Map<string, Function>();
      const mockOn = (event: string, ...args: any[]) => {
        const handler = args[args.length - 1];
        registeredHooks.set(event, handler);
      };

      register(mockOn);

      assert.ok(registeredHooks.has('session.start'));
      assert.ok(registeredHooks.has('ui.render'));

      let nextCalled = false;
      const mockNext = async (e: any) => {
        nextCalled = true;
        return e;
      };

      let uiInvalidated = false;
      const mock$ = {
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
          resolve: (_e: any) => ({
            Box: (props: any) => ({ type: 'Box', ...props }),
            Text: (props: any) => ({ type: 'Text', ...props }),
          }),
        },
      };

      // 1. Fire session.start
      const sessionStartHandler = registeredHooks.get('session.start')!;
      await sessionStartHandler(mock$, {}, mockNext);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(uiInvalidated, true);

      // 2. Fire ui.render for AbovePrompt
      let renderedResult: any = null;
      const mockRenderNext = async (e: any) => {
        renderedResult = e;
        return e;
      };

      const uiRenderHandler = registeredHooks.get('ui.render')!;
      await uiRenderHandler(mock$, {}, mockRenderNext);

      assert.strictEqual(renderedResult?.view?.type, 'Box');
      const textChild = renderedResult?.view?.children?.[0];
      assert.strictEqual(textChild?.type, 'Text');
      assert.ok(textChild?.text?.includes('below adoption floor (1.0.0)'));
      assert.ok(textChild?.text?.includes('/magpie-setup upgrade'));
    });

    it('remains silent when session starts without drift (installed 0.9.0 >= floor 0.2.0)', async () => {
      const lockContent = `method:       marketplace
url:          apache/magpie
min_version:  0.2.0

plugins:
  - magpie-setup
`;
      fs.writeFileSync(path.join(workspaceDir, '.apache-magpie.lock'), lockContent);

      const registeredHooks = new Map<string, Function>();
      register((event: string, ...args: any[]) => {
        registeredHooks.set(event, args[args.length - 1]);
      });

      let uiInvalidated = false;
      const mock$ = {
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
      await sessionStartHandler(mock$, {}, (e: any) => e);
      assert.strictEqual(uiInvalidated, false);

      let renderedResult: any = null;
      const uiRenderHandler = registeredHooks.get('ui.render')!;
      await uiRenderHandler(mock$, {}, (e: any) => {
        renderedResult = e;
        return e;
      });

      assert.strictEqual(renderedResult?.view, undefined);
    });
  });
});
