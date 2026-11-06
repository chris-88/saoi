import { useEffect, useState, type ReactNode } from 'react'
import { LaptopIcon, MoonIcon, SunIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { PageHeader, KeyValueList } from '@/admin/parts'
import { useTheme, type Theme } from '@/lib/useTheme'
import { supabase } from '@/lib/supabase'

/**
 * Who you are signed in as (§11).
 *
 * The spec asks for role and permissions, two-factor, sessions across devices, notification
 * preferences, timezone, language, theme and density. On a console with one operator, real
 * email auth and no notification system, most of that does not exist.
 *
 * So the rule here is that decorative must not mean untrue. A "Two-factor authentication —
 * Enabled" badge on an account with no second factor is a false claim about security, not a
 * placeholder. Everything on this screen is either real or visibly inert, and the inert controls
 * say what would have to be built rather than pretending to a state they are not in.
 *
 * Theme is the one that moved the other way: every dark token was already defined and nothing
 * applied `.dark`, so rather than a switch that lies it is a switch that works.
 */
export function ProfileScreen({
  email,
  onSignOut,
}: {
  readonly email: string
  readonly onSignOut: () => void
}): ReactNode {
  const [theme, setTheme] = useTheme()
  const [session, setSession] = useState<{ since: string | null }>({ since: null })

  useEffect(() => {
    const client = supabase
    if (client === null) return

    void client.auth.getSession().then(({ data }) => {
      // `iat` is seconds. The only timestamp this console actually has about a sign-in.
      const issued = data.session?.user.last_sign_in_at ?? null
      setSession({ since: issued })
    })
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Who you are signed in as, and what this console can do about it."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>
                Real Supabase email auth, separate from the anonymous sessions customers get. §28
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback>{email.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{email}</p>
                  <p className="text-muted-foreground text-xs">Signed in</p>
                </div>
                <Badge>Admin</Badge>
              </div>

              <Separator />

              <KeyValueList
                items={[
                  {
                    key: 'Signed in',
                    value:
                      session.since === null ? 'not yet' : new Date(session.since).toLocaleString(),
                  },
                  {
                    /* The honest version of "permissions". There is one role and it is checked
                       on the server for every call, which is the part that matters. */
                    key: 'Permissions',
                    value: 'Everything in this console',
                  },
                  { key: 'Checked', value: 'Server-side, on every request' },
                ]}
              />

              <Button variant="outline" className="w-full" onClick={onSignOut}>
                Sign out
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Applies to this console only. Saoirse is a bank&rsquo;s front door and looks like
                one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label>Theme</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={theme}
                onValueChange={(next) => next !== '' && setTheme(next as Theme)}
                className="w-full"
              >
                <ToggleGroupItem value="light" className="flex-1">
                  <SunIcon />
                  Light
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" className="flex-1">
                  <MoonIcon />
                  Dark
                </ToggleGroupItem>
                <ToggleGroupItem value="system" className="flex-1">
                  <LaptopIcon />
                  System
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-muted-foreground text-xs">
                Remembered in this browser. It is not an account setting, because there is no
                account to hang it on.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Not built</CardTitle>
            <CardDescription>
              The console specification asks for these. None of them exists, so none of them is
              shown switched on — a security setting that claims a state it is not in is worse than
              an absent one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Missing
              name="Two-factor authentication"
              what="Sign-in is email and password. There is no second factor, and showing this as enabled would be a false claim about how this console is protected."
            />
            <Missing
              name="Sessions on other devices"
              what="Nothing records where you have signed in. Supabase holds the current session; a list of devices would need a table that does not exist."
            />
            <Missing
              name="Notification preferences"
              what="Notifications go to customers by SMS, triggered by hand from a case. Nothing notifies an operator, so there is nothing to prefer."
            />
            <Missing
              name="Timezone and language"
              what="Everything is rendered in Irish English at the browser's timezone. A picker would change a stored value that nothing reads."
            />
            <Missing
              name="Density"
              what="One layout, built for this screen. A comfortable/compact switch would need a second set of spacings to switch to."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/**
 * Something the spec asked for that is not here.
 *
 * With a disabled switch rather than no control at all: the point is that somebody reading this
 * screen can see what was asked for and what state it is actually in, which an omission does not
 * communicate. Off and disabled is the true state.
 */
function Missing({ name, what }: { readonly name: string; readonly what: string }): ReactNode {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-muted-foreground text-xs">{what}</p>
      </div>
      <Switch checked={false} disabled aria-label={`${name}, not built`} />
    </div>
  )
}
