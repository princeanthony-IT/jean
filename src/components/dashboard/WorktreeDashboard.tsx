import { useMemo, useState, useCallback } from 'react'
import { useQueries } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import {
  Search,
  GitBranch,
  MessageSquare,
  Calendar,
  ChevronRight,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useWorktrees, useProjects, isTauri } from '@/services/projects'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { isBaseSession, type Worktree } from '@/types/projects'
import type { Session, WorktreeSessions } from '@/types/chat'
import { cn } from '@/lib/utils'

interface WorktreeDashboardProps {
  projectId: string
}

interface WorktreeWithSessions {
  worktree: Worktree
  sessions: Session[]
  messageCount: number
}

export function WorktreeDashboard({ projectId }: WorktreeDashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')

  // Get project info
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const project = projects.find(p => p.id === projectId)

  // Get worktrees
  const { data: worktrees = [], isLoading: worktreesLoading } =
    useWorktrees(projectId)

  // Filter to ready worktrees only
  const readyWorktrees = useMemo(() => {
    return worktrees.filter(
      wt => !wt.status || wt.status === 'ready' || wt.status === 'error'
    )
  }, [worktrees])

  // Load sessions for all worktrees dynamically using useQueries
  // Each query includes worktreeId in its select to enable stable ID-based lookups
  const sessionQueries = useQueries({
    queries: readyWorktrees.map(wt => ({
      queryKey: [...chatQueryKeys.sessions(wt.id), 'with-counts'],
      queryFn: async (): Promise<WorktreeSessions> => {
        if (!isTauri() || !wt.id || !wt.path) {
          return {
            worktree_id: wt.id,
            sessions: [],
            active_session_id: null,
            version: 2,
          }
        }
        return invoke<WorktreeSessions>('get_sessions', {
          worktreeId: wt.id,
          worktreePath: wt.path,
          includeMessageCounts: true,
        })
      },
      enabled: !!wt.id && !!wt.path,
    })),
  })

  // Build a Map of worktree ID -> session data for stable lookups
  // This avoids relying on array index alignment between readyWorktrees and sessionQueries
  const sessionsByWorktreeId = useMemo(() => {
    const map = new Map<string, { sessions: Session[]; isLoading: boolean }>()
    for (const query of sessionQueries) {
      const worktreeId = query.data?.worktree_id
      if (worktreeId) {
        map.set(worktreeId, {
          sessions: query.data?.sessions ?? [],
          isLoading: query.isLoading,
        })
      } else if (query.isLoading) {
        // For loading queries, we can't map them yet - they'll be added once data arrives
      }
    }
    return map
  }, [sessionQueries])

  // Aggregate worktrees with their sessions using ID-based lookups
  const worktreesWithSessions = useMemo(() => {
    const result: WorktreeWithSessions[] = []

    for (const worktree of readyWorktrees) {
      const sessionData = sessionsByWorktreeId.get(worktree.id)
      const sessions = sessionData?.sessions ?? []
      const messageCount = sessions.reduce(
        (total, session) => total + (session.message_count ?? 0),
        0
      )

      result.push({ worktree, sessions, messageCount })
    }

    return result
  }, [readyWorktrees, sessionsByWorktreeId])

  // Filter based on search query (worktree name, branch, or session name)
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return worktreesWithSessions

    const query = searchQuery.toLowerCase()

    return worktreesWithSessions.filter(item => {
      // Check worktree name and branch
      if (item.worktree.name.toLowerCase().includes(query)) return true
      if (item.worktree.branch.toLowerCase().includes(query)) return true

      // Check session names
      if (
        item.sessions.some(session =>
          session.name.toLowerCase().includes(query)
        )
      ) {
        return true
      }

      return false
    })
  }, [worktreesWithSessions, searchQuery])

  // Sort: base sessions first, then by created_at (newest first)
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const aIsBase = isBaseSession(a.worktree)
      const bIsBase = isBaseSession(b.worktree)
      if (aIsBase && !bIsBase) return -1
      if (!aIsBase && bIsBase) return 1
      return b.worktree.created_at - a.worktree.created_at
    })
  }, [filteredItems])

  // Check if loading - any worktree without session data yet is considered loading
  const isLoading =
    projectsLoading ||
    worktreesLoading ||
    (readyWorktrees.length > 0 &&
      readyWorktrees.some(wt => !sessionsByWorktreeId.has(wt.id)))

  if (isLoading && worktreesWithSessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No project selected
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{project.name}</h2>
        <span className="text-sm text-muted-foreground">
          {sortedItems.length} worktree{sortedItems.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search worktrees and sessions..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Worktree List */}
      <div className="flex-1 overflow-auto">
        {sortedItems.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {searchQuery
              ? 'No worktrees or sessions match your search'
              : 'No worktrees yet'}
          </div>
        ) : (
          <div className="space-y-2">
            {sortedItems.map(item => (
              <WorktreeRow
                key={item.worktree.id}
                item={item}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface WorktreeRowProps {
  item: WorktreeWithSessions
  searchQuery: string
}

function WorktreeRow({ item, searchQuery }: WorktreeRowProps) {
  const { worktree, sessions, messageCount } = item

  const selectProject = useProjectsStore(state => state.selectProject)
  const selectWorktree = useProjectsStore(state => state.selectWorktree)
  const setActiveWorktree = useChatStore(state => state.setActiveWorktree)
  const setActiveSession = useChatStore(state => state.setActiveSession)

  // Find matching sessions when searching
  const matchingSessions = useMemo(() => {
    if (!searchQuery.trim()) return []
    const query = searchQuery.toLowerCase()
    return sessions.filter(session =>
      session.name.toLowerCase().includes(query)
    )
  }, [sessions, searchQuery])

  // Format creation date/time
  const createdDate = useMemo(() => {
    const date = new Date(worktree.created_at * 1000)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      // Today: show time only
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    } else {
      // Other days: show date + time
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    }
  }, [worktree.created_at])

  const handleWorktreeClick = useCallback(() => {
    selectProject(worktree.project_id)
    selectWorktree(worktree.id)
    setActiveWorktree(worktree.id, worktree.path)

    // Set the first session as active if available
    if (sessions.length > 0) {
      const firstSession = sessions[0]
      if (firstSession) {
        setActiveSession(worktree.id, firstSession.id)
      }
    }
  }, [
    worktree,
    sessions,
    selectProject,
    selectWorktree,
    setActiveWorktree,
    setActiveSession,
  ])

  const handleSessionClick = useCallback(
    (session: Session) => {
      selectProject(worktree.project_id)
      selectWorktree(worktree.id)
      setActiveWorktree(worktree.id, worktree.path)
      setActiveSession(worktree.id, session.id)
    },
    [
      worktree,
      selectProject,
      selectWorktree,
      setActiveWorktree,
      setActiveSession,
    ]
  )

  const isBase = isBaseSession(worktree)

  return (
    <div className="space-y-1">
      {/* Worktree Row */}
      <div
        onClick={handleWorktreeClick}
        className={cn(
          'flex cursor-pointer items-center gap-4 rounded-lg border p-3 transition-colors',
          'hover:bg-accent hover:border-accent-foreground/20'
        )}
      >
        {/* Name and branch */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">
              {isBase ? 'Base Session' : worktree.name}
            </span>
            {isBase && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                base
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <span className="truncate">{worktree.branch}</span>
          </div>
        </div>

        {/* Message count */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          <span>{messageCount}</span>
        </div>

        {/* Creation date */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">{createdDate}</span>
        </div>
      </div>

      {/* Matching Sessions (shown when search matches session names) */}
      {matchingSessions.length > 0 && (
        <div className="ml-8 space-y-1">
          {matchingSessions.map(session => (
            <div
              key={session.id}
              onClick={() => handleSessionClick(session)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border border-dashed p-2 text-sm transition-colors',
                'hover:bg-accent hover:border-accent-foreground/20'
              )}
            >
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="truncate">{session.name}</span>
              <span className="text-muted-foreground">
                ({session.message_count ?? 0} messages)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
