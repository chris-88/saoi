import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SaoiWordmark } from '@/saoirse/SaoiWordmark'
import { Collaborate } from '@/surfaces/Collaborate'
import { routes, showcaseUrls } from '@/app/routes'

/**
 * Questions and collaboration, on the visitor's own phone (§44).
 *
 * The showcase's close shows this page's QR code to a room. Nobody types on the presenter's
 * screen; they scan, and land here with two short forms: a question for a person to answer
 * afterwards, or an offer to work on this. Both go to the same table with a `kind`, and the
 * console lists them together.
 */
export function Ask(): ReactNode {
  useDocumentTitle('Questions and collaboration')
  return (
    <div className="bg-background min-h-dvh">
      <header className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-5">
          <Link to={routes.saoirse}>
            <SaoiWordmark className="h-7" />
          </Link>
          <span className="bg-border hidden h-5 w-px sm:block" />
          <span className="text-muted-foreground hidden text-sm sm:block">
            Questions and collaboration
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 pb-20">
        <h1 className="pt-10 text-3xl font-bold tracking-tight text-balance sm:pt-14 sm:text-4xl">
          Ask a question, or work on this
        </h1>
        <p className="text-muted-foreground mt-4 max-w-[62ch] text-base text-pretty">
          Saoirse is a working prototype, not a banking service, and not operated by Demo Bank. If
          the showcase left you with a question, ask it here and a person will answer by email. If
          you would like to take it further, say so.
        </p>

        <Tabs defaultValue="question" className="mt-8">
          <TabsList>
            <TabsTrigger value="question">Ask a question</TabsTrigger>
            <TabsTrigger value="collaborate">Work on this</TabsTrigger>
          </TabsList>
          <TabsContent value="question" className="mt-4">
            <Collaborate page="ask" kind="question" />
          </TabsContent>
          <TabsContent value="collaborate" className="mt-4">
            <Collaborate page="ask" kind="collaborate" />
          </TabsContent>
        </Tabs>

        <p className="text-muted-foreground mt-10 text-sm">
          What you type here is kept so it can be answered, and for nothing else.{' '}
          <Link to={routes.privacy} className="text-primary underline-offset-4 hover:underline">
            How your data is used
          </Link>
          . Or{' '}
          <Link to={routes.saoirse} className="text-primary underline-offset-4 hover:underline">
            try Saoirse
          </Link>{' '}
          and{' '}
          <a
            href={showcaseUrls.article}
            className="text-primary underline-offset-4 hover:underline"
          >
            read the article
          </a>
          .
        </p>
      </main>
    </div>
  )
}
