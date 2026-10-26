import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { paymentClient } from "@/lib/api";
import { problemMessage } from "@/lib/auth-errors";
import { enrollmentsKey } from "@/lib/enrollments";

/** Starts (or resumes) the Stripe Checkout of an enrollment that waits for payment, and goes there. */
export function useCheckout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { data, error } = await paymentClient.api.payment.checkout.post({ enrollmentId });
      if (error) throw error;
      return data.url;
    },
    onSuccess: (url) => window.location.assign(url),
    onError: (error) => {
      toast.add({ type: "error", title: problemMessage(error) });
      // e.g. the hold ran out meanwhile: show the current state
      return queryClient.invalidateQueries({ queryKey: enrollmentsKey });
    },
  });
}

export function PayButton({ enrollmentId, ...props }: { enrollmentId: string } & React.ComponentProps<typeof Button>) {
  const t = useT();
  const checkout = useCheckout();
  // stays pending while the browser leaves for Stripe
  const pending = checkout.isPending || checkout.isSuccess;
  return (
    <Button {...props} disabled={pending || props.disabled} onClick={() => checkout.mutate(enrollmentId)}>
      {pending ? <Spinner data-icon="inline-start" /> : <CreditCard data-icon="inline-start" />}
      {t("shared.pay.button")}
    </Button>
  );
}
