import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { updatePassword, signOut } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/ForcePasswordChange.css";
import { useToast } from "../components/ToastProvider.jsx";

function ForcePasswordChange() {
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [saving, setSaving] = useState(false);

  const { showToast } = useToast();

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
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

  async function handleChangePassword(event) {
    event.preventDefault();
    showStatus("", "");

    const currentUser = auth.currentUser;

    if (!currentUser) {
      showStatus("Your session expired. Please log in again.", "error");
      return;
    }

    const validationError = validatePassword(newPassword);

    if (validationError) {
      showStatus(validationError, "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      showStatus("Passwords do not match.", "error");
      return;
    }

    setSaving(true);

    try {
      await updatePassword(currentUser, newPassword);

      await updateDoc(doc(db, "users", currentUser.uid), {
        mustChangePassword: false,
        passwordChangedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

showToast("Password updated successfully. Please log in again.", "success");

setTimeout(async () => {
  await signOut(auth);
  navigate("/login", { replace: true });
}, 900);
    } catch (error) {
      console.error(error);

      if (error.code === "auth/requires-recent-login") {
        showStatus(
          "For security, please log in again using your temporary password, then change it immediately.",
          "error"
        );

        await signOut(auth);
        setTimeout(() => {
          navigate("/login", { replace: true });
        }, 1200);

        return;
      }

      showStatus("Error updating password: " + error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="force-password-page">
      <section className="force-password-card">
        <div className="force-password-brand">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <span>QBorrow</span>
        </div>

        <div className="force-password-header">
          <p className="qb-kicker">Required Security Step</p>
          <h1>Change Your Password</h1>
          <p>
            This account is using a temporary password. Create a stronger password
            before continuing to the system.
          </p>
        </div>

        {statusMessage && (
          <div className={`force-password-status status-${statusType}`} role="status">
            {statusMessage}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="force-password-form">
          <div className="force-password-field">
            <label className="qb-label" htmlFor="new-password">
              New Password
            </label>

            <input
              id="new-password"
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="force-password-field">
            <label className="qb-label" htmlFor="confirm-password">
              Confirm Password
            </label>

            <input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <button
            type="button"
            className="force-password-secondary-btn"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Hide Password" : "Show Password"}
          </button>

          <div className="force-password-rules">
            <strong>Password must have:</strong>
            <span>At least 8 characters</span>
            <span>1 uppercase letter</span>
            <span>1 number</span>
            <span>1 special character</span>
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
    </main>
  );
}

export default ForcePasswordChange;