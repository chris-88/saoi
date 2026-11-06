import type { ReactNode } from 'react'
import type { Card } from '@contracts/cards.ts'
import { ProductOptionsCard, type ProductChoice } from '@/saoirse/cards/ProductOptionsCard'
import { QuoteCard } from '@/saoirse/cards/QuoteCard'
import type { SubscribeResult } from '@/lib/push'
import { DataNoticeCard } from '@/saoirse/cards/DataNoticeCard'
import { FormDeclarationsCard } from '@/saoirse/cards/FormDeclarationsCard'
import { FormUploadCard } from '@/saoirse/cards/FormUploadCard'
import { SignInCard } from '@/saoirse/cards/SignInCard'
import { MortgageRatesCard } from '@/saoirse/cards/MortgageRatesCard'
import { ComparisonCard } from '@/saoirse/cards/ComparisonCard'
import { ArrangementCard } from '@/saoirse/cards/ArrangementCard'
import { ReuseCard } from '@/saoirse/cards/ReuseCard'
import { AccountOpenedCard } from '@/saoirse/cards/AccountOpenedCard'
import { StatusCard } from '@/saoirse/cards/StatusCard'
import { ReviewCard } from '@/saoirse/cards/ReviewCard'
import { PausePromptCard } from '@/saoirse/cards/PausePromptCard'
import { ConsentCard } from '@/saoirse/cards/ConsentCard'
import { HealthFormCard } from '@/saoirse/cards/HealthFormCard'
import { PartnerInviteCard } from '@/saoirse/cards/PartnerInviteCard'
import { UploadRequestCard } from '@/saoirse/cards/UploadRequestCard'
import { PlanProposalCard } from '@/saoirse/cards/PlanProposalCard'
import { ConnectAccountsCard } from '@/saoirse/cards/ConnectAccountsCard'
import { AccountsOverviewCard } from '@/saoirse/cards/AccountsOverviewCard'
import { TransferCard } from '@/saoirse/cards/TransferCard'
import type { CONSENT_SCOPE, LINKABLE_BANKS } from '@contracts/cards.ts'
import { Settling } from '@/saoirse/cards/Settling'

/**
 * The card registry.
 *
 * An exhaustive switch, so adding a card type to the contract without building its component
 * fails the typecheck rather than rendering nothing at the customer.
 */
export type CardActions = {
  readonly onSelectProducts?: (products: readonly ProductChoice[]) => Promise<void> | void
  readonly onDeclineProducts?: (products: readonly ProductChoice[]) => Promise<void> | void
  /** A quote option the customer wants to go through. Explains; starts nothing. */
  readonly onDiscussQuote?: (option: { id: string; name: string }) => Promise<void> | void
  /** A catalogue product they want to hear about. Also explains; also starts nothing. */
  readonly onChooseComparison?: (option: { id: string; name: string }) => Promise<void> | void
  /** Resolves true only when the server accepted the submit. */
  readonly onSubmit?: (
    applicationId: string,
    confirmations: readonly string[],
  ) => Promise<boolean> | boolean
  readonly onPauseDecision?: (
    applicationId: string,
    decision: 'pause' | 'continue',
  ) => Promise<void> | void
  readonly onConsent?: (applicationId: string, requirementId: string) => Promise<void> | void
  readonly onHealthForm?: (
    applicationId: string,
    values: readonly { key: string; value: unknown }[],
  ) => Promise<void> | void
  readonly onInvitePartner?: (name: string) => Promise<string | undefined> | string | undefined
  readonly onUpload?: (requestId: string, file: File, documentType: string) => Promise<void>
  /**
   * Ask the browser to allow notifications and register this device.
   *
   * Offered from the status card rather than on arrival: "let me tell you when this moves" is
   * a reasonable thing to ask somebody who has something in progress, and an odd thing to ask
   * somebody who has just said hello.
   */
  readonly onEnableNotifications?: () => Promise<SubscribeResult>
  /** Resolves true only when the server accepted the plan. */
  readonly onConfirmPlan?: (planId: string) => Promise<boolean> | boolean
  readonly onDeclinePlan?: (planId: string) => Promise<void> | void
  /** A file attached to one of the bank form's own upload controls. */
  readonly onAttachFormDocument?: (
    formApplicationId: string,
    fieldId: string,
    file: File,
  ) => Promise<void> | void
  /** Every declaration the bank's form requires, confirmed in one tap after each is ticked. */
  readonly onConfirmDeclarations?: (
    applicationId: string,
    fieldIds: readonly string[],
  ) => Promise<void> | void
  /**
   * Open banking, simulated. The consent tap on the connect card, and its refusal; the tap on
   * a transfer card, and its refusal. Allowing is what reads the accounts; moving is what
   * initiates the payment. Nothing is read or moved before the tap (Invariant 1).
   */
  readonly onLinkAccounts?: (
    bank: (typeof LINKABLE_BANKS)[number]['id'],
    scope: readonly (typeof CONSENT_SCOPE)[number][],
  ) => Promise<void> | void
  readonly onDeclineLink?: () => Promise<void> | void
  readonly onTransfer?: (transfer: {
    fromAccountId: string
    toApplicationId: string | null
    amount: number
    cadence: 'once' | 'monthly'
  }) => Promise<void> | void
  readonly onDeclineTransfer?: (toLabel: string) => Promise<void> | void
}

export function CardRenderer({
  card,
  actions = {},
  disabled,
  settled,
}: {
  card: Card
  actions?: CardActions
  disabled?: boolean
  /**
   * What became of this card, where the case knows.
   *
   * A settled card is replaced by what happened to it, rather than kept on screen greyed out
   * with a note underneath. The old version left the entire offer visible — every option,
   * every rate, both buttons — in a state that said "this is over" while still reading as
   * something to decide.
   */
  settled?: { readonly label: string; readonly note?: string } | undefined
}): ReactNode {
  return (
    <Settling settled={settled}>
      <LiveCard card={card} actions={actions} {...(disabled === undefined ? {} : { disabled })} />
    </Settling>
  )
}

/** The card as it was offered, before anything became of it. */
function LiveCard({
  card,
  actions,
  disabled,
}: {
  card: Card
  actions: CardActions
  disabled?: boolean
}): ReactNode {
  switch (card.type) {
    case 'plan_proposal':
      return (
        <PlanProposalCard
          card={card}
          {...(actions.onConfirmPlan ? { onConfirm: actions.onConfirmPlan } : {})}
          {...(actions.onDeclinePlan ? { onDecline: actions.onDeclinePlan } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'sign_in':
      return <SignInCard card={card} {...(disabled === undefined ? {} : { disabled })} />

    case 'data_notice':
      return <DataNoticeCard card={card} />

    case 'form_upload':
      return (
        <FormUploadCard
          card={card}
          {...(actions.onAttachFormDocument ? { onAttach: actions.onAttachFormDocument } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'form_declarations':
      return (
        <FormDeclarationsCard
          card={card}
          {...(actions.onConfirmDeclarations ? { onConfirm: actions.onConfirmDeclarations } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'mortgage_rates':
      return <MortgageRatesCard card={card} />

    case 'comparison':
      return (
        <ComparisonCard
          card={card}
          {...(actions.onChooseComparison ? { onChoose: actions.onChooseComparison } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'quote':
      return (
        <QuoteCard
          card={card}
          {...(actions.onDiscussQuote ? { onDiscuss: actions.onDiscussQuote } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'product_options':
      return (
        <ProductOptionsCard
          card={card}
          {...(actions.onSelectProducts ? { onSelect: actions.onSelectProducts } : {})}
          {...(actions.onDeclineProducts ? { onDecline: actions.onDeclineProducts } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'arrangement':
      return (
        <ArrangementCard
          card={card}
          {...(actions.onSelectProducts ? { onSelect: actions.onSelectProducts } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'reuse':
      return <ReuseCard card={card} />

    case 'account_opened':
      return <AccountOpenedCard card={card} />

    case 'status':
      return (
        <StatusCard
          card={card}
          {...(actions.onEnableNotifications === undefined
            ? {}
            : { onEnableNotifications: actions.onEnableNotifications })}
        />
      )

    case 'review':
      return (
        <ReviewCard
          card={card}
          {...(actions.onSubmit ? { onSubmit: actions.onSubmit } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'pause_prompt':
      return (
        <PausePromptCard
          card={card}
          {...(actions.onPauseDecision ? { onDecide: actions.onPauseDecision } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'consent':
      return (
        <ConsentCard
          card={card}
          {...(actions.onConsent ? { onConsent: actions.onConsent } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'health_form':
      return (
        <HealthFormCard
          card={card}
          {...(actions.onHealthForm ? { onSubmit: actions.onHealthForm } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'partner_invite':
      return (
        <PartnerInviteCard
          card={card}
          {...(actions.onInvitePartner ? { onInvite: actions.onInvitePartner } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'upload_request':
      return (
        <UploadRequestCard
          card={card}
          {...(actions.onUpload ? { onUpload: actions.onUpload } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'connect_accounts':
      return (
        <ConnectAccountsCard
          card={card}
          {...(actions.onLinkAccounts ? { onAllow: actions.onLinkAccounts } : {})}
          {...(actions.onDeclineLink ? { onDecline: actions.onDeclineLink } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )

    case 'accounts_overview':
      return <AccountsOverviewCard card={card} />

    case 'transfer':
      return (
        <TransferCard
          card={card}
          {...(actions.onTransfer ? { onMove: actions.onTransfer } : {})}
          {...(actions.onDeclineTransfer ? { onDecline: actions.onDeclineTransfer } : {})}
          {...(disabled === undefined ? {} : { disabled })}
        />
      )
  }
}
