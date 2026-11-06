import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileCheckIcon, PiggyBankIcon, ZapIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { adminApi } from '@/admin/adminClient'
import type { AdminCase } from '@contracts/admin.ts'

/**
 * Moving a case on by hand.
 *
 * Named for what happens to the customer rather than for the state transition, because that is
 * what somebody on a call is deciding. Each is checked against the state machine for this case,
 * so a move that cannot happen is disabled with the reason rather than failing when pressed.
 */
export function DemoActions({
  caseId,
  moves,
  onChanged,
}: {
  readonly caseId: string
  readonly moves: AdminCase['demoActions']
  readonly onChanged: () => void
}): ReactNode {
  const run = useMutation({
    mutationFn: (move: Parameters<typeof adminApi.demoAction>[1]) =>
      adminApi.demoAction(caseId, move),
    onSuccess: onChanged,
  })
  const savings = useMutation({
    mutationFn: () => adminApi.reachSavingsTarget(caseId),
    onSuccess: onChanged,
  })
  const verify = useMutation({
    mutationFn: () => adminApi.verifyDocuments(caseId),
    onSuccess: onChanged,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Act as the bank</CardTitle>
        <CardDescription>
          What a person can do on this case by hand. Each one is a real state-machine transition.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {moves.map((move) => (
            <Move
              key={move.id}
              icon={<ZapIcon />}
              label={move.label}
              note={move.note}
              disabled={!move.available || run.isPending}
              onClick={() => run.mutate(move.id as Parameters<typeof adminApi.demoAction>[1])}
            />
          ))}
        </div>

        <div className="grid gap-2">
          <Move
            icon={<PiggyBankIcon />}
            label="Their savings reach the target"
            note={
              savings.data?.reached === true
                ? `Reached €${savings.data.target?.toLocaleString('en-IE') ?? ''}. They have something to come back for.`
                : 'Months pass and the money is there, the thing the bank said it would watch for. §41'
            }
            disabled={savings.isPending}
            onClick={() => savings.mutate()}
          />
          <Move
            icon={<FileCheckIcon />}
            label="The bank checks the documents"
            note={
              verify.data
                ? `${String(verify.data.verified)} marked as checked.`
                : 'Marks what has been sent in as verified, so anything waiting on a check can pass. §41'
            }
            disabled={verify.isPending}
            onClick={() => verify.mutate()}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * One move.
 *
 * The reason a move is unavailable goes in a tooltip rather than under the label, because a
 * disabled control explaining itself in permanent small print is most of why this screen looked
 * busy. A `Button` with `asChild` would lose the two-line layout, so it is a ghost button sized
 * to its content instead.
 */
function Move({
  icon,
  label,
  note,
  disabled,
  onClick,
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly note: string
  readonly disabled: boolean
  readonly onClick: () => void
}): ReactNode {
  const button = (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-auto justify-start gap-3 px-3 py-2.5 text-left font-normal"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button fires no pointer events, so the tooltip needs something that does. */}
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        {note}
      </TooltipContent>
    </Tooltip>
  )
}
