import { CategoryChip } from "@/components/event-poster";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { ArrowLeft, MoreHorizontal, Pencil, Plus, Save, Tags, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { DataTable } from "@/components/data-table/data-table";
import type { DataTableFeatures } from "@/components/data-table/data-table-features";
import { SubmitButton, TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { t, useT, type Translate } from "@/i18n";
import { eventClient } from "@/lib/api";
import { problemMessage } from "@/lib/auth-errors";
import { categoriesQueryOptions, eventsKey, SLUG_REGEX, type Category } from "@/lib/events";
import { hasRole } from "@/lib/session";

export const Route = createFileRoute("/_authed/dashboard/categories")({
  staticData: { title: "dashboard.categories.title" },
  beforeLoad: ({ context }) => {
    if (!hasRole(context.session.user, ["admin"])) throw redirect({ to: "/dashboard" });
  },
  component: CategoriesPage,
});

const columnHelper = createColumnHelper<DataTableFeatures, Category>();

const categoryColumns = (t: Translate) =>
  columnHelper.columns([
    columnHelper.accessor("name", {
      header: t("dashboard.categories.columns.name"),
      // the chip is the colour this category's posters wear on the public pages
      cell: ({ row, getValue }) => (
        <span className="flex items-center gap-3 font-medium">
          <CategoryChip slug={row.original.slug} className="h-5 w-7" />
          {getValue()}
        </span>
      ),
    }),
    columnHelper.accessor("slug", {
      header: t("dashboard.categories.columns.slug"),
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">{t("dashboard.categories.columns.manage")}</span>,
      cell: ({ row }) => <CategoryActions category={row.original} />,
    }),
  ]);

function CategoriesPage() {
  const t = useT();
  const columns = useMemo(() => categoryColumns(t), [t]);
  const { data, isPending, isError, refetch } = useQuery(categoriesQueryOptions);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader
        icon={Tags}
        title={t("dashboard.categories.title")}
        description={t("dashboard.categories.description")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            {t("dashboard.categories.add")}
          </Button>
        }
      />
      <DataTable columns={columns} data={data ?? []} isLoading={isPending} error={isError && !data ? { onRetry: () => void refetch() } : undefined} empty={{ icon: Tags, title: t("dashboard.categories.empty") }} />
      <CategoryDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => t("dashboard.categories.validation.nameRequired") })
    .max(60, { error: () => t("dashboard.categories.validation.tooLong") }),
  slug: z
    .string()
    .trim()
    .refine((v) => v.length >= 2 && v.length <= 60 && SLUG_REGEX.test(v), {
      error: () => t("dashboard.categories.validation.slugInvalid"),
    }),
});

function CategoryDialog({
  category,
  open,
  onOpenChange,
}: {
  category?: Category;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { name: category?.name ?? "", slug: category?.slug ?? "" },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const body = { name: value.name.trim(), slug: value.slug.trim() };
      const { error } = category
        ? await eventClient.api.events.categories({ id: category.id }).patch(body)
        : await eventClient.api.events.categories.post(body);
      if (error) return void toast.add({ type: "error", title: problemMessage(error) });
      toast.add({ type: "success", title: category ? t("dashboard.categories.saved") : t("dashboard.categories.added") });
      if (!category) form.reset();
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: eventsKey });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tags className="size-5" />
              {category ? t("dashboard.categories.dialog.editTitle") : t("dashboard.categories.dialog.addTitle")}
            </DialogTitle>
            <DialogDescription>{t("dashboard.categories.dialog.description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.Field name="name">{(field) => <TextField field={field} label={t("dashboard.categories.dialog.nameLabel")} autoFocus />}</form.Field>
            <form.Field name="slug">
              {(field) => <TextField
                  field={field}
                  label={t("dashboard.categories.dialog.slugLabel")}
                  placeholder="music"
                  autoComplete="off"
                />}
            </form.Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{t("dashboard.categories.dialog.cancel")}</DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <SubmitButton pending={isSubmitting} icon={category ? Save : Plus}>
                  {category ? t("dashboard.categories.dialog.save") : t("dashboard.categories.dialog.add")}
                </SubmitButton>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryActions({ category }: { category: Category }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await eventClient.api.events.categories({ id: category.id }).delete();
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.add({ type: "success", title: t("dashboard.categories.actions.deleted", { name: category.name }) });
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: eventsKey });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.add({ type: "error", title: problemMessage(error) });
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label={t("dashboard.categories.actions.manageLabel", { name: category.name })}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil />
              {t("dashboard.categories.actions.edit")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
              <Trash2 />
              {t("dashboard.categories.actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CategoryDialog category={category} open={editOpen} onOpenChange={setEditOpen} />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("dashboard.categories.actions.confirmTitle", { name: category.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("dashboard.categories.actions.confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              <ArrowLeft data-icon="inline-start" />
              {t("dashboard.categories.actions.back")}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
              {t("dashboard.categories.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
