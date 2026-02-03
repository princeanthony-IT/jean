import type React from 'react'
import { cn } from '@/lib/utils'
import { MacOSWindowControls } from './MacOSWindowControls'
import { WindowsWindowControls } from './WindowsWindowControls'
import { isMacOS } from '@/lib/platform'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useUIStore } from '@/store/ui-store'
import { executeCommand, useCommandContext } from '@/lib/commands'
import { PanelLeft, PanelLeftClose, Settings } from 'lucide-react'
import { usePreferences } from '@/services/preferences'
import { formatShortcutDisplay, DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import { isNativeApp } from '@/lib/environment'

interface TitleBarProps {
  className?: string
  title?: string
}

export function TitleBar({ className, title = 'Jean' }: TitleBarProps) {
  const { leftSidebarVisible, toggleLeftSidebar } = useUIStore()
  const commandContext = useCommandContext()
  const { data: preferences } = usePreferences()

  const sidebarShortcut = formatShortcutDisplay(
    (preferences?.keybindings?.toggle_left_sidebar ||
      DEFAULT_KEYBINDINGS.toggle_left_sidebar) as string
  )
  const native = isNativeApp()

  return (
    <div
      {...(native ? { 'data-tauri-drag-region': true } : {})}
      className={cn(
        'relative flex h-8 w-full shrink-0 items-center justify-between bg-sidebar',
        className
      )}
    >
      {/* Left side - Window Controls + Left Actions */}
      <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {native && isMacOS && <MacOSWindowControls />}

        {/* Left Action Buttons */}
        <div className={cn('flex items-center gap-1', (!native || !isMacOS) && 'pl-2')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={toggleLeftSidebar}
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-foreground/70 hover:text-foreground"
              >
                {leftSidebarVisible ? (
                  <PanelLeftClose className="h-3 w-3" />
                ) : (
                  <PanelLeft className="h-3 w-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {leftSidebarVisible ? 'Hide' : 'Show'} Left Sidebar{' '}
              <kbd className="ml-1 text-[0.625rem] opacity-60">
                {sidebarShortcut}
              </kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => executeCommand('open-preferences', commandContext)}
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-foreground/70 hover:text-foreground"
              >
                <Settings className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Settings <kbd className="ml-1 text-[0.625rem] opacity-60">{formatShortcutDisplay(
                (preferences?.keybindings?.open_preferences ||
                  DEFAULT_KEYBINDINGS.open_preferences) as string
              )}</kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Center - Title */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[50%] px-2">
        <span className="block truncate text-sm font-medium text-foreground/80">
          {title}
        </span>
      </div>

      {/* Right side - Windows/Linux window controls */}
      {native && !isMacOS && <WindowsWindowControls />}
    </div>
  )
}

export default TitleBar
