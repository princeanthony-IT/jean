import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type {
  GitHubIssue,
  GitHubIssueDetail,
  GitHubPullRequest,
  GitHubPullRequestDetail,
  LoadedIssueContext,
  LoadedPullRequestContext,
  AttachedSavedContext,
} from '@/types/github'
import { isTauri } from './projects'

/**
 * Check if an error is a GitHub CLI setup/authentication error.
 *
 * Matches:
 * - Auth errors: "GitHub CLI not authenticated. Run 'gh auth login' first."
 * - Not found: "Failed to run gh issue list: The system cannot find the file specified."
 * - Generic gh failures that indicate setup issues
 */
export function isGhAuthError(error: unknown): boolean {
  if (!error) return false
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (import.meta.env.DEV) {
    console.log('[isGhAuthError] error type:', typeof error, 'message:', message)
  }

  return (
    lower.includes('not authenticated') ||
    lower.includes('gh auth login') ||
    lower.includes('failed to run gh')
  )
}

// Query keys for GitHub
export const githubQueryKeys = {
  all: ['github'] as const,
  issues: (projectPath: string, state: string) =>
    [...githubQueryKeys.all, 'issues', projectPath, state] as const,
  issue: (projectPath: string, issueNumber: number) =>
    [...githubQueryKeys.all, 'issue', projectPath, issueNumber] as const,
  loadedContexts: (worktreeId: string) =>
    [...githubQueryKeys.all, 'loaded-contexts', worktreeId] as const,
  prs: (projectPath: string, state: string) =>
    [...githubQueryKeys.all, 'prs', projectPath, state] as const,
  pr: (projectPath: string, prNumber: number) =>
    [...githubQueryKeys.all, 'pr', projectPath, prNumber] as const,
  loadedPrContexts: (worktreeId: string) =>
    [...githubQueryKeys.all, 'loaded-pr-contexts', worktreeId] as const,
  attachedContexts: (worktreeId: string) =>
    [...githubQueryKeys.all, 'attached-contexts', worktreeId] as const,
  issueSearch: (projectPath: string, query: string) =>
    [...githubQueryKeys.all, 'issue-search', projectPath, query] as const,
  prSearch: (projectPath: string, query: string) =>
    [...githubQueryKeys.all, 'pr-search', projectPath, query] as const,
}

/**
 * Hook to list GitHub issues for a project
 *
 * @param projectPath - Path to the git repository
 * @param state - Issue state: "open", "closed", or "all"
 */
export function useGitHubIssues(projectPath: string | null, state: 'open' | 'closed' | 'all' = 'open') {
  return useQuery({
    queryKey: githubQueryKeys.issues(projectPath ?? '', state),
    queryFn: async (): Promise<GitHubIssue[]> => {
      if (!isTauri() || !projectPath) {
        return []
      }

      try {
        logger.debug('Fetching GitHub issues', { projectPath, state })
        const issues = await invoke<GitHubIssue[]>('list_github_issues', {
          projectPath,
          state,
        })
        logger.info('GitHub issues loaded', { count: issues.length })
        return issues
      } catch (error) {
        logger.error('Failed to load GitHub issues', { error, projectPath })
        throw error
      }
    },
    enabled: !!projectPath,
    staleTime: 1000 * 60 * 2, // 2 minutes - issues can change more frequently
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 1, // Only retry once for API errors
  })
}

/**
 * Hook to get detailed information about a specific GitHub issue
 *
 * @param projectPath - Path to the git repository
 * @param issueNumber - Issue number to fetch
 */
export function useGitHubIssue(projectPath: string | null, issueNumber: number | null) {
  return useQuery({
    queryKey: githubQueryKeys.issue(projectPath ?? '', issueNumber ?? 0),
    queryFn: async (): Promise<GitHubIssueDetail> => {
      if (!isTauri() || !projectPath || !issueNumber) {
        throw new Error('Missing required parameters')
      }

      try {
        logger.debug('Fetching GitHub issue details', { projectPath, issueNumber })
        const issue = await invoke<GitHubIssueDetail>('get_github_issue', {
          projectPath,
          issueNumber,
        })
        logger.info('GitHub issue loaded', { number: issue.number, title: issue.title })
        return issue
      } catch (error) {
        logger.error('Failed to load GitHub issue', { error, projectPath, issueNumber })
        throw error
      }
    },
    enabled: !!projectPath && !!issueNumber,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 15, // 15 minutes
  })
}

/**
 * Filter issues by search query (number, title, or body)
 *
 * Used for local filtering in the modal component
 */
export function filterIssues(issues: GitHubIssue[], query: string): GitHubIssue[] {
  if (!query.trim()) {
    return issues
  }

  const lowerQuery = query.toLowerCase().trim()

  return issues.filter(issue => {
    // Match by issue number (e.g., "123" or "#123")
    const numberQuery = lowerQuery.replace(/^#/, '')
    if (issue.number.toString().includes(numberQuery)) {
      return true
    }

    // Match by title
    if (issue.title.toLowerCase().includes(lowerQuery)) {
      return true
    }

    // Match by body
    if (issue.body?.toLowerCase().includes(lowerQuery)) {
      return true
    }

    return false
  })
}

/**
 * Hook to search GitHub issues using GitHub's search API
 *
 * Queries GitHub directly via `gh issue list --search`, which finds
 * issues beyond the default list limit of 100.
 *
 * @param projectPath - Path to the git repository
 * @param query - Search query (should be debounced by caller)
 */
export function useSearchGitHubIssues(projectPath: string | null, query: string) {
  return useQuery({
    queryKey: githubQueryKeys.issueSearch(projectPath ?? '', query),
    queryFn: async (): Promise<GitHubIssue[]> => {
      if (!isTauri() || !projectPath || !query) {
        return []
      }

      try {
        logger.debug('Searching GitHub issues', { projectPath, query })
        const issues = await invoke<GitHubIssue[]>('search_github_issues', {
          projectPath,
          query,
        })
        logger.info('GitHub issue search results', { count: issues.length, query })
        return issues
      } catch (error) {
        logger.error('Failed to search GitHub issues', { error, projectPath, query })
        throw error
      }
    },
    enabled: !!projectPath && query.length >= 2,
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    retry: 0,
  })
}

/**
 * Hook to list loaded issue contexts for a worktree
 *
 * @param worktreeId - The worktree ID
 */
export function useLoadedIssueContexts(worktreeId: string | null) {
  return useQuery({
    queryKey: githubQueryKeys.loadedContexts(worktreeId ?? ''),
    queryFn: async (): Promise<LoadedIssueContext[]> => {
      if (!isTauri() || !worktreeId) {
        return []
      }

      try {
        logger.debug('Fetching loaded issue contexts', { worktreeId })
        const contexts = await invoke<LoadedIssueContext[]>('list_loaded_issue_contexts', {
          worktreeId,
        })
        logger.info('Loaded issue contexts fetched', { count: contexts.length })
        return contexts
      } catch (error) {
        logger.error('Failed to load issue contexts', { error, worktreeId })
        throw error
      }
    },
    enabled: !!worktreeId,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Load issue context for a worktree (fetch from GitHub and save)
 */
export async function loadIssueContext(
  worktreeId: string,
  issueNumber: number,
  projectPath: string
): Promise<LoadedIssueContext> {
  return invoke<LoadedIssueContext>('load_issue_context', {
    worktreeId,
    issueNumber,
    projectPath,
  })
}

/**
 * Remove a loaded issue context from a worktree
 */
export async function removeIssueContext(
  worktreeId: string,
  issueNumber: number,
  projectPath: string
): Promise<void> {
  return invoke<void>('remove_issue_context', {
    worktreeId,
    issueNumber,
    projectPath,
  })
}

// =============================================================================
// GitHub Pull Request Hooks and Functions
// =============================================================================

/**
 * Hook to list GitHub pull requests for a project
 *
 * @param projectPath - Path to the git repository
 * @param state - PR state: "open", "closed", "merged", or "all"
 */
export function useGitHubPRs(projectPath: string | null, state: 'open' | 'closed' | 'merged' | 'all' = 'open') {
  return useQuery({
    queryKey: githubQueryKeys.prs(projectPath ?? '', state),
    queryFn: async (): Promise<GitHubPullRequest[]> => {
      if (!isTauri() || !projectPath) {
        return []
      }

      try {
        logger.debug('Fetching GitHub PRs', { projectPath, state })
        const prs = await invoke<GitHubPullRequest[]>('list_github_prs', {
          projectPath,
          state,
        })
        logger.info('GitHub PRs loaded', { count: prs.length })
        return prs
      } catch (error) {
        logger.error('Failed to load GitHub PRs', { error, projectPath })
        throw error
      }
    },
    enabled: !!projectPath,
    staleTime: 1000 * 60 * 2, // 2 minutes - PRs can change more frequently
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 1, // Only retry once for API errors
  })
}

/**
 * Hook to get detailed information about a specific GitHub PR
 *
 * @param projectPath - Path to the git repository
 * @param prNumber - PR number to fetch
 */
export function useGitHubPR(projectPath: string | null, prNumber: number | null) {
  return useQuery({
    queryKey: githubQueryKeys.pr(projectPath ?? '', prNumber ?? 0),
    queryFn: async (): Promise<GitHubPullRequestDetail> => {
      if (!isTauri() || !projectPath || !prNumber) {
        throw new Error('Missing required parameters')
      }

      try {
        logger.debug('Fetching GitHub PR details', { projectPath, prNumber })
        const pr = await invoke<GitHubPullRequestDetail>('get_github_pr', {
          projectPath,
          prNumber,
        })
        logger.info('GitHub PR loaded', { number: pr.number, title: pr.title })
        return pr
      } catch (error) {
        logger.error('Failed to load GitHub PR', { error, projectPath, prNumber })
        throw error
      }
    },
    enabled: !!projectPath && !!prNumber,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 15, // 15 minutes
  })
}

/**
 * Hook to list loaded PR contexts for a worktree
 *
 * @param worktreeId - The worktree ID
 */
export function useLoadedPRContexts(worktreeId: string | null) {
  return useQuery({
    queryKey: githubQueryKeys.loadedPrContexts(worktreeId ?? ''),
    queryFn: async (): Promise<LoadedPullRequestContext[]> => {
      if (!isTauri() || !worktreeId) {
        return []
      }

      try {
        logger.debug('Fetching loaded PR contexts', { worktreeId })
        const contexts = await invoke<LoadedPullRequestContext[]>('list_loaded_pr_contexts', {
          worktreeId,
        })
        logger.info('Loaded PR contexts fetched', { count: contexts.length })
        return contexts
      } catch (error) {
        logger.error('Failed to load PR contexts', { error, worktreeId })
        throw error
      }
    },
    enabled: !!worktreeId,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Load PR context for a worktree (fetch from GitHub and save)
 */
export async function loadPRContext(
  worktreeId: string,
  prNumber: number,
  projectPath: string
): Promise<LoadedPullRequestContext> {
  return invoke<LoadedPullRequestContext>('load_pr_context', {
    worktreeId,
    prNumber,
    projectPath,
  })
}

/**
 * Remove a loaded PR context from a worktree
 */
export async function removePRContext(
  worktreeId: string,
  prNumber: number,
  projectPath: string
): Promise<void> {
  return invoke<void>('remove_pr_context', {
    worktreeId,
    prNumber,
    projectPath,
  })
}

/**
 * Get the content of a loaded issue context file
 */
export async function getIssueContextContent(
  worktreeId: string,
  issueNumber: number,
  projectPath: string
): Promise<string> {
  return invoke<string>('get_issue_context_content', {
    worktreeId,
    issueNumber,
    projectPath,
  })
}

/**
 * Get the content of a loaded PR context file
 */
export async function getPRContextContent(
  worktreeId: string,
  prNumber: number,
  projectPath: string
): Promise<string> {
  return invoke<string>('get_pr_context_content', {
    worktreeId,
    prNumber,
    projectPath,
  })
}

/**
 * Filter PRs by search query (number, title, or body)
 *
 * Used for local filtering in the modal component
 */
export function filterPRs(prs: GitHubPullRequest[], query: string): GitHubPullRequest[] {
  if (!query.trim()) {
    return prs
  }

  const lowerQuery = query.toLowerCase().trim()

  return prs.filter(pr => {
    // Match by PR number (e.g., "123" or "#123")
    const numberQuery = lowerQuery.replace(/^#/, '')
    if (pr.number.toString().includes(numberQuery)) {
      return true
    }

    // Match by title
    if (pr.title.toLowerCase().includes(lowerQuery)) {
      return true
    }

    // Match by body
    if (pr.body?.toLowerCase().includes(lowerQuery)) {
      return true
    }

    // Match by branch name
    if (pr.headRefName.toLowerCase().includes(lowerQuery)) {
      return true
    }

    return false
  })
}

/**
 * Hook to search GitHub PRs using GitHub's search API
 *
 * Queries GitHub directly via `gh pr list --search`, which finds
 * PRs beyond the default list limit of 100.
 *
 * @param projectPath - Path to the git repository
 * @param query - Search query (should be debounced by caller)
 */
export function useSearchGitHubPRs(projectPath: string | null, query: string) {
  return useQuery({
    queryKey: githubQueryKeys.prSearch(projectPath ?? '', query),
    queryFn: async (): Promise<GitHubPullRequest[]> => {
      if (!isTauri() || !projectPath || !query) {
        return []
      }

      try {
        logger.debug('Searching GitHub PRs', { projectPath, query })
        const prs = await invoke<GitHubPullRequest[]>('search_github_prs', {
          projectPath,
          query,
        })
        logger.info('GitHub PR search results', { count: prs.length, query })
        return prs
      } catch (error) {
        logger.error('Failed to search GitHub PRs', { error, projectPath, query })
        throw error
      }
    },
    enabled: !!projectPath && query.length >= 2,
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    retry: 0,
  })
}

/**
 * Merge local-filtered results with remote search results, deduplicating by number.
 * Local results appear first, remote-only results are appended.
 */
export function mergeWithSearchResults<T extends { number: number }>(
  localResults: T[],
  searchResults: T[] | undefined,
): T[] {
  if (!searchResults?.length) return localResults

  const localNumbers = new Set(localResults.map(item => item.number))
  const remoteOnly = searchResults.filter(item => !localNumbers.has(item.number))

  if (remoteOnly.length === 0) return localResults
  return [...localResults, ...remoteOnly]
}

// =============================================================================
// Attached Saved Context Hooks and Functions
// =============================================================================

/**
 * Hook to list attached saved contexts for a worktree
 *
 * @param worktreeId - The worktree ID
 */
export function useAttachedSavedContexts(worktreeId: string | null) {
  return useQuery({
    queryKey: githubQueryKeys.attachedContexts(worktreeId ?? ''),
    queryFn: async (): Promise<AttachedSavedContext[]> => {
      if (!isTauri() || !worktreeId) {
        return []
      }

      try {
        logger.debug('Fetching attached saved contexts', { worktreeId })
        const contexts = await invoke<AttachedSavedContext[]>('list_attached_saved_contexts', {
          worktreeId,
        })
        logger.info('Attached saved contexts fetched', { count: contexts.length })
        return contexts
      } catch (error) {
        logger.error('Failed to load attached saved contexts', { error, worktreeId })
        throw error
      }
    },
    enabled: !!worktreeId,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Attach a saved context to a worktree (copy file to worktree-specific location)
 */
export async function attachSavedContext(
  worktreeId: string,
  sourcePath: string,
  slug: string
): Promise<AttachedSavedContext> {
  return invoke<AttachedSavedContext>('attach_saved_context', {
    worktreeId,
    sourcePath,
    slug,
  })
}

/**
 * Remove an attached saved context from a worktree
 */
export async function removeSavedContext(worktreeId: string, slug: string): Promise<void> {
  return invoke<void>('remove_saved_context', {
    worktreeId,
    slug,
  })
}

/**
 * Get the content of an attached saved context file
 */
export async function getSavedContextContent(worktreeId: string, slug: string): Promise<string> {
  return invoke<string>('get_saved_context_content', {
    worktreeId,
    slug,
  })
}
