import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/LandingPage.css";

const movingQRs = [
  { id: 1, className: "moving-qr qr-lane-1" },
  { id: 2, className: "moving-qr qr-lane-2" },
  { id: 3, className: "moving-qr qr-lane-3" },
  { id: 4, className: "moving-qr qr-lane-4" },
];

const filledCells = new Set([
  1, 2, 3, 6,
  7, 9, 12,
  13, 14, 16, 17,
  20, 22, 24,
  25, 27, 28, 30,
  31, 33, 34, 35,
]);

const smashDirections = [
  ["-35px", "-38px", "-25deg"],
  ["12px", "-45px", "35deg"],
  ["45px", "-22px", "70deg"],
  ["-50px", "5px", "-60deg"],
  ["55px", "18px", "45deg"],
  ["-25px", "45px", "90deg"],
  ["20px", "55px", "-80deg"],
  ["-55px", "-20px", "40deg"],
  ["38px", "42px", "-30deg"],
  ["-15px", "-55px", "75deg"],
];

function LandingPage() {
  const [smashedQRs, setSmashedQRs] = useState([]);
  const [restartQRs, setRestartQRs] = useState({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
  });
  const navigate = useNavigate();
const [isLeaving, setIsLeaving] = useState(false);

function goToLogin() {
  setIsLeaving(true);

  setTimeout(() => {
    navigate("/login");
  }, 700);
}
  function handleSmash(id) {
    if (smashedQRs.includes(id)) return;

    setSmashedQRs((prev) => [...prev, id]);

    setTimeout(() => {
      setSmashedQRs((prev) => prev.filter((qrId) => qrId !== id));

      setRestartQRs((prev) => ({
        ...prev,
        [id]: prev[id] + 1,
      }));
    }, 800);
  }

  return (
    <div className={`landing-page ${isLeaving ? "page-fade-out" : ""}`}>
      <div className="moving-qr-wrapper">
        {movingQRs.map((qr) => (
          <button
            key={`${qr.id}-${restartQRs[qr.id]}`}
            className={qr.className}
            onClick={() => handleSmash(qr.id)}
            aria-label="Smash moving QR code"
          >
            <div
              className={`qr-inner ${
                smashedQRs.includes(qr.id) ? "qr-smash" : ""
              }`}
            >
              {Array.from({ length: 36 }).map((_, index) => {
                const direction =
                  smashDirections[index % smashDirections.length];

                return (
                  <span
                    key={index}
                    className={
                      filledCells.has(index + 1)
                        ? "qr-cell filled"
                        : "qr-cell"
                    }
                    style={{
                      "--x": direction[0],
                      "--y": direction[1],
                      "--r": direction[2],
                    }}
                  ></span>
                );
              })}
            </div>
          </button>
        ))}
      </div>

      <div className="landing-content">
        <h1>Smart Borrowing Made Easy.</h1>

        <p>
          Manage equipment, monitor availability, and process returns with a
          simple QR code scan.
          <br />
          <strong>QBorrow</strong> provides a seamless and efficient way to
          handle borrowing transactions in real time.
        </p>

<button className="get-started-btn" onClick={goToLogin}>
  Get Started
</button>
      </div>
    </div>
  );
}

export default LandingPage;