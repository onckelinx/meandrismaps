<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/logo-dark.png">
    <img src="design/logo.png" width="128" alt="">
  </picture>
</p>

# Meandris Maps

A fast, local-first desktop mind-mapping tool for macOS, Linux and Windows, by Rik Onckelinx - meandris.ai.

Type a thought, press <kbd>Tab</kbd> for a child and <kbd>Enter</kbd> for a sibling, and keep going. The layout
takes care of itself. No account, no cloud, no internet connection: your maps are ordinary files on your computer.

- Keyboard-first creation with automatic, animated layout
- Classic tapered branches, branch colours, boundaries ("clouds")
- Free images and images attached to topics
- Collapse/expand, drag to reorganise, find
- Markdown import and export (works with Meandris Write)
- Native `.meandrismap` files with crash recovery
- Export to SVG, PNG and JPEG; printing, including across several pages

## Download

Get the latest version from the [Releases page](../../releases/latest):

| System | File |
| --- | --- |
| Windows 10 and 11 (64-bit) | `meandrismaps-…-windows-x64-setup.exe` |
| macOS 11 or later, Apple Silicon (M1 and newer) | `meandrismaps-…-macos-arm64.dmg` |
| Fedora, RHEL, openSUSE and other RPM-based Linux | `meandrismaps-….x86_64.rpm` |
| Ubuntu 22.04+, Debian 12+, Linux Mint and other Debian-based Linux | `meandrismaps_…_amd64.deb` |
| Other Linux (no installation) | `meandrismaps-…-x86_64.AppImage` |

### The installers are not signed

Meandris Maps is a free, open-source project. I don't pay for an Apple Developer account or a Windows
code-signing certificate, so **the installers are unsigned**. That means your system can't confirm who made
them and will warn you the first time. The app itself is exactly what's built from the source code in this
repository, and it never connects to the internet.

If you'd rather not trust a downloaded installer, you can check it against the SHA-256 checksum shown next to
each file on the Releases page, or [build it yourself](#building-from-source).

What to expect, and how to get past the warning:

**Windows.** Run the setup `.exe`. Microsoft Defender SmartScreen shows *"Windows protected your PC"*. Click
**More info**, then **Run anyway**. The installer lets you install for just yourself or for all users. On an
administrator account, Windows asks for permission as soon as the installer starts, even if you then install
just for yourself. If WebView2 is missing (rare: it's part of Windows 11 and of an up-to-date Windows 10),
the installer downloads it.

**macOS.** Open the `.dmg` and drag Meandris Maps to Applications. The first time you open it, macOS says it
can't verify the app. Click **Done**, then go to **System Settings → Privacy & Security**, scroll down, click
**Open Anyway** next to the message about Meandris Maps, and confirm. You only need to do this once.
Alternatively, in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Meandris Maps.app"
```

**Linux.** The packages are not GPG-signed, so install the downloaded file directly:

```bash
sudo dnf install ./meandrismaps-*.rpm    # Fedora / RHEL
sudo apt install ./meandrismaps_*.deb    # Ubuntu / Debian / Mint
```

For the AppImage: `chmod +x meandrismaps-*.AppImage`, then run it. On Ubuntu it may need `libfuse2`
(`sudo apt install libfuse2t64` on 24.04 and later, `libfuse2` on 22.04).

## Building from source

Requirements: Node 22.12+, Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS.

On Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel
sudo dnf group install c-development
```

On Windows 10/11 (PowerShell):

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup
winget install --id OpenJS.NodeJS.LTS
```

On macOS: `xcode-select --install`, then install [Rust](https://rustup.rs) and [Node](https://nodejs.org).

Then:

```bash
npm install
npm run tauri dev        # run the desktop app with hot reload
npm test                 # unit tests
npm run typecheck        # TypeScript
npm run tauri build      # release build + installer for the current OS
```

`npm run tauri build` creates the installer for the OS you're on, in `src-tauri/target/release/bundle/`:
an NSIS setup `.exe` on Windows, `.app`/`.dmg` on macOS, and `.deb`/`.rpm`/AppImage on Linux.

`npm run dev` runs the same app in a normal browser at http://localhost:1420. Saving downloads the file
there, which is handy for quick UI work.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organised and why
- [docs/FILE_FORMAT.md](docs/FILE_FORMAT.md): the `.meandrismap` format
- [docs/SHORTCUTS.md](docs/SHORTCUTS.md): keyboard shortcuts

## Feedback

Found a bug or have an idea? Please open an [issue](../../issues). For a bug, mention your system, the
Meandris Maps version (Help → About) and the steps that lead to it.

## License

GPL-3.0-or-later (GNU General Public License v3 or later). See [LICENSE](LICENSE). The bundled Inter font is licensed under the SIL Open Font License.
