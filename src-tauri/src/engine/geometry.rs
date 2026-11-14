//! Shapes shared by the engine: one rectangle type, with the arithmetic everything needs.

use serde::{Deserialize, Serialize};

/// A rectangle in screen pixels (left/top inclusive, right/bottom exclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
  pub left: i32,
  pub top: i32,
  pub right: i32,
  pub bottom: i32,
}

impl Rect {
  pub fn width(&self) -> i32 {
    self.right - self.left
  }
  pub fn height(&self) -> i32 {
    self.bottom - self.top
  }
  /// True if `self` covers all of `other`.
  pub fn covers(&self, other: &Rect) -> bool {
    self.left <= other.left && self.top <= other.top && self.right >= other.right && self.bottom >= other.bottom
  }
}

impl From<windows::Win32::Foundation::RECT> for Rect {
  fn from(r: windows::Win32::Foundation::RECT) -> Self {
    Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }
}

impl From<Rect> for windows::Win32::Foundation::RECT {
  fn from(r: Rect) -> Self {
    windows::Win32::Foundation::RECT { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }
}
