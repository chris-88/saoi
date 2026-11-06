import { syncFormApplications } from '@shared/db/form-applications.ts'
import { recordFormAnswers } from '@shared/db/record-form-answers.ts'
import { writeEvent } from '@shared/db/case-repository.ts'
import type { ToolModule } from './_shared.ts'

/*
 * The form's own questions, answered in conversation.
 *
 * Written straight through like facts are, and checked just as hard: the server
 * decides whether a field applies and whether a value is one the form offers.
 * The form application is resynced immediately so the next thing the model is
 * told about this form reflects the answer it just recorded.
 */
export const recordFormAnswersTool: ToolModule<'record_form_answers'> = {
  name: 'record_form_answers',
  async run(input, ctx) {
    const { admin, turn, primary, rejections } = ctx

    const { applicationId, answers } = input

    const outcome = await recordFormAnswers(admin, {
      caseId: turn.caseId,
      applicationId,
      participantId: primary,
      answers,
    })

    if (outcome.rejected.length > 0) {
      rejections.push({
        name: 'record_form_answers',
        error: outcome.rejected
          .map((item) => `${item.fieldId}: ${item.reason}`)
          .join('; ')
          .slice(0, 300),
      })
    }

    if (outcome.accepted.length > 0) {
      await syncFormApplications(admin, turn.caseId)
      await writeEvent(admin, {
        caseId: turn.caseId,
        type: 'form_answered',
        actor: 'customer',
        applicationId,
        payload: { fields: outcome.accepted.length },
      })
    }

    return {
      result:
        outcome.accepted.length === 0
          ? `Nothing recorded. ${outcome.rejected.map((item) => item.reason).join('; ')}`
          : `Recorded ${String(outcome.accepted.length)} answer${outcome.accepted.length === 1 ? '' : 's'}.`,
    }
  },
}
