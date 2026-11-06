import { describe, expect, it } from 'vitest'
import { application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showStatusTool } from './show-status.ts'

describe('show_status', () => {
  it('renders the status card from the applications on the case', async () => {
    const loaded = loadedCase(CASE, { applications: [application('savings', 'in_progress')] })

    const outcome = await showStatusTool.run({}, toolContext({ loaded }))

    expect(outcome.card).toMatchObject({
      type: 'status',
      applications: [{ product: 'savings', state: 'in_progress' }],
    })
  })

  it('refuses when nothing has been started', async () => {
    const outcome = await showStatusTool.run({}, toolContext())

    expect(outcome.refused).toBe(true)
    expect(outcome.card).toBeUndefined()
  })
})
