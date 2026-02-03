/**
 * Module-level storage for xterm.js Terminal instances.
 *
 * This decouples terminal lifecycle from React component lifecycle.
 * Terminals persist across component mount/unmount cycles, preserving
 * buffer content, cursor position, and running processes.
 *
 * Only disposed when user explicitly closes the terminal.
 */

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { invoke } from '@/lib/transport'
import { listen, type UnlistenFn } from '@/lib/transport'
import { useTerminalStore } from '@/store/terminal-store'
import type {
  TerminalOutputEvent,
  TerminalStartedEvent,
  TerminalStoppedEvent,
} from '@/types/terminal'

interface PersistentTerminal {
  terminal: Terminal
  fitAddon: FitAddon
  listeners: UnlistenFn[]
  worktreeId: string
  worktreePath: string
  command: string | null
  initialized: boolean // PTY has been started
}

// Module-level Map - persists across React mount/unmount cycles
const instances = new Map<string, PersistentTerminal>()

// TODO: Add memory cap for detached terminals (e.g., 20 max)
// For now, typical usage won't hit memory limits

/**
 * Get existing terminal instance or create a new one.
 * Creates xterm.js Terminal, FitAddon, and event listeners.
 * Does NOT start PTY - that happens in attachToContainer when first attached.
 */
export function getOrCreateTerminal(
  terminalId: string,
  options: {
    worktreeId: string
    worktreePath: string
    command?: string | null
  }
): PersistentTerminal {
  const existing = instances.get(terminalId)
  if (existing) {
    return existing
  }

  const { worktreeId, worktreePath, command = null } = options
  const { setTerminalRunning } = useTerminalStore.getState()

  // Create xterm.js Terminal instance
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
    theme: {
      background: '#1a1a1a',
      foreground: '#e5e5e5',
      cursor: '#e5e5e5',
      selectionBackground: '#404040',
    },
    allowProposedApi: true,
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  // Handle user input - forward to PTY
  terminal.onData(data => {
    invoke('terminal_write', { terminalId, data }).catch(console.error)
  })

  const listeners: UnlistenFn[] = []

  // Setup event listeners ONCE when terminal is created
  // These persist for the lifetime of the terminal instance
  listen<TerminalOutputEvent>('terminal:output', event => {
    if (event.payload.terminal_id === terminalId) {
      terminal.write(event.payload.data)
    }
  }).then(unlisten => listeners.push(unlisten))

  listen<TerminalStartedEvent>('terminal:started', event => {
    if (event.payload.terminal_id === terminalId) {
      setTerminalRunning(terminalId, true)
    }
  }).then(unlisten => listeners.push(unlisten))

  listen<TerminalStoppedEvent>('terminal:stopped', event => {
    if (event.payload.terminal_id === terminalId) {
      setTerminalRunning(terminalId, false)
      const exitCode = event.payload.exit_code
      terminal.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode ?? 'unknown'}]\x1b[0m`)
    }
  }).then(unlisten => listeners.push(unlisten))

  const instance: PersistentTerminal = {
    terminal,
    fitAddon,
    listeners,
    worktreeId,
    worktreePath,
    command,
    initialized: false,
  }

  instances.set(terminalId, instance)
  return instance
}

/**
 * Get terminal instance by ID.
 */
export function getInstance(terminalId: string): PersistentTerminal | undefined {
  return instances.get(terminalId)
}

/**
 * Attach terminal to a DOM container.
 * If first attach, calls terminal.open(). Otherwise moves DOM element.
 * Starts PTY if not already initialized.
 */
export async function attachToContainer(
  terminalId: string,
  container: HTMLDivElement
): Promise<void> {
  const instance = instances.get(terminalId)
  if (!instance) {
    console.error('[terminal-instances] attachToContainer: instance not found:', terminalId)
    return
  }

  const { terminal, fitAddon, worktreePath, command, initialized } = instance
  const terminalElement = terminal.element

  if (!terminalElement) {
    // First attach - call open() to create DOM element
    terminal.open(container)
  } else if (terminalElement.parentNode !== container) {
    // Re-attach - move DOM element to new container
    container.appendChild(terminalElement)
  }

  // Fit terminal to container and start/reconnect PTY
  requestAnimationFrame(async () => {
    fitAddon.fit()
    const { cols, rows } = terminal

    if (!initialized) {
      // First time - check if PTY already exists (reconnecting after app restart)
      const ptyExists = await invoke<boolean>('has_active_terminal', { terminalId })

      if (ptyExists) {
        // PTY exists - just resize and mark as running
        useTerminalStore.getState().setTerminalRunning(terminalId, true)
        await invoke('terminal_resize', { terminalId, cols, rows }).catch(console.error)
      } else {
        // Start new PTY process
        await invoke('start_terminal', {
          terminalId,
          worktreePath,
          cols,
          rows,
          command,
        }).catch(error => {
          console.error('[terminal-instances] start_terminal failed:', error)
          terminal.writeln(`\x1b[31mFailed to start terminal: ${error}\x1b[0m`)
        })
      }

      instance.initialized = true
    } else {
      // Already initialized - just resize
      await invoke('terminal_resize', { terminalId, cols, rows }).catch(console.error)
    }

    terminal.focus()
  })
}

/**
 * Detach terminal from DOM container.
 * Terminal stays in memory with preserved buffer.
 */
export function detachFromContainer(terminalId: string): void {
  const instance = instances.get(terminalId)
  if (!instance) return

  const terminalElement = instance.terminal.element
  if (terminalElement?.parentNode) {
    terminalElement.parentNode.removeChild(terminalElement)
  }
}

/**
 * Fit terminal to its container dimensions.
 */
export function fitTerminal(terminalId: string): void {
  const instance = instances.get(terminalId)
  if (!instance) return

  instance.fitAddon.fit()
  const { cols, rows } = instance.terminal
  invoke('terminal_resize', { terminalId, cols, rows }).catch(console.error)
}

/**
 * Focus terminal for keyboard input.
 */
export function focusTerminal(terminalId: string): void {
  const instance = instances.get(terminalId)
  if (!instance) return

  instance.terminal.focus()
}

/**
 * Dispose a single terminal instance.
 * Cleans up event listeners, disposes xterm, removes from Map.
 * Does NOT stop PTY - caller should do that separately.
 */
export function disposeTerminal(terminalId: string): void {
  const instance = instances.get(terminalId)
  if (!instance) return

  // Cleanup event listeners
  for (const unlisten of instance.listeners) {
    unlisten()
  }

  // Dispose xterm.js (clears buffer, removes DOM)
  instance.terminal.dispose()

  // Remove from Map
  instances.delete(terminalId)
}

/**
 * Dispose all terminals for a worktree.
 * Used when worktree is deleted/archived/closed.
 * Stops PTY processes and cleans up xterm instances.
 */
export function disposeAllWorktreeTerminals(worktreeId: string): void {
  // Get terminal IDs from store and clear store state
  const terminalIds = useTerminalStore.getState().closeAllTerminals(worktreeId)

  // Dispose each terminal instance and stop PTY
  for (const terminalId of terminalIds) {
    // Stop PTY process
    invoke('stop_terminal', { terminalId }).catch(() => {
      // Terminal may already be stopped
    })

    // Dispose xterm instance
    disposeTerminal(terminalId)
  }
}

/**
 * Check if a terminal instance exists.
 */
export function hasInstance(terminalId: string): boolean {
  return instances.has(terminalId)
}
