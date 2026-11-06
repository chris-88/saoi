import { useState, type FormEvent, type ReactNode } from 'react'
import { LockIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { IconTile } from '@/components/IconTile'

/** §28 — real email auth, separate from the anonymous sessions customers get. */
export function AdminLogin({
  onSignIn,
}: {
  onSignIn: (email: string, password: string) => Promise<void>
}): ReactNode {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSignIn(email, password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-sm gap-4 p-6">
      <div className="flex items-center gap-3">
        <IconTile tone="deep">
          <LockIcon />
        </IconTile>
        <div>
          <h1 className="text-sm font-semibold">Presenter console</h1>
          <p className="text-muted-foreground text-xs">Administrators only.</p>
        </div>
      </div>

      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="admin-email">Email</Label>
          <Input
            id="admin-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="admin-password">Password</Label>
          <Input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Card>
  )
}
