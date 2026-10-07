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

  it('returns no drift when lockfile version matches current plugin version', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.apache-magpie.lock'),
      JSON.stringify({
        version: '0.9.0',
        ref: '0.9.0',
        snapshot_commit: 'abc1234',
      })
    );

    const result = checkSetupDrift(workspaceDir, pluginDir);
    assert.strictEqual(result.isAdopted, true);
    assert.strictEqual(result.hasDrift, false);
    assert.strictEqual(result.lockVersion, '0.9.0');
    assert.strictEqual(result.currentVersion, '0.9.0');
    assert.strictEqual(result.message, undefined);
  });

  it('detects drift when lockfile version differs from installed plugin version', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.apache-magpie.lock'),
      JSON.stringify({
        version: '0.8.0',
        ref: '0.8.0',
        snapshot_commit: 'oldcommit123',
      })
    );

    const result = checkSetupDrift(workspaceDir, pluginDir);
    assert.strictEqual(result.isAdopted, true);
    assert.strictEqual(result.hasDrift, true);
    assert.strictEqual(result.lockVersion, '0.8.0');
    assert.strictEqual(result.currentVersion, '0.9.0');
    assert.ok(result.message?.includes('0.8.0 -> 0.9.0'));
    assert.ok(result.message?.includes('/magpie-setup upgrade'));
  });

  it('detects drift when lockfile contains invalid / malformed JSON', () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.apache-magpie.lock'),
      'invalid json content {{{'
    );

    const result = checkSetupDrift(workspaceDir, pluginDir);
    assert.strictEqual(result.isAdopted, true);
    assert.strictEqual(result.hasDrift, true);
    assert.ok(result.message?.includes('Malformed `.apache-magpie.lock`'));
  });

  it('resolves plugin version correctly from candidate paths', () => {
    const version = resolvePluginVersion(pluginDir);
    assert.strictEqual(version, '0.9.0');
  });

  it('registers session.start and ui.render hooks and renders Box/Text view', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.apache-magpie.lock'),
      JSON.stringify({
        version: '0.7.5',
      })
    );

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
    assert.ok(textChild?.text?.includes('0.7.5 -> 0.9.0'));
    assert.ok(textChild?.text?.includes('/magpie-setup upgrade'));
  });

  it('remains silent when session starts without drift', async () => {
    fs.writeFileSync(
      path.join(workspaceDir, '.apache-magpie.lock'),
      JSON.stringify({
        version: '0.9.0',
      })
    );

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
