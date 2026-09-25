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

import urllib.error
import urllib.request as _ur
from email.message import Message

import pytest

from magpie_gitlab.client import (
    GitLabError,
    _SafeRedirectHandler,
    get_json,
    get_paged_json,
    get_project,
    load_config,
    quote_path,
    require,
)

from .conftest import build_mock_response

# ---------------------------------------------------------------------------
# load_config
# ---------------------------------------------------------------------------


def test_load_config_default(monkeypatch):
    monkeypatch.delenv("GITLAB_INSTANCE_URL", raising=False)
    monkeypatch.delenv("CI_JOB_TOKEN", raising=False)
    monkeypatch.setenv("GITLAB_TOKEN", "token")
    cfg = load_config()
    assert cfg.instance_url == "https://gitlab.com"
    assert cfg.token == "token"
    assert cfg.token_type == "bearer"


def test_load_config_ci_job_token(monkeypatch):
    """CI_JOB_TOKEN should be used when GITLAB_TOKEN is absent."""
    monkeypatch.delenv("GITLAB_INSTANCE_URL", raising=False)
    monkeypatch.delenv("GITLAB_TOKEN", raising=False)
    monkeypatch.setenv("CI_JOB_TOKEN", "ci-job-tok-456")
    cfg = load_config()
    assert cfg.token == "ci-job-tok-456"
    assert cfg.token_type == "job_token"


def test_load_config_gitlab_token_takes_precedence(monkeypatch):
    """GITLAB_TOKEN wins when both are set."""
    monkeypatch.delenv("GITLAB_INSTANCE_URL", raising=False)
    monkeypatch.setenv("GITLAB_TOKEN", "pat-wins")
    monkeypatch.setenv("CI_JOB_TOKEN", "ci-loses")
    cfg = load_config()
    assert cfg.token == "pat-wins"
    assert cfg.token_type == "bearer"


def test_load_config_insecure_url(monkeypatch):
    monkeypatch.setenv("GITLAB_TOKEN", "token")
    monkeypatch.setenv("GITLAB_INSTANCE_URL", "http://gitlab.insecure.com")
    with pytest.raises(
        GitLabError,
        match="Insecure instance URL scheme 'http': HTTPS is required",
    ):
        load_config()


def test_load_config_localhost_http_allowed(monkeypatch):
    """HTTP is allowed for localhost (local dev / testing)."""
    monkeypatch.setenv("GITLAB_TOKEN", "token")
    monkeypatch.setenv("GITLAB_INSTANCE_URL", "http://localhost:8080")
    cfg = load_config()
    assert cfg.instance_url == "http://localhost:8080"


def test_load_config_custom(mock_env):
    cfg = load_config()
    assert cfg.instance_url == "https://gitlab.example.com"
    assert cfg.token == "glpat-test123"


# ---------------------------------------------------------------------------
# quote_path / require
# ---------------------------------------------------------------------------


def test_quote_path():
    assert quote_path("group/project") == "group%2Fproject"


def test_require():
    assert require("val", "VAR") == "val"
    with pytest.raises(GitLabError, match="VAR is required"):
        require(None, "VAR")
    with pytest.raises(GitLabError, match="VAR is required"):
        require("", "VAR")


# ---------------------------------------------------------------------------
# get_json -- bearer token
# ---------------------------------------------------------------------------


def test_get_json_success(mock_urlopen, mock_env):
    mock_urlopen.return_value = build_mock_response({"key": "value"})
    cfg = load_config()
    res = get_json("https://gitlab.example.com/api", cfg)
    assert res == {"key": "value"}
    req = mock_urlopen.call_args[0][0]
    assert req.headers.get("Authorization") == "Bearer glpat-test123"


def test_get_json_http_error(mock_urlopen, mock_env):
    mock_urlopen.side_effect = urllib.error.HTTPError("url", 404, "Not Found", Message(), None)
    cfg = load_config()
    with pytest.raises(GitLabError, match="HTTP 404: Not Found"):
        get_json("https://gitlab.example.com/api", cfg)


# ---------------------------------------------------------------------------
# get_json -- JOB-TOKEN header
# ---------------------------------------------------------------------------


def test_get_json_job_token_header(mock_urlopen, monkeypatch):
    """When CI_JOB_TOKEN is used, the request must carry JOB-TOKEN."""
    monkeypatch.delenv("GITLAB_TOKEN", raising=False)
    monkeypatch.setenv("CI_JOB_TOKEN", "job-tok-789")
    monkeypatch.setenv("GITLAB_INSTANCE_URL", "https://gitlab.example.com")
    mock_urlopen.return_value = build_mock_response({"job": "ok"})
    cfg = load_config()
    res = get_json("https://gitlab.example.com/api", cfg)
    assert res == {"job": "ok"}
    req = mock_urlopen.call_args[0][0]
    assert req.headers.get("Job-token") == "job-tok-789"
    assert "Authorization" not in req.headers


# ---------------------------------------------------------------------------
# get_paged_json -- pagination
# ---------------------------------------------------------------------------


def test_get_paged_json_single_page(mock_urlopen, mock_env):
    mock_urlopen.return_value = build_mock_response([{"id": 1}], headers={"X-Next-Page": ""})
    cfg = load_config()
    items = get_paged_json("https://gitlab.example.com/api/v4/projects/test/issues", cfg)
    assert items == [{"id": 1}]
    assert mock_urlopen.call_count == 1


def test_get_paged_json_multi_page(mock_urlopen, mock_env):
    page1 = build_mock_response([{"id": 1}], headers={"X-Next-Page": "2"})
    page2 = build_mock_response([{"id": 2}], headers={"X-Next-Page": ""})
    mock_urlopen.side_effect = [page1, page2]

    cfg = load_config()
    items = get_paged_json("https://gitlab.example.com/api/v4/projects/test/issues", cfg)
    assert items == [{"id": 1}, {"id": 2}]
    assert mock_urlopen.call_count == 2


# ---------------------------------------------------------------------------
# get_project
# ---------------------------------------------------------------------------


def test_get_project(mock_urlopen, mock_env):
    mock_urlopen.return_value = build_mock_response({"id": 42, "name": "my-project"})
    cfg = load_config()
    project = get_project("group/my-project", cfg)
    assert project == {"id": 42, "name": "my-project"}
    req = mock_urlopen.call_args[0][0]
    assert req.full_url == "https://gitlab.example.com/api/v4/projects/group%2Fmy-project"


# ---------------------------------------------------------------------------
# SafeRedirectHandler
# ---------------------------------------------------------------------------


def test_safe_redirect_blocks_https_to_http():
    """HTTPS->HTTP downgrade must be blocked."""
    handler = _SafeRedirectHandler()
    req = _ur.Request("https://gitlab.example.com/api")
    with pytest.raises(GitLabError, match="HTTPS-to-HTTP downgrade"):
        handler.redirect_request(req, None, 302, "Found", {}, "http://gitlab.example.com/api")


def test_safe_redirect_blocks_cross_origin():
    """Cross-origin redirect must be blocked."""
    handler = _SafeRedirectHandler()
    req = _ur.Request("https://gitlab.example.com/api")
    with pytest.raises(GitLabError, match="cross-origin redirect"):
        handler.redirect_request(req, None, 302, "Found", {}, "https://evil.example.com/steal")


def test_safe_redirect_allows_same_origin():
    """Same-origin same-scheme redirect should be allowed."""
    handler = _SafeRedirectHandler()
    req = _ur.Request("https://gitlab.example.com/api/old")
    result = handler.redirect_request(req, None, 302, "Found", {}, "https://gitlab.example.com/api/new")
    assert result is not None
