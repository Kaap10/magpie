# SPDX-License-Identifier: Apache-2.0
from pathlib import Path

_original_write_text = Path.write_text

def patch_write_text(self, data, encoding=None, errors=None, newline=None):
    if encoding is None:
        encoding = "utf-8"
    return _original_write_text(self, data, encoding=encoding, errors=errors, newline=newline)

Path.write_text = patch_write_text
