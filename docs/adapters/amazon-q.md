<!-- SPDX-License-Identifier: Apache-2.0
     https://www.apache.org/licenses/LICENSE-2.0 -->

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Amazon Q Developer CLI agent harness](#amazon-q-developer-cli-agent-harness)
  - [Harness contract](#harness-contract)
  - [Skill wrapping and execution](#skill-wrapping-and-execution)
    - [JSON wrapper pattern](#json-wrapper-pattern)
  - [Tool bridges and command execution](#tool-bridges-and-command-execution)
  - [Human-in-the-loop and security boundaries](#human-in-the-loop-and-security-boundaries)
    - [Sandbox parity (Trust Prompts)](#sandbox-parity-trust-prompts)
  - [Clean-environment wrapper and isolation](#clean-environment-wrapper-and-isolation)
  - [Verify](#verify)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

<!-- SPDX-License-Identifier: Apache-2.0
     https://www.apache.org/licenses/LICENSE-2.0 -->

# Amazon Q Developer CLI agent harness

**Capability:** capability:platform

**Harness:** Amazon Q

[Amazon Q Developer CLI](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line.html) is the official agentic CLI provided by AWS. It is frequently deployed as the primary or exclusively sanctioned LLM tooling in corporate, federal, and highly regulated environments where third-party cloud agents are restricted.
This guide documents how Amazon Q operates as an agent harness for Apache Magpie, fulfilling [#320](https://github.com/apache/magpie/issues/320) and demonstrating [RFC-AI-0004 Principle 3 (Vendor Neutrality)](../rfcs/RFC-AI-0004.md).

## Harness contract

| Magpie requirement | Amazon Q CLI implementation |
|---|---|
| Skill discovery | Does **not** read Markdown natively. Skills are loaded via JSON config wrapper at `~/.aws/amazonq/agents/`. |
| Action guard | ❌ **none** (Relies on native interactive confirmation). |
| OS-level sandbox | `agent-iso q` strips background credentials (Layer 0). |
| Command permission | Q's native `toolsSettings.write.allowedPaths` / trust prompts. |
| Tool bridges | Custom tools defined directly within the JSON wrapper payload. |

## Skill wrapping and execution

Amazon Q configures its custom agents using a strict JSON format in the global user directory (`~/.aws/amazonq/agents/<name>.json`), and cannot natively parse Magpie's Markdown-based `.agents/skills/<name>/SKILL.md` skill trees.

Instead of duplicating the underlying logic, Magpie skills are bridged into Q via the **Wrapper Pattern**. Administrators create a JSON configuration that passes the repository context and explicitly defines a tool to invoke the framework.

### JSON wrapper pattern

To load the Magpie framework into Q, create `~/.aws/amazonq/agents/magpie.json`.

> **Note:** The exact tool identifiers (e.g., `shell`, `bash`, `run_command`) and schema keys may vary based on the Q Developer CLI version. The following is an illustrative mapping demonstrating how to bind Magpie's execution model to Q's native JSON configuration.

```json
{
  "name": "Magpie Triage Agent",
  "description": "Executes Apache Magpie security and triage workflows.",
  "systemPrompt": "You are executing a Magpie workflow. Delegate tasks using the bash tool.",
  "allowedTools": ["bash", "read", "write"],
  "toolsSettings": {
    "bash": {
      "description": "Execute framework commands (e.g., uv run --project tools/...)",
      "allowedCommands": ["uv", "git", "gh"]
    },
    "write": {
      "allowedPaths": ["*"]
    }
  }
}
```

Start an interactive session:

```bash
q agent --agent-name "Magpie Triage Agent"
```

## Tool bridges and command execution

When Q invokes a tool, it uses paths relative to the current working directory (`CWD`). Ensure you launch `q` from the root of the Magpie repository so relative script calls map cleanly.

## Human-in-the-loop and security boundaries

### Sandbox parity (Trust Prompts)

Magpie's canonical security profile defaults to blocking unrestricted execution (e.g., `Bash(curl *)`). Amazon Q does not integrate with Magpie's pre-execution hook (`tools/agent-guard`). Instead, it relies on its own interactive mechanism.

When the agent attempts to run a command or modify a file, Q pauses and prompts the user for explicit confirmation ("trust"). **This satisfies Magpie's "draft before send" constraint.** Triagers must actively review the shell payload before approving it. Any permissive flags that auto-approve commands must remain disabled when handling embargoed vulnerability workflows.

## Clean-environment wrapper and isolation

Execute Q through the `agent-iso` launcher to apply Layer 0 isolation, scrubbing ambient credentials from the subshell:

```bash
source tools/agent-isolation/agent-iso.sh
agent-iso q agent --agent-name "Magpie Triage Agent"
```

As documented in [`tools/agent-isolation`](../../tools/agent-isolation/README.md), this wrapper strips global AWS, GCP, and GitHub tokens, preventing the LLM from inadvertently persisting or leveraging operator credentials.

## Verify

All framework tools require a clean topological layout. Since Amazon Q employs the Wrapper Pattern, no symlinks are created in `.agents/skills/`.

```bash
uv run --project tools/symlink-lint symlink-lint
uv run --project tools/vendor-neutrality-score vendor-neutrality-score --markdown
```
