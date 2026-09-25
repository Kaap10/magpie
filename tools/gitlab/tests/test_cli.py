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

from __future__ import annotations

import json

from magpie_gitlab.cli import main

from .conftest import build_mock_response


def test_cli_issue_get(mock_urlopen, mock_env, monkeypatch, capsys):
    mock_urlopen.return_value = build_mock_response({"id": 1, "title": "CLI Test"})
    monkeypatch.setattr("sys.argv", ["magpie-gitlab", "issue", "get", "group/project", "1"])

    assert main() == 0

    captured = capsys.readouterr()
    res = json.loads(captured.out)
    assert res["title"] == "CLI Test"


def test_cli_repo_get(mock_urlopen, mock_env, monkeypatch, capsys):
    mock_urlopen.return_value = build_mock_response({"id": 99, "name": "repo-test"})
    monkeypatch.setattr("sys.argv", ["magpie-gitlab", "repo", "get", "group/repo-test"])

    assert main() == 0

    captured = capsys.readouterr()
    res = json.loads(captured.out)
    assert res["id"] == 99
    assert res["name"] == "repo-test"


def test_cli_mr_pipelines(mock_urlopen, mock_env, monkeypatch, capsys):
    mock_urlopen.return_value = build_mock_response([{"id": 101, "status": "success"}])
    monkeypatch.setattr("sys.argv", ["magpie-gitlab", "mr", "pipelines", "group/project", "5"])

    assert main() == 0

    captured = capsys.readouterr()
    res = json.loads(captured.out)
    assert len(res) == 1
    assert res[0]["id"] == 101
    assert res[0]["status"] == "success"


def test_cli_issue_list_limit(mock_urlopen, mock_env, monkeypatch, capsys):
    mock_urlopen.return_value = build_mock_response([{"id": 1}, {"id": 2}, {"id": 3}])
    monkeypatch.setattr("sys.argv", ["magpie-gitlab", "issue", "list", "group/project", "--limit", "2"])

    assert main() == 0

    captured = capsys.readouterr()
    res = json.loads(captured.out)
    assert len(res) == 2
    assert res[0]["id"] == 1
    assert res[1]["id"] == 2
