import { ClipboardListIcon, MessageCircleIcon } from 'lucide-react'
import type { Suggestion } from '@/saoirse/SuggestionList'

/**
 * The two ways forward after the customer has chosen an option to go through.
 *
 * Saoirse asks this in words — these only save the typing. They are the two things somebody actually
 * wants at that moment, and neither of them is "tell me your income": a person who has just
 * picked a four-year fixed to look at more closely is still looking at it.
 *
 * Fixed rather than generated, because they are a fork in the conversation rather than a
 * decision about anything. Nothing is committed by tapping one.
 */
export const QUOTE_FOLLOW_UPS: readonly Suggestion[] = [
  { id: 'more', label: 'I’ve more questions about this', icon: <MessageCircleIcon /> },
  { id: 'applying', label: 'What’s involved in applying?', icon: <ClipboardListIcon /> },
]
