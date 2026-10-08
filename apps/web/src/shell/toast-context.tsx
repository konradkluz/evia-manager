import { Toast, type ToastProps } from '@evia/ui-web';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type ToastAction = NonNullable<ToastProps['action']>;
type ShowToast = (message: string, action?: ToastAction) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

interface Shown {
  readonly message: string;
  readonly action: ToastAction | undefined;
}

/** One toast at a time (styleguide § 3.14), shown above the whole panel; the live region is always in the DOM. */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<Shown | null>(null);
  const show = useCallback<ShowToast>((message, action) => {
    setShown({ message, action });
  }, []);
  const close = useCallback(() => {
    setShown(null);
  }, []);
  return (
    <ToastContext value={show}>
      {children}
      <Toast
        message={shown?.message ?? null}
        {...(shown?.action === undefined ? {} : { action: shown.action })}
        closeLabel={t('shell.closeToast')}
        onClose={close}
      />
    </ToastContext>
  );
}

/** Shows a toast; an action ("Cofnij") makes it last 10 s and closes it when it runs. */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}
