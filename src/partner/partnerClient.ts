import { callPartnerApi } from '@/lib/saoiApi'
import { ensureAnonymousUser } from '@/lib/session'
import { partnerViewSchema, type PartnerRequest, type PartnerView } from '@contracts/partner.ts'

/** The partner gets their own anonymous session, separate from the primary customer's (§33). */
export async function callPartner(action: PartnerRequest): Promise<PartnerView> {
  await ensureAnonymousUser()
  return partnerViewSchema.parse(await callPartnerApi(action))
}
