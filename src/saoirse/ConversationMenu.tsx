import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  BellRing,
  Check,
  Landmark,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  MessageSquareHeart,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { queryKeys } from '@/lib/queryKeys'
import { listCases, startNewCase, switchCase } from '@/lib/session'
import { pushPermission, subscribeToPush, type SubscribeResult } from '@/lib/push'
import { ANONYMOUS, currentIdentity, lastKnownAddress, signOutIdentity } from '@/lib/identity'
import { SignInForm } from '@/saoirse/SignInForm'
import { FeedbackSheet } from '@/saoirse/FeedbackSheet'
import { InstallSteps } from '@/saoirse/InstallSteps'
import { isInstalled, platform } from '@/lib/installed'
import { supabase } from '@/lib/supabase'
import { fetchCaseSnapshot } from '@/lib/saoiApi'
import { runCaseAction } from '@/lib/caseActions'
import { LINKABLE_BANKS } from '@contracts/cards.ts'
import { cn } from '@/lib/utils'

/**
 * The menu behind the hamburger: what has been sent, which conversation you are in, and a way
 * to start another.
 *
 * Built for running a demonstration from the screen the audience is looking at. Between takes
 * you need a clean conversation, and part-way through one you need to jump back to a prepared
 * case — doing either from a console on a second tab means the filmed screen shows somebody
 * alt-tabbing.
 *
 * A visitor sees their own conversations and nothing else. The wider list belongs to whoever
 * holds the presenter key, because these conversations contain what real people typed, which
 * is the same reason the data notice exists at all.
 */

type Notification = {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly at: string
}

/** Relative where it reads naturally, absolute once it stops being useful. */
function when(iso: string | null): string {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)} hr ago`
  return new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
}

function useNotifications(caseId: string | null) {
  return useQuery({
    queryKey: queryKeys.case.events(caseId ?? 'none'),
    enabled: caseId !== null && supabase !== null,
    queryFn: async (): Promise<readonly Notification[]> => {
      if (!supabase || !caseId) return []
      return (await fetchCaseSnapshot(caseId)).notifications
    },
  })
}

type LinkedAccount = {
  readonly id: string
  readonly bank: string
  readonly displayName: string
  readonly consentUntil: string
}

/**
 * The accounts the customer has let Nexus share, from the case snapshot.
 *
 * Only consents still standing: a revoked row stays in the table for the card that offered
 * it to settle against, but it is nothing the customer needs to see here.
 */
function useLinkedAccounts(caseId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.case.linkedAccounts(caseId ?? 'none'),
    enabled: enabled && caseId !== null && supabase !== null,
    queryFn: async (): Promise<readonly LinkedAccount[]> => {
      if (!supabase || !caseId) return []
      const { linkedAccounts } = await fetchCaseSnapshot(caseId)
      return linkedAccounts
        .filter((account) => account.revokedAt === null)
        .map((account) => ({
          id: account.id,
          bank: LINKABLE_BANKS.find((bank) => bank.id === account.bank)?.name ?? account.bank,
          displayName: account.displayName,
          consentUntil: account.consentExpiresAt,
        }))
    },
  })
}

export function ConversationMenu({
  caseId,
  className,
}: {
  /** Passed down rather than fetched: see `onCase` on SaoirseChat for why that matters. */
  caseId: string | null
  className?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const notifications = useNotifications(caseId)
  const cases = useQuery({
    queryKey: queryKeys.session.cases(),
    enabled: open,
    queryFn: () => listCases(),
  })

  const [permission, setPermission] = useState(() => pushPermission())
  const linked = useLinkedAccounts(caseId, open)

  /**
   * Who is signed in. Read when the menu opens rather than held in a store: it changes exactly
   * once per visit, through a full page redirect, so there is nothing to keep in step.
   */
  const identity = useQuery({
    queryKey: ['identity'],
    enabled: open,
    queryFn: () => currentIdentity(),
    initialData: ANONYMOUS,
  })

  /** Read on render rather than held in state, so "not me" in the form takes effect here too. */
  const known = lastKnownAddress()

  const signOut = useMutation({
    mutationFn: () => signOutIdentity(),
    // A different person now, so every case-shaped thing on screen belongs to somebody else.
    onSuccess: () => window.location.reload(),
  })

  /**
   * Switching and starting both reload the page.
   *
   * `session start` returns the conversation this browser was last in, so a reload lands on the
   * new one by itself. Threading a changed case id back through the transcript, the history
   * load, the card state and the realtime subscriptions is a great deal of machinery to get
   * subtly wrong, and getting it subtly wrong in front of a room is worse than a flash of
   * white between takes.
   */
  const land = () => window.location.reload()

  const goTo = useMutation({
    mutationFn: (id: string) => switchCase(id),
    onSuccess: land,
  })

  const begin = useMutation({
    mutationFn: () => startNewCase('new'),
    onSuccess: land,
  })

  const enablePush = useMutation({
    mutationFn: async () => {
      if (!caseId) return
      const result = await subscribeToPush(caseId)
      setPermission(pushPermission())
      return result
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.case.events(caseId ?? 'none') })
    },
  })

  const busy = goTo.isPending || begin.isPending

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Menu"
          className={cn('text-muted-foreground', className)}
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="flex w-[19rem] flex-col gap-0 p-0 sm:w-[21rem]">
        <SheetHeader className="p-4 pb-3">
          <SheetTitle className="text-base">Your conversations</SheetTitle>
          <SheetDescription className="text-xs">
            {cases.data?.presenter === true
              ? 'Presenter mode: every conversation on this system.'
              : 'Everything you have started with Saoirse.'}
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="p-4">
            <h3 className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
              <Bell className="size-3.5" />
              Notifications
            </h3>

            {notifications.data && notifications.data.length > 0 ? (
              <ul className="space-y-2">
                {notifications.data.map((item) => (
                  <li key={item.id} className="bg-muted/50 rounded-md px-3 py-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {item.body}
                    </p>
                    <p className="text-muted-foreground/70 mt-1 text-[11px]">{when(item.at)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs leading-relaxed">
                Nothing yet. Saoirse will tell you here when something moves.
              </p>
            )}

            {/*
              Offered even when the browser has already granted it.

              It used to hide itself on `granted`, which is the one state where somebody most
              needs it: the permission lives in the browser and the subscription lives on the
              server, and when the server's copy goes — a purge, a reset, a different case —
              the phone still says yes and there is no way left to tell the server so. A
              notification sent to a real phone went nowhere for exactly that reason.
            */}
            {permission !== 'unsupported' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  disabled={enablePush.isPending || caseId === null || permission === 'denied'}
                  onClick={() => enablePush.mutate()}
                >
                  <BellRing className="size-4" />
                  {permission === 'denied'
                    ? 'Notifications are blocked'
                    : permission === 'granted'
                      ? 'Check this device is registered'
                      : 'Tell me when things move'}
                </Button>

                {/* What actually happened. Silence here is how the last one was missed. */}
                {enablePush.data !== undefined &&
                  (enablePush.data.state === 'unsupported' &&
                  platform() === 'ios' &&
                  !isInstalled() ? (
                    <div className="-mx-4 mt-2 border-t">
                      <InstallSteps lead="Notifications need Saoirse on your home screen first. Two taps:" />
                    </div>
                  ) : (
                    <p
                      className={cn(
                        'mt-2 text-xs leading-relaxed',
                        enablePush.data.state === 'subscribed'
                          ? 'text-success'
                          : 'text-muted-foreground',
                      )}
                    >
                      {subscribeMessage(enablePush.data)}
                    </p>
                  ))}

                {permission === 'denied' && (
                  <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                    Turn them back on for this site in your browser settings, then try again.
                  </p>
                )}
              </>
            )}
          </section>

          {/*
            Only while something is shared. The consent screen promised "stop it any time from
            the menu", so this is where that promise is kept; with nothing linked there is
            nothing to stop, and a section saying so is noise.
          */}
          {caseId !== null && linked.data !== undefined && linked.data.length > 0 && (
            <>
              <Separator />
              <LinkedAccounts
                caseId={caseId}
                accounts={linked.data}
                onRevoked={() =>
                  queryClient.invalidateQueries({
                    queryKey: queryKeys.case.linkedAccounts(caseId),
                  })
                }
              />
            </>
          )}

          <Separator />

          <section className="p-4">
            <h3 className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
              <MessageSquare className="size-3.5" />
              Conversations
            </h3>

            {cases.isPending && <p className="text-muted-foreground text-xs">Looking them up…</p>}

            <ul className="space-y-1">
              {(cases.data?.cases ?? []).map((item) => (
                <li key={item.caseId}>
                  <button
                    type="button"
                    disabled={busy || item.current}
                    onClick={() => goTo.mutate(item.caseId)}
                    className={cn(
                      'hover:bg-accent focus-visible:ring-ring w-full rounded-md px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default',
                      item.current && 'bg-accent',
                    )}
                  >
                    <span className="flex items-start gap-2">
                      {item.current ? (
                        <Check className="text-primary mt-0.5 size-4 shrink-0" />
                      ) : (
                        <span className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {item.label ?? item.opening ?? 'Nothing said yet'}
                        </span>
                        <span className="text-muted-foreground block text-[11px]">
                          {item.messages === 0
                            ? 'empty'
                            : `${String(item.messages)} message${item.messages === 1 ? '' : 's'}`}
                          {item.applications > 0 &&
                            ` · ${String(item.applications)} application${item.applications === 1 ? '' : 's'}`}
                          {item.lastActivityAt !== null && ` · ${when(item.lastActivityAt)}`}
                          {cases.data?.presenter === true && !item.mine && ' · not yours'}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {goTo.isError && (
              <p className="text-destructive mt-2 text-xs">
                That conversation would not open. {goTo.error.message}
              </p>
            )}
          </section>

          <Separator />

          {/*
            Asked for here, not in the transcript (§44). The thumbs under each reply are about
            one answer; this is about the whole thing, and the menu is the one place that is
            about the conversation rather than in it.
          */}
          <section className="p-4">
            <h3 className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
              <MessageSquareHeart className="size-3.5" />
              Feedback
            </h3>
            <p className="text-muted-foreground mb-2.5 text-xs leading-relaxed">
              This is a prototype, and what you make of it is the point. A person reads every word.
            </p>
            <FeedbackSheet caseId={caseId} />
          </section>
        </div>

        <Separator />

        <section className="p-4">
          <h3 className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
            <LogIn className="size-3.5" />
            You
          </h3>

          {identity.data.anonymous ? (
            <>
              {/*
               * The way back in, for somebody who has been here before.
               *
               * The same two steps as the card Saoirse offers in the conversation, and the only
               * place to reach them without being offered: a person returning on a new
               * phone, or after clearing their browser, has no card on screen and no
               * conversation to be offered one in. An address they have used before brings
               * the conversation with it.
               */}
              <p className="text-muted-foreground mb-2.5 text-xs leading-relaxed">
                Sign in and this conversation follows you — the same one on your phone, your laptop
                and anywhere else you open Saoirse. Been here before? Use the address you used then.
              </p>
              <SignInForm {...(known === null ? {} : { knownAddress: known })} />
            </>
          ) : (
            <>
              <p className="text-sm font-medium">{identity.data.name ?? 'Signed in'}</p>
              {identity.data.email !== null && (
                <p className="text-muted-foreground truncate text-xs">{identity.data.email}</p>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground mt-2 w-full"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            </>
          )}
        </section>

        <Separator />

        <div className="p-4">
          <Button className="w-full" disabled={busy} onClick={() => begin.mutate()}>
            <Plus className="size-4" />
            Start a new conversation
          </Button>
          {begin.isError && <p className="text-destructive mt-2 text-xs">{begin.error.message}</p>}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * What is being shared, and the way to stop it.
 *
 * Revoking is a `case-action` like any other commitment, and it removes everything read under
 * the consent, so it asks first. The card in the conversation settles to "stopped sharing" on
 * its own: the state comes from the database, not from this menu.
 */
function LinkedAccounts({
  caseId,
  accounts,
  onRevoked,
}: {
  readonly caseId: string
  readonly accounts: readonly LinkedAccount[]
  readonly onRevoked: () => Promise<unknown>
}): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const revoke = useMutation({
    mutationFn: () => runCaseAction({ action: 'revoke_accounts', caseId }),
    onSuccess: async () => {
      setConfirming(false)
      await onRevoked()
    },
  })

  const banks = [...new Set(accounts.map((account) => account.bank))]
  const until = accounts[0]?.consentUntil ?? null

  return (
    <section className="p-4">
      <h3 className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
        <Landmark className="size-3.5" />
        Linked accounts
      </h3>

      <ul className="space-y-1">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              <span className="font-medium">{account.bank}</span>
              <span className="text-muted-foreground"> · {account.displayName}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        Shared through Nexus{until === null ? '' : ` until ${longDate(until)}`}. Balances and
        transactions only; nothing moves unless you tap.
      </p>

      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        disabled={revoke.isPending}
        onClick={() => setConfirming(true)}
      >
        Stop sharing
      </Button>
      {revoke.isError && <p className="text-destructive mt-2 text-xs">{revoke.error.message}</p>}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop sharing with Saoirse?</AlertDialogTitle>
            <AlertDialogDescription>
              Nexus stops sharing your {joinNames(banks)} accounts, and everything Saoirse read
              under that consent is removed. You can link them again whenever you like.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep sharing</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Stays open until the server has answered, so a failure has somewhere to show.
                event.preventDefault()
                revoke.mutate()
              }}
            >
              {revoke.isPending ? 'Stopping…' : 'Stop sharing'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
}

/** "20 January 2027": a consent's end date is worth saying in full. */
function longDate(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** What to say about a subscription attempt, in the customer's terms rather than the API's. */
function subscribeMessage(result: SubscribeResult): string {
  switch (result.state) {
    case 'subscribed':
      return 'This device is registered. Saoirse can reach you here.'
    case 'denied':
      return 'Your browser refused. Nothing will be sent until you allow it for this site.'
    case 'unsupported':
      return result.reason
    case 'failed':
      return result.reason
  }
}
