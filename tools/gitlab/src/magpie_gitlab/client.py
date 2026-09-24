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

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

DEFAULT_TIMEOUT_SECONDS = 30


class GitLabError(Exception):
    pass


@dataclass
class GitLabConfig:
    token: str | None
    instance_url: str


def load_config() -> GitLabConfig:
    return GitLabConfig(
        token=os.environ.get("GITLAB_TOKEN") or os.environ.get("CI_JOB_TOKEN"),
        instance_url=os.environ.get("GITLAB_INSTANCE_URL", "https://gitlab.com").rstrip("/"),
    )


def require(value: str | None, name: str) -> str:
    if not value:
        raise GitLabError(f"{name} is required")
    return value


def quote_path(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def get_json(url: str, config: GitLabConfig) -> Any:
    token = require(config.token, "GITLAB_TOKEN")
    request = urllib.request.Request(
        url, headers={"Accept": "application/json", "Authorization": f"Bearer {token}"}, method="GET"
    )
    try:
        with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise GitLabError(f"HTTP {exc.code}: {exc.reason}") from exc
    except Exception as exc:
        raise GitLabError(f"Request failed: {exc}") from exc
