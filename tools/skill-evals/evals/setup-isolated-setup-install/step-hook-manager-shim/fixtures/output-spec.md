<!-- SPDX-License-Identifier: Apache-2.0
     https://www.apache.org/licenses/LICENSE-2.0 -->

## Output format

Return ONLY valid JSON with this structure:

```json
{
  "dispatcher_installed": true | false,
  "installed_shims": ["<tool>", ...]
}
```

- `dispatcher_installed`: whether the proposal installs `~/.claude/git-hooks/git-hook-dispatcher.sh` and hook symlinks.
- `installed_shims`: lists every hook-manager binary copied to `~/.claude/bin/<tool>`. When multiple shims are installed, list them sorted alphabetically.
- Per Step P.3b item 2:
  - Copy `tools/agent-isolation/hook-manager-shim.sh` into `~/.claude/bin/<tool>` once for each adapter in the hook-manager registry with an install strategy other than `none` that a repository the operator works in uses — `~/.claude/bin/prek` today.
  - A manager whose install strategy is `none` needs no install fix and gets no shim.
  - Only install a shim for an adapter that a repository the operator works in uses.
  - If the operator only works in repositories using managers with `strategy: "none"` (such as `simple-git-hooks`, `cargo-husky`, `git-build-hook`, or `git-code-format-maven-plugin`), or no hook managers, `installed_shims` must be `[]`.
- Do not include any text outside the JSON object.
