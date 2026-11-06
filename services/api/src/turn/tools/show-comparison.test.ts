import { describe, expect, it } from 'vitest'
import { demoKnowledgeBase } from '@shared/tenants/demo/knowledge-base.ts'
import { toolContext } from './_testing.ts'
import { showComparisonTool } from './show-comparison.ts'

const kb = { products: demoKnowledgeBase.products, loaded: false }

describe('show_comparison', () => {
  it('puts the named catalogue products side by side', () => {
    const outcome = showComparisonTool.run(
      {
        title: 'Current accounts',
        options: [
          { id: 'current.personal', reason: 'The everyday one.' },
          { id: 'current.basic', reason: 'The cheaper one.' },
        ],
      },
      toolContext({ kb }),
    )

    expect(outcome).toMatchObject({
      card: {
        type: 'comparison',
        title: 'Current accounts',
        options: [{ id: 'current.personal' }, { id: 'current.basic' }],
      },
    })
  })

  it('refuses an id that is not in the catalogue', () => {
    const outcome = showComparisonTool.run(
      {
        title: 'Nonsense',
        options: [
          { id: 'current.personal', reason: 'Real.' },
          { id: 'made.up', reason: 'Invented.' },
        ],
      },
      toolContext({ kb }),
    )

    expect(outcome).toMatchObject({ refused: true })
    expect(outcome).toHaveProperty('result', expect.stringContaining('made.up'))
  })
})
