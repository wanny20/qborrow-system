import { useEffect } from "react";
import "../styles/ConfirmActionModal.css";

function ConfirmActionModal({
  open,
  title = "Confirm Action",
  message = "Are you sure you want to continue?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;

    function handleEscape(event) {
      if (event.key === "Escape" && !loading) {
        onCancel?.();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-action-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-action-title"
      onClick={() => {
        if (!loading) {
          onCancel?.();
        }
      }}
    >
      <section
        className="confirm-action-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={
            danger
              ? "confirm-action-icon confirm-action-icon-danger"
              : "confirm-action-icon"
          }
        >
          !
        </div>

        <div className="confirm-action-text">
          <p>Confirmation Required</p>

          <h2 id="confirm-action-title">{title}</h2>

          <span>{message}</span>
        </div>

        <div className="confirm-action-actions">
          <button
            type="button"
            className="confirm-action-cancel"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelText}
          </button>

          <button
            type="button"
            className={
              danger
                ? "confirm-action-confirm confirm-action-confirm-danger"
                : "confirm-action-confirm"
            }
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Processing..." : confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}

export default ConfirmActionModal;