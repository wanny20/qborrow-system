import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";
import "../styles/Login.css";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setIsLoading(true);
    showStatus("", "");

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      showStatus("Login successful. Redirecting to your dashboard...", "success");

      setTimeout(() => {
        navigate("/dashboard");
      }, 500);
    } catch (error) {
      console.error(error);
      showStatus("Invalid email or password. Please check your assigned account.", "error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      showStatus("Please enter your email first before resetting your password.", "error");
      return;
    }

    setIsLoading(true);
    showStatus("", "");

    try {
      await sendPasswordResetEmail(auth, email.trim());
      showStatus("Password reset email sent. Please check your inbox.", "success");
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

            <form className="login-form" onSubmit={handleLogin}>
              <div className="login-field">
                <label className="qb-label" htmlFor="email">
                  Email Address
                </label>

                <input
                  id="email"
                  type="email"
                  className="qb-input"
                  placeholder="example@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>

              <div className="login-field">
                <label className="qb-label" htmlFor="password">
                  Password
                </label>

                <div className="login-password-wrap">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className="qb-input login-password-input"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
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