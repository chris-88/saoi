/**
 * The places a home can be, as the home-buying schemes set their price limits: the 26 counties,
 * and Dublin's four local authorities for a customer who names one. A fixed list, so a county
 * can be recorded anonymously (`calculator_runs.county`) and never as free text.
 */

export const COUNTIES = [
  'carlow',
  'cavan',
  'clare',
  'cork',
  'donegal',
  'dublin',
  'galway',
  'kerry',
  'kildare',
  'kilkenny',
  'laois',
  'leitrim',
  'limerick',
  'longford',
  'louth',
  'mayo',
  'meath',
  'monaghan',
  'offaly',
  'roscommon',
  'sligo',
  'tipperary',
  'waterford',
  'westmeath',
  'wexford',
  'wicklow',
] as const

export const DUBLIN_LOCAL_AUTHORITIES = [
  'dublin_city',
  'dun_laoghaire_rathdown',
  'fingal',
  'south_dublin',
] as const

export const LOCAL_AREAS = [...COUNTIES, ...DUBLIN_LOCAL_AUTHORITIES] as const
export type LocalArea = (typeof LOCAL_AREAS)[number]

export const AREA_NAMES: Readonly<Record<LocalArea, string>> = {
  carlow: 'Carlow',
  cavan: 'Cavan',
  clare: 'Clare',
  cork: 'Cork',
  donegal: 'Donegal',
  dublin: 'Dublin',
  galway: 'Galway',
  kerry: 'Kerry',
  kildare: 'Kildare',
  kilkenny: 'Kilkenny',
  laois: 'Laois',
  leitrim: 'Leitrim',
  limerick: 'Limerick',
  longford: 'Longford',
  louth: 'Louth',
  mayo: 'Mayo',
  meath: 'Meath',
  monaghan: 'Monaghan',
  offaly: 'Offaly',
  roscommon: 'Roscommon',
  sligo: 'Sligo',
  tipperary: 'Tipperary',
  waterford: 'Waterford',
  westmeath: 'Westmeath',
  wexford: 'Wexford',
  wicklow: 'Wicklow',
  dublin_city: 'Dublin City',
  dun_laoghaire_rathdown: 'Dún Laoghaire-Rathdown',
  fingal: 'Fingal',
  south_dublin: 'South Dublin',
}

const AREA_SET: ReadonlySet<string> = new Set(LOCAL_AREAS)

/** True only for a value on the fixed list: anything else is never recorded. */
export const isLocalArea = (value: unknown): value is LocalArea =>
  typeof value === 'string' && AREA_SET.has(value)
