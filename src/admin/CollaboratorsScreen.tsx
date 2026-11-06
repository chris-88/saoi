import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DownloadIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/admin/parts'
import { adminApi } from '@/admin/adminClient'
import { queryKeys } from '@/lib/queryKeys'
import { collaboratorsToCsv } from '@/admin/csv'
import type { Collaborator } from '@contracts/admin.ts'

/**
 * Who asked to work on this (§44).
 *
 * A table, because this is the one screen whose contents are meant to leave: the export is
 * the point, and a list that can be read as rows is a list that can be checked against the
 * file it produced. The CSV is built here from what is loaded, so what you see is what you
 * get, and nothing on the server has to know about spreadsheets.
 */
export function CollaboratorsScreen(): ReactNode {
  const collaborators = useQuery({
    queryKey: queryKeys.admin.collaborators(),
    queryFn: () => adminApi.listCollaborators(),
  })

  const items = useMemo(
    () =>
      [...(collaborators.data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [collaborators.data],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collaborators"
        description="People who left their details on the landing page, the explainer or the showcase's close, and said we could write to them. Questions are marked as such; each deserves a reply."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={items.length === 0}
            onClick={() => download(items)}
          >
            <DownloadIcon />
            Export CSV
          </Button>
        }
      />

      {collaborators.isError && (
        <Alert variant="destructive">
          <AlertDescription>{collaborators.error.message}</AlertDescription>
        </Alert>
      )}

      {collaborators.isPending && <Skeleton className="h-48" />}

      {collaborators.data !== undefined && items.length === 0 && (
        <Empty className="border border-dashed py-16">
          <EmptyHeader>
            <EmptyTitle>Nobody yet</EmptyTitle>
            <EmptyDescription>
              The form is on the landing page, at the foot of the explainer, and on the page the
              showcase's third QR code opens.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {items.length > 0 && (
        <Card className="py-0">
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="min-w-[18rem]">What they wrote</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="align-top">
                      <Badge variant={person.kind === 'question' ? 'secondary' : 'outline'}>
                        {person.kind === 'question' ? 'Question' : 'Work on this'}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top font-medium">{person.name}</TableCell>
                    <TableCell className="align-top">
                      <a
                        href={`mailto:${person.email}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {person.email}
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground align-top">
                      {person.organisation ?? ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground align-top">
                      {person.role ?? ''}
                    </TableCell>
                    <TableCell className="align-top text-sm whitespace-pre-wrap">
                      {person.interest}
                    </TableCell>
                    <TableCell className="text-muted-foreground align-top text-xs">
                      {person.source ?? ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground align-top text-xs whitespace-nowrap">
                      {person.createdAt.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function download(items: readonly Collaborator[]): void {
  const blob = new Blob([collaboratorsToCsv(items)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `collaborators-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
