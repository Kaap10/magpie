<!-- SPDX-License-Identifier: Apache-2.0
     https://www.apache.org/licenses/LICENSE-2.0 -->

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Forgejo / Gitea — Project boards](#forgejo--gitea--project-boards)
  - [No GraphQL or board REST API support](#no-graphql-or-board-rest-api-support)
  - [When the board is a no-op](#when-the-board-is-a-no-op)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Forgejo / Gitea — Project boards

This file documents the project board integration for Forgejo/Gitea.

> [!NOTE]
> **Board reconciliation unsupported (No-Op):** Neither Forgejo nor Gitea exposes a stable, released REST or GraphQL API for programmatically managing project boards, columns, or cards (boards are UI-only). Board reconciliation for Forgejo/Gitea trackers is therefore a **no-op**.

## No GraphQL or board REST API support

Unlike GitHub (which supports GraphQL Projects V2), Forgejo and Gitea do not provide API endpoints for moving cards across board columns. Skills interacting with a Forgejo tracker must treat board operations as unsupported and skip board-column reconciliation.

## When the board is a no-op

Not every project runs a project board. For Forgejo-backed adopters, project-board reconciliation is a no-op:
1. Skills skip board status updates and column movements.
2. Tracker state transitions are tracked exclusively through issue labels (`needs triage`, `cve allocated`, `pr created`, `pr merged`, `fix released`, `announced`), milestones, and issue body fields.
3. Sync skills skip board column verification without failing the sync.
