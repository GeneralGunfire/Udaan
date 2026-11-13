//! OmniFind — the web-facing half of deep research.
//!
//! ## Why this lives in Rust rather than the frontend
//! Two hard blockers make browser `fetch()` useless here. Search engines
//! and news sites send no `Access-Control-Allow-Origin`, so every request
//! from the WebView is rejected before it starts; and many refuse
//! requests without a browser-shaped `User-Agent`. A native HTTP client
//! has neither restriction. This is the same reason `daily_brief` fetches
//! its feeds here.
//!
//! ## What this module does and does not do
//! It finds pages and extracts their readable text. It does no
//! summarising, no relevance ranking, and no fact-checking — those are
//! LLM work and belong on the frontend where OmniRoute lives. Keeping the
//! split at "bytes in, clean text out" means the research pipeline can
//! change entirely without touching any networking code.

mod extract;
mod providers;

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Per-request ceiling. Long enough for a slow news site, short enough
/// that one unresponsive host cannot stall a research run — the pipeline
/// fetches many pages and treats a failure as "this source contributes
/// nothing" rather than aborting.
const REQUEST_TIMEOUT_SECS: u64 = 12;

/// A browser User-Agent. Not deception for its own sake: a large share of
/// sites serve a stripped or blocked page to unrecognised agents, and a
/// research tool that silently receives different content than a browser
/// would is worse than one that identifies as a browser.
const USER_AGENT: &str =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

/// Cap on extracted text per page, in characters.
///
/// Whole articles routinely exceed what an LLM context can hold alongside
/// a dozen other sources, and the useful material is overwhelmingly near
/// the top. Truncating here rather than on the frontend means the
/// oversized string never crosses the IPC bridge.
const MAX_PAGE_CHARS: usize = 24_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
  pub title: String,
  pub url: String,
  /// Engine-provided snippet. Often enough to judge relevance without
  /// fetching the page at all, which is why it is kept.
  pub snippet: String,
  /// Which backend produced this hit, so the UI can show provenance and
  /// the caller can weight sources differently.
  pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageContent {
  pub url: String,
  pub title: String,
  /// Readable body text, boilerplate stripped.
  pub text: String,
  /// True when `text` was cut at MAX_PAGE_CHARS, so the caller can say so
  /// rather than implying it read the whole page.
  pub truncated: bool,
  /// Publication date if the page declared one, as written. Deliberately
  /// not parsed into a real date: formats vary wildly and a wrong parse
  /// is worse than showing what the page actually said.
  pub published: Option<String>,
}

fn http_client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
    .user_agent(USER_AGENT)
    // Search engines and news sites redirect heavily (consent walls,
    // regional editions, http to https). Following them is required to
    // land on real content.
    .redirect(reqwest::redirect::Policy::limited(5))
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// Runs a web search across the configured providers.
///
/// Providers are tried in order and their results merged, deduplicated by
/// URL. A provider that fails contributes nothing rather than failing the
/// call: a research run with three sources instead of five is still
/// useful, whereas an error is not.
#[tauri::command]
pub async fn omni_find_search(
  query: String,
  limit: Option<usize>,
  brave_key: Option<String>,
  tavily_key: Option<String>,
) -> Result<Vec<SearchResult>, String> {
  let client = http_client()?;
  let limit = limit.unwrap_or(10).clamp(1, 30);

  let mut results: Vec<SearchResult> = Vec::new();
  let mut errors: Vec<String> = Vec::new();

  // A user-supplied key means a purpose-built search API, which returns
  // markedly better results than scraping. Tried first so its hits rank
  // above the free fallbacks.
  if let Some(key) = brave_key.as_deref().filter(|k| !k.trim().is_empty()) {
    match providers::brave(&client, &query, limit, key).await {
      Ok(mut hits) => results.append(&mut hits),
      Err(e) => errors.push(format!("Brave: {e}")),
    }
  }
  if let Some(key) = tavily_key.as_deref().filter(|k| !k.trim().is_empty()) {
    match providers::tavily(&client, &query, limit, key).await {
      Ok(mut hits) => results.append(&mut hits),
      Err(e) => errors.push(format!("Tavily: {e}")),
    }
  }

  // Free backends always run: they cost nothing, and on a query where the
  // paid provider returns little they are the difference between a report
  // and an apology.
  // Every free backend runs at once: DuckDuckGo and Bing index the web
  // differently, Wikipedia adds background, Google News adds what is
  // current. Interleaved so no single engine dominates the top.
  let (ddg, bing, wiki, news) = tokio::join!(
    providers::duckduckgo(&client, &query, limit),
    providers::bing(&client, &query, limit),
    providers::wikipedia(&client, &query, 3),
    providers::google_news(&client, &query, 4),
  );
  let mut lists = Vec::new();
  for (name, outcome) in [("DuckDuckGo", ddg), ("Bing", bing), ("Wikipedia", wiki), ("News", news)] {
    match outcome {
      Ok(hits) => lists.push(hits.into_iter()),
      Err(e) => errors.push(format!("{name}: {e}")),
    }
  }
  loop {
    let mut any = false;
    for list in lists.iter_mut() {
      if let Some(hit) = list.next() {
        results.push(hit);
        any = true;
      }
    }
    if !any {
      break;
    }
  }

  dedupe_by_url(&mut results);

  if results.is_empty() {
    return Err(if errors.is_empty() {
      format!("No results found for \"{query}\".")
    } else {
      format!("Every search backend failed. {}", errors.join("; "))
    });
  }

  results.truncate(limit);
  Ok(results)
}

/// Fetches one page and extracts its readable text.
#[tauri::command]
pub async fn omni_find_fetch_page(url: String) -> Result<PageContent, String> {
  let client = http_client()?;

  let response = client
    .get(&url)
    .send()
    .await
    .map_err(|e| format!("Could not reach {url}: {}", describe(&e)))?;

  if !response.status().is_success() {
    return Err(format!("{url} returned {}", response.status()));
  }

  // Only HTML and plain text are useful. A PDF or an image would
  // otherwise be decoded as mojibake and handed to the model as if it
  // were prose.
  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_ascii_lowercase();
  if !content_type.is_empty()
    && !content_type.contains("html")
    && !content_type.contains("text/plain")
    && !content_type.contains("xml")
  {
    return Err(format!("{url} is {content_type}, which cannot be read as text."));
  }

  let body = response
    .text()
    .await
    .map_err(|e| format!("Could not read {url}: {}", describe(&e)))?;

  let extracted = extract::readable(&body);
  let mut text = extracted.text;
  let truncated = text.chars().count() > MAX_PAGE_CHARS;
  if truncated {
    text = text.chars().take(MAX_PAGE_CHARS).collect();
  }

  // A page that yields almost nothing is usually a consent wall, a login
  // page, or a client-rendered app. Saying so is more useful than handing
  // the model two sentences of navigation text as if it were an article.
  if text.trim().len() < 200 {
    return Err(format!(
      "{url} had no readable article text — it may be a login wall or a script-rendered page."
    ));
  }

  Ok(PageContent {
    url,
    title: extracted.title,
    text,
    truncated,
    published: extracted.published,
  })
}

/// Keeps the first occurrence of each URL, ignoring trailing slashes and
/// tracking parameters so the same article from two engines counts once.
fn dedupe_by_url(results: &mut Vec<SearchResult>) {
  let mut seen = std::collections::HashSet::new();
  results.retain(|r| seen.insert(canonical_url(&r.url)));
}

fn canonical_url(url: &str) -> String {
  let without_query = url.split(['?', '#']).next().unwrap_or(url);
  without_query
    .trim_end_matches('/')
    .trim_start_matches("https://")
    .trim_start_matches("http://")
    .trim_start_matches("www.")
    .to_ascii_lowercase()
}

/// reqwest's own Display hides the real cause behind "error sending
/// request"; walking the source chain surfaces the DNS or TLS failure
/// that actually happened.
fn describe(e: &reqwest::Error) -> String {
  let mut detail = e.to_string();
  let mut source = std::error::Error::source(e);
  while let Some(err) = source {
    detail.push_str(&format!(" -> {err}"));
    source = err.source();
  }
  detail
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn canonicalises_equivalent_urls() {
    assert_eq!(
      canonical_url("https://www.Example.com/article/"),
      canonical_url("http://example.com/article?utm_source=x"),
    );
  }

  #[test]
  fn dedupes_same_article_from_two_engines() {
    let mut results = vec![
      SearchResult {
        title: "A".into(),
        url: "https://example.com/story".into(),
        snippet: String::new(),
        provider: "brave".into(),
      },
      SearchResult {
        title: "A again".into(),
        url: "https://www.example.com/story/?utm_medium=rss".into(),
        snippet: String::new(),
        provider: "duckduckgo".into(),
      },
      SearchResult {
        title: "B".into(),
        url: "https://other.com/thing".into(),
        snippet: String::new(),
        provider: "duckduckgo".into(),
      },
    ];
    dedupe_by_url(&mut results);
    assert_eq!(results.len(), 2);
    // The first occurrence wins, so a paid provider's richer result is
    // kept over the scraped duplicate.
    assert_eq!(results[0].provider, "brave");
  }
}
