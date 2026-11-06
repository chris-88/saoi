import type { ReactNode } from 'react'
import { SmartphoneIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconTile } from '@/components/IconTile'
import { platform, useInstallPrompt } from '@/lib/installed'
import { InstallSteps } from '@/saoirse/InstallSteps'

/**
 * Keep Saoirse on the home screen.
 *
 * The move from a browser tab to the installed app is the continuity story on the big screen:
 * sign in here, open it there, "pick up where you left off", the same conversation. This is
 * the card that leads into it, offered once, after signing in.
 *
 * iOS has no install API, so the guide is the Share sheet, and the glyph breathes so the eye
 * finds it. Android gets the browser's own prompt. Nothing here is platform-sniffing for its
 * own sake: it is the difference between an instruction and a shrug.
 */
export function InstallCard({ onDismiss }: { readonly onDismiss: () => void }): ReactNode {
  const prompt = useInstallPrompt()
  const where = platform()

  const install = () => {
    if (prompt === null) return
    void prompt.prompt().finally(onDismiss)
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <IconTile tone="deep">
          <SmartphoneIcon />
        </IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-balance">Keep Saoirse on your home screen</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            It opens like any other app, and your conversation is already in it. No app store
            involved.
          </p>
        </div>
      </div>

      {where === 'ios' ? (
        <div className="border-t">
          <InstallSteps />
        </div>
      ) : (
        <div className="border-t p-3">
          <Button className="w-full" disabled={prompt === null} onClick={install}>
            Add Saoirse to your home screen
          </Button>
        </div>
      )}

      <div className="bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2.5">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Open it from there, sign in with the same address, and your conversation is waiting.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground shrink-0"
          onClick={onDismiss}
        >
          Not now
        </Button>
      </div>
    </Card>
  )
}
