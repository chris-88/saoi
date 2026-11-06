/**
 * What the chat surface is doing (opening-transition spec §10).
 *
 * Derived rather than stored, from facts that already exist. The spec warns against keying the
 * layout off `messages.length` alone, and it is right: between pressing send and the first
 * token there is a window where the message count has changed but the conversation has not
 * started, and reading only the count makes the opening screen tear down a frame too early.
 */
export const CHAT_UI_STATES = [
  'empty_idle',
  'empty_focused',
  'first_message_transition',
  'saoirse_thinking',
  'saoirse_streaming',
  'conversation_active',
  'error',
] as const

export type ChatUiState = (typeof CHAT_UI_STATES)[number]

export type ChatUiInput = {
  /** Turns on screen, including the one just sent optimistically. */
  readonly entries: number
  /** A turn is in flight. */
  readonly streaming: boolean
  /** Any text has arrived from Saoirse for the turn in flight. */
  readonly spoken: boolean
  readonly composerFocused: boolean
  readonly failed: boolean
  /** The opening animation is still running. */
  readonly transitioning: boolean
}

export function chatUiState(input: ChatUiInput): ChatUiState {
  /*
   * An error outranks everything, and never returns to the opening screen (§12). A customer
   * whose first message failed should see the message they wrote and a way to send it again,
   * not the screen they started on with their words gone.
   */
  if (input.failed) return 'error'

  if (input.entries === 0) return input.composerFocused ? 'empty_focused' : 'empty_idle'

  if (input.transitioning) return 'first_message_transition'

  if (input.streaming) return input.spoken ? 'saoirse_streaming' : 'saoirse_thinking'

  return 'conversation_active'
}

/** Whether the opening screen should be on show. */
export function showsZeroState(state: ChatUiState): boolean {
  return state === 'empty_idle' || state === 'empty_focused'
}
