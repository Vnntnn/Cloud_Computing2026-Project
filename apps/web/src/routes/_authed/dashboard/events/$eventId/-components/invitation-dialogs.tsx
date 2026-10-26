import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, MailPlus, Save } from "lucide-react";
import { z } from "zod";
import { SubmitButton, TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { eventClient } from "@/lib/api";
import { t as translate, useT, type Translate } from "@/i18n";
import { problemMessage } from "@/lib/auth-errors";
import { invitationsKey, isEmail, MAX_EMAILS_PER_INVITE, parseEmails, type Invitation } from "@/lib/invitations";

type DialogProps = { eventId: string; open: boolean; onOpenChange: (open: boolean) => void };

const inviteSchema = z.object({
  emails: z.string().superRefine((value, ctx) => {
    const emails = parseEmails(value);
    if (emails.length === 0) {
      ctx.addIssue({ code: "custom", message: translate("eventAdmin.invitations.dialog.errors.none") });
      return;
    }
    const invalid = emails.filter((email) => !isEmail(email));
    if (invalid.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: translate("eventAdmin.invitations.dialog.errors.invalid", {
          emails: invalid.slice(0, 3).join(", "),
          more: invalid.length - 3,
        }),
      });
    }
    if (emails.length > MAX_EMAILS_PER_INVITE) {
      ctx.addIssue({ code: "custom", message: translate("eventAdmin.invitations.dialog.errors.tooMany", { max: MAX_EMAILS_PER_INVITE }) });
    }
  }),
});

/** What happened to the invitation emails of a new batch, for the toast. */
function mailSummary(t: Translate, invited: Invitation[], inviteOnly: boolean) {
  if (!inviteOnly) return t("eventAdmin.invitations.dialog.mail.later");
  const unsent = invited.filter((invitation) => !invitation.notifiedAt).length;
  return unsent === 0 ? t("eventAdmin.invitations.dialog.mail.sent") : t("eventAdmin.invitations.dialog.mail.failed", { n: unsent });
}

/**
 * Invites one or many emails at once, pasted from anywhere; emails already invited are skipped.
 * `inviteOnly`: the event is published invite-only, so the service emails the invitees right away.
 */
export function InviteDialog({ eventId, inviteOnly, open, onOpenChange }: DialogProps & { inviteOnly: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { emails: "" },
    validators: { onSubmit: inviteSchema },
    onSubmit: async ({ value }) => {
      const { data, error } = await eventClient.api.events({ id: eventId }).invitations.post({
        emails: parseEmails(value.emails),
      });
      if (error) return void toast.add({ type: "error", title: problemMessage(error) });
      const skipped = data.skipped.length > 0 ? ` · ${t("eventAdmin.invitations.dialog.skipped", { n: data.skipped.length })}` : "";
      toast.add(
        data.invited.length > 0
          ? {
              type: data.invited.some((invitation) => !invitation.notifiedAt) && inviteOnly ? "warning" : "success",
              title: t("eventAdmin.invitations.dialog.invited", { n: data.invited.length }),
              description: mailSummary(t, data.invited, inviteOnly) + skipped,
            }
          : { type: "info", title: t("eventAdmin.invitations.dialog.allInvited") },
      );
      form.reset();
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: invitationsKey(eventId) });
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
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MailPlus className="size-5" />
              {t("eventAdmin.invitations.invite")}
            </DialogTitle>
            <DialogDescription>
              {t("eventAdmin.invitations.dialog.description")}{" "}
              {inviteOnly
                ? t("eventAdmin.invitations.dialog.descriptionInviteOnly")
                : t("eventAdmin.invitations.dialog.descriptionLater")}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.Field name="emails">
              {(field) => {
                const found = parseEmails(field.state.value).length;
                return (
                  <TextField
                    field={field}
                    label={t("eventAdmin.invitations.dialog.emails")}
                    multiline
                    autoFocus
                    placeholder={"somchai@example.com\nsomying@example.com"}
                    description={
                      found > 0
                        ? t("eventAdmin.invitations.dialog.found", { n: found })
                        : t("eventAdmin.invitations.dialog.emailsHint", { max: MAX_EMAILS_PER_INVITE })
                    }
                  />
                );
              }}
            </form.Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{t("eventAdmin.invitations.dialog.cancel")}</DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <SubmitButton pending={isSubmitting} icon={MailPlus}>
                  {t("eventAdmin.invitations.dialog.submit")}
                </SubmitButton>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const editSchema = z.object({ email: z.email({ error: () => translate("eventAdmin.invitations.dialog.errors.email") }) });

/** Fixes a typo in an invitation that hasn't been used yet. */
export function EditInvitationDialog({ eventId, invitation, open, onOpenChange }: DialogProps & { invitation: Invitation }) {
  const t = useT();
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { email: invitation.email },
    validators: { onSubmit: editSchema },
    onSubmit: async ({ value }) => {
      const email = value.email.trim().toLowerCase();
      if (email === invitation.email) return onOpenChange(false);
      const { error } = await eventClient.api.events({ id: eventId }).invitations({ invitationId: invitation.id }).patch({ email });
      if (error) return void toast.add({ type: "error", title: problemMessage(error) });
      toast.add({ type: "success", title: t("eventAdmin.invitations.dialog.emailSaved") });
      form.reset({ email });
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: invitationsKey(eventId) });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // reopening starts from the saved email, not an abandoned edit
        if (!next && !form.state.isSubmitting) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="size-5" />
              {t("eventAdmin.invitations.dialog.editTitle")}
            </DialogTitle>
            <DialogDescription>{t("eventAdmin.invitations.dialog.editDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.Field name="email">
              {(field) => <TextField field={field} label={t("eventAdmin.invitations.dialog.emails")} type="email" autoComplete="off" autoFocus />}
            </form.Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{t("eventAdmin.invitations.dialog.cancel")}</DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <SubmitButton pending={isSubmitting} icon={Save}>
                  {t("eventAdmin.invitations.dialog.save")}
                </SubmitButton>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
