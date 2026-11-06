import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { LandmarkIcon, MessageSquareHeartIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { adminApi } from '@/admin/adminClient'
import { routes } from '@/app/routes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { HandoffNote } from '@/admin/HandoffNote'
import { CaseInspector } from '@/admin/CaseInspector'
import { DemoActions } from '@/admin/DemoActions'
import { Rating } from '@/admin/FeedbackScreen'
import type { AdminCase } from '@contracts/admin.ts'

/**
 * One conversation, in the views somebody actually needs.
 *
 * The data is fetched once by the workspace and shared with the context pane, so the two halves
 * of a case can never disagree about what state it is in.
 */
export function CaseDetail({
  caseId,
  data,
  onChanged,
  back,
  aside,
}: {
  readonly caseId: string
  readonly data: AdminCase
  readonly onChanged: () => void
  /** A way out, when this is the whole screen rather than the middle column. */
  readonly back?: ReactNode
  /** The context pane's trigger, when there is no room for a third column. */
  readonly aside?: ReactNode
}): ReactNode {
  return (
    <Tabs defaultValue="conversation" className="flex h-full min-h-0 flex-col gap-0">
      <div className="space-y-3 border-b p-3">
        {back === undefined ? null : <div className="-mb-1">{back}</div>}
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold tracking-tight">{data.handoff.who}</h2>
            <p className="text-muted-foreground text-xs">
              {data.handoff.turns} {data.handoff.turns === 1 ? 'message' : 'messages'}
              {data.handoff.lastSeen !== null &&
                ` · last spoke ${data.handoff.lastSeen.slice(0, 10)}`}
            </p>
          </div>
          {aside}
          <DeleteCase caseId={caseId} who={data.handoff.who} />
        </div>

        {/*
          Five tabs do not fit across a phone, and a tab you cannot see is a tab that does not
          exist. Scrolling the strip keeps all five reachable rather than hiding the last two.
        */}
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="conversation" className="text-xs">
            Conversation
          </TabsTrigger>
          <TabsTrigger value="act" className="text-xs">
            Act as the bank
          </TabsTrigger>
          <TabsTrigger value="handover" className="text-xs">
            Handover
          </TabsTrigger>
          <TabsTrigger value="events" className="text-xs">
            Events
          </TabsTrigger>
          <TabsTrigger value="reasoning" className="text-xs">
            Reasoning
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="@container min-h-0 flex-1 overflow-y-auto p-4">
        <TabsContent value="conversation" className="space-y-6">
          <Conversation conversation={data.conversation} />
          <CaseFeedback feedback={data.feedback} />
        </TabsContent>

        <TabsContent value="act" className="space-y-6">
          <DemoActions caseId={caseId} moves={data.demoActions} onChanged={onChanged} />
          <OpenBanking data={data} onChanged={onChanged} />
          <CaseInspector caseId={caseId} show="handling" />
        </TabsContent>

        <TabsContent value="handover">
          <HandoffNote handoff={data.handoff} />
        </TabsContent>

        <TabsContent value="events">
          <Events events={data.events} />
        </TabsContent>

        <TabsContent value="reasoning">
          <CaseInspector caseId={caseId} show="reasoning" />
        </TabsContent>
      </div>
    </Tabs>
  )
}

/** What was actually said. A summary is a claim; the transcript is the evidence for it. */
function Conversation({
  conversation,
}: {
  readonly conversation: AdminCase['conversation']
}): ReactNode {
  if (conversation.length === 0) {
    return (
      <Empty className="border border-dashed py-12">
        <EmptyHeader>
          <EmptyTitle>Nothing said yet</EmptyTitle>
          <EmptyDescription>
            This case exists but the conversation has not started.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-4">
      {conversation.map((message, index) => (
        <Turn key={`${String(index)}-${message.role}`} message={message} />
      ))}
    </div>
  )
}

/**
 * One turn, sided like the chat it came from.
 *
 * A system note is neither side — it is something the interface did on the customer's behalf,
 * and rendering it as speech is how fabricated customer messages got into this transcript in
 * the first place. It gets a rule across the page instead of a bubble.
 */
function Turn({ message }: { readonly message: AdminCase['conversation'][number] }): ReactNode {
  const at = message.at.slice(11, 16)

  if (message.role === 'system') {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-2xs">
          {message.content} · {at}
        </span>
        <span className="bg-border h-px flex-1" />
      </div>
    )
  }

  const customer = message.role === 'customer'

  return (
    <div className={customer ? 'flex justify-end' : 'flex justify-start'}>
      <div className="max-w-[85%] space-y-1">
        <div
          className={customer ? 'flex items-center justify-end gap-2' : 'flex items-center gap-2'}
        >
          <span className="text-muted-foreground text-2xs font-medium">
            {customer ? 'Customer' : 'Saoirse'} · {at}
            {message.timing !== null && !customer && (
              /* Where the time went, so "the first reply took ages" has a number behind it. */
              <span
                className="text-muted-foreground/80"
                title={`Gate ${seconds(message.timing.gateMs)}; first words at ${
                  message.timing.firstTextMs === null
                    ? 'never'
                    : seconds(message.timing.firstTextMs)
                }; ${String(message.timing.rounds)} model round${message.timing.rounds === 1 ? '' : 's'}${
                  message.timing.coldPrefix
                    ? '; the prefix was cold and had to be written to cache'
                    : ''
                }`}
              >
                {' '}
                · {seconds(message.timing.totalMs)}
                {message.timing.coldPrefix ? ' (cold)' : ''}
              </span>
            )}
          </span>
          {message.cards.map((card) => (
            <Badge key={card} variant="outline" className="text-2xs">
              {card.replaceAll('_', ' ')}
            </Badge>
          ))}
        </div>
        {/*
          No bubble for nothing. A turn where Saoirse showed a card and said nothing is terse but
          not broken — an empty grey rectangle is what makes it look broken.
        */}
        {message.content.trim().length > 0 && (
          <div
            className={
              customer
                ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5'
                : 'bg-muted rounded-2xl rounded-bl-md px-4 py-2.5'
            }
          >
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * What this customer said about it (§44).
 *
 * A list under the transcript rather than a thumb beside each turn: the DTO carries the
 * reply's trimmed text with each piece of feedback but no message id, and the turns above
 * carry no id either, so there is nothing to join on. The quoted line is enough to find the
 * reply by eye in a conversation this length.
 */
function CaseFeedback({ feedback }: { readonly feedback: AdminCase['feedback'] }): ReactNode {
  if (feedback.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareHeartIcon className="size-4" />
          Feedback
        </CardTitle>
        <CardDescription>
          {feedback.length === 1 ? 'One thing' : `${String(feedback.length)} things`} this customer
          said about it. Nothing here was shown to Saoirse.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {feedback.map((item) => (
            <li key={item.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Rating item={item} />
                <Badge variant="outline" className="text-2xs">
                  {item.kind === 'turn' ? 'reply' : 'conversation'}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {item.createdAt.slice(0, 16).replace('T', ' ')}
                </span>
                {item.replyTo !== null && (
                  <a
                    href={`mailto:${item.replyTo}`}
                    className="text-primary text-xs underline-offset-4 hover:underline"
                  >
                    {item.replyTo}
                  </a>
                )}
              </div>
              {item.comment !== null && item.comment.length > 0 && (
                <p className="text-sm whitespace-pre-wrap">{item.comment}</p>
              )}
              {item.about !== null && item.about.length > 0 && (
                <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed">
                  {item.about}
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * Everything that happened to this case, in order (§5, Events tab).
 *
 * The spec asks for a Result column. There is not one: for almost every event the outcome is
 * the event — "Mortgage approved" has no separate result — and a column of dashes would be
 * worse than no column at all.
 */
function Events({ events }: { readonly events: AdminCase['events'] }): ReactNode {
  if (events.length === 0) {
    return (
      <Empty className="border border-dashed py-12">
        <EmptyHeader>
          <EmptyTitle>Nothing has happened yet</EmptyTitle>
          <EmptyDescription>Every significant change is recorded here. §52</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events</CardTitle>
        <CardDescription>
          {events.length} recorded, newest first. Metrics are derived from these.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="w-24">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event, index) => (
              <TableRow key={`${event.at}-${String(index)}`}>
                <TableCell className="text-muted-foreground tabular align-top text-xs">
                  {event.at.slice(11, 19)}
                </TableCell>
                <TableCell className="align-top">
                  <span className={event.signal ? 'text-sm font-medium' : 'text-sm'}>
                    {event.describe}
                  </span>
                  {event.object.length > 0 && (
                    <span className="text-muted-foreground block text-xs">{event.object}</span>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant="outline" className="text-2xs">
                    {event.actor}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/**
 * Open banking, simulated: the receiving bank's desk.
 *
 * A transfer the customer initiated sits as "on its way" until somebody here settles it, and
 * the next turn narrates the landing. The client never settles anything by itself: the money
 * has arrived when the bank says so, and on this console the bank is whoever is reading this.
 */
function OpenBanking({
  data,
  onChanged,
}: {
  readonly data: AdminCase
  readonly onChanged: () => void
}): ReactNode {
  const settle = useMutation({
    mutationFn: (transferId: string) => adminApi.settleTransfer(transferId),
    onSuccess: onChanged,
  })

  const { linkedAccounts, transfers } = data
  if (linkedAccounts.length === 0 && transfers.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LandmarkIcon className="size-4" />
          Linked accounts
        </CardTitle>
        <CardDescription>
          What Nexus shares under the customer's consent, and the transfers they have initiated from
          it. Simulated end to end; the shapes are the real ones.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {linkedAccounts.length === 0 ? (
          <p className="text-muted-foreground px-6 text-sm">
            Nothing linked, or the consent was revoked.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-28">Consent until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linkedAccounts.map((account) => (
                /* No row id in the DTO; a masked IBAN is unique within one customer's accounts. */
                <TableRow key={account.ibanMasked}>
                  <TableCell className="align-top">
                    <span className="text-sm font-medium">
                      {account.bank} · {account.displayName}
                    </span>
                    <span className="text-muted-foreground block text-xs tabular-nums">
                      {account.ibanMasked}
                    </span>
                  </TableCell>
                  <TableCell className="text-right align-top text-sm tabular-nums">
                    {euro(account.balance)}
                  </TableCell>
                  <TableCell className="text-muted-foreground align-top text-xs">
                    {account.consentExpiresAt.slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="space-y-2 px-6">
          <h4 className="text-sm font-medium">Transfers</h4>
          {transfers.length === 0 ? (
            <p className="text-muted-foreground text-xs">None initiated.</p>
          ) : (
            <ul className="divide-y">
              {transfers.map((transfer) => (
                <li key={transfer.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium tabular-nums">{euro(transfer.amount)}</span>
                      <span className="text-muted-foreground">
                        {transfer.cadence === 'monthly' ? ' a month' : ''} from {transfer.fromLabel}{' '}
                        to {transfer.toLabel}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {transfer.createdAt.slice(0, 16).replace('T', ' ')}
                    </p>
                  </div>
                  {transfer.state === 'initiated' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      disabled={settle.isPending}
                      onClick={() => settle.mutate(transfer.id)}
                    >
                      {settle.isPending && settle.variables === transfer.id
                        ? 'Settling…'
                        : 'Settle'}
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-2xs">
                      {transfer.state}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {settle.isError && <p className="text-destructive text-xs">{settle.error.message}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

const euro = (amount: number): string => `€${amount.toLocaleString('en-IE')}`

/**
 * Removing one conversation.
 *
 * The console could already purge everything and rebuild the sample customer, which covers
 * clearing the decks between run-throughs and covers nothing else. The case this is for is a
 * single conversation that should not be in the database at all — somebody typed a real name
 * and date of birth into a prototype — and "delete all of them" is a poor answer to that.
 */
function DeleteCase({ caseId, who }: { readonly caseId: string; readonly who: string }): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: () => adminApi.deleteCase(caseId),
    onSuccess: () => {
      setConfirming(false)
      // Back to the list rather than refetching: the case this screen is showing is gone, and
      // asking for it again is a 404 dressed up as an error.
      void navigate(routes.admin.root)
    },
  })

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive shrink-0"
        aria-label="Delete this conversation"
        onClick={() => {
          setConfirming(true)
        }}
      >
        <Trash2Icon />
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              {who} goes, along with their facts, applications, documents, plans and events. This
              cannot be undone, and nothing is archived first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                remove.mutate()
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** 10120 → "10.1 s". A turn is seconds; nobody reads it in milliseconds. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}
