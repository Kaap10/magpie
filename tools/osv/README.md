<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [`tools/osv/`](#toolsosv)
  - [Prerequisites](#prerequisites)
  - [Configuration](#configuration)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

<!-- SPDX-License-Identifier: Apache-2.0
     https://www.apache.org/licenses/LICENSE-2.0 -->

# `tools/osv/`

**Capability:** contract:security-cross-ref

**Kind:** implementation

**Vendor:** OSV.dev

OSV.dev vulnerability cross-reference client. Queries the [OSV.dev REST API v1](https://api.osv.dev/v1/) for vulnerability records, aliases (CVE ↔ GHSA ↔ OSV IDs), affected package versions, and commit fix references. Complements [`tools/cve-org/`](../cve-org/) and [`tools/cve-tool-vulnogram/`](../cve-tool-vulnogram/) by providing cross-ecosystem vulnerability records during security triage (`security-issue-triage`), deduplication (`security-issue-deduplicate`), CVE allocation sanity checks (`security-cve-allocate`), and dependency audits (`dependency-audit`). See [`tool.md`](tool.md) for endpoint recipes, payload structures, and confidentiality boundaries.

## Prerequisites

- **Runtime:** None of its own — this directory documents a read-only adapter; queries are `curl` + `jq` recipes (see `tool.md`).
- **CLIs:** `curl` and `jq`.
- **Credentials / auth:** None — OSV.dev is a public vulnerability database with an open, unauthenticated REST API.
- **Network:** `api.osv.dev` (OSV.dev REST API v1) and `osv.dev` (public web UI).

## Configuration

Adopters select this backend with `<project-config>/project.md` →
`security_cross_ref.tool: osv` when performing automated vulnerability
cross-referencing. The default ecosystem (e.g. `PyPI`, `Maven`, `npm`)
can be configured via `security_cross_ref.ecosystem`.
