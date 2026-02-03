import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@/lib/transport'
import { useQueryClient } from '@tanstack/react-query'
import {
  GitBranch,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Search,
  AlertCircle,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { isGhAuthError } from '@/services/github'
import { useGhLogin } from '@/hooks/useGhLogin'
import { GhAuthError } from '@/components/shared/GhAuthError'
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
import {
  useGitHubPRs,
  useSearchGitHubPRs,
  filterPRs,
  mergeWithSearchResults,
  githubQueryKeys,
} from '@/services/github'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useProjects, projectsQueryKeys } from '@/services/projects'
import type { GitHubPullRequest } from '@/types/github'
import type { Worktree } from '@/types/projects'

export function CheckoutPRModal() {
  const queryClient = useQueryClient()
  const { triggerLogin: triggerGhLogin, isGhInstalled } = useGhLogin()
  const { checkoutPRModalOpen, setCheckoutPRModalOpen } = useUIStore()
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)

  // Get project data
  const { data: projects } = useProjects()
  const selectedProject = useMemo(
    () => projects?.find(p => p.id === selectedProjectId),
    [projects, selectedProjectId]
  )

  // Local state
  const [searchQuery, setSearchQuery] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const [selectedItemIndex, setSelectedItemIndex] = useState(0)
  const [checkingOutNumber, setCheckingOutNumber] = useState<number | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // GitHub PRs query
  const prState = includeClosed ? 'all' : 'open'
  const {
    data: prs,
    isLoading: isLoadingPRs,
    isFetching: isRefetchingPRs,
    error: prsError,
    refetch: refetchPRs,
  } = useGitHubPRs(selectedProject?.path ?? null, prState)

  // Debounced search query for GitHub API search
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)

  // GitHub search query (triggered when local filter may miss results)
  const {
    data: searchedPRs,
    isFetching: isSearchingPRs,
  } = useSearchGitHubPRs(selectedProject?.path ?? null, debouncedSearchQuery)

  // Filter PRs locally, then merge with remote search results
  const filteredPRs = useMemo(
    () => mergeWithSearchResults(
      filterPRs(prs ?? [], searchQuery),
      searchedPRs,
    ),
    [prs, searchQuery, searchedPRs]
  )

  // Focus search input when modal opens
  useEffect(() => {
    if (checkoutPRModalOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [checkoutPRModalOpen])

  // Reset selection when search changes
  useEffect(() => {
    setSelectedItemIndex(0)
  }, [searchQuery])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setCheckingOutNumber(null)
      setSearchQuery('')
      setSelectedItemIndex(0)

      if (open) {
        setIncludeClosed(false)

        // Invalidate GitHub caches to fetch fresh data
        const projectPath = selectedProject?.path
        if (projectPath) {
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.prs(projectPath, 'open'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.prs(projectPath, 'all'),
          })
        }
      }
      setCheckoutPRModalOpen(open)
    },
    [setCheckoutPRModalOpen, selectedProject, queryClient]
  )

  const handleCheckoutPR = useCallback(
    async (pr: GitHubPullRequest, investigate = false) => {
      if (!selectedProjectId) {
        toast.error('No project selected')
        return
      }

      setCheckingOutNumber(pr.number)

      try {
        // Call the checkout_pr command
        const pendingWorktree = await invoke<Worktree>('checkout_pr', {
          projectId: selectedProjectId,
          prNumber: pr.number,
        })

        // Add pending worktree to cache immediately so it appears in sidebar
        // Skip if already present (e.g. restored from archive via worktree:unarchived event)
        const worktreeWithStatus = { ...pendingWorktree, status: 'pending' as const }
        queryClient.setQueryData<Worktree[]>(
          projectsQueryKeys.worktrees(selectedProjectId),
          old => {
            if (!old) return [worktreeWithStatus]
            if (old.some(w => w.id === pendingWorktree.id)) return old
            return [...old, worktreeWithStatus]
          }
        )

        // If auto-investigate is enabled, mark the worktree
        if (investigate) {
          const { markWorktreeForAutoInvestigatePR } = useUIStore.getState()
          markWorktreeForAutoInvestigatePR(pendingWorktree.id)
        }

        // Expand the project so the new worktree is visible
        const { expandProject } = useProjectsStore.getState()
        expandProject(selectedProjectId)

        toast.success(`Checking out PR #${pr.number}...`)
        handleOpenChange(false)
      } catch (error) {
        toast.error(`Failed to checkout PR: ${error}`)
        setCheckingOutNumber(null)
      }
    },
    [selectedProjectId, handleOpenChange]
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      if (filteredPRs.length > 0) {
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
          handleCheckoutPR(filteredPRs[selectedItemIndex])
          return
        }
      }
    },
    [filteredPRs, selectedItemIndex, handleCheckoutPR]
  )

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector(
      `[data-checkout-item-index="${selectedItemIndex}"]`
    )
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedItemIndex])

  return (
    <Dialog open={checkoutPRModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="!max-w-lg h-[500px] p-0 flex flex-col"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Checkout PR for {selectedProject?.name ?? 'Project'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0">
          {/* Search and filters */}
          <div className="p-3 space-y-2 border-b border-border">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search PRs by #number, title, or branch..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>
              <button
                onClick={() => refetchPRs()}
                disabled={isRefetchingPRs}
                className={cn(
                  'flex items-center justify-center h-8 w-8 rounded-md border border-border',
                  'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
                  'transition-colors',
                  isRefetchingPRs && 'opacity-50 cursor-not-allowed'
                )}
                title="Refresh pull requests"
              >
                <RefreshCw
                  className={cn(
                    'h-4 w-4 text-muted-foreground',
                    isRefetchingPRs && 'animate-spin'
                  )}
                />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="checkout-include-closed"
                checked={includeClosed}
                onCheckedChange={checked => setIncludeClosed(checked === true)}
              />
              <label
                htmlFor="checkout-include-closed"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                Include closed/merged
              </label>
            </div>
          </div>

          {/* PRs list */}
          <ScrollArea className="flex-1">
            {isLoadingPRs && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Loading pull requests...
                </span>
              </div>
            )}

            {prsError && (
              isGhAuthError(prsError) ? (
                <GhAuthError onLogin={triggerGhLogin} isGhInstalled={isGhInstalled} />
              ) : (
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                  <AlertCircle className="h-5 w-5 text-destructive mb-2" />
                  <span className="text-sm text-muted-foreground">
                    {prsError.message || 'Failed to load pull requests'}
                  </span>
                </div>
              )
            )}

            {!isLoadingPRs && !prsError && filteredPRs.length === 0 && !isSearchingPRs && (
              <div className="flex items-center justify-center py-8">
                <span className="text-sm text-muted-foreground">
                  {searchQuery ? 'No PRs match your search' : 'No open pull requests found'}
                </span>
              </div>
            )}

            {!isLoadingPRs && !prsError && filteredPRs.length === 0 && isSearchingPRs && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Searching GitHub...
                </span>
              </div>
            )}

            {!isLoadingPRs && !prsError && filteredPRs.length > 0 && (
              <div className="py-1">
                {filteredPRs.map((pr, index) => (
                  <CheckoutPRItem
                    key={pr.number}
                    pr={pr}
                    index={index}
                    isSelected={index === selectedItemIndex}
                    isCheckingOut={checkingOutNumber === pr.number}
                    onMouseEnter={() => setSelectedItemIndex(index)}
                    onClick={() => handleCheckoutPR(pr)}
                    onInvestigateClick={() => handleCheckoutPR(pr, true)}
                  />
                ))}
                {isSearchingPRs && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      Searching GitHub for more results...
                    </span>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface CheckoutPRItemProps {
  pr: GitHubPullRequest
  index: number
  isSelected: boolean
  isCheckingOut: boolean
  onMouseEnter: () => void
  onClick: () => void
  onInvestigateClick: () => void
}

function CheckoutPRItem({
  pr,
  index,
  isSelected,
  isCheckingOut,
  onMouseEnter,
  onClick,
  onInvestigateClick,
}: CheckoutPRItemProps) {
  return (
    <button
      data-checkout-item-index={index}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      disabled={isCheckingOut}
      className={cn(
        'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
        'hover:bg-accent focus:outline-none',
        isSelected && 'bg-accent',
        isCheckingOut && 'opacity-50 cursor-not-allowed'
      )}
    >
      {isCheckingOut ? (
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
      <div
        role="button"
        tabIndex={-1}
        title="Checkout & Investigate"
        onClick={e => {
          e.stopPropagation()
          onInvestigateClick()
        }}
        className={cn(
          'flex-shrink-0 self-center p-1 rounded-md transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-accent-foreground/10',
          isCheckingOut && 'pointer-events-none'
        )}
      >
        <Wand2 className="h-3.5 w-3.5" />
      </div>
    </button>
  )
}

export default CheckoutPRModal
