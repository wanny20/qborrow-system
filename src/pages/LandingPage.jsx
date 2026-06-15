import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/LandingPage.css";

const qrFilledCells = new Set([
  0, 1, 2, 4, 5, 6,
  7, 10, 13,
  14, 16, 18, 20,
  22, 23, 25, 27,
  28, 30, 31, 33, 34,
  36, 38, 40,
  42, 43, 44, 46, 47, 48,
]);

const featureCards = [
  {
    number: "01",
    label: "Scan",
    title: "QR and Barcode Ready",
    description:
      "Identify school items instantly during release and return using QR code or barcode scanning.",
    tone: "violet",
  },
  {
    number: "02",
    label: "Borrow",
    title: "Cleaner Request Flow",
    description:
      "Borrowers submit requests with purpose and expected return dates while admins control approvals.",
    tone: "pink",
  },
  {
    number: "03",
    label: "Track",
    title: "Live Item Accountability",
    description:
      "Monitor available, reserved, borrowed, returned, damaged, lost, and overdue items in one place.",
    tone: "yellow",
  },
];

const workflowSteps = [
  "Borrower requests an available item",
  "Category admin approves and reserves it",
  "Admin scans before physical release",
  "Admin scans again during return",
];

function LandingPage() {
  const navigate = useNavigate();
  const [isLeaving, setIsLeaving] = useState(false);

  function goToLogin() {
    setIsLeaving(true);

    setTimeout(() => {
      navigate("/login");
    }, 650);
  }

  return (
    <main className={`landing-page qb-page ${isLeaving ? "landing-exit" : ""}`}>
      <div className="landing-confetti landing-confetti-one" aria-hidden="true"></div>
      <div className="landing-confetti landing-confetti-two" aria-hidden="true"></div>
      <div className="landing-confetti landing-confetti-three" aria-hidden="true"></div>
      <div className="landing-confetti landing-confetti-four" aria-hidden="true"></div>
      <div className="landing-dot-grid landing-dot-left" aria-hidden="true"></div>
      <div className="landing-dot-grid landing-dot-right" aria-hidden="true"></div>

<nav className="landing-navbar" aria-label="Main navigation">
  <button
    type="button"
    className="landing-brand"
    onClick={() => navigate("/")}
    aria-label="Go to QBorrow home"
  >
    <span className="landing-brand-mark">
      <img src="/qborrow-logo.png" alt="" />
    </span>
    <span>QBorrow</span>
  </button>

  <div className="landing-nav-links" aria-label="Landing page sections">
    <a href="#home">Home</a>
    <a href="#features">Features</a>
    <a href="#workflow">Workflow</a>
    <a href="#about">About</a>
  </div>
</nav>

<section className="landing-shell qb-container" aria-label="QBorrow landing page">

        <section className="landing-hero" id="home">
          <div className="landing-hero-copy">
            <p className="qb-kicker landing-kicker">
              <span aria-hidden="true">●</span>
              QR-Based Digital Borrowing System
            </p>

            <h1 className="qb-heading landing-title">
              Borrow
              <span> smarter.</span>
              <br />
              Track
              <span> faster.</span>
            </h1>

            <p className="landing-description">
              QBorrow helps schools and organizations manage item borrowing,
              QR scanning, return tracking, availability, due dates, and item
              accountability in one playful but professional digital platform.
            </p>

            <div className="landing-actions">
              <button type="button" className="qb-btn qb-btn-primary" onClick={goToLogin}>
                Get Started
                <span className="qb-btn-icon" aria-hidden="true">→</span>
              </button>

              <a href="#features" className="qb-btn qb-btn-secondary">
                Learn More
              </a>
            </div>

            <div className="landing-trust-strip" aria-label="System highlights">
              <span>Role-based</span>
              <span>Category-aware</span>
              <span>QR-powered</span>
            </div>
          </div>

          <div className="landing-visual" aria-label="QBorrow item scanning preview">
            <div className="landing-yellow-blob" aria-hidden="true"></div>

            <div className="landing-device-card">
              <div className="landing-device-header">
                <span></span>
                <span></span>
                <span></span>
              </div>

              <div className="landing-scan-status">
                <span className="qb-status-pill" data-status="available">
                  Available
                </span>
                <strong>Item Scan Detected</strong>
                <p>Projector • IT Items • Good Condition</p>
              </div>

              <div className="landing-qr-card" aria-hidden="true">
                <div className="landing-qr-grid">
                  {Array.from({ length: 49 }).map((_, index) => (
                    <span
                      key={index}
                      className={qrFilledCells.has(index) ? "landing-qr-filled" : ""}
                    ></span>
                  ))}
                </div>
              </div>

              <div className="landing-mini-dashboard">
                <div>
                  <strong>248</strong>
                  <span>Total Items</span>
                </div>
                <div>
                  <strong>36</strong>
                  <span>Borrowed</span>
                </div>
              </div>
            </div>

            <div className="landing-floating-card landing-floating-card-left">
              <strong>Pending</strong>
              <span>12 requests</span>
            </div>

            <div className="landing-floating-card landing-floating-card-right">
              <strong>Due Soon</strong>
              <span>4 returns</span>
            </div>
          </div>
        </section>

        <section className="landing-features" id="features" aria-labelledby="features-title">
          <div className="landing-section-heading">
            <p className="qb-kicker">Features</p>
            <h2 id="features-title" className="qb-heading">
              Built for actual borrowing flow.
            </h2>
          </div>

          <div className="landing-feature-grid">
            {featureCards.map((feature) => (
              <article
                className={`landing-feature-card landing-feature-${feature.tone}`}
                key={feature.number}
              >
                <div className="landing-feature-icon" aria-hidden="true">
                  {feature.label.slice(0, 2).toUpperCase()}
                </div>

                <span>{feature.number}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-workflow" id="workflow" aria-labelledby="workflow-title">
          <div className="landing-workflow-copy">
            <p className="qb-kicker">Workflow</p>
            <h2 id="workflow-title" className="qb-heading">
              From request to return, every step is recorded.
            </h2>
            <p>
              The system separates reservation from actual borrowing, so an
              approved request only becomes borrowed after the admin scans and
              physically releases the item.
            </p>
          </div>

          <ol className="landing-workflow-list">
            {workflowSteps.map((step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-about" id="about" aria-labelledby="about-title">
          <div>
            <p className="qb-kicker">About</p>
            <h2 id="about-title" className="qb-heading">
              A cleaner way to manage school resources.
            </h2>
          </div>

          <p>
            QBorrow is designed for borrowers, category admins, and super admins.
            It supports item availability, request approvals, release scanning,
            return confirmation, notifications, overdue monitoring, and reports.
          </p>
        </section>
      </section>
    </main>
  );
}

export default LandingPage;