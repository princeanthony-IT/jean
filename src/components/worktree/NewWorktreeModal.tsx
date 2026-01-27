import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useQueryClient } from '@tanstack/react-query'
import {
  GitBranch,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  CircleDot,
  AlertCircle,
  Wand2,
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
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import {
  useGitHubIssues,
  useGitHubPRs,
  filterIssues,
  filterPRs,
  githubQueryKeys,
} from '@/services/github'
import {
  useProjects,
  useWorktrees,
  useCreateWorktree,
  useCreateBaseSession,
} from '@/services/projects'
import { isBaseSession } from '@/types/projects'
import type { GitHubIssue, GitHubPullRequest, IssueContext, PullRequestContext } from '@/types/github'

type TabId = 'quick' | 'issues' | 'prs'

interface Tab {
  id: TabId
  label: string
  key: string
}

const TABS: Tab[] = [
  { id: 'quick', label: 'Quick Actions', key: 'Q' },
  { id: 'issues', label: 'Issues', key: 'I' },
  { id: 'prs', label: 'Pull Requests', key: 'P' },
]

export function NewWorktreeModal() {
  const queryClient = useQueryClient()
  const { newWorktreeModalOpen, setNewWorktreeModalOpen } = useUIStore()
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)

  // Get project data
  const { data: projects } = useProjects()
  const selectedProject = useMemo(
    () => projects?.find(p => p.id === selectedProjectId),
    [projects, selectedProjectId]
  )

  // Get worktrees to check for existing base session
  const { data: worktrees } = useWorktrees(selectedProjectId)
  const hasBaseSession = useMemo(
    () => worktrees?.some(w => isBaseSession(w)) ?? false,
    [worktrees]
  )
  const baseSession = useMemo(
    () => worktrees?.find(w => isBaseSession(w)),
    [worktrees]
  )

  // Local state
  const [activeTab, setActiveTab] = useState<TabId>('quick')
  const [searchQuery, setSearchQuery] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const [selectedItemIndex, setSelectedItemIndex] = useState(0)
  const [creatingFromNumber, setCreatingFromNumber] = useState<number | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // GitHub issues query
  const issueState = includeClosed ? 'all' : 'open'
  const {
    data: issues,
    isLoading: isLoadingIssues,
    isFetching: isRefetchingIssues,
    error: issuesError,
    refetch: refetchIssues,
  } = useGitHubIssues(selectedProject?.path ?? null, issueState)

  // GitHub PRs query
  const prState = includeClosed ? 'all' : 'open'
  const {
    data: prs,
    isLoading: isLoadingPRs,
    isFetching: isRefetchingPRs,
    error: prsError,
    refetch: refetchPRs,
  } = useGitHubPRs(selectedProject?.path ?? null, prState)

  // Filter issues locally
  const filteredIssues = useMemo(
    () => filterIssues(issues ?? [], searchQuery),
    [issues, searchQuery]
  )

  // Filter PRs locally
  const filteredPRs = useMemo(
    () => filterPRs(prs ?? [], searchQuery),
    [prs, searchQuery]
  )

  // Mutations
  const createWorktree = useCreateWorktree()
  const createBaseSession = useCreateBaseSession()

  // Focus search input when switching to issues or prs tab
  useEffect(() => {
    if ((activeTab === 'issues' || activeTab === 'prs') && newWorktreeModalOpen) {
      // Small delay to ensure the input is mounted
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [activeTab, newWorktreeModalOpen])

  // Reset selection when switching tabs
  useEffect(() => {
    setSelectedItemIndex(0)
    setSearchQuery('')
  }, [activeTab])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // Always reset these states on open/close
      setCreatingFromNumber(null)
      setSearchQuery('')
      setSelectedItemIndex(0)

      if (open) {
        // Reset other state when modal opens
        // Default to issues tab if a project is selected, otherwise quick actions
        setActiveTab(selectedProjectId ? 'issues' : 'quick')
        setIncludeClosed(false)

        // Invalidate GitHub caches to fetch fresh data
        const projectPath = selectedProject?.path
        if (projectPath) {
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.issues(projectPath, 'open'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.issues(projectPath, 'all'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.prs(projectPath, 'open'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.prs(projectPath, 'all'),
          })
        }
      }
      setNewWorktreeModalOpen(open)
    },
    [setNewWorktreeModalOpen, selectedProject, queryClient, selectedProjectId]
  )

  const handleCreateWorktree = useCallback(() => {
    if (!selectedProjectId) {
      toast.error('No project selected')
      return
    }
    createWorktree.mutate({ projectId: selectedProjectId })
    handleOpenChange(false)
  }, [selectedProjectId, createWorktree, handleOpenChange])

  const handleBaseSession = useCallback(() => {
    if (!selectedProjectId) {
      toast.error('No project selected')
      return
    }

    if (hasBaseSession && baseSession) {
      // Switch to existing base session
      const { selectWorktree } = useProjectsStore.getState()
      const { setActiveWorktree } = useChatStore.getState()
      selectWorktree(baseSession.id)
      setActiveWorktree(baseSession.id, baseSession.path)
      toast.success(`Switched to base session: ${baseSession.name}`)
    } else {
      // Create new base session
      createBaseSession.mutate(selectedProjectId)
    }
    handleOpenChange(false)
  }, [
    selectedProjectId,
    hasBaseSession,
    baseSession,
    createBaseSession,
    handleOpenChange,
  ])

  const handleSelectIssue = useCallback(
    async (issue: GitHubIssue) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(issue.number)

      try {
        // Fetch full issue details including comments
        const issueDetail = await invoke<GitHubIssue & { comments: { body: string; author: { login: string }; created_at: string }[] }>(
          'get_github_issue',
          {
            projectPath,
            issueNumber: issue.number,
          }
        )

        // Create issue context for the worktree
        // Note: Backend expects camelCase for comments (createdAt not created_at)
        const issueContext: IssueContext = {
          number: issueDetail.number,
          title: issueDetail.title,
          body: issueDetail.body,
          comments: (issueDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
        }

        // Create worktree with issue context
        createWorktree.mutate({
          projectId: selectedProjectId,
          issueContext,
        })

        handleOpenChange(false)
      } catch (error) {
        toast.error(`Failed to fetch issue details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  // Handle selecting an issue AND triggering auto-investigate after worktree creation
  const handleSelectIssueAndInvestigate = useCallback(
    async (issue: GitHubIssue) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(issue.number)

      try {
        // Fetch full issue details including comments
        const issueDetail = await invoke<GitHubIssue & { comments: { body: string; author: { login: string }; created_at: string }[] }>(
          'get_github_issue',
          {
            projectPath,
            issueNumber: issue.number,
          }
        )

        // Create issue context for the worktree
        const issueContext: IssueContext = {
          number: issueDetail.number,
          title: issueDetail.title,
          body: issueDetail.body,
          comments: (issueDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
        }

        // Create worktree and mark for auto-investigate
        const pendingWorktree = await createWorktree.mutateAsync({
          projectId: selectedProjectId,
          issueContext,
        })

        // Mark this worktree to trigger investigate-issue when it's ready
        const { markWorktreeForAutoInvestigate } = useUIStore.getState()
        markWorktreeForAutoInvestigate(pendingWorktree.id)

        handleOpenChange(false)
      } catch (error) {
        toast.error(`Failed to fetch issue details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  const handleSelectPR = useCallback(
    async (pr: GitHubPullRequest) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(pr.number)

      try {
        // Fetch full PR details including comments and reviews
        const prDetail = await invoke<GitHubPullRequest & {
          comments: { body: string; author: { login: string }; created_at: string }[]
          reviews: { body: string; state: string; author: { login: string }; submittedAt?: string }[]
        }>(
          'get_github_pr',
          {
            projectPath,
            prNumber: pr.number,
          }
        )

        // Create PR context for the worktree
        const prContext: PullRequestContext = {
          number: prDetail.number,
          title: prDetail.title,
          body: prDetail.body,
          headRefName: prDetail.headRefName,
          baseRefName: prDetail.baseRefName,
          comments: (prDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
          reviews: (prDetail.reviews ?? [])
            .filter(r => r && r.author)
            .map(r => ({
              body: r.body ?? '',
              state: r.state,
              author: { login: r.author.login ?? '' },
              submittedAt: r.submittedAt,
            })),
        }

        // Create worktree with PR context
        createWorktree.mutate({
          projectId: selectedProjectId,
          prContext,
        })

        handleOpenChange(false)
      } catch (error) {
        toast.error(`Failed to fetch PR details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  // Handle selecting a PR AND triggering auto-investigate after worktree creation
  const handleSelectPRAndInvestigate = useCallback(
    async (pr: GitHubPullRequest) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(pr.number)

      try {
        // Fetch full PR details including comments and reviews
        const prDetail = await invoke<GitHubPullRequest & {
          comments: { body: string; author: { login: string }; created_at: string }[]
          reviews: { body: string; state: string; author: { login: string }; submittedAt?: string }[]
        }>(
          'get_github_pr',
          {
            projectPath,
            prNumber: pr.number,
          }
        )

        // Create PR context for the worktree
        const prContext: PullRequestContext = {
          number: prDetail.number,
          title: prDetail.title,
          body: prDetail.body,
          headRefName: prDetail.headRefName,
          baseRefName: prDetail.baseRefName,
          comments: (prDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
          reviews: (prDetail.reviews ?? [])
            .filter(r => r && r.author)
            .map(r => ({
              body: r.body ?? '',
              state: r.state,
              author: { login: r.author.login ?? '' },
              submittedAt: r.submittedAt,
            })),
        }

        // Create worktree and mark for auto-investigate
        const pendingWorktree = await createWorktree.mutateAsync({
          projectId: selectedProjectId,
          prContext,
        })

        // Mark this worktree to trigger investigate-pr when it's ready
        const { markWorktreeForAutoInvestigatePR } = useUIStore.getState()
        markWorktreeForAutoInvestigatePR(pendingWorktree.id)

        handleOpenChange(false)
      } catch (error) {
        toast.error(`Failed to fetch PR details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Tab shortcuts (Cmd+key, works even when input is focused)
      if (e.metaKey || e.ctrlKey) {
        if (key === 'q') {
          e.preventDefault()
          setActiveTab('quick')
          return
        }
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
      }

      // Quick actions shortcuts
      if (activeTab === 'quick') {
        if (key === 'n') {
          e.preventDefault()
          handleCreateWorktree()
          return
        }
        if (key === 'b') {
          e.preventDefault()
          handleBaseSession()
          return
        }
      }

      // Issues tab navigation
      if (activeTab === 'issues' && filteredIssues.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex(prev =>
            Math.min(prev + 1, filteredIssues.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredIssues[selectedItemIndex]) {
          e.preventDefault()
          handleSelectIssue(filteredIssues[selectedItemIndex])
          return
        }
      }

      // PRs tab navigation
      if (activeTab === 'prs' && filteredPRs.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex(prev =>
            Math.min(prev + 1, filteredPRs.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredPRs[selectedItemIndex]) {
          e.preventDefault()
          handleSelectPR(filteredPRs[selectedItemIndex])
          return
        }
      }
    },
    [
      activeTab,
      filteredIssues,
      filteredPRs,
      selectedItemIndex,
      handleCreateWorktree,
      handleBaseSession,
      handleSelectIssue,
      handleSelectPR,
    ]
  )

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector(
      `[data-item-index="${selectedItemIndex}"]`
    )
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedItemIndex])

  return (
    <Dialog open={newWorktreeModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="!max-w-[calc(100vw-4rem)] !w-[calc(100vw-4rem)] h-[calc(100vh-4rem)] p-0 flex flex-col"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>
            New Session for {selectedProject?.name ?? 'Project'}
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 px-4 py-2 text-sm font-medium transition-colors',
                'hover:bg-accent focus:outline-none',
                activeTab === tab.id
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground'
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
        <div className="flex-1 min-h-0 flex flex-col">
          {activeTab === 'quick' && (
            <QuickActionsTab
              hasBaseSession={hasBaseSession}
              onCreateWorktree={handleCreateWorktree}
              onBaseSession={handleBaseSession}
              isCreating={createWorktree.isPending || createBaseSession.isPending}
            />
          )}

          {activeTab === 'issues' && (
            <GitHubIssuesTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              includeClosed={includeClosed}
              setIncludeClosed={setIncludeClosed}
              issues={filteredIssues}
              isLoading={isLoadingIssues}
              isRefetching={isRefetchingIssues}
              error={issuesError}
              onRefresh={() => refetchIssues()}
              selectedIndex={selectedItemIndex}
              setSelectedIndex={setSelectedItemIndex}
              onSelectIssue={handleSelectIssue}
              onInvestigateIssue={handleSelectIssueAndInvestigate}
              creatingFromNumber={creatingFromNumber}
              searchInputRef={searchInputRef}
            />
          )}

          {activeTab === 'prs' && (
            <GitHubPRsTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              includeClosed={includeClosed}
              setIncludeClosed={setIncludeClosed}
              prs={filteredPRs}
              isLoading={isLoadingPRs}
              isRefetching={isRefetchingPRs}
              error={prsError}
              onRefresh={() => refetchPRs()}
              selectedIndex={selectedItemIndex}
              setSelectedIndex={setSelectedItemIndex}
              onSelectPR={handleSelectPR}
              onInvestigatePR={handleSelectPRAndInvestigate}
              creatingFromNumber={creatingFromNumber}
              searchInputRef={searchInputRef}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface QuickActionsTabProps {
  hasBaseSession: boolean
  onCreateWorktree: () => void
  onBaseSession: () => void
  isCreating: boolean
}

function QuickActionsTab({
  hasBaseSession,
  onCreateWorktree,
  onBaseSession,
  isCreating,
}: QuickActionsTabProps) {
  return (
    <div className="flex items-center justify-center flex-1 p-10">
      <div className="grid grid-cols-2 gap-6 w-full max-w-xl">
        {/* Base Session button */}
        <button
          onClick={onBaseSession}
          disabled={isCreating}
          className={cn(
            'relative flex flex-col items-center justify-center gap-4 aspect-square p-8 rounded-xl text-sm transition-colors',
            'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
            'border border-border'
          )}
        >
          <GitBranch className="h-10 w-10 text-muted-foreground" />
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-medium text-base">{hasBaseSession ? 'Switch to Base Session' : 'New Base Session'}</span>
            <span className="text-xs text-muted-foreground text-center">Work directly on the project folder</span>
          </div>
          <kbd className="absolute top-3 right-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            B
          </kbd>
        </button>

        {/* New Worktree button */}
        <button
          onClick={onCreateWorktree}
          disabled={isCreating}
          className={cn(
            'relative flex flex-col items-center justify-center gap-4 aspect-square p-8 rounded-xl text-sm transition-colors',
            'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
            'border border-border'
          )}
        >
          {isCreating ? (
            <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
          ) : (
            <Plus className="h-10 w-10 text-muted-foreground" />
          )}
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-medium text-base">New Worktree</span>
            <span className="text-xs text-muted-foreground text-center">Create an isolated branch for your task</span>
          </div>
          <kbd className="absolute top-3 right-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            N
          </kbd>
        </button>
      </div>
    </div>
  )
}

interface GitHubIssuesTabProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  includeClosed: boolean
  setIncludeClosed: (include: boolean) => void
  issues: GitHubIssue[]
  isLoading: boolean
  isRefetching: boolean
  error: Error | null
  onRefresh: () => void
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  onSelectIssue: (issue: GitHubIssue) => void
  onInvestigateIssue: (issue: GitHubIssue) => void
  creatingFromNumber: number | null
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

function GitHubIssuesTab({
  searchQuery,
  setSearchQuery,
  includeClosed,
  setIncludeClosed,
  issues,
  isLoading,
  isRefetching,
  error,
  onRefresh,
  selectedIndex,
  setSelectedIndex,
  onSelectIssue,
  onInvestigateIssue,
  creatingFromNumber,
  searchInputRef,
}: GitHubIssuesTabProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search and filters */}
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
            id="include-closed"
            checked={includeClosed}
            onCheckedChange={checked => setIncludeClosed(checked === true)}
          />
          <label
            htmlFor="include-closed"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Include closed issues
          </label>
        </div>
      </div>

      {/* Issues list */}
      <ScrollArea className="flex-1">
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

        {!isLoading && !error && issues.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">
              {searchQuery ? 'No issues match your search' : 'No open issues found'}
            </span>
          </div>
        )}

        {!isLoading && !error && issues.length > 0 && (
          <div className="py-1">
            {issues.map((issue, index) => (
              <IssueItem
                key={issue.number}
                issue={issue}
                index={index}
                isSelected={index === selectedIndex}
                isCreating={creatingFromNumber === issue.number}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onSelectIssue(issue)}
                onInvestigate={() => onInvestigateIssue(issue)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

interface GitHubPRsTabProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  includeClosed: boolean
  setIncludeClosed: (include: boolean) => void
  prs: GitHubPullRequest[]
  isLoading: boolean
  isRefetching: boolean
  error: Error | null
  onRefresh: () => void
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  onSelectPR: (pr: GitHubPullRequest) => void
  onInvestigatePR: (pr: GitHubPullRequest) => void
  creatingFromNumber: number | null
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

function GitHubPRsTab({
  searchQuery,
  setSearchQuery,
  includeClosed,
  setIncludeClosed,
  prs,
  isLoading,
  isRefetching,
  error,
  onRefresh,
  selectedIndex,
  setSelectedIndex,
  onSelectPR,
  onInvestigatePR,
  creatingFromNumber,
  searchInputRef,
}: GitHubPRsTabProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search and filters */}
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
            id="include-closed-prs"
            checked={includeClosed}
            onCheckedChange={checked => setIncludeClosed(checked === true)}
          />
          <label
            htmlFor="include-closed-prs"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Include closed/merged PRs
          </label>
        </div>
      </div>

      {/* PRs list */}
      <ScrollArea className="flex-1">
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

        {!isLoading && !error && prs.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">
              {searchQuery ? 'No PRs match your search' : 'No open pull requests found'}
            </span>
          </div>
        )}

        {!isLoading && !error && prs.length > 0 && (
          <div className="py-1">
            {prs.map((pr, index) => (
              <PRItem
                key={pr.number}
                pr={pr}
                index={index}
                isSelected={index === selectedIndex}
                isCreating={creatingFromNumber === pr.number}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => onSelectPR(pr)}
                onInvestigate={() => onInvestigatePR(pr)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

interface IssueItemProps {
  issue: GitHubIssue
  index: number
  isSelected: boolean
  isCreating: boolean
  onMouseEnter: () => void
  onClick: () => void
  onInvestigate: () => void
}

function IssueItem({
  issue,
  index,
  isSelected,
  isCreating,
  onMouseEnter,
  onClick,
  onInvestigate,
}: IssueItemProps) {
  return (
    <div
      data-item-index={index}
      onMouseEnter={onMouseEnter}
      className={cn(
        'group w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
        'hover:bg-accent',
        isSelected && 'bg-accent',
        isCreating && 'opacity-50'
      )}
    >
      {isCreating ? (
        <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <CircleDot
          className={cn(
            'h-4 w-4 mt-0.5 flex-shrink-0',
            issue.state === 'OPEN' ? 'text-green-500' : 'text-purple-500'
          )}
        />
      )}
      <button
        onClick={onClick}
        disabled={isCreating}
        className="flex-1 min-w-0 text-left focus:outline-none disabled:cursor-not-allowed"
      >
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
      </button>
      {/* Investigate button - always visible */}
      <button
        onClick={e => {
          e.stopPropagation()
          onInvestigate()
        }}
        disabled={isCreating}
        title="Create worktree and investigate issue"
        className={cn(
          'opacity-50 hover:opacity-100 transition-opacity',
          'p-1.5 rounded-md hover:bg-accent-foreground/10',
          'focus:outline-none focus:opacity-100',
          'disabled:opacity-30 disabled:cursor-not-allowed'
        )}
      >
        <Wand2 className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  )
}

interface PRItemProps {
  pr: GitHubPullRequest
  index: number
  isSelected: boolean
  isCreating: boolean
  onMouseEnter: () => void
  onClick: () => void
  onInvestigate: () => void
}

function PRItem({
  pr,
  index,
  isSelected,
  isCreating,
  onMouseEnter,
  onClick,
  onInvestigate,
}: PRItemProps) {
  return (
    <div
      data-item-index={index}
      onMouseEnter={onMouseEnter}
      className={cn(
        'group w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
        'hover:bg-accent',
        isSelected && 'bg-accent',
        isCreating && 'opacity-50'
      )}
    >
      {isCreating ? (
        <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <GitPullRequest
          className={cn(
            'h-4 w-4 mt-0.5 flex-shrink-0',
            pr.state === 'OPEN' ? 'text-green-500' : pr.state === 'MERGED' ? 'text-purple-500' : 'text-red-500'
          )}
        />
      )}
      <button
        onClick={onClick}
        disabled={isCreating}
        className="flex-1 min-w-0 text-left focus:outline-none disabled:cursor-not-allowed"
      >
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
      </button>
      {/* Investigate button - always visible */}
      <button
        onClick={e => {
          e.stopPropagation()
          onInvestigate()
        }}
        disabled={isCreating}
        title="Create worktree and investigate PR"
        className={cn(
          'opacity-50 hover:opacity-100 transition-opacity',
          'p-1.5 rounded-md hover:bg-accent-foreground/10',
          'focus:outline-none focus:opacity-100',
          'disabled:opacity-30 disabled:cursor-not-allowed'
        )}
      >
        <Wand2 className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  )
}

export default NewWorktreeModal
