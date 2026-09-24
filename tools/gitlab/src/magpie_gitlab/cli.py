# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

import argparse
import json
import sys

from .client import load_config
from .issues import get_issue, list_issues
from .merge_requests import get_mr, get_mr_commits, get_mr_diff, list_mrs
from .pipelines import get_pipeline_status


def main() -> int:
    parser = argparse.ArgumentParser(description="GitLab CLI for Magpie")
    subparsers = parser.add_subparsers(dest="command")

    # repo
    repo_p = subparsers.add_parser("repo")
    repo_subs = repo_p.add_subparsers(dest="action")
    repo_get = repo_subs.add_parser("get")
    repo_get.add_argument("project")

    # issue
    issue_p = subparsers.add_parser("issue")
    issue_subs = issue_p.add_subparsers(dest="action")
    issue_list = issue_subs.add_parser("list")
    issue_list.add_argument("project")
    issue_list.add_argument("--state", default="opened")
    issue_get = issue_subs.add_parser("get")
    issue_get.add_argument("project")
    issue_get.add_argument("issue_iid")

    # mr
    mr_p = subparsers.add_parser("mr")
    mr_subs = mr_p.add_subparsers(dest="action")
    mr_list = mr_subs.add_parser("list")
    mr_list.add_argument("project")
    mr_list.add_argument("--state", default="opened")
    mr_get = mr_subs.add_parser("get")
    mr_get.add_argument("project")
    mr_get.add_argument("mr_iid")
    mr_diff = mr_subs.add_parser("diff")
    mr_diff.add_argument("project")
    mr_diff.add_argument("mr_iid")
    mr_commits = mr_subs.add_parser("commits")
    mr_commits.add_argument("project")
    mr_commits.add_argument("mr_iid")

    # pipeline
    pipe_p = subparsers.add_parser("pipeline")
    pipe_subs = pipe_p.add_subparsers(dest="action")
    pipe_status = pipe_subs.add_parser("status")
    pipe_status.add_argument("project")
    pipe_status.add_argument("pipeline_id")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return 1

    try:
        config = load_config()
        res = None
        if args.command == "issue":
            if args.action == "list":
                res = list_issues(args.project, config, args.state)
            elif args.action == "get":
                res = get_issue(args.project, args.issue_iid, config)
        elif args.command == "mr":
            if args.action == "list":
                res = list_mrs(args.project, config, args.state)
            elif args.action == "get":
                res = get_mr(args.project, args.mr_iid, config)
            elif args.action == "diff":
                res = get_mr_diff(args.project, args.mr_iid, config)
            elif args.action == "commits":
                res = get_mr_commits(args.project, args.mr_iid, config)
        elif args.command == "pipeline" and args.action == "status":
            res = get_pipeline_status(args.project, args.pipeline_id, config)

        print(json.dumps(res, indent=2))
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
