import { recordFormAnswersTool } from './record-form-answers.ts'
import { recordFactsTool } from './record-facts.ts'
import { setReminderTool } from './set-reminder.ts'
import { recordHoldingTool } from './record-holding.ts'
import { showProductOptionsTool } from './show-product-options.ts'
import { showStatusTool } from './show-status.ts'
import { showConnectAccountsTool } from './show-connect-accounts.ts'
import { showAccountsTool } from './show-accounts.ts'
import { showTransferTool } from './show-transfer.ts'
import { showArrangementTool } from './show-arrangement.ts'
import { showReviewTool } from './show-review.ts'
import { showPausePromptTool } from './show-pause-prompt.ts'
import { showFormDeclarationsTool } from './show-form-declarations.ts'
import { showFormUploadTool } from './show-form-upload.ts'
import { showFormTool } from './show-form.ts'
import { showPartnerInviteTool } from './show-partner-invite.ts'
import { proposePlanTool } from './propose-plan.ts'
import { showMortgageRatesTool } from './show-mortgage-rates.ts'
import { showComparisonTool } from './show-comparison.ts'
import { showQuoteTool } from './show-quote.ts'
import { requestUploadTool } from './request-upload.ts'
import { showProductsTool } from './show-products.ts'
import { lookupProductsTool } from './lookup-products.ts'
import type { ToolName } from '@shared/llm/tools.ts'
import type { ToolModule } from './_shared.ts'

/** Every tool the model can call, by name. Adding one means adding its module here. */
export const TOOL_MODULES: { readonly [N in ToolName]: ToolModule<N> } = {
  record_form_answers: recordFormAnswersTool,
  record_facts: recordFactsTool,
  set_reminder: setReminderTool,
  record_holding: recordHoldingTool,
  show_product_options: showProductOptionsTool,
  show_status: showStatusTool,
  show_connect_accounts: showConnectAccountsTool,
  show_accounts: showAccountsTool,
  show_transfer: showTransferTool,
  show_arrangement: showArrangementTool,
  show_review: showReviewTool,
  show_pause_prompt: showPausePromptTool,
  show_form_declarations: showFormDeclarationsTool,
  show_form_upload: showFormUploadTool,
  show_form: showFormTool,
  show_partner_invite: showPartnerInviteTool,
  propose_plan: proposePlanTool,
  show_mortgage_rates: showMortgageRatesTool,
  show_comparison: showComparisonTool,
  show_quote: showQuoteTool,
  request_upload: requestUploadTool,
  show_products: showProductsTool,
  lookup_products: lookupProductsTool,
}
