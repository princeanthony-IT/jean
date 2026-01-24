// Cross-platform shell detection and command execution

use std::env;
use std::process::Command;

/// Returns the user's default shell path
/// - Unix: Uses $SHELL env var, falls back to /bin/sh
/// - Windows: Returns powershell.exe (for general shell tasks)
#[cfg(unix)]
pub fn get_default_shell() -> String {
    env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

#[cfg(windows)]
pub fn get_default_shell() -> String {
    "powershell.exe".to_string()
}

/// Returns shell and arguments for executing a command string
/// - Unix: (shell, ["-c", cmd])
/// - Windows: (powershell, ["-Command", cmd])
#[cfg(unix)]
pub fn get_shell_command_args(cmd: &str) -> (String, Vec<String>) {
    let shell = get_default_shell();
    (shell, vec!["-c".to_string(), cmd.to_string()])
}

#[cfg(windows)]
pub fn get_shell_command_args(cmd: &str) -> (String, Vec<String>) {
    (
        "powershell.exe".to_string(),
        vec!["-Command".to_string(), cmd.to_string()],
    )
}

/// Creates a Command configured to run a shell command string
pub fn shell_command(cmd: &str) -> Command {
    let (shell, args) = get_shell_command_args(cmd);
    let mut command = Command::new(shell);
    command.args(args);
    command
}

/// Returns shell arguments for a login shell (interactive, sources profile)
/// - Unix: Returns ["-l", "-i", "-c", cmd] for login interactive shell
/// - Windows: Returns standard PowerShell args (no login shell concept)
#[allow(dead_code)]
#[cfg(unix)]
pub fn get_login_shell_args(cmd: &str) -> (String, Vec<String>) {
    let shell = get_default_shell();
    (
        shell,
        vec![
            "-l".to_string(),
            "-i".to_string(),
            "-c".to_string(),
            cmd.to_string(),
        ],
    )
}

#[allow(dead_code)]
#[cfg(windows)]
pub fn get_login_shell_args(cmd: &str) -> (String, Vec<String>) {
    // Windows doesn't have login shell concept, use regular PowerShell
    get_shell_command_args(cmd)
}

/// Check if an executable exists in PATH
#[cfg(target_os = "linux")]
pub fn executable_exists(name: &str) -> bool {
    which::which(name).is_ok()
}

#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
pub fn executable_exists(name: &str) -> bool {
    which::which(name).is_ok()
}

/// Get the path to an executable if it exists
#[allow(dead_code)]
pub fn find_executable(name: &str) -> Option<std::path::PathBuf> {
    which::which(name).ok()
}

// === WSL Support (Windows only) ===

/// Check if WSL is available on Windows
#[cfg(windows)]
pub fn is_wsl_available() -> bool {
    Command::new("wsl")
        .arg("--status")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn is_wsl_available() -> bool {
    false
}

/// Convert a Windows path to WSL path format
/// C:\Users\foo\file.txt -> /mnt/c/Users/foo/file.txt
#[cfg(windows)]
pub fn windows_to_wsl_path(win_path: &str) -> String {
    let path = win_path.replace('\\', "/");
    if path.len() >= 2 && path.chars().nth(1) == Some(':') {
        let drive = path.chars().next().unwrap().to_ascii_lowercase();
        format!("/mnt/{}{}", drive, &path[2..])
    } else {
        path
    }
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn windows_to_wsl_path(path: &str) -> String {
    // On non-Windows, just return the path as-is
    path.to_string()
}

/// Create a Command that runs through WSL (Windows only)
/// Falls back to regular shell command on other platforms
#[cfg(windows)]
pub fn wsl_shell_command(cmd: &str) -> Result<Command, String> {
    if !is_wsl_available() {
        return Err("WSL is required on Windows. Install with: wsl --install".to_string());
    }

    let mut command = Command::new("wsl");
    command.args(["-e", "bash", "-c", cmd]);
    Ok(command)
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn wsl_shell_command(cmd: &str) -> Result<Command, String> {
    // On Unix, just use regular shell
    Ok(shell_command(cmd))
}
