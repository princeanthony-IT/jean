import { useState, useCallback } from 'react'
import { X, FileText } from 'lucide-react'
import { invoke } from '@/lib/transport'
import type { PendingTextFile } from '@/types/chat'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/ui/markdown'

function isMarkdownFile(filename: string | undefined): boolean {
  if (!filename) return false
  return /\.(md|markdown)$/i.test(filename)
}

interface TextFilePreviewProps {
  /** Array of pending text files to display */
  textFiles: PendingTextFile[]
  /** Callback when user removes a text file */
  onRemove: (textFileId: string) => void
  /** Whether removal is disabled (e.g., while sending) */
  disabled?: boolean
}

/** Format bytes to human readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Displays previews of pending text file attachments before sending
 * Renders above the chat input area alongside image previews
 */
export function TextFilePreview({
  textFiles,
  onRemove,
  disabled,
}: TextFilePreviewProps) {
  const [openFileId, setOpenFileId] = useState<string | null>(null)

  const handleRemove = useCallback(
    async (e: React.MouseEvent, textFile: PendingTextFile) => {
      // Prevent the click from bubbling to the preview dialog
      e.stopPropagation()

      if (disabled) return

      // Delete the file from disk
      try {
        await invoke('delete_pasted_text', { path: textFile.path })
      } catch (error) {
        console.error('Failed to delete text file:', error)
        // Still remove from UI even if delete fails
      }

      // Remove from store
      onRemove(textFile.id)
    },
    [disabled, onRemove]
  )

  const openFile = textFiles.find(tf => tf.id === openFileId)

  if (textFiles.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2 px-4 py-2 md:px-6">
        {textFiles.map(textFile => (
          <div key={textFile.id} className="relative group">
            <button
              type="button"
              onClick={() => setOpenFileId(textFile.id)}
              className="flex items-center gap-2 h-16 px-3 rounded-md border border-border/50 bg-muted cursor-pointer hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex flex-col items-start text-left min-w-0">
                <span className="text-xs font-medium truncate max-w-[120px]">
                  {textFile.filename}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(textFile.size)}
                </span>
              </div>
            </button>
            {!disabled && (
              <button
                type="button"
                onClick={e => handleRemove(e, textFile)}
                className="absolute -top-1.5 -right-1.5 p-0.5 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-destructive/90 z-10"
                title="Remove text file"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Preview dialog */}
      <Dialog
        open={!!openFileId}
        onOpenChange={open => !open && setOpenFileId(null)}
      >
        <DialogContent className="!max-w-[calc(100vw-4rem)] !w-[calc(100vw-4rem)] max-h-[85vh] p-4 bg-background/95 backdrop-blur-sm">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {openFile?.filename}
            <span className="text-muted-foreground font-normal">
              ({openFile ? formatBytes(openFile.size) : ''})
            </span>
          </DialogTitle>
          <ScrollArea className="h-[calc(85vh-6rem)] mt-2">
            {isMarkdownFile(openFile?.filename) ? (
              <div className="p-3">
                <Markdown className="text-sm">
                  {openFile?.content ?? ''}
                </Markdown>
              </div>
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3 bg-muted rounded-md">
                {openFile?.content}
              </pre>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
