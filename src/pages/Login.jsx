import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import "../styles/Login.css";
import { useToast } from "../components/ToastProvider.jsx";

function Login() {
  const navigate = useNavigate();

  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }
  function clearFieldError(fieldName) {
  setFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function validateLoginForm() {
  const errors = {};

  if (!email.trim()) {
    errors.email = "Email address is required.";
  } else if (!isValidEmail(email)) {
    errors.email = "Please enter a valid email address.";
  }

  if (!password.trim()) {
    errors.password = "Password is required.";
  }

  setFieldErrors(errors);

  return Object.keys(errors).length === 0;
}

function validateForgotPassword() {
  const errors = {};

  if (!email.trim()) {
    errors.email = "Email address is required before resetting your password.";
  } else if (!isValidEmail(email)) {
    errors.email = "Please enter a valid email address.";
  }

  setFieldErrors(errors);

  return Object.keys(errors).length === 0;
}

async function handleLogin(e) {
  e.preventDefault();
  showStatus("", "");

  const isValid = validateLoginForm();

if (!isValid) {
  return;
}

  setIsLoading(true);

  try {
const userCredential = await signInWithEmailAndPassword(
  auth,
  email.trim(),
  password
);

const userRef = doc(db, "users", userCredential.user.uid);
const userSnap = await getDoc(userRef);

if (!userSnap.exists()) {
  showStatus("No user profile found. Please contact the administrator.", "error");
  return;
}

const userData = userSnap.data();

showToast("Login successful. Redirecting...", "success");

setTimeout(() => {
  if (
    userData.termsAccepted !== true ||
    userData.mustChangePassword === true
  ) {
    navigate("/force-password-change", { replace: true });
    return;
  }

  navigate("/dashboard", { replace: true });
}, 700);

} catch (error) {
  console.error("Login error:", error);

showStatus(
  "Invalid email or password. Please check your assigned account.",
  "error"
);

} finally {
    setIsLoading(false);
  }
}
async function handleForgotPassword() {
  showStatus("", "");

  const isValid = validateForgotPassword();

if (!isValid) {
  return;
}
  setIsLoading(true);

  try {
    await sendPasswordResetEmail(auth, email.trim());
    showToast("Password reset email sent. Please check your inbox.", "success");
  } catch (error) {
    console.error(error);
    showStatus("Failed to send password reset email. Please check your email address.", "error");
  } finally {
    setIsLoading(false);
  }
}

  return (
    <main className="login-page qb-page">
      <div className="login-shape login-shape-one" aria-hidden="true"></div>
      <div className="login-shape login-shape-two" aria-hidden="true"></div>
      <div className="login-shape login-shape-three" aria-hidden="true"></div>
      <div className="login-dot-grid" aria-hidden="true"></div>

      <section className="login-shell qb-container" aria-label="QBorrow login">
        <div className="login-brand-panel">
          <button
            type="button"
            className="login-brand"
            onClick={() => navigate("/")}
            aria-label="Go back to landing page"
          >
            <span className="login-brand-logo">
              <img src="/qborrow-logo.png" alt="" />
            </span>
            <span>QBorrow</span>
          </button>

          <div className="login-hero-copy">
            <p className="qb-kicker">Admin Assigned Access</p>

            <h1 className="qb-heading">
              Scan.
              <br />
              Borrow.
              <br />
              Track.
            </h1>

            <p>
              Use the account assigned by your administrator. Borrowers,
              category admins, and super admins are managed through the system.
            </p>
          </div>

          <div className="login-role-cards" aria-label="Supported roles">
            <span>Borrower</span>
            <span>Category Admin</span>
            <span>Super Admin</span>
          </div>
        </div>

        <div className="login-form-panel">
          <div className="login-card qb-card">
            <div className="login-card-badge" aria-hidden="true">
              QB
            </div>

            <div className="login-card-header">
              <p className="qb-kicker">Account Access</p>
              <h2 className="qb-heading">Welcome back</h2>
              <p>
                Enter your assigned email and password to access your QBorrow
                dashboard.
              </p>
            </div>

            {statusMessage && (
              <div className={`login-status login-status-${statusType}`} role="status">
                {statusMessage}
              </div>
            )}

            <form className="login-form" onSubmit={handleLogin} noValidate>
              <div className="login-field">
<label className="qb-label" htmlFor="email">
  Email Address <span className="required-star">*</span>
</label>

<input
  id="email"
  type="email"
  className={`qb-input ${fieldErrors.email ? "input-error" : ""}`}
  placeholder="example@email.com"
  value={email}
  onFocus={() => clearFieldError("email")}
  onChange={(e) => {
    setEmail(e.target.value);
    clearFieldError("email");
  }}
  autoCapitalize="none"
autoCorrect="off"
spellCheck={false}
inputMode="email"
autoComplete="username"
  autoComplete="email"
  disabled={isLoading}
/>

{fieldErrors.email && (
  <p className="field-error-message">{fieldErrors.email}</p>
)}
              </div>

              <div className="login-field">
<label className="qb-label" htmlFor="password">
  Password <span className="required-star">*</span>
</label>

<div className={`login-password-wrap ${fieldErrors.password ? "input-error" : ""}`}>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className="qb-input login-password-input"
                    placeholder="Enter your password"
value={password}
onFocus={() => clearFieldError("password")}
onChange={(e) => {
  setPassword(e.target.value);
  clearFieldError("password");
}}
autoCapitalize="none"
autoCorrect="off"
spellCheck={false}
autoComplete="current-password"
disabled={isLoading}
                  />

                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {fieldErrors.password && (
  <p className="field-error-message">{fieldErrors.password}</p>
)}
              </div>

              <button
                type="button"
                className="login-forgot-btn"
                onClick={handleForgotPassword}
                disabled={isLoading}
              >
                Forgot password?
              </button>

              <button
                type="submit"
                className="qb-btn qb-btn-primary login-submit-btn"
                disabled={isLoading}
              >
                {isLoading ? "Checking..." : "Access Dashboard"}
                <span className="qb-btn-icon" aria-hidden="true">
                  →
                </span>
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

export default Login;