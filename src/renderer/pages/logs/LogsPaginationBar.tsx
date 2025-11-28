import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'

interface LogsPaginationBarProps {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

export function LogsPaginationBar({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: LogsPaginationBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
      <span>
        共 {total} 条 · 每页 {pageSize} 条 · 第 {page} / {totalPages} 页
      </span>
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-1 text-[10px] text-slate-500 sm:flex dark:text-slate-400 whitespace-nowrap">
          <span className="whitespace-nowrap">每页</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              const raw = Number(v) || 20
              const next = Math.min(100, Math.max(3, raw))
              onPageSizeChange(next)
            }}
          >
            <SelectTrigger className="h-8 w-14">
              {pageSize}
            </SelectTrigger>
            <SelectContent side="top">
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <span>条</span>
        </div>
        <Pagination className="w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={page === 1}
                className={page === 1 ? 'pointer-events-none opacity-50' : ''}
                onClick={(e) => {
                  e.preventDefault()
                  if (page > 1) onPageChange(page - 1)
                }}
              />
            </PaginationItem>

            {(() => {
              const items = [] as JSX.Element[]
              const maxButtons = 7

              const renderPage = (p: number) => (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    isActive={p === page}
                    onClick={(e) => {
                      e.preventDefault()
                      onPageChange(p)
                    }}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              )

              if (totalPages <= maxButtons) {
                for (let p = 1; p <= totalPages; p++) {
                  items.push(renderPage(p))
                }
              } else {
                const showLeftEllipsis = page > 4
                const showRightEllipsis = page < totalPages - 3

                items.push(renderPage(1))

                if (showLeftEllipsis) {
                  items.push(
                    <PaginationItem key="left-ellipsis">
                      <PaginationEllipsis />
                    </PaginationItem>,
                  )
                }

                const start = showLeftEllipsis ? page - 1 : 2
                const end = showRightEllipsis ? page + 1 : totalPages - 1

                for (let p = start; p <= end; p++) {
                  items.push(renderPage(p))
                }

                if (showRightEllipsis) {
                  items.push(
                    <PaginationItem key="right-ellipsis">
                      <PaginationEllipsis />
                    </PaginationItem>,
                  )
                }

                items.push(renderPage(totalPages))
              }

              return items
            })()}

            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={page === totalPages}
                className={page === totalPages ? 'pointer-events-none opacity-50' : ''}
                onClick={(e) => {
                  e.preventDefault()
                  if (page < totalPages) onPageChange(page + 1)
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}
