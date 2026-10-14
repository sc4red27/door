'use client';

import {
  createContext, useActionState, useContext, useEffect, useRef, useTransition,
  type FormEvent, type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ActionState } from '@/lib/types';

const PendingContext = createContext(false);

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * <form> wired to a server action with inline, screen-reader-announced
 * feedback. Fields are plain server-rendered inputs passed as children.
 * Submitting by hand (instead of `action=`) keeps what the user typed when the
 * server returns a validation error.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, dispatch] = useActionState(action, null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }

  return (
    <PendingContext.Provider value={pending}>
      <form ref={formRef} onSubmit={onSubmit} className={className}>
        {children}
        <p
          role={state?.error ? 'alert' : 'status'}
          className={cn(
            'text-sm empty:hidden',
            state?.error ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {state?.error ?? state?.ok ?? ''}
        </p>
      </form>
    </PendingContext.Provider>
  );
}

/** Submit button that disables itself while its form is being sent. */
export function SubmitButton({ confirm, children, ...props }: ButtonProps & { confirm?: string }) {
  const contextPending = useContext(PendingContext);
  const { pending: statusPending } = useFormStatus();
  const pending = contextPending || statusPending;
  return (
    <Button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
