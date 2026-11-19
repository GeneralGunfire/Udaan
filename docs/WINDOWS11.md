# Windows 11 (and later) support: scope

Status: **not tested on a real Windows 11 PC.** This PC runs Windows 10 (build 19045), so everything below that
says "should" is reading the code, not a measurement. Windows 11 needs a real test before it is promised.

## The choice people asked for: Udaan dock, or the Windows taskbar

Already built and version-independent: Settings, Dock, "Use the Udaan dock" (`dock.enabled`).
- On: Udaan hides Explorer's taskbar and shows its own dock.
- Off: the Windows taskbar and Start come straight back. `src-tauri/src/engine/explorer.rs` restores them even
  if Udaan is killed (a separate guard process does it).
- It finds the taskbar by window class `Shell_TrayWnd` and `Shell_SecondaryTrayWnd`. Windows 11 keeps both class
  names (its new taskbar is still hosted in them), so the same hide/show works. Explorer re-shows the taskbar after
  it restarts; the tracker already hides it again.

To do: make this a clear choice during first-run ("Use the Udaan dock" or "Keep the Windows taskbar") instead of
only a Settings toggle. Default for new installs: ask.

## What differs on Windows 11, and what to check

| Area | Windows 10 (tested) | Windows 11 (to test) |
|---|---|---|
| Taskbar hide | `Shell_TrayWnd` hidden | same classes; verify it stays hidden after Explorer restart and on multiple monitors |
| Material (Mica/Acrylic) | accent blur fallback, custom glass | `shell/material.rs` already uses the native backdrop on build 22621+; verify the fallback on 22000 to 22620 |
| Rounded window corners | drawn by Udaan | Windows draws them; check there is no double rounding |
| Snap layouts / Win+Z | none | Windows 11 shows its own; check it does not fight the Udaan window manager |
| Win key / Start | Udaan Start | Windows 11 Start must not open as well; check the Win-key hook |
| WebView2 runtime | usually present from Edge | always present; the installer downloads it only if missing |
| Notifications | mirrored from the Windows registry | same path; check the Windows 11 toast database location |
| Widgets / Search / Task View buttons | n/a | live in the Windows taskbar; hidden with it, check they do not reappear |
| Installer | per-user NSIS | same installer should work; test an upgrade over the top |

## Installers

One NSIS installer works on both. The website lists a separate download per Windows version (`site/public/latest.json`,
`installers.10` and `installers.11`). Until behaviour truly diverges, both can point at the same file; the split lets
us ship a Windows 11 only build later without changing the site or the updater (the updater already picks by version).

## "Windows 12" / later

Nothing called Windows 12 exists to test against. The plan is to keep every Windows-version-specific call behind a
build-number check (as `material.rs` does with `RtlGetVersion`), fail soft to the plain path, and add a PC from the
Windows Insider channel once the work above passes on Windows 11.
