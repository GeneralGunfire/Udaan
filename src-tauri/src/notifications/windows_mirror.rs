//! Mirrors Windows notifications (Phone Link's WhatsApp/SMS messages, Teams,
//! Outlook, ...) into Udaan's own notification centre and banners.
//!
//! The WinRT listener API needs a packaged app, so instead this reads the
//! per-user notification database Windows itself keeps
//! (%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db),
//! read-only, polling for rows newer than the last one seen.

use base64::Engine;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;

const POLL: Duration = Duration::from_secs(2);

#[derive(Serialize)]
struct Extra<'a> {
  app: &'a str,
  launch: Option<String>,
  image: Option<String>,
  browser: Option<&'a str>,
}

fn db_path() -> Option<PathBuf> {
  let local = std::env::var_os("LOCALAPPDATA")?;
  Some(PathBuf::from(local).join(r"Microsoft\Windows\Notifications\wpndatabase.db"))
}

/// "Microsoft.YourPhone_8wekyb3d8bbwe!YourPhoneNotifications_com.whatsapp" → "WhatsApp".
pub fn app_name(primary_id: &str) -> String {
  let known = [
    ("com.whatsapp", "WhatsApp"),
    ("org.telegram", "Telegram"),
    ("com.instagram", "Instagram"),
    ("com.facebook.orca", "Messenger"),
    ("com.google.android.apps.messaging", "Messages"),
    ("com.samsung.android.messaging", "Messages"),
    ("com.google.android.gm", "Gmail"),
    ("com.snapchat", "Snapchat"),
    ("com.discord", "Discord"),
    ("MSTeams", "Teams"),
    ("Microsoft.YourPhone", "Phone Link"),
    ("Microsoft.Outlook", "Outlook"),
    ("WhatsApp", "WhatsApp"),
  ];
  for (needle, name) in known {
    if primary_id.contains(needle) {
      return name.to_string();
    }
  }
  if let Some(exe) = primary_id.rsplit(['\\', '/']).next().filter(|s| s.to_lowercase().ends_with(".exe")) {
    return exe[..exe.len() - 4].to_string();
  }
  // Browser/extension handlers are bare GUIDs: show something readable.
  if primary_id.starts_with('{') {
    return "Microsoft Edge".to_string();
  }
  let package = primary_id.split('!').next().unwrap_or(primary_id);
  let base = package.split('_').next().unwrap_or(package);
  base.rsplit('.').next().unwrap_or(base).to_string()
}

/// Chrome, Edge and friends register one handler per profile
/// ("Chrome.QTK6OS66VK36ZQEO7GRKAGKK7A"); web-push toasts all arrive there.
fn browser_of(primary_id: &str) -> Option<&'static str> {
  let p = primary_id.to_lowercase();
  [("chrome.", "Chrome"), ("msedge", "Edge"), ("brave", "Brave"), ("firefox", "Firefox"), ("opera", "Opera")]
    .into_iter()
    .find(|(prefix, _)| p.starts_with(prefix))
    .map(|(_, name)| name)
}

/// The site a browser toast came from: the first `http(s)://host/` inside
/// Chrome's pipe-separated launch string ("0|0|Default|Chrome.X|0|https://claude.ai/|p#...").
fn site_origin(launch: &str) -> Option<String> {
  let start = launch.find("https://").or_else(|| launch.find("http://"))?;
  let rest = &launch[start..];
  let end = rest.find(['|', '#']).unwrap_or(rest.len());
  Some(rest[..end].to_string())
}

/// "https://web.whatsapp.com/" -> "WhatsApp", "https://claude.ai/" -> "Claude".
fn site_name(origin: &str) -> String {
  let host = origin.split("://").nth(1).unwrap_or(origin).split(['/', ':']).next().unwrap_or(origin).to_lowercase();
  let known = [
    ("whatsapp", "WhatsApp"),
    ("mail.google", "Gmail"),
    ("calendar.google", "Google Calendar"),
    ("web.telegram", "Telegram"),
    ("messenger", "Messenger"),
    ("discord", "Discord"),
    ("slack", "Slack"),
    ("teams.microsoft", "Teams"),
    ("outlook", "Outlook"),
    ("x.com", "X"),
    ("twitter", "X"),
    ("github", "GitHub"),
  ];
  if let Some((_, name)) = known.iter().find(|(needle, _)| host.contains(needle)) {
    return name.to_string();
  }
  let labels: Vec<&str> = host.split('.').collect();
  // Drop the TLD (and a second-level "co"/"com" in co.za, com.au, ...).
  let mut core = &labels[..labels.len().saturating_sub(1).max(1)];
  if core.len() > 1 && matches!(core[core.len() - 1], "co" | "com" | "org" | "net") {
    core = &core[..core.len() - 1];
  }
  let label = core.last().copied().unwrap_or("");
  let mut chars = label.chars();
  chars.next().map(|c| c.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_else(|| host.clone())
}

fn unescape(s: &str) -> String {
  s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&#39;", "'")
}

fn attr(tag: &str, name: &str) -> Option<String> {
  let key = format!("{name}=\"");
  let start = tag.find(&key)? + key.len();
  let end = tag[start..].find('"')? + start;
  Some(unescape(&tag[start..end]))
}

struct Parsed {
  texts: Vec<String>,
  attribution: Option<String>,
  image: Option<String>,
  launch: Option<String>,
}

/// The toast XML's text lines (the `attribution` line, which Chrome uses for
/// the site host, kept apart), first picture and launch target.
fn parse(xml: &str) -> Parsed {
  let mut texts = Vec::new();
  let mut attribution = None;
  let mut rest = xml;
  while let Some(open) = rest.find("<text") {
    let Some(gt) = rest[open..].find('>') else { break };
    let body_start = open + gt + 1;
    if rest[open..open + gt].ends_with('/') {
      rest = &rest[body_start..];
      continue;
    }
    let is_attribution = rest[open..open + gt].contains("placement=\"attribution\"");
    let Some(close) = rest[body_start..].find("</text>") else { break };
    let t = unescape(rest[body_start..body_start + close].trim());
    if !t.is_empty() {
      if is_attribution {
        attribution = Some(t);
      } else {
        texts.push(t);
      }
    }
    rest = &rest[body_start + close + 7..];
  }
  let image = xml.find("<image").and_then(|i| {
    let end = xml[i..].find('>')? + i;
    attr(&xml[i..end], "src")
  });
  let launch = xml.find("<toast").and_then(|i| {
    let end = xml[i..].find('>')? + i;
    attr(&xml[i..end], "launch")
  });
  Parsed { texts, attribution, image, launch }
}

/// A small local picture as a data URL, so the webview can show it.
fn image_data(src: &str) -> Option<String> {
  // Phone Link uses file:/// URLs; Chrome and Edge give a bare "C:\\...\\x.tmp" path.
  let path = src.strip_prefix("file:///").or_else(|| src.strip_prefix("file://")).unwrap_or(src);
  if !path.contains(['\\', '/']) {
    return None;
  }
  let path = path.replace('/', "\\");
  let bytes = std::fs::read(&path).ok()?;
  if bytes.len() > 400_000 {
    return None;
  }
  // Chrome's ".tmp" pictures are PNG or JPEG: go by the magic bytes, not the extension.
  let mime = if bytes.starts_with(&[0xFF, 0xD8]) { "image/jpeg" } else { "image/png" };
  Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Udaan shows phone notifications itself, so Windows' own banner and sound
/// for that app are switched off; the notification still lands in the
/// database this module reads. Done once per app, the first time one arrives.
#[cfg(windows)]
fn quiet_windows_banner(primary_id: &str) {
  use winreg::enums::HKEY_CURRENT_USER;
  let path = format!(r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\{primary_id}");
  if let Ok((key, _)) = winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey(path) {
    if key.get_value::<u32, _>("ShowBanner").ok() != Some(0) {
      let _ = key.set_value("ShowBanner", &0u32);
      let _ = key.set_value("SoundFile", &"");
    }
  }
}
#[cfg(not(windows))]
fn quiet_windows_banner(_: &str) {}

fn open() -> Option<Connection> {
  let conn = Connection::open_with_flags(db_path()?, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
  let _ = conn.busy_timeout(Duration::from_millis(500));
  Some(conn)
}

fn max_id(conn: &Connection) -> i64 {
  conn.query_row("SELECT COALESCE(MAX(Id), 0) FROM Notification", [], |r| r.get(0)).unwrap_or(0)
}

pub fn start(app: AppHandle) {
  std::thread::Builder::new()
    .name("udaan-windows-notifications".into())
    .spawn(move || {
      let mut last: Option<i64> = None;
      loop {
        std::thread::sleep(POLL);
        let Some(conn) = open() else { continue };
        // Only notifications that arrive while Udaan runs.
        let Some(seen) = last else {
          last = Some(max_id(&conn));
          continue;
        };
        let rows: Vec<(i64, String, String)> = conn
          .prepare(
            "SELECT n.Id, h.PrimaryId, CAST(n.Payload AS TEXT) FROM Notification n \
             JOIN NotificationHandler h ON h.RecordId = n.HandlerId \
             WHERE n.Id > ?1 AND n.Type = 'toast' ORDER BY n.Id",
          )
          .and_then(|mut st| st.query_map([seen], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, Option<String>>(2)?.unwrap_or_default())))?.collect())
          .unwrap_or_default();
        for (id, primary, payload) in rows {
          last = Some(id.max(last.unwrap_or(0)));
          // Udaan's own toasts are already in its store.
          if primary.to_lowercase().contains("udaan") {
            continue;
          }
          // Muted at the user's request.
          let lower = primary.to_lowercase();
          if ["norton", "avast", "gen digital", "symantec"].iter().any(|n| lower.contains(n)) {
            continue;
          }
          let Parsed { texts, attribution, image, mut launch } = parse(&payload);
          if texts.is_empty() {
            continue;
          }
          // Browser-extension notifications (e.g. Norton Safe Web inside Edge)
          // arrive under a GUID; mute Norton by content too.
          if texts.iter().any(|t| t.to_lowercase().contains("norton")) {
            continue;
          }
          let browser = browser_of(&primary);
          if primary.contains("YourPhoneNotifications_") || primary.contains("YourPhoneMessages") || browser.is_some() {
            quiet_windows_banner(&primary);
          }
          // A browser toast is really from the website: name it after the
          // site, and make a click open that site.
          let (name, launch) = if browser.is_some() {
            let origin = launch.as_deref().and_then(site_origin).or_else(|| attribution.as_deref().map(|a| format!("https://{a}/")));
            let name = origin.as_deref().map(site_name).unwrap_or_else(|| browser.unwrap_or("Browser").to_string());
            (name, origin.or_else(|| launch.take()))
          } else {
            (app_name(&primary), launch)
          };
          let title = texts[0].clone();
          let body = texts[1..].join("\n");
          let extra = Extra { app: &name, launch, image: image.as_deref().and_then(image_data), browser };
          let payload = serde_json::to_string(&extra).unwrap_or_default();
          let _ = super::push_notification(&app, "windows", &title, &body, &name, Some("Open"), Some(&payload));
        }
        if let Some(l) = last {
          // A cleared notification database restarts the Id counter.
          let top = max_id(&conn);
          if top < l {
            last = Some(top);
          }
        }
      }
    })
    .expect("spawn windows notification mirror");
}

#[cfg(test)]
mod tests {
  #[test]
  fn names_phone_link_whatsapp() {
    assert_eq!(super::app_name("Microsoft.YourPhone_8wekyb3d8bbwe!YourPhoneNotifications_com.whatsapp"), "WhatsApp");
  }

  #[test]
  fn parses_toast_texts() {
    let p = super::parse(r#"<toast launch="x&amp;y"><visual><binding><text>Mom</text><text>Dinner at 7?</text></binding></visual></toast>"#);
    assert_eq!(p.texts, vec!["Mom", "Dinner at 7?"]);
    assert_eq!(p.launch.as_deref(), Some("x&y"));
  }

  #[test]
  fn keeps_chrome_attribution_out_of_the_body() {
    let p = super::parse(r#"<toast><visual><binding><text>Title</text><text>Body</text><text placement="attribution">claude.ai</text></binding></visual></toast>"#);
    assert_eq!(p.texts, vec!["Title", "Body"]);
    assert_eq!(p.attribution.as_deref(), Some("claude.ai"));
  }

  #[test]
  fn names_browser_toasts_after_the_site() {
    let launch = "0|0|Default|Chrome.QTK6OS66VK36ZQEO7GRKAGKK7A|0|https://web.whatsapp.com/|p#https://web.whatsapp.com/#010006";
    assert_eq!(super::browser_of("Chrome.QTK6OS66VK36ZQEO7GRKAGKK7A"), Some("Chrome"));
    let origin = super::site_origin(launch).unwrap();
    assert_eq!(origin, "https://web.whatsapp.com/");
    assert_eq!(super::site_name(&origin), "WhatsApp");
    assert_eq!(super::site_name("https://claude.ai/"), "Claude");
    assert_eq!(super::site_name("https://www.news24.co.za/"), "News24");
  }
}
