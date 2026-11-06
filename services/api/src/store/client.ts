import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@shared/db/database.types.ts'

export type Db = SupabaseClient<Database>

export function createServiceClient(url: string, serviceRoleKey: string): Db {
  return createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false } })
}

/** Unwraps a query result. The message can name a table, so it only ever reaches the log. */
export function must<T>(
  result: { data: T | null; error: { message: string } | null },
  what: string,
): T {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`)
  return result.data as T
}
