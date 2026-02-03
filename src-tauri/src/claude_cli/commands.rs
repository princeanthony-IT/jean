//! Tauri commands for Claude CLI management

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use tauri::AppHandle;

use super::config::{ensure_cli_dir, get_cli_binary_path};
use crate::http_server::EmitExt;
use crate::platform::silent_command;

/// Extract semver version number from a version string
/// Handles formats like: "1.0.28", "v1.0.28", "Claude CLI 1.0.28"
fn extract_version_number(version_str: &str) -> String {
    // Try to find a semver-like pattern (digits.digits.digits)
    for word in version_str.split_whitespace() {
        let trimmed = word.trim_start_matches('v');
        // Check if it looks like a version number (starts with digit, contains dots)
        if trimmed
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
            && trimmed.contains('.')
        {
            return trimmed.to_string();
        }
    }
    // Fallback: return original string
    version_str.to_string()
}

/// Base URL for Claude CLI binary distribution
const CLAUDE_DIST_BUCKET: &str =
    "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";

/// Status of the Claude CLI installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCliStatus {
    /// Whether Claude CLI is installed
    pub installed: bool,
    /// Installed version (if any)
    pub version: Option<String>,
    /// Path to the CLI binary (if installed)
    pub path: Option<String>,
}

/// Information about a Claude CLI release from GitHub
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseInfo {
    /// Version string (e.g., "1.0.0")
    pub version: String,
    /// Git tag name (e.g., "v1.0.0")
    pub tag_name: String,
    /// Publication date in ISO format
    pub published_at: String,
    /// Whether this is a prerelease
    pub prerelease: bool,
}

/// Progress event for CLI installation
#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    /// Current stage of installation
    pub stage: String,
    /// Progress message
    pub message: String,
    /// Percentage complete (0-100)
    pub percent: u8,
}

/// Check if Claude CLI is installed and get its status
#[tauri::command]
pub async fn check_claude_cli_installed(app: AppHandle) -> Result<ClaudeCliStatus, String> {
    log::trace!("Checking Claude CLI installation status");

    let binary_path = get_cli_binary_path(&app)?;

    if !binary_path.exists() {
        log::trace!("Claude CLI not found at {:?}", binary_path);
        return Ok(ClaudeCliStatus {
            installed: false,
            version: None,
            path: None,
        });
    }

    // Try to get the version by running claude --version
    // Use the binary directly - shell wrapper causes PowerShell parsing issues on Windows
    let version = match silent_command(&binary_path).arg("--version").output() {
        Ok(output) => {
            if output.status.success() {
                let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                log::trace!("Claude CLI raw version output: {}", version_str);
                // claude --version returns just the version number like "1.0.28"
                // but handle any prefix like "v1.0.28" or "Claude CLI 1.0.28"
                let version = extract_version_number(&version_str);
                log::trace!("Claude CLI parsed version: {}", version);
                Some(version)
            } else {
                log::warn!("Failed to get Claude CLI version");
                None
            }
        }
        Err(e) => {
            log::warn!("Failed to execute Claude CLI: {}", e);
            None
        }
    };

    Ok(ClaudeCliStatus {
        installed: true,
        version,
        path: Some(binary_path.to_string_lossy().to_string()),
    })
}

/// npm package metadata for version listing
#[derive(Debug, Deserialize)]
struct NpmPackageInfo {
    versions: std::collections::HashMap<String, serde_json::Value>,
    time: std::collections::HashMap<String, String>,
}

/// Platform-specific release information from manifest
#[derive(Debug, Deserialize)]
struct PlatformInfo {
    checksum: String,
}

/// Release manifest containing checksums for all platforms
#[derive(Debug, Deserialize)]
struct Manifest {
    platforms: std::collections::HashMap<String, PlatformInfo>,
}

/// Get available Claude CLI versions from npm registry
#[tauri::command]
pub async fn get_available_cli_versions() -> Result<Vec<ReleaseInfo>, String> {
    log::trace!("Fetching available Claude CLI versions from npm registry");

    let client = reqwest::Client::new();
    let response = client
        .get("https://registry.npmjs.org/@anthropic-ai/claude-code")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch versions: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "npm registry returned status: {}",
            response.status()
        ));
    }

    let package_info: NpmPackageInfo = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse npm response: {e}"))?;

    // Get versions with their publish times
    let mut versions: Vec<ReleaseInfo> = package_info
        .versions
        .keys()
        .map(|version| {
            let published_at = package_info.time.get(version).cloned().unwrap_or_default();
            ReleaseInfo {
                version: version.clone(),
                tag_name: format!("v{version}"),
                published_at,
                prerelease: version.contains('-'), // e.g., 1.0.0-beta
            }
        })
        .collect();

    // Sort by version descending (newest first) using simple string comparison
    // This works for semver since we compare major.minor.patch numerically
    versions.sort_by(|a, b| {
        let a_parts: Vec<u32> = a
            .version
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        let b_parts: Vec<u32> = b
            .version
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        b_parts.cmp(&a_parts)
    });

    // Take only the 5 most recent versions
    versions.truncate(5);

    log::trace!("Found {} Claude CLI versions", versions.len());
    Ok(versions)
}

/// Fetch the latest version string from the distribution bucket
async fn fetch_latest_version() -> Result<String, String> {
    let url = format!("{CLAUDE_DIST_BUCKET}/latest");
    log::trace!("Fetching latest version from {url}");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch stable version: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch stable version: HTTP {}",
            response.status()
        ));
    }

    let version = response
        .text()
        .await
        .map_err(|e| format!("Failed to read latest version: {e}"))?
        .trim()
        .to_string();

    log::trace!("Latest version: {version}");
    Ok(version)
}

/// Get the platform string for the current system
fn get_platform() -> Result<&'static str, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok("darwin-arm64");
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok("darwin-x64");
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok("linux-x64");
    }

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Ok("linux-arm64");
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Ok("win32-x64");
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

/// Fetch the release manifest containing checksums for all platforms
async fn fetch_manifest(version: &str) -> Result<Manifest, String> {
    let url = format!("{CLAUDE_DIST_BUCKET}/{version}/manifest.json");
    log::trace!("Fetching manifest from {url}");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch manifest: HTTP {}",
            response.status()
        ));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse manifest: {e}"))
}

/// Verify SHA256 checksum of downloaded data
fn verify_checksum(data: &[u8], expected: &str) -> Result<(), String> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let computed = format!("{:x}", hasher.finalize());

    if computed != expected.to_lowercase() {
        return Err(format!(
            "Checksum mismatch: expected {expected}, got {computed}"
        ));
    }
    Ok(())
}

/// Install Claude CLI by downloading the binary directly from Anthropic's distribution bucket
#[tauri::command]
pub async fn install_claude_cli(app: AppHandle, version: Option<String>) -> Result<(), String> {
    log::trace!("Installing Claude CLI, version: {:?}", version);

    // Check if any Claude processes are running - cannot replace binary while in use
    let running_sessions = crate::chat::registry::get_running_sessions();
    if !running_sessions.is_empty() {
        let count = running_sessions.len();
        return Err(format!(
            "Cannot install Claude CLI while {} Claude {} running. Please stop all active sessions first.",
            count,
            if count == 1 { "session is" } else { "sessions are" }
        ));
    }

    let _cli_dir = ensure_cli_dir(&app)?;
    let binary_path = get_cli_binary_path(&app)?;

    // Emit progress: starting
    emit_progress(&app, "starting", "Preparing installation...", 0);

    // Determine version (use provided or fetch stable)
    let version = match version {
        Some(v) => v,
        None => fetch_latest_version().await?,
    };

    // Detect platform
    let platform = get_platform()?;
    log::trace!("Installing version {version} for platform {platform}");

    // Fetch manifest and get expected checksum
    emit_progress(
        &app,
        "fetching_manifest",
        "Fetching release manifest...",
        10,
    );
    let manifest = fetch_manifest(&version).await?;
    let expected_checksum = manifest
        .platforms
        .get(platform)
        .ok_or_else(|| format!("No checksum found for platform {platform}"))?
        .checksum
        .clone();
    log::trace!("Expected checksum for {platform}: {expected_checksum}");

    // Build download URL
    let binary_name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    let download_url = format!("{CLAUDE_DIST_BUCKET}/{version}/{platform}/{binary_name}");
    log::trace!("Downloading from: {download_url}");

    // Emit progress: downloading
    emit_progress(&app, "downloading", "Downloading Claude CLI...", 25);

    // Download the binary
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download Claude CLI: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download Claude CLI: HTTP {}",
            response.status()
        ));
    }

    // Get the binary content
    let binary_content = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read binary content: {e}"))?;

    log::trace!(
        "Downloaded {} bytes, saving to {:?}",
        binary_content.len(),
        binary_path
    );

    // Verify checksum before writing to disk
    emit_progress(&app, "verifying_checksum", "Verifying checksum...", 55);
    verify_checksum(&binary_content, &expected_checksum)?;
    log::trace!("Checksum verified successfully");

    // Emit progress: installing
    emit_progress(&app, "installing", "Installing Claude CLI...", 65);

    // Write the binary to the target path
    log::trace!("Creating binary file at {:?}", binary_path);
    let mut file = std::fs::File::create(&binary_path)
        .map_err(|e| format!("Failed to create binary file: {e}"))?;

    log::trace!("Writing {} bytes to binary file", binary_content.len());
    file.write_all(&binary_content)
        .map_err(|e| format!("Failed to write binary file: {e}"))?;
    log::trace!("Binary file written successfully");

    // Make sure the binary is executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        log::trace!(
            "Setting executable permissions (0o755) on {:?}",
            binary_path
        );
        let mut perms = std::fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to get binary metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set binary permissions: {e}"))?;
        log::trace!("Executable permissions set successfully");
    }

    // Remove macOS quarantine attribute to allow execution
    #[cfg(target_os = "macos")]
    {
        log::trace!("Removing quarantine attribute from {:?}", binary_path);
        let _ = silent_command("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(&binary_path)
            .output();
        // Ignore errors - attribute might not exist
    }

    // Emit progress: complete
    emit_progress(&app, "complete", "Installation complete!", 100);

    log::trace!("Claude CLI installed successfully at {:?}", binary_path);
    Ok(())
}

/// Result of checking Claude CLI authentication status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeAuthStatus {
    /// Whether the CLI is authenticated (can execute queries)
    pub authenticated: bool,
    /// Error message if authentication check failed
    pub error: Option<String>,
}

/// Check if Claude CLI is authenticated by running a simple query
#[tauri::command]
pub async fn check_claude_cli_auth(app: AppHandle) -> Result<ClaudeAuthStatus, String> {
    log::trace!("Checking Claude CLI authentication status");

    let binary_path = get_cli_binary_path(&app)?;

    if !binary_path.exists() {
        return Ok(ClaudeAuthStatus {
            authenticated: false,
            error: Some("Claude CLI not installed".to_string()),
        });
    }

    // Run a simple non-interactive query to check if authenticated
    // Use --print to avoid interactive mode, and a simple prompt
    log::trace!("Running auth check: {:?}", binary_path);

    let output = silent_command(&binary_path)
        .args([
            "--print",
            "--output-format",
            "text",
            "-p",
            "Reply with just the word OK",
        ])
        .output()
        .map_err(|e| format!("Failed to execute Claude CLI: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        log::trace!("Claude CLI auth check successful, response: {}", stdout);
        Ok(ClaudeAuthStatus {
            authenticated: true,
            error: None,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::warn!("Claude CLI auth check failed: {}", stderr);
        Ok(ClaudeAuthStatus {
            authenticated: false,
            error: Some(stderr),
        })
    }
}

/// Helper function to emit installation progress events
fn emit_progress(app: &AppHandle, stage: &str, message: &str, percent: u8) {
    let progress = InstallProgress {
        stage: stage.to_string(),
        message: message.to_string(),
        percent,
    };

    if let Err(e) = app.emit_all("claude-cli:install-progress", &progress) {
        log::warn!("Failed to emit install progress: {}", e);
    }
}
