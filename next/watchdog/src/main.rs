//! Tiny separate process: waits for the shell (pid in argv[1]) to exit, however it
//! exits (clean, crash, kill), then makes sure Explorer's taskbar is visible again.
//! The shell's own AppBar reservation disappears with its window, so that is all
//! that can be left behind.

use windows::{
    core::w,
    Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE},
        UI::WindowsAndMessaging::{FindWindowW, ShowWindow, SW_SHOWNA},
    },
};

fn main() {
    let Some(pid) = std::env::args().nth(1).and_then(|v| v.parse::<u32>().ok()) else { return };
    unsafe {
        if let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            WaitForSingleObject(h, INFINITE);
            let _ = CloseHandle(h);
        }
        if let Ok(tray) = FindWindowW(w!("Shell_TrayWnd"), None) {
            let _ = ShowWindow(tray, SW_SHOWNA);
        }
    }
}
