import type { ReactNode } from 'react'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Link } from 'react-router-dom'
import { SaoiWordmark } from '@/saoirse/SaoiWordmark'
import { routes } from '@/app/routes'

/**
 * What happens to what somebody types.
 *
 * Written to be true rather than to be safe. This is a prototype where real people type real
 * things — a name, a date of birth, what they earn — and the page it used to have said
 * "synthetic data only", which was about the bank's side of the ledger and read as though it
 * covered theirs.
 *
 * Linked from the notice card that appears the first time Saoirse records anything, and from the
 * landing page. Deliberately not in the chat header: the header is the wordmark and nothing
 * else, and a legal link up there would be the first thing a new customer reads.
 */
export function Privacy(): ReactNode {
  useDocumentTitle('How your data is used')
  return (
    <div className="bg-background min-h-dvh">
      <header className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-5">
          <Link to={routes.saoirse}>
            <SaoiWordmark className="h-7" />
          </Link>
          <span className="bg-border hidden h-5 w-px sm:block" />
          <span className="text-muted-foreground hidden text-sm sm:block">
            How your data is used
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 pb-20">
        <h1 className="pt-10 text-3xl font-bold tracking-tight text-balance sm:pt-14 sm:text-4xl">
          How your data is used
        </h1>
        <p className="text-muted-foreground mt-4 max-w-[62ch] text-base text-pretty">
          Saoirse is a working prototype, not a banking service. It is not operated by any bank.
          Nothing you do here opens an account, applies for anything, or reaches a bank.
        </p>

        <Section title="What is kept">
          <p>
            Everything you type, and the conversation around it. Saoirse turns what you say into
            structured notes — your income, what you are saving for, who you are buying with — and
            keeps them so it does not have to ask twice. That is the thing being demonstrated.
          </p>
          <p>
            <strong>So what you type is real and it is stored.</strong> The bank side is invented:
            the customer records, balances and the sign-in are synthetic, and the product
            information is illustrative synthetic material for a demo bank. Your side of the
            conversation is not synthetic, which is why this page exists.
          </p>
          <p>
            Please do not type anything you would mind being kept — a real PPS number, real account
            details, or anything about your health beyond what a form here explicitly asks for.
          </p>
        </Section>

        <Section title="Who sees it">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Anthropic</strong> processes the conversation to generate replies. Messages
              are sent to their API, which is hosted in the United States.
            </li>
            <li>
              <strong>Supabase</strong> stores the conversation and the notes, in their Ireland
              region.
            </li>
            <li>
              <strong>Sentry</strong> receives diagnostics when something breaks. It is sent a
              conversation id, whether you are a customer or a partner, and what the safety check
              decided — never message content and never any value Saoirse recorded.
            </li>
            <li>
              The people building this, through an operator console, to see whether it is working.
            </li>
          </ul>
        </Section>

        <Section title="Cookies">
          <p>
            None for tracking, and no analytics or advertising of any kind. The site keeps your
            sign-in and a couple of interface preferences in your browser&rsquo;s own storage, which
            is what makes the conversation still be there when you come back.
          </p>
        </Section>

        <Section title="Getting rid of it">
          <p>
            Ask and a conversation is deleted — all of it, including the notes taken from it.
            Conversations are also cleared regularly between demonstrations. Nothing here is kept
            for longer than the prototype needs it.
          </p>
        </Section>

        <Section title="If you sign in">
          <p>
            Signing in means giving Saoirse an email address and entering the code sent to it. The
            address is what lets Saoirse recognise you on another device and pick the conversation
            back up, and that is all it is used for. It is not shared, no password is involved, and
            it does not connect to any real banking relationship. You can sign out at any time,
            which returns you to being an anonymous visitor.
          </p>
        </Section>

        <footer className="text-muted-foreground border-border mt-10 border-t pt-8 text-sm">
          <p>
            Questions, or want a conversation removed?{' '}
            <a className="underline" href="mailto:baz@chrisquinn.ie">
              baz@chrisquinn.ie
            </a>
          </p>
        </footer>
      </main>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <section className="border-border border-b py-8 last:border-b-0">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground mt-3 max-w-[62ch] space-y-3 text-sm leading-relaxed [&_strong]:text-foreground [&_strong]:font-semibold">
        {children}
      </div>
    </section>
  )
}
