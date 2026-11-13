//! A tiny local web server for the menu bar's motivation video.
//!
//! YouTube refuses to embed a player into the app's own internal origin
//! ("error 153"), but accepts a normal local address. So Udaan serves one
//! static page on 127.0.0.1 (loopback only, random port, no other routes);
//! that page hosts the YouTube player and relays messages to and from the
//! menu bar.

use std::sync::OnceLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

static PORT: OnceLock<u16> = OnceLock::new();
const PAGE: &str = include_str!("focus_video.html");

pub fn start() {
  tauri::async_runtime::spawn(async {
    let Ok(listener) = TcpListener::bind("127.0.0.1:0").await else {
      log::warn!("[focus-video] couldn't open a local port");
      return;
    };
    let Ok(addr) = listener.local_addr() else { return };
    let _ = PORT.set(addr.port());
    loop {
      let Ok((mut socket, _)) = listener.accept().await else { continue };
      tauri::async_runtime::spawn(async move {
        // Whatever was asked for, the answer is the one page; read the request so the client isn't cut off.
        let mut request = [0u8; 2048];
        let _ = socket.read(&mut request).await;
        let response = format!(
          "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{PAGE}",
          PAGE.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
      });
    }
  });
}

/// The port the page is served on, once the server is up.
#[tauri::command]
pub fn focus_video_port() -> Option<u16> {
  PORT.get().copied()
}
