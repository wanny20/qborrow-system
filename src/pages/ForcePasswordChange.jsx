import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { updatePassword, signOut } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import "../styles/ForcePasswordChange.css";

function ForcePasswordChange() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function showActionError(shortMessage, error) {
    const detailedMessage = error?.message
      ? `${shortMessage}: ${error.message}`
      : shortMessage;

    showStatus(detailedMessage, "error");
    showToast(shortMessage, "error");
  }

  function showBlockedAction(message) {
    showStatus(message, "error");
    showToast(message, "error");
  }

  function clearFieldError(fieldName) {
    setFieldErrors((previousErrors) => ({
      ...previousErrors,
      [fieldName]: "",
    }));
  }

  function validatePassword(password) {
    const hasEightCharacters = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecialCharacter = /[^A-Za-z0-9]/.test(password);

    if (!hasEightCharacters) {
      return "Password must be at least 8 characters long.";
    }

    if (!hasUppercase) {
      return "Password must contain at least 1 uppercase letter.";
    }

    if (!hasNumber) {
      return "Password must contain at least 1 number.";
    }

    if (!hasSpecialCharacter) {
      return "Password must contain at least 1 special character.";
    }

    return "";
  }

  function getPasswordStrength() {
    let score = 0;

    if (newPassword.length >= 8) score += 1;
    if (/[A-Z]/.test(newPassword)) score += 1;
    if (/[0-9]/.test(newPassword)) score += 1;
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 1;

    if (score <= 1) return "weak";
    if (score <= 3) return "medium";
    return "strong";
  }

  function validateForcePasswordField(fieldName) {
    setFieldErrors((previousErrors) => {
      const nextErrors = { ...previousErrors };

      if (fieldName === "termsAccepted") {
        if (!termsAccepted) {
          nextErrors.termsAccepted =
            "Please accept the Data Privacy Notice and System Use Agreement.";
        } else {
          delete nextErrors.termsAccepted;
        }
      }

      if (fieldName === "newPassword") {
        const validationError = validatePassword(newPassword);

        if (validationError) {
          nextErrors.newPassword = validationError;
        } else {
          delete nextErrors.newPassword;
        }

        if (confirmPassword && newPassword !== confirmPassword) {
          nextErrors.confirmPassword = "Passwords do not match.";
        } else if (confirmPassword) {
          delete nextErrors.confirmPassword;
        }
      }

      if (fieldName === "confirmPassword") {
        if (!confirmPassword.trim()) {
          nextErrors.confirmPassword = "Please confirm your new password.";
        } else if (newPassword !== confirmPassword) {
          nextErrors.confirmPassword = "Passwords do not match.";
        } else {
          delete nextErrors.confirmPassword;
        }
      }

      return nextErrors;
    });
  }

  function validateForcePasswordForm() {
    const errors = {};
    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      errors.newPassword = passwordError;
    }

    if (!confirmPassword.trim()) {
      errors.confirmPassword = "Please confirm your new password.";
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }

    if (!termsAccepted) {
      errors.termsAccepted =
        "Please accept the Data Privacy Notice and System Use Agreement.";
    }

    setFieldErrors(errors);

    return Object.keys(errors).length === 0;
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    showStatus("", "");

    const currentUser = auth.currentUser;

    if (!currentUser) {
      showBlockedAction("Your session expired. Please log in again.");
      return;
    }

    const isValid = validateForcePasswordForm();

    if (!isValid) {
      return;
    }

    setSaving(true);

    try {
      await updatePassword(currentUser, newPassword);

      await updateDoc(doc(db, "users", currentUser.uid), {
        termsAccepted: true,
        termsAcceptedAt: serverTimestamp(),
        termsVersion: "1.0",
        mustChangePassword: false,
        passwordChangedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      showToast("First-time setup completed. Please log in again.", "success");

      setTimeout(async () => {
        await signOut(auth);
        navigate("/login", { replace: true });
      }, 900);
    } catch (error) {
      console.error(error);

      if (error.code === "auth/requires-recent-login") {
        showBlockedAction(
          "For security, please log in again using your temporary password, then change it immediately."
        );

        await signOut(auth);

        setTimeout(() => {
          navigate("/login", { replace: true });
        }, 1200);

        return;
      }

      showActionError("Failed to update password", error);
    } finally {
      setSaving(false);
    }
  }

  const passwordStrength = getPasswordStrength();

  return (
    <main className="force-password-page">
      <div className="force-password-bg-orb force-password-bg-orb-one" />
      <div className="force-password-bg-orb force-password-bg-orb-two" />

      <section className="force-password-shell" aria-label="First-time password setup">
        <aside className="force-password-info-panel">
          <button
            type="button"
            className="force-password-brand"
            onClick={() => navigate("/login", { replace: true })}
            aria-label="Go to login page"
          >
            <img src="/qborrow-logo.png" alt="" />
            <span>QBorrow</span>
          </button>

          <div className="force-password-info-copy">
            <p className="qb-kicker">Required Security Step</p>
            <h1>Secure your account first.</h1>
            <p>
              Before entering QBorrow, change your temporary password and accept
              the system use agreement.
            </p>
          </div>

          <div className="force-password-security-list">
            <span>Private account access</span>
            <span>Borrowing accountability</span>
            <span>Protected profile records</span>
          </div>
        </aside>

        <section className="force-password-card">
          <div className="force-password-header">
            <p className="qb-kicker">First-time setup</p>
            <h2>Change Your Password</h2>
            <p>
              Create a stronger password before continuing to the system.
            </p>
          </div>

          {statusMessage && (
            <div
              className={`force-password-status status-${statusType}`}
              role="status"
            >
              {statusMessage}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="force-password-form" noValidate>
            <div className="force-password-terms-box">
              <div className="force-password-terms-heading">
                <span>Agreement</span>
                <h3>Data Privacy Notice & System Use Agreement</h3>
              </div>

              <div className="force-password-terms-content">
                <p>
                  QBorrow stores account and borrowing information such as your
                  name, email address, user type, student or employee ID, course
                  or department, year and section, mobile number, item requests,
                  approval records, release records, return records, and related
                  notifications.
                </p>

                <p>
                  These records are used only for managing item borrowing,
                  tracking approvals, monitoring returns, generating reports,
                  and maintaining accountability within the system.
                </p>

                <p>
                  By using QBorrow, you agree to provide accurate borrowing
                  information, follow the borrowing process, take care of
                  borrowed items, and return items on or before the expected
                  return date.
                </p>

                <p>
                  You are responsible for keeping your account secure. Do not
                  share your password with other users.
                </p>
              </div>

              <label
                className={`force-password-terms-check ${
                  fieldErrors.termsAccepted ? "input-error" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onBlur={() => validateForcePasswordField("termsAccepted")}
                  onChange={(event) => {
                    setTermsAccepted(event.target.checked);
                    clearFieldError("termsAccepted");
                  }}
                  disabled={saving}
                />
                <span>
                  I have read and agree to the Data Privacy Notice and System
                  Use Agreement.
                </span>
              </label>

              {fieldErrors.termsAccepted && (
                <p className="field-error-message">
                  {fieldErrors.termsAccepted}
                </p>
              )}
            </div>

            <div className="force-password-grid">
              <div className="force-password-field">
                <label className="qb-label" htmlFor="new-password">
                  New Password <span className="required-star">*</span>
                </label>

                <input
                  id="new-password"
                  className={fieldErrors.newPassword ? "input-error" : ""}
                  onFocus={() => clearFieldError("newPassword")}
                  onBlur={() => validateForcePasswordField("newPassword")}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    clearFieldError("newPassword");
                  }}
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={newPassword}
                  autoComplete="new-password"
                  disabled={saving}
                  required
                />

                {fieldErrors.newPassword && (
                  <p className="field-error-message">{fieldErrors.newPassword}</p>
                )}
              </div>

              <div className="force-password-field">
                <label className="qb-label" htmlFor="confirm-password">
                  Confirm Password <span className="required-star">*</span>
                </label>

                <input
                  id="confirm-password"
                  className={fieldErrors.confirmPassword ? "input-error" : ""}
                  onFocus={() => clearFieldError("confirmPassword")}
                  onBlur={() => validateForcePasswordField("confirmPassword")}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    clearFieldError("confirmPassword");
                  }}
                  type={showPassword ? "text" : "password"}
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  disabled={saving}
                  required
                />

                {fieldErrors.confirmPassword && (
                  <p className="field-error-message">
                    {fieldErrors.confirmPassword}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              className="force-password-secondary-btn"
              onClick={() => setShowPassword((current) => !current)}
              disabled={saving}
            >
              {showPassword ? "Hide Password" : "Show Password"}
            </button>

            <div className={`force-password-strength strength-${passwordStrength}`}>
              <span>Password strength</span>
              <div>
                <i />
                <i />
                <i />
              </div>
              <strong>{passwordStrength}</strong>
            </div>

            <div className="force-password-rules">
              <strong>Password must have:</strong>
              <span className={newPassword.length >= 8 ? "valid" : ""}>
                At least 8 characters
              </span>
              <span className={/[A-Z]/.test(newPassword) ? "valid" : ""}>
                1 uppercase letter
              </span>
              <span className={/[0-9]/.test(newPassword) ? "valid" : ""}>
                1 number
              </span>
              <span className={/[^A-Za-z0-9]/.test(newPassword) ? "valid" : ""}>
                1 special character
              </span>
            </div>

            <button
              type="submit"
              className="force-password-primary-btn"
              disabled={saving}
            >
              {saving ? "Updating..." : "Update Password"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

export default ForcePasswordChange;
