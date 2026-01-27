import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FolderOpen,
  Loader2,
  Trash2,
  Search,
  MessageSquare,
  Pencil,
  CircleDot,
  RefreshCw,
  X,
  AlertCircle,
  GitPullRequest,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useAllSessions } from '@/services/chat'
import type {
  AllSessionsEntry,
  SavedContext,
  SavedContextsResponse,
  SaveContextResponse,
  Session,
} from '@/types/chat'
import { usePreferences } from '@/services/preferences'
import {
  useGitHubIssues,
  useGitHubPRs,
  useLoadedIssueContexts,
  useLoadedPRContexts,
  useAttachedSavedContexts,
  filterIssues,
  filterPRs,
  githubQueryKeys,
  loadIssueContext,
  removeIssueContext,
  loadPRContext,
  removePRContext,
  getIssueContextContent,
  getPRContextContent,
  attachSavedContext,
  removeSavedContext,
  getSavedContextContent,
} from '@/services/github'
import type {
  GitHubIssue,
  GitHubPullRequest,
  LoadedIssueContext,
  LoadedPullRequestContext,
  AttachedSavedContext,
} from '@/types/github'

type TabId = 'issues' | 'prs' | 'contexts'

interface Tab {
  id: TabId
  label: string
  key: string
}

const TABS: Tab[] = [
  { id: 'issues', label: 'Issues', key: 'I' },
  { id: 'prs', label: 'Pull Requests', key: 'P' },
  { id: 'contexts', label: 'Contexts', key: 'C' },
]

interface LoadContextModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Props for session context generation
  worktreeId: string | null
  worktreePath: string | null
  activeSessionId: string | null
  projectName: string // For current session context generation
}

/** Format file size to human-readable string */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Session with worktree context for the click handler */
interface SessionWithContext {
  session: Session
  worktreeId: string
  worktreePath: string
  projectName: string
}

export function LoadContextModal({
  open,
  onOpenChange,
  worktreeId,
  worktreePath,
  activeSessionId,
  projectName: _projectName,
}: LoadContextModalProps) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('issues')

  // Shared state
  const [searchQuery, setSearchQuery] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Loading/removing state - use Sets to track multiple concurrent operations
  const [loadingNumbers, setLoadingNumbers] = useState<Set<number>>(new Set())
  const [removingNumbers, setRemovingNumbers] = useState<Set<number>>(new Set())

  // Context tab state
  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(null)
  const [editingFilename, setEditingFilename] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // Context viewer state
  const [viewingContext, setViewingContext] = useState<{
    type: 'issue' | 'pr' | 'saved'
    number?: number
    slug?: string
    title: string
    content: string
  } | null>(null)

  // Loading/removing state for saved contexts - use Sets to track concurrent operations
  const [loadingSlugs, setLoadingSlugs] = useState<Set<string>>(new Set())
  const [removingSlugs, setRemovingSlugs] = useState<Set<string>>(new Set())

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Issue contexts for this worktree
  const {
    data: loadedIssueContexts,
    isLoading: isLoadingIssueContexts,
    refetch: refetchIssueContexts,
  } = useLoadedIssueContexts(worktreeId)

  // PR contexts for this worktree
  const {
    data: loadedPRContexts,
    isLoading: isLoadingPRContexts,
    refetch: refetchPRContexts,
  } = useLoadedPRContexts(worktreeId)

  // Attached saved contexts for this worktree
  const {
    data: attachedSavedContexts,
    isLoading: isLoadingAttachedContexts,
    refetch: refetchAttachedContexts,
  } = useAttachedSavedContexts(worktreeId)

  // GitHub issues query
  const issueState = includeClosed ? 'all' : 'open'
  const {
    data: issues,
    isLoading: isLoadingIssues,
    isFetching: isRefetchingIssues,
    error: issuesError,
    refetch: refetchIssues,
  } = useGitHubIssues(worktreePath, issueState)

  // GitHub PRs query
  const prState = includeClosed ? 'all' : 'open'
  const {
    data: prs,
    isLoading: isLoadingPRs,
    isFetching: isRefetchingPRs,
    error: prsError,
    refetch: refetchPRs,
  } = useGitHubPRs(worktreePath, prState)

  // Fetch saved contexts
  const {
    data: contextsData,
    isLoading: isLoadingContexts,
    error: contextsError,
    refetch: refetchContexts,
  } = useQuery({
    queryKey: ['session-context'],
    queryFn: () => invoke<SavedContextsResponse>('list_saved_contexts'),
    enabled: open,
    staleTime: 1000 * 60 * 5, // 5 minutes - contexts don't change frequently
  })

  // Fetch all sessions across all worktrees
  const { data: allSessionsData, isLoading: isLoadingSessions } =
    useAllSessions(open)

  // Filter issues locally, excluding already loaded ones
  const filteredIssues = useMemo(() => {
    const loadedNumbers = new Set(loadedIssueContexts?.map(c => c.number) ?? [])
    const filtered = filterIssues(issues ?? [], searchQuery)
    return filtered.filter(issue => !loadedNumbers.has(issue.number))
  }, [issues, searchQuery, loadedIssueContexts])

  // Filter PRs locally, excluding already loaded ones
  const filteredPRs = useMemo(() => {
    const loadedNumbers = new Set(loadedPRContexts?.map(c => c.number) ?? [])
    const filtered = filterPRs(prs ?? [], searchQuery)
    return filtered.filter(pr => !loadedNumbers.has(pr.number))
  }, [prs, searchQuery, loadedPRContexts])

  // Filter contexts by search query (includes custom name), excluding already attached ones
  const filteredContexts = useMemo(() => {
    if (!contextsData?.contexts) return []

    // Build set of attached slugs to exclude
    const attachedSlugs = new Set(attachedSavedContexts?.map(c => c.slug) ?? [])

    // Filter out already-attached contexts
    let filtered = contextsData.contexts.filter(ctx => !attachedSlugs.has(ctx.slug))

    if (!searchQuery) return filtered

    const query = searchQuery.toLowerCase()
    return filtered.filter(
      ctx =>
        ctx.slug.toLowerCase().includes(query) ||
        ctx.project_name.toLowerCase().includes(query) ||
        (ctx.name && ctx.name.toLowerCase().includes(query))
    )
  }, [contextsData, searchQuery, attachedSavedContexts])

  // Filter sessions (exclude current session, apply search, group by project/worktree)
  const filteredEntries = useMemo(() => {
    if (!allSessionsData?.entries) return []

    return allSessionsData.entries
      .map(entry => {
        // Filter sessions within each entry
        const filteredSessions = entry.sessions
          .filter(s => s.id !== activeSessionId) // Exclude current session
          .filter(s => {
            if (!searchQuery) return true
            const query = searchQuery.toLowerCase()
            return (
              s.name.toLowerCase().includes(query) ||
              entry.project_name.toLowerCase().includes(query) ||
              entry.worktree_name.toLowerCase().includes(query) ||
              s.messages.some(m => m.content.toLowerCase().includes(query))
            )
          })

        return {
          ...entry,
          sessions: filteredSessions,
        }
      })
      .filter(entry => entry.sessions.length > 0) // Only keep entries with sessions
  }, [allSessionsData, searchQuery, activeSessionId])

  // Mutation for renaming contexts
  const renameMutation = useMutation({
    mutationFn: async ({
      filename,
      newName,
    }: {
      filename: string
      newName: string
    }) => {
      await invoke('rename_saved_context', { filename, newName })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-context'] })
    },
    onError: error => {
      toast.error(`Failed to rename context: ${error}`)
    },
  })

  // Track the previous open state to detect when modal opens
  const prevOpenRef = useRef(false)

  // Determine default tab and reset state when modal opens
  useEffect(() => {
    // Only run when modal transitions from closed to open
    if (open && !prevOpenRef.current) {
      // Dynamic default tab based on loaded data
      if ((loadedIssueContexts?.length ?? 0) > 0) {
        setActiveTab('issues')
      } else if ((loadedPRContexts?.length ?? 0) > 0) {
        setActiveTab('prs')
      } else {
        setActiveTab('contexts')
      }

      // Reset other state
      setSearchQuery('')
      setIncludeClosed(false)
      setSelectedIndex(0)
      setLoadingNumbers(new Set())
      setRemovingNumbers(new Set())
      setLoadingSlugs(new Set())
      setRemovingSlugs(new Set())
      setGeneratingSessionId(null)
      setEditingFilename(null)
      setEditValue('')

      // Invalidate caches to fetch fresh data
      if (worktreePath) {
        queryClient.invalidateQueries({
          queryKey: githubQueryKeys.issues(worktreePath, 'open'),
        })
        queryClient.invalidateQueries({
          queryKey: githubQueryKeys.issues(worktreePath, 'all'),
        })
        queryClient.invalidateQueries({
          queryKey: githubQueryKeys.prs(worktreePath, 'open'),
        })
        queryClient.invalidateQueries({
          queryKey: githubQueryKeys.prs(worktreePath, 'all'),
        })
      }
      if (worktreeId) {
        queryClient.invalidateQueries({
          queryKey: githubQueryKeys.loadedContexts(worktreeId),
        })
        queryClient.invalidateQueries({
          queryKey: githubQueryKeys.loadedPrContexts(worktreeId),
        })
        queryClient.invalidateQueries({
          queryKey: githubQueryKeys.attachedContexts(worktreeId),
        })
      }
      // Invalidate saved contexts list (not worktree-specific)
      queryClient.invalidateQueries({ queryKey: ['session-context'] })
    }
    prevOpenRef.current = open
  }, [open, worktreePath, worktreeId, queryClient, loadedIssueContexts?.length, loadedPRContexts?.length, attachedSavedContexts?.length])

  // Focus search input when modal opens or tab changes
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [open, activeTab])

  // Reset selection and search when switching tabs
  useEffect(() => {
    setSelectedIndex(0)
    setSearchQuery('')
  }, [activeTab])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingFilename && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingFilename])

  // Clear editing state when modal closes
  useEffect(() => {
    if (!open) {
      setEditingFilename(null)
      setEditValue('')
    }
  }, [open])

  // Handle loading/refreshing an issue
  const handleLoadIssue = useCallback(
    async (issueNumber: number, isRefresh: boolean = false) => {
      if (!worktreeId || !worktreePath) {
        toast.error('No active worktree')
        return
      }

      setLoadingNumbers(prev => new Set(prev).add(issueNumber))
      const toastId = toast.loading(
        isRefresh ? `Refreshing issue #${issueNumber}...` : `Loading issue #${issueNumber}...`
      )

      try {
        const result = await loadIssueContext(worktreeId, issueNumber, worktreePath)

        // Refresh loaded contexts list
        await refetchIssueContexts()

        toast.success(
          `Issue #${result.number}: ${result.title}${result.commentCount > 0 ? ` (${result.commentCount} comments)` : ''}`,
          { id: toastId }
        )
      } catch (error) {
        toast.error(`${error}`, { id: toastId })
      } finally {
        setLoadingNumbers(prev => {
          const next = new Set(prev)
          next.delete(issueNumber)
          return next
        })
      }
    },
    [worktreeId, worktreePath, refetchIssueContexts]
  )

  // Handle loading/refreshing a PR
  const handleLoadPR = useCallback(
    async (prNumber: number, isRefresh: boolean = false) => {
      if (!worktreeId || !worktreePath) {
        toast.error('No active worktree')
        return
      }

      setLoadingNumbers(prev => new Set(prev).add(prNumber))
      const toastId = toast.loading(
        isRefresh ? `Refreshing PR #${prNumber}...` : `Loading PR #${prNumber}...`
      )

      try {
        const result = await loadPRContext(worktreeId, prNumber, worktreePath)

        // Refresh loaded contexts list
        await refetchPRContexts()

        toast.success(
          `PR #${result.number}: ${result.title}${result.commentCount > 0 ? ` (${result.commentCount} comments)` : ''}${result.reviewCount > 0 ? `, ${result.reviewCount} reviews` : ''}`,
          { id: toastId }
        )
      } catch (error) {
        toast.error(`${error}`, { id: toastId })
      } finally {
        setLoadingNumbers(prev => {
          const next = new Set(prev)
          next.delete(prNumber)
          return next
        })
      }
    },
    [worktreeId, worktreePath, refetchPRContexts]
  )

  // Handle removing a loaded issue
  const handleRemoveIssue = useCallback(
    async (issueNumber: number) => {
      if (!worktreeId || !worktreePath) return

      setRemovingNumbers(prev => new Set(prev).add(issueNumber))

      try {
        await removeIssueContext(worktreeId, issueNumber, worktreePath)
        await refetchIssueContexts()
        toast.success(`Removed issue #${issueNumber} from context`)
      } catch (error) {
        toast.error(`Failed to remove issue: ${error}`)
      } finally {
        setRemovingNumbers(prev => {
          const next = new Set(prev)
          next.delete(issueNumber)
          return next
        })
      }
    },
    [worktreeId, worktreePath, refetchIssueContexts]
  )

  // Handle removing a loaded PR
  const handleRemovePR = useCallback(
    async (prNumber: number) => {
      if (!worktreeId || !worktreePath) return

      setRemovingNumbers(prev => new Set(prev).add(prNumber))

      try {
        await removePRContext(worktreeId, prNumber, worktreePath)
        await refetchPRContexts()
        toast.success(`Removed PR #${prNumber} from context`)
      } catch (error) {
        toast.error(`Failed to remove PR: ${error}`)
      } finally {
        setRemovingNumbers(prev => {
          const next = new Set(prev)
          next.delete(prNumber)
          return next
        })
      }
    },
    [worktreeId, worktreePath, refetchPRContexts]
  )

  // Handle viewing an issue context
  const handleViewIssue = useCallback(
    async (ctx: LoadedIssueContext) => {
      if (!worktreeId || !worktreePath) return

      try {
        const content = await getIssueContextContent(worktreeId, ctx.number, worktreePath)
        setViewingContext({
          type: 'issue',
          number: ctx.number,
          title: ctx.title,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [worktreeId, worktreePath]
  )

  // Handle viewing a PR context
  const handleViewPR = useCallback(
    async (ctx: LoadedPullRequestContext) => {
      if (!worktreeId || !worktreePath) return

      try {
        const content = await getPRContextContent(worktreeId, ctx.number, worktreePath)
        setViewingContext({
          type: 'pr',
          number: ctx.number,
          title: ctx.title,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [worktreeId, worktreePath]
  )

  // Handle selecting an issue from the search list
  const handleSelectIssue = useCallback(
    (issue: GitHubIssue) => {
      handleLoadIssue(issue.number, false)
      setSearchQuery('')
      setSelectedIndex(0)
    },
    [handleLoadIssue]
  )

  // Handle selecting a PR from the search list
  const handleSelectPR = useCallback(
    (pr: GitHubPullRequest) => {
      handleLoadPR(pr.number, false)
      setSearchQuery('')
      setSelectedIndex(0)
    },
    [handleLoadPR]
  )

  // Context tab handlers
  const handleDeleteContext = useCallback(
    async (e: React.MouseEvent, context: SavedContext) => {
      e.stopPropagation()
      try {
        await invoke('delete_context_file', { path: context.path })
        refetchContexts()
      } catch (err) {
        console.error('Failed to delete context:', err)
      }
    },
    [refetchContexts]
  )

  // Handle attaching a saved context from the "Available Contexts" list
  const handleAttachContext = useCallback(
    async (context: SavedContext) => {
      if (!worktreeId) {
        toast.error('No active worktree')
        return
      }

      setLoadingSlugs(prev => new Set(prev).add(context.slug))
      const toastId = toast.loading(`Attaching context "${context.name || context.slug}"...`)

      try {
        await attachSavedContext(worktreeId, context.path, context.slug)

        // Refresh attached contexts list
        await refetchAttachedContexts()

        toast.success(`Context "${context.name || context.slug}" attached`, { id: toastId })
        setSearchQuery('')
        setSelectedIndex(0)
      } catch (error) {
        toast.error(`${error}`, { id: toastId })
      } finally {
        setLoadingSlugs(prev => {
          const next = new Set(prev)
          next.delete(context.slug)
          return next
        })
      }
    },
    [worktreeId, refetchAttachedContexts]
  )

  // Handle removing an attached saved context
  const handleRemoveAttachedContext = useCallback(
    async (slug: string) => {
      if (!worktreeId) return

      setRemovingSlugs(prev => new Set(prev).add(slug))

      try {
        await removeSavedContext(worktreeId, slug)
        await refetchAttachedContexts()
        toast.success(`Removed context "${slug}"`)
      } catch (error) {
        toast.error(`Failed to remove context: ${error}`)
      } finally {
        setRemovingSlugs(prev => {
          const next = new Set(prev)
          next.delete(slug)
          return next
        })
      }
    },
    [worktreeId, refetchAttachedContexts]
  )

  // Handle viewing an attached saved context
  const handleViewAttachedContext = useCallback(
    async (ctx: AttachedSavedContext) => {
      if (!worktreeId) return

      try {
        const content = await getSavedContextContent(worktreeId, ctx.slug)
        setViewingContext({
          type: 'saved',
          slug: ctx.slug,
          title: ctx.name || ctx.slug,
          content,
        })
      } catch (error) {
        toast.error(`Failed to load context: ${error}`)
      }
    },
    [worktreeId]
  )

  const handleStartEdit = useCallback(
    (e: React.MouseEvent, context: SavedContext) => {
      e.stopPropagation()
      setEditingFilename(context.filename)
      setEditValue(context.name || context.slug)
    },
    []
  )

  const handleRenameSubmit = useCallback(
    (filename: string) => {
      const newName = editValue.trim()
      renameMutation.mutate({ filename, newName })
      setEditingFilename(null)
    },
    [editValue, renameMutation]
  )

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent, filename: string) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleRenameSubmit(filename)
      } else if (e.key === 'Escape') {
        setEditingFilename(null)
      } else if (e.key === ' ') {
        // Prevent space from triggering parent button click
        e.stopPropagation()
      }
    },
    [handleRenameSubmit]
  )

  const handleSessionClick = useCallback(
    async (sessionWithContext: SessionWithContext) => {
      const { session, worktreeId: sessionWorktreeId, worktreePath: sessionWorktreePath, projectName: sessionProjectName } =
        sessionWithContext

      if (!worktreeId) {
        toast.error('No active worktree')
        return
      }

      setGeneratingSessionId(session.id)
      try {
        // Call background summarization command with the session's worktree info
        const result = await invoke<SaveContextResponse>(
          'generate_context_from_session',
          {
            worktreePath: sessionWorktreePath,
            worktreeId: sessionWorktreeId,
            sourceSessionId: session.id,
            projectName: sessionProjectName,
            customPrompt: preferences?.magic_prompts?.context_summary,
            model: preferences?.magic_prompt_models?.context_summary_model,
          }
        )

        // Refetch saved contexts so the new one appears immediately
        refetchContexts()

        // Extract slug from filename and attach to current worktree
        const slug = result.filename
          .split('-')
          .slice(2)
          .join('-')
          .replace('.md', '')

        await attachSavedContext(worktreeId, result.path, slug)

        // Refresh attached contexts list
        await refetchAttachedContexts()

        toast.success(`Context created and attached: ${result.filename}`)
        setSearchQuery('')
        setSelectedIndex(0)
      } catch (err) {
        console.error('Failed to generate context:', err)
        toast.error(`Failed to generate context: ${err}`)
      } finally {
        setGeneratingSessionId(null)
      }
    },
    [worktreeId, refetchContexts, refetchAttachedContexts, preferences?.magic_prompts?.context_summary, preferences?.magic_prompt_models?.context_summary_model]
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Tab shortcuts (Cmd+key, works even when input is focused)
      if (e.metaKey || e.ctrlKey) {
        if (key === 'i') {
          e.preventDefault()
          setActiveTab('issues')
          return
        }
        if (key === 'p') {
          e.preventDefault()
          setActiveTab('prs')
          return
        }
        if (key === 'c') {
          e.preventDefault()
          setActiveTab('contexts')
          return
        }
      }

      // List navigation for issues tab
      if (activeTab === 'issues' && filteredIssues.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedIndex(prev =>
            Math.min(prev + 1, filteredIssues.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredIssues[selectedIndex]) {
          e.preventDefault()
          handleSelectIssue(filteredIssues[selectedIndex])
          return
        }
      }

      // List navigation for PRs tab
      if (activeTab === 'prs' && filteredPRs.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedIndex(prev =>
            Math.min(prev + 1, filteredPRs.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredPRs[selectedIndex]) {
          e.preventDefault()
          handleSelectPR(filteredPRs[selectedIndex])
          return
        }
      }

      // List navigation for contexts tab (saved contexts + sessions)
      if (activeTab === 'contexts') {
        const totalItems = filteredContexts.length + filteredEntries.reduce((acc, e) => acc + e.sessions.length, 0)
        if (totalItems > 0) {
          if (key === 'arrowdown') {
            e.preventDefault()
            setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1))
            return
          }
          if (key === 'arrowup') {
            e.preventDefault()
            setSelectedIndex(prev => Math.max(prev - 1, 0))
            return
          }
          if (key === 'enter') {
            e.preventDefault()
            // Determine which item is selected
            if (selectedIndex < filteredContexts.length) {
              const context = filteredContexts[selectedIndex]
              if (context) handleAttachContext(context)
            } else {
              // Find the session at this index
              let idx = selectedIndex - filteredContexts.length
              for (const entry of filteredEntries) {
                if (idx < entry.sessions.length) {
                  const session = entry.sessions[idx]
                  if (session) {
                    handleSessionClick({
                      session,
                      worktreeId: entry.worktree_id,
                      worktreePath: entry.worktree_path,
                      projectName: entry.project_name,
                    })
                  }
                  break
                }
                idx -= entry.sessions.length
              }
            }
            return
          }
        }
      }
    },
    [activeTab, filteredIssues, filteredPRs, filteredContexts, filteredEntries, selectedIndex, handleSelectIssue, handleSelectPR, handleAttachContext, handleSessionClick]
  )

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector(
      `[data-load-item-index="${selectedIndex}"]`
    )
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const hasLoadedIssueContexts = (loadedIssueContexts?.length ?? 0) > 0
  const hasLoadedPRContexts = (loadedPRContexts?.length ?? 0) > 0
  const hasAttachedContexts = (attachedSavedContexts?.length ?? 0) > 0
  const hasContexts = filteredContexts.length > 0
  const hasSessions = filteredEntries.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 !max-w-[calc(100vw-4rem)] !w-[calc(100vw-4rem)] !h-[calc(100vh-4rem)] font-sans rounded-xl flex flex-col"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Load Context
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 px-4 py-2 text-sm font-medium transition-colors border-b-2',
                'hover:bg-accent focus:outline-none',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground'
              )}
            >
              {tab.label}
              <kbd className="ml-2 text-xs text-muted-foreground bg-muted px-1 py-0.5 rounded">
                ⌘+{tab.key}
              </kbd>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex flex-col flex-1 min-h-0">
          {activeTab === 'issues' && (
            <IssuesTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              includeClosed={includeClosed}
              setIncludeClosed={setIncludeClosed}
              searchInputRef={searchInputRef}
              loadedContexts={loadedIssueContexts ?? []}
              isLoadingContexts={isLoadingIssueContexts}
              filteredItems={filteredIssues}
              isLoading={isLoadingIssues}
              isRefetching={isRefetchingIssues}
              error={issuesError}
              onRefresh={() => refetchIssues()}
              selectedIndex={selectedIndex}
              setSelectedIndex={setSelectedIndex}
              onSelectItem={handleSelectIssue}
              loadingNumbers={loadingNumbers}
              removingNumbers={removingNumbers}
              onLoadItem={(num: number, refresh: boolean) => handleLoadIssue(num, refresh)}
              onRemoveItem={handleRemoveIssue}
              onViewItem={handleViewIssue}
              hasLoadedContexts={hasLoadedIssueContexts}
            />
          )}

          {activeTab === 'prs' && (
            <PullRequestsTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              includeClosed={includeClosed}
              setIncludeClosed={setIncludeClosed}
              searchInputRef={searchInputRef}
              loadedContexts={loadedPRContexts ?? []}
              isLoadingContexts={isLoadingPRContexts}
              filteredItems={filteredPRs}
              isLoading={isLoadingPRs}
              isRefetching={isRefetchingPRs}
              error={prsError}
              onRefresh={() => refetchPRs()}
              selectedIndex={selectedIndex}
              setSelectedIndex={setSelectedIndex}
              onSelectItem={handleSelectPR}
              loadingNumbers={loadingNumbers}
              removingNumbers={removingNumbers}
              onLoadItem={(num: number, refresh: boolean) => handleLoadPR(num, refresh)}
              onRemoveItem={handleRemovePR}
              onViewItem={handleViewPR}
              hasLoadedContexts={hasLoadedPRContexts}
            />
          )}

          {activeTab === 'contexts' && (
            <ContextsTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchInputRef={searchInputRef}
              // Attached contexts (loaded into this worktree)
              attachedContexts={attachedSavedContexts ?? []}
              isLoadingAttachedContexts={isLoadingAttachedContexts}
              hasAttachedContexts={hasAttachedContexts}
              loadingSlugs={loadingSlugs}
              removingSlugs={removingSlugs}
              onViewAttachedContext={handleViewAttachedContext}
              onRemoveAttachedContext={handleRemoveAttachedContext}
              // Available contexts (not yet attached)
              filteredContexts={filteredContexts}
              filteredEntries={filteredEntries}
              isLoading={isLoadingContexts || isLoadingSessions}
              error={contextsError}
              hasContexts={hasContexts}
              hasSessions={hasSessions}
              selectedIndex={selectedIndex}
              setSelectedIndex={setSelectedIndex}
              editingFilename={editingFilename}
              editValue={editValue}
              setEditValue={setEditValue}
              editInputRef={editInputRef}
              generatingSessionId={generatingSessionId}
              onAttachContext={handleAttachContext}
              onStartEdit={handleStartEdit}
              onRenameSubmit={handleRenameSubmit}
              onRenameKeyDown={handleRenameKeyDown}
              onDeleteContext={handleDeleteContext}
              onSessionClick={handleSessionClick}
            />
          )}
        </div>

        {/* Context viewer modal */}
        {viewingContext && (
          <Dialog open={true} onOpenChange={() => setViewingContext(null)}>
            <DialogContent className="!max-w-[calc(100vw-8rem)] !w-[calc(100vw-8rem)] !h-[calc(100vh-8rem)] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {viewingContext.type === 'issue' && (
                    <CircleDot className="h-4 w-4 text-green-500" />
                  )}
                  {viewingContext.type === 'pr' && (
                    <GitPullRequest className="h-4 w-4 text-green-500" />
                  )}
                  {viewingContext.type === 'saved' && (
                    <FolderOpen className="h-4 w-4 text-blue-500" />
                  )}
                  {viewingContext.number ? `#${viewingContext.number}: ` : ''}{viewingContext.title}
                </DialogTitle>
              </DialogHeader>
              <ScrollArea className="flex-1 min-h-0">
                <pre className="text-xs font-mono whitespace-pre-wrap p-4 bg-muted rounded-md">
                  {viewingContext.content}
                </pre>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Issues Tab
// =============================================================================

interface IssuesTabProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  includeClosed: boolean
  setIncludeClosed: (include: boolean) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  loadedContexts: LoadedIssueContext[]
  isLoadingContexts: boolean
  filteredItems: GitHubIssue[]
  isLoading: boolean
  isRefetching: boolean
  error: Error | null
  onRefresh: () => void
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  onSelectItem: (issue: GitHubIssue) => void
  loadingNumbers: Set<number>
  removingNumbers: Set<number>
  onLoadItem: (num: number, refresh: boolean) => void
  onRemoveItem: (num: number) => void
  onViewItem: (ctx: LoadedIssueContext) => void
  hasLoadedContexts: boolean
}

function IssuesTab({
  searchQuery,
  setSearchQuery,
  includeClosed,
  setIncludeClosed,
  searchInputRef,
  loadedContexts,
  isLoadingContexts,
  filteredItems,
  isLoading,
  isRefetching,
  error,
  onRefresh,
  selectedIndex,
  setSelectedIndex,
  onSelectItem,
  loadingNumbers,
  removingNumbers,
  onLoadItem,
  onRemoveItem,
  onViewItem,
  hasLoadedContexts,
}: IssuesTabProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Loaded issues section */}
      {isLoadingContexts ? (
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
      ) : hasLoadedContexts ? (
        <div className="border-b border-border">
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
            Loaded Issues
          </div>
          <div className="max-h-[150px] overflow-y-auto">
            {loadedContexts.map(ctx => (
              <LoadedIssueItem
                key={ctx.number}
                context={ctx}
                isLoading={loadingNumbers.has(ctx.number)}
                isRemoving={removingNumbers.has(ctx.number)}
                onRefresh={() => onLoadItem(ctx.number, true)}
                onRemove={() => onRemoveItem(ctx.number)}
                onView={() => onViewItem(ctx)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Search section */}
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search issues by #number, title, or description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <button
            onClick={onRefresh}
            disabled={isRefetching}
            className={cn(
              'flex items-center justify-center h-8 w-8 rounded-md border border-border',
              'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
              'transition-colors',
              isRefetching && 'opacity-50 cursor-not-allowed'
            )}
            title="Refresh issues"
          >
            <RefreshCw
              className={cn(
                'h-4 w-4 text-muted-foreground',
                isRefetching && 'animate-spin'
              )}
            />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="load-include-closed-issues"
            checked={includeClosed}
            onCheckedChange={checked => setIncludeClosed(checked === true)}
          />
          <label
            htmlFor="load-include-closed-issues"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Include closed issues
          </label>
        </div>
      </div>

      {/* Issues list */}
      <ScrollArea className="flex-1 min-h-0">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading issues...
            </span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <AlertCircle className="h-5 w-5 text-destructive mb-2" />
            <span className="text-sm text-muted-foreground">
              {error.message || 'Failed to load issues'}
            </span>
          </div>
        )}

        {!isLoading && !error && filteredItems.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">
              {searchQuery
                ? 'No issues match your search'
                : hasLoadedContexts
                  ? 'All open issues already loaded'
                  : 'No open issues found'}
            </span>
          </div>
        )}

        {!isLoading && !error && filteredItems.length > 0 && (
          <div className="py-1">
            {filteredItems.map((issue, index) => (
              <IssueItem
                key={issue.number}
                issue={issue}
                index={index}
                isSelected={index === selectedIndex}
                isLoading={loadingNumbers.has(issue.number)}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onSelectItem(issue)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// =============================================================================
// Pull Requests Tab
// =============================================================================

interface PullRequestsTabProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  includeClosed: boolean
  setIncludeClosed: (include: boolean) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  loadedContexts: LoadedPullRequestContext[]
  isLoadingContexts: boolean
  filteredItems: GitHubPullRequest[]
  isLoading: boolean
  isRefetching: boolean
  error: Error | null
  onRefresh: () => void
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  onSelectItem: (pr: GitHubPullRequest) => void
  loadingNumbers: Set<number>
  removingNumbers: Set<number>
  onLoadItem: (num: number, refresh: boolean) => void
  onRemoveItem: (num: number) => void
  onViewItem: (ctx: LoadedPullRequestContext) => void
  hasLoadedContexts: boolean
}

function PullRequestsTab({
  searchQuery,
  setSearchQuery,
  includeClosed,
  setIncludeClosed,
  searchInputRef,
  loadedContexts,
  isLoadingContexts,
  filteredItems,
  isLoading,
  isRefetching,
  error,
  onRefresh,
  selectedIndex,
  setSelectedIndex,
  onSelectItem,
  loadingNumbers,
  removingNumbers,
  onLoadItem,
  onRemoveItem,
  onViewItem,
  hasLoadedContexts,
}: PullRequestsTabProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Loaded PRs section */}
      {isLoadingContexts ? (
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
      ) : hasLoadedContexts ? (
        <div className="border-b border-border">
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
            Loaded Pull Requests
          </div>
          <div className="max-h-[150px] overflow-y-auto">
            {loadedContexts.map(ctx => (
              <LoadedPRItem
                key={ctx.number}
                context={ctx}
                isLoading={loadingNumbers.has(ctx.number)}
                isRemoving={removingNumbers.has(ctx.number)}
                onRefresh={() => onLoadItem(ctx.number, true)}
                onRemove={() => onRemoveItem(ctx.number)}
                onView={() => onViewItem(ctx)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Search section */}
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search PRs by #number, title, branch, or description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <button
            onClick={onRefresh}
            disabled={isRefetching}
            className={cn(
              'flex items-center justify-center h-8 w-8 rounded-md border border-border',
              'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
              'transition-colors',
              isRefetching && 'opacity-50 cursor-not-allowed'
            )}
            title="Refresh pull requests"
          >
            <RefreshCw
              className={cn(
                'h-4 w-4 text-muted-foreground',
                isRefetching && 'animate-spin'
              )}
            />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="load-include-closed-prs"
            checked={includeClosed}
            onCheckedChange={checked => setIncludeClosed(checked === true)}
          />
          <label
            htmlFor="load-include-closed-prs"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Include closed/merged PRs
          </label>
        </div>
      </div>

      {/* PRs list */}
      <ScrollArea className="flex-1 min-h-0">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading pull requests...
            </span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <AlertCircle className="h-5 w-5 text-destructive mb-2" />
            <span className="text-sm text-muted-foreground">
              {error.message || 'Failed to load pull requests'}
            </span>
          </div>
        )}

        {!isLoading && !error && filteredItems.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">
              {searchQuery
                ? 'No PRs match your search'
                : hasLoadedContexts
                  ? 'All open PRs already loaded'
                  : 'No open pull requests found'}
            </span>
          </div>
        )}

        {!isLoading && !error && filteredItems.length > 0 && (
          <div className="py-1">
            {filteredItems.map((pr, index) => (
              <PRItem
                key={pr.number}
                pr={pr}
                index={index}
                isSelected={index === selectedIndex}
                isLoading={loadingNumbers.has(pr.number)}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onSelectItem(pr)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// =============================================================================
// Contexts Tab
// =============================================================================

interface ContextsTabProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  // Attached contexts (loaded into this worktree)
  attachedContexts: AttachedSavedContext[]
  isLoadingAttachedContexts: boolean
  hasAttachedContexts: boolean
  loadingSlugs: Set<string>
  removingSlugs: Set<string>
  onViewAttachedContext: (ctx: AttachedSavedContext) => void
  onRemoveAttachedContext: (slug: string) => void
  // Available contexts (not yet attached)
  filteredContexts: SavedContext[]
  filteredEntries: AllSessionsEntry[]
  isLoading: boolean
  error: Error | null
  hasContexts: boolean
  hasSessions: boolean
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  editingFilename: string | null
  editValue: string
  setEditValue: (value: string) => void
  editInputRef: React.RefObject<HTMLInputElement | null>
  generatingSessionId: string | null
  onAttachContext: (context: SavedContext) => void
  onStartEdit: (e: React.MouseEvent, context: SavedContext) => void
  onRenameSubmit: (filename: string) => void
  onRenameKeyDown: (e: React.KeyboardEvent, filename: string) => void
  onDeleteContext: (e: React.MouseEvent, context: SavedContext) => void
  onSessionClick: (sessionWithContext: SessionWithContext) => void
}

function ContextsTab({
  searchQuery,
  setSearchQuery,
  searchInputRef,
  // Attached contexts
  attachedContexts,
  isLoadingAttachedContexts,
  hasAttachedContexts,
  loadingSlugs,
  removingSlugs,
  onViewAttachedContext,
  onRemoveAttachedContext,
  // Available contexts
  filteredContexts,
  filteredEntries,
  isLoading,
  error,
  hasContexts,
  hasSessions,
  selectedIndex,
  setSelectedIndex,
  editingFilename,
  editValue,
  setEditValue,
  editInputRef,
  generatingSessionId,
  onAttachContext,
  onStartEdit,
  onRenameSubmit,
  onRenameKeyDown,
  onDeleteContext,
  onSessionClick,
}: ContextsTabProps) {
  const isEmpty = !hasContexts && !hasSessions && !hasAttachedContexts && !isLoading && !error

  // Calculate flat index for sessions
  let sessionStartIndex = filteredContexts.length

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Attached Contexts section (like loaded issues/PRs) */}
      {isLoadingAttachedContexts ? (
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
      ) : hasAttachedContexts ? (
        <div className="border-b border-border">
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
            Attached Contexts
          </div>
          <div className="max-h-[150px] overflow-y-auto">
            {attachedContexts.map(ctx => (
              <AttachedContextItem
                key={ctx.slug}
                context={ctx}
                isRemoving={removingSlugs.has(ctx.slug)}
                onView={() => onViewAttachedContext(ctx)}
                onRemove={() => onRemoveAttachedContext(ctx.slug)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Search section */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search contexts and sessions..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            Failed to load saved contexts
          </div>
        ) : isEmpty ? (
          <div className="text-center py-8 text-muted-foreground">
            No saved contexts or sessions available.
            <br />
            <span className="text-sm">
              Use &quot;Save Context&quot; to save a conversation summary.
            </span>
          </div>
        ) : (
          <div className="py-1">
            {/* Available Contexts - narrow list style like PRs */}
            {hasContexts && (
              <>
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                  Available Contexts
                </div>
                {filteredContexts.map((context, index) => (
                  <ContextItem
                    key={context.id}
                    context={context}
                    index={index}
                    isSelected={index === selectedIndex}
                    isLoading={loadingSlugs.has(context.slug)}
                    isEditing={editingFilename === context.filename}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    editInputRef={editInputRef}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => onAttachContext(context)}
                    onStartEdit={e => onStartEdit(e, context)}
                    onRenameSubmit={() => onRenameSubmit(context.filename)}
                    onRenameKeyDown={e => onRenameKeyDown(e, context.filename)}
                    onDelete={e => onDeleteContext(e, context)}
                  />
                ))}
              </>
            )}

            {/* Sessions Section - narrow list style */}
            {hasSessions && (
              <>
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30 mt-2">
                  Generate from Session
                </div>
                {filteredEntries.map(entry => {
                  const entryElement = (
                    <SessionGroup
                      key={entry.worktree_id}
                      entry={entry}
                      generatingSessionId={generatingSessionId}
                      onSessionClick={onSessionClick}
                      selectedIndex={selectedIndex}
                      sessionStartIndex={sessionStartIndex}
                      setSelectedIndex={setSelectedIndex}
                    />
                  )
                  sessionStartIndex += entry.sessions.length
                  return entryElement
                })}
              </>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// =============================================================================
// Shared Components
// =============================================================================

/** Component for a group of sessions from a single project/worktree */
function SessionGroup({
  entry,
  generatingSessionId,
  onSessionClick,
  selectedIndex,
  sessionStartIndex,
  setSelectedIndex,
}: {
  entry: AllSessionsEntry
  generatingSessionId: string | null
  onSessionClick: (sessionWithContext: SessionWithContext) => void
  selectedIndex: number
  sessionStartIndex: number
  setSelectedIndex: (index: number) => void
}) {
  return (
    <div className="space-y-1">
      {/* Project/Worktree header */}
      <div className="text-xs text-muted-foreground px-1 flex items-center gap-1">
        <span className="font-medium">{entry.project_name}</span>
        <span>/</span>
        <span>{entry.worktree_name}</span>
      </div>

      {/* Sessions in this group */}
      <div className="space-y-1">
        {entry.sessions.map((session, idx) => {
          const hasMessages = session.messages.length > 0
          const isDisabled = !hasMessages || generatingSessionId !== null
          const isGenerating = generatingSessionId === session.id
          const flatIndex = sessionStartIndex + idx

          return (
            <button
              key={session.id}
              data-load-item-index={flatIndex}
              className={cn(
                'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
                'hover:bg-accent focus:outline-none',
                flatIndex === selectedIndex && 'bg-accent',
                isDisabled && 'opacity-50 cursor-not-allowed'
              )}
              onClick={() =>
                onSessionClick({
                  session,
                  worktreeId: entry.worktree_id,
                  worktreePath: entry.worktree_path,
                  projectName: entry.project_name,
                })
              }
              onMouseEnter={() => setSelectedIndex(flatIndex)}
              disabled={isDisabled}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
              ) : (
                <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{session.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {hasMessages
                    ? `${session.messages.length} messages`
                    : 'No messages'}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface LoadedIssueItemProps {
  context: LoadedIssueContext
  isLoading: boolean
  isRemoving: boolean
  onRefresh: () => void
  onRemove: () => void
  onView: () => void
}

function LoadedIssueItem({
  context,
  isLoading,
  isRemoving,
  onRefresh,
  onRemove,
  onView,
}: LoadedIssueItemProps) {
  const isDisabled = isLoading || isRemoving

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2 hover:bg-accent/50 transition-colors',
        isDisabled && 'opacity-50'
      )}
    >
      <CircleDot className="h-4 w-4 text-green-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{context.number}</span>
          <span className="text-sm truncate">{context.title}</span>
          {context.commentCount > 0 && (
            <span className="text-xs text-muted-foreground">
              ({context.commentCount} comments)
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onView}
          disabled={isDisabled}
          className={cn(
            'p-1 rounded hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring',
            'transition-colors'
          )}
          title="View context"
        >
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={onRefresh}
          disabled={isDisabled}
          className={cn(
            'p-1 rounded hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring',
            'transition-colors'
          )}
          title="Refresh issue"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={onRemove}
          disabled={isDisabled}
          className={cn(
            'p-1 rounded hover:bg-destructive/10 focus:outline-none focus:ring-1 focus:ring-ring',
            'transition-colors'
          )}
          title="Remove from context"
        >
          {isRemoving ? (
            <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          )}
        </button>
      </div>
    </div>
  )
}

interface LoadedPRItemProps {
  context: LoadedPullRequestContext
  isLoading: boolean
  isRemoving: boolean
  onRefresh: () => void
  onRemove: () => void
  onView: () => void
}

function LoadedPRItem({
  context,
  isLoading,
  isRemoving,
  onRefresh,
  onRemove,
  onView,
}: LoadedPRItemProps) {
  const isDisabled = isLoading || isRemoving

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2 hover:bg-accent/50 transition-colors',
        isDisabled && 'opacity-50'
      )}
    >
      <GitPullRequest className="h-4 w-4 text-green-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{context.number}</span>
          <span className="text-sm truncate">{context.title}</span>
          {(context.commentCount > 0 || context.reviewCount > 0) && (
            <span className="text-xs text-muted-foreground">
              ({context.commentCount} comments, {context.reviewCount} reviews)
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onView}
          disabled={isDisabled}
          className={cn(
            'p-1 rounded hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring',
            'transition-colors'
          )}
          title="View context"
        >
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={onRefresh}
          disabled={isDisabled}
          className={cn(
            'p-1 rounded hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring',
            'transition-colors'
          )}
          title="Refresh PR"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={onRemove}
          disabled={isDisabled}
          className={cn(
            'p-1 rounded hover:bg-destructive/10 focus:outline-none focus:ring-1 focus:ring-ring',
            'transition-colors'
          )}
          title="Remove from context"
        >
          {isRemoving ? (
            <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          )}
        </button>
      </div>
    </div>
  )
}

interface IssueItemProps {
  issue: GitHubIssue
  index: number
  isSelected: boolean
  isLoading: boolean
  onMouseEnter: () => void
  onClick: () => void
}

function IssueItem({
  issue,
  index,
  isSelected,
  isLoading,
  onMouseEnter,
  onClick,
}: IssueItemProps) {
  return (
    <button
      data-load-item-index={index}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      disabled={isLoading}
      className={cn(
        'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
        'hover:bg-accent focus:outline-none',
        isSelected && 'bg-accent',
        isLoading && 'opacity-50 cursor-not-allowed'
      )}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <CircleDot
          className={cn(
            'h-4 w-4 mt-0.5 flex-shrink-0',
            issue.state === 'OPEN' ? 'text-green-500' : 'text-purple-500'
          )}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{issue.number}</span>
          <span className="text-sm font-medium truncate">{issue.title}</span>
        </div>
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {issue.labels.slice(0, 3).map(label => (
              <span
                key={label.name}
                className="px-1.5 py-0.5 text-xs rounded-full"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                  border: `1px solid #${label.color}40`,
                }}
              >
                {label.name}
              </span>
            ))}
            {issue.labels.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{issue.labels.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

interface PRItemProps {
  pr: GitHubPullRequest
  index: number
  isSelected: boolean
  isLoading: boolean
  onMouseEnter: () => void
  onClick: () => void
}

function PRItem({
  pr,
  index,
  isSelected,
  isLoading,
  onMouseEnter,
  onClick,
}: PRItemProps) {
  return (
    <button
      data-load-item-index={index}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      disabled={isLoading}
      className={cn(
        'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
        'hover:bg-accent focus:outline-none',
        isSelected && 'bg-accent',
        isLoading && 'opacity-50 cursor-not-allowed'
      )}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <GitPullRequest
          className={cn(
            'h-4 w-4 mt-0.5 flex-shrink-0',
            pr.state === 'OPEN' ? 'text-green-500' : pr.state === 'MERGED' ? 'text-purple-500' : 'text-red-500'
          )}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{pr.number}</span>
          <span className="text-sm font-medium truncate">{pr.title}</span>
          {pr.isDraft && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Draft
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">
            {pr.headRefName} → {pr.baseRefName}
          </span>
        </div>
        {pr.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {pr.labels.slice(0, 3).map(label => (
              <span
                key={label.name}
                className="px-1.5 py-0.5 text-xs rounded-full"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                  border: `1px solid #${label.color}40`,
                }}
              >
                {label.name}
              </span>
            ))}
            {pr.labels.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{pr.labels.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

// =============================================================================
// Context Item (for the "Available Contexts" list - narrow style like PRs)
// =============================================================================

interface ContextItemProps {
  context: SavedContext
  index: number
  isSelected: boolean
  isLoading: boolean
  isEditing: boolean
  editValue: string
  setEditValue: (value: string) => void
  editInputRef: React.RefObject<HTMLInputElement | null>
  onMouseEnter: () => void
  onClick: () => void
  onStartEdit: (e: React.MouseEvent) => void
  onRenameSubmit: () => void
  onRenameKeyDown: (e: React.KeyboardEvent) => void
  onDelete: (e: React.MouseEvent) => void
}

function ContextItem({
  context,
  index,
  isSelected,
  isLoading,
  isEditing,
  editValue,
  setEditValue,
  editInputRef,
  onMouseEnter,
  onClick,
  onStartEdit,
  onRenameSubmit,
  onRenameKeyDown,
  onDelete,
}: ContextItemProps) {
  if (isEditing) {
    return (
      <div
        data-load-item-index={index}
        className="w-full flex items-start gap-3 px-3 py-2 bg-accent"
      >
        <FolderOpen className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <input
            ref={editInputRef}
            type="text"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={onRenameSubmit}
            onKeyDown={onRenameKeyDown}
            className="w-full text-sm font-medium bg-transparent border-b border-primary outline-none"
          />
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground truncate">
              {context.project_name}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <button
      data-load-item-index={index}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      disabled={isLoading}
      className={cn(
        'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors group',
        'hover:bg-accent focus:outline-none',
        isSelected && 'bg-accent',
        isLoading && 'opacity-50 cursor-not-allowed'
      )}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <FolderOpen className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {context.name || context.slug || 'Untitled'}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">
            {context.project_name}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatSize(context.size)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onStartEdit}
          className="p-1 rounded hover:bg-muted focus:outline-none"
          title="Rename"
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
        <button
          onClick={onDelete}
          className="p-1 rounded hover:bg-destructive/10 focus:outline-none"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    </button>
  )
}

// =============================================================================
// Attached Context Item (for the "Attached Contexts" section in Contexts tab)
// =============================================================================

interface AttachedContextItemProps {
  context: AttachedSavedContext
  isRemoving: boolean
  onView: () => void
  onRemove: () => void
}

function AttachedContextItem({
  context,
  isRemoving,
  onView,
  onRemove,
}: AttachedContextItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2 hover:bg-accent/50 transition-colors',
        isRemoving && 'opacity-50'
      )}
    >
      <FolderOpen className="h-4 w-4 text-blue-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm truncate">{context.name || context.slug}</span>
          <span className="text-xs text-muted-foreground">
            {formatSize(context.size)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onView}
          disabled={isRemoving}
          className={cn(
            'p-1 rounded hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring',
            'transition-colors'
          )}
          title="View context"
        >
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={onRemove}
          disabled={isRemoving}
          className={cn(
            'p-1 rounded hover:bg-destructive/10 focus:outline-none focus:ring-1 focus:ring-ring',
            'transition-colors'
          )}
          title="Remove from context"
        >
          {isRemoving ? (
            <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          )}
        </button>
      </div>
    </div>
  )
}

export default LoadContextModal
