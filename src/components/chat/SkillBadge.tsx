import { useState, useCallback } from 'react'
import { Wand2, Loader2, X } from 'lucide-react'
import { invoke } from '@/lib/transport'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'
import type { PendingSkill } from '@/types/chat'

interface SkillBadgeProps {
  /** The pending skill to display */
  skill: PendingSkill
  /** Optional callback to remove this skill (shows X button if provided) */
  onRemove?: () => void
  /** Whether the badge is in a compact display mode */
  compact?: boolean
}

/**
 * Displays a skill mention as a clickable badge that opens a preview dialog
 * Used in chat input for pending skills and in messages for sent skills
 */
export function SkillBadge({ skill, onRemove, compact }: SkillBadgeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpen = useCallback(async () => {
    setIsOpen(true)

    // Load content on-demand if not already loaded
    if (content === null && !isLoading) {
      setIsLoading(true)
      setError(null)
      try {
        const fileContent = await invoke<string>('read_file_content', {
          path: skill.path,
        })
        setContent(fileContent)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setIsLoading(false)
      }
    }
  }, [content, isLoading, skill.path])

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onRemove?.()
    },
    [onRemove]
  )

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 cursor-pointer hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          compact ? 'h-6 px-2' : 'h-7 px-2.5'
        )}
        title={`Skill: ${skill.name}\n${skill.path}`}
      >
        <Wand2
          className={cn(
            'shrink-0 text-purple-500',
            compact ? 'h-3 w-3' : 'h-3.5 w-3.5'
          )}
        />
        <span
          className={cn(
            'font-medium truncate max-w-[120px]',
            compact ? 'text-[10px]' : 'text-xs'
          )}
        >
          /{skill.name}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={handleRemove}
            className="ml-0.5 p-0.5 rounded hover:bg-accent/50 transition-colors"
            title="Remove skill"
          >
            <X className={cn('text-muted-foreground', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          </button>
        )}
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="!max-w-[calc(100vw-4rem)] !w-[calc(100vw-4rem)] max-h-[85vh] p-4 bg-background/95 backdrop-blur-sm">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-purple-500" />
            Skill: {skill.name}
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{skill.path}</p>
          <ScrollArea className="h-[calc(85vh-6rem)] mt-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-sm text-destructive p-3">
                Failed to load skill: {error}
              </div>
            ) : (
              <div className="p-3">
                <Markdown className="text-sm">{content ?? ''}</Markdown>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
