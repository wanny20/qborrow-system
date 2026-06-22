import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { updatePassword, signOut } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import "../styles/ForcePasswordChange.css";
import { useToast } from "../components/ToastProvider.jsx";

function ForcePasswordChange() {
  const navigate = useNavigate();

  const [termsAccepted, setTermsAccepted] = useState(false);

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

if (!termsAccepted) {
  showStatus(
    "Please accept the Data Privacy Notice and System Use Agreement before continuing.",
    "error"
  );
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
            <div className="force-password-terms-box">
  <h2>Data Privacy Notice & System Use Agreement</h2>

  <div className="force-password-terms-content">
    <p>
      QBorrow stores account and borrowing information such as your name,
      email address, user type, student or employee ID, course or department,
      year and section, mobile number, item requests, approval records, release
      records, return records, and related notifications.
    </p>

    <p>
      These records are used only for managing item borrowing, tracking
      approvals, monitoring returns, generating reports, and maintaining
      accountability within the system.
    </p>

    <p>
      By using QBorrow, you agree to provide accurate borrowing information,
      follow the borrowing process, take care of borrowed items, and return
      items on or before the expected return date.
    </p>

    <p>
      You are responsible for keeping your account secure. Do not share your
      password with other users.
    </p>
  </div>

  <label className="force-password-terms-check">
    <input
      type="checkbox"
      checked={termsAccepted}
      onChange={(event) => setTermsAccepted(event.target.checked)}
      disabled={saving}
    />
    <span>
      I have read and agree to the Data Privacy Notice and System Use Agreement.
    </span>
  </label>
</div>
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