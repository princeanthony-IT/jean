import { useCallback, useState } from 'react'
import { invoke } from '@/lib/transport'
import { isNativeApp } from '@/lib/environment'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { chatQueryKeys } from '@/services/chat'
import { saveWorktreePr, projectsQueryKeys } from '@/services/projects'
import { gitPull, gitPush, triggerImmediateGitPoll } from '@/services/git-status'
import { isBaseSession } from '@/types/projects'
import type {
  CreatePrResponse,
  CreateCommitResponse,
  ReviewResponse,
  MergeWorktreeResponse,
  MergeConflictsResponse,
  MergeType,
  Worktree,
  Project,
} from '@/types/projects'
import type { Session } from '@/types/chat'
import { DEFAULT_RESOLVE_CONFLICTS_PROMPT, type AppPreferences } from '@/types/preferences'

interface UseGitOperationsParams {
  activeWorktreeId: string | null | undefined
  activeWorktreePath: string | null | undefined
  worktree: Worktree | null | undefined
  project: Project | null | undefined
  queryClient: QueryClient
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  preferences: AppPreferences | undefined
}

interface UseGitOperationsReturn {
  /** Creates commit with AI-generated message (no push) */
  handleCommit: () => Promise<void>
  /** Creates commit with AI-generated message and pushes to remote */
  handleCommitAndPush: () => Promise<void>
  /** Pulls changes from remote */
  handlePull: () => Promise<void>
  /** Pushes commits to remote */
  handlePush: () => Promise<void>
  /** Creates PR with AI-generated title and description */
  handleOpenPr: () => Promise<void>
  /** Runs AI code review */
  handleReview: () => Promise<void>
  /** Validates and shows merge options dialog */
  handleMerge: () => Promise<void>
  /** Detects existing merge conflicts and opens resolution session */
  handleResolveConflicts: () => Promise<void>
  /** Fetches base branch and merges to create local conflict state for PR conflict resolution */
  handleResolvePrConflicts: () => Promise<void>
  /** Executes the actual merge with specified type */
  executeMerge: (mergeType: MergeType) => Promise<void>
  /** Whether merge dialog is open */
  showMergeDialog: boolean
  /** Setter for merge dialog visibility */
  setShowMergeDialog: React.Dispatch<React.SetStateAction<boolean>>
  /** Worktree data for pending merge */
  pendingMergeWorktree: Worktree | null
}

/**
 * Extracts git operation handlers from ChatWindow.
 * Provides handlers for commit, PR, review, and merge operations.
 */
export function useGitOperations({
  activeWorktreeId,
  activeWorktreePath,
  worktree,
  project,
  queryClient,
  inputRef,
  preferences,
}: UseGitOperationsParams): UseGitOperationsReturn {
  // Merge dialog state
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [pendingMergeWorktree, setPendingMergeWorktree] =
    useState<Worktree | null>(null)

  // Handle Commit - creates commit with AI-generated message (no push)
  const handleCommit = useCallback(async () => {
    if (!activeWorktreePath || !activeWorktreeId) return

    const { setWorktreeLoading, clearWorktreeLoading } = useChatStore.getState()
    setWorktreeLoading(activeWorktreeId, 'commit')
    const toastId = toast.loading('Creating commit...')

    try {
      const result = await invoke<CreateCommitResponse>(
        'create_commit_with_ai',
        {
          worktreePath: activeWorktreePath,
          customPrompt: preferences?.magic_prompts?.commit_message,
          push: false,
          model: preferences?.magic_prompt_models?.commit_message_model,
        }
      )

      // Trigger git status refresh
      triggerImmediateGitPoll()

      toast.success(`Committed: ${result.message.split('\n')[0]}`, {
        id: toastId,
      })
    } catch (error) {
      toast.error(`Failed to commit: ${error}`, { id: toastId })
    } finally {
      clearWorktreeLoading(activeWorktreeId)
    }
  }, [activeWorktreeId, activeWorktreePath, preferences?.magic_prompts?.commit_message, preferences?.magic_prompt_models?.commit_message_model])

  // Handle Commit & Push - creates commit with AI-generated message and pushes
  const handleCommitAndPush = useCallback(async () => {
    if (!activeWorktreePath || !activeWorktreeId) return

    const { setWorktreeLoading, clearWorktreeLoading } = useChatStore.getState()
    setWorktreeLoading(activeWorktreeId, 'commit')
    const toastId = toast.loading('Committing and pushing...')

    try {
      const result = await invoke<CreateCommitResponse>(
        'create_commit_with_ai',
        {
          worktreePath: activeWorktreePath,
          customPrompt: preferences?.magic_prompts?.commit_message,
          push: true,
          model: preferences?.magic_prompt_models?.commit_message_model,
        }
      )

      // Trigger git status refresh
      triggerImmediateGitPoll()

      toast.success(`Committed and pushed: ${result.message.split('\n')[0]}`, {
        id: toastId,
      })
    } catch (error) {
      toast.error(`Failed: ${error}`, { id: toastId })
    } finally {
      clearWorktreeLoading(activeWorktreeId)
    }
  }, [activeWorktreeId, activeWorktreePath, preferences?.magic_prompts?.commit_message, preferences?.magic_prompt_models?.commit_message_model])

  // Handle Pull - pulls changes from remote
  const handlePull = useCallback(async () => {
    if (!activeWorktreePath || !activeWorktreeId) return

    const { setWorktreeLoading, clearWorktreeLoading } = useChatStore.getState()
    setWorktreeLoading(activeWorktreeId, 'commit')
    const toastId = toast.loading('Pulling changes...')

    try {
      const baseBranch = project?.default_branch ?? 'main'
      await gitPull(activeWorktreePath, baseBranch)
      triggerImmediateGitPoll()
      toast.success('Changes pulled', { id: toastId })
    } catch (error) {
      if (String(error).includes('Merge conflicts in:')) {
        toast.warning('Pull resulted in conflicts', { id: toastId })
      } else {
        toast.error(`Pull failed: ${error}`, { id: toastId })
      }
    } finally {
      clearWorktreeLoading(activeWorktreeId)
    }
  }, [activeWorktreeId, activeWorktreePath, project?.default_branch])

  // Handle Push - pushes commits to remote
  const handlePush = useCallback(async () => {
    if (!activeWorktreePath || !activeWorktreeId) return

    const { setWorktreeLoading, clearWorktreeLoading } = useChatStore.getState()
    setWorktreeLoading(activeWorktreeId, 'commit')
    const toastId = toast.loading('Pushing changes...')

    try {
      await gitPush(activeWorktreePath, worktree?.pr_number)
      triggerImmediateGitPoll()
      toast.success('Changes pushed', { id: toastId })
    } catch (error) {
      toast.error(`Push failed: ${error}`, { id: toastId })
    } finally {
      clearWorktreeLoading(activeWorktreeId)
    }
  }, [activeWorktreeId, activeWorktreePath, worktree?.pr_number])

  // Handle Open PR - creates PR with AI-generated title and description in background
  const handleOpenPr = useCallback(async () => {
    if (!activeWorktreeId || !activeWorktreePath || !worktree) return

    const { setWorktreeLoading, clearWorktreeLoading } = useChatStore.getState()
    setWorktreeLoading(activeWorktreeId, 'pr')
    const toastId = toast.loading('Creating PR...')

    try {
      const result = await invoke<CreatePrResponse>(
        'create_pr_with_ai_content',
        {
          worktreePath: activeWorktreePath,
          customPrompt: preferences?.magic_prompts?.pr_content,
          model: preferences?.magic_prompt_models?.pr_content_model,
        }
      )

      // Save PR info to worktree
      await saveWorktreePr(activeWorktreeId, result.pr_number, result.pr_url)

      // Invalidate worktree queries to refresh PR status in toolbar
      queryClient.invalidateQueries({
        queryKey: projectsQueryKeys.worktrees(worktree.project_id),
      })
      queryClient.invalidateQueries({
        queryKey: [...projectsQueryKeys.all, 'worktree', activeWorktreeId],
      })

      toast.success(`PR created: ${result.title}`, {
        id: toastId,
        action: {
          label: 'Open',
          onClick: async () => {
            if (isNativeApp()) {
              const { openUrl } = await import('@tauri-apps/plugin-opener')
              await openUrl(result.pr_url)
            } else {
              window.open(result.pr_url, '_blank')
            }
          },
        },
      })
    } catch (error) {
      toast.error(`Failed to create PR: ${error}`, { id: toastId })
    } finally {
      clearWorktreeLoading(activeWorktreeId)
    }
  }, [activeWorktreeId, activeWorktreePath, worktree, queryClient, preferences?.magic_prompts?.pr_content, preferences?.magic_prompt_models?.pr_content_model])

  // Handle Review - runs AI code review in background
  const handleReview = useCallback(async () => {
    if (!activeWorktreeId || !activeWorktreePath) return

    const { setWorktreeLoading, clearWorktreeLoading } = useChatStore.getState()
    setWorktreeLoading(activeWorktreeId, 'review')
    const toastId = toast.loading('Running AI code review...')

    try {
      const result = await invoke<ReviewResponse>('run_review_with_ai', {
        worktreePath: activeWorktreePath,
        customPrompt: preferences?.magic_prompts?.code_review,
        model: preferences?.magic_prompt_models?.code_review_model,
      })

      // Store review results in Zustand (also activates review tab)
      const { setReviewResults } = useChatStore.getState()
      setReviewResults(activeWorktreeId, result)

      const findingCount = result.findings.length
      const statusEmoji =
        result.approval_status === 'approved'
          ? 'Approved'
          : result.approval_status === 'changes_requested'
            ? 'Changes requested'
            : 'Needs discussion'

      toast.success(
        `Review complete: ${statusEmoji} (${findingCount} findings)`,
        {
          id: toastId,
        }
      )
    } catch (error) {
      toast.error(`Failed to review: ${error}`, { id: toastId })
    } finally {
      clearWorktreeLoading(activeWorktreeId)
    }
  }, [activeWorktreeId, activeWorktreePath, preferences?.magic_prompts?.code_review, preferences?.magic_prompt_models?.code_review_model])

  // Handle Merge - validates and shows merge options dialog
  const handleMerge = useCallback(async () => {
    if (!activeWorktreeId) return

    // Fetch worktree data fresh if not available in cache
    let worktreeData = worktree
    if (!worktreeData) {
      try {
        worktreeData = await invoke<Worktree>('get_worktree', {
          worktreeId: activeWorktreeId,
        })
      } catch {
        toast.error('Failed to get worktree data')
        return
      }
    }

    // Validate: not a base session
    if (isBaseSession(worktreeData)) {
      toast.error('Cannot merge base branch into itself')
      return
    }

    // Validate: no open PR
    if (worktreeData.pr_url) {
      toast.error(
        'Cannot merge locally while a PR is open. Close or merge the PR on GitHub first.'
      )
      return
    }

    // Store worktree data and show dialog
    setPendingMergeWorktree(worktreeData)
    setShowMergeDialog(true)
  }, [activeWorktreeId, worktree])

  // Handle Resolve Conflicts - detects existing merge conflicts and opens resolution session
  const handleResolveConflicts = useCallback(async () => {
    if (!activeWorktreeId || !worktree) return

    const toastId = toast.loading('Checking for merge conflicts...')

    try {
      const result = await invoke<MergeConflictsResponse>(
        'get_merge_conflicts',
        { worktreeId: activeWorktreeId }
      )

      if (!result.has_conflicts) {
        toast.info('No merge conflicts detected', { id: toastId })
        return
      }

      toast.warning(
        `Found conflicts in ${result.conflicts.length} file(s)`,
        {
          id: toastId,
          description: 'Opening conflict resolution session...',
        }
      )

      const { setActiveSession, setInputDraft } = useChatStore.getState()

      // Create a NEW session tab for conflict resolution
      const newSession = await invoke<Session>('create_session', {
        worktreeId: activeWorktreeId,
        worktreePath: worktree.path,
        name: 'Resolve conflicts',
      })

      // Set the new session as active
      setActiveSession(activeWorktreeId, newSession.id)

      // Build conflict resolution prompt with diff details
      const conflictFiles = result.conflicts.join('\n- ')
      const diffSection = result.conflict_diff
        ? `\n\nHere is the diff showing the conflict details:\n\n\`\`\`diff\n${result.conflict_diff}\n\`\`\``
        : ''

      const resolveInstructions = preferences?.magic_prompts?.resolve_conflicts ?? DEFAULT_RESOLVE_CONFLICTS_PROMPT

      const conflictPrompt = `I have merge conflicts that need to be resolved.

Conflicts in these files:
- ${conflictFiles}${diffSection}

${resolveInstructions}`

      // Set the input draft for the new session
      setInputDraft(newSession.id, conflictPrompt)

      // Invalidate queries to refresh session list in tab bar
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.sessions(activeWorktreeId),
      })

      // Focus input after a short delay to allow UI to update
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    } catch (error) {
      toast.error(`Failed to check conflicts: ${error}`, { id: toastId })
    }
  }, [activeWorktreeId, worktree, preferences, queryClient, inputRef])

  // Handle PR Conflicts - fetches base branch, merges locally to create conflict state
  const handleResolvePrConflicts = useCallback(async () => {
    if (!activeWorktreeId || !worktree) return

    const toastId = toast.loading('Fetching base branch and checking for conflicts...')

    try {
      const result = await invoke<MergeConflictsResponse>(
        'fetch_and_merge_base',
        { worktreeId: activeWorktreeId }
      )

      if (!result.has_conflicts) {
        toast.success('No conflicts — base branch merged cleanly', { id: toastId })
        triggerImmediateGitPoll()
        return
      }

      toast.warning(
        `Found conflicts in ${result.conflicts.length} file(s)`,
        {
          id: toastId,
          description: 'Opening conflict resolution session...',
        }
      )

      const { setActiveSession, setInputDraft } = useChatStore.getState()

      // Create a NEW session tab for conflict resolution
      const newSession = await invoke<Session>('create_session', {
        worktreeId: activeWorktreeId,
        worktreePath: worktree.path,
        name: 'PR: resolve conflicts',
      })

      // Set the new session as active
      setActiveSession(activeWorktreeId, newSession.id)

      // Build conflict resolution prompt with diff details
      const conflictFiles = result.conflicts.join('\n- ')
      const diffSection = result.conflict_diff
        ? `\n\nHere is the diff showing the conflict details:\n\n\`\`\`diff\n${result.conflict_diff}\n\`\`\``
        : ''

      const baseBranch = project?.default_branch || 'main'
      const resolveInstructions = preferences?.magic_prompts?.resolve_conflicts ?? DEFAULT_RESOLVE_CONFLICTS_PROMPT

      const conflictPrompt = `I merged \`origin/${baseBranch}\` into this branch to resolve PR conflicts, but there are merge conflicts.

Conflicts in these files:
- ${conflictFiles}${diffSection}

${resolveInstructions}`

      // Set the input draft for the new session
      setInputDraft(newSession.id, conflictPrompt)

      // Invalidate queries to refresh session list in tab bar
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.sessions(activeWorktreeId),
      })

      // Focus input after a short delay to allow UI to update
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    } catch (error) {
      toast.error(`Failed to merge base branch: ${error}`, { id: toastId })
    }
  }, [activeWorktreeId, worktree, project, preferences, queryClient, inputRef])

  // Execute merge with merge type option
  const executeMerge = useCallback(
    async (mergeType: MergeType) => {
      const worktreeData = pendingMergeWorktree
      if (!worktreeData || !activeWorktreeId) return

      // Close dialog
      setShowMergeDialog(false)
      setPendingMergeWorktree(null)

      const { setWorktreeLoading, clearWorktreeLoading } = useChatStore.getState()
      setWorktreeLoading(activeWorktreeId, 'merge')
      const toastId = toast.loading('Checking for uncommitted changes...')
      const featureBranch = worktreeData.branch
      const projectId = worktreeData.project_id

      try {
        // Pre-check: Run fresh git status check for uncommitted changes
        const hasUncommitted = await invoke<boolean>(
          'has_uncommitted_changes',
          {
            worktreeId: activeWorktreeId,
          }
        )

        if (hasUncommitted) {
          toast.loading('Auto-committing changes before merge...', {
            id: toastId,
          })
          // Small delay to show the auto-commit message before it changes to merging
          await new Promise(resolve => setTimeout(resolve, 500))
        }

        const toastMessage = {
          merge: 'Merging to base branch...',
          squash: 'Squashing and merging to base branch...',
          rebase: 'Rebasing and merging to base branch...',
        }[mergeType]
        toast.loading(toastMessage, { id: toastId })

        const result = await invoke<MergeWorktreeResponse>(
          'merge_worktree_to_base',
          {
            worktreeId: activeWorktreeId,
            mergeType,
          }
        )

        if (result.success) {
          // Worktree was deleted - invalidate queries to refresh project tree
          if (projectId) {
            queryClient.invalidateQueries({
              queryKey: projectsQueryKeys.worktrees(projectId),
            })
          }

          // Only clear active worktree if it's the one we just merged
          const { activeWorktreeId: currentActiveId, clearActiveWorktree } =
            useChatStore.getState()
          if (currentActiveId === worktreeData.id) {
            const { selectWorktree } = useProjectsStore.getState()
            clearActiveWorktree()
            selectWorktree(null)
          }

          toast.success(
            `Merged successfully! Commit: ${result.commit_hash?.slice(0, 7)}`,
            {
              id: toastId,
            }
          )
        } else if (result.conflicts && result.conflicts.length > 0) {
          // Conflicts detected - stay on worktree and create new tab for conflict resolution
          // Strategy: merge base INTO feature branch to resolve conflicts on the worktree
          toast.warning(
            `Merge conflicts in ${result.conflicts.length} file(s)`,
            {
              id: toastId,
              description: 'Opening conflict resolution session...',
            }
          )

          const { setActiveSession, setInputDraft } = useChatStore.getState()

          // Create a NEW session tab on the CURRENT worktree for conflict resolution
          const newSession = await invoke<Session>('create_session', {
            worktreeId: activeWorktreeId,
            worktreePath: worktreeData.path,
            name: 'Merge: resolve conflicts',
          })

          // Set the new session as active
          setActiveSession(activeWorktreeId, newSession.id)

          // Build conflict resolution prompt with diff details
          const conflictFiles = result.conflicts.join('\n- ')
          const diffSection = result.conflict_diff
            ? `\n\nHere is the diff showing the conflict details:\n\n\`\`\`diff\n${result.conflict_diff}\n\`\`\``
            : ''

          // Get base branch name from the project
          const baseBranch = project?.default_branch || 'main'

          const resolveInstructions = preferences?.magic_prompts?.resolve_conflicts ?? DEFAULT_RESOLVE_CONFLICTS_PROMPT

          const conflictPrompt = `I tried to merge this branch (\`${featureBranch}\`) into \`${baseBranch}\`, but there are merge conflicts.

To resolve this, please merge \`${baseBranch}\` INTO this branch by running:
\`\`\`
git merge ${baseBranch}
\`\`\`

Then resolve the conflicts in these files:
- ${conflictFiles}${diffSection}

${resolveInstructions}`

          // Set the input draft for the new session
          setInputDraft(newSession.id, conflictPrompt)

          // Invalidate queries to refresh session list in tab bar
          queryClient.invalidateQueries({
            queryKey: chatQueryKeys.sessions(activeWorktreeId),
          })

          // Focus input after a short delay to allow UI to update
          setTimeout(() => {
            inputRef.current?.focus()
          }, 100)
        }
      } catch (error) {
        toast.error(String(error), { id: toastId })
      } finally {
        clearWorktreeLoading(activeWorktreeId)
      }
    },
    [activeWorktreeId, pendingMergeWorktree, preferences, project, queryClient, inputRef]
  )

  return {
    handleCommit,
    handleCommitAndPush,
    handlePull,
    handlePush,
    handleOpenPr,
    handleReview,
    handleMerge,
    handleResolveConflicts,
    handleResolvePrConflicts,
    executeMerge,
    showMergeDialog,
    setShowMergeDialog,
    pendingMergeWorktree,
  }
}
