<!-- SPDX-License-Identifier: Apache-2.0
     https://www.apache.org/licenses/LICENSE-2.0 -->

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**

- [GitLab bridge](#gitlab-bridge)
  - [Prerequisites](#prerequisites)
  - [Usage](#usage)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# GitLab bridge

**Capability:** contract:tracker + contract:source-control + contract:change-request

GitLab forge, issue tracker, and merge request bridge for Apache Magpie.
Provides 100% offline-tested, deterministic API access to GitLab instances,
following strict vendor-neutrality rules.

## Prerequisites

- **Runtime:** Python 3.11+ via `uv`.
- **CLIs:** None.
- **Credentials / auth:** `GITLAB_TOKEN` (or `CI_JOB_TOKEN`) environment variable with API access.
- **Network:** Requires HTTPS access to `GITLAB_INSTANCE_URL` (defaults to `https://gitlab.com`).

## Usage

List open issues for a project:

```bash
uv run --project tools/gitlab magpie-gitlab issue list <project>
```

Get a merge request diff:

```bash
uv run --project tools/gitlab magpie-gitlab mr diff <project> <mr_iid>
```
