// Keybinding action identifiers - extensible for future shortcuts
export type KeybindingAction =
  | 'focus_chat_input'
  | 'toggle_left_sidebar'
  | 'open_preferences'
  | 'open_commit_modal'
  | 'open_pull_request'
  | 'open_git_diff'
  | 'execute_run'
  | 'open_in_modal'
  | 'open_magic_modal'
  | 'new_session'
  | 'next_session'
  | 'previous_session'
  | 'close_session_or_worktree'
  | 'new_worktree'
  | 'next_worktree'
  | 'previous_worktree'
  | 'cycle_execution_mode'
  | 'approve_plan'
  | 'restore_last_archived'

// Shortcut string format: "mod+key" where mod is cmd/ctrl
// Examples: "mod+l", "mod+shift+p", "mod+1"
export type ShortcutString = string

// Main keybindings record stored in preferences
export type KeybindingsMap = Record<string, ShortcutString>

// Display metadata for the settings UI
export interface KeybindingDefinition {
  action: KeybindingAction
  label: string
  description: string
  default_shortcut: ShortcutString
  category: 'navigation' | 'git' | 'chat'
}

// Default keybindings configuration
export const DEFAULT_KEYBINDINGS: KeybindingsMap = {
  focus_chat_input: 'mod+l',
  toggle_left_sidebar: 'mod+b',
  open_preferences: 'mod+comma',
  open_commit_modal: 'mod+shift+c',
  open_pull_request: 'mod+shift+p',
  open_git_diff: 'mod+g',
  execute_run: 'mod+r',
  open_in_modal: 'mod+o',
  open_magic_modal: 'mod+m',
  new_session: 'mod+t',
  next_session: 'mod+alt+arrowright',
  previous_session: 'mod+alt+arrowleft',
  close_session_or_worktree: 'mod+w',
  new_worktree: 'mod+n',
  next_worktree: 'mod+alt+arrowdown',
  previous_worktree: 'mod+alt+arrowup',
  cycle_execution_mode: 'shift+tab',
  approve_plan: 'mod+enter',
  restore_last_archived: 'mod+shift+t',
}

// UI definitions for the settings pane
export const KEYBINDING_DEFINITIONS: KeybindingDefinition[] = [
  {
    action: 'focus_chat_input',
    label: 'Focus chat input',
    description: 'Move focus to the chat textarea',
    default_shortcut: 'mod+l',
    category: 'chat',
  },
  {
    action: 'toggle_left_sidebar',
    label: 'Toggle left sidebar',
    description: 'Show or hide the projects sidebar',
    default_shortcut: 'mod+b',
    category: 'navigation',
  },
  {
    action: 'open_preferences',
    label: 'Open preferences',
    description: 'Open the preferences dialog',
    default_shortcut: 'mod+comma',
    category: 'navigation',
  },
  {
    action: 'open_commit_modal',
    label: 'Open commit modal',
    description: 'Open the git commit dialog',
    default_shortcut: 'mod+shift+c',
    category: 'git',
  },
  {
    action: 'open_pull_request',
    label: 'Open pull request',
    description: 'Open the pull request dialog',
    default_shortcut: 'mod+shift+p',
    category: 'git',
  },
  {
    action: 'open_git_diff',
    label: 'Open git diff',
    description: 'Open the git diff view for uncommitted changes',
    default_shortcut: 'mod+g',
    category: 'git',
  },
  {
    action: 'execute_run',
    label: 'Execute run',
    description: 'Start or stop the run script in current workspace',
    default_shortcut: 'mod+r',
    category: 'navigation',
  },
  {
    action: 'open_in_modal',
    label: 'Open in...',
    description: 'Open current worktree in editor, terminal, or finder',
    default_shortcut: 'mod+o',
    category: 'navigation',
  },
  {
    action: 'open_magic_modal',
    label: 'Magic commands',
    description: 'Open magic git commands menu',
    default_shortcut: 'mod+m',
    category: 'git',
  },
  {
    action: 'new_session',
    label: 'New session',
    description: 'Create a new chat session',
    default_shortcut: 'mod+t',
    category: 'chat',
  },
  {
    action: 'next_session',
    label: 'Next session',
    description: 'Switch to the next chat session',
    default_shortcut: 'mod+alt+arrowright',
    category: 'chat',
  },
  {
    action: 'previous_session',
    label: 'Previous session',
    description: 'Switch to the previous chat session',
    default_shortcut: 'mod+alt+arrowleft',
    category: 'chat',
  },
  {
    action: 'close_session_or_worktree',
    label: 'Close session',
    description:
      'Close the current session, or remove worktree if last session',
    default_shortcut: 'mod+w',
    category: 'chat',
  },
  {
    action: 'cycle_execution_mode',
    label: 'Cycle execution mode',
    description: 'Cycle through Plan, Build, and Yolo modes',
    default_shortcut: 'shift+tab',
    category: 'chat',
  },
  {
    action: 'approve_plan',
    label: 'Approve plan',
    description: 'Approve the current plan in planning mode',
    default_shortcut: 'mod+enter',
    category: 'chat',
  },
  {
    action: 'new_worktree',
    label: 'New worktree',
    description: 'Create a new worktree in the current project',
    default_shortcut: 'mod+n',
    category: 'navigation',
  },
  {
    action: 'next_worktree',
    label: 'Next worktree',
    description: 'Switch to the next worktree',
    default_shortcut: 'mod+alt+arrowdown',
    category: 'navigation',
  },
  {
    action: 'previous_worktree',
    label: 'Previous worktree',
    description: 'Switch to the previous worktree',
    default_shortcut: 'mod+alt+arrowup',
    category: 'navigation',
  },
  {
    action: 'restore_last_archived',
    label: 'Restore archived',
    description: 'Restore the most recently archived worktree or session',
    default_shortcut: 'mod+shift+t',
    category: 'navigation',
  },
]

// Helper to convert shortcut string to display format
export function formatShortcutDisplay(shortcut: ShortcutString): string {
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  // On macOS web, Cmd shortcuts are intercepted by the browser.
  // Ctrl+key already works (both map to "mod"), so show ⌃ instead of ⌘.
  const isWeb =
    typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)
  const useMacCtrl = isMac && isWeb

  return shortcut
    .split('+')
    .map(part => {
      switch (part) {
        case 'mod':
          return useMacCtrl ? '⌃' : isMac ? '⌘' : 'Ctrl'
        case 'shift':
          return isMac ? '⇧' : 'Shift'
        case 'alt':
          return isMac ? '⌥' : 'Alt'
        case 'comma':
          return ','
        case 'period':
          return '.'
        case 'arrowup':
          return '↑'
        case 'arrowdown':
          return '↓'
        case 'arrowleft':
          return '←'
        case 'arrowright':
          return '→'
        case 'backspace':
          return isMac ? '⌫' : 'Backspace'
        case 'enter':
          return isMac ? '↩' : 'Enter'
        case 'tab':
          return 'Tab'
        case 'escape':
          return 'Esc'
        default:
          return part.toUpperCase()
      }
    })
    .join(' + ')
}

// Helper to parse keyboard event into shortcut string
export function eventToShortcutString(e: KeyboardEvent): ShortcutString | null {
  // Ignore modifier-only presses
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
    return null
  }

  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  // Normalize key names
  let key = e.key.toLowerCase()
  if (key === ',') key = 'comma'
  if (key === '.') key = 'period'
  if (key === '/') key = 'slash'
  if (key === '\\') key = 'backslash'
  if (key === '[') key = 'bracketleft'
  if (key === ']') key = 'bracketright'
  if (key === ';') key = 'semicolon'
  if (key === "'") key = 'quote'
  if (key === '`') key = 'backquote'
  if (key === '-') key = 'minus'
  if (key === '=') key = 'equal'

  parts.push(key)

  return parts.join('+')
}

// Helper to check if an event matches a shortcut string
export function eventMatchesShortcut(
  e: KeyboardEvent,
  shortcut: ShortcutString
): boolean {
  const eventShortcut = eventToShortcutString(e)
  return eventShortcut === shortcut
}
