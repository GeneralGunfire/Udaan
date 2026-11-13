//! Finds a story's real, full-size picture.
//!
//! Feeds usually carry only a small thumbnail (or none). The article page
//! itself publishes the proper image as its social-share picture
//! (`og:image` / `twitter:image`), which is large and well cropped, so the
//! Start menu asks for that when the feed's own image isn't good enough.

use std::time::Duration;

/// Page bytes read at most: the tags we want sit in the <head>.
const MAX_BYTES: usize = 400_000;

/// Social-share image keys, best first.
const KEYS: [&str; 5] = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];

/// Value of `name="..."` (either quote style) inside one tag, matched on a
/// lower-cased copy so attribute names are case-insensitive but the value
/// keeps its original case.
fn attr(tag: &str, tag_lower: &str, name: &str) -> Option<String> {
  let mut from = 0;
  while let Some(i) = tag_lower[from..].find(name) {
    let at = from + i;
    let boundary = at == 0 || tag_lower.as_bytes()[at - 1].is_ascii_whitespace();
    let rest = tag[at + name.len()..].trim_start();
    if boundary && rest.starts_with('=') {
      let value = rest[1..].trim_start();
      let quote = value.chars().next()?;
      if quote != '"' && quote != '\'' {
        return None;
      }
      let body = &value[1..];
      let end = body.find(quote)?;
      return Some(body[..end].to_string());
    }
    from = at + name.len();
  }
  None
}

/// The highest-ranked image URL among the page's <meta> tags.
fn find_image(html: &str) -> Option<String> {
  let lower = html.to_ascii_lowercase();
  let mut best: Option<(usize, String)> = None;
  let mut from = 0;
  while let Some(i) = lower[from..].find("<meta") {
    let start = from + i;
    let Some(len) = lower[start..].find('>') else { break };
    let end = start + len;
    let (tag, tag_lower) = (&html[start..end], &lower[start..end]);
    from = end + 1;
    let key = attr(tag, tag_lower, "property").or_else(|| attr(tag, tag_lower, "name"));
    let Some(rank) = key.and_then(|k| KEYS.iter().position(|w| *w == k.to_ascii_lowercase())) else { continue };
    let Some(content) = attr(tag, tag_lower, "content") else { continue };
    if best.as_ref().map(|(r, _)| rank < *r).unwrap_or(true) {
      best = Some((rank, content));
    }
  }
  best.map(|(_, c)| c.replace("&amp;", "&").trim().to_string()).filter(|c| !c.is_empty())
}

/// The article's main picture as an absolute URL, or None.
#[tauri::command]
pub async fn news_page_image(url: String) -> Option<String> {
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return None;
  }
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(8))
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Udaan/1.0 (link preview)")
    .build()
    .ok()?;
  let mut response = client.get(&url).send().await.ok()?;
  if !response.status().is_success() {
    return None;
  }
  let base = response.url().clone();
  let mut bytes: Vec<u8> = Vec::new();
  while let Ok(Some(chunk)) = response.chunk().await {
    bytes.extend_from_slice(&chunk);
    if bytes.len() >= MAX_BYTES || String::from_utf8_lossy(&bytes).to_ascii_lowercase().contains("</head>") {
      break;
    }
  }
  let html = String::from_utf8_lossy(&bytes);
  let found = find_image(&html)?;
  base.join(&found).ok().map(|u| u.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn prefers_og_image_in_either_attribute_order() {
    let a = r#"<head><meta name="twitter:image" content="https://x/t.jpg"><meta property="og:image" content="https://x/o.jpg"></head>"#;
    assert_eq!(find_image(a).as_deref(), Some("https://x/o.jpg"));
    let b = r#"<META CONTENT='https://x/o2.jpg' PROPERTY='og:image'>"#;
    assert_eq!(find_image(b).as_deref(), Some("https://x/o2.jpg"));
  }

  #[test]
  fn decodes_ampersands_and_ignores_unrelated_tags() {
    let h = r#"<meta name="description" content="hi"><meta property="og:image" content="https://x/i.jpg?a=1&amp;b=2">"#;
    assert_eq!(find_image(h).as_deref(), Some("https://x/i.jpg?a=1&b=2"));
    assert_eq!(find_image("<html><meta charset=utf-8></html>"), None);
  }
}
