import { X, Minus, Maximize2, Maximize, Minimize2 } from 'lucide-react'
import type { AppCommand } from './types'
import { isNativeApp } from '@/lib/environment'
import { invoke } from '@/lib/transport'

export const windowCommands: AppCommand[] = [
  {
    id: 'window-close',
    label: 'Close Window',
    description: 'Close the current window',
    icon: X,
    group: 'window',
    shortcut: 'mod+w',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')

        // In production, check for running sessions before closing.
        // We handle this here (not in onCloseRequested) because
        // Tauri's async onCloseRequested handler can silently fail on Windows.
        if (!import.meta.env.DEV) {
          try {
            const hasRunning = await Promise.race([
              invoke<boolean>('has_running_sessions'),
              new Promise<boolean>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 2000)
              ),
            ])
            if (hasRunning) {
              window.dispatchEvent(new CustomEvent('quit-confirmation-requested'))
              return
            }
          } catch {
            // Fail open: if we can't check, allow quit
          }
        }

        // Use destroy() to bypass onCloseRequested entirely.
        // This avoids the Windows issue where close() + async onCloseRequested
        // silently prevents the window from closing.
        await getCurrentWindow().destroy()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to close window: ${message}`, 'error')
      }
    },
  },

  {
    id: 'window-minimize',
    label: 'Minimize Window',
    description: 'Minimize the current window',
    icon: Minus,
    group: 'window',
    shortcut: 'mod+m',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.minimize()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to minimize window: ${message}`, 'error')
      }
    },
  },

  {
    id: 'window-toggle-maximize',
    label: 'Toggle Maximize',
    description: 'Toggle window maximize state',
    icon: Maximize2,
    group: 'window',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.toggleMaximize()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to toggle maximize: ${message}`, 'error')
      }
    },
  },

  {
    id: 'window-fullscreen',
    label: 'Enter Fullscreen',
    description: 'Enter fullscreen mode',
    icon: Maximize,
    group: 'window',
    shortcut: 'F11',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.setFullscreen(true)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to enter fullscreen: ${message}`, 'error')
      }
    },
  },

  {
    id: 'window-exit-fullscreen',
    label: 'Exit Fullscreen',
    description: 'Exit fullscreen mode',
    icon: Minimize2,
    group: 'window',
    shortcut: 'Escape',

    execute: async context => {
      if (!isNativeApp()) return
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        await appWindow.setFullscreen(false)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        context.showToast(`Failed to exit fullscreen: ${message}`, 'error')
      }
    },
  },
]
