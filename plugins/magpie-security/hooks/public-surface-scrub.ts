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

/**
 * Single forbidden-term regexes for public surfaces, aligned with
 * plugins/magpie-security/skills/issue-fix/implementation-plan.md:35-43.
 * Supports spaces and hyphens in compound vulnerability terms (e.g. SQL-injection).
 */
export const FORBIDDEN_TERM_RULES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'CVE reference', pattern: /\bCVE(?:-\d{4}-\d+)?\b/i },
  { name: 'vulnerability', pattern: /\bvulnerabilit(?:y|ies)\b/i },
  { name: 'security fix', pattern: /\bsecurity[\s-]+(?:fix|patch|advisory)\b/i },
  { name: 'security mailing list', pattern: /\bsecurity@/i },
  { name: 'SSRF', pattern: /\bSSRF\b/i },
  { name: 'XSS', pattern: /\bXSS\b/i },
  { name: 'CSRF', pattern: /\bCSRF\b/i },
  { name: 'SQL injection', pattern: /\bSQL[\s-]+injection\b/i },
  { name: 'path traversal', pattern: /\bpath[\s-]+traversal\b/i },
  { name: 'remote code execution', pattern: /\b(?:remote[\s-]+code[\s-]+execution|RCE)\b/i },
  { name: 'privilege escalation', pattern: /\bprivilege[\s-]+escalation\b/i },
  { name: 'auth bypass', pattern: /\bauth(?:orization|entication)?[\s-]+bypass\b/i },
];

/**
 * Finds all unique forbidden embargo terms that appear in the candidate text.
 */
export function findForbiddenTerms(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const matched: string[] = [];
  for (const rule of FORBIDDEN_TERM_RULES) {
    if (rule.pattern.test(text)) {
      matched.push(rule.name);
    }
  }

  return matched;
}

export interface ExtractedPublicSurface {
  isPublicSurfaceCommand: boolean;
  isPrivateTrackerTarget: boolean;
  commandType: string;
  extractedTexts: string[];
  referencedFiles: string[];
  hasComplexShellInput: boolean;
}

/**
 * Checks whether an explicit --repo or -R argument points to a private security tracker.
 * ASF security trackers use the `<project>-s/<project>-s` convention or contain `-s` / `security` / `private`.
 */
export function isPrivateTrackerTarget(commandLine: string): boolean {
  if (!commandLine || typeof commandLine !== 'string') {
    return false;
  }

  const repoMatch = commandLine.match(/(?:--repo|-R)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;]+))/i);
  if (!repoMatch) {
    return false;
  }

  const repo = (repoMatch[1] ?? repoMatch[2] ?? repoMatch[3] ?? '').toLowerCase();
  if (!repo) {
    return false;
  }

  // Suffix '-s' (e.g. airflow-s, airflow-s/airflow-s), or names containing private/security tracker
  return (
    repo.endsWith('-s') ||
    repo.includes('-s/') ||
    repo.includes('/private') ||
    repo.includes('-private') ||
    repo.includes('security-tracker')
  );
}

/**
 * Inspects a Bash command line to determine if it is a public-surface git/gh command,
 * extracting any inline commit/PR messages and referenced message files.
 * Handles combined short flags (e.g. -am, -sm) and complex shell inputs (heredocs, pipes).
 */
export function parsePublicSurfaceCommand(commandLine: string): ExtractedPublicSurface {
  const result: ExtractedPublicSurface = {
    isPublicSurfaceCommand: false,
    isPrivateTrackerTarget: false,
    commandType: '',
    extractedTexts: [],
    referencedFiles: [],
    hasComplexShellInput: false,
  };

  if (!commandLine || typeof commandLine !== 'string') {
    return result;
  }

  const trimmed = commandLine.trim();

  // Check if this targets a private tracker (e.g. gh pr comment --repo airflow-s/airflow-s)
  if (isPrivateTrackerTarget(trimmed)) {
    result.isPrivateTrackerTarget = true;
    return result;
  }

  // Detect heredocs (<<), shell pipelines (|), or process substitution (<()
  const hasComplexShellInput = /<<|\||<\(/.test(trimmed);
  result.hasComplexShellInput = hasComplexShellInput;

  // Match git commit commands, including git -C <dir> commit, git -c <k>=<v> commit, git commit -am, etc.
  if (/(?:^|[;&|]\s*)git\s+(?:-[^\s]+(?:\s+[^\s]+)?\s+)*commit(?:\s|$)/i.test(trimmed)) {
    result.isPublicSurfaceCommand = true;
    result.commandType = 'git commit';

    // Extract -m, -am, -sm, -sam, or --message="..."
    const mMatches = trimmed.matchAll(/(?:-[a-zA-Z]*m|--message)(?:=|\s+)(?:\$?"([^"]*)"|\$?'([^']*)'|([^\s;]+))/g);
    for (const m of mMatches) {
      const text = m[1] ?? m[2] ?? m[3];
      if (text) {
        result.extractedTexts.push(text);
      }
    }

    // Extract -F <file> or --file=<file>
    const fMatches = trimmed.matchAll(/(?:-F|--file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;]+))/g);
    for (const f of fMatches) {
      const file = f[1] ?? f[2] ?? f[3];
      if (file && file !== '-') {
        result.referencedFiles.push(file);
      }
    }

    return result;
  }

  // Match gh pr create commands
  if (/(?:^|[;&|]\s*)gh\s+pr\s+create(?:\s|$)/i.test(trimmed)) {
    result.isPublicSurfaceCommand = true;
    result.commandType = 'gh pr create';

    // Title: -t "..." or --title="..."
    const titleMatches = trimmed.matchAll(/(?:-t|--title)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s;]+))/g);
    for (const t of titleMatches) {
      const text = t[1] ?? t[2] ?? t[3];
      if (text) {
        result.extractedTexts.push(text);
      }
    }

    // Body: -b "..." or --body="..."
    const bodyMatches = trimmed.matchAll(/(?:-b|--body)(?:=|\s+)(?:\$?"([^"]*)"|\$?'([^']*)'|([^\s;]+))/g);
    for (const b of bodyMatches) {
      const text = b[1] ?? b[2] ?? b[3];
      if (text) {
        result.extractedTexts.push(text);
      }
    }

    // Body file: -F <file> or --body-file=<file>
    const fileMatches = trimmed.matchAll(/(?:-F|--body-file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;]+))/g);
    for (const f of fileMatches) {
      const file = f[1] ?? f[2] ?? f[3];
      if (file && file !== '-') {
        result.referencedFiles.push(file);
      }
    }

    return result;
  }

  // Match gh pr comment commands
  if (/(?:^|[;&|]\s*)gh\s+pr\s+comment(?:\s|$)/i.test(trimmed)) {
    result.isPublicSurfaceCommand = true;
    result.commandType = 'gh pr comment';

    // Body: -b "..." or --body="..."
    const bodyMatches = trimmed.matchAll(/(?:-b|--body)(?:=|\s+)(?:\$?"([^"]*)"|\$?'([^']*)'|([^\s;]+))/g);
    for (const b of bodyMatches) {
      const text = b[1] ?? b[2] ?? b[3];
      if (text) {
        result.extractedTexts.push(text);
      }
    }

    // Body file: -F <file> or --body-file=<file>
    const fileMatches = trimmed.matchAll(/(?:-F|--body-file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;]+))/g);
    for (const f of fileMatches) {
      const file = f[1] ?? f[2] ?? f[3];
      if (file && file !== '-') {
        result.referencedFiles.push(file);
      }
    }

    return result;
  }

  return result;
}

export type FileReader = (filePath: string) => Promise<string>;

export interface EvaluationOptions {
  readFile?: FileReader;
  env?: Record<string, string | undefined>;
}

/**
 * Evaluates whether a public-surface command violates embargo terms.
 * Returns null if allowed, or an actionable blocking error message if violated.
 */
export async function evaluatePublicSurfaceCommand(
  commandLine: string,
  options?: EvaluationOptions
): Promise<{ blocked: boolean; matchedTerms: string[]; reason?: string }> {
  // Check for explicit maintainer escape hatch (e.g. post-disclosure release notes or backport PRs)
  const envVal = options?.env?.MAGPIE_ALLOW_EMBARGO_TERMS;
  if (
    envVal === '1' ||
    /(?:^|\s)MAGPIE_ALLOW_EMBARGO_TERMS=1(?:\s|$)/.test(commandLine) ||
    commandLine.includes('--allow-embargo-terms')
  ) {
    return { blocked: false, matchedTerms: [] };
  }

  const parsed = parsePublicSurfaceCommand(commandLine);
  if (!parsed.isPublicSurfaceCommand || parsed.isPrivateTrackerTarget) {
    return { blocked: false, matchedTerms: [] };
  }

  const allTexts: string[] = [...parsed.extractedTexts];

  // If heredocs, pipes, or process substitution are used, scan the whole raw command line as well
  if (parsed.hasComplexShellInput) {
    allTexts.push(commandLine);
  }

  // If external message files are referenced, attempt to read their contents
  if (options?.readFile && parsed.referencedFiles.length > 0) {
    for (const file of parsed.referencedFiles) {
      try {
        const content = await options.readFile(file);
        if (content) {
          allTexts.push(content);
        }
      } catch {
        // Safe skip on unreadable file; pure regex inspection continues
      }
    }
  }

  const combinedText = allTexts.join('\n');
  const matchedTerms = findForbiddenTerms(combinedText);

  if (matchedTerms.length === 0) {
    return { blocked: false, matchedTerms: [] };
  }

  const uniqueTerms = Array.from(new Set(matchedTerms));
  const termList = uniqueTerms.map((t) => `\`${t}\``).join(', ');

  const reason = [
    `⛔ Apache Magpie Security Guard: Blocked public-surface command (${parsed.commandType}).`,
    `Found forbidden security disclosure term(s): ${termList}.`,
    '',
    'Confidentiality Rule (AGENTS.md & docs/security/fixing-security-issues.md):',
    'Public commits, PR descriptions, and PR comments on upstream repositories must describe the behavioral change in neutral terms (e.g. "Fix asset graph view leaking DAGs outside permissions").',
    'They must NEVER mention CVE IDs, "security fix", "vulnerability", or vulnerability classes (SSRF, XSS, etc.) before the coordinated disclosure advisory has shipped.',
    '',
    'If this is a legitimate post-disclosure change, set MAGPIE_ALLOW_EMBARGO_TERMS=1 to proceed.',
  ].join('\n');

  return {
    blocked: true,
    matchedTerms: uniqueTerms,
    reason,
  };
}

/**
 * Event hook registration entry point for Claude Code.
 */
export function register(on: any): void {
  // Hook tool.call to guard Bash executions on public surfaces
  on('tool.call', async ($: any, e: any, next: any) => {
    // Check if the tool is Bash and has a command parameter
    const toolName = (e?.tool || '').toLowerCase();
    const command = e?.input?.command || e?.params?.command;

    if (toolName === 'bash' && typeof command === 'string') {
      const evaluation = await evaluatePublicSurfaceCommand(command, {
        readFile: async (filePath: string) => {
          try {
            return await $.fs.read(filePath);
          } catch {
            return '';
          }
        },
      });

      if (evaluation.blocked && evaluation.reason) {
        // Return blocking error response to halt execution and educate the user/agent
        return {
          error: evaluation.reason,
        };
      }
    }

    if (typeof next === 'function') {
      return next(e);
    }
  });
}

export default register;
