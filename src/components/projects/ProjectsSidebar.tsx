import { useState, useEffect, useRef } from 'react'
import { Plus, Folder, Archive, Briefcase } from 'lucide-react'
import { invoke } from '@/lib/transport'
import { useQueryClient } from '@tanstack/react-query'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useProjects,
  useCreateFolder,
} from '@/services/projects'
import { fetchWorktreesStatus } from '@/services/git-status'
import { prefetchSessions } from '@/services/chat'
import { useProjectsStore } from '@/store/projects-store'
import { ProjectTree } from './ProjectTree'
import { AddProjectDialog } from './AddProjectDialog'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
import { ArchivedModal } from '@/components/archive/ArchivedModal'
import type { Worktree } from '@/types/projects'

export function ProjectsSidebar() {
  const { data: projects = [], isLoading } = useProjects()
  const { setAddProjectDialogOpen } = useProjectsStore()
  const [archivedModalOpen, setArchivedModalOpen] = useState(false)
  const createFolder = useCreateFolder()
  const queryClient = useQueryClient()
  const sidebarWidth = useSidebarWidth()

  // Responsive layout threshold
  const isNarrow = sidebarWidth < 180

  // Listen for command palette events
  useEffect(() => {
    const handleOpenArchivedModal = () => setArchivedModalOpen(true)
    window.addEventListener('command:open-archived-modal', handleOpenArchivedModal)
    return () =>
      window.removeEventListener('command:open-archived-modal', handleOpenArchivedModal)
  }, [])

  // Fetch worktree status and sessions for all projects on startup
  // Priority: expanded projects first, then all others
  const hasFetchedRef = useRef(false)
  useEffect(() => {
    if (hasFetchedRef.current || projects.length === 0) return
    hasFetchedRef.current = true

    // Filter to only actual projects (not folders)
    const actualProjects = projects.filter(p => !p.is_folder)
    if (actualProjects.length === 0) return

    // Get expanded projects from store (use getState to avoid subscription)
    const { expandedProjectIds } = useProjectsStore.getState()

    // Split into expanded (priority) and collapsed projects
    const expandedProjects = actualProjects.filter(p => expandedProjectIds.has(p.id))
    const collapsedProjects = actualProjects.filter(p => !expandedProjectIds.has(p.id))

    // Fetch git status for a batch of projects
    const fetchGitStatusBatch = async (batch: typeof actualProjects) => {
      await Promise.all(
        batch.map(p =>
          fetchWorktreesStatus(p.id).catch(err =>
            console.warn(`[startup] Failed to fetch git status for ${p.name}:`, err)
          )
        )
      )
    }

    // Fetch sessions for all worktrees in a project
    const fetchSessionsForProject = async (projectId: string) => {
      try {
        const worktrees = await invoke<Worktree[]>('list_worktrees', { projectId })
        await Promise.all(
          worktrees.map(w =>
            prefetchSessions(queryClient, w.id, w.path).catch(err =>
              console.warn(`[startup] Failed to prefetch sessions for ${w.name}:`, err)
            )
          )
        )
      } catch (err) {
        console.warn(`[startup] Failed to list worktrees for project ${projectId}:`, err)
      }
    }

    const fetchAll = async () => {
      const concurrencyLimit = 3

      console.info(
        '[startup] Fetching worktree status and sessions: expanded=%d, collapsed=%d',
        expandedProjects.length,
        collapsedProjects.length
      )

      // First: fetch expanded projects (user sees these immediately)
      // Fetch both git status and sessions in parallel
      for (let i = 0; i < expandedProjects.length; i += concurrencyLimit) {
        const batch = expandedProjects.slice(i, i + concurrencyLimit)
        await Promise.all([
          fetchGitStatusBatch(batch),
          ...batch.map(p => fetchSessionsForProject(p.id)),
        ])
      }

      // Then: fetch collapsed projects in background (lazy load for when user expands)
      for (let i = 0; i < collapsedProjects.length; i += concurrencyLimit) {
        const batch = collapsedProjects.slice(i, i + concurrencyLimit)
        await Promise.all([
          fetchGitStatusBatch(batch),
          ...batch.map(p => fetchSessionsForProject(p.id)),
        ])
      }

      console.info('[startup] Done fetching worktree status and sessions for all projects')
    }

    fetchAll()
  }, [projects, queryClient])

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex h-full items-center justify-center px-2">
            <span className="truncate text-sm text-muted-foreground/50">No projects found</span>
          </div>
        ) : (
          <ProjectTree projects={projects} />
        )}
      </div>

      {/* Footer - transparent buttons with hover background */}
      <div className={`flex gap-1 p-1.5 pb-2 ${isNarrow ? 'flex-col' : 'items-center'}`}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              {!isNarrow && <Plus className="size-3.5" />}
              New
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" style={{ width: sidebarWidth - 12 }}>
            <DropdownMenuItem onClick={() => createFolder.mutate({ name: 'New Folder' })}>
              <Folder className="mr-2 size-3.5" />
              Folder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAddProjectDialogOpen(true)}>
              <Briefcase className="mr-2 size-3.5" />
              Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          onClick={() => setArchivedModalOpen(true)}
        >
          {!isNarrow && <Archive className="size-3.5" />}
          Archived
        </button>
      </div>

      {/* Dialogs */}
      <AddProjectDialog />
      <ProjectSettingsDialog />
      <ArchivedModal
        open={archivedModalOpen}
        onOpenChange={setArchivedModalOpen}
      />
    </div>
  )
}

