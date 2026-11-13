//! Shell verbs ("properties", "openas", "runas", ...) and session idle time.

#[cfg(target_os = "windows")]
mod imp {
  use windows::core::{HSTRING, PCWSTR};
  use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_INVOKEIDLIST, SHELLEXECUTEINFOW};
  use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

  pub fn invoke(path: &str, verb: &str) -> Result<(), String> {
    let file = HSTRING::from(path);
    let verb = HSTRING::from(verb);
    let mut info = SHELLEXECUTEINFOW {
      cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
      fMask: SEE_MASK_INVOKEIDLIST,
      lpVerb: PCWSTR(verb.as_ptr()),
      lpFile: PCWSTR(file.as_ptr()),
      nShow: SW_SHOWNORMAL.0,
      ..Default::default()
    };
    unsafe { ShellExecuteExW(&mut info) }.map_err(|e| e.message().to_string())
  }

  pub fn idle_ms() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe {
      if !GetLastInputInfo(&mut info).as_bool() {
        return 0;
      }
      GetTickCount().wrapping_sub(info.dwTime) as u64
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  pub fn invoke(_: &str, _: &str) -> Result<(), String> {
    Err("Windows only".into())
  }
  pub fn idle_ms() -> u64 {
    0
  }
}

const ALLOWED_VERBS: &[&str] = &["open", "properties", "openas", "runas", "edit", "print", "explore"];

#[tauri::command]
pub async fn shell_invoke_verb(path: String, verb: String) -> Result<(), String> {
  if !ALLOWED_VERBS.contains(&verb.as_str()) {
    return Err(format!("verb {verb:?} is not allowed"));
  }
  tauri::async_runtime::spawn_blocking(move || imp::invoke(&path, &verb)).await.map_err(|e| e.to_string())?
}

/// Milliseconds since the last keyboard/mouse input anywhere in the session.
#[tauri::command]
pub fn shell_idle_ms() -> u64 {
  imp::idle_ms()
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PowerAction {
  Lock,
  Sleep,
  SignOut,
  Restart,
  ShutDown,
}

/// Start-menu power actions. Restart/shut down/sign out go through
/// shutdown.exe so apps get the normal "save your work" chance.
#[tauri::command]
pub fn shell_power(action: PowerAction) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;
    let run = |args: &[&str]| Command::new("shutdown").args(args).spawn().map(|_| ()).map_err(|e| e.to_string());
    match action {
      PowerAction::Lock => unsafe {
        windows::Win32::System::Shutdown::LockWorkStation().map_err(|e| e.message().to_string())
      },
      PowerAction::Sleep => unsafe {
        if windows::Win32::System::Power::SetSuspendState(false, false, false) {
          Ok(())
        } else {
          Err("This PC refused to sleep.".into())
        }
      },
      PowerAction::SignOut => run(&["/l"]),
      PowerAction::Restart => run(&["/r", "/t", "0"]),
      PowerAction::ShutDown => run(&["/s", "/t", "0"]),
    }
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = action;
    Err("Windows only".into())
  }
}

/// The signed-in user's display name for the Start menu.
#[tauri::command]
pub fn shell_user_name() -> String {
  std::env::var("USERNAME").unwrap_or_else(|_| "User".into())
}
