import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CalendarClockIcon, CheckIcon, FlagIcon, PauseIcon, PlayIcon } from 'lucide-react'
import type { AdminCase } from '@contracts/admin.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProgressBar } from '@/components/ProgressBar'
import { IconTile } from '@/components/IconTile'
import { adminApi } from '@/admin/adminClient'

const euro = (amount: number): string => `€${amount.toLocaleString('en-IE')}`

/**
 * §38 — driving a plan from the console.
 *
 * The balance is the lever worth having: move it and the milestones, the projection and any
 * waiting check-in all recompute, because none of them is stored. One number demonstrates the
 * whole machine, which is a far better thing to show than a row of buttons that each set one
 * flag.
 */
export function PlanControls({
  caseId,
  plans,
  onChanged,
}: {
  caseId: string
  plans: AdminCase['plans']
  onChanged: () => void
}): ReactNode {
  const [amount, setAmount] = useState('')

  const setBalance = useMutation({
    mutationFn: (value: number) => adminApi.setSavingsBalance(caseId, value),
    onSuccess: onChanged,
  })

  const move = useMutation({
    mutationFn: (input: { planId: string; move: Parameters<typeof adminApi.planMove>[2] }) =>
      adminApi.planMove(caseId, input.planId, input.move),
    onSuccess: onChanged,
  })

  if (plans.length === 0) return null

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Plans</h2>
        <Badge variant="secondary" className="text-2xs">
          Everything below is computed
        </Badge>
      </div>

      {plans.map((plan) => {
        const fraction =
          plan.targetAmount !== null && plan.targetAmount > 0 && plan.currentAmount !== null
            ? plan.currentAmount / plan.targetAmount
            : null

        return (
          <Card key={plan.id} className="gap-0 p-0">
            <div className="flex items-start gap-3 p-4">
              <IconTile tone="deep" size="sm">
                <FlagIcon />
              </IconTile>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{plan.title}</span>
                <span className="text-muted-foreground block text-2xs">
                  {plan.currentAmount !== null && plan.targetAmount !== null
                    ? `${euro(plan.currentAmount)} of ${euro(plan.targetAmount)}`
                    : 'No target set'}
                  {plan.monthsRemaining !== null &&
                    ` · about ${String(plan.monthsRemaining)} month${plan.monthsRemaining === 1 ? '' : 's'} to go`}
                  {plan.onTrack === false && ' · later than their date'}
                </span>
              </span>
              <Badge
                variant={plan.status === 'active' ? 'default' : 'secondary'}
                className="text-2xs"
              >
                {plan.status}
              </Badge>
            </div>

            {fraction !== null && (
              <div className="px-4 pb-3">
                <ProgressBar
                  value={fraction}
                  label={
                    plan.projectedDate === null
                      ? 'towards target'
                      : `on course for ${plan.projectedDate}`
                  }
                />
              </div>
            )}

            {plan.milestones.length > 0 && (
              <ul className="space-y-1 border-t px-4 py-3">
                {plan.milestones.map((milestone) => (
                  <li key={milestone.id} className="flex items-center gap-2 text-xs">
                    <span
                      aria-hidden
                      className={
                        milestone.state === 'achieved'
                          ? 'bg-state-done/15 text-state-done grid size-4 place-items-center rounded-full'
                          : 'border-input size-4 rounded-full border'
                      }
                    >
                      {milestone.state === 'achieved' && (
                        <CheckIcon className="size-2.5" strokeWidth={3} />
                      )}
                    </span>
                    <span className={milestone.state === 'achieved' ? 'text-muted-foreground' : ''}>
                      {milestone.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {plan.checkins.map((checkin) => (
              <div key={checkin.id} className="flex items-start gap-2 border-t px-4 py-3">
                <CalendarClockIcon aria-hidden className="text-muted-foreground mt-0.5 size-4" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{checkin.purpose}</span>
                  <span className="text-muted-foreground block text-2xs">
                    {checkin.when} · {checkin.state}
                  </span>
                </span>
                {(checkin.state === 'scheduled' || checkin.state === 'due') && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={move.isPending}
                    onClick={() => move.mutate({ planId: plan.id, move: 'trigger_checkin' })}
                  >
                    Bring it due
                  </Button>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-2 border-t p-4">
              {plan.status === 'active' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={move.isPending}
                  onClick={() => move.mutate({ planId: plan.id, move: 'pause' })}
                >
                  <PauseIcon />
                  Pause
                </Button>
              )}
              {plan.status === 'paused' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={move.isPending}
                  onClick={() => move.mutate({ planId: plan.id, move: 'resume' })}
                >
                  <PlayIcon />
                  Resume
                </Button>
              )}
              {plan.status === 'active' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={move.isPending}
                  onClick={() => move.mutate({ planId: plan.id, move: 'complete' })}
                >
                  Complete
                </Button>
              )}
            </div>
          </Card>
        )
      })}

      <Card className="gap-0 p-4">
        <Label htmlFor="savings-balance" className="text-xs">
          Move their savings balance
        </Label>
        <p className="text-muted-foreground mt-0.5 text-2xs">
          Nothing about progress is stored, so changing this recalculates every plan, milestone and
          projection on the case.
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            id="savings-balance"
            inputMode="numeric"
            placeholder="60000"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))}
          />
          <Button
            size="sm"
            disabled={setBalance.isPending || amount.length === 0}
            onClick={() => setBalance.mutate(Number(amount))}
          >
            Set
          </Button>
        </div>
        {setBalance.data && (
          <p className="text-muted-foreground mt-2 text-2xs">
            Engine read back{' '}
            {setBalance.data.seen === null ? 'nothing' : euro(setBalance.data.seen)} ·{' '}
            {String(setBalance.data.plansActive)} active plan
            {setBalance.data.plansActive === 1 ? '' : 's'} ·{' '}
            {String(setBalance.data.milestonesConsidered)} milestone
            {setBalance.data.milestonesConsidered === 1 ? '' : 's'} checked ·{' '}
            {String(setBalance.data.milestonesReached)} reached
          </p>
        )}
      </Card>
    </section>
  )
}
