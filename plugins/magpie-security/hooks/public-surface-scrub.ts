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

export type FileReader = (filePath: string) => Promise<string | null | undefined>;

export interface ProjectRepos {
  trackerRepo?: string;
  upstreamRepo?: string;
  upstreamClonePath?: string;
  isTrackerCheckout?: boolean;
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
 * Parses project manifest or user config content (Markdown table or YAML syntax)
 * to extract tracker_repo, upstream_repo, and environment.upstream_clone.
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
    content.match(/^\s*upstream_repo:\s*`?([^`\r\n#]+)`?/im);
  const upstreamSlug = cleanRepoSlug(upstreamMatch?.[1]);
  if (upstreamSlug) {
    result.upstreamRepo = upstreamSlug;
  }

  // user.md declares environment.upstream_clone or upstream_clone as a filesystem path
  const upstreamCloneMatch =
    content.match(/\|\s*`?(?:environment\.)?upstream_clone`?\s*\|\s*`?([^`|\r\n]+)`?/i) ??
    content.match(/^\s*(?:environment\.)?upstream_clone:\s*`?([^`\r\n#]+)`?/im) ??
    content.match(/^\s*upstream_clone:\s*`?([^`\r\n#]+)`?/im);
  if (upstreamCloneMatch?.[1]) {
    const rawPath = upstreamCloneMatch[1].trim().replace(/^[`'"]+|[`'"]+$/g, '').trim();
    if (rawPath && !rawPath.startsWith('TODO') && !rawPath.startsWith('<')) {
      result.upstreamClonePath = rawPath;
    }
  }

  return result;
}

/**
 * Resolves repository identity from <project-config>/project.md and user.md in precedence order:
 * 1. .apache-magpie-local/project.md
 * 2. .git/apache-magpie/project.md (and worktree common dir)
 * 3. .apache-magpie-overrides/project.md
 * 4. ../.apache-magpie-overrides/project.md (if in sibling directory)
 * 5. user.md layers (including ~/.config/apache-magpie/user.md with $HOME expanded)
 */
export async function resolveProjectConfig(
  readFile?: FileReader,
  cwd?: string,
  env?: { [key: string]: string | undefined }
): Promise<ProjectRepos> {
  if (!readFile) {
    return {};
  }

  const prefix = cwd ? `${cwd.replace(/[\\/]+$/, '')}/` : '';
  const procEnv = typeof process !== 'undefined' ? process.env : undefined;
  const homeDir = (env?.HOME || procEnv?.HOME || procEnv?.USERPROFILE || '').replace(/[\\/]+$/, '');

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
  ];

  if (homeDir) {
    candidatePaths.push(`${homeDir}/.config/apache-magpie/user.md`);
  }
  candidatePaths.push('~/.config/apache-magpie/user.md');

  // Check git worktree gitdir pointer
  try {
    const gitFilePath = `${prefix}.git`;
    const gitFileContent = await readFile(gitFilePath);
    if (gitFileContent && typeof gitFileContent === 'string') {
      const gitDirMatch = gitFileContent.match(/gitdir:\s*([^\r\n]+)/i);
      if (gitDirMatch) {
        const resolvedGitDir = resolvePath(cwd, gitDirMatch[1].trim());
        // In a worktree, gitdir is <commondir>/worktrees/<name>; the common dir is two levels up
        const commonDir = resolvedGitDir.replace(/[\\/]worktrees[\\/][^\\/]+$/, '');
        candidatePaths.unshift(`${commonDir}/apache-magpie/project.md`);
      }
    }
  } catch {
    // Continue
  }

  let merged: ProjectRepos = {};

  for (const path of candidatePaths) {
    try {
      const content = await readFile(path);
      if (content && typeof content === 'string') {
        const repos = parseProjectManifest(content);
        if (repos.trackerRepo && !merged.trackerRepo) {
          merged.trackerRepo = repos.trackerRepo;
          merged.isTrackerCheckout = !path.startsWith('..') && !path.includes('/..');
        }
        if (repos.upstreamRepo && !merged.upstreamRepo) {
          merged.upstreamRepo = repos.upstreamRepo;
        }
        if (repos.upstreamClonePath && !merged.upstreamClonePath) {
          // Expand ~ in upstreamClonePath if needed
          let clonePath = repos.upstreamClonePath;
          if (clonePath.startsWith('~/') && homeDir) {
            clonePath = `${homeDir}/${clonePath.slice(2)}`;
          }
          merged.upstreamClonePath = clonePath;
        }
        if (merged.trackerRepo && merged.upstreamRepo) {
          return merged;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  return merged;
}

export interface ShellSubcommand {
  raw: string;
  separatorAfter?: string;
}

/**
 * Splits a composite shell command line into individual subcommands along with
 * the trailing separator (&&, ;, \n, |, ||, &), respecting quoting rules.
 */
export function splitShellSubcommands(commandLine: string): ShellSubcommand[] {
  const result: ShellSubcommand[] = [];
  if (!commandLine || typeof commandLine !== 'string') {
    return result;
  }

  let current = '';
  let inSingle = false;
  let inDouble = false;
  let isEscaped = false;

  const pushCurrent = (sep?: string) => {
    if (current.trim()) {
      result.push({ raw: current.trim(), separatorAfter: sep });
    }
    current = '';
  };

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
      if (char === '\n' || char === '\r') {
        pushCurrent('\n');
        continue;
      }
      if (char === ';') {
        pushCurrent(';');
        continue;
      }
      if (char === '&') {
        if (next === '&') {
          pushCurrent('&&');
          i++; // skip second &
          continue;
        }
        // Single & is background separator unless part of >& redirection
        const prev = i > 0 ? commandLine[i - 1] : '';
        if (prev !== '>') {
          pushCurrent('&');
          continue;
        }
      }
      if (char === '|' && next === '|') {
        pushCurrent('||');
        i++; // skip second |
        continue;
      }
      if (char === '|') {
        pushCurrent('|');
        continue;
      }
    }

    current += char;
  }

  pushCurrent(undefined);
  return result;
}

/**
 * Splits a composite shell command line into individual subcommand strings.
 */
export function splitShellCommands(commandLine: string): string[] {
  return splitShellSubcommands(commandLine).map((s) => s.raw);
}

/**
 * Tokenizes a single subcommand line into an argv array according to POSIX shell
 * quoting and escaping rules.
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
  redirectedFiles: string[];
  hasDynamicInput: boolean;
  isGraphqlMutation?: boolean;
}

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
    redirectedFiles: [],
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

  // Detect file redirection operators in subcommand (> or >>)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ((t === '>' || t === '>>' || t === '1>' || t === '1>>') && i + 1 < tokens.length) {
      result.redirectedFiles.push(tokens[i + 1]);
      i++;
    } else if (t.startsWith('>') || t.startsWith('>>') || t.startsWith('1>') || t.startsWith('1>>')) {
      const target = t.replace(/^(?:1?>{1,2})/, '');
      if (target) {
        result.redirectedFiles.push(target);
      }
    }
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

      // -C <dir> or -C=<dir> (case-sensitive; repeated -Cs compose!)
      if (token === '-C' && i + 1 < tokens.length) {
        gitCwd = gitCwd ? resolvePath(gitCwd, tokens[i + 1]) : tokens[i + 1];
        i++; // skip directory argument
        continue;
      }
      if (token.startsWith('-C=')) {
        const nextDir = token.slice(3);
        gitCwd = gitCwd ? resolvePath(gitCwd, nextDir) : nextDir;
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

        // Message reuse options: dynamically reuse text from history -> flag as dynamic input (fail closed)
        if (
          token === '-C' ||
          token.startsWith('-C=') ||
          token === '-c' ||
          token.startsWith('-c=') ||
          token === '--reuse-message' ||
          token.startsWith('--reuse-message=') ||
          token === '--reedit-message' ||
          token.startsWith('--reedit-message=') ||
          token === '--fixup' ||
          token.startsWith('--fixup=') ||
          token === '--squash' ||
          token.startsWith('--squash=')
        ) {
          result.hasDynamicInput = true;
          if (
            (token === '-C' || token === '-c' || token === '--reuse-message' || token === '--reedit-message' || token === '--fixup' || token === '--squash') &&
            i + 1 < tokens.length &&
            !tokens[i + 1].startsWith('-')
          ) {
            i++;
          }
          continue;
        }

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

        // --trailer <val>, --trailer=<val>
        if (token === '--trailer' && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('--trailer=')) {
          result.extractedTexts.push(token.slice('--trailer='.length));
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

        // Handle clustered short flags ending in m or F: e.g. -am"msg", -am msg
        if (token.startsWith('-') && !token.startsWith('--') && (token.includes('m') || token.includes('F'))) {
          const mIdx = token.indexOf('m');
          const fIdx = token.indexOf('F');
          if (mIdx !== -1) {
            if (mIdx < token.length - 1) {
              result.extractedTexts.push(token.slice(mIdx + 1));
            } else if (i + 1 < tokens.length) {
              result.extractedTexts.push(tokens[i + 1]);
              i++;
            }
          } else if (fIdx !== -1) {
            if (fIdx < token.length - 1) {
              const file = token.slice(fIdx + 1);
              if (file === '-') {
                result.hasDynamicInput = true;
              } else {
                result.referencedFiles.push(file);
              }
            } else if (i + 1 < tokens.length) {
              const file = tokens[i + 1];
              if (file === '-') {
                result.hasDynamicInput = true;
              } else {
                result.referencedFiles.push(file);
              }
              i++;
            }
          }
          continue;
        }
      }

      return result;
    }

    // 2. git tag
    if (subcmd === 'tag') {
      const hasMsg = tokens.slice(subcmdIndex + 1).some((t) =>
        t === '-m' || t === '-F' ||
        (t.startsWith('-') && !t.startsWith('--') && (t.includes('m') || t.includes('F'))) ||
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

          // Handle clustered flags like -am '...', -sm '...'
          if (token.startsWith('-') && !token.startsWith('--') && (token.includes('m') || token.includes('F'))) {
            const mIdx = token.indexOf('m');
            const fIdx = token.indexOf('F');
            if (mIdx !== -1) {
              if (mIdx < token.length - 1) {
                result.extractedTexts.push(token.slice(mIdx + 1));
              } else if (i + 1 < tokens.length) {
                result.extractedTexts.push(tokens[i + 1]);
                i++;
              }
            } else if (fIdx !== -1) {
              if (fIdx < token.length - 1) {
                const file = token.slice(fIdx + 1);
                if (file === '-') {
                  result.hasDynamicInput = true;
                } else {
                  result.referencedFiles.push(file);
                }
              } else if (i + 1 < tokens.length) {
                const file = tokens[i + 1];
                if (file === '-') {
                  result.hasDynamicInput = true;
                } else {
                  result.referencedFiles.push(file);
                }
                i++;
              }
            }
            continue;
          }
        }

        return result;
      }
    }
  }

  // Find gh binary in tokens
  if (binary === 'gh') {
    if (cmdIdx + 1 >= tokens.length) {
      return result;
    }

    // Extract repository flag (-R owner/repo, --repo owner/repo, -R=..., --repo=...)
    for (let i = cmdIdx + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if ((token === '-R' || token === '--repo') && i + 1 < tokens.length) {
        result.targetRepo = tokens[i + 1].toLowerCase();
        break;
      }
      if (token.startsWith('--repo=')) {
        result.targetRepo = token.slice('--repo='.length).toLowerCase();
        break;
      }
      if (token.startsWith('-R=') || (token.startsWith('-R') && token.length > 2)) {
        result.targetRepo = token.slice(token.startsWith('-R=') ? 3 : 2).toLowerCase();
        break;
      }
    }

    // Check PR/Issue URLs (https://github.com/owner/repo/pull/123 or issues/123)
    if (!result.targetRepo) {
      for (let i = cmdIdx + 1; i < tokens.length; i++) {
        const token = tokens[i];
        const urlMatch = token.match(/https?:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/(?:pull|issues)\/\d+/i);
        if (urlMatch) {
          result.targetRepo = urlMatch[1].toLowerCase();
          break;
        }
      }
    }

    const sub1 = tokens[cmdIdx + 1];
    const sub2 = cmdIdx + 2 < tokens.length ? tokens[cmdIdx + 2] : '';

    // 1. gh pr create
    if (sub1 === 'pr' && sub2 === 'create') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr create';

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === '--fill' || token === '--fill-first') {
          result.hasDynamicInput = true;
          continue;
        }
        if ((token === '-t' || token === '--title') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('-t') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if (token.startsWith('--title=')) {
          result.extractedTexts.push(token.slice('--title='.length));
          continue;
        }
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
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
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
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
      }
      return result;
    }

    // 2. gh pr edit
    if (sub1 === 'pr' && sub2 === 'edit') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr edit';

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if ((token === '-t' || token === '--title') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('-t') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if (token.startsWith('--title=')) {
          result.extractedTexts.push(token.slice('--title='.length));
          continue;
        }
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
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
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
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
      }
      return result;
    }

    // 3. gh pr review
    if (sub1 === 'pr' && sub2 === 'review') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr review';

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
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
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
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
      }
      return result;
    }

    // 4. gh pr comment
    if (sub1 === 'pr' && sub2 === 'comment') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr comment';

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
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
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
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
      }
      return result;
    }

    // 5. gh issue comment
    if (sub1 === 'issue' && sub2 === 'comment') {
      result.isPublicSurfaceCommand = true;
      result.commandType = 'gh pr comment';

      for (let i = cmdIdx + 3; i < tokens.length; i++) {
        const token = tokens[i];
        if ((token === '-b' || token === '--body') && i + 1 < tokens.length) {
          result.extractedTexts.push(tokens[i + 1]);
          i++;
          continue;
        }
        if (token.startsWith('-b') && token.length > 2) {
          result.extractedTexts.push(token.slice(2));
          continue;
        }
        if (token.startsWith('--body=')) {
          result.extractedTexts.push(token.slice('--body='.length));
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
        if (token.startsWith('-F') && token.length > 2) {
          const file = token.slice(2);
          if (file === '-') {
            result.hasDynamicInput = true;
          } else {
            result.referencedFiles.push(file);
          }
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
      }
      return result;
    }

    // 6. gh api
    if (sub1 === 'api') {
      const isGraphql = tokens.some((t) => t === 'graphql' || t.includes('/graphql'));

      for (let i = cmdIdx + 2; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.startsWith('repos/')) {
          const parts = token.slice('repos/'.length).split('/');
          if (parts.length >= 2) {
            result.targetRepo = `${parts[0]}/${parts[1]}`.toLowerCase();
          }
          break;
        }
        if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/.test(token) && !token.startsWith('-')) {
          result.targetRepo = token.toLowerCase();
          break;
        }
      }

      for (let i = cmdIdx + 2; i < tokens.length; i++) {
        const token = tokens[i];

        // --input <file>, --input=<file>
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

        // -f <name>=<val>, -F <name>=<val>, --field <name>=<val>, --raw-field <name>=<val>
        if ((token === '-f' || token === '-F' || token === '--field' || token === '--raw-field') && i + 1 < tokens.length) {
          const fieldArg = tokens[i + 1];
          const eqIdx = fieldArg.indexOf('=');
          if (eqIdx !== -1) {
            const fieldName = fieldArg.slice(0, eqIdx);
            const val = fieldArg.slice(eqIdx + 1);

            // In GraphQL, inspect EVERY field argument (variables, query, etc.)
            // In REST calls, inspect body and title
            if (isGraphql || fieldName === 'body' || fieldName === 'title' || fieldName === 'query') {
              if (val.startsWith('@')) {
                result.referencedFiles.push(val.slice(1));
              } else {
                result.extractedTexts.push(val);
              }
            }
          }
          i++;
          continue;
        }

        const fieldMatch = token.match(/^(?:--field|--raw-field)=(.*?)=(.*)$/s);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          const val = fieldMatch[2];
          if (isGraphql || fieldName === 'body' || fieldName === 'title' || fieldName === 'query') {
            if (val.startsWith('@')) {
              result.referencedFiles.push(val.slice(1));
            } else {
              result.extractedTexts.push(val);
            }
          }
          continue;
        }

        if (isGraphql && token.includes('mutation')) {
          result.extractedTexts.push(token);
          result.isGraphqlMutation = true;
        }
      }

      // Check if GraphQL query string specifies a mutation
      if (isGraphql) {
        for (const t of result.extractedTexts) {
          if (/\bmutation\b/i.test(t)) {
            result.isGraphqlMutation = true;
            break;
          }
        }
      }

      if (result.extractedTexts.length > 0 || result.referencedFiles.length > 0 || result.hasDynamicInput || result.isGraphqlMutation) {
        result.isPublicSurfaceCommand = true;
        result.commandType = 'gh api';
      }

      return result;
    }
  }

  return result;
}

/**
 * Inspects a directory's .git/config to determine if it points to tracker_repo or upstream_repo.
 * Strict exact owner/repo slug matching is enforced (no substring .includes).
 * If both remotes exist, upstream takes precedence.
 */
export async function inspectDirectoryRemote(
  dir: string | undefined,
  projectConfig: ProjectRepos,
  readFile?: FileReader
): Promise<{ isTracker: boolean; isUpstream: boolean; determined: boolean; detectedUpstreamSlug?: string }> {
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

    const extractSlugFromUrl = (url: string): string | undefined => {
      if (!url) return undefined;
      const cleanUrl = url.toLowerCase().replace(/\.git$/, '');
      const match = cleanUrl.match(/(?:[:/])([a-z0-9_.-]+\/[a-z0-9_.-]+)$/);
      return match ? match[1] : undefined;
    };

    let detectedUpstreamSlug: string | undefined = undefined;
    for (const u of urls) {
      const s = extractSlugFromUrl(u);
      if (s && s !== trackerSlug) {
        detectedUpstreamSlug = s;
        break;
      }
    }

    // Upstream match takes precedence over tracker match
    const isUpstream = upstreamSlug
      ? urls.some((u) => {
          const extracted = extractSlugFromUrl(u);
          return extracted === upstreamSlug || (upstreamRepoName && extracted?.endsWith(`/${upstreamRepoName}`));
        })
      : false;

    const isTracker = !isUpstream && trackerSlug
      ? urls.some((u) => {
          const extracted = extractSlugFromUrl(u);
          return extracted === trackerSlug || (trackerRepoName && extracted?.endsWith(`/${trackerRepoName}`));
        })
      : false;

    return {
      isTracker,
      isUpstream,
      determined: true,
      detectedUpstreamSlug,
    };
  } catch {
    return { isTracker: false, isUpstream: false, determined: false };
  }
}

export interface EvaluationOptions {
  env?: { [key: string]: string | undefined };
  readFile?: FileReader;
  projectConfig?: ProjectRepos;
}

/**
 * Generates user-facing blocking reason without instructing agent how to bypass.
 */
export function generateBlockingReason(commandType: string, terms: string[]): string {
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
 * Evaluates whether a public-surface command violates embargo terms.
 * Evaluates per subcommand, respects project.md config for tracker/upstream resolution,
 * tracks cd directory transitions across subcommands, fails closed on unreadable files,
 * dynamic pipelines, and indeterminate repositories, and honours only human-set environment escape hatches.
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

  // Split command line into individual subcommands preserving operators
  const subcommands = splitShellSubcommands(commandLine);

  let virtualCwd: string | undefined = undefined;
  const seenRedirectedFiles = new Set<string>();

  for (const item of subcommands) {
    const rawSub = item.raw;
    const parsed = parseSubcommand(rawSub);

    // Track cd transitions: only update virtualCwd across sequential operators (&&, ;, \n)
    if (parsed.cdDir) {
      if (item.separatorAfter === '&&' || item.separatorAfter === ';' || item.separatorAfter === '\n' || !item.separatorAfter) {
        virtualCwd = resolvePath(virtualCwd, parsed.cdDir);
      }
      continue;
    }

    // Check if any referenced file was redirected into earlier in the same composite command
    for (const ref of parsed.referencedFiles) {
      const resolved = resolvePath(virtualCwd, ref);
      if (seenRedirectedFiles.has(resolved) || seenRedirectedFiles.has(ref)) {
        parsed.hasDynamicInput = true;
      }
    }

    // Record newly redirected files from this subcommand
    for (const red of parsed.redirectedFiles) {
      seenRedirectedFiles.add(resolvePath(virtualCwd, red));
      seenRedirectedFiles.add(red);
    }

    if (!parsed.isPublicSurfaceCommand) {
      continue;
    }

    // Resolve git -C relative to virtualCwd, not bare
    const effectiveDir = parsed.gitCwd ? resolvePath(virtualCwd, parsed.gitCwd) : virtualCwd;

    // Resolve project configuration (tracker_repo, upstream_repo, upstream_clone) for this subcommand's scope
    const projectConfig = options?.projectConfig ?? (await resolveProjectConfig(options?.readFile, effectiveDir, options?.env));
    const trackerRepo = projectConfig.trackerRepo?.toLowerCase();
    let upstreamRepo = projectConfig.upstreamRepo?.toLowerCase();

    // 1. Exemption: Subcommand explicitly targets the private security tracker
    if (parsed.targetRepo && trackerRepo && parsed.targetRepo === trackerRepo) {
      continue;
    }

    // 2. Check if working directory is inside the configured upstream_clone path
    let isWorkingDirUpstreamClone = false;
    if (projectConfig.upstreamClonePath) {
      const normClone = projectConfig.upstreamClonePath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const normDir = (effectiveDir || '.').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      if (normDir === normClone || normDir.startsWith(`${normClone}/`)) {
        isWorkingDirUpstreamClone = true;
      }
    }

    // 3. Inspect directory remote from .git/config
    let remoteInfo: { isTracker: boolean; isUpstream: boolean; determined: boolean; detectedUpstreamSlug?: string } = {
      isTracker: false,
      isUpstream: isWorkingDirUpstreamClone,
      determined: isWorkingDirUpstreamClone,
    };

    if (options?.readFile) {
      const inspected = await inspectDirectoryRemote(effectiveDir, projectConfig, options.readFile);
      if (inspected.determined) {
        remoteInfo = inspected;
        if (isWorkingDirUpstreamClone) {
          remoteInfo.isUpstream = true;
        }
      }
      if (!upstreamRepo && remoteInfo.detectedUpstreamSlug) {
        upstreamRepo = remoteInfo.detectedUpstreamSlug.toLowerCase();
      }
    }

    const upstreamRepoName = upstreamRepo?.includes('/') ? upstreamRepo.split('/')[1] : upstreamRepo;

    // 4. Repository scoping: Subcommands targeting upstream or a contributor's fork of upstream must be scrubbed.
    // Subcommands targeting an explicit unrelated repository (e.g. adopter docs, framework) pass unchecked.
    const isTargetUpstreamOrFork =
      parsed.targetRepo &&
      upstreamRepo &&
      (parsed.targetRepo === upstreamRepo ||
        (upstreamRepoName && parsed.targetRepo.endsWith(`/${upstreamRepoName}`)));

    if (parsed.targetRepo && !isTargetUpstreamOrFork) {
      continue;
    }

    // 5. For commands without explicit repo flag, determine repository from git context
    if (!parsed.targetRepo) {
      // GraphQL mutations address resources by global Node IDs, which the hook cannot resolve.
      // Therefore, a GraphQL mutation is NEVER exempt, regardless of whether cwd is the tracker.
      if (parsed.isGraphqlMutation) {
        // Proceed directly to inspection
      } else if (remoteInfo.determined) {
        if (remoteInfo.isTracker) {
          continue; // Safe tracker repository
        }
        if (!remoteInfo.isUpstream) {
          continue; // Known non-upstream remote (e.g. unrelated third-party repo, adopter docs), allow through
        }
      }
    }

    // If dynamic input (stdin -, heredoc, command substitution, variable, pipe, gh pr create --fill, git commit --amend/reuse) is present
    if (parsed.hasDynamicInput) {
      // First check if the commandLine itself explicitly carries forbidden terms
      const dynamicTerms = findForbiddenTerms(commandLine);
      if (dynamicTerms.length > 0) {
        const uniqueTerms = Array.from(new Set(dynamicTerms));
        return {
          blocked: true,
          matchedTerms: uniqueTerms,
          reason: generateBlockingReason(parsed.commandType, uniqueTerms),
        };
      }

      // Dynamic input without explicit terms in command line: fail closed
      return {
        blocked: true,
        matchedTerms: ['dynamic input'],
        reason: `⛔ Apache Magpie Security Guard: Blocked public-surface command (${parsed.commandType}) with indeterminate dynamic input. Content constructed from variables ($VAR), command substitution ($(..)), stdin (-), or automated reuse (--amend/--fill) cannot be verified deterministically before publication. Provide the text explicitly or via an inspectable file (-F <file>).`,
      };
    }

    const candidateTexts: string[] = [...parsed.extractedTexts];

    // Read and verify referenced message files
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

    // Check for forbidden terms
    const combinedText = candidateTexts.join('\n');
    const matched = findForbiddenTerms(combinedText);

    if (matched.length > 0) {
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
 * Registers the PreToolUse hook for Claude Code.
 * Intercepts Bash tool calls, parses commands, verifies embargo terms,
 * and returns { deny: reason } when embargo terms are detected.
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
      const hookEnv = allowBypass ? { MAGPIE_ALLOW_EMBARGO_TERMS: allowBypass } : {};
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
