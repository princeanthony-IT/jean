import { useState, useCallback } from 'react'
import { FileIcon, Loader2 } from 'lucide-react'
import { invoke } from '@/lib/transport'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'
import { getExtension, getExtensionColor } from '@/lib/file-colors'
import { getFilename } from '@/lib/path-utils'

/** Check if file is markdown based on extension */
function isMarkdownFile(filename: string): boolean {
  return /\.(md|markdown)$/i.test(filename)
}

interface FileMentionBadgeProps {
  /** Relative path to the file (from @ mention) */
  path: string
  /** Worktree path to resolve absolute path */
  worktreePath: string
}

/**
 * Displays a file mention as a clickable badge that opens a preview dialog
 * Used in chat messages to show @mentioned files
 */
export function FileMentionBadge({ path, worktreePath }: FileMentionBadgeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filename = getFilename(path)
  const extension = getExtension(path)

  const handleOpen = useCallback(async () => {
    setIsOpen(true)

    // Load content on-demand if not already loaded
    if (content === null && !isLoading) {
      setIsLoading(true)
      setError(null)
      try {
        // Resolve absolute path from worktree + relative path
        const absolutePath = `${worktreePath}/${path}`
        const fileContent = await invoke<string>('read_file_content', {
          path: absolutePath,
        })
        setContent(fileContent)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setIsLoading(false)
      }
    }
  }, [content, isLoading, path, worktreePath])

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border/50 bg-muted/50 cursor-pointer hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        title={path}
      >
        <FileIcon
          className={cn('h-3.5 w-3.5 shrink-0', getExtensionColor(extension))}
        />
        <span className="text-xs font-medium truncate max-w-[120px]">
          {filename}
        </span>
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="!max-w-[calc(100vw-4rem)] !w-[calc(100vw-4rem)] max-h-[85vh] p-4 bg-background/95 backdrop-blur-sm">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <FileIcon
              className={cn('h-4 w-4', getExtensionColor(extension))}
            />
            {path}
          </DialogTitle>
          <ScrollArea className="h-[calc(85vh-6rem)] mt-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-sm text-destructive p-3">
                Failed to load file: {error}
              </div>
            ) : isMarkdownFile(filename) ? (
              <div className="p-3">
                <Markdown className="text-sm">{content ?? ''}</Markdown>
              </div>
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3 bg-muted rounded-md">
                {content}
              </pre>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
