// Tao sets the title-bar (ICON_SMALL) and taskbar (ICON_BIG) separately on Windows.
// Tauri's builder icon covers the title bar; use the EXE's multi-size resource for
// the taskbar, selected at this window's current scale factor.
#[cfg(windows)]
pub fn set_taskbar_icon(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        LoadImageW, SendMessageW, ICON_BIG, IMAGE_ICON, LR_SHARED, WM_SETICON,
    };
    let hwnd = window.hwnd()?.0;
    let size = (32.0 * window.scale_factor()?).round() as i32;
    // Resource 32512 is embedded by tauri-build from bundle.icon. LR_SHARED
    // leaves ownership with Windows; do not destroy this process-wide handle.
    unsafe {
        let module = GetModuleHandleW(std::ptr::null());
        if module.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let icon = LoadImageW(
            module,
            32512usize as *const u16,
            IMAGE_ICON,
            size,
            size,
            LR_SHARED,
        );
        if icon.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, icon as isize);
    }
    Ok(())
}
