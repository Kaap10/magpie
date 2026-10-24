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
"""Probe 3 reports container runtime status, and writes no file.

Inside the sandbox /tmp is read-only. The probe holds any error output in a
variable rather than redirecting to a file under /tmp.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

PROBE = Path(__file__).resolve().parents[1] / "scripts" / "probe-3-container-gateway.sh"
OLD_PODMAN_ERR = Path("/tmp/podman-probe.err")
OLD_DOCKER_ERR = Path("/tmp/docker-probe.err")


def _find_bash() -> str | None:
    if os.name == "nt":
        for candidate in [
            Path("C:/Program Files/Git/bin/bash.exe"),
            Path("C:/Program Files/Git/usr/bin/bash.exe"),
            Path("C:/Program Files (x86)/Git/bin/bash.exe"),
        ]:
            if candidate.is_file():
                return str(candidate)
        w = shutil.which("bash")
        if w and "system32" not in w.lower():
            return w
        return None
    return shutil.which("bash") or "bash"


def _to_posix(path: Path | str) -> str:
    s = Path(path).as_posix()
    if os.name == "nt" and len(s) >= 2 and s[1] == ":":
        return f"/{s[0].lower()}{s[2:]}"
    return s


class ProbeThreeContainerGateway(unittest.TestCase):
    def setUp(self) -> None:
        self.bash = _find_bash()
        if not self.bash:
            self.skipTest("bash is not available on this platform")
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.addCleanup(self._tmp.cleanup)

    def fake_cmd(self, name: str, body: str = "exit 0\n") -> Path:
        script = self.bin / name
        script.write_text(f"#!/bin/sh\n{body}")
        script.chmod(script.stat().st_mode | stat.S_IXUSR)
        return script

    def run_probe(self, env_overrides: dict[str, str] | None = None) -> str:
        env = {
            "PATH": f"{self.bin}{os.pathsep}{os.environ.get('PATH', '')}",
            "TMPDIR": str(self.tmp),
            "HOME": str(self.tmp),
            **(env_overrides or {}),
        }
        if os.name == "nt":
            posix_bin = _to_posix(self.bin)
            posix_probe = _to_posix(PROBE)
            cmd = [self.bash, "-c", f'PATH="{posix_bin}:$PATH" bash "{posix_probe}"']
            result = subprocess.run(
                cmd, env=env, capture_output=True, text=True, encoding="utf-8", check=True
            )
        else:
            result = subprocess.run(
                [self.bash, str(PROBE)],
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=True,
            )
        return result.stdout.strip()

    def test_runtimes_not_on_path(self) -> None:
        # Run with an isolated PATH containing only essential shell commands if possible
        # but without podman or docker
        out = self.run_probe(
            {
                "PATH": str(self.bin),
                "CONTAINER_HOST": "",
                "DOCKER_HOST": "",
            }
        )
        self.assertIn("PROBE: podman-runtime → ⊘ (podman not on PATH)", out)
        self.assertIn("PROBE: docker-runtime → ⊘ (docker not on PATH)", out)

    def test_host_env_unset(self) -> None:
        self.fake_cmd("podman")
        out = self.run_probe({"CONTAINER_HOST": ""})
        self.assertIn(
            "PROBE: podman-runtime → ✗ (CONTAINER_HOST unset — gateway not wired into settings)",
            out,
        )

    def test_relative_socket_url(self) -> None:
        self.fake_cmd("podman")
        out = self.run_probe({"CONTAINER_HOST": "unix://run/podman.sock"})
        self.assertIn(
            "PROBE: podman-runtime → ✗ (CONTAINER_HOST=unix://run/podman.sock is not absolute",
            out,
        )

    def test_gateway_not_running(self) -> None:
        self.fake_cmd("podman")
        sock = "/var/run/podman.sock"
        out = self.run_probe({"CONTAINER_HOST": f"unix://{sock}"})
        self.assertIn(
            f"PROBE: podman-runtime → ✗ (gateway socket missing at {sock} — container gateway not running)",
            out,
        )

    def test_writes_nothing_under_tmp(self) -> None:
        self.fake_cmd("podman")
        started = time.time()
        self.run_probe({"CONTAINER_HOST": "unix:///var/run/podman.sock"})
        if OLD_PODMAN_ERR.exists():
            self.assertLess(OLD_PODMAN_ERR.stat().st_mtime, started)
        if OLD_DOCKER_ERR.exists():
            self.assertLess(OLD_DOCKER_ERR.stat().st_mtime, started)
        self.assertFalse((self.tmp / "podman-probe.err").exists())
        self.assertFalse((self.tmp / "docker-probe.err").exists())


if __name__ == "__main__":
    unittest.main()
