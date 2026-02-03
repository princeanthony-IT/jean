import { useCallback, useState } from 'react'
import { invoke } from '@/lib/transport'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { SaveContextResponse } from '@/types/chat'
import type { Worktree } from '@/types/projects'
import type { AppPreferences } from '@/types/preferences'

interface UseContextOperationsParams {
  activeSessionId: string | null | undefined
  activeWorktreeId: string | null | undefined
  activeWorktreePath: string | null | undefined
  worktree: Worktree | null | undefined
  queryClient: QueryClient
  preferences: AppPreferences | undefined
}

interface UseContextOperationsReturn {
  /** Opens modal to select saved context */
  handleLoadContext: () => void
  /** Saves context with AI summarization (toast-based) */
  handleSaveContext: () => Promise<void>
  /** Whether the load context modal is open */
  loadContextModalOpen: boolean
  /** Setter for load context modal open state */
  setLoadContextModalOpen: (open: boolean) => void
}

/**
 * Hook for context save/load operations.
 *
 * Provides handlers for saving current session context with AI summarization
 * and loading saved contexts as attachments.
 */
export function useContextOperations({
  activeSessionId,
  activeWorktreeId,
  activeWorktreePath,
  worktree,
  queryClient,
  preferences,
}: UseContextOperationsParams): UseContextOperationsReturn {
  const [loadContextModalOpen, setLoadContextModalOpen] = useState(false)

  // Handle Save Context - generates context summary in the background
  const handleSaveContext = useCallback(async () => {
    if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

    // Get project name from worktree
    const projectName = worktree?.name ?? 'unknown-project'

    const toastId = toast.loading('Saving context...')

    try {
      // Call background summarization command
      const result = await invoke<SaveContextResponse>(
        'generate_context_from_session',
        {
          worktreePath: activeWorktreePath,
          worktreeId: activeWorktreeId,
          sourceSessionId: activeSessionId,
          projectName,
          customPrompt: preferences?.magic_prompts?.context_summary,
          model: preferences?.magic_prompt_models?.context_summary_model,
        }
      )

      toast.success(`Context saved: ${result.filename}`, { id: toastId })

      // Invalidate saved contexts query so Load Context modal shows the new context
      queryClient.invalidateQueries({ queryKey: ['session-context'] })
    } catch (err) {
      console.error('Failed to save context:', err)
      toast.error(`Failed to save context: ${err}`, { id: toastId })
    }
  }, [
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    worktree?.name,
    queryClient,
    preferences?.magic_prompts?.context_summary,
    preferences?.magic_prompt_models?.context_summary_model,
  ])

  // Handle Load Context - opens modal to select saved context
  const handleLoadContext = useCallback(() => {
    setLoadContextModalOpen(true)
  }, [])

  return {
    handleLoadContext,
    handleSaveContext,
    loadContextModalOpen,
    setLoadContextModalOpen,
  }
}
