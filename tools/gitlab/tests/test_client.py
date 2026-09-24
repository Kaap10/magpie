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

import urllib.error

import pytest

from magpie_gitlab.client import GitLabError, get_json, load_config, quote_path, require

from .conftest import build_mock_response


def test_load_config_default(monkeypatch):
    monkeypatch.delenv("GITLAB_INSTANCE_URL", raising=False)
    monkeypatch.setenv("GITLAB_TOKEN", "token")
    cfg = load_config()
    assert cfg.instance_url == "https://gitlab.com"
    assert cfg.token == "token"


def test_load_config_custom(mock_env):
    cfg = load_config()
    assert cfg.instance_url == "https://gitlab.example.com"
    assert cfg.token == "glpat-test123"


def test_quote_path():
    assert quote_path("group/project") == "group%2Fproject"


def test_require():
    assert require("val", "VAR") == "val"
    with pytest.raises(GitLabError, match="VAR is required"):
        require(None, "VAR")
    with pytest.raises(GitLabError, match="VAR is required"):
        require("", "VAR")


def test_get_json_success(mock_urlopen, mock_env):
    mock_urlopen.return_value = build_mock_response({"key": "value"})
    cfg = load_config()
    res = get_json("https://gitlab.example.com/api", cfg)
    assert res == {"key": "value"}
    req = mock_urlopen.call_args[0][0]
    assert req.headers.get("Authorization") == "Bearer glpat-test123"


def test_get_json_http_error(mock_urlopen, mock_env):
    mock_urlopen.side_effect = urllib.error.HTTPError("url", 404, "Not Found", {}, None)
    cfg = load_config()
    with pytest.raises(GitLabError, match="HTTP 404: Not Found"):
        get_json("https://gitlab.example.com/api", cfg)
