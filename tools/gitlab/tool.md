<!-- SPDX-License-Identifier: Apache-2.0
     https://www.apache.org/licenses/LICENSE-2.0 -->

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**

- [GitLab Tool Adapter](#gitlab-tool-adapter)
  - [Operations catalogue](#operations-catalogue)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# GitLab Tool Adapter

Operations catalogue mapping for GitLab tracker and merge requests.

## Operations catalogue

| Operation | GitLab command |
| --- | --- |
| Read issue body | `magpie-gitlab issue get <project> <issue_iid>` |
| List issues | `magpie-gitlab issue list <project>` |
| Read MR | `magpie-gitlab mr get <project> <mr_iid>` |
| MR Diff | `magpie-gitlab mr diff <project> <mr_iid>` |
| CI Status | `magpie-gitlab pipeline status <project> <pipeline_id>` |

*Confidentiality Note*: Never log personal access tokens. All payload
bodies are handled purely in memory and output in JSON format.
