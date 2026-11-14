use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PdfInfo {
  pub path: String,
  pub page_count: u32,
}

fn page_count_of(doc: &Document) -> u32 {
  doc.get_pages().len() as u32
}

/// Rotates the given 1-based pages (all when empty) by a multiple of 90°.
#[tauri::command(async)]
pub fn pdf_tool_rotate(input_path: String, output_path: String, pages: Vec<u32>, degrees: i64) -> Result<PdfInfo, String> {
  let mut doc = Document::load(&input_path).map_err(|e| format!("Failed to load PDF: {e}"))?;
  let all = doc.get_pages();
  for (num, id) in all.iter() {
    if !pages.is_empty() && !pages.contains(num) {
      continue;
    }
    let page = doc.get_object_mut(*id).and_then(|o| o.as_dict_mut()).map_err(|e| e.to_string())?;
    let current = page.get(b"Rotate").and_then(|r| r.as_i64()).unwrap_or(0);
    page.set("Rotate", Object::Integer((current + degrees).rem_euclid(360)));
  }
  doc.save(&output_path).map_err(|e| format!("Failed to save PDF: {e}"))?;
  Ok(PdfInfo { path: output_path, page_count: page_count_of(&doc) })
}

/// Removes the given 1-based pages.
#[tauri::command(async)]
pub fn pdf_tool_delete_pages(input_path: String, output_path: String, pages: Vec<u32>) -> Result<PdfInfo, String> {
  let mut doc = Document::load(&input_path).map_err(|e| format!("Failed to load PDF: {e}"))?;
  if pages.is_empty() {
    return Err("Choose at least one page to remove".into());
  }
  if pages.len() as u32 >= page_count_of(&doc) {
    return Err("That would remove every page".into());
  }
  doc.delete_pages(&pages);
  doc.prune_objects();
  doc.save(&output_path).map_err(|e| format!("Failed to save PDF: {e}"))?;
  Ok(PdfInfo { path: output_path, page_count: page_count_of(&doc) })
}

/// Rewrites the file with compressed streams and unused objects removed.
/// Returns (before, after) sizes in bytes.
#[tauri::command(async)]
pub fn pdf_tool_compress(input_path: String, output_path: String) -> Result<(u64, u64), String> {
  let before = std::fs::metadata(&input_path).map(|m| m.len()).unwrap_or(0);
  let mut doc = Document::load(&input_path).map_err(|e| format!("Failed to load PDF: {e}"))?;
  doc.prune_objects();
  doc.delete_zero_length_streams();
  doc.compress();
  doc.save(&output_path).map_err(|e| format!("Failed to save PDF: {e}"))?;
  let after = std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
  Ok((before, after))
}

#[tauri::command(async)]
pub fn pdf_tool_inspect(file_path: String) -> Result<PdfInfo, String> {
  let doc = Document::load(&file_path).map_err(|e| format!("Failed to load PDF: {e}"))?;
  Ok(PdfInfo { path: file_path, page_count: page_count_of(&doc) })
}

/// Merges multiple PDFs into one, in the given order. Ports the page-tree-stitching approach
/// from lopdf's own `merge` example: renumber each source document's objects into a shared ID
/// space, then rebuild a single Catalog/Pages tree pointing at every page across all inputs.
#[tauri::command(async)]
pub fn pdf_tool_merge(input_paths: Vec<String>, output_path: String) -> Result<PdfInfo, String> {
  if input_paths.len() < 2 {
    return Err("Provide at least two PDFs to merge".to_string());
  }

  let mut max_id = 1;
  let mut documents_pages: BTreeMap<ObjectId, Object> = BTreeMap::new();
  let mut documents_objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
  let mut document = Document::with_version("1.5");

  for path in &input_paths {
    let mut doc = Document::load(path).map_err(|e| format!("Failed to load {path}: {e}"))?;
    doc.renumber_objects_with(max_id);
    max_id = doc.max_id + 1;

    documents_pages.extend(
      doc
        .get_pages()
        .into_values()
        .map(|object_id| (object_id, doc.get_object(object_id).unwrap().to_owned())),
    );
    documents_objects.extend(doc.objects);
  }

  let mut catalog_object: Option<(ObjectId, Object)> = None;
  let mut pages_object: Option<(ObjectId, Object)> = None;

  for (object_id, object) in documents_objects.into_iter() {
    match object.type_name().unwrap_or(b"") {
      b"Catalog" => {
        catalog_object = Some((catalog_object.map(|(id, _)| id).unwrap_or(object_id), object));
      }
      b"Pages" => {
        if let Ok(dictionary) = object.as_dict() {
          let mut dictionary = dictionary.clone();
          if let Some((_, ref old)) = pages_object {
            if let Ok(old_dict) = old.as_dict() {
              dictionary.extend(old_dict);
            }
          }
          pages_object = Some((pages_object.map(|(id, _)| id).unwrap_or(object_id), Object::Dictionary(dictionary)));
        }
      }
      b"Page" => {}
      b"Outlines" | b"Outline" => {}
      _ => {
        document.objects.insert(object_id, object);
      }
    }
  }

  let (pages_id, pages_object) = pages_object.ok_or("No page tree found in inputs")?;
  let (catalog_id, catalog_object) = catalog_object.ok_or("No document catalog found in inputs")?;

  for (object_id, object) in documents_pages.iter() {
    if let Ok(dictionary) = object.as_dict() {
      let mut dictionary = dictionary.clone();
      dictionary.set("Parent", pages_id);
      document.objects.insert(*object_id, Object::Dictionary(dictionary));
    }
  }

  if let Ok(dictionary) = pages_object.as_dict() {
    let mut dictionary = dictionary.clone();
    dictionary.set("Count", documents_pages.len() as u32);
    dictionary.set(
      "Kids",
      documents_pages.keys().map(|id| Object::Reference(*id)).collect::<Vec<_>>(),
    );
    document.objects.insert(pages_id, Object::Dictionary(dictionary));
  }

  if let Ok(dictionary) = catalog_object.as_dict() {
    let mut dictionary = dictionary.clone();
    dictionary.set("Pages", pages_id);
    dictionary.remove(b"Outlines");
    document.objects.insert(catalog_id, Object::Dictionary(dictionary));
  }

  document.trailer.set("Root", catalog_id);
  document.max_id = document.objects.len() as u32;
  document.renumber_objects();
  document.compress();

  document.save(&output_path).map_err(|e| format!("Failed to save merged PDF: {e}"))?;
  Ok(PdfInfo { path: output_path, page_count: documents_pages.len() as u32 })
}

/// Splits a PDF into one file per page (or per page range, if `ranges` is given as
/// `start-end` 1-indexed inclusive strings). Each output is a clone of the source document
/// with every page outside the target range deleted via lopdf's own `delete_pages`, which
/// keeps all fonts/resources/structure intact rather than hand-rebuilding a page tree.
#[tauri::command(async)]
pub fn pdf_tool_split(
  input_path: String,
  output_dir: String,
  ranges: Option<Vec<String>>,
) -> Result<Vec<PdfInfo>, String> {
  let source = Document::load(&input_path).map_err(|e| format!("Failed to load PDF: {e}"))?;
  let total_pages = page_count_of(&source);
  if total_pages == 0 {
    return Err("Source PDF has no pages".to_string());
  }

  let page_ranges: Vec<(u32, u32)> = match ranges {
    Some(specs) if !specs.is_empty() => specs
      .iter()
      .map(|spec| parse_range(spec, total_pages))
      .collect::<Result<Vec<_>, String>>()?,
    _ => (1..=total_pages).map(|p| (p, p)).collect(),
  };

  std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
  let stem = Path::new(&input_path)
    .file_stem()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| "document".to_string());

  let mut results = Vec::new();
  for (idx, (start, end)) in page_ranges.iter().enumerate() {
    let mut doc = Document::load(&input_path).map_err(|e| format!("Failed to reload PDF: {e}"))?;
    let to_delete: Vec<u32> = (1..=total_pages).filter(|p| *p < *start || *p > *end).collect();
    doc.delete_pages(&to_delete);

    let file_name = if start == end {
      format!("{stem}-page-{start}.pdf")
    } else {
      format!("{stem}-pages-{start}-{end}.pdf")
    };
    let out_path = Path::new(&output_dir).join(&file_name);
    doc.save(&out_path).map_err(|e| format!("Failed to save split part {idx}: {e}"))?;
    results.push(PdfInfo {
      path: out_path.to_string_lossy().to_string(),
      page_count: end - start + 1,
    });
  }

  Ok(results)
}

fn parse_range(spec: &str, total_pages: u32) -> Result<(u32, u32), String> {
  let parts: Vec<&str> = spec.split('-').collect();
  let (start, end) = match parts.as_slice() {
    [single] => {
      let p = single.trim().parse::<u32>().map_err(|_| format!("Invalid page number: {single}"))?;
      (p, p)
    }
    [a, b] => {
      let start = a.trim().parse::<u32>().map_err(|_| format!("Invalid range start: {a}"))?;
      let end = b.trim().parse::<u32>().map_err(|_| format!("Invalid range end: {b}"))?;
      (start, end)
    }
    _ => return Err(format!("Invalid page range: {spec}")),
  };
  if start == 0 || end < start || end > total_pages {
    return Err(format!("Page range {spec} is out of bounds (document has {total_pages} pages)"));
  }
  Ok((start, end))
}

/// Basic annotate: stamps a line of text onto one page at a caller-given position. Appends a
/// new content stream to the page's existing "Contents" array rather than replacing it, so the
/// page's original content is preserved underneath the stamp.
#[tauri::command(async)]
pub fn pdf_tool_stamp_text(
  input_path: String,
  output_path: String,
  page_number: u32,
  text: String,
  x: f32,
  y: f32,
  font_size: f32,
) -> Result<PdfInfo, String> {
  let mut doc = Document::load(&input_path).map_err(|e| format!("Failed to load PDF: {e}"))?;
  let pages = doc.get_pages();
  let page_id = *pages.get(&page_number).ok_or_else(|| format!("Page {page_number} does not exist"))?;

  let font_id = doc.add_object(dictionary! {
    "Type" => "Font",
    "Subtype" => "Type1",
    "BaseFont" => "Helvetica",
  });

  let page_dict = doc.get_dictionary(page_id).map_err(|e| e.to_string())?.clone();
  let resources_id = match page_dict.get(b"Resources") {
    Ok(Object::Reference(id)) => *id,
    _ => doc.add_object(dictionary! {}),
  };
  if let Ok(Object::Dictionary(resources)) = doc.get_object_mut(resources_id) {
    let fonts = match resources.get(b"Font") {
      Ok(Object::Dictionary(existing)) => {
        let mut fonts = existing.clone();
        fonts.set("Stamp", font_id);
        fonts
      }
      _ => dictionary! { "Stamp" => font_id },
    };
    resources.set("Font", Object::Dictionary(fonts));
  } else {
    doc.objects.insert(
      resources_id,
      Object::Dictionary(dictionary! { "Font" => dictionary! { "Stamp" => font_id } }),
    );
  }

  let content = Content {
    operations: vec![
      Operation::new("BT", vec![]),
      Operation::new("Tf", vec!["Stamp".into(), font_size.into()]),
      Operation::new("Td", vec![x.into(), y.into()]),
      Operation::new("Tj", vec![Object::string_literal(text.clone())]),
      Operation::new("ET", vec![]),
    ],
  };
  let stamp_stream_id = doc.add_object(Stream::new(dictionary! {}, content.encode().map_err(|e| e.to_string())?));

  let mut page_dict = page_dict;
  page_dict.set("Resources", resources_id);
  let new_contents = match page_dict.get(b"Contents") {
    Ok(Object::Array(existing)) => {
      let mut arr = existing.clone();
      arr.push(Object::Reference(stamp_stream_id));
      Object::Array(arr)
    }
    Ok(Object::Reference(existing_id)) => Object::Array(vec![Object::Reference(*existing_id), Object::Reference(stamp_stream_id)]),
    _ => Object::Reference(stamp_stream_id),
  };
  page_dict.set("Contents", new_contents);
  doc.objects.insert(page_id, Object::Dictionary(page_dict));

  doc.save(&output_path).map_err(|e| format!("Failed to save stamped PDF: {e}"))?;
  Ok(PdfInfo { path: output_path, page_count: page_count_of(&doc) })
}

/// Generates a small multi-page PDF for smoke-testing merge/split/stamp without needing a
/// user-supplied sample file. Uses the same content-stream pattern as lopdf's own examples.
#[tauri::command(async)]
pub fn pdf_tool_generate_sample(output_path: String, page_count: u32, title: String) -> Result<PdfInfo, String> {
  let mut doc = Document::with_version("1.5");
  let pages_id = doc.new_object_id();
  let font_id = doc.add_object(dictionary! {
    "Type" => "Font",
    "Subtype" => "Type1",
    "BaseFont" => "Helvetica",
  });
  let resources_id = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });

  let mut kids = Vec::new();
  for i in 1..=page_count.max(1) {
    let content = Content {
      operations: vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec!["F1".into(), 24.into()]),
        Operation::new("Td", vec![72.into(), 700.into()]),
        Operation::new("Tj", vec![Object::string_literal(format!("{title} — page {i}"))]),
        Operation::new("ET", vec![]),
      ],
    };
    let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().map_err(|e| e.to_string())?));
    let page_id = doc.add_object(dictionary! {
      "Type" => "Page",
      "Parent" => pages_id,
      "Contents" => content_id,
      "Resources" => resources_id,
      "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
    });
    kids.push(Object::Reference(page_id));
  }

  let pages = dictionary! {
    "Type" => "Pages",
    "Kids" => kids.clone(),
    "Count" => kids.len() as u32,
  };
  doc.objects.insert(pages_id, Object::Dictionary(pages));
  let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
  doc.trailer.set("Root", catalog_id);
  doc.compress();
  doc.save(&output_path).map_err(|e| format!("Failed to save sample PDF: {e}"))?;

  Ok(PdfInfo { path: output_path, page_count: kids.len() as u32 })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn scratch_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("udaan-pdf-test-{label}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  /// Real end-to-end: generate two real sample PDFs, load them back with `Document::load` to
  /// confirm they're valid files (not just "a save() call didn't error"), then verify page
  /// counts via lopdf's own page tree walk.
  #[test]
  fn generate_sample_produces_a_loadable_pdf_with_correct_page_count() {
    let dir = scratch_dir("generate");
    let out = dir.join("sample.pdf");
    let info = pdf_tool_generate_sample(out.to_string_lossy().to_string(), 3, "Test Doc".to_string()).unwrap();
    assert_eq!(info.page_count, 3);

    let reloaded = Document::load(&out).unwrap();
    assert_eq!(page_count_of(&reloaded), 3);
  }

  #[test]
  fn merge_combines_page_counts_from_all_inputs() {
    let dir = scratch_dir("merge");
    let a = dir.join("a.pdf");
    let b = dir.join("b.pdf");
    pdf_tool_generate_sample(a.to_string_lossy().to_string(), 2, "A".to_string()).unwrap();
    pdf_tool_generate_sample(b.to_string_lossy().to_string(), 3, "B".to_string()).unwrap();

    let out = dir.join("merged.pdf");
    let info = pdf_tool_merge(
      vec![a.to_string_lossy().to_string(), b.to_string_lossy().to_string()],
      out.to_string_lossy().to_string(),
    )
    .unwrap();
    assert_eq!(info.page_count, 5);

    let reloaded = Document::load(&out).unwrap();
    assert_eq!(page_count_of(&reloaded), 5);
  }

  #[test]
  fn merge_rejects_fewer_than_two_inputs() {
    let dir = scratch_dir("merge-reject");
    let a = dir.join("a.pdf");
    pdf_tool_generate_sample(a.to_string_lossy().to_string(), 1, "A".to_string()).unwrap();
    let result = pdf_tool_merge(vec![a.to_string_lossy().to_string()], dir.join("out.pdf").to_string_lossy().to_string());
    assert!(result.is_err());
  }

  #[test]
  fn split_one_file_per_page_by_default() {
    let dir = scratch_dir("split-default");
    let src = dir.join("source.pdf");
    pdf_tool_generate_sample(src.to_string_lossy().to_string(), 4, "Split Me".to_string()).unwrap();

    let out_dir = dir.join("out");
    let results = pdf_tool_split(src.to_string_lossy().to_string(), out_dir.to_string_lossy().to_string(), None).unwrap();
    assert_eq!(results.len(), 4);
    for r in &results {
      assert_eq!(r.page_count, 1);
      let reloaded = Document::load(&r.path).unwrap();
      assert_eq!(page_count_of(&reloaded), 1);
    }
  }

  #[test]
  fn split_respects_explicit_ranges() {
    let dir = scratch_dir("split-ranges");
    let src = dir.join("source.pdf");
    pdf_tool_generate_sample(src.to_string_lossy().to_string(), 6, "Ranges".to_string()).unwrap();

    let out_dir = dir.join("out");
    let results = pdf_tool_split(
      src.to_string_lossy().to_string(),
      out_dir.to_string_lossy().to_string(),
      Some(vec!["1-2".to_string(), "3-6".to_string()]),
    )
    .unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].page_count, 2);
    assert_eq!(results[1].page_count, 4);

    let reloaded_first = Document::load(&results[0].path).unwrap();
    assert_eq!(page_count_of(&reloaded_first), 2);
  }

  #[test]
  fn split_rejects_out_of_bounds_range() {
    let dir = scratch_dir("split-oob");
    let src = dir.join("source.pdf");
    pdf_tool_generate_sample(src.to_string_lossy().to_string(), 2, "OOB".to_string()).unwrap();

    let result = pdf_tool_split(
      src.to_string_lossy().to_string(),
      dir.join("out").to_string_lossy().to_string(),
      Some(vec!["1-5".to_string()]),
    );
    assert!(result.is_err());
  }

  #[test]
  fn stamp_text_preserves_page_count_and_adds_content() {
    let dir = scratch_dir("stamp");
    let src = dir.join("source.pdf");
    pdf_tool_generate_sample(src.to_string_lossy().to_string(), 2, "Stamp Me".to_string()).unwrap();

    let out = dir.join("stamped.pdf");
    let info = pdf_tool_stamp_text(
      src.to_string_lossy().to_string(),
      out.to_string_lossy().to_string(),
      1,
      "CONFIDENTIAL".to_string(),
      100.0,
      50.0,
      14.0,
    )
    .unwrap();
    assert_eq!(info.page_count, 2);

    // Original file is untouched; the stamped copy is a valid, separately loadable PDF.
    let original_bytes = std::fs::read(&src).unwrap();
    let stamped_bytes = std::fs::read(&out).unwrap();
    assert_ne!(original_bytes, stamped_bytes);

    let reloaded = Document::load(&out).unwrap();
    assert_eq!(page_count_of(&reloaded), 2);
  }

  #[test]
  fn stamp_text_rejects_nonexistent_page() {
    let dir = scratch_dir("stamp-oob");
    let src = dir.join("source.pdf");
    pdf_tool_generate_sample(src.to_string_lossy().to_string(), 1, "Solo".to_string()).unwrap();

    let result = pdf_tool_stamp_text(
      src.to_string_lossy().to_string(),
      dir.join("out.pdf").to_string_lossy().to_string(),
      5,
      "Nope".to_string(),
      0.0,
      0.0,
      12.0,
    );
    assert!(result.is_err());
  }
}

