import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import "../styles/Toast.css";

const ToastContext = createContext(null);

function createToastId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

      setToasts((previousToasts) => [
        ...previousToasts,
        {
          id,
          message,
          type,
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

      <div className="qb-toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div
            className={`qb-toast qb-toast-${toast.type}`}
            key={toast.id}
            role="status"
          >
            <span>{toast.type === "success" ? "✓" : "!"}</span>
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

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
}