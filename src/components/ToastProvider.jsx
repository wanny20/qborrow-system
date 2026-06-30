import { useCallback, useMemo, useState } from "react";
import { ToastContext } from "./ToastContext.jsx";
import "../styles/Toast.css";

function createToastId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getToastIcon(type) {
  if (type === "error") return "!";
  if (type === "warning") return "!";
  if (type === "info") return "i";
  return "✓";
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((previousToasts) =>
      previousToasts.filter((toast) => toast.id !== id)
    );
  }, []);

  const showToast = useCallback(
    (message, type = "success", duration = 3000) => {
      const id = createToastId();
      const safeType = ["success", "error", "warning", "info"].includes(type)
        ? type
        : "success";

      setToasts((previousToasts) => [
        ...previousToasts,
        {
          id,
          message,
          type: safeType,
        },
      ]);

      window.setTimeout(() => {
        removeToast(id);
      }, duration);
    },
    [removeToast]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="qb-toast-container" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div
            className={`qb-toast qb-toast-${toast.type}`}
            key={toast.id}
            role="status"
          >
            <span>{getToastIcon(toast.type)}</span>
            <p>{toast.message}</p>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Close notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
