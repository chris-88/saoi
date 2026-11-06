import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageText } from '@/saoirse/MessageText'

const text = (node: HTMLElement): string => node.textContent ?? ''

describe('MessageText', () => {
  it('renders bold rather than printing the asterisks', () => {
    const { container } = render(<MessageText text="**Plan step reached:** your target is hit." />)

    expect(container.querySelector('strong')?.textContent).toBe('Plan step reached:')
    expect(text(container)).not.toContain('**')
  })

  it('turns consecutive dashes into one list', () => {
    const { container } = render(
      <MessageText
        text={'Here is what changed:\n- Plan step reached\n- Check-in due\n- Submitted'}
      />,
    )

    expect(container.querySelectorAll('ul')).toHaveLength(1)
    expect(container.querySelectorAll('li')).toHaveLength(3)
  })

  it('keeps bold inside a list item', () => {
    const { container } = render(<MessageText text={'- **Check-in due:** the review is due'} />)

    expect(container.querySelector('li strong')?.textContent).toBe('Check-in due:')
  })

  /*
   * Streaming is where a renderer like this goes wrong: text arrives a character at a time, so
   * every half-written construct is rendered. None of them may throw, and none may flicker
   * between two shapes as the rest of the line arrives.
   */
  it('survives every prefix of a message', () => {
    const full = 'Here:\n- **Plan step reached:** your €42,000 target is hit.\n- Check-in due.'

    for (let length = 0; length <= full.length; length += 1) {
      expect(() => render(<MessageText text={full.slice(0, length)} />)).not.toThrow()
    }
  })

  it('leaves an unfinished bold marker alone rather than eating the text', () => {
    const { container } = render(<MessageText text="**Plan step" />)

    expect(text(container)).toContain('**Plan step')
    expect(container.querySelector('strong')).toBeNull()
  })

  it('leaves ordinary text exactly as written', () => {
    render(<MessageText text={'Line one\nLine two'} />)
    expect(screen.getByText(/Line one/).textContent).toContain('Line two')
  })

  it('does not render HTML from the model', () => {
    const { container } = render(<MessageText text="<script>alert(1)</script>" />)

    expect(container.querySelector('script')).toBeNull()
    expect(text(container)).toContain('<script>')
  })
})
