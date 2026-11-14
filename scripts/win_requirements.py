"""Resolve requirements.txt for the Windows bundle, whatever the build host is.

pip evaluates environment markers (`sys_platform == 'win32'`) against the
interpreter that runs it, not against `--platform win_amd64`. On a macOS or
Linux host, a cross-install therefore skips every Windows-only requirement
(colorama, jinxed, ...) and the packaged app fails with ModuleNotFoundError.

Usage:
    win_requirements.py filter <requirements.txt> <out.txt> [python-version]
        Write the requirements that apply to Windows x64, markers removed.
    win_requirements.py verify <requirements.txt> <site-packages> [python-version]
        Exit 1 unless every requirement that applies to Windows has a
        *.dist-info in <site-packages>.

Runs on any host; needs only pip (which vendors `packaging`).
"""

import sys
from pathlib import Path

try:
    from packaging.markers import default_environment
    from packaging.requirements import Requirement
    from packaging.utils import canonicalize_name
except ImportError:  # pip vendors packaging
    from pip._vendor.packaging.markers import default_environment
    from pip._vendor.packaging.requirements import Requirement
    from pip._vendor.packaging.utils import canonicalize_name


def windows_environment(python_version: str) -> dict[str, str]:
    env = dict(default_environment())
    env.update(
        {
            "os_name": "nt",
            "sys_platform": "win32",
            "platform_system": "Windows",
            "platform_machine": "AMD64",
            "platform_release": "10",
            "platform_python_implementation": "CPython",
            "implementation_name": "cpython",
            "python_version": python_version,
            "python_full_version": f"{python_version}.0",
        }
    )
    return env


def windows_requirements(path: Path, python_version: str) -> list[Requirement]:
    """Requirements from `path` whose marker (if any) is true for Windows."""
    env = windows_environment(python_version)
    requirements = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", "-")):
            continue
        requirement = Requirement(line)
        if requirement.marker is None or requirement.marker.evaluate(env):
            requirements.append(requirement)
    return requirements


def filter_requirements(src: Path, dest: Path, python_version: str) -> None:
    lines = []
    for requirement in windows_requirements(src, python_version):
        requirement.marker = None
        lines.append(str(requirement))
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(lines)} requirements apply to Windows")


def verify_requirements(src: Path, site_packages: Path, python_version: str) -> int:
    installed = {
        canonicalize_name(d.name.removesuffix(".dist-info").rsplit("-", 1)[0])
        for d in site_packages.glob("*.dist-info")
    }
    missing = sorted(
        str(r.name)
        for r in windows_requirements(src, python_version)
        if canonicalize_name(r.name) not in installed
    )
    if missing:
        print(
            f"Windows bundle lacks {len(missing)} required package(s) in "
            f"{site_packages}: {', '.join(missing)}",
            file=sys.stderr,
        )
        return 1
    print(f"All Windows requirements are installed in {site_packages}")
    return 0


def main() -> int:
    if len(sys.argv) < 4 or sys.argv[1] not in ("filter", "verify"):
        print(__doc__, file=sys.stderr)
        return 2
    command, src, target = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    python_version = sys.argv[4] if len(sys.argv) > 4 else "3.12"
    if command == "filter":
        filter_requirements(src, target, python_version)
        return 0
    return verify_requirements(src, target, python_version)


if __name__ == "__main__":
    sys.exit(main())
