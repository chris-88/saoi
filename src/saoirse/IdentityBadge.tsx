import { m } from 'motion/react'
import { fade, useStill } from '@/lib/motion'
import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LogOut, UserRound } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { ANONYMOUS, currentIdentity, signOutIdentity } from '@/lib/identity'
import { routes } from '@/app/routes'
import { cn } from '@/lib/utils'

/**
 * Who you are, once Saoirse knows.
 *
 * Nothing at all while anonymous: an empty avatar in the corner of a conversation that has not
 * asked anybody to sign in is a login prompt pretending to be decoration. Signing in is
 * offered in the conversation, at the point where it protects something, and this is only the
 * evidence that it worked.
 */
export function IdentityBadge({ className }: { className?: string }): ReactNode {
  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: () => currentIdentity(),
    initialData: ANONYMOUS,
    staleTime: 30_000,
  })

  if (identity.data.anonymous) return null

  const name = identity.data.name ?? 'Signed in'
  const initials =
    name
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'

  /*
   * Fades in rather than appearing. It is the one thing that changes in the header when
   * somebody signs in, and until now it popped into place beside a card that had just
   * cross-faded, which made the two look like different events.
   */
  return (
    <Entrance>
      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="Your account"
            className={cn(
              'focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none',
              className,
            )}
          >
            <Avatar className="size-8">
              {identity.data.avatarUrl !== null && (
                <AvatarImage src={identity.data.avatarUrl} alt="" />
              )}
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
          </button>
        </SheetTrigger>

        <SheetContent side="right" className="w-[19rem] gap-0 p-0 sm:w-[21rem]">
          <SheetHeader className="p-4 pb-3">
            <span className="flex items-center gap-3">
              <Avatar className="size-11">
                {identity.data.avatarUrl !== null && (
                  <AvatarImage src={identity.data.avatarUrl} alt="" />
                )}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <SheetTitle className="truncate text-base">{name}</SheetTitle>
                {identity.data.email !== null && (
                  <SheetDescription className="truncate text-xs">
                    {identity.data.email}
                  </SheetDescription>
                )}
              </span>
            </span>
          </SheetHeader>

          <Separator />

          <div className="p-4">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Saoirse keeps this conversation against your account, so it is waiting for you on any
              device you open it on.
            </p>

            <Button asChild variant="ghost" size="sm" className="mt-3 w-full justify-start px-2">
              <a href={routes.privacy}>
                <UserRound className="size-4" />
                What Saoirse knows about you
              </a>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground w-full justify-start px-2"
              onClick={() => {
                // Back to being a stranger, and a reload so nothing of theirs stays on screen.
                void signOutIdentity().then(() => window.location.reload())
              }}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </Entrance>
  )
}

function Entrance({ children }: { readonly children: ReactNode }): ReactNode {
  const still = useStill()
  return still ? <>{children}</> : <m.div {...fade}>{children}</m.div>
}
