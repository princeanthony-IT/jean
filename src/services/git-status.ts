/**
 * Git status polling service
 *
 * This module provides functions to control the background git status polling
 * and listen for status updates from the Rust backend.
 */

import { invoke, useWsConnectionStatus } from '@/lib/transport'
import { listen, type UnlistenFn } from '@/lib/transport'
import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { isTauri, updateWorktreeCachedStatus } from '@/services/projects'
import type { GitDiff } from '@/types/git-diff'

// ============================================================================
// Types
// ============================================================================

/**
 * Git branch status event from the Rust backend
 */
export interface GitStatusEvent {
  worktree_id: string
  current_branch: string
  base_branch: string
  behind_count: number
  ahead_count: number
  has_updates: boolean
  checked_at: number // Unix timestamp
  /** Lines added in uncommitted changes (working directory) */
  uncommitted_added: number
  /** Lines removed in uncommitted changes (working directory) */
  uncommitted_removed: number
  /** Lines added compared to base branch (origin/main) */
  branch_diff_added: number
  /** Lines removed compared to base branch (origin/main) */
  branch_diff_removed: number
  /** Commits the local base branch is ahead of origin (unpushed on base) */
  base_branch_ahead_count: number
  /** Commits the local base branch is behind origin */
  base_branch_behind_count: number
  /** Commits unique to this worktree (ahead of local base branch) */
  worktree_ahead_count: number
  /** Commits in HEAD not yet pushed to origin/current_branch */
  unpushed_count: number
}

/**
 * Information needed to set up polling for a worktree
 */
export interface WorktreePollingInfo {
  worktreeId: string
  worktreePath: string
  baseBranch: string
  /** GitHub PR number (if a PR has been created) */
  prNumber?: number
  /** GitHub PR URL (if a PR has been created) */
  prUrl?: string
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Set the application focus state for the background task manager.
 * Polling only occurs when the app is focused.
 */
export async function setAppFocusState(focused: boolean): Promise<void> {
  if (!isTauri()) return
  await invoke('set_app_focus_state', { focused })
}

/**
 * Set the active worktree for git status polling.
 * Pass null to clear the active worktree and stop polling.
 */
export async function setActiveWorktreeForPolling(
  info: WorktreePollingInfo | null
): Promise<void> {
  if (!isTauri()) return

  if (info) {
    await invoke('set_active_worktree_for_polling', {
      worktreeId: info.worktreeId,
      worktreePath: info.worktreePath,
      baseBranch: info.baseBranch,
      prNumber: info.prNumber ?? null,
      prUrl: info.prUrl ?? null,
    })
  } else {
    await invoke('set_active_worktree_for_polling', {
      worktreeId: null,
      worktreePath: null,
      baseBranch: null,
      prNumber: null,
      prUrl: null,
    })
  }
}

/**
 * Set the git polling interval in seconds.
 * Valid range: 10-600 seconds (10 seconds to 10 minutes).
 */
export async function setGitPollInterval(seconds: number): Promise<void> {
  if (!isTauri()) return
  await invoke('set_git_poll_interval', { seconds })
}

/**
 * Get the current git polling interval in seconds.
 */
export async function getGitPollInterval(): Promise<number> {
  if (!isTauri()) return 60 // Default for non-Tauri
  return await invoke<number>('get_git_poll_interval')
}

/**
 * Trigger an immediate git status poll.
 *
 * This bypasses the normal polling interval and debounce timer.
 * Useful after git operations like pull, push, commit, etc.
 */
export async function triggerImmediateGitPoll(): Promise<void> {
  if (!isTauri()) return
  await invoke('trigger_immediate_git_poll')
}

/**
 * Pull changes from remote origin.
 *
 * @param worktreePath - Path to the worktree/repository
 * @param baseBranch - The base branch to pull from (e.g., 'main')
 * @returns Output from git pull command
 */
export async function gitPull(
  worktreePath: string,
  baseBranch: string
): Promise<string> {
  if (!isTauri()) {
    throw new Error('Git pull only available in Tauri')
  }
  return invoke<string>('git_pull', { worktreePath, baseBranch })
}

/**
 * Push current branch to remote. If prNumber is provided, uses PR-aware push
 * that handles fork remotes and uses --force-with-lease.
 *
 * @param worktreePath - Path to the worktree/repository
 * @param prNumber - Optional PR number for PR-aware push
 * @returns Output from git push command
 */
export async function gitPush(worktreePath: string, prNumber?: number): Promise<string> {
  if (!isTauri()) {
    throw new Error('Git push only available in Tauri')
  }
  return invoke<string>('git_push', { worktreePath, prNumber: prNumber ?? null })
}

/**
 * Fetch git status for all worktrees in a project.
 *
 * This is used to populate status indicators in the sidebar without requiring
 * each worktree to be selected first. Status is fetched in parallel and emitted
 * via the existing `git:status-update` event channel.
 *
 * @param projectId - The project ID to fetch worktree statuses for
 */
export async function fetchWorktreesStatus(projectId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('fetch_worktrees_status', { projectId })
}

// ============================================================================
// Remote polling (PR status, etc.)
// ============================================================================

/**
 * Set the remote polling interval in seconds.
 * Valid range: 30-600 seconds (30 seconds to 10 minutes).
 * This controls how often remote API calls (like PR status) are made.
 */
export async function setRemotePollInterval(seconds: number): Promise<void> {
  if (!isTauri()) return
  await invoke('set_remote_poll_interval', { seconds })
}

/**
 * Get the current remote polling interval in seconds.
 */
export async function getRemotePollInterval(): Promise<number> {
  if (!isTauri()) return 60 // Default for non-Tauri
  return await invoke<number>('get_remote_poll_interval')
}

/**
 * Trigger an immediate remote poll.
 *
 * This bypasses the normal remote polling interval.
 * Useful when you want to force-refresh PR status.
 */
export async function triggerImmediateRemotePoll(): Promise<void> {
  if (!isTauri()) return
  await invoke('trigger_immediate_remote_poll')
}

/**
 * Get detailed git diff for a worktree.
 *
 * @param worktreePath - Path to the worktree/repository
 * @param diffType - "uncommitted" for working directory changes, "branch" for changes vs base branch
 * @param baseBranch - Base branch name (used for "branch" diff type)
 */
export async function getGitDiff(
  worktreePath: string,
  diffType: 'uncommitted' | 'branch',
  baseBranch?: string
): Promise<GitDiff> {
  if (!isTauri()) {
    throw new Error('Git diff only available in Tauri')
  }
  return invoke<GitDiff>('get_git_diff', {
    worktreePath,
    diffType,
    baseBranch,
  })
}

// ============================================================================
// Query Keys
// ============================================================================

export const gitStatusQueryKeys = {
  all: ['git-status'] as const,
  worktree: (worktreeId: string) =>
    [...gitStatusQueryKeys.all, worktreeId] as const,
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to listen for git status update events from the backend.
 *
 * This hook sets up an event listener for 'git:status-update' events
 * and updates the query cache with the new status.
 */
export function useGitStatusEvents(
  onStatusUpdate?: (status: GitStatusEvent) => void
) {
  const queryClient = useQueryClient()
  const wsConnected = useWsConnectionStatus()

  useEffect(() => {
    if (!isTauri()) return

    const unlistenPromises: Promise<UnlistenFn>[] = []

    // Listen for git status updates
    unlistenPromises.push(
      listen<GitStatusEvent>('git:status-update', event => {
        const status = event.payload
        console.info('[git-status] Received status update for worktree:', status.worktree_id, 'behind:', status.behind_count)

        // Update the query cache
        queryClient.setQueryData(
          gitStatusQueryKeys.worktree(status.worktree_id),
          status
        )

        // Persist to worktree cached status (fire and forget)
        updateWorktreeCachedStatus(
          status.worktree_id,
          null, // pr_status - handled by pr-status service
          null, // check_status - handled by pr-status service
          status.behind_count,
          status.ahead_count,
          status.uncommitted_added,
          status.uncommitted_removed,
          status.branch_diff_added,
          status.branch_diff_removed,
          status.base_branch_ahead_count,
          status.base_branch_behind_count,
          status.worktree_ahead_count,
          status.unpushed_count
        ).catch(err =>
          console.warn('[git-status] Failed to cache status:', err)
        )

        // Call the optional callback
        onStatusUpdate?.(status)
      })
    )

    // Cleanup listeners on unmount
    const unlistens: UnlistenFn[] = []
    Promise.all(unlistenPromises).then(fns => {
      unlistens.push(...fns)
    })

    return () => {
      unlistens.forEach(unlisten => unlisten())
    }
  }, [queryClient, onStatusUpdate, wsConnected])
}

/**
 * Hook to manage app focus state for the background task manager.
 *
 * This hook sets up window focus/blur listeners and notifies the
 * Rust backend when the app gains or loses focus.
 */
export function useAppFocusTracking() {
  const isMounted = useRef(true)
  const wsConnected = useWsConnectionStatus()

  useEffect(() => {
    if (!isTauri()) return

    isMounted.current = true

    const handleFocus = () => {
      if (isMounted.current) {
        console.debug(
          '[git-status] App gained focus at',
          new Date().toISOString(),
          '- resuming polling'
        )
        setAppFocusState(true)
      }
    }

    const handleBlur = () => {
      if (isMounted.current) {
        console.debug(
          '[git-status] App lost focus at',
          new Date().toISOString(),
          '- pausing polling'
        )
        setAppFocusState(false)
      }
    }

    // Set up listeners
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    // Set initial focus state
    setAppFocusState(document.hasFocus())

    return () => {
      isMounted.current = false
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [wsConnected])
}

/**
 * Hook to get the cached git status for a worktree.
 *
 * This returns the most recent status update from the background polling.
 * Returns undefined if no status has been received yet.
 */
export function useGitStatus(worktreeId: string | null) {
  return useQuery({
    queryKey: worktreeId
      ? gitStatusQueryKeys.worktree(worktreeId)
      : ['git-status', 'none'],
    queryFn: () => null as GitStatusEvent | null, // Status comes from events, not fetching
    enabled: !!worktreeId,
    staleTime: Infinity, // Never refetch automatically; data comes from events
  })
}

/**
 * Hook to set up polling for a specific worktree.
 *
 * When the worktree changes, this hook updates the backend
 * with the new worktree information for polling.
 */
export function useWorktreePolling(info: WorktreePollingInfo | null) {
  const prevInfoRef = useRef<WorktreePollingInfo | null>(null)
  const wsConnected = useWsConnectionStatus()

  useEffect(() => {
    if (!isTauri()) return

    // Check if the info has actually changed
    const prevInfo = prevInfoRef.current
    const hasChanged =
      info?.worktreeId !== prevInfo?.worktreeId ||
      info?.worktreePath !== prevInfo?.worktreePath ||
      info?.baseBranch !== prevInfo?.baseBranch ||
      info?.prNumber !== prevInfo?.prNumber ||
      info?.prUrl !== prevInfo?.prUrl

    if (hasChanged) {
      console.debug('[git-status] Worktree polling info changed:', info)
      setActiveWorktreeForPolling(info)
      prevInfoRef.current = info
    }
  }, [info, wsConnected])

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (isTauri()) {
        setActiveWorktreeForPolling(null)
      }
    }
  }, [])
}

/**
 * Hook to fetch git status for all worktrees in a project.
 *
 * This triggers a backend call that fetches status for all worktrees
 * and emits events that update the query cache via useGitStatusEvents.
 *
 * @param projectId - The project ID to fetch worktree statuses for
 * @param enabled - Whether to fetch (e.g., only when project is expanded)
 */
export function useFetchWorktreesStatus(
  projectId: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['worktrees-status-fetch', projectId],
    queryFn: async () => {
      if (!projectId) return null
      await fetchWorktreesStatus(projectId)
      return { fetchedAt: Date.now() }
    },
    enabled: !!projectId && enabled && isTauri(),
    staleTime: 1000 * 60 * 2, // 2 minutes - won't refetch if recently done
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
  })
}
