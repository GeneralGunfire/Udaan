# Udaan Next: hand-off prompt for the main UI/OS work

You are continuing a ground-up rebuild of the Udaan Windows desktop shell. Work in `C:\Udaan` (branch `os-shell-rebuild`). Read first: the approved plan `C:\Users\Gener\.claude\plans\i-cant-lauch-apps-snoopy-pond.md`, the memory index at `C:\Users\Gener\.claude\projects\c--Udaan\memory\MEMORY.md` (especially `user-hardware-ivybridge-displaylink`, `next-shell-target-look`, `udaan-runs-release-build`), then `next/shell/src/main.rs` and `next/shell/src/text.rs`.

## What the user wants
A whole new OS shell, rebuilt from scratch, not incremental fixes. Priorities: extreme performance and hardware efficiency, a clean modern premium look, 3D and refined from-scratch components, good animation. They said they will review how it looks. Never ship hand-drawn fake brand logos (real extracted icons or monograms only). The old Tauri/WebView2 Udaan (`src/`, `src-tauri/`) is read-only reference and the running fallback until cutover; do not patch it. Do not send synthetic keystrokes or kill broad processes in the user's live session.

## Target look (user's reference image, a macOS screenshot)
Top menu bar (app name and menus left, status icons and clock right); a floating, rounded glass dock near the bottom with app icons; desktop widgets top-left (calendar, weather, photo); a full-bleed scenic wallpaper; light and dark mode. It must feel like a proper premium OS with depth, light and good motion.

## Decisions already made
Windows shell foundation running next to Explorer (not a Linux distro, not a kernel). Rust, single process, Windows.UI.Composition hosted on Win32 HWNDs (`windows` crate 0.61, `windows-numerics` 0.2), D3D11 + Direct2D + DirectWrite text into composition surfaces. Scope for now: taskbar/dock, top bar, desktop layer behind the icons, title bars. No apps, Start menu or popups yet.

## Hardware constraints (measured, they shape every design choice)
Intel i5-3470 (2012), 4 cores, 8 GB RAM (about 1.3 GB free), Intel HD DX11.0 only (no D3D12), the only monitor is attached through DisplayLink USB, Windows 10 build 19045 (no Mica; blur via `SetWindowCompositionAttribute`, and DWM blur fills the whole window rectangle so only blur windows whose rectangle is exactly their shape). Static content costs nothing, but ANY continuous 60 fps animation adds kernel/DPC CPU. So: animation is bursty (on interaction, then it stops), no perpetual ambient loops by default, everything idle at about 0% CPU, redraw text only when it changes, springs run on the compositor. Targets: idle working set at most 60 MB (the old shell used 866 MB), idle CPU about 0, zero crashes in a 1-hour soak.

## State of the work (all committed; last commit `bd2c23c`)
- M0 checkpoint, M1 spike (`next/spike`, gate passed: 10 to 20 MB), M2-lite text layer (`next/shell/src/text.rs`: `TextGpu`, `Label`, `Align`).
- M3 taskbar in `next/shell`: one real AppBar per monitor (`SHAppBarMessage` NEW/QUERYPOS/SETPOS), bottom-docked 48 px glass bar with a placeholder "U" tile, five placeholder slots, live clock, spring hover on the tile, auto-hide with a compositor slide (`--autohide`), a hidden core window owning the hotkey/timers/display change/`TaskbarCreated`, DPI-change rebuild, fullscreen-app handling, `--replace` to hide Explorer's taskbar, `--secs N` to self-exit, `--noblur`. Panic exit Ctrl+Alt+Shift+Q. `next/watchdog` restores Explorer's taskbar if the shell dies.
- Verified on this PC: work-area reservation (maximized window stops at the bar's top edge), auto-hide show/hide by screenshot, watchdog after a force-kill, memory about 19 MB working set and 11 MB private, idle CPU 0.
- Written but NOT tested: second monitor, DPI change while running, Explorer-restart recovery, fullscreen-app hiding. Test with care; do not kill the user's Explorer without warning them.
- Known rough edges: `Align::Left` unused warning; bar content is placeholder; the text pipeline allocates a format per `set_text` (fine now, revisit if text updates get frequent).

## Build and test
`cd next && cargo build --release` (workspace members: spike, shell, watchdog). Run `next\target\release\shell.exe --secs 10` (add `--replace` or `--autohide` as needed). Verify with real measurements and screenshots (`CopyFromScreen`), `SPI_GETWORKAREA`, maximizing a test window, `Get-Process` memory/CPU. Write scripts to the scratchpad with the Write tool rather than long inline heredocs. Report what was and was not verified.

## Update 2026-11-14 (read this before the list below)
The user rejected the first dock/top-bar attempt and chose a **scenic wallpaper rendered only in our own desktop layer** (never change their Windows wallpaper setting). Glass over flat grey looks muddy, so the desktop layer + wallpaper + widgets come BEFORE any dock/top-bar polish. Measured reference geometry: 55 px icons, 6 px gaps, 17 px off the bottom, near-invisible plate; top bar is text on a faint darkening with no fill or border; dock magnification is computed directly per mouse move (springs only for enter/exit, no spring storm).

Honest foundation audit: the OS mechanics (AppBar, auto-hide, watchdog, text) are solid, but the engine layer is thin. Do this FIRST (step 0):
- Split `main.rs` into modules (bar, appbar, core window, scene).
- Share ONE Compositor and ONE D3D/D2D device across all bars (each bar currently creates its own).
- Cache DirectWrite text formats; add tokens + theme files with hot reload; add scene primitives (rounded rect, shadow, mask, icon image), hit-testing, and `tools/measure`.
- **(RESOLVED by measurement, see below) Spike rounded blurred glass on Windows 10 before building the dock.** `SetWindowCompositionAttribute` blur fills the whole window rectangle (no rounded corners), and the compositor backdrop brush does not see behind the window on Windows 10. Options to measure: `SetWindowRgn` rounded region (jagged edge), or blurring our own wallpaper slice (correct over our desktop, not over other apps). Pick from numbers and screenshots.
- Test the written-but-untested paths (second monitor, DPI change, Explorer restart) carefully.

## Do next, in this order
0. Step 0 above, then the desktop layer + scenic wallpaper + widgets, then the rest.
1. **Design language first**: tokens (colour, type scale, spacing, radii, elevation, light and dark), a material for glass on Windows 10, and a motion system (spring presets, asymmetric enter/exit, interruptible, bursty). Put them in data/theme files with hot reload so iteration is fast.
2. **Dock**: turn the bar into the floating rounded glass dock from the reference (window sized exactly to its shape, rounded corners via composition geometry or mask, shadow/depth, magnification on hover with depth, real icons extracted from the apps' executables or monograms, running indicators), keeping AppBar reservation behaviour (or a documented floating alternative). Keep auto-hide.
3. **Top menu bar**: a second AppBar at the top (title/menus placeholder, status area, clock), same material.
4. **M4 desktop layer**: window parented behind the desktop icons via WorkerW (`0x052C` to Progman, Win11 24H2 fallback), wallpaper plus a 3D/depth scene and desktop widgets (calendar, weather, photo) per the reference, Win+D survival, re-embed on `TaskbarCreated`.
5. **M5 own-window chrome** (title bars for Udaan's own windows: `WM_NCCALCSIZE`, `WM_NCHITTEST` with `HTMAXBUTTON` for Snap Layouts, `DwmExtendFrameIntoClientArea`), then **M6** experimental overlay title bars for other apps (allow-list, kill switch, keep-or-drop decision from measured lag), then **M7** hardening (1-hour soak, DPI matrix, second monitor, accessibility via AccessKit).
6. Add a perf harness (`tools/measure`) so every milestone ends with numbers.

Show the user the result (screenshots) at the end of each of steps 2, 3 and 4, and check the idle cost after each. Keep Explorer running alongside; never modify the Winlogon `Shell` value; never use `SPI_SETWORKAREA`.

## Measured result: rounded glass (supersedes the warning above)
Spike on this PC: accent blur + composition rounded clip blurs the backdrop (stripe contrast 125 to 3) with clean antialiased rounded corners; accent blur + SetWindowRgn also works but with a harder edge; `CreateHostBackdropBrush` paints black on Windows 10 and must not be used; no blur leaves the backdrop untouched. Use accent blur + composition clip for the dock/top bar, and remove any host-backdrop-brush code (e.g. `glass.rs`). The blur is strong enough that the dock plate can be very light.

## Design direction (user decision 2026-11-14; supersedes "copy the macOS reference")
The user wants: keep the reference's SIZING and a little of its design language, but make the look match the ORIGINAL Udaan direction and the original goal for this new OS: performance first, a clean modern premium look, refined from-scratch components, some real 3D/depth, good (bursty) animation. It must be unique, not a macOS copy, and must work well on the target hardware. Only the BASICS of the original look carry over. Do NOT build or re-create original-Udaan features (3D window switcher, edge light, live/video wallpapers, audio, apps, launcher): the user will rebuild those later.

Keep from the macOS reference (sizing and structure only): 55 px dock icons, 6 px gaps, about 17 px off the bottom, about 26 px top bar, top bar as text with no fill or separator, a floating dock.

Carry over from original Udaan (the basics, see `DESIGN_SYSTEM.md` and memory `app-visual-language`):
- Content sits directly on the wallpaper; no card/slab behind things. Weight comes from typography (light, oversized, tight tracking) and soft text shadow for legibility, not scrims. Asymmetric anchoring, not centred boxes or a macOS-style card grid for widgets (e.g. a large light clock/date typeset straight on the wallpaper instead of frosted cards).
- Monochrome: charcoal scale with real depth (never pure black/white), warm off-white text (#faf8f4 at 96/72/52% alpha), ONE accent: logo blue #3072f0, used only for active/live/selected/focus (running-app dot, focus ring); never a second base colour. Danger is a desaturated brick red (#d9736a). Keep the tokens in the theme files with light and dark.
- No glows anywhere: shadows are neutral dark only. No hairline-bordered pills, no dark slabs.
- Type: Poppins (display) and Montserrat (body), loaded as private fonts via DirectWrite, not Segoe UI.
- Restraint: the lit-window rule; few things use the accent at once.

Make it unique (not a macOS clone): put the originality in depth and material, not in extra features. Examples to evaluate against the hardware limits: subtle perspective/parallax on the wallpaper and dock responding to the cursor (bursty, stops at rest), icons that tilt in 3D on hover, light that reads from one consistent direction across dock/widgets/bar, very light glass (strong blur, almost no tint). Pick a small set, prove each on this PC (idle CPU stays about 0), and drop anything that costs more than it earns.

Keep the existing behaviour that already works (AppBar reservation, auto-hide, watchdog). Fix the known regression first: the blur band above the dock (the dock window is larger than its plate and the accent blur fills the window rectangle, so clip the blur to the plate or size the window to the plate) and the top bar height regression. Screenshot before and after each change and show the user.
