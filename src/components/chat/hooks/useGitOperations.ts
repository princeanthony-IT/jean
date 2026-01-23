import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { chatQueryKeys } from '@/services/chat'
import { saveWorktreePr, projectsQueryKeys } from '@/services/projects'
import { triggerImmediateGitPoll } from '@/services/git-status'
import { isBaseSession } from '@/types/projects'
import type {
  CreatePrResponse,
  CreateCommitResponse,
  ReviewResponse,
  MergeWorktreeResponse,
  MergeType,
  Worktree,
  Project,
} from '@/types/projects'
import type { Session } from '@/types/chat'
import type { AppPreferences } from '@/types/preferences'

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
  /** Creates PR with AI-generated title and description */
  handleOpenPr: () => Promise<void>
  /** Runs AI code review */
  handleReview: () => Promise<void>
  /** Validates and shows merge options dialog */
  handleMerge: () => Promise<void>
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
    if (!activeWorktreePath) return

    const toastId = toast.loading('Creating commit...')

    try {
      const result = await invoke<CreateCommitResponse>(
        'create_commit_with_ai',
        {
          worktreePath: activeWorktreePath,
          customPrompt: preferences?.magic_prompts?.commit_message,
          push: false,
        }
      )

      // Trigger git status refresh
      triggerImmediateGitPoll()

      toast.success(`Committed: ${result.message.split('\n')[0]}`, {
        id: toastId,
      })
    } catch (error) {
      toast.error(`Failed to commit: ${error}`, { id: toastId })
    }
  }, [activeWorktreePath, preferences?.magic_prompts?.commit_message])

  // Handle Commit & Push - creates commit with AI-generated message and pushes
  const handleCommitAndPush = useCallback(async () => {
    if (!activeWorktreePath) return

    const toastId = toast.loading('Committing and pushing...')

    try {
      const result = await invoke<CreateCommitResponse>(
        'create_commit_with_ai',
        {
          worktreePath: activeWorktreePath,
          customPrompt: preferences?.magic_prompts?.commit_message,
          push: true,
        }
      )

      // Trigger git status refresh
      triggerImmediateGitPoll()

      toast.success(`Committed and pushed: ${result.message.split('\n')[0]}`, {
        id: toastId,
      })
    } catch (error) {
      toast.error(`Failed: ${error}`, { id: toastId })
    }
  }, [activeWorktreePath, preferences?.magic_prompts?.commit_message])

  // Handle Open PR - creates PR with AI-generated title and description in background
  const handleOpenPr = useCallback(async () => {
    if (!activeWorktreeId || !activeWorktreePath || !worktree) return

    const toastId = toast.loading('Creating PR...')

    try {
      const result = await invoke<CreatePrResponse>(
        'create_pr_with_ai_content',
        {
          worktreePath: activeWorktreePath,
          customPrompt: preferences?.magic_prompts?.pr_content,
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
          onClick: () => openUrl(result.pr_url),
        },
      })
    } catch (error) {
      toast.error(`Failed to create PR: ${error}`, { id: toastId })
    }
  }, [activeWorktreeId, activeWorktreePath, worktree, queryClient, preferences?.magic_prompts?.pr_content])

  // Handle Review - runs AI code review in background
  const handleReview = useCallback(async () => {
    if (!activeWorktreeId || !activeWorktreePath) return

    const toastId = toast.loading('Running AI code review...')

    try {
      const result = await invoke<ReviewResponse>('run_review_with_ai', {
        worktreePath: activeWorktreePath,
        customPrompt: preferences?.magic_prompts?.code_review,
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
    }
  }, [activeWorktreeId, activeWorktreePath, preferences?.magic_prompts?.code_review])

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

  // Execute merge with merge type option
  const executeMerge = useCallback(
    async (mergeType: MergeType) => {
      const worktreeData = pendingMergeWorktree
      if (!worktreeData || !activeWorktreeId) return

      // Close dialog
      setShowMergeDialog(false)
      setPendingMergeWorktree(null)

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

          const conflictPrompt = `I tried to merge this branch (\`${featureBranch}\`) into \`${baseBranch}\`, but there are merge conflicts.

To resolve this, please merge \`${baseBranch}\` INTO this branch by running:
\`\`\`
git merge ${baseBranch}
\`\`\`

Then resolve the conflicts in these files:
- ${conflictFiles}${diffSection}

Please help me resolve these conflicts. Analyze the diff above, explain what's conflicting in each file, and guide me through resolving each conflict.`

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
      }
    },
    [activeWorktreeId, pendingMergeWorktree, project, queryClient, inputRef]
  )

  return {
    handleCommit,
    handleCommitAndPush,
    handleOpenPr,
    handleReview,
    handleMerge,
    executeMerge,
    showMergeDialog,
    setShowMergeDialog,
    pendingMergeWorktree,
  }
}
