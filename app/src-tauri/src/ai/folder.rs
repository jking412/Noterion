//! A scanned folder is a short-lived capability, scoped to one space visit.
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use uuid::Uuid;

/// Cancellation tokens survive a late command start but never affect another request.
#[derive(Default)]
pub struct ScanJobs {
    active: Option<(String, Arc<AtomicBool>)>,
    cancelled: HashSet<String>,
}
impl ScanJobs {
    pub fn begin(&mut self, request_id: String) -> Result<Arc<AtomicBool>, String> {
        if self.cancelled.contains(&request_id) {
            return Err("扫描已取消。".into());
        }
        if self
            .active
            .as_ref()
            .is_some_and(|(id, _)| id == &request_id)
        {
            return Err("这次扫描正在进行。".into());
        }
        if let Some((_, old)) = self.active.take() {
            old.store(true, Ordering::SeqCst);
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        self.active = Some((request_id, cancellation.clone()));
        Ok(cancellation)
    }
    pub fn cancel(&mut self, request_id: &str) {
        self.cancelled.insert(request_id.to_owned());
        if self.active.as_ref().is_some_and(|(id, _)| id == request_id) {
            let (_, cancellation) = self.active.take().unwrap();
            cancellation.store(true, Ordering::SeqCst);
        }
    }
    pub fn finish(&mut self, request_id: &str, cancellation: &Arc<AtomicBool>) {
        if self
            .active
            .as_ref()
            .is_some_and(|(id, token)| id == request_id && Arc::ptr_eq(token, cancellation))
        {
            self.active = None;
        }
    }
    pub fn invalidate(&mut self) {
        if let Some((_, cancellation)) = self.active.take() {
            cancellation.store(true, Ordering::SeqCst);
        }
        self.cancelled.clear();
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub id: String,
    pub relative_path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanWarning {
    pub relative_path: String,
    pub error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub scan_id: String,
    pub files: Vec<FileEntry>,
    pub warnings: Vec<ScanWarning>,
}

#[derive(Clone)]
pub struct ScannedFolder {
    pub space_id: String,
    pub epoch: u64,
    root: PathBuf,
    paths: HashMap<String, PathBuf>,
    files: Vec<FileEntry>,
    warnings: Vec<ScanWarning>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFile {
    pub text: String,
    pub source_name: String,
    #[serde(skip)]
    pub bytes: Vec<u8>,
    #[serde(skip)]
    pub filename: String,
}

impl ScannedFolder {
    #[cfg(test)]
    pub fn scan(root: &Path, space_id: String, epoch: u64) -> Result<Self, String> {
        Self::scan_checked(root, space_id, epoch, || Ok(()))
    }
    pub fn scan_checked(
        root: &Path,
        space_id: String,
        epoch: u64,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Self, String> {
        check()?;
        let metadata =
            fs::symlink_metadata(root).map_err(|_| "无法打开所选文件夹，请重新选择。")?;
        if !metadata.is_dir() || is_link(&metadata) {
            return Err("请选择普通文件夹。".into());
        }
        let root = fs::canonicalize(root).map_err(|_| "无法打开所选文件夹，请重新选择。")?;
        let mut result = Self {
            space_id,
            epoch,
            root,
            paths: HashMap::new(),
            files: vec![],
            warnings: vec![],
        };
        let mut pending = vec![PathBuf::new()];
        while let Some(relative) = pending.pop() {
            check()?;
            let directory = result.root.join(&relative);
            if fs::symlink_metadata(&directory).is_ok_and(|metadata| is_link(&metadata)) {
                result.warnings.push(ScanWarning {
                    relative_path: display(&relative),
                    error: "已跳过链接。".into(),
                });
                continue;
            }
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(_) => {
                    result.warnings.push(ScanWarning {
                        relative_path: display(&relative),
                        error: "无法读取文件夹，请检查权限后重新扫描。".into(),
                    });
                    continue;
                }
            };
            for entry in entries {
                check()?;
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        result.warnings.push(ScanWarning {
                            relative_path: display(&relative),
                            error: "部分目录项无法读取，请检查权限后重新扫描。".into(),
                        });
                        continue;
                    }
                };
                let relative = relative.join(entry.file_name());
                let metadata = match fs::symlink_metadata(entry.path()) {
                    Ok(metadata) => metadata,
                    Err(_) => {
                        if note_path(&relative) {
                            result.add(
                                relative,
                                0,
                                Some("无法读取文件，请检查权限后重试。".into()),
                            );
                        } else {
                            result.warnings.push(ScanWarning {
                                relative_path: display(&relative),
                                error: "无法识别目录项，请检查权限后重新扫描。".into(),
                            });
                        }
                        continue;
                    }
                };
                if is_link(&metadata) {
                    result.warnings.push(ScanWarning {
                        relative_path: display(&relative),
                        error: "已跳过链接。".into(),
                    });
                } else if metadata.is_dir() {
                    pending.push(relative);
                } else if metadata.is_file() && note_path(&relative) {
                    let error = (metadata.len() > 256 * 1024)
                        .then(|| "文件超过 256 KiB，请拆分后重新扫描。".into());
                    result.add(relative, metadata.len(), error);
                }
            }
        }
        result
            .files
            .sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        result
            .warnings
            .sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        Ok(result)
    }

    fn add(&mut self, relative: PathBuf, size: u64, error: Option<String>) {
        let id = Uuid::new_v4().to_string();
        self.files.push(FileEntry {
            id: id.clone(),
            relative_path: display(&relative),
            size,
            error,
        });
        self.paths.insert(id, relative);
    }

    pub fn preview(&self, scan_id: String) -> Scan {
        Scan {
            scan_id,
            files: self.files.clone(),
            warnings: self.warnings.clone(),
        }
    }

    pub fn read(&self, file_id: &str) -> Result<ReadFile, String> {
        let relative = self
            .paths
            .get(file_id)
            .ok_or("文件不在本次清单中，请重新扫描。")?;
        let mut path = self.root.clone();
        for part in relative.components() {
            path.push(part);
            let metadata = fs::symlink_metadata(&path)
                .map_err(|_| "文件无法读取，请检查路径和权限后重试。")?;
            if is_link(&metadata) {
                return Err("文件路径已变为链接，请重新扫描。".into());
            }
        }
        if fs::canonicalize(&path).ok().as_ref() != Some(&path) {
            return Err("文件路径已改变，请重新扫描。".into());
        }
        let file = fs::File::open(&path).map_err(|_| "文件无法读取，请检查路径和权限后重试。")?;
        let metadata = file.metadata().map_err(|_| "无法读取文件信息，请重试。")?;
        if !metadata.is_file() {
            return Err("所选路径已不是文件，请重新扫描。".into());
        }
        if metadata.len() > 256 * 1024 {
            return Err("文件超过 256 KiB，请拆分后重新扫描。".into());
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(256 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "读取文件中断，请重试。")?;
        if bytes.len() > 256 * 1024 {
            return Err("文件超过 256 KiB，请拆分后重新扫描。".into());
        }
        if bytes.len() != metadata.len() as usize {
            return Err("文件读取期间已变化，请重试。".into());
        }
        let text =
            String::from_utf8(bytes.clone()).map_err(|_| "文件不是 UTF-8，请转换编码后重试。")?;
        let filename = relative
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("文件名无法读取，请重命名后重新扫描。")?
            .to_owned();
        Ok(ReadFile {
            text: text.trim_start_matches('\u{feff}').to_owned(),
            source_name: display(relative),
            bytes,
            filename,
        })
    }
}

fn note_path(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("txt"))
}
fn display(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Folder(PathBuf);
    impl Folder {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("noterion-folder-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn folder_scan_lists_every_nested_note_by_relative_path() {
        let folder = Folder::new();
        std::fs::create_dir(folder.0.join("nested")).unwrap();
        for name in [
            "a.MD",
            "same.txt",
            "nested/same.TXT",
            "nested/b.md",
            "image.png",
        ] {
            std::fs::write(folder.0.join(name), "学习笔记").unwrap();
        }
        let scan = ScannedFolder::scan(&folder.0, "space-a".into(), 7).unwrap();
        let paths: Vec<_> = scan
            .files
            .iter()
            .map(|f| f.relative_path.as_str())
            .collect();
        assert_eq!(
            paths,
            ["a.MD", "nested/b.md", "nested/same.TXT", "same.txt"]
        );
        assert!(scan.warnings.is_empty());
    }

    #[test]
    fn per_file_read_rejects_encoding_and_size_errors_without_truncating() {
        let folder = Folder::new();
        std::fs::write(folder.0.join("valid.md"), "\u{feff}你好").unwrap();
        std::fs::write(folder.0.join("invalid.txt"), [0xff, 0xfe]).unwrap();
        std::fs::write(folder.0.join("large.md"), vec![b'x'; 256 * 1024 + 1]).unwrap();
        let scan = ScannedFolder::scan(&folder.0, "space-a".into(), 7).unwrap();
        let id = |name: &str| {
            scan.files
                .iter()
                .find(|f| f.relative_path == name)
                .unwrap()
                .id
                .clone()
        };
        assert_eq!(scan.read(&id("valid.md")).unwrap().text, "你好");
        assert!(scan
            .read(&id("invalid.txt"))
            .err()
            .unwrap()
            .contains("UTF-8"));
        assert!(scan
            .read(&id("large.md"))
            .err()
            .unwrap()
            .contains("256 KiB"));
    }

    #[test]
    fn interrupted_scan_returns_no_partial_success() {
        let folder = Folder::new();
        std::fs::write(folder.0.join("a.md"), "笔记").unwrap();
        let checks = std::cell::Cell::new(0);
        let result = ScannedFolder::scan_checked(&folder.0, "space-a".into(), 7, || {
            checks.set(checks.get() + 1);
            if checks.get() >= 3 {
                Err("空间已切换".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(result.err().as_deref(), Some("空间已切换"));
    }

    #[test]
    fn file_removed_after_scan_is_reported_and_can_be_retried() {
        let folder = Folder::new();
        std::fs::write(folder.0.join("a.md"), "初始内容").unwrap();
        let scan = ScannedFolder::scan(&folder.0, "space-a".into(), 7).unwrap();
        let id = &scan.files[0].id;
        std::fs::remove_file(folder.0.join("a.md")).unwrap();
        assert!(scan.read(id).is_err());
        std::fs::write(folder.0.join("a.md"), "修正内容").unwrap();
        assert_eq!(scan.read(id).unwrap().text, "修正内容");
    }

    #[test]
    fn cancelling_a_live_scan_stops_traversal_without_cancelling_the_next_scan() {
        use std::sync::{mpsc, Arc, Mutex};
        let folder = Folder::new();
        std::fs::write(folder.0.join("a.md"), "笔记").unwrap();
        let jobs = Arc::new(Mutex::new(ScanJobs::default()));
        let old = jobs.lock().unwrap().begin("old-request".into()).unwrap();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (continue_tx, continue_rx) = mpsc::channel();
        let path = folder.0.clone();
        let worker = std::thread::spawn(move || {
            let count = std::cell::Cell::new(0);
            ScannedFolder::scan_checked(&path, "space-a".into(), 7, || {
                count.set(count.get() + 1);
                if count.get() == 3 {
                    entered_tx.send(()).unwrap();
                    continue_rx.recv().unwrap();
                }
                if old.load(std::sync::atomic::Ordering::SeqCst) {
                    Err("扫描已取消。".into())
                } else {
                    Ok(())
                }
            })
        });
        entered_rx.recv().unwrap();
        jobs.lock().unwrap().cancel("old-request");
        let next = jobs.lock().unwrap().begin("new-request".into()).unwrap();
        jobs.lock().unwrap().cancel("old-request");
        continue_tx.send(()).unwrap();
        assert_eq!(
            worker.join().unwrap().err().as_deref(),
            Some("扫描已取消。")
        );
        assert!(!next.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn cancellation_arriving_before_start_rejects_that_request_only() {
        let mut jobs = ScanJobs::default();
        jobs.cancel("cancelled-request");
        assert!(jobs.begin("cancelled-request".into()).is_err());
        assert!(jobs.begin("next-request".into()).is_ok());
    }
}
