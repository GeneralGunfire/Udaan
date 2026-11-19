# Windows 11 test checklist (for a friend)

Use the **Windows 11** installer from the Download page. Tick each line; write what you saw if it fails
(a phone photo of the screen is fine).

## Install
- [ ] SmartScreen says "Windows protected your PC": click More info, then Run anyway. Normal, the installer is not signed yet.
- [ ] No Windows 10 warning appears. (If it asks "this PC runs Windows 11 but this is the Windows 10 installer", you got the wrong file.)
- [ ] The Udaan setup window finishes with no error.
- [ ] The setup screen shows its steps, then asks: Udaan dock and top bar, or Keep the Windows taskbar.

## With "Udaan dock and top bar"
- [ ] The Windows taskbar is gone, and stays gone after: sleep and wake, unplug and replug a monitor, Ctrl+Shift+Esc, Restart "Windows Explorer".
- [ ] Windows' own Widgets, Search and Task View buttons do not appear anywhere.
- [ ] Press the Windows key once: only Udaan's Start opens, not Windows' Start.
- [ ] Win+E, Win+D, Win+L, Win+Tab still do what they should.
- [ ] Hover over a window's maximise button: no Windows 11 Snap layout popup fights with Udaan. Win+Z likewise.
- [ ] Window corners look rounded once, not doubled or clipped.
- [ ] The glass dock and top bar look like glass (not a flat grey or black box).
- [ ] Notifications from other apps show up in Udaan.

## With "Keep the Windows taskbar"
- [ ] The Windows taskbar and Start are normal. Udaan's apps still open.
- [ ] Settings > Dock > "Use the Udaan dock" switches between the two, with no restart.

## Stability
- [ ] Leave Udaan on for an hour, open and close ten apps. No crash, no frozen window.
- [ ] Restart the PC: Udaan comes back by itself and the desktop is the same.
- [ ] Settings > Updates > Check: it says you're up to date (or offers an update).

## Uninstall
- [ ] Settings > Apps > Udaan > Uninstall, or run uninstall-udaan.cmd from the website: the Windows taskbar returns.
- [ ] Afterwards there is no Udaan folder in AppData (unless you chose to keep your data).

## What the code review found (nothing here is tested on a real Windows 11)
- Taskbar hiding finds the taskbar by class `Shell_TrayWnd` / `Shell_SecondaryTrayWnd` (`engine/explorer.rs`). Windows 11 keeps those names. It re-hides after Explorer restarts.
- Win key: a low-level keyboard hook swallows it and presses a harmless masking key (`engine/keyboard.rs`). Should work the same.
- Glass: native Mica/Acrylic on build 22621 and up, fallback below (`shell/material.rs`). Builds 22000 to 22620 are the least certain.
- Rounded corners: set through `DWMWA_WINDOW_CORNER_PREFERENCE`; check for double rounding.
