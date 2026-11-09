/**
 * Runs each provider in turn and reports which failed. A provider that returns false or throws
 * is recorded and the next one still runs: one bank's page changing shape must not stop another
 * bank's data being written.
 */
export async function runProviders<P extends { readonly provider: string }>(
  providers: readonly P[],
  refresh: (provider: P) => Promise<boolean>,
  report: (message: string) => void = console.error,
): Promise<readonly string[]> {
  const failed: string[] = []
  for (const provider of providers) {
    try {
      if (!(await refresh(provider))) failed.push(provider.provider)
    } catch (error) {
      report(`${provider.provider}: ${error instanceof Error ? error.message : String(error)}`)
      failed.push(provider.provider)
    }
  }
  return failed
}
