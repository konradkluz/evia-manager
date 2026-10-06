import { Toast } from '@evia/ui-web';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const ToastContext = createContext<(message: string) => void>(() => undefined);

/** One toast at a time (styleguide § 3.14), shown above the whole panel; the live region is always in the DOM. */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const close = useCallback(() => {
    setMessage(null);
  }, []);
  return (
    <ToastContext value={setMessage}>
      {children}
      <Toast message={message} closeLabel={t('shell.closeToast')} onClose={close} />
    </ToastContext>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}
