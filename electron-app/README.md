# CoLRev Electron POC

Minimal Electron + Vue.js app demonstrating JSON-RPC integration with CoLRev backend.

## Prerequisites

1. **Build the colrev-jsonrpc executable** (from parent directory):
   ```bash
   cd ..
   pip install pyinstaller
   ./scripts/build_jsonrpc.sh
   # Creates: dist/colrev-jsonrpc
   ```

2. **Node.js 18+** installed

## Setup

```bash
# Install dependencies (downloads dugite Git binaries)
npm install
```

## Development

```bash
# Start in dev mode (hot reload)
npm run dev
```

This opens the Electron app in development mode. The Vue devtools will be available.

## What It Does

1. **Start Backend** - Spawns `colrev-jsonrpc` as a subprocess
   - Configures Git environment using bundled dugite binaries
   - Sets up stdio communication

2. **Ping** - Health check to verify JSON-RPC is working

3. **Init Project** - Creates a new CoLRev literature review project
   - Initializes Git repository
   - Adds 30 example records

4. **Get Status** - Retrieves project status and record counts

## Architecture

```
electron-app/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # Entry point, window creation, IPC
│   │   ├── colrev-backend.ts  # JSON-RPC subprocess manager
│   │   └── git-env.ts  # dugite Git environment setup
│   ├── preload/        # Context bridge
│   │   └── index.ts    # Exposes colrev API to renderer
│   └── renderer/       # Vue.js frontend
│       ├── App.vue     # Test UI
│       ├── main.ts     # Vue entry
│       └── index.html
├── electron.vite.config.ts
└── package.json
```

## Build for Distribution

```bash
# Build
npm run build

# Package for current platform
npm run package

# Platform-specific
npm run package:mac
npm run package:win
npm run package:linux
```

Output in `release/` directory.

## Git Bundling

This app uses [dugite](https://github.com/desktop/dugite) to bundle Git binaries:

- **macOS**: ~50MB Git binaries in `node_modules/dugite/git`
- **Windows**: ~100MB Git binaries
- **Linux**: ~50MB Git binaries

In dev mode the app runs the git in `node_modules/dugite/git`, which dugite's postinstall downloads
for the machine it runs on. Packaged apps must ship git for the *target* instead, so a Windows package
built on macOS or Linux does not carry macOS or Linux git: `scripts/stage_git.sh win|mac` downloads
the target's archive named in dugite's `embedded-git.json` (checksum-verified, cached under
`${COLREV_BUILD_CACHE:-~/.cache/colrev-build}/git`) into `resources/git-win32-x64` or
`resources/git-darwin-arm64`, and electron-builder copies that to `resources/git`. `build_and_package.sh`
and `build_incremental.sh` run it before packaging, then `scripts/check_packaged_git.sh` fails the build
if the packaged git is not a Windows (PE) or macOS (Mach-O) binary.

## Troubleshooting

### Backend fails to start

1. Check colrev-jsonrpc exists:
   ```bash
   ls -la ../dist/colrev-jsonrpc
   ```

2. Test it directly:
   ```bash
   echo '{"jsonrpc":"2.0","method":"ping","params":{},"id":1}' | ../dist/colrev-jsonrpc
   ```

### Git not found

dugite downloads Git binaries on `npm install`. If they're missing:
```bash
rm -rf node_modules
npm install
```

### Init project fails

CoLRev requires Git. Check logs panel in the app for detailed error messages.
The bundled Git from dugite should be automatically configured.
