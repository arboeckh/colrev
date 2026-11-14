"""Write Windows .exe launchers for console_scripts into a bundle's Scripts dir.

Usage: python write_win_launchers.py <bundle>/Scripts <entry_points.txt>

entry_points.txt has one "name<TAB>module:func" line per console script.

Real .exe files, not .cmd shims: Windows CreateProcess only finds .exe, so
colrev's subprocess calls (e.g. check_call(["pre-commit", "install"])) need
them, and Node refuses to spawn .cmd without a shell.

Each launcher is built the way pip builds console scripts: distlib's launcher
(t64.exe, which ships inside pip on every OS), a shebang line, and a zip
holding __main__.py. The shebang uses the launcher's <launcher_dir>
placeholder, so it runs ..\\python.exe relative to the launcher, wherever the
app is installed. Runs on any build host.
"""

import io
import pathlib
import sys
import zipfile

import pip._vendor.distlib as distlib

SHEBANG = b"#!<launcher_dir>\\..\\python.exe\n"

# Same script body as pip/distlib's console-script template.
TEMPLATE = """# -*- coding: utf-8 -*-
import re
import sys
from {module} import {import_name}
if __name__ == "__main__":
    sys.argv[0] = re.sub(r"(-script\\.pyw|\\.exe)?$", "", sys.argv[0])
    sys.exit({func}())
"""


def main() -> None:
    scripts_dir = pathlib.Path(sys.argv[1])
    entries = pathlib.Path(sys.argv[2])
    launcher = (pathlib.Path(distlib.__file__).parent / "t64.exe").read_bytes()
    scripts_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for line in entries.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        name, target = line.split("\t")
        module, func = target.split(":", 1)
        body = TEMPLATE.format(
            module=module, import_name=func.split(".")[0], func=func
        )
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("__main__.py", body)
        (scripts_dir / f"{name}.exe").write_bytes(launcher + SHEBANG + buf.getvalue())
        count += 1
    print(f"wrote {count} launchers to {scripts_dir}")


if __name__ == "__main__":
    main()
