/**
 * Puts the sign-in email into the project's auth config.
 *
 * Supabase keeps these templates in the hosted project, not in the repository, which meant the
 * only copy of the email a customer actually receives lived in a settings page: nothing to
 * review, nothing in the history, and nothing to restore if the project were rebuilt. The file
 * in `supabase/templates/` is the source now and this pushes it.
 *
 * One file covers three templates. The magic link, the signup confirmation and the email change
 * are the same email with the same subject, which is what the project was already configured
 * with: a customer of this prototype only ever meets one of them, and a second wording would be
 * a second thing to keep in step for no one's benefit.
 *
 * Run: node scripts/push-auth-templates.mjs
 */

import fs from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname

const parseEnvFile = (file) =>
  Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  )

const env = parseEnvFile(`${ROOT}.env`)
const token = env.SUPABASE_ACCESS_TOKEN
const ref = env.SUPABASE_PROJECT_REF

if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be in .env')
  process.exit(1)
}

const html = fs.readFileSync(`${ROOT}supabase/templates/sign-in-link.html`, 'utf8')

/*
 * The wordmark is a hosted PNG, deliberately.
 *
 * Gmail does not render SVG at all, in any form: not a linked file, not an inline `<svg>`, not
 * a data URI. It is also the client this is read in. So the mark is rastered from the same
 * geometry the app draws, served from the Pages site, and the alt text carries the name for
 * anyone whose client blocks images. Check it is actually there before pushing: an email whose
 * logo 404s is worse than one with no logo.
 */
const image = /src="([^"]+)"/.exec(html)?.[1]
if (image) {
  const probe = await fetch(image, { method: 'HEAD' })
  if (!probe.ok) {
    console.error(`${image} returns ${String(probe.status)}. Deploy the site first.`)
    process.exit(1)
  }
  console.log(`image ok: ${image}`)
}

/*
 * The length of the code, pushed rather than clicked.
 *
 * `supabase/config.toml` has said `otp_length = 6` since the day it was generated, but that
 * file configures a local stack and the hosted project keeps its own copy. The hosted one was
 * on 8, which is its default, so the email sent eight digits into an input that accepted six
 * and nobody could sign in at all. The declared value and the live value have to be the same
 * value, so it travels with the template that quotes it.
 */
const OTP_LENGTH = 6

const body = {
  mailer_templates_magic_link_content: html,
  mailer_templates_confirmation_content: html,
  mailer_templates_email_change_content: html,
  mailer_otp_length: OTP_LENGTH,
}

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

if (!response.ok) {
  console.error(`${String(response.status)}: ${await response.text()}`)
  process.exit(1)
}

console.log(`pushed: magic link, confirmation, email change, ${String(OTP_LENGTH)}-digit code`)
