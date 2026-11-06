/**
 * An IBAN that reads as one and belongs to nobody.
 *
 * The welcome card shows an account number, because an account without one is not open in any
 * sense a customer recognises. A real bank code with an invented account number is the wrong
 * way to get one: Irish account numbers are eight digits, and eight invented digits behind a
 * real bank's code are somebody's account often enough to matter (Invariant 10). So the bank
 * code is `SAOI`, which no institution is registered under, the sort code is one no branch has,
 * and the BIC says the same thing in its own alphabet.
 *
 * The check digits are real. ISO 7064 mod 97-10 is what any form validates an IBAN with, and a
 * number that failed it would be refused by the first thing it was pasted into, which is not
 * the demonstration anybody wants.
 *
 * Pure, and deterministic in the application id, so the same account shows the same number on
 * every turn without anything being stored.
 */

const COUNTRY = 'IE'
/** Four letters no bank holds. */
const BANK_CODE = 'SAOI'
/** Six digits no branch has. */
const SORT_CODE = '000000'
const ACCOUNT_DIGITS = 8

/** The identifier beside the number, in the same invented alphabet: SAOI, Ireland, Dublin. */
export const SYNTHETIC_BIC = 'SAOIIE2D'

/** Twenty-two characters: country, check digits, bank code, sort code, account number. */
export function syntheticIban(applicationId: string): string {
  const bban = `${BANK_CODE}${SORT_CODE}${accountNumber(applicationId)}`
  return `${COUNTRY}${checkDigits(bban)}${bban}`
}

/** Groups of four, which is how an IBAN is printed everywhere a person reads one. */
export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')
}

/**
 * Eight digits from the id's hex digits, by Horner's rule modulo 10^8.
 *
 * Every hex digit of the id contributes, in order, so ids that differ anywhere differ here in
 * all but a hundred-millionth of cases. Nothing more is asked of it: it is not a hash and not a
 * secret, only a stable way to turn one identifier into another.
 */
function accountNumber(applicationId: string): string {
  const modulus = 10 ** ACCOUNT_DIGITS
  let value = 0
  for (const char of applicationId.toLowerCase()) {
    const digit = parseInt(char, 16)
    if (Number.isNaN(digit)) continue
    value = (value * 16 + digit) % modulus
  }
  return String(value).padStart(ACCOUNT_DIGITS, '0')
}

/**
 * ISO 7064 mod 97-10: the remainder of the BBAN followed by the country code and "00", with
 * each letter written as two digits (A is 10), subtracted from 98. Always between 02 and 98,
 * which is what the standard promises and what some validators insist on.
 */
function checkDigits(bban: string): string {
  const remainder = mod97(`${bban}${COUNTRY}00`)
  return String(98 - remainder).padStart(2, '0')
}

/**
 * Digit by digit, because the number is thirty digits long and a double holds sixteen. The
 * remainder never exceeds 96, so `remainder * 10 + digit` never leaves safe integer range.
 */
function mod97(text: string): number {
  let remainder = 0
  for (const char of text.toUpperCase()) {
    const code = char.charCodeAt(0)
    const expanded = code >= 65 && code <= 90 ? String(code - 55) : char
    for (const digit of expanded) {
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }
  return remainder
}
