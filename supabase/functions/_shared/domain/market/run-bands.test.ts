import { describe, expect, it } from 'vitest'
import { homeCalculatorRequestSchema } from '../../contracts/market-tools.ts'
import { homeCalculator } from './home-calculator.ts'
import {
  countyOf,
  gapMonthsBand,
  homeCalculatorRun,
  incomeBand,
  priceBand,
  rentBand,
} from './run-bands.ts'

const AS_OF = '2026-11-10'

describe('income bands', () => {
  it.each([
    [0, '<40k'],
    [39_999, '<40k'],
    [40_000, '40-60k'],
    [59_999, '40-60k'],
    [60_000, '60-80k'],
    [79_999, '60-80k'],
    [80_000, '80-100k'],
    [99_999, '80-100k'],
    [100_000, '100-150k'],
    [149_999, '100-150k'],
    [150_000, '150k+'],
    [1_000_000, '150k+'],
  ])('%d is %s', (eur, band) => expect(incomeBand(eur)).toBe(band))

  it('is unknown with no income', () => expect(incomeBand(null)).toBe('unknown'))
})

describe('price bands', () => {
  it.each([
    [0, '<250k'],
    [249_999, '<250k'],
    [250_000, '250-350k'],
    [349_999, '250-350k'],
    [350_000, '350-450k'],
    [449_999, '350-450k'],
    [450_000, '450-600k'],
    [599_999, '450-600k'],
    [600_000, '600k+'],
    [2_000_000, '600k+'],
  ])('%d is %s', (eur, band) => expect(priceBand(eur)).toBe(band))

  it('is unknown with no price', () => {
    expect(priceBand(null)).toBe('unknown')
    expect(priceBand(undefined)).toBe('unknown')
  })
})

describe('gap-in-months bands', () => {
  it.each([
    [0, '0'],
    [1, '1-6'],
    [6, '1-6'],
    [7, '7-12'],
    [12, '7-12'],
    [13, '13-24'],
    [24, '13-24'],
    [25, '25-48'],
    [48, '25-48'],
    [49, '48+'],
    [120, '48+'],
  ])('%d months is %s', (months, band) => expect(gapMonthsBand(months, true)).toBe(band))

  it('is never when a figure is needed and not reached, unknown when nothing was needed', () => {
    expect(gapMonthsBand(null, true)).toBe('never')
    expect(gapMonthsBand(null, false)).toBe('unknown')
  })
})

describe('rent bands', () => {
  it.each([
    [0, '<1000'],
    [999, '<1000'],
    [1_000, '1000-1500'],
    [1_499, '1000-1500'],
    [1_500, '1500-2000'],
    [1_999, '1500-2000'],
    [2_000, '2000-2500'],
    [2_499, '2000-2500'],
    [2_500, '2500+'],
    [9_000, '2500+'],
  ])('%d is %s', (eur, band) => expect(rentBand(eur)).toBe(band))

  it('is null with no rent', () => expect(rentBand(undefined)).toBeNull())
})

describe('the county', () => {
  it('is kept only when it is on the fixed list', () => {
    expect(countyOf('cork')).toBe('cork')
    expect(countyOf('dun_laoghaire_rathdown')).toBe('dun_laoghaire_rathdown')
    expect(countyOf('12 Main Street, Cork')).toBeNull()
    expect(countyOf(undefined)).toBeNull()
  })
})

describe('the run record', () => {
  it('holds bands and the day only: no figure the customer gave', () => {
    const request = homeCalculatorRequestSchema.parse({
      depositSavedEur: 30_123,
      monthlySavingEur: 1_017,
      annualGrossIncomeEur: 61_234,
      secondIncomeEur: 40_321,
      targetPriceEur: 400_456,
      targetDate: '2028-06',
      monthlyRentEur: 1_812,
      county: 'galway',
      propertyKind: 'second_hand',
      taxPaidLastFourYearsEur: 33_333,
    })
    const result = homeCalculator(request, AS_OF)
    const row = homeCalculatorRun(request, result, AS_OF)
    expect(row).toEqual({
      ran_on: '2026-11-10',
      kind: 'home',
      income_band: '100-150k',
      gap_months_band: '13-24',
      target_met: true,
      county: 'galway',
      rent_band: '1500-2000',
      property_kind: 'second_hand',
      first_time_buyer: null,
    })
    const text = JSON.stringify(row)
    for (const figure of ['30123', '1017', '61234', '40321', '400456', '1812', '33333', '101555']) {
      expect(text).not.toContain(figure)
    }
    expect(text).not.toMatch(/T\d{2}:\d{2}/)
  })

  it('keeps an empty run as unknown bands', () => {
    const request = homeCalculatorRequestSchema.parse({})
    const row = homeCalculatorRun(request, homeCalculator(request, AS_OF), AS_OF)
    expect(row).toMatchObject({
      income_band: 'unknown',
      gap_months_band: 'unknown',
      target_met: null,
      county: null,
      rent_band: null,
      property_kind: null,
      first_time_buyer: null,
    })
  })
})
