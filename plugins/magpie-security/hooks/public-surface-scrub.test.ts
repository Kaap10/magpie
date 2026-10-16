// SPDX-License-Identifier: Apache-2.0
//
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
  evaluatePublicSurfaceCommand,
  findForbiddenTerms,
  isPrivateTrackerTarget,
  parsePublicSurfaceCommand,
  register,
} from './public-surface-scrub.ts';

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

describe('Deterministic Public-Surface Scrub mod (family:security)', () => {
  describe('findForbiddenTerms', () => {
    test('returns empty array on neutral behavioral changes', () => {
      assertDeepStrictEqual(findForbiddenTerms('Fix asset graph view leaking DAGs outside user permissions'), []);
      assertDeepStrictEqual(findForbiddenTerms('Add access_key and connection_string to DEFAULT_SENSITIVE_FIELDS'), []);
      assertDeepStrictEqual(findForbiddenTerms('Improve xcom value handling in extra links API'), []);
      assertDeepStrictEqual(findForbiddenTerms(''), []);
      assertDeepStrictEqual(findForbiddenTerms(null as any), []);
    });

    test('detects CVE references', () => {
      const hits = findForbiddenTerms('Fix CVE-2026-12345 in connection test');
      assert(hits.includes('CVE reference'));
      const bareHits = findForbiddenTerms('Address issue reported as cve');
      assert(bareHits.includes('CVE reference'));
    });

    test('detects vulnerability and security fix keywords (spaced and hyphenated)', () => {
      assert(findForbiddenTerms('Fix critical vulnerability in parsing logic').includes('vulnerability'));
      assert(findForbiddenTerms('Security fix for webserver endpoints').includes('security fix'));
      assert(findForbiddenTerms('Apply security-fix for session timeout').includes('security fix'));
      assert(findForbiddenTerms('Security patch for query builder').includes('security fix'));
      assert(findForbiddenTerms('Apply critical security-patch').includes('security fix'));
      assert(findForbiddenTerms('Contact security@apache.org for details').includes('security mailing list'));
    });

    test('detects vulnerability classes with whitespace and hyphens', () => {
      assert(findForbiddenTerms('Prevent SSRF in HTTP provider').includes('SSRF'));
      assert(findForbiddenTerms('Mitigate stored XSS in log view').includes('XSS'));
      assert(findForbiddenTerms('Add CSRF token validation').includes('CSRF'));
      assert(findForbiddenTerms('Prevent SQL injection in search filter').includes('SQL injection'));
      assert(findForbiddenTerms('Mitigate SQL-injection in query filter').includes('SQL injection'));
      assert(findForbiddenTerms('Fix path traversal in file download').includes('path traversal'));
      assert(findForbiddenTerms('Prevent path-traversal in file handler').includes('path traversal'));
      assert(findForbiddenTerms('Prevent remote code execution in worker').includes('remote code execution'));
      assert(findForbiddenTerms('Close RCE vector in serializer').includes('remote code execution'));
      assert(findForbiddenTerms('Fix remote-code-execution vulnerability').includes('remote code execution'));
      assert(findForbiddenTerms('Fix privilege escalation in role mapper').includes('privilege escalation'));
      assert(findForbiddenTerms('Prevent privilege-escalation bug').includes('privilege escalation'));
      assert(findForbiddenTerms('Fix auth bypass in REST API').includes('auth bypass'));
      assert(findForbiddenTerms('Mitigate auth-bypass vulnerability').includes('auth bypass'));
    });

    test('returns multiple matched terms uniquely', () => {
      const terms = findForbiddenTerms('Fix CVE-2026-9999: critical SSRF vulnerability allowing auth-bypass');
      assert(terms.includes('CVE reference'));
      assert(terms.includes('SSRF'));
      assert(terms.includes('vulnerability'));
      assert(terms.includes('auth bypass'));
    });
  });

  describe('isPrivateTrackerTarget', () => {
    test('identifies ASF security tracker repo format with -s suffix', () => {
      assertStrictEqual(isPrivateTrackerTarget('gh pr comment 123 --repo airflow-s/airflow-s --body "Details"'), true);
      assertStrictEqual(isPrivateTrackerTarget('gh pr create -R myorg/kafka-s -b "Fix"'), true);
      assertStrictEqual(isPrivateTrackerTarget('gh issue view 5 -R org/security-tracker'), true);
      assertStrictEqual(isPrivateTrackerTarget('gh pr view 10 -R org/repo-private'), true);
    });

    test('returns false for public upstream repositories', () => {
      assertStrictEqual(isPrivateTrackerTarget('gh pr create --repo apache/airflow --body "Details"'), false);
      assertStrictEqual(isPrivateTrackerTarget('gh pr comment 123 -R apache/kafka -b "Fix"'), false);
      assertStrictEqual(isPrivateTrackerTarget('git commit -m "Fix"'), false);
    });
  });

  describe('parsePublicSurfaceCommand', () => {
    test('identifies clean git commit with -m', () => {
      const parsed = parsePublicSurfaceCommand('git commit -m "Fix asset graph view"');
      assertStrictEqual(parsed.isPublicSurfaceCommand, true);
      assertStrictEqual(parsed.commandType, 'git commit');
      assertDeepStrictEqual(parsed.extractedTexts, ['Fix asset graph view']);
      assertDeepStrictEqual(parsed.referencedFiles, []);
    });

    test('identifies git commit with combined short flags like -am and -sm', () => {
      const amParsed = parsePublicSurfaceCommand('git commit -am "Fix asset graph view"');
      assertStrictEqual(amParsed.isPublicSurfaceCommand, true);
      assertDeepStrictEqual(amParsed.extractedTexts, ['Fix asset graph view']);

      const smParsed = parsePublicSurfaceCommand('git commit -sm "Fix asset graph view"');
      assertStrictEqual(smParsed.isPublicSurfaceCommand, true);
      assertDeepStrictEqual(smParsed.extractedTexts, ['Fix asset graph view']);

      const samParsed = parsePublicSurfaceCommand('git commit -sam "Fix asset graph view"');
      assertStrictEqual(samParsed.isPublicSurfaceCommand, true);
      assertDeepStrictEqual(samParsed.extractedTexts, ['Fix asset graph view']);
    });

    test('identifies git -C <dir> commit with options that take arguments', () => {
      const parsed = parsePublicSurfaceCommand('git -C /path/to/upstream commit -s -m "Fix asset graph view"');
      assertStrictEqual(parsed.isPublicSurfaceCommand, true);
      assertStrictEqual(parsed.commandType, 'git commit');
      assertDeepStrictEqual(parsed.extractedTexts, ['Fix asset graph view']);
    });

    test('identifies git commit with multiple -m flags and flags in between', () => {
      const parsed = parsePublicSurfaceCommand('git commit -s -m "Header line" -m "Body description"');
      assertStrictEqual(parsed.isPublicSurfaceCommand, true);
      assertDeepStrictEqual(parsed.extractedTexts, ['Header line', 'Body description']);
    });

    test('identifies git commit with -F message file', () => {
      const parsed = parsePublicSurfaceCommand('git commit -F /tmp/commit-msg.txt');
      assertStrictEqual(parsed.isPublicSurfaceCommand, true);
      assertDeepStrictEqual(parsed.referencedFiles, ['/tmp/commit-msg.txt']);
    });

    test('detects heredoc and shell pipeline usage', () => {
      const heredocParsed = parsePublicSurfaceCommand("git commit -F - << 'EOF'\nFix CVE-2026-1234\nEOF");
      assertStrictEqual(heredocParsed.isPublicSurfaceCommand, true);
      assertStrictEqual(heredocParsed.hasComplexShellInput, true);

      const pipeParsed = parsePublicSurfaceCommand('echo "msg" | gh pr create --title "Title" --body-file -');
      assertStrictEqual(pipeParsed.isPublicSurfaceCommand, true);
      assertStrictEqual(pipeParsed.hasComplexShellInput, true);
    });

    test('identifies gh pr create with title, body, and body-file', () => {
      const parsed = parsePublicSurfaceCommand('gh pr create --title "Neutral title" --body "Neutral body"');
      assertStrictEqual(parsed.isPublicSurfaceCommand, true);
      assertStrictEqual(parsed.commandType, 'gh pr create');
      assert(parsed.extractedTexts.includes('Neutral title'));
      assert(parsed.extractedTexts.includes('Neutral body'));

      const fileParsed = parsePublicSurfaceCommand('gh pr create -t "Title" --body-file /tmp/pr.md');
      assertStrictEqual(fileParsed.isPublicSurfaceCommand, true);
      assertDeepStrictEqual(fileParsed.referencedFiles, ['/tmp/pr.md']);
    });

    test('skips public surface parsing when target is a private tracker repo', () => {
      const parsed = parsePublicSurfaceCommand('gh pr comment 123 --repo airflow-s/airflow-s --body "Fixes CVE-2026-1"');
      assertStrictEqual(parsed.isPrivateTrackerTarget, true);
      assertStrictEqual(parsed.isPublicSurfaceCommand, false);
    });

    test('ignores non-public surface commands', () => {
      assertStrictEqual(parsePublicSurfaceCommand('pytest tests/').isPublicSurfaceCommand, false);
      assertStrictEqual(parsePublicSurfaceCommand('git status').isPublicSurfaceCommand, false);
      assertStrictEqual(parsePublicSurfaceCommand('git diff HEAD~1').isPublicSurfaceCommand, false);
      assertStrictEqual(parsePublicSurfaceCommand('uv run ruff check').isPublicSurfaceCommand, false);
      assertStrictEqual(parsePublicSurfaceCommand('').isPublicSurfaceCommand, false);
    });
  });

  describe('evaluatePublicSurfaceCommand', () => {
    test('allows clean neutral commit', async () => {
      const evaluation = await evaluatePublicSurfaceCommand('git commit -m "Fix asset graph view"');
      assertStrictEqual(evaluation.blocked, false);
      assertDeepStrictEqual(evaluation.matchedTerms, []);
    });

    test('blocks git commit -am containing CVE reference', async () => {
      const evaluation = await evaluatePublicSurfaceCommand('git commit -am "Fix CVE-2026-5555 in connection test"');
      assertStrictEqual(evaluation.blocked, true);
      assert(evaluation.matchedTerms.includes('CVE reference'));
    });

    test('blocks git -C <dir> commit containing hyphenated vulnerability class', async () => {
      const evaluation = await evaluatePublicSurfaceCommand('git -C /path/to/upstream commit -m "Fix SQL-injection in query"');
      assertStrictEqual(evaluation.blocked, true);
      assert(evaluation.matchedTerms.includes('SQL injection'));
      assert(evaluation.reason?.includes('Apache Magpie Security Guard'));
      assert(evaluation.reason?.includes('Confidentiality Rule'));
    });

    test('blocks commit reading message file that contains forbidden terms', async () => {
      const mockFiles: Record<string, string> = {
        '/tmp/msg.txt': 'Stop deserializing XCom values\n\nFixes arbitrary SQL injection in worker.',
      };
      const evaluation = await evaluatePublicSurfaceCommand('git commit -F /tmp/msg.txt', {
        readFile: async (p) => mockFiles[p] || '',
      });

      assertStrictEqual(evaluation.blocked, true);
      assert(evaluation.matchedTerms.includes('SQL injection'));
    });

    test('blocks heredoc commit containing forbidden terms', async () => {
      const heredocCmd = "git commit -F - << 'EOF'\nFix CVE-2026-1111: Critical SSRF vulnerability\nEOF";
      const evaluation = await evaluatePublicSurfaceCommand(heredocCmd);
      assertStrictEqual(evaluation.blocked, true);
      assert(evaluation.matchedTerms.includes('CVE reference'));
      assert(evaluation.matchedTerms.includes('SSRF'));
      assert(evaluation.matchedTerms.includes('vulnerability'));
    });

    test('blocks piped command line containing forbidden terms', async () => {
      const pipeCmd = 'echo "Fixes critical SSRF vulnerability" | gh pr create --title "Fix" --body-file -';
      const evaluation = await evaluatePublicSurfaceCommand(pipeCmd);
      assertStrictEqual(evaluation.blocked, true);
      assert(evaluation.matchedTerms.includes('SSRF'));
      assert(evaluation.matchedTerms.includes('vulnerability'));
    });

    test('allows private tracker commands even when mentioning CVEs and vulnerability classes', async () => {
      const trackerCmd = 'gh pr comment 45 --repo apache/airflow-s --body "Confirmed SSRF fix for CVE-2026-1234"';
      const evaluation = await evaluatePublicSurfaceCommand(trackerCmd);
      assertStrictEqual(evaluation.blocked, false);
    });

    test('honors maintainer escape hatch via env var', async () => {
      const leakingCmd = 'git commit -m "Backport CVE-2026-1234 release notes"';
      const evaluation = await evaluatePublicSurfaceCommand(leakingCmd, {
        env: { MAGPIE_ALLOW_EMBARGO_TERMS: '1' },
      });
      assertStrictEqual(evaluation.blocked, false);
    });

    test('honors maintainer escape hatch via inline flag', async () => {
      const leakingCmd = 'MAGPIE_ALLOW_EMBARGO_TERMS=1 git commit -m "Backport CVE-2026-1234"';
      const evaluation = await evaluatePublicSurfaceCommand(leakingCmd);
      assertStrictEqual(evaluation.blocked, false);
    });

    test('passes non-target commands through immediately', async () => {
      const evaluation = await evaluatePublicSurfaceCommand('git log -n 5 --grep "CVE-"');
      assertStrictEqual(evaluation.blocked, false);
    });
  });

  describe('Claude Code hook integration (register)', () => {
    test('allows clean Bash tool call through via next()', async () => {
      let registeredHook: any = null;
      const on = (event: string, handler: any) => {
        if (event === 'tool.call') {
          registeredHook = handler;
        }
      };

      register(on);
      assert(registeredHook, 'tool.call hook must be registered');

      let nextCalled = false;
      const mockEvent = { tool: 'Bash', input: { command: 'git commit -m "Fix asset graph view"' } };
      const next = (e: any) => {
        nextCalled = true;
        return { success: true, event: e };
      };

      const result = await registeredHook({ fs: { read: async () => '' } }, mockEvent, next);
      assertStrictEqual(nextCalled, true);
      assertStrictEqual(result.success, true);
    });

    test('intercepts and blocks leaking Bash tool call with combined -am flag returning error', async () => {
      let registeredHook: any = null;
      const on = (event: string, handler: any) => {
        if (event === 'tool.call') {
          registeredHook = handler;
        }
      };

      register(on);

      let nextCalled = false;
      const mockEvent = {
        tool: 'Bash',
        input: { command: 'git -C /upstream commit -am "Fix CVE-2026-1111: SSRF vulnerability"' },
      };
      const next = () => {
        nextCalled = true;
      };

      const result = await registeredHook({ fs: { read: async () => '' } }, mockEvent, next);
      assertStrictEqual(nextCalled, false, 'next() must NOT be called on blocked commands');
      assert(result.error, 'Error explanation must be returned');
      assert(result.error.includes('Apache Magpie Security Guard'));
      assert(result.error.includes('CVE reference'));
      assert(result.error.includes('SSRF'));
    });

    test('passes non-Bash tools through to next() unchanged', async () => {
      let registeredHook: any = null;
      const on = (event: string, handler: any) => {
        if (event === 'tool.call') {
          registeredHook = handler;
        }
      };

      register(on);

      let nextCalled = false;
      const mockEvent = { tool: 'ReadUrl', input: { url: 'https://cve.org/CVE-2026-1234' } };
      const next = (e: any) => {
        nextCalled = true;
        return { forwarded: e };
      };

      const result = await registeredHook({ fs: { read: async () => '' } }, mockEvent, next);
      assertStrictEqual(nextCalled, true);
      assertStrictEqual(result.forwarded.tool, 'ReadUrl');
    });
  });
});
