import { useState } from 'react'
import { Loader2, GitBranch, Check, ChevronsUpDown, ImageIcon, X } from 'lucide-react'
import { convertFileSrc } from '@/lib/transport'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/store/projects-store'
import {
  useProjects,
  useProjectBranches,
  useUpdateProjectSettings,
  useAppDataDir,
  useSetProjectAvatar,
  useRemoveProjectAvatar,
} from '@/services/projects'

export function ProjectSettingsDialog() {
  const {
    projectSettingsDialogOpen,
    projectSettingsProjectId,
    closeProjectSettings,
  } = useProjectsStore()

  const { data: projects = [] } = useProjects()
  const project = projects.find(p => p.id === projectSettingsProjectId)

  const {
    data: branches = [],
    isLoading: branchesLoading,
    error: branchesError,
  } = useProjectBranches(projectSettingsProjectId)

  const updateSettings = useUpdateProjectSettings()
  const { data: appDataDir = '' } = useAppDataDir()
  const setProjectAvatar = useSetProjectAvatar()
  const removeProjectAvatar = useRemoveProjectAvatar()

  // Use project's default_branch as the initial value, allow local overrides
  const [localBranch, setLocalBranch] = useState<string | null>(null)
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false)

  // Track image load errors - use avatar_path as key to reset error state when it changes
  const [imgErrorKey, setImgErrorKey] = useState<string | null>(null)
  const imgError = imgErrorKey === project?.avatar_path

  // Build the full avatar URL if project has an avatar
  const avatarUrl =
    project?.avatar_path && appDataDir && !imgError
      ? convertFileSrc(`${appDataDir}/${project.avatar_path}`)
      : null

  const handleChangeAvatar = () => {
    if (!projectSettingsProjectId) return
    setProjectAvatar.mutate(projectSettingsProjectId)
  }

  const handleRemoveAvatar = () => {
    if (!projectSettingsProjectId) return
    removeProjectAvatar.mutate(projectSettingsProjectId)
  }

  // If user hasn't made a selection, use project's default
  const selectedBranch = localBranch ?? project?.default_branch ?? ''

  const setSelectedBranch = (branch: string) => {
    setLocalBranch(branch)
  }

  const handleSave = async () => {
    if (!projectSettingsProjectId || !selectedBranch) return

    await updateSettings.mutateAsync({
      projectId: projectSettingsProjectId,
      defaultBranch: selectedBranch,
    })

    closeProjectSettings()
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setLocalBranch(null) // Reset local state when closing
      closeProjectSettings()
    }
  }

  const hasChanges = project && selectedBranch !== project.default_branch
  const isPending = updateSettings.isPending

  return (
    <Dialog open={projectSettingsDialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            {project?.name ?? 'Configure project settings'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Avatar Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              Project Avatar
            </label>
            <p className="text-xs text-muted-foreground">
              Custom image displayed in the sidebar
            </p>
            <div className="flex items-center gap-3">
              {/* Avatar Preview */}
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted-foreground/20 overflow-hidden">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={project?.name ?? 'Project avatar'}
                    className="size-full object-cover"
                    onError={() => setImgErrorKey(project?.avatar_path ?? null)}
                  />
                ) : (
                  <span className="text-lg font-medium uppercase text-muted-foreground">
                    {project?.name?.[0] ?? '?'}
                  </span>
                )}
              </div>
              {/* Avatar Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleChangeAvatar}
                  disabled={setProjectAvatar.isPending}
                >
                  {setProjectAvatar.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                  {project?.avatar_path ? 'Change' : 'Add Image'}
                </Button>
                {project?.avatar_path && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveAvatar}
                    disabled={removeProjectAvatar.isPending}
                  >
                    {removeProjectAvatar.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Base Branch Section */}
          <div className="space-y-2">
            <label
              htmlFor="base-branch"
              className="text-sm font-medium leading-none"
            >
              Base Branch
            </label>
            <p className="text-xs text-muted-foreground">
              New worktrees will be created from this branch
            </p>

            {branchesLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching branches...
              </div>
            ) : branchesError ? (
              <div className="py-2 text-sm text-destructive">
                Failed to load branches
              </div>
            ) : branches.length === 0 ? (
              <div className="py-2 text-sm text-muted-foreground">
                No branches found
              </div>
            ) : (
              <Popover
                open={branchPopoverOpen}
                onOpenChange={setBranchPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={branchPopoverOpen}
                    className="w-full justify-between"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <GitBranch className="h-4 w-4 shrink-0" />
                      {selectedBranch || 'Select a branch'}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="!w-[var(--radix-popover-trigger-width)] p-0"
                >
                  <Command>
                    <CommandInput placeholder="Search branches..." />
                    <CommandList>
                      <CommandEmpty>No branch found.</CommandEmpty>
                      <CommandGroup>
                        {branches.map(branch => (
                          <CommandItem
                            key={branch}
                            value={branch}
                            onSelect={value => {
                              setSelectedBranch(value)
                              setBranchPopoverOpen(false)
                            }}
                          >
                            <GitBranch className="h-4 w-4" />
                            {branch}
                            <Check
                              className={cn(
                                'ml-auto h-4 w-4',
                                selectedBranch === branch
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeProjectSettings}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isPending || branchesLoading}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
