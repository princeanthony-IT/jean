import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Copy, FileText } from 'lucide-react'
import type { SessionDebugInfo, RunStatus, UsageData } from '@/types/chat'
import { cn } from '@/lib/utils'

interface SessionDebugPanelProps {
  worktreeId: string
  worktreePath: string
  sessionId: string
  onFileClick?: (path: string) => void
}

/** Format token count for display (e.g., 1234 -> "1.2k", 123456 -> "123k") */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`
  }
  return tokens.toString()
}

/** Format usage data for display */
function formatUsage(usage: UsageData | undefined): string {
  if (!usage) return ''
  return `${formatTokens(usage.input_tokens)} in / ${formatTokens(usage.output_tokens)} out`
}

/** Get status color */
function getStatusColor(status: RunStatus): string {
  switch (status) {
    case 'completed':
    case 'crashed': // Crashed runs recovered successfully, show as green
      return 'text-green-500'
    case 'cancelled':
      return 'text-yellow-500'
    case 'resumable':
      return 'text-blue-500'
    case 'running':
      return 'text-blue-500'
    default:
      return 'text-muted-foreground'
  }
}

/** Get display text for status */
function getStatusText(status: RunStatus): string {
  switch (status) {
    case 'crashed':
      return 'completed (recovered)'
    case 'resumable':
      return 'resumable'
    default:
      return status
  }
}

export function SessionDebugPanel({
  worktreeId,
  worktreePath,
  sessionId,
  onFileClick,
}: SessionDebugPanelProps) {
  const { data: debugInfo } = useQuery({
    queryKey: ['session-debug-info', sessionId],
    queryFn: () =>
      invoke<SessionDebugInfo>('get_session_debug_info', {
        worktreeId,
        worktreePath,
        sessionId,
      }),
    staleTime: 1000,
    refetchInterval: 1000, // Poll every second for real-time updates
  })

  const handleCopyAll = useCallback(async () => {
    if (!debugInfo) return

    const lines = [
      `session: ${sessionId}`,
      `sessions file: ${debugInfo.sessions_file}`,
      `runs dir: ${debugInfo.runs_dir}`,
      `manifest: ${debugInfo.manifest_file || 'none'}`,
      `total usage: ${formatUsage(debugInfo.total_usage)}`,
      '',
      `Run logs (${debugInfo.run_log_files.length}):`,
      ...debugInfo.run_log_files.map(
        (f) => `  ${getStatusText(f.status)} ${f.usage ? `(${formatUsage(f.usage)})` : ''} ${f.user_message_preview}`
      ),
    ]

    try {
      await writeText(lines.join('\n'))
      toast.success('Copied to clipboard')
    } catch (error) {
      console.error('Failed to copy:', error)
      toast.error(`Failed to copy: ${error}`)
    }
  }, [debugInfo, sessionId])

  if (!debugInfo) {
    return null
  }

  return (
    <div className="p-4 space-y-2 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold">Debug Info</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={handleCopyAll}
        >
          <Copy className="size-3 mr-1" />
          Copy All
        </Button>
      </div>

      {/* Simple path rows */}
      <div className="text-muted-foreground">
        session: <span className="text-foreground">{sessionId}</span>
      </div>
      <div className="text-muted-foreground truncate" title={debugInfo.sessions_file}>
        sessions file:{' '}
        <span
          className="text-foreground/70 cursor-pointer hover:underline"
          onClick={() => onFileClick?.(debugInfo.sessions_file)}
        >
          ...{debugInfo.sessions_file.slice(-60)}
        </span>
      </div>
      <div className="text-muted-foreground truncate" title={debugInfo.runs_dir}>
        runs dir: <span className="text-foreground/70">...{debugInfo.runs_dir.slice(-50)}</span>
      </div>
      <div className="text-muted-foreground truncate" title={debugInfo.manifest_file || undefined}>
        manifest:{' '}
        {debugInfo.manifest_file ? (
          <span
            className="text-foreground/70 cursor-pointer hover:underline"
            onClick={() => onFileClick?.(debugInfo.manifest_file!)}
          >
            ...{debugInfo.manifest_file.slice(-55)}
          </span>
        ) : (
          <span className="text-foreground/70">none</span>
        )}
      </div>
      {debugInfo.claude_jsonl_file && (
        <div className="text-muted-foreground truncate" title={debugInfo.claude_jsonl_file}>
          claude jsonl:{' '}
          <span
            className="text-foreground/70 cursor-pointer hover:underline"
            onClick={() => onFileClick?.(debugInfo.claude_jsonl_file!)}
          >
            ...{debugInfo.claude_jsonl_file.slice(-55)}
          </span>
        </div>
      )}

      {/* Total token usage */}
      {(debugInfo.total_usage.input_tokens > 0 || debugInfo.total_usage.output_tokens > 0) && (
        <div className="text-muted-foreground">
          total usage: <span className="text-foreground font-mono">
            {formatUsage(debugInfo.total_usage)}
          </span>
          {debugInfo.total_usage.cache_read_input_tokens ? (
            <span className="text-green-500 ml-2" title="Cache hit tokens (cost savings)">
              ({formatTokens(debugInfo.total_usage.cache_read_input_tokens)} cached)
            </span>
          ) : null}
        </div>
      )}

      {/* Run logs */}
      <div className="mt-4">
        <div className="font-medium mb-2">
          Run logs ({debugInfo.run_log_files.length}):
        </div>
        {debugInfo.run_log_files.length === 0 ? (
          <div className="text-muted-foreground text-xs italic ml-2">
            No runs yet
          </div>
        ) : (
          <div className="space-y-1 ml-2">
            {debugInfo.run_log_files.map((file) => (
              <div
                key={file.run_id}
                className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1"
                onClick={() => onFileClick?.(file.path)}
              >
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <span className={cn('font-medium shrink-0', getStatusColor(file.status))}>
                  {getStatusText(file.status)}
                </span>
                {file.usage && (
                  <span className="text-muted-foreground font-mono text-xs shrink-0">
                    ({formatUsage(file.usage)})
                  </span>
                )}
                <span className="text-foreground truncate">
                  {file.user_message_preview}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
