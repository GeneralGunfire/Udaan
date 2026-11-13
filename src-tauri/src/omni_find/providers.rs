//! Search backends.
//!
//! Four are supported, in two classes. Brave and Tavily are purpose-built
//! search APIs and return markedly better results, but need a key the
//! user has to obtain. DuckDuckGo and Wikipedia need nothing and always
//! run, so OmniFind works the moment it is opened.
//!
//! Each provider returns `Result`, and the caller treats a failure as
//! "this backend contributed nothing" rather than an error — a research
//! run with three sources instead of five is still useful.

use serde::Deserialize;

use super::SearchResult;

/// The Brave Search API. Free tier at time of writing allows a modest
/// monthly quota, which is ample for interactive research.
pub async fn brave(
  client: &reqwest::Client,
  query: &str,
  limit: usize,
  key: &str,
) -> Result<Vec<SearchResult>, String> {
  #[derive(Deserialize)]
  struct Response {
    web: Option<Web>,
  }
  #[derive(Deserialize)]
  struct Web {
    results: Vec<Item>,
  }
  #[derive(Deserialize)]
  struct Item {
    title: String,
    url: String,
    #[serde(default)]
    description: String,
  }

  let response = client
    .get("https://api.search.brave.com/res/v1/web/search")
    .query(&[("q", query), ("count", &limit.to_string())])
    .header("X-Subscription-Token", key)
    .header("Accept", "application/json")
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    // 401 and 429 are the two failures a user can actually act on, so
    // they are named rather than reported as a bare status code.
    return Err(match response.status().as_u16() {
      401 | 403 => "the API key was rejected".to_string(),
      429 => "rate limit reached".to_string(),
      status => format!("returned {status}"),
    });
  }

  let body: Response = response.json().await.map_err(|e| e.to_string())?;
  Ok(
    body
      .web
      .map(|w| w.results)
      .unwrap_or_default()
      .into_iter()
      .map(|item| SearchResult {
        title: item.title,
        url: item.url,
        snippet: strip_tags(&item.description),
        provider: "brave".into(),
      })
      .collect(),
  )
}

/// Tavily, a search API built for LLM pipelines. Its snippets are longer
/// and pre-cleaned, which often removes the need to fetch the page.
pub async fn tavily(
  client: &reqwest::Client,
  query: &str,
  limit: usize,
  key: &str,
) -> Result<Vec<SearchResult>, String> {
  #[derive(Deserialize)]
  struct Response {
    #[serde(default)]
    results: Vec<Item>,
  }
  #[derive(Deserialize)]
  struct Item {
    title: String,
    url: String,
    #[serde(default)]
    content: String,
  }

  let response = client
    .post("https://api.tavily.com/search")
    .json(&serde_json::json!({
      "api_key": key,
      "query": query,
      "max_results": limit,
      "search_depth": "advanced",
    }))
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(match response.status().as_u16() {
      401 | 403 => "the API key was rejected".to_string(),
      429 => "rate limit reached".to_string(),
      status => format!("returned {status}"),
    });
  }

  let body: Response = response.json().await.map_err(|e| e.to_string())?;
  Ok(
    body
      .results
      .into_iter()
      .map(|item| SearchResult {
        title: item.title,
        url: item.url,
        snippet: item.content,
        provider: "tavily".into(),
      })
      .collect(),
  )
}

/// DuckDuckGo's no-JavaScript HTML endpoint.
///
/// This is scraping, and it is fragile by nature: the markup can change
/// without notice, at which case the parse yields nothing and the caller
/// falls back to its other providers. That is an acceptable trade for a
/// backend that needs no key and no signup — and the failure mode is
/// "fewer results", never wrong ones.
pub async fn duckduckgo(
  client: &reqwest::Client,
  query: &str,
  limit: usize,
) -> Result<Vec<SearchResult>, String> {
  let response = client
    .post("https://html.duckduckgo.com/html/")
    .form(&[("q", query)])
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(format!("returned {}", response.status()));
  }

  let html = response.text().await.map_err(|e| e.to_string())?;
  let results = parse_duckduckgo(&html, limit);
  if results.is_empty() {
    return Err("no results could be parsed from the response".into());
  }
  Ok(results)
}

/// Extracted so it can be tested against a fixture without a network
/// call — the part most likely to break silently is the parse, not the
/// request.
fn parse_duckduckgo(html: &str, limit: usize) -> Vec<SearchResult> {
  let mut results = Vec::new();
  let mut cursor = 0;

  while results.len() < limit {
    let Some(offset) = html[cursor..].find("result__a") else { break };
    let anchor_start = cursor + offset;

    let Some(href_rel) = html[anchor_start..].find("href=\"") else { break };
    let href_start = anchor_start + href_rel + 6;
    let Some(href_len) = html[href_start..].find('"') else { break };
    let raw_href = &html[href_start..href_start + href_len];

    let Some(text_rel) = html[href_start..].find('>') else { break };
    let text_start = href_start + text_rel + 1;
    let Some(text_len) = html[text_start..].find("</a>") else { break };
    let title = strip_tags(&html[text_start..text_start + text_len]);

    // Snippets follow the link in a result__snippet block. Its absence is
    // normal for some result types, so a miss is not fatal.
    let snippet = html[text_start..]
      .find("result__snippet")
      .and_then(|rel| {
        let snip_start = text_start + rel;
        let open = html[snip_start..].find('>')? + snip_start + 1;
        let close = html[open..].find("</a>").or_else(|| html[open..].find("</div>"))?;
        Some(strip_tags(&html[open..open + close]))
      })
      .unwrap_or_default();

    if let Some(url) = resolve_ddg_href(raw_href) {
      if !title.trim().is_empty() {
        results.push(SearchResult {
          title,
          url,
          snippet,
          provider: "duckduckgo".into(),
        })
      }
    }
    cursor = text_start + text_len;
  }

  results
}

/// DuckDuckGo wraps result links in a redirector carrying the real URL in
/// a `uddg` parameter. Following the redirect would work but costs a
/// round trip per result; unwrapping it here is free.
fn resolve_ddg_href(href: &str) -> Option<String> {
  let decoded = decode_percent(href);
  if let Some(index) = decoded.find("uddg=") {
    let after = &decoded[index + 5..];
    let value = after.split('&').next().unwrap_or(after);
    let url = decode_percent(value);
    return url.starts_with("http").then_some(url);
  }
  if decoded.starts_with("//") {
    return Some(format!("https:{decoded}"));
  }
  decoded.starts_with("http").then_some(decoded)
}

fn decode_percent(input: &str) -> String {
  let bytes = input.as_bytes();
  let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
        out.push(byte);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  // Lossy rather than failing: a malformed escape in one URL should not
  // discard the whole result.
  String::from_utf8_lossy(&out).into_owned()
}

/// Wikipedia's open search API.
///
/// Included alongside a general engine because it reliably supplies
/// background and definitions that a news-weighted result set misses
/// entirely, and it is the one source whose text extracts cleanly every
/// time.
pub async fn wikipedia(
  client: &reqwest::Client,
  query: &str,
  limit: usize,
) -> Result<Vec<SearchResult>, String> {
  #[derive(Deserialize)]
  struct Response {
    query: Option<Query>,
  }
  #[derive(Deserialize)]
  struct Query {
    search: Vec<Item>,
  }
  #[derive(Deserialize)]
  struct Item {
    title: String,
    #[serde(default)]
    snippet: String,
  }

  let response = client
    .get("https://en.wikipedia.org/w/api.php")
    .query(&[
      ("action", "query"),
      ("list", "search"),
      ("srsearch", query),
      ("srlimit", &limit.to_string()),
      ("format", "json"),
      ("origin", "*"),
    ])
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(format!("returned {}", response.status()));
  }

  let body: Response = response.json().await.map_err(|e| e.to_string())?;
  Ok(
    body
      .query
      .map(|q| q.search)
      .unwrap_or_default()
      .into_iter()
      .map(|item| SearchResult {
        url: format!(
          "https://en.wikipedia.org/wiki/{}",
          item.title.replace(' ', "_")
        ),
        // Wikipedia marks matched terms with <span> tags in snippets.
        snippet: strip_tags(&item.snippet),
        title: item.title,
        provider: "wikipedia".into(),
      })
      .collect(),
  )
}

/// Removes tags from a short snippet. Distinct from `extract::readable`,
/// which handles whole documents — this is only for the inline markup
/// search APIs use to highlight matched terms.
/// Bing's HTML results. Keyless; complements DuckDuckGo with a different
/// index, so a research run sees more of the web.
pub async fn bing(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
  let response = client
    .get("https://www.bing.com/search")
    .query(&[("q", query), ("setlang", "en"), ("count", "20")])
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("returned {}", response.status()));
  }
  let html = response.text().await.map_err(|e| e.to_string())?;
  let results = parse_bing(&html, limit);
  if results.is_empty() {
    return Err("no results could be parsed from the response".into());
  }
  Ok(results)
}

fn parse_bing(html: &str, limit: usize) -> Vec<SearchResult> {
  let mut results = Vec::new();
  let mut cursor = 0;
  while results.len() < limit {
    let Some(off) = html[cursor..].find("class=\"b_algo\"") else { break };
    let block_start = cursor + off;
    let block_end = html[block_start + 10..].find("class=\"b_algo\"").map(|e| block_start + 10 + e).unwrap_or(html.len());
    let block = &html[block_start..block_end];
    cursor = block_end;
    let Some(h2) = block.find("<h2") else { continue };
    let Some(href_rel) = block[h2..].find("href=\"") else { continue };
    let href_start = h2 + href_rel + 6;
    let Some(href_len) = block[href_start..].find('"') else { continue };
    let raw_href = block[href_start..href_start + href_len].replace("&amp;", "&");
    let Some(text_rel) = block[href_start..].find('>') else { continue };
    let text_start = href_start + text_rel + 1;
    let Some(text_len) = block[text_start..].find("</a>") else { continue };
    let title = strip_tags(&block[text_start..text_start + text_len]);
    let snippet = block
      .find("<p")
      .and_then(|p| {
        let open = block[p..].find('>')? + p + 1;
        let close = block[open..].find("</p>")? + open;
        Some(strip_tags(&block[open..close]))
      })
      .unwrap_or_default();
    if let Some(url) = resolve_bing_href(&raw_href) {
      if !title.is_empty() {
        results.push(SearchResult { title, url, snippet, provider: "bing".into() });
      }
    }
  }
  results
}

/// Bing wraps links as bing.com/ck/a?...&u=a1<base64url of the real URL>.
fn resolve_bing_href(href: &str) -> Option<String> {
  use base64::Engine;
  if href.starts_with("http") && !href.contains("bing.com/ck/") {
    return Some(href.to_string());
  }
  let u = href.split(['?', '&']).find_map(|kv| kv.strip_prefix("u="))?;
  let encoded = u.strip_prefix("a1")?;
  let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded.trim_end_matches('=')).ok()?;
  let url = String::from_utf8(bytes).ok()?;
  url.starts_with("http").then_some(url)
}

/// Google News search as RSS: current events, many outlets, no key.
/// Links point at Google's redirector, which page fetching follows.
pub async fn google_news(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
  let response = client
    .get("https://news.google.com/rss/search")
    .query(&[("q", query), ("hl", "en-ZA"), ("gl", "ZA"), ("ceid", "ZA:en")])
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("returned {}", response.status()));
  }
  let xml = response.text().await.map_err(|e| e.to_string())?;
  let mut results = Vec::new();
  for item in xml.split("<item>").skip(1).take(limit) {
    let tag = |name: &str| -> Option<String> {
      let open = item.find(&format!("<{name}"))?;
      let start = item[open..].find('>')? + open + 1;
      let end = item[start..].find(&format!("</{name}>"))? + start;
      Some(strip_tags(item[start..end].trim_start_matches("<![CDATA[").trim_end_matches("]]>")))
    };
    let (Some(title), Some(url)) = (tag("title"), tag("link")) else { continue };
    let source = tag("source").unwrap_or_default();
    let date = tag("pubDate").unwrap_or_default();
    results.push(SearchResult { title, url, snippet: format!("{source} · {date}"), provider: "news".into() });
  }
  if results.is_empty() {
    return Err("no news results".into());
  }
  Ok(results)
}

fn strip_tags(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut inside = false;
  for ch in text.chars() {
    match ch {
      '<' => inside = true,
      '>' => inside = false,
      c if !inside => out.push(c),
      _ => {}
    }
  }
  out
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .replace("&amp;", "&")
    .replace("&nbsp;", " ")
    .trim()
    .to_string()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn unwraps_duckduckgo_redirector() {
    let href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fstory&rut=abc";
    assert_eq!(
      resolve_ddg_href(href).as_deref(),
      Some("https://example.com/story"),
    );
  }

  #[test]
  fn passes_through_direct_links() {
    assert_eq!(
      resolve_ddg_href("https://example.com/x").as_deref(),
      Some("https://example.com/x"),
    );
  }

  #[test]
  fn rejects_non_http_hrefs() {
    assert!(resolve_ddg_href("javascript:void(0)").is_none());
  }

  #[test]
  fn parses_a_result_block() {
    let html = r#"
      <div class="result">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">
          Example <b>headline</b>
        </a>
        <a class="result__snippet">A short <b>summary</b> of the page.</a>
      </div>"#;
    let results = parse_duckduckgo(html, 5);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].url, "https://example.com/a");
    assert_eq!(results[0].title, "Example headline");
    assert!(results[0].snippet.contains("short summary"));
  }

  #[test]
  fn strips_highlight_markup_from_snippets() {
    assert_eq!(
      strip_tags("the <span class=\"searchmatch\">term</span> appears"),
      "the term appears",
    );
  }
}
