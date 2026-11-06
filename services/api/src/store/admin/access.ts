import type { Db } from '../client.ts'

/** Who may use the console. The whole protection: an anonymous visitor is never in this table. */
export interface AdminAccessStore {
  isAdmin(userId: string): Promise<boolean>
}

export function supabaseAccessStore(db: Db): AdminAccessStore {
  return {
    async isAdmin(userId) {
      const { data, error } = await db
        .from('admin_users')
        .select('auth_user_id')
        .eq('auth_user_id', userId)
        .maybeSingle()
      if (error) throw new Error(`Failed to load admin_users: ${error.message}`)
      return data !== null
    },
  }
}
