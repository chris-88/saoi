import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon, UsersIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IconTile } from '@/components/IconTile'

type Payload = Extract<CardPayload, { type: 'partner_invite' }>

/**
 * §6 Stage 9 — inviting the second applicant.
 *
 * Nothing is sent anywhere: the customer gets a link and shares it themselves, which keeps the
 * prototype clear of real delivery while the flow stays honest.
 */
export function PartnerInviteCard({
  card,
  onInvite,
  disabled,
}: {
  card: Payload
  onInvite?: (name: string) => Promise<string | undefined> | string | undefined
  disabled?: boolean
}): ReactNode {
  const [name, setName] = useState(card.partnerName ?? '')
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const create = () => {
    setBusy(true)
    void Promise.resolve(onInvite?.(name.trim()))
      .then((url) => setLink(url ?? null))
      .finally(() => setBusy(false))
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4">
        <IconTile tone="deep">
          <UsersIcon />
        </IconTile>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">Invite your second applicant</p>
          <p className="text-muted-foreground text-xs">
            They&rsquo;ll only see their own tasks for {card.applicationNames.join(' and ')}, never
            your conversation or your details.
          </p>
        </div>
      </div>

      {link === null ? (
        <div className="space-y-3 border-t p-4">
          <div className="space-y-1.5">
            <Label htmlFor="partner-name">Their first name</Label>
            <Input
              id="partner-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Emma"
              disabled={disabled ?? busy}
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={(disabled ?? busy) || name.trim().length === 0}
            onClick={create}
          >
            {busy ? 'Creating…' : 'Create their link'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2 border-t p-4">
          <p className="text-muted-foreground text-xs">
            Send this to {name || 'them'}. It works once, and only for their part.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={link} className="font-mono text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => setCopied(true))
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
