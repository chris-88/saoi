import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { RotateCcwIcon, SparklesIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { PRESET_NAMES, SLIDER_NAMES, type PresetName, type SliderName } from '@llm/persona.ts'
import { PageHeader } from '@/admin/parts'
import { adminApi } from '@/admin/adminClient'
import type { AdminOverview } from '@contracts/admin.ts'

/** What each slider actually does, in the words somebody turning it would use. */
const DESCRIPTIONS: Readonly<Record<SliderName, string>> = {
  length: 'Shorter is terser. Longer explains more before asking the next thing.',
  humour: 'Light remarks where they fit. Never during anything sensitive.',
  sarcasm: 'Dry asides. Use sparingly: it reads badly when somebody is worried.',
  formality: 'Higher is professional and measured. Lower is how a person actually talks.',
  playfulness: 'Warmth and a bit of character in how things are put.',
  poetic: 'More expressive turns of phrase. At the top it is a party trick.',
}

/** The example the preview answers, fixed so two settings can be compared on the same words. */
const PREVIEW_PROMPT =
  'I’m looking to buy a house next year and want to know what I need to do and if I’m eligible.'

/**
 * §16 to §18 — style, and only style.
 *
 * Sliders do not auto-save. A persona that changed as it was dragged would mean the setting
 * driving a live conversation was whatever the pointer last passed over.
 */
export function PersonaControls({
  persona,
  onChanged,
}: {
  readonly persona: AdminOverview['persona']
  readonly onChanged: () => void
}): ReactNode {
  const [sliders, setSliders] = useState(persona.sliders)

  const save = useMutation({ mutationFn: adminApi.setPersona, onSuccess: onChanged })
  const preview = useMutation({
    mutationFn: () => adminApi.previewPersona(sliders, PREVIEW_PROMPT),
  })

  const changed = SLIDER_NAMES.some((name) => sliders[name] !== persona.sliders[name])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Persona"
        description="How Saoirse speaks. Not what it may discuss, what it can do, or any customer protection."
      />

      <Alert>
        <AlertDescription>
          Style only, and it applies to the very next message. A sensitive turn forces humour,
          sarcasm, playfulness and poetic to zero whatever these say. §18, §50, §56
        </AlertDescription>
      </Alert>

      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Presets</CardTitle>
              <CardDescription>A named set of slider values. Applies immediately.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {PRESET_NAMES.map((preset: PresetName) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={persona.preset === preset ? 'default' : 'outline'}
                  disabled={save.isPending}
                  onClick={() => save.mutate({ preset })}
                >
                  {preset.replaceAll('_', ' ')}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tone controls</CardTitle>
              <CardDescription>
                Nothing is applied until you say so, so a drag cannot change a live conversation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {SLIDER_NAMES.map((name) => (
                <div key={name} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor={name} className="text-sm capitalize">
                      {name}
                    </Label>
                    <span className="text-muted-foreground tabular text-sm">
                      {sliders[name].toFixed(2)}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">{DESCRIPTIONS[name]}</p>
                  <Slider
                    id={name}
                    value={[sliders[name]]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={([value]) =>
                      setSliders((current) => ({ ...current, [name]: value ?? 0 }))
                    }
                  />
                </div>
              ))}

              <Separator />

              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!changed}
                  onClick={() => setSliders(persona.sliders)}
                >
                  <RotateCcwIcon />
                  Reset
                </Button>
                <Button
                  disabled={!changed || save.isPending}
                  onClick={() => save.mutate({ sliders })}
                >
                  {save.isPending ? 'Applying…' : 'Apply to the next message'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Preview
              <Badge variant="secondary">not saved</Badge>
            </CardTitle>
            <CardDescription>
              {/* Deliberately on demand: a model call per drag is slow, costs money, and the
                  point is to hear a setting rather than watch one. */}
              What the sliders above would sound like, on the real prompt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-primary text-primary-foreground ml-auto w-fit rounded-2xl rounded-br-md px-4 py-2.5">
              <p className="text-sm">{PREVIEW_PROMPT}</p>
            </div>

            {preview.isPending && <Skeleton className="h-28 w-full" />}

            {preview.isError && (
              <Alert variant="destructive">
                <AlertDescription>{preview.error.message}</AlertDescription>
              </Alert>
            )}

            {preview.data && !preview.isPending && (
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-2.5">
                <p className="text-sm whitespace-pre-wrap">{preview.data.reply}</p>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full"
              disabled={preview.isPending}
              onClick={() => preview.mutate()}
            >
              <SparklesIcon />
              {preview.data ? 'Hear it again' : 'Hear how this sounds'}
            </Button>

            <div className="flex flex-wrap gap-1.5">
              {SLIDER_NAMES.map((name) => (
                <Badge key={name} variant="outline" className="text-2xs capitalize">
                  {name} {sliders[name].toFixed(2)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
