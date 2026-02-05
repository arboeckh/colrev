# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for CoLRev JSON-RPC server.
Build with: pyinstaller colrev_jsonrpc.spec
"""

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

block_cipher = None

# Collect all CoLRev package data and dependencies
datas = []
binaries = []
hiddenimports = []

# Collect all colrev submodules and data files
colrev_datas, colrev_binaries, colrev_hiddenimports = collect_all('colrev')
datas += colrev_datas
binaries += colrev_binaries
hiddenimports += colrev_hiddenimports

# Collect dependencies that have metadata issues or data files
packages_to_collect = [
    'readchar',
    'inquirer',
    'blessed',
    'python-editor',
    'number_parser',
    'bib_dedupe',
    'lingua',
    'pre_commit',  # Bundle pre-commit for data quality hooks
    'identify',    # pre-commit dependency
    'nodeenv',     # pre-commit dependency
    'virtualenv',  # pre-commit dependency
]

for package in packages_to_collect:
    try:
        pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(package)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hiddenimports
    except Exception:
        pass

# Add specific hidden imports that might be missed
hiddenimports += [
    'colrev.ops.init',
    'colrev.review_manager',
    'colrev.settings',
    'colrev.constants',
    'colrev.env.environment_manager',
    'colrev.env.docker_manager',
    'colrev.package_manager.package_manager',
    'git',
    'git.repo',
    'git.exc',
    'readchar',
    'inquirer',
    'blessed',
    'number_parser',
    'bib_dedupe',
    'pre_commit',
    'pre_commit.main',
    'pre_commit.commands',
    'identify',
    'virtualenv',
]

# Collect all packages that CoLRev might dynamically load
hiddenimports += collect_submodules('colrev.packages')
hiddenimports += collect_submodules('colrev.ops')
hiddenimports += collect_submodules('colrev.env')
hiddenimports += collect_submodules('colrev.record')
hiddenimports += collect_submodules('readchar')
hiddenimports += collect_submodules('inquirer')
hiddenimports += collect_submodules('bib_dedupe')
hiddenimports += collect_submodules('number_parser')
hiddenimports += collect_submodules('pre_commit')
hiddenimports += collect_submodules('identify')

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude unnecessary packages to reduce size
        'matplotlib',
        'IPython',
        'jupyter',
        'notebook',
        'tkinter',
        'PyQt5',
        'PySide2',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='colrev-jsonrpc',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
