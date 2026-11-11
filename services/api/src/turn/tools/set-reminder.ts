import { dueOnProblem } from '@shared/contracts/alerts.ts'
import { createReminder } from '@shared/db/alerts.ts'
import { shortDate } from '@shared/domain/market/alerts.ts'
import type { ToolModule } from './_shared.ts'

/** Today in Europe/Dublin, YYYY-MM-DD: the day a reminder's date is checked against. */
const dublinToday = (now: Date = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' })

/**
 * A date the customer gave (their fix ends, a deposit matures), kept so the alerts run can tell
 * them as it nears. Recording what they said, like `record_facts`: nothing is decided for them
 * and no card is shown. A date that has passed is refused, so Saoirse asks again.
 */
export const setReminderTool: ToolModule<'set_reminder'> = {
  name: 'set_reminder',
  async run(input, ctx) {
    const problem = dueOnProblem(input.dueOn, dublinToday())
    if (problem !== null) {
      return { result: `${problem} Ask them for the date again.`, refused: true }
    }
    try {
      const reminder = await createReminder(ctx.admin, {
        caseId: ctx.turn.caseId,
        kind: input.kind,
        label: input.label,
        dueOn: input.dueOn,
        createdBy: ctx.primary,
        actor: 'model',
      })
      return {
        result:
          `Kept: ${reminder.label}, ${shortDate(reminder.dueOn)}. Saoi sends the date with the ` +
          'market beside it 90, 60, 30 and 7 days before and on the day, in the app and by ' +
          'notification where they allowed them. Say that in one line; suggest nothing about ' +
          'what to do then.',
      }
    } catch {
      return { result: 'That date could not be kept just now.', refused: true }
    }
  },
}
