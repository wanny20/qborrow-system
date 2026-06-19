import { createContext, useContext, useMemo, useState } from "react";
import "../styles/Toast.css";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  function removeToast(id) {
    setToasts((previousToasts) =>
      previousToasts.filter((toast) => toast.id !== id)
    );
  }

  function showToast(message, type = "success", duration = 3000) {
    const id = crypto.randomUUID();

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
  }

  const value = useMemo(() => ({ showToast }), []);

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