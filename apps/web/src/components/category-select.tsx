import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale, useT } from "@/i18n";
import { categoryName } from "@/lib/category-name";
import { categoriesQueryOptions } from "@/lib/events";
import { hasRole, useSession } from "@/lib/session";

type CategorySelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  errors?: React.ComponentProps<typeof FieldError>["errors"];
  disabled?: boolean;
};

export function CategorySelect({ value, onValueChange, onBlur, invalid, errors, disabled }: CategorySelectProps) {
  const t = useT();
  const locale = useLocale();
  const { data: categories, isPending } = useQuery(categoriesQueryOptions);
  const { data: session } = useSession();
  const items = (categories ?? []).map((category) => ({ value: category.id, label: categoryName(category, locale) }));
  const none = !isPending && items.length === 0;

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor="categoryId">{t("shared.categorySelect.label")}</FieldLabel>
      <Select
        items={items}
        value={value || null}
        onValueChange={(next) => next && onValueChange(next)}
        disabled={disabled || none}
      >
        <SelectTrigger id="categoryId" className="w-full" aria-invalid={invalid} onBlur={onBlur}>
          <SelectValue placeholder={isPending ? t("shared.categorySelect.loading") : t("shared.categorySelect.placeholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {none && (
        <FieldDescription>
          {t("shared.categorySelect.none")}{" "}
          {hasRole(session?.user, ["admin"]) ? (
            <Link to="/dashboard/categories">{t("shared.categorySelect.add")}</Link>
          ) : (
            t("shared.categorySelect.contactAdmin")
          )}
        </FieldDescription>
      )}
      {invalid && <FieldError errors={errors} />}
    </Field>
  );
}
