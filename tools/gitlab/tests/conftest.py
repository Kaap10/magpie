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
import urllib.request
from unittest import mock

import pytest


@pytest.fixture
def mock_urlopen(monkeypatch):
    mock_open = mock.MagicMock()
    monkeypatch.setattr(urllib.request, "urlopen", mock_open)
    return mock_open


def build_mock_response(json_data, status=200):
    body = json.dumps(json_data).encode("utf-8")
    resp = mock.MagicMock()
    resp.read.return_value = body
    resp.status = status
    resp.__enter__.return_value = resp
    resp.__exit__.return_value = None
    return resp


@pytest.fixture
def mock_env(monkeypatch):
    monkeypatch.setenv("GITLAB_TOKEN", "glpat-test123")
    monkeypatch.setenv("GITLAB_INSTANCE_URL", "https://gitlab.example.com")
