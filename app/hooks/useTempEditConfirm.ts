import { useState, useCallback, useRef } from "react";

/**
 * Hook that provides a Promise-based confirm function and dialog state
 * for the temp-edit URL confirmation portal.
 */
export function useTempEditConfirm() {
  const [visible, setVisible] = useState(false);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((): Promise<boolean> => {
    setVisible(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const onYes = useCallback(() => {
    setVisible(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const onNo = useCallback(() => {
    setVisible(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return { confirm, visible, onYes, onNo };
}
