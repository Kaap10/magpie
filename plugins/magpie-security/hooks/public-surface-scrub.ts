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

import { CANONICAL_FORBIDDEN_TERMS, type CanonicalForbiddenTerm } from './forbidden-terms.ts';

/**
 * Single canonical forbidden-term regexes for public surfaces, derived directly
 * from DEFAULT_TERMS in tools/vcs/src/magpie_vcs/publication.py.
 */
export const FORBIDDEN_TERM_RULES: ReadonlyArray<{ name: string; pattern: RegExp }> =
  CANONICAL_FORBIDDEN_TERMS.map((term: CanonicalForbiddenTerm) => ({
    name: term.name,
    pattern: new RegExp(term.pattern, term.flags),
  }));

/**
 * Consecutive words a candidate public text may share with a private text
 * before it is reported as a verbatim copy. Aligned with magpie_vcs.publication.VERBATIM_WORDS.
 */
export const VERBATIM_WORDS = 8;

/**
 * Tokenizes text into lowercase alphanumeric words.
 */
function extractWords(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g);
  return matches ? Array.from(matches) : [];
}

/**
 * Computes consecutive n-grams (shingles) of words from text.
 */
function computeShingles(text: string, width: number): Set<string> {
  const words = extractWords(text);
  const shingles = new Set<string>();
  if (words.length < width) {
    return shingles;
  }
  for (let i = 0; i <= words.length - width; i++) {
    shingles.add(words.slice(i, i + width).join(' '));
  }
  return shingles;
}

/**
 * Finds all unique forbidden embargo terms that appear in the candidate text.
 */
export function findForbiddenTerms(
  text: string,
  extraOptions?: { reporterNames?: string[]; privateTexts?: string[] }
): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const matched: string[] = [];
  for (const rule of FORBIDDEN_TERM_RULES) {
    if (rule.pattern.test(text)) {
      matched.push(rule.name);
    }
  }

  // Check reporter names if provided
  if (extraOptions?.reporterNames) {
    for (const reporter of extraOptions.reporterNames) {
      if (reporter && reporter.trim()) {
        const escaped = reporter.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reporterRx = new RegExp(`\\b${escaped}\\b`, 'i');
        if (reporterRx.test(text)) {
          matched.push('reporter name');
        }
      }
    }
  }

  // Check verbatim private text shingles if provided
  if (extraOptions?.privateTexts && extraOptions.privateTexts.length > 0) {
    const candidateShingles = computeShingles(text, VERBATIM_WORDS);
    if (candidateShingles.size > 0) {
      for (const privateText of extraOptions.privateTexts) {
        if (!privateText) continue;
        const privateShingles = computeShingles(privateText, VERBATIM_WORDS);
        for (const s of candidateShingles) {
          if (privateShingles.has(s)) {
            matched.push('verbatim private text');
            break;
          }
        }
      }
    }
  }

  return matched;
}

export type FileReader = (filePath: string) => Promise<string | null | undefined>;

export interface ProjectRepos {
  trackerRepo?: string;
  upstreamRepo?: string;
  isTrackerCheckout?: boolean;
  reporterNames?: string[];
  privateTexts?: string[];
}

/**
 * Cleans and validates a repository slug (owner/repo).
 * Filters out placeholders, TODOs, comments, and non-slug text like "not used".
 */
export function cleanRepoSlug(raw: string | undefined): string | undefined {
  if (!raw || typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim().replace(/^[`'"]+|[`'"]+$/g, '').trim().toLowerCase();
  if (
    trimmed.startsWith('todo') ||
    trimmed.startsWith('<') ||
    trimmed.startsWith('not used') ||
    trimmed.startsWith('not_used') ||
    trimmed === 'none' ||
    trimmed === 'n/a' ||
    trimmed === '-' ||
    !trimmed.includes('/')
  ) {
    return undefined;
  }
  const match = trimmed.match(/^([a-z0-9_.-]+\/[a-z0-9_.-]+)/);
  return match ? match[1] : undefined;
}

/**
 * Parses project manifest content (Markdown table or YAML syntax) to extract
 * tracker_repo and upstream_repo slugs without assuming naming conventions.
 */
export function parseProjectManifest(content: string): ProjectRepos {
  const result: ProjectRepos = {};
  if (!content || typeof content !== 'string') {
    return result;
  }

  // Markdown table row: | `?tracker_repo`? | `?<slug>`? |
  const trackerMatch =
    content.match(/\|\s*`?tracker_repo`?\s*\|\s*`?([^`|\r\n]+)`?/i) ??
    content.match(/^\s*tracker_repo:\s*`?([^`\r\n#]+)`?/im);
  const trackerSlug = cleanRepoSlug(trackerMatch?.[1]);
  if (trackerSlug) {
    result.trackerRepo = trackerSlug;
  }

  // Markdown table row: | `?upstream_repo`? | `?<slug>`? |
  const upstreamMatch =
    content.match(/\|\s*`?upstream_repo`?\s*\|\s*`?([^`|\r\n]+)`?/i) ??
    content.match(/^\s*upstream_repo:\s*`?([^`\r\n#]+)`?/im) ??
    content.match(/\|\s*`?local_upstream`?\s*\|\s*`?([^`|\r\n]+)`?/i) ??
    content.match(/^\s*local_upstream:\s*`?([^`\r\n#]+)`?/im);
  const upstreamSlug = cleanRepoSlug(upstreamMatch?.[1]);
  if (upstreamSlug) {
    result.upstreamRepo = upstreamSlug;
  }

  return result;
}

/**
 * Resolves repository identity from <project-config>/project.md in precedence order:
 * 1. .apache-magpie-local/project.md
 * 2. .git/apache-magpie/project.md
 * 3. .apache-magpie-overrides/project.md
 * 4. ../.apache-magpie-overrides/project.md (if in sibling directory)
 */
export async function resolveProjectConfig(readFile?: FileReader, cwd?: string): Promise<ProjectRepos> {
  if (!readFile) {
    return {};
  }

  const prefix = cwd ? `${cwd.replace(/[\\/]+$/, '')}/` : '';
  const candidatePaths = [
    `${prefix}.apache-magpie-local/project.md`,
    `${prefix}.git/apache-magpie/project.md`,
    `${prefix}.apache-magpie-overrides/project.md`,
    '.apache-magpie-local/project.md',
    '.git/apache-magpie/project.md',
    '.apache-magpie-overrides/project.md',
    '../.apache-magpie-local/project.md',
    '../.apache-magpie-overrides/project.md',
    `${prefix}.apache-magpie-local/user.md`,
    `${prefix}.apache-magpie-overrides/user.md`,
    '.apache-magpie-local/user.md',
    '.apache-magpie-overrides/user.md',
    '~/.config/apache-magpie/user.md',
  ];

  for (const path of candidatePaths) {
    try {
      const content = await readFile(path);
      if (content && typeof content === 'string') {
        const repos = parseProjectManifest(content);
        if (repos.trackerRepo || repos.upstreamRepo) {
          // isTrackerCheckout is only true if project.md was found directly in the current checkout,
          // never when probing parent/sibling directories (../) or external directories
          repos.isTrackerCheckout = !path.startsWith('..') && !path.includes('/..');
          return repos;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  return {};
}

/**
 * Splits a composite shell command line into individual subcommands on
 * separators (;, &&, ||, |, \n, \r), respecting single and double quotes.
 */
export function splitShellCommands(commandLine: string): string[] {
  const commands: string[] = [];
  if (!commandLine || typeof commandLine !== 'string') {
    return commands;
  }

  let current = '';
  let inSingle = false;
  let inDouble = false;
  let isEscaped = false;

  for (let i = 0; i < commandLine.length; i++) {
    const char = commandLine[i];
    const next = commandLine[i + 1];

    if (isEscaped) {
      current += char;
      isEscaped = false;
      continue;
    }

    if (char === '\\' && !inSingle) {
      isEscaped = true;
      current += char;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (char === '\n' || char === '\r' || char === ';') {
        if (current.trim()) {
          commands.push(current.trim());
        }
        current = '';
        continue;
      }
      if (char === '&') {
        if (next === '&') {
          if (current.trim()) {
            commands.push(current.trim());
          }
          current = '';
          i++; // skip second &
          continue;
        }
        // Single & is a background separator (unless part of >& redirection)
        const prev = i > 0 ? commandLine[i - 1] : '';
        if (prev !== '>') {
          if (current.trim()) {
            commands.push(current.trim());
          }
          current = '';
          continue;
        }
      }
      if (char === '|' && next === '|') {
        if (current.trim()) {
          commands.push(current.trim());
        }
        current = '';
        i++; // skip second |
        continue;
      }
      if (char === '|') {
        if (current.trim()) {
          commands.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    commands.push(current.trim());
  }

  return commands;
}

/**
 * Tokenizes a single subcommand line into an argv array according to POSIX shell
 * quoting and escaping rules.
 * Handles single quotes ('...'), double quotes ("..." with \", \\, \$, \`),
 * and unquoted whitespace separation.
 */
export function tokenizeShellWords(subcommand: string): string[] {
  const tokens: string[] = [];
  if (!subcommand || typeof subcommand !== 'string') {
    return tokens;
  }

  let current = '';
  let inSingle = false;
  let inDouble = false;
  let isEscaped = false;
  let hasToken = false;

  for (let i = 0; i < subcommand.length; i++) {
    const char = subcommand[i];

    if (isEscaped) {
      current += char;
      hasToken = true;
      isEscaped = false;
      continue;
    }

    if (char === '\\' && !inSingle) {
      if (inDouble) {
        // In double quotes, only \", \\, \$, \`, \newline are escape sequences
        const next = subcommand[i + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n') {
          isEscaped = true;
          continue;
        }
        current += char;
        hasToken = true;
      } else {
        isEscaped = true;
      }
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      hasToken = true;
      continue;
    }

    if (/\s/.test(char) && !inSingle && !inDouble) {
      if (hasToken || current.length > 0) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (hasToken || current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Resolves a file path relative to an optional directory without requiring node:path.
 */
export function resolvePath(dir: string | undefined, filePath: string): string {
  if (!filePath) return '';
  const trimmed = filePath.trim().replace(/^['"]|['"]$/g, '');
  if (!dir || trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:/.test(trimmed)) {
    return trimmed;
  }
  const cleanDir = dir.trim().replace(/[\\/]+$/, '');
  const cleanPath = trimmed.replace(/^\.[\\/]+/, '').replace(/^[\\/]+/, '');
  return `${cleanDir}/${cleanPath}`;
}

export interface ParsedSubcommand {
  raw: string;
  isPublicSurfaceCommand: boolean;
  commandType: string;
  targetRepo?: string;
  gitCwd?: string;
  cdDir?: string;
  extractedTexts: string[];
  referencedFiles: string[];
  hasDynamicInput: boolean;
}

/**
 * Parses a single subcommand using the shell-words argv tokenizer.
 * Identifies git/gh invocations and extracts messages, referenced files,
 * target repositories, and git working directories.
 */
/**
 * Detects dynamic shell constructs that cannot be statically inspected:
 * command substitution ($(...) or `...`), parameter expansion ($VAR or ${VAR}),
 * process substitution (<(...)), and heredocs (<<).
 * Correctly ignores literal $VAR inside single quotes (e.g. -m 'costs $HOME').
 */
export function hasDynamicShellConstructs(subcommand: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let isEscaped = false;

  for (let i = 0; i < subcommand.length; i++) {
    const char = subcommand[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (char === '\\' && !inSingle) {
      isEscaped = true;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle) {
      if (char === '`') return true;
      if (char === '$' && i + 1 < subcommand.length) {
        const next = subcommand[i + 1];
        if (next === '(' || next === '{' || /[a-zA-Z_]/.test(next)) {
          return true;
        }
      }
      if (!inDouble) {
        if (char === '<' && i + 1 < subcommand.length) {
          const next = subcommand[i + 1];
          if (next === '<' || next === '(') {
            return true;
          }
        }
      }
    }
  }
  return false;
}

export function parseSubcommand(subcommand: string): ParsedSubcommand {
  const result: ParsedSubcommand = {
    raw: subcommand,
    isPublicSurfaceCommand: false,
    commandType: '',
    extractedTexts: [],
    referencedFiles: [],
    hasDynamicInput: false,
  };

  const trimmed = subcommand.trim();
  if (!trimmed) {
    return result;
  }

  if (hasDynamicShellConstructs(trimmed)) {
    result.hasDynamicInput = true;
  }

  const tokens = tokenizeShellWords(trimmed);
  if (tokens.length === 0) {
    return result;
  }

  // Check leading environment variable assignments (e.g. GH_REPO=owner/repo cmd ...)
  let cmdIdx = 0;
  while (cmdIdx < tokens.length && /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(tokens[cmdIdx])) {
    const envToken = tokens[cmdIdx];
    const ghRepoMatch = envToken.match(/^GH_REPO=([^\s]+)$/i);
    if (ghRepoMatch) {
      result.targetRepo = ghRepoMatch[1].toLowerCase();
    }
    cmdIdx++;
  }
  if (cmdIdx >= tokens.length) {
    return result;
  }

  const binary = tokens[cmdIdx];

  // Handle cd command for tracking directory state
  if (binary === 'cd' && cmdIdx + 1 < tokens.length) {
    result.cdDir = tokens[cmdIdx + 1];
    return result;
  }

  // Find git binary in tokens
  if (binary === 'git') {
    let subcmdIndex = -1;
    let gitCwd: string | undefined = undefined;

    // Parse git global options before the git subcommand
    for (let i = cmdIdx + 1; i < tokens.length; i++) {
      const token = tokens[i];

      // -C <dir> or -C=<dir> (case-sensitive!)
      if (token === '-C' && i + 1 < tokens.length) {
        gitCwd = tokens[i + 1];
        i++; // skip directory argument
        continue;
      }
      if (token.startsWith('-C=')) {
        gitCwd = token.slice(3);
        continue;
      }

      // Skip options that take an argument: -c <name>=<val>, --config-env <name>=<envvar>, etc.
      if (token === '-c' || token === '--config-env') {
        i++; // skip config value
        continue;
      }

      // Skip other flags
      if (token.startsWith('-')) {
        continue;
      }

      // First non-flag token is git subcommand
      subcmdIndex = i;
      break;
    }

    if (gitCwd) {
      result.gitCwd = gitCwd;
    }

    if (subcmdIndex === -1) {
      return result;
    }

    const subcmd = tokens[subcmdIndex];

    // 1. git commit
    if (subcmd === 'commit') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'git commit';

      for (let i = subcmdIndex + 1; i < tokens.length; i++) {
        const token = tokens[i];

        if (token === '--amend') {
          // If amending without explicit message or file, flag as dynamic reuse
          const hasExplicitMessage = tokens.slice(subcmdIndex + 1).some((t) =>
            t === '-m' || t === '-F' || t.startsWith('-m') || t.startsWith('-F') ||
            t.startsWith('--message') || t.startsWith('--file')
          );
          if (!hasExplicitMessage) {
            result.hasDynamicInput = true;
          }
          continue;
        }

        // -F <file>, -F<file>, --file <file>, --file=<file>
        if (token === '-F' || token === '--file') {
          if (i + 1 < tokens.length) {
            const file = tokens[i + 1];
            if (file === '-') {
              result.hasDynamicInput = true;
            } else {
              result.referencedFiles.push(file);
            }
            i++;
          }
          continue;
        }
        if (token.startsWith('--file=')) {
          const file = token.slice('--file='.length);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }

        // -m <msg>, -m<msg>, --message <msg>, --message=<msg>
        if (token === '-m' || token === '--message') {
          if (i + 1 < tokens.length) {
            result.extractedTexts.push(tokens[i + 1]);
            i++;
          }
          continue;
        }
        if (token.startsWith('--message=')) {
          result.extractedTexts.push(token.slice('--message='.length));
          continue;
        }
        if (token.startsWith('-m') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }

        // Clustered flags with boolean commit flags preceding m or F (e.g. -am, -sam, -aF, -saF)
        const clusteredMatch = token.match(/^-[asvqenS]+([mF])(.*)$/);
        if (clusteredMatch) {
          const flag = clusteredMatch[1];
          const rest = clusteredMatch[2];
          if (flag === 'm') {
            if (rest.length > 0) {
              result.extractedTexts.push(rest);
            } else if (i + 1 < tokens.length) {
              result.extractedTexts.push(tokens[i + 1]);
              i++;
            }
            continue;
          }
          if (flag === 'F') {
            const file = rest.length > 0 ? rest : (i + 1 < tokens.length ? tokens[++i] : '');
            if (file === '-') {
              result.hasDynamicInput = true;
            } else if (file) {
              result.referencedFiles.push(file);
            }
            continue;
          }
        }
      }

      return result;
    }

    // 2. git tag
    if (subcmd === 'tag') {
      const hasMsg = tokens.slice(subcmdIndex + 1).some((t) =>
        t === '-m' || t === '-F' || t.startsWith('-m') || t.startsWith('-F') ||
        t.startsWith('--message') || t.startsWith('--file')
      );
      if (hasMsg) {
        result.isPublicSurfaceCommand = true;
        result.commandType = 'git tag';

        for (let i = subcmdIndex + 1; i < tokens.length; i++) {
          const token = tokens[i];

          // -F <file>, -F<file>, --file <file>, --file=<file>
          if (token === '-F' || token === '--file') {
            if (i + 1 < tokens.length) {
              const file = tokens[i + 1];
              if (file === '-') {
                result.hasDynamicInput = true;
              } else {
                result.referencedFiles.push(file);
              }
              i++;
            }
            continue;
          }
          if (token.startsWith('--file=')) {
            const file = token.slice('--file='.length);
            if (file === '-') {
              result.hasDynamicInput = true;
            } else {
              result.referencedFiles.push(file);
            }
            continue;
          }
          if (token.startsWith('-F') && token.length > 2) {
            const file = token.slice(2);
            if (file === '-') {
              result.hasDynamicInput = true;
            } else {
              result.referencedFiles.push(file);
            }
            continue;
          }

          // -m <msg>, -m<msg>, --message <msg>, --message=<msg>
          if (token === '-m' || token === '--message') {
            if (i + 1 < tokens.length) {
              result.extractedTexts.push(tokens[i + 1]);
              i++;
            }
            continue;
          }
          if (token.startsWith('--message=')) {
            result.extractedTexts.push(token.slice('--message='.length));
            continue;
          }
          if (token.startsWith('-m') && token.length > 2) {
            result.extractedTexts.push(token.slice(2));
            continue;
          }

          // Clustered flags
          const clusteredMatch = token.match(/^-[asvqenS]+([mF])(.*)$/);
          if (clusteredMatch) {
            const flag = clusteredMatch[1];
            const rest = clusteredMatch[2];
            if (flag === 'm') {
              if (rest.length > 0) {
                result.extractedTexts.push(rest);
              } else if (i + 1 < tokens.length) {
                result.extractedTexts.push(tokens[i + 1]);
                i++;
              }
              continue;
            }
            if (flag === 'F') {
              const file = rest.length > 0 ? rest : (i + 1 < tokens.length ? tokens[++i] : '');
              if (file === '-') {
                result.hasDynamicInput = true;
              } else if (file) {
                result.referencedFiles.push(file);
              }
              continue;
            }
          }
        }

        return result;
      }
    }

    return result;
  }

  // Handle gh binary in tokens
  if (binary === 'gh') {
    // Extract target repo: -R <repo>, -R=<repo>, --repo <repo>, --repo=<repo>, -R<repo>
    // Linear scan skipping arguments to other flags to prevent reading --repo from inside body/title
    for (let i = cmdIdx + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if ((token === '-R' || token === '--repo') && i + 1 < tokens.length) {
        result.targetRepo = tokens[i + 1].toLowerCase();
        i++;
        continue;
      }
      if (token.startsWith('-R=')) {
        result.targetRepo = token.slice(3).toLowerCase();
        continue;
      }
      if (token.startsWith('--repo=')) {
        result.targetRepo = token.slice(7).toLowerCase();
        continue;
      }
      if (token.startsWith('-R') && token.length > 2) {
        result.targetRepo = token.slice(2).toLowerCase();
        continue;
      }
      const urlMatch = token.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/\d+/i);
      if (urlMatch) {
        result.targetRepo = urlMatch[1].toLowerCase();
        continue;
      }
      // Skip flags that take an argument so body or title text cannot be mistaken for flags
      if ((token === '-b' || token === '--body' || token === '-t' || token === '--title' ||
           token === '-F' || token === '--body-file' || token === '-f' || token === '--field' ||
           token === '--raw-field' || token === '--input') && i + 1 < tokens.length) {
        i++;
        continue;
      }
    }

    const ghSub1 = tokens[cmdIdx + 1];
    const ghSub2 = tokens[cmdIdx + 2];

    // gh pr create
    if (ghSub1 === 'pr' && ghSub2 === 'create') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr create';

      if (tokens.some((t) => t === '--fill' || t === '--fill-first')) {
        result.hasDynamicInput = true;
      }

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if ((token === '-t' || token === '--title') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('--title=')) {
          result.extractedTexts.push(token.slice('--title='.length));
          continue;
        }
        if (token.startsWith('-t') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if ((token === '-F' || token === '--body-file') && i + 1 < tokens.length) {
          const file = tokens[i + 1];
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          i++;
          continue;
        }
        if (token.startsWith('--body-file=')) {
          const file = token.slice('--body-file='.length);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
      }

      return result;
    }

    // gh pr edit
    if (ghSub1 === 'pr' && ghSub2 === 'edit') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr edit';

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if ((token === '-t' || token === '--title') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('--title=')) {
          result.extractedTexts.push(token.slice('--title='.length));
          continue;
        }
        if (token.startsWith('-t') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if ((token === '-F' || token === '--body-file') && i + 1 < tokens.length) {
          const file = tokens[i + 1];
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          i++;
          continue;
        }
        if (token.startsWith('--body-file=')) {
          const file = token.slice('--body-file='.length);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
      }

      return result;
    }

    // gh pr review
    if (ghSub1 === 'pr' && ghSub2 === 'review') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr review';

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if ((token === '--body-file' || token === '-F') && i + 1 < tokens.length) {
          const file = tokens[i + 1];
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          i++;
          continue;
        }
        if (token.startsWith('--body-file=')) {
          const file = token.slice('--body-file='.length);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
      }

      return result;
    }

    // gh pr comment / gh issue comment
    if ((ghSub1 === 'pr' || ghSub1 === 'issue') && ghSub2 === 'comment') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr comment';

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if ((token === '-F' || token === '--body-file') && i + 1 < tokens.length) {
          const file = tokens[i + 1];
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          i++;
          continue;
        }
        if (token.startsWith('--body-file=')) {
          const file = token.slice('--body-file='.length);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }
      }

      return result;
    }

    // gh api
    if (ghSub1 === 'api') {
      const isGraphql = tokens.includes('graphql');

      for (let i = cmdIdx + 2; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.startsWith('repos/')) {
          const slug = token.slice('repos/'.length).split('/')[0] + '/' + token.slice('repos/'.length).split('/')[1];
          result.targetRepo = slug.toLowerCase();
          continue;
        }
        if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/.test(token) && !token.startsWith('-')) {
          result.targetRepo = token.toLowerCase();
          continue;
        }

        // Handle --input <file> / --input=<file>
        if (token === '--input' && i + 1 < tokens.length) {
          const file = tokens[i + 1];
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          i++;
          continue;
        }
        if (token.startsWith('--input=')) {
          const file = token.slice('--input='.length);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
          continue;
        }

        if ((token === '-f' || token === '-F' || token === '--field' || token === '--raw-field') && i + 1 < tokens.length) {
          const fieldArg = tokens[i + 1];
          const match = fieldArg.match(/^(?:body|title|query)=(.*)$/s);
          if (match) {
            const val = match[1];
            if (val.startsWith('@')) {
              result.referencedFiles.push(val.slice(1));
            } else {
              result.extractedTexts.push(val);
            }
          }
          i++;
          continue;
        }
        const fieldMatch = token.match(/^(?:--field|--raw-field)=(?:body|title|query)=(.*)$/s);
        if (fieldMatch) {
          const val = fieldMatch[1];
          if (val.startsWith('@')) {
            result.referencedFiles.push(val.slice(1));
          } else {
            result.extractedTexts.push(val);
          }
          continue;
        }

        if (isGraphql && token.includes('mutation')) {
          result.extractedTexts.push(token);
        }
      }

      if (result.extractedTexts.length > 0 || result.referencedFiles.length > 0 || result.hasDynamicInput) {
        result.isPublicSurfaceCommand = true;
        result.commandType = 'gh api';
      }

      return result;
    }
  }

  return result;
}

export interface EvaluationOptions {
  readFile?: FileReader;
  env?: Record<string, string | undefined>;
  projectConfig?: ProjectRepos;
  privateTexts?: string[];
  reporterNames?: string[];
}

/**
 * Generates an actionable, maintainer-aligned blocking explanation.
 * Does NOT teach the agent how to bypass; instructs asking the maintainer.
 */
function generateBlockingReason(commandType: string, terms: string[]): string {
  const termList = terms.map((t) => `\`${t}\``).join(', ');
  return [
    `⛔ Apache Magpie Security Guard: Blocked public-surface command (${commandType}).`,
    `Found forbidden security disclosure term(s): ${termList}.`,
    '',
    'Confidentiality Rule (AGENTS.md & docs/security/fixing-security-issues.md):',
    'Public commits, tags, PR descriptions, and comments on upstream repositories must describe the change in neutral functional terms without mentioning CVE IDs or vulnerability classes before the coordinated disclosure advisory has shipped.',
    'If this is legitimate post-coordinated-disclosure maintenance, consult an Apache Magpie security-team maintainer to review and set the environment bypass.',
  ].join('\n');
}

/**
 * Inspects a directory's git remote URLs to determine if it is tracker, upstream, or third-party.
 * Compares against declared trackerRepo and upstreamRepo (including contributor forks).
 */
async function inspectDirectoryRemote(
  dir: string | undefined,
  projectConfig: ProjectRepos,
  readFile?: FileReader
): Promise<{ isTracker: boolean; isUpstream: boolean; determined: boolean }> {
  if (!readFile) {
    return { isTracker: false, isUpstream: false, determined: false };
  }

  const gitConfigPath = resolvePath(dir, '.git/config');
  let configContent: string | null = null;
  try {
    const raw = await readFile(gitConfigPath);
    if (raw && typeof raw === 'string') {
      configContent = raw;
    }
  } catch {
    configContent = null;
  }

  // If reading .git/config failed, check if .git is a worktree gitdir file
  if (!configContent) {
    try {
      const gitFilePath = resolvePath(dir, '.git');
      const gitFileContent = await readFile(gitFilePath);
      if (gitFileContent && typeof gitFileContent === 'string') {
        const gitDirMatch = gitFileContent.match(/gitdir:\s*([^\r\n]+)/i);
        if (gitDirMatch) {
          const resolvedGitDir = resolvePath(dir, gitDirMatch[1].trim());
          const worktreeConfigPath = resolvePath(resolvedGitDir, 'config');
          const raw = await readFile(worktreeConfigPath);
          if (raw && typeof raw === 'string') {
            configContent = raw;
          }
        }
      }
    } catch {
      configContent = null;
    }
  }

  if (!configContent) {
    return { isTracker: false, isUpstream: false, determined: false };
  }

  try {
    const configLower = configContent.toLowerCase();
    // Extract url lines under [remote ...]
    const urlMatches = configLower.matchAll(/url\s*=\s*([^\r\n]+)/g);
    const urls: string[] = [];
    for (const m of urlMatches) {
      urls.push(m[1].trim());
    }

    if (urls.length === 0) {
      return { isTracker: false, isUpstream: false, determined: false };
    }

    const trackerSlug = projectConfig.trackerRepo?.toLowerCase();
    const upstreamSlug = projectConfig.upstreamRepo?.toLowerCase();
    const upstreamRepoName = upstreamSlug?.includes('/') ? upstreamSlug.split('/')[1] : upstreamSlug;
    const trackerRepoName = trackerSlug?.includes('/') ? trackerSlug.split('/')[1] : trackerSlug;

    const matchesRepo = (url: string, slug?: string, repoName?: string): boolean => {
      if (!url) return false;
      const cleanUrl = url.toLowerCase().replace(/\.git$/, '');
      if (slug && cleanUrl.includes(slug)) {
        return true;
      }
      if (repoName && (cleanUrl.endsWith(`/${repoName}`) || cleanUrl.endsWith(`:${repoName}`))) {
        return true;
      }
      return false;
    };

    const isTracker = trackerSlug ? urls.some((u) => matchesRepo(u, trackerSlug, trackerRepoName)) : false;
    const isUpstream = upstreamSlug ? urls.some((u) => matchesRepo(u, upstreamSlug, upstreamRepoName)) : false;

    return {
      isTracker,
      isUpstream,
      determined: true,
    };
  } catch {
    return { isTracker: false, isUpstream: false, determined: false };
  }
}

/**
 * Evaluates whether a public-surface command violates embargo terms.
 * Evaluates per subcommand, respects project.md config for tracker/upstream resolution,
 * tracks cd directory transitions across subcommands, fails closed on unreadable files
 * and indeterminate repositories, and honours only human-set environment escape hatches.
 */
export async function evaluatePublicSurfaceCommand(
  commandLine: string,
  options?: EvaluationOptions
): Promise<{ blocked: boolean; matchedTerms: string[]; reason?: string }> {
  // Deterministic escape hatch: honour ONLY environment variable set by human before session
  if (options?.env?.MAGPIE_ALLOW_EMBARGO_TERMS === '1') {
    return { blocked: false, matchedTerms: [] };
  }

  if (!commandLine || typeof commandLine !== 'string') {
    return { blocked: false, matchedTerms: [] };
  }

  // Split command line into individual subcommands
  const subcommands = splitShellCommands(commandLine);

  let virtualCwd: string | undefined = undefined;

  for (const rawSub of subcommands) {
    const parsed = parseSubcommand(rawSub);

    // Track cd transitions
    if (parsed.cdDir) {
      virtualCwd = resolvePath(virtualCwd, parsed.cdDir);
      continue;
    }

    if (!parsed.isPublicSurfaceCommand) {
      continue;
    }

    const effectiveDir = parsed.gitCwd || virtualCwd;

    // Resolve project configuration (tracker_repo, upstream_repo) for this subcommand's scope
    const projectConfig = options?.projectConfig ?? (await resolveProjectConfig(options?.readFile, effectiveDir));
    const trackerRepo = projectConfig.trackerRepo?.toLowerCase();
    const upstreamRepo = projectConfig.upstreamRepo?.toLowerCase();
    const upstreamRepoName = upstreamRepo?.includes('/') ? upstreamRepo.split('/')[1] : upstreamRepo;

    // 1. Exemption: Subcommand explicitly targets the private security tracker
    if (parsed.targetRepo && trackerRepo && parsed.targetRepo === trackerRepo) {
      continue;
    }

    // 2. Repository scoping: Subcommands targeting upstream or a contributor's fork of upstream must be scrubbed.
    // Subcommands targeting an explicit unrelated repository (e.g. adopter docs, framework) pass unchecked.
    const isTargetUpstreamOrFork =
      parsed.targetRepo &&
      upstreamRepo &&
      (parsed.targetRepo === upstreamRepo ||
        (upstreamRepoName && parsed.targetRepo.endsWith(`/${upstreamRepoName}`)));

    if (parsed.targetRepo && !isTargetUpstreamOrFork) {
      continue;
    }

    // 3. For commands without explicit repo flag, determine repository from git context
    if (!parsed.targetRepo) {
      if (options?.readFile) {
        const remoteInfo = await inspectDirectoryRemote(effectiveDir, projectConfig, options.readFile);
        if (remoteInfo.determined) {
          if (remoteInfo.isTracker) {
            continue; // Safe tracker repository
          }
          if (!remoteInfo.isUpstream) {
            continue; // Known non-upstream remote (e.g. unrelated third-party repo, adopter docs), allow through
          }
        } else {
          // If remote is not determined and no tracker/upstream is configured, allow unrelated repos
          if (!trackerRepo && !upstreamRepo) {
            continue;
          }
        }
      }
    }

    // If dynamic input (stdin -, heredoc, command substitution, variable, pipe, gh pr create --fill, git commit --amend without message) is present
    if (parsed.hasDynamicInput) {
      // First check if the commandLine itself explicitly carries forbidden terms
      const dynamicTerms = findForbiddenTerms(commandLine, {
        reporterNames: options?.reporterNames ?? projectConfig.reporterNames,
        privateTexts: options?.privateTexts ?? projectConfig.privateTexts,
      });
      if (dynamicTerms.length > 0) {
        const uniqueTerms = Array.from(new Set(dynamicTerms));
        return {
          blocked: true,
          matchedTerms: uniqueTerms,
          reason: generateBlockingReason(parsed.commandType, uniqueTerms),
        };
      }
      // If the published content cannot be determined statically, fail closed
      return {
        blocked: true,
        matchedTerms: ['dynamic input'],
        reason: `⛔ Apache Magpie Security Guard: Blocked public-surface command (${parsed.commandType}) with indeterminate dynamic input. Content constructed from variables ($VAR), command substitution ($(..)), stdin (-), or automated reuse (--amend/--fill) cannot be verified deterministically before publication. Provide the text explicitly or via an inspectable file (-F <file>).`,
      };
    }

    // Collect all text candidates for this subcommand
    const candidateTexts: string[] = [...parsed.extractedTexts];

    // Read and inspect any referenced message files (-F / --body-file)
    for (const file of parsed.referencedFiles) {
      const resolvedPath = resolvePath(effectiveDir, file);
      if (!options?.readFile) {
        return {
          blocked: true,
          matchedTerms: [],
          reason: `⛔ Apache Magpie Security Guard: Blocked public-surface command (${parsed.commandType}). Referenced message file cannot be read: \`${resolvedPath}\`.`,
        };
      }

      try {
        const content = await options.readFile(resolvedPath);
        if (content === null || content === undefined || typeof content !== 'string') {
          return {
            blocked: true,
            matchedTerms: [],
            reason: `⛔ Apache Magpie Security Guard: Blocked public-surface command (${parsed.commandType}). Referenced message file could not be read: \`${resolvedPath}\`.`,
          };
        }
        candidateTexts.push(content);
      } catch {
        return {
          blocked: true,
          matchedTerms: [],
          reason: `⛔ Apache Magpie Security Guard: Blocked public-surface command (${parsed.commandType}). Referenced message file could not be read: \`${resolvedPath}\`.`,
        };
      }
    }

    // Check for forbidden terms, reporter names, and verbatim private text
    const combinedText = candidateTexts.join('\n');
    const matched = findForbiddenTerms(combinedText, {
      reporterNames: options?.reporterNames ?? projectConfig.reporterNames,
      privateTexts: options?.privateTexts ?? projectConfig.privateTexts,
    });

    if (matched.length > 0) {
      // If scope could not be determined deterministically as tracker, fail closed
      const uniqueTerms = Array.from(new Set(matched));
      return {
        blocked: true,
        matchedTerms: uniqueTerms,
        reason: generateBlockingReason(parsed.commandType, uniqueTerms),
      };
    }
  }

  return { blocked: false, matchedTerms: [] };
}

/**
 * Event hook registration entry point for Claude Code.
 */
export function register(on: any): void {
  on('tool.call', { tool: 'Bash' }, async ($: any, e: any, next: any) => {
    const command = e?.command;

    if (typeof command === 'string') {
      let allowBypass: string | undefined;
      try {
        allowBypass = await $.env.get('MAGPIE_ALLOW_EMBARGO_TERMS');
      } catch {
        // $.env may be absent in mock harnesses
      }
      const hookEnv = allowBypass ? { MAGPIE_ALLOW_EMBARGO_TERMS: allowBypass } : (e?.env ?? {});
      const evaluation = await evaluatePublicSurfaceCommand(command, {
        env: hookEnv,
        readFile: async (filePath: string) => {
          try {
            return await $.fs.read(filePath);
          } catch {
            return null;
          }
        },
      });

      if (evaluation.blocked && evaluation.reason) {
        return {
          deny: evaluation.reason,
        };
      }
    }

    if (typeof next === 'function') {
      return next(e);
    }
  });
}

export default register;
