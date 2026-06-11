import { useState } from "react";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";
import "../styles/Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();

    try {
      await signInWithEmailAndPassword(auth, email, password);
      alert("Login successful!");
      window.location.href = "/dashboard";
    } catch (error) {
      alert("Invalid email or password.");
      console.error(error);
    }
  }

  async function handleForgotPassword() {
    if (!email) {
      alert("Please enter your email first before clicking forgot password.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      alert("Password reset email sent. Please check your inbox.");
    } catch (error) {
      alert("Failed to send password reset email.");
      console.error(error);
    }
  }

  return (
    <div className="login-page">
      <section className="login-left">
        <div className="brand-wrapper">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" className="brand-logo" />

          <h1>QBorrow</h1>

          <p>Scan • Borrow • Track • Return</p>
        </div>
      </section>

      <section className="login-right">
        <div className="login-form-box">
          <h2>LOGIN</h2>

          <form onSubmit={handleLogin}>
            <div className="field-group">
              <label className="input-label">
                <span className="mail-icon">✉</span>
                Your Email
              </label>

              <input
                type="email"
                placeholder="Email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label className="input-label">
                <span className="lock-icon">🔒</span>
                Your Password
              </label>

              <div className="password-box">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  className="login-input password-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />

                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Show or hide password"
                >
                  👁
                </button>
              </div>
            </div>

            <button
              type="button"
              className="forgot-password"
              onClick={handleForgotPassword}
            >
              Forgot Password?
            </button>

            <button type="submit" className="login-btn">
              Login
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

export default Login;