import {
  functionalUpdate,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, RotateCw, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { features, type DataTableFeatures } from "./data-table-features";

type DataTableProps<TData extends RowData> = {
  columns: ColumnDef<DataTableFeatures, TData, any>[];
  data: TData[];
  isLoading?: boolean;
  empty: { icon: LucideIcon; title: string; description?: string; action?: ReactNode };
  /**
   * Ids of columns left out when the table is narrower than 56rem (its own width, not the screen's: an open sidebar takes 16rem of a laptop). On a phone the first column stays (who/what), the last one (the row's action) sticks to the
   * edge, and what you must see to act on a row (its status) stays too; dates and totals can wait for a wider screen.
   */
  mobileHide?: string[];
  /** Ids of columns shown under the first column's cell when the table is narrow instead of as columns of their own (a row's status, a user's role). Same 56rem rule. */
  mobileFold?: string[];
  /** The list failed to load. Shown instead of the rows, so a failure is never read as "nothing here". */
  error?: { onRetry: () => void };
  /** Server-side pagination: the query owns the page state and returns the total row count. */
  pagination?: {
    state: PaginationState;
    onChange: (state: PaginationState) => void;
    rowCount: number;
  };
};

export function DataTable<TData extends RowData>({
  columns,
  data,
  isLoading,
  empty: { icon: EmptyIcon, title, description, action },
  mobileHide = [],
  mobileFold = [],
  error,
  pagination,
}: DataTableProps<TData>) {
  const t = useT();
  const table = useTable({
    features,
    columns,
    data,
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
    ...(pagination && {
      manualPagination: true,
      rowCount: pagination.rowCount,
      state: { pagination: pagination.state },
      onPaginationChange: (updater) => pagination.onChange(functionalUpdate(updater, pagination.state)),
    }),
  });

  // two stages by the table's own width: under 56rem the folded ids (status, role) move under the name; under 42rem the hidden ids
  // (dates, totals) go too. The action column hugs the right edge at every width.
  // The first column may wrap in a narrow table, so a long name or email gives way instead of running under the sticky action.
  const cellClass = (id: string, first = false) =>
    [
      mobileFold.includes(id) ? "@max-4xl/dt:hidden" : mobileHide.includes(id) ? "@max-2xl/dt:hidden" : "",
      id === "actions" ? "w-px pr-4 text-right whitespace-nowrap" : "",
      first ? "@max-4xl/dt:whitespace-normal" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  const rows = table.getRowModel().rows;
  const pageCount = Math.max(table.getPageCount(), 1);
  const { pageIndex } = table.state.pagination;

  return (
    <div data-slot="data-table" className="flex flex-col gap-4">
      <div className="@container/dt overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={cellClass(header.column.id)}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <TriangleAlert />
                      </EmptyMedia>
                      <EmptyTitle>{t("shared.dataTable.errorTitle")}</EmptyTitle>
                      <EmptyDescription>{t("shared.dataTable.errorDescription")}</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button variant="outline" onClick={error.onRetry}>
                        <RotateCw data-icon="inline-start" />
                        {t("shared.dataTable.retry")}
                      </Button>
                    </EmptyContent>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              Array.from({ length: 5 }, (_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={columns.length}>
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell, index) => (
                    <TableCell key={cell.id} className={cellClass(cell.column.id, index === 0)}>
                      <table.FlexRender cell={cell} />
                      {index === 0 && mobileFold.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 @4xl/dt:hidden">
                          {row
                            .getAllCells()
                            .filter((other) => mobileFold.includes(other.column.id))
                            .map((other) => (
                              <table.FlexRender key={other.id} cell={other} />
                            ))}
                        </div>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <EmptyIcon />
                      </EmptyMedia>
                      <EmptyTitle>{title}</EmptyTitle>
                      {description && <EmptyDescription>{description}</EmptyDescription>}
                    </EmptyHeader>
                    {action && <EmptyContent>{action}</EmptyContent>}
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">
          {t("shared.dataTable.page", { page: pageIndex + 1, total: pageCount })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronLeft data-icon="inline-start" />
          {t("shared.dataTable.previous")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          {t("shared.dataTable.next")}
          <ChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}
