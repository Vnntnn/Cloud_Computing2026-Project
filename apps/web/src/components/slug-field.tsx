import type { AnyFieldApi } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useT } from "@/i18n";
import { normalizeSlugInput, SLUG_REGEX, slugAvailableQueryOptions } from "@/lib/events";

type SlugFieldProps = {
  field: AnyFieldApi;
  /** the event being edited: its own slug counts as available */
  excludeId?: string;
  /** the saved slug, which needs no check */
  current?: string;
  optional?: boolean;
  disabled?: boolean;
};

/** `/events/<slug>` input that checks with the server, as you type, whether the link is free. */
export function SlugField({ field, excludeId, current, optional, disabled }: SlugFieldProps) {
  const t = useT();
  const value: string = field.state.value ?? "";
  const debounced = useDebouncedValue(value, 400);
  const wellFormed = value.length >= 3 && value.length <= 80 && SLUG_REGEX.test(value);
  const checkable = wellFormed && debounced === value && value !== current;
  const { data: available, isFetching } = useQuery({ ...slugAvailableQueryOptions(debounced, excludeId), enabled: checkable });
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  let status: React.ReactNode = null;
  let hint: React.ReactNode = optional && !value ? t("shared.slug.hintOptional") : t("shared.slug.hintFormat");
  if (value && !wellFormed) {
    hint = t("shared.slug.hintMalformed");
  } else if (value && value === current) {
    hint = t("shared.slug.hintCurrent");
  } else if (wellFormed && (isFetching || debounced !== value)) {
    status = <Spinner />;
    hint = t("shared.slug.hintChecking");
  } else if (checkable && available === true) {
    status = <CircleCheck className="text-primary dark:text-chart-2" />;
    hint = t("shared.slug.hintAvailable");
  } else if (checkable && available === false) {
    status = <CircleX className="text-destructive" />;
    hint = t("shared.slug.hintTaken");
  }
  const taken = checkable && available === false;

  return (
    <Field data-invalid={isInvalid || taken}>
      <FieldLabel htmlFor={field.name}>
        {t("shared.slug.label")}
        {optional && t("shared.slug.optional")}
      </FieldLabel>
      <InputGroup data-disabled={disabled}>
        <InputGroupAddon>
          <InputGroupText>/events/</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={field.name}
          name={field.name}
          value={value}
          placeholder="my-event"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={isInvalid || taken}
          onBlur={() => {
            // a trailing hyphen is fine while typing, not once you leave the field
            field.handleChange(value.replace(/^-+|-+$/g, ""));
            field.handleBlur();
          }}
          onChange={(e) => field.handleChange(normalizeSlugInput(e.target.value))}
        />
        {status && <InputGroupAddon align="inline-end">{status}</InputGroupAddon>}
      </InputGroup>
      {isInvalid ? <FieldError errors={field.state.meta.errors} /> : <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}
