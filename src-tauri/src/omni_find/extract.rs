//! Pulling readable article text out of a raw HTML page.
//!
//! ## Why a hand-written extractor rather than a DOM library
//! A full parser (`scraper`, `html5ever`) would build a complete tree so
//! that arbitrary CSS selectors could query it. Nothing here needs that:
//! the job is "drop the parts that are not prose, unescape what remains",
//! which is a single pass over the bytes. The dependency would add build
//! time and a large transitive tree for capability this never uses.
//!
//! ## What "readable" means here
//! Script, style, nav, header, footer and aside blocks are removed
//! wholesale — they are where menus, cookie banners and related-article
//! lists live, and feeding those to a model is how a summary ends up
//! citing a newsletter signup. Everything else becomes text, with block
//! elements producing line breaks so paragraph structure survives.

pub struct Extracted {
  pub title: String,
  pub text: String,
  pub published: Option<String>,
}

/// Elements whose entire contents are discarded. `noscript` is included
/// because it usually holds a "please enable JavaScript" message that
/// reads as body text once tags are stripped.
const DROPPED_ELEMENTS: &[&str] = &[
  "script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "iframe",
  "template",
];

/// Elements that should produce a line break, so paragraphs and list
/// items do not run together into one wall of text.
const BLOCK_ELEMENTS: &[&str] = &[
  "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article",
  "blockquote", "pre",
];

/// Case-insensitive substring search. HTML tag names appear in any case
/// in real pages, and `str::find` is case-sensitive.
fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
  haystack
    .to_ascii_lowercase()
    .find(&needle.to_ascii_lowercase())
}

pub fn readable(html: &str) -> Extracted {
  let title = find_title(html);
  let published = find_published(html);
  let body = strip_dropped_elements(html);
  let text = to_text(&body);
  Extracted {
    title,
    text: collapse_blank_lines(&text),
    published,
  }
}

fn find_title(html: &str) -> String {
  // og:title first: it is the headline a publisher chose for sharing, and
  // is usually free of the " | Site Name — Section" suffix that <title>
  // carries.
  if let Some(value) = find_meta(html, "og:title") {
    return unescape(&value);
  }
  if let Some(start) = find_ci(html, "<title") {
    if let Some(open_end) = html[start..].find('>') {
      let content_start = start + open_end + 1;
      if let Some(end) = find_ci(&html[content_start..], "</title>") {
        return unescape(html[content_start..content_start + end].trim());
      }
    }
  }
  String::new()
}

fn find_published(html: &str) -> Option<String> {
  for key in [
    "article:published_time",
    "og:published_time",
    "datePublished",
    "publishdate",
    "date",
  ] {
    if let Some(value) = find_meta(html, key) {
      let trimmed = value.trim();
      if !trimmed.is_empty() {
        return Some(unescape(trimmed));
      }
    }
  }
  None
}

/// Finds a `<meta>` value by its `property` or `name`.
///
/// Scans tag by tag rather than with one regex because attribute order,
/// quoting style and whitespace all vary between publishers, and a regex
/// tight enough to be correct becomes unreadable.
fn find_meta(html: &str, key: &str) -> Option<String> {
  let lower = html.to_ascii_lowercase();
  let key_lower = key.to_ascii_lowercase();
  let mut cursor = 0;

  while let Some(offset) = lower[cursor..].find("<meta") {
    let start = cursor + offset;
    let end = match lower[start..].find('>') {
      Some(e) => start + e + 1,
      None => break,
    };
    let tag = &html[start..end];
    let tag_lower = &lower[start..end];

    let names_match = attr_value(tag_lower, "property")
      .map(|v| v == key_lower)
      .unwrap_or(false)
      || attr_value(tag_lower, "name").map(|v| v == key_lower).unwrap_or(false)
      || attr_value(tag_lower, "itemprop")
        .map(|v| v == key_lower)
        .unwrap_or(false);

    if names_match {
      if let Some(content) = attr_value(tag, "content") {
        if !content.trim().is_empty() {
          return Some(content);
        }
      }
    }
    cursor = end;
  }
  None
}

/// Reads one attribute out of a single tag. Handles double quotes, single
/// quotes and unquoted values, all of which appear in real pages.
fn attr_value(tag: &str, name: &str) -> Option<String> {
  let lower = tag.to_ascii_lowercase();
  let mut cursor = 0;
  while let Some(offset) = lower[cursor..].find(name) {
    let at = cursor + offset;
    // Must be preceded by whitespace, otherwise "name" matches inside
    // "itemprop-name" or similar.
    let preceded_ok = at == 0 || lower.as_bytes()[at - 1].is_ascii_whitespace();
    let after = at + name.len();
    let rest = lower[after..].trim_start();
    if preceded_ok && rest.starts_with('=') {
      let eq = after + lower[after..].find('=').unwrap();
      let value_part = tag[eq + 1..].trim_start();
      let quote = value_part.chars().next();
      return match quote {
        Some('"') => value_part[1..].split('"').next().map(|s| s.to_string()),
        Some('\'') => value_part[1..].split('\'').next().map(|s| s.to_string()),
        _ => value_part
          .split(|c: char| c.is_ascii_whitespace() || c == '>')
          .next()
          .map(|s| s.to_string()),
      };
    }
    cursor = at + name.len();
  }
  None
}

/// Removes whole elements (open tag through matching close tag) for
/// everything in DROPPED_ELEMENTS.
fn strip_dropped_elements(html: &str) -> String {
  let mut out = html.to_string();
  for element in DROPPED_ELEMENTS {
    out = strip_element(&out, element);
  }
  out
}

fn strip_element(html: &str, name: &str) -> String {
  let open = format!("<{name}");
  let close = format!("</{name}>");
  let mut out = String::with_capacity(html.len());
  let mut rest = html;

  loop {
    let lower = rest.to_ascii_lowercase();
    let Some(start) = lower.find(&open) else {
      out.push_str(rest);
      break;
    };
    // Guard against "<a" matching "<article": the character after the
    // name must end the tag name.
    let after = start + open.len();
    let boundary_ok = rest[after..]
      .chars()
      .next()
      .map(|c| c.is_ascii_whitespace() || c == '>' || c == '/')
      .unwrap_or(false);
    if !boundary_ok {
      out.push_str(&rest[..after]);
      rest = &rest[after..];
      continue;
    }

    out.push_str(&rest[..start]);
    match lower[start..].find(&close) {
      Some(end) => rest = &rest[start + end + close.len()..],
      // An unclosed dropped element (common with malformed `<script>`)
      // means the rest of the document is inside it; discarding the
      // remainder is safer than emitting script source as prose.
      None => break,
    }
  }
  out
}

/// Strips remaining tags, turning block elements into line breaks.
fn to_text(html: &str) -> String {
  let mut out = String::with_capacity(html.len() / 2);
  let bytes = html.as_bytes();
  let mut i = 0;

  while i < bytes.len() {
    if bytes[i] == b'<' {
      let Some(close) = html[i..].find('>') else { break };
      let tag = &html[i + 1..i + close];
      let name: String = tag
        .trim_start_matches('/')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
      if BLOCK_ELEMENTS.contains(&name.as_str()) {
        out.push('\n');
      }
      i += close + 1;
      continue;
    }
    let ch = html[i..].chars().next().unwrap_or(' ');
    out.push(ch);
    i += ch.len_utf8();
  }

  unescape(&out)
}

/// Decodes the entities that actually appear in article text. A full
/// entity table would be hundreds of entries for characters that never
/// occur in prose; numeric escapes cover the rest.
fn unescape(text: &str) -> String {
  let mut out = text
    .replace("&nbsp;", " ")
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .replace("&apos;", "'")
    .replace("&mdash;", "—")
    .replace("&ndash;", "–")
    .replace("&hellip;", "…")
    .replace("&rsquo;", "'")
    .replace("&lsquo;", "'")
    .replace("&ldquo;", "\"")
    .replace("&rdquo;", "\"");

  if out.contains("&#") {
    out = decode_numeric_entities(&out);
  }
  out
}

fn decode_numeric_entities(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut rest = text;
  while let Some(start) = rest.find("&#") {
    out.push_str(&rest[..start]);
    let after = &rest[start + 2..];
    let Some(semi) = after.find(';') else {
      out.push_str(&rest[start..]);
      return out;
    };
    let body = &after[..semi];
    let parsed = if let Some(hex) = body.strip_prefix(['x', 'X']) {
      u32::from_str_radix(hex, 16).ok()
    } else {
      body.parse::<u32>().ok()
    };
    match parsed.and_then(char::from_u32) {
      Some(c) => out.push(c),
      // An unparseable entity is left as written rather than dropped:
      // silently deleting characters corrupts quoted text.
      None => out.push_str(&rest[start..start + 2 + semi + 1]),
    }
    rest = &after[semi + 1..];
  }
  out.push_str(rest);
  out
}

/// Collapses runs of blank lines and trims trailing spaces. Tag stripping
/// leaves a great deal of whitespace, and sending it to a model wastes
/// context on nothing.
fn collapse_blank_lines(text: &str) -> String {
  let mut lines: Vec<&str> = Vec::new();
  let mut blank_run = 0;

  for line in text.lines() {
    let trimmed = line.trim();
    if trimmed.is_empty() {
      blank_run += 1;
      if blank_run > 1 {
        continue;
      }
      lines.push("");
    } else {
      blank_run = 0;
      lines.push(trimmed);
    }
  }

  lines.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn extracts_title_and_body() {
    let html = r#"
      <html><head><title>Site — Story headline</title>
      <meta property="og:title" content="Story headline">
      </head><body>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <article><p>First paragraph.</p><p>Second paragraph.</p></article>
        <footer>Copyright notice</footer>
      </body></html>"#;
    let out = readable(html);
    assert_eq!(out.title, "Story headline");
    assert!(out.text.contains("First paragraph."));
    assert!(out.text.contains("Second paragraph."));
    // Navigation and footer must not survive — they are where menus and
    // cookie banners live.
    assert!(!out.text.contains("About"));
    assert!(!out.text.contains("Copyright notice"));
  }

  #[test]
  fn removes_script_contents_entirely() {
    let html = "<body><script>var x = 'not prose';</script><p>Real text.</p></body>";
    let out = readable(html);
    assert!(!out.text.contains("not prose"));
    assert!(out.text.contains("Real text."));
  }

  #[test]
  fn does_not_confuse_a_tag_with_article() {
    // Stripping "<a" naively would eat the whole <article> element.
    let html = "<body><article><p>Kept.</p></article></body>";
    assert!(readable(html).text.contains("Kept."));
  }

  #[test]
  fn decodes_entities_including_numeric() {
    let html = "<body><p>Caf&eacute; &amp; bar &#8212; open &#x32;4h</p></body>";
    let text = readable(html).text;
    assert!(text.contains("& bar"));
    assert!(text.contains("—"));
    assert!(text.contains("24h"));
  }

  #[test]
  fn finds_published_date_from_meta() {
    let html = r#"<head><meta property="article:published_time" content="2026-01-15T10:00:00Z"></head><body><p>x</p></body>"#;
    assert_eq!(readable(html).published.as_deref(), Some("2026-01-15T10:00:00Z"));
  }

  #[test]
  fn handles_unquoted_attributes() {
    let html = r#"<head><meta name=og:title content=Headline></head><body><p>x</p></body>"#;
    assert_eq!(readable(html).title, "Headline");
  }
}
