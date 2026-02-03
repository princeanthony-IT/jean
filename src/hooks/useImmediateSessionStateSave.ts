import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'

/**
 * Saves reviewing/waiting state immediately when it changes.
 * These states change infrequently, so no debounce needed.
 * Fixes the issue where debounced saves don't complete before app close.
 */
export function useImmediateSessionStateSave() {
  // Track previous values to detect changes
  const prevReviewingRef = useRef<Record<string, boolean>>({})
  const prevWaitingRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    // Initialize with current state
    const initialState = useChatStore.getState()
    prevReviewingRef.current = { ...initialState.reviewingSessions }
    prevWaitingRef.current = { ...initialState.waitingForInputSessionIds }

    const unsubscribe = useChatStore.subscribe(state => {
      const {
        reviewingSessions,
        waitingForInputSessionIds,
        sessionWorktreeMap,
        worktreePaths,
      } = state

      // Check for reviewing changes
      for (const [sessionId, isReviewing] of Object.entries(reviewingSessions)) {
        if (prevReviewingRef.current[sessionId] !== isReviewing) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            isReviewing,
          })
        }
      }
      // Check for removed entries (session marked as not reviewing)
      for (const sessionId of Object.keys(prevReviewingRef.current)) {
        if (!(sessionId in reviewingSessions)) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            isReviewing: false,
          })
        }
      }

      // Check for waiting changes
      for (const [sessionId, isWaiting] of Object.entries(
        waitingForInputSessionIds
      )) {
        if (prevWaitingRef.current[sessionId] !== isWaiting) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            waitingForInput: isWaiting,
          })
        }
      }
      // Check for removed entries (session no longer waiting)
      for (const sessionId of Object.keys(prevWaitingRef.current)) {
        if (!(sessionId in waitingForInputSessionIds)) {
          saveSessionStatus(sessionId, sessionWorktreeMap, worktreePaths, {
            waitingForInput: false,
          })
        }
      }

      prevReviewingRef.current = { ...reviewingSessions }
      prevWaitingRef.current = { ...waitingForInputSessionIds }
    })

    return unsubscribe
  }, [])
}

async function saveSessionStatus(
  sessionId: string,
  sessionWorktreeMap: Record<string, string>,
  worktreePaths: Record<string, string>,
  updates: { isReviewing?: boolean; waitingForInput?: boolean }
) {
  const worktreeId = sessionWorktreeMap[sessionId]
  const worktreePath = worktreeId ? worktreePaths[worktreeId] : null

  if (!worktreeId || !worktreePath) {
    logger.warn('Cannot save session status: missing worktree info', {
      sessionId,
    })
    return
  }

  try {
    await invoke('update_session_state', {
      worktreeId,
      worktreePath,
      sessionId,
      isReviewing: updates.isReviewing,
      waitingForInput: updates.waitingForInput,
    })
    logger.debug('Saved session status immediately', { sessionId, ...updates })
  } catch (error) {
    logger.error('Failed to save session status', { sessionId, error })
  }
}
