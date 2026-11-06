import { z } from 'zod'

/**
 * A digital form definition, as the bank's own forms platform publishes it.
 *
 * Saoirse does not reimplement a product journey. It reads the definition the existing web journey
 * reads, works out which questions apply to this customer, and collects them in conversation.
 * The definition stays the contract; this is another renderer of it.
 *
 * Deliberately permissive. The real SuperSaver definition carries 499 fields and far more
 * metadata than is needed here (styling, placement, help text, analytics hooks), and a schema
 * that insisted on knowing every key would break the first time the bank published a revision.
 * What is parsed is what is used.
 */

/**
 * Every operator the published definitions use, counted rather than assumed.
 *
 * SuperSaver's 540 rules use `is` and `isnot` and nothing else, which is what this said. The
 * personal loan's 371 rules add `>` eleven times and `<` twice, and because the enum was
 * closed, the loan definition did not parse at all: the thirteen numeric rules rejected the
 * whole document. They are all comparisons against calculated amounts, deciding whether a loan
 * amount is valid for the product the customer is on.
 */
export const LOGIC_OPERATORS = ['is', 'isnot', '>', '<'] as const
export type LogicOperator = (typeof LOGIC_OPERATORS)[number]

export const conditionalRuleSchema = z.object({
  fieldId: z.union([z.string(), z.number()]).transform(String),
  operator: z.enum(LOGIC_OPERATORS),
  value: z.unknown(),
})

export const conditionalLogicSchema = z.object({
  /** `show` means the field appears when the rules pass; `hide` means it disappears. */
  actionType: z.enum(['show', 'hide']),
  /** `all` is every rule; `any` is at least one. */
  logicType: z.enum(['all', 'any']),
  rules: z.array(conditionalRuleSchema),
})

export const choiceSchema = z.object({
  text: z.string(),
  /**
   * The value the form platform expects back.
   *
   * Never the label, and never anything the model composed. A choice answer is resolved to one
   * of these or it is not an answer (§17.2 of the feature note).
   */
  value: z.string(),
  isSelected: z.boolean().optional(),
})

/**
 * The platform serialises "nothing here" as an empty string, not as null.
 *
 * Measured across the real SuperSaver definition: 418 of 499 fields carry `choices: ""`, 252
 * carry `conditionalLogic: ""`, and one carries `conditionalLogic: false`. A schema that
 * insisted on null would reject the definition outright, which is not a theory — it is what
 * happened the first time this was parsed.
 */
const blankAs = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((value) => {
    if (value === '' || value === false || value === null) return undefined
    return value
  }, inner.optional())

/**
 * Keeps a copy of the raw control beside the parsed one, so `platform` can be read from it.
 *
 * The alternative was a catch-all, which puts an index signature on `FormField` and makes
 * every typo on a field compile.
 */
const withPlatform = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    return { ...(value as Record<string, unknown>), platform: value }
  }, inner)

const fieldShape = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  type: z.string(),
  label: z.string().optional().default(''),
  isRequired: z.boolean().optional().default(false),
  description: z.string().optional().default(''),
  choices: blankAs(z.array(choiceSchema)),
  inputs: blankAs(
    z.array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        label: z.string().optional(),
      }),
    ),
  ),
  conditionalLogic: blankAs(conditionalLogicSchema),
  defaultValue: z.unknown().optional(),
  pageNumber: z.number().optional(),
  /**
   * What this field works out for itself, in the platform's own formula language.
   *
   * `{:179}+{:218}` means field 179 plus field 218. Evaluated in `calculations.ts`, never by
   * the model, because the rules that decide whether an amount is valid compare against the
   * result.
   */
  calculationFormula: z.string().optional(),
  /** The downstream mapping the bank's own platform carries. Recorded, never interpreted. */
  toscana: z.unknown().optional(),
  /**
   * The control's own configuration, kept whole.
   *
   * Custom controls carry their settings as ordinary keys on the field, and which keys depend
   * on the control: the loan's full-quote calculator declares `loanAmount: "{:255}"`,
   * `salaryNet: "{:83}+{:91}"` and ten more, its eligibility control declares
   * `ndi_calculation: "238"`, and an upload declares `maxFileSize` and `allowedExtensions`.
   * A schema listing them would have to grow for every new control type, and Zod drops what it
   * does not name, so the parsed field would silently lose the thing the control is for.
   */
  platform: z.record(z.string(), z.unknown()).optional(),
})

export const formFieldSchema = withPlatform(fieldShape)

export const formDefinitionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  fields: z.array(formFieldSchema),
  /** Transient, issued per retrieval. Travels with a submission; never shown unmasked. */
  nonce: z.string().optional(),
})

export type ConditionalLogic = z.infer<typeof conditionalLogicSchema>
export type FormChoice = z.infer<typeof choiceSchema>
export type FormField = z.infer<typeof fieldShape>
export type FormDefinition = z.infer<typeof formDefinitionSchema>
