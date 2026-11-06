import { describe, expect, it } from 'vitest'
import { chatUiState, showsZeroState, type ChatUiInput } from '@/saoirse/chatUiState'

const at = (over: Partial<ChatUiInput> = {}): ChatUiInput => ({
  entries: 0,
  streaming: false,
  spoken: false,
  composerFocused: false,
  failed: false,
  transitioning: false,
  ...over,
})

describe('what the chat surface is doing', () => {
  it('starts on the opening screen', () => {
    expect(chatUiState(at())).toBe('empty_idle')
    expect(showsZeroState(chatUiState(at()))).toBe(true)
  })

  it('acknowledges focus without leaving the opening screen', () => {
    const state = chatUiState(at({ composerFocused: true }))

    expect(state).toBe('empty_focused')
    expect(showsZeroState(state)).toBe(true)
  })

  it('holds the transition until the animation is done', () => {
    // Between pressing send and the first token the count has changed but the conversation has
    // not started. Reading the count alone tears the opening screen down a frame too early.
    expect(chatUiState(at({ entries: 1, streaming: true, transitioning: true }))).toBe(
      'first_message_transition',
    )
  })

  it('separates waiting for a reply from receiving one', () => {
    expect(chatUiState(at({ entries: 1, streaming: true }))).toBe('saoirse_thinking')
    expect(chatUiState(at({ entries: 1, streaming: true, spoken: true }))).toBe('saoirse_streaming')
  })

  it('settles once the turn is done', () => {
    const state = chatUiState(at({ entries: 2 }))

    expect(state).toBe('conversation_active')
    expect(showsZeroState(state)).toBe(false)
  })

  it('never goes back to the opening screen once something has been said', () => {
    for (const over of [
      { entries: 1 },
      { entries: 1, streaming: true },
      { entries: 4, composerFocused: true },
      { entries: 2, failed: true },
    ]) {
      expect(showsZeroState(chatUiState(at(over))), JSON.stringify(over)).toBe(false)
    }
  })

  it('shows the failure rather than the opening screen, so the message survives', () => {
    // §12: a customer whose first message failed should see what they wrote, not the screen
    // they started on with their words gone.
    expect(chatUiState(at({ entries: 1, failed: true }))).toBe('error')
    expect(showsZeroState(chatUiState(at({ entries: 1, failed: true })))).toBe(false)
  })
})
