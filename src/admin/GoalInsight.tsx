import { useState } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { AdminCase } from '@contracts/admin.ts'

/**
 * What the Goal Engine makes of a case (§19, §21).
 *
 * The point of showing this is that it is the hardest part of the claim to believe. A room will
 * accept that a model can hold a conversation; what it will not take on trust is that one
 * sentence about a baby and a deposit produced eight recognised goals, one primary, two held for
 * later with conditions attached — and that Saoirse chose to mention three of them. So every goal is
 * here with its evidence, including the ones nothing points at, and the reasoning is the
 * engine's rather than the prompt's.
 */

const TIER_ORDER = [
  'primary',
  'strong_related',
  'secondary',
  'deferred',
  'suppressed',
  'planned',
  'latent',
] as const

const TIER_LABELS: Record<string, string> = {
  primary: 'What they came in about',
  strong_related: 'Strongly related',
  secondary: 'Worth knowing',
  deferred: 'Right goal, wrong moment',
  suppressed: 'Deliberately not raised',
  planned: 'Already a plan',
  latent: 'Nothing points at these',
}

const TIER_NOTES: Record<string, string> = {
  primary: 'The goal they named. Not the best-evidenced one, the one they said out loud.',
  strong_related: 'Established, and genuinely connected. Saoirse may raise one of these.',
  secondary: 'Enough evidence to hold as context. Not enough to bring up unprompted.',
  deferred: 'Remembered, with the condition that would make it worth raising again.',
  suppressed: 'A protection, not an oversight. The reason is recorded.',
  planned: 'Settled. The customer decided, so it is not a candidate again.',
  latent: 'Shown so "why was this never mentioned" has an answer.',
}

function tierVariant(tier: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (tier === 'primary') return 'default'
  if (tier === 'suppressed') return 'destructive'
  if (tier === 'latent') return 'outline'
  return 'secondary'
}

export function GoalInsight({ data }: { readonly data: AdminCase }): React.ReactElement | null {
  const [showLatent, setShowLatent] = useState(false)

  if (data.goals.length === 0) return null

  const byTier = TIER_ORDER.map((tier) => ({
    tier,
    goals: data.goals.filter((goal) => goal.tier === tier),
  })).filter(({ tier, goals }) => goals.length > 0 && (tier !== 'latent' || showLatent))

  const latentCount = data.goals.filter((goal) => goal.tier === 'latent').length

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Where they are trying to get to</h2>
        <span className="text-muted-foreground text-2xs">
          {data.goals.length - latentCount} of {data.goals.length} goals recognised
        </span>
      </div>

      {/*
        §10 — the one thing on this screen that is a problem rather than an observation. The
        engine raises it and stops; which of two goals somebody's savings are for is their call.
      */}
      {data.contentions.map((contention) => (
        <Alert key={contention.resource} variant="destructive">
          <AlertTriangleIcon />
          <AlertDescription>
            <span className="block font-medium">{contention.describe}</span>
            {contention.needed > 0 && (
              <span className="text-2xs">
                €{contention.needed.toLocaleString('en-IE')} promised, €
                {contention.available.toLocaleString('en-IE')} held. Saoirse asks which it is for
                rather than deciding.
              </span>
            )}
          </AlertDescription>
        </Alert>
      ))}

      {/* §11 — the circumstance that opened several goals at once, and its caution. */}
      {data.lifeEvents.length > 0 && (
        <Card className="gap-0 divide-y p-0">
          {data.lifeEvents.map((event) => (
            <div key={event.id} className="space-y-0.5 px-4 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{event.name}</span>
                <span className="text-muted-foreground text-2xs">because {event.because}</span>
              </div>
              {event.note !== null && (
                <p className="text-muted-foreground text-2xs italic">{event.note}</p>
              )}
            </div>
          ))}
        </Card>
      )}

      {byTier.map(({ tier, goals }) => (
        <Card key={tier} className="gap-0 p-0">
          <div className="space-y-0.5 border-b px-4 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold">{TIER_LABELS[tier] ?? tier}</span>
              <span className="text-muted-foreground tabular text-2xs">{goals.length}</span>
            </div>
            <p className="text-muted-foreground text-2xs">{TIER_NOTES[tier]}</p>
          </div>

          <div className="divide-y">
            {goals.map((goal) => (
              <div key={goal.id} className="space-y-1 px-4 py-2.5">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 text-sm font-medium">{goal.name}</span>
                  <span className="text-muted-foreground tabular text-2xs">
                    {goal.confidence.toFixed(2)}
                  </span>
                  <Badge variant={tierVariant(goal.tier)} className="text-2xs">
                    {goal.category.replaceAll('_', ' ')}
                  </Badge>
                </div>

                {/* The audit trail: why this goal appeared at all, in the customer's own terms. */}
                {goal.evidence.length > 0 && (
                  <p className="text-muted-foreground text-2xs">{goal.evidence.join(' · ')}</p>
                )}

                {goal.reason !== null && (
                  <p className="text-muted-foreground text-2xs italic">
                    {goal.reason}
                    {goal.revisitWhen !== null && ` · back when ${goal.revisitWhen}`}
                  </p>
                )}

                {/*
                  What Saoirse has yet to ask. This is the line that shows the engine knows the
                  difference between a goal it has recognised and a goal it could act on.
                */}
                {goal.missing.length > 0 && goal.tier !== 'latent' && (
                  <p className="text-muted-foreground text-2xs">
                    Still unknown: {goal.missing.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      {latentCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-2xs h-7"
          onClick={() => setShowLatent((shown) => !shown)}
        >
          {showLatent ? 'Hide the rest' : `Show ${latentCount} more with no evidence yet`}
        </Button>
      )}
    </section>
  )
}
