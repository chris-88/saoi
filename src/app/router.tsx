import { createHashRouter, Navigate, type RouteObject } from 'react-router-dom'
import { LazyAsk, LazySaoirseScreen, LazyPartnerJoin, LazyPrivacy } from '@/app/lazySurfaces'
import { LazyAdminConsole, LazyAdminOverview } from '@/app/lazyAdmin'
import { ArticleRedirect, HowItWorksRedirect, ShowcaseRedirect } from '@/app/ExternalRedirect'
import { LegacyChatRedirect } from '@/app/LegacyChatRedirect'
import { NotFound } from '@/components/NotFound'
import { RouteError } from '@/app/RouteError'

const routeObjects: RouteObject[] = [
  { path: '/', element: <LazySaoirseScreen /> },
  // `/baz` is the chat's old address (before the rename to Saoi). Old links and printed QR codes
  // still use it, so it stays as a redirect to the chat.
  { path: '/baz', element: <LegacyChatRedirect /> },

  { path: '/privacy', element: <LazyPrivacy /> },
  { path: '/how-it-works', element: <HowItWorksRedirect /> },
  { path: '/how-it-works/:section', element: <HowItWorksRedirect /> },
  { path: '/showcase', element: <ShowcaseRedirect /> },
  { path: '/article', element: <ArticleRedirect /> },
  { path: '/ask', element: <LazyAsk /> },

  { path: '/join/:token', element: <LazyPartnerJoin /> },

  {
    path: '/admin',
    element: <LazyAdminConsole />,
    children: [
      { index: true, element: <LazyAdminOverview section="cases" /> },
      { path: 'case/:caseId', element: <LazyAdminOverview section="case" /> },
      { path: 'guardrails', element: <LazyAdminOverview section="guardrails" /> },
      { path: 'persona', element: <LazyAdminOverview section="persona" /> },
      { path: 'engine', element: <LazyAdminOverview section="engine" /> },
      { path: 'catalogue', element: <LazyAdminOverview section="catalogue" /> },
      { path: 'analytics', element: <LazyAdminOverview section="analytics" /> },
      { path: 'forms', element: <LazyAdminOverview section="forms" /> },
      { path: 'forms/:formApplicationId', element: <LazyAdminOverview section="forms" /> },
      { path: 'feedback', element: <LazyAdminOverview section="feedback" /> },
      { path: 'collaborators', element: <LazyAdminOverview section="collaborators" /> },
      { path: 'profile', element: <LazyAdminOverview section="profile" /> },
    ],
  },

  /**
   * The authenticated app and the audience entry used to live here.
   *
   * Anyone with the old links — an installed PWA pinned to `/app`, a QR printed on a slide —
   * lands on Saoirse rather than a dead end.
   */
  { path: '/app/*', element: <Navigate to="/" replace /> },
  { path: '/try', element: <Navigate to="/" replace /> },

  { path: '/index.html', element: <Navigate to="/" replace /> },
  { path: '*', element: <NotFound /> },
]

export const router = createHashRouter(
  routeObjects.map((route) => ({ ...route, errorElement: <RouteError /> })),
)
