// Cross-platform process management

use std::process::Command;

/// Creates a Command that won't open a console window on Windows.
/// Use for all background operations (git, gh, claude CLI, etc.).
/// Do NOT use for commands that intentionally open UI (terminals, editors, file explorers).
pub fn silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Check if a process is still alive
/// - Unix: Uses kill(pid, 0) to check
/// - Windows: Uses OpenProcess + GetExitCodeProcess
#[cfg(unix)]
pub fn is_process_alive(pid: u32) -> bool {
    // kill with signal 0 checks if process exists without actually sending a signal
    let result = unsafe { libc::kill(pid as i32, 0) };
    if result == 0 {
        return true;
    }
    // If kill returns -1, check errno
    // EPERM means process exists but we don't have permission (still alive)
    // ESRCH means no such process
    let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
    errno == libc::EPERM
}

#[cfg(windows)]
pub fn is_process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }

        let mut exit_code: u32 = 0;
        let result = GetExitCodeProcess(handle, &mut exit_code);
        CloseHandle(handle);

        result != 0 && exit_code == STILL_ACTIVE as u32
    }
}

/// Kill a single process
/// - Unix: Uses SIGKILL
/// - Windows: Uses TerminateProcess
#[cfg(unix)]
pub fn kill_process(pid: u32) -> Result<(), String> {
    let result = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to kill process {}: {}",
            pid,
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
pub fn kill_process(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return Err(format!(
                "Failed to open process {}: {}",
                pid,
                std::io::Error::last_os_error()
            ));
        }

        let result = TerminateProcess(handle, 1);
        CloseHandle(handle);

        if result != 0 {
            Ok(())
        } else {
            Err(format!(
                "Failed to terminate process {}: {}",
                pid,
                std::io::Error::last_os_error()
            ))
        }
    }
}

/// Kill a process and all its children (process tree)
/// - Unix: Uses kill with negative PID to kill process group
/// - Windows: Uses taskkill /T for tree kill
#[cfg(unix)]
pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    // Negative PID kills the entire process group
    let result = unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
    if result == 0 {
        Ok(())
    } else {
        // If process group kill fails, try killing just the process
        kill_process(pid)
    }
}

#[cfg(windows)]
pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    // Use taskkill with /T flag for tree kill
    let output = silent_command("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .output()
        .map_err(|e| format!("Failed to run taskkill: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("taskkill failed: {}", stderr))
    }
}

/// Send SIGTERM to gracefully terminate a process (Unix only)
/// On Windows, this falls back to TerminateProcess
#[cfg(unix)]
pub fn terminate_process(pid: u32) -> Result<(), String> {
    let result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to terminate process {}: {}",
            pid,
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
pub fn terminate_process(pid: u32) -> Result<(), String> {
    // Windows doesn't have SIGTERM, use TerminateProcess
    kill_process(pid)
}
