import { describe, expect, it } from 'vitest'
import { cashbackOffered, cashbackPctOf } from './cashback.ts'

describe('cashback as CCPC writes it', () => {
  it('reads a percentage written as a sign, in words, or as "per cent"', () => {
    expect(cashbackPctOf('2%')).toBe(2)
    expect(cashbackPctOf('2% of the mortgage amount')).toBe(2)
    expect(cashbackPctOf('1 percent at drawdown')).toBe(1)
    expect(cashbackPctOf('2 percent at drawdown')).toBe(2)
    expect(cashbackPctOf('1 per cent cashback on drawdown')).toBe(1)
    expect(cashbackPctOf('0.5 Percent')).toBe(0.5)
  })

  it('reads no percentage where none is stated', () => {
    expect(cashbackPctOf(null)).toBeNull()
    expect(cashbackPctOf('Yes')).toBeNull()
    expect(cashbackPctOf('€3,000 cashback')).toBeNull()
    expect(cashbackPctOf('0%')).toBeNull()
  })

  it('treats a stated percentage as cashback offered', () => {
    expect(cashbackOffered('Yes')).toBe(true)
    expect(cashbackOffered('No')).toBe(false)
    expect(cashbackOffered('N/A')).toBe(false)
    expect(cashbackOffered('2%')).toBe(true)
    expect(cashbackOffered('1 percent at drawdown')).toBe(true)
    expect(cashbackOffered('see terms')).toBeNull()
    expect(cashbackOffered(undefined)).toBeNull()
  })
})
