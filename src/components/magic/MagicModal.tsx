import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import {
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Eye,
  Wand2,
  BookmarkPlus,
  FolderOpen,
  Search,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

type MagicOption =
  | 'save-context'
  | 'load-context'
  | 'commit'
  | 'commit-and-push'
  | 'open-pr'
  | 'review'
  | 'merge'
  | 'resolve-conflicts'
  | 'investigate'
  | 'checkout-pr'

interface MagicOptionItem {
  id: MagicOption
  label: string
  icon: typeof GitCommitHorizontal
  key: string
}

interface MagicSection {
  header: string
  options: MagicOptionItem[]
}

const MAGIC_SECTIONS: MagicSection[] = [
  {
    header: 'Core',
    options: [
      {
        id: 'save-context',
        label: 'Save Context',
        icon: BookmarkPlus,
        key: 'S',
      },
      { id: 'load-context', label: 'Load Context', icon: FolderOpen, key: 'L' },
    ],
  },
  {
    header: 'Git',
    options: [
      { id: 'commit', label: 'Commit', icon: GitCommitHorizontal, key: 'C' },
      { id: 'commit-and-push', label: 'Commit & Push', icon: GitCommitHorizontal, key: 'P' },
      { id: 'open-pr', label: 'Open PR', icon: GitPullRequest, key: 'O' },
      { id: 'review', label: 'Review', icon: Eye, key: 'R' },
      { id: 'merge', label: 'Merge to Base', icon: GitMerge, key: 'M' },
      { id: 'resolve-conflicts', label: 'Resolve Conflicts', icon: GitMerge, key: 'F' },
      { id: 'investigate', label: 'Investigate Context', icon: Search, key: 'I' },
      { id: 'checkout-pr', label: 'Checkout PR', icon: GitBranch, key: 'K' },
    ],
  },
]

/** Keyboard shortcut to option ID mapping */
const KEY_TO_OPTION: Record<string, MagicOption> = {
  s: 'save-context',
  l: 'load-context',
  c: 'commit',
  p: 'commit-and-push',
  o: 'open-pr',
  r: 'review',
  m: 'merge',
  f: 'resolve-conflicts',
  i: 'investigate',
  k: 'checkout-pr',
}

export function MagicModal() {
  const { magicModalOpen, setMagicModalOpen } = useUIStore()
  const selectedWorktreeId = useProjectsStore(state => state.selectedWorktreeId)
  const hasInitializedRef = useRef(false)
  const [selectedOption, setSelectedOption] =
    useState<MagicOption>('save-context')

  // Flatten all options for arrow key navigation
  const allOptions = useMemo(
    () => MAGIC_SECTIONS.flatMap(section => section.options.map(opt => opt.id)),
    []
  )

  // Reset selection tracking when modal closes
  useEffect(() => {
    if (!magicModalOpen) {
      hasInitializedRef.current = false
    }
  }, [magicModalOpen])

  // Initialize selection when modal opens
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !hasInitializedRef.current) {
        setSelectedOption('save-context')
        hasInitializedRef.current = true
      }
      setMagicModalOpen(open)
    },
    [setMagicModalOpen]
  )

  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)

  const executeAction = useCallback(
    (option: MagicOption) => {
      // checkout-pr only needs a project selected, not a worktree
      // Handle it directly here since ChatWindow may not be rendered
      if (option === 'checkout-pr') {
        if (!selectedProjectId) {
          notify('No project selected', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        // Open the checkout PR modal directly
        useUIStore.getState().setCheckoutPRModalOpen(true)
        setMagicModalOpen(false)
        return
      }

      if (!selectedWorktreeId) {
        notify('No worktree selected', undefined, { type: 'error' })
        setMagicModalOpen(false)
        return
      }

      // Dispatch custom event for ChatWindow to handle
      window.dispatchEvent(
        new CustomEvent('magic-command', { detail: { command: option } })
      )

      setMagicModalOpen(false)
    },
    [selectedWorktreeId, selectedProjectId, setMagicModalOpen]
  )

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Check for direct key shortcuts (s, l, c, p, r)
      const mappedOption = KEY_TO_OPTION[key]
      if (mappedOption) {
        e.preventDefault()
        executeAction(mappedOption)
        return
      }

      if (key === 'enter') {
        e.preventDefault()
        executeAction(selectedOption)
      } else if (key === 'arrowdown' || key === 'arrowup') {
        e.preventDefault()
        const currentIndex = allOptions.indexOf(selectedOption)
        const newIndex =
          key === 'arrowdown'
            ? (currentIndex + 1) % allOptions.length
            : (currentIndex - 1 + allOptions.length) % allOptions.length
        const newOptionId = allOptions[newIndex]
        if (newOptionId) {
          setSelectedOption(newOptionId)
        }
      }
    },
    [executeAction, selectedOption, allOptions]
  )

  return (
    <Dialog open={magicModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[280px] p-0" onKeyDown={handleKeyDown}>
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Magic
          </DialogTitle>
        </DialogHeader>

        <div className="pb-2">
          {MAGIC_SECTIONS.map((section, sectionIndex) => (
            <div key={section.header}>
              {/* Section header */}
              <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {section.header}
              </div>

              {/* Section options */}
              {section.options.map(option => {
                const Icon = option.icon
                const isSelected = selectedOption === option.id

                return (
                  <button
                    key={option.id}
                    onClick={() => executeAction(option.id)}
                    onMouseEnter={() => setSelectedOption(option.id)}
                    className={cn(
                      'w-full flex items-center justify-between px-4 py-2 text-sm transition-colors',
                      'hover:bg-accent focus:outline-none',
                      isSelected && 'bg-accent'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span>{option.label}</span>
                    </div>
                    <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {option.key}
                    </kbd>
                  </button>
                )
              })}

              {/* Separator between sections (not after last) */}
              {sectionIndex < MAGIC_SECTIONS.length - 1 && (
                <div className="my-1 mx-4 border-t border-border" />
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default MagicModal
