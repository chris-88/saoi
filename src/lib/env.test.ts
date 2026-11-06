import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  return await import('@/lib/env')
}

describe('browser environment', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.example.test')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('requires the saoi-api URL, naming it when missing', async () => {
    vi.stubEnv('VITE_SAOI_API_URL', '')
    const env = await load()
    expect(env.isBackendConfigured).toBe(false)
    expect(env.missingEnvVars).toEqual(['VITE_SAOI_API_URL'])
    expect(env.saoiApiUrl).toBe('')
  })

  it('strips trailing slashes from the saoi-api URL', async () => {
    vi.stubEnv('VITE_SAOI_API_URL', ' https://api.example.test/ ')
    const env = await load()
    expect(env.isBackendConfigured).toBe(true)
    expect(env.saoiApiUrl).toBe('https://api.example.test')
  })
})
