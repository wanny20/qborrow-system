import { useEffect, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";

function ScanQR() {
  const [scanResult, setScanResult] = useState("");

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      {
        fps: 10,
        qrbox: {
          width: 250,
          height: 250,
        },
      },
      false
    );

    scanner.render(
      (decodedText) => {
        setScanResult(decodedText);

        scanner.clear();

        if (decodedText.includes("/item/")) {
          const urlParts = decodedText.split("/item/");
          const itemId = urlParts[1];

          window.location.href = `/item/${itemId}`;
        } else {
          window.location.href = `/item/${decodedText}`;
        }
      },
      (error) => {
        console.log(error);
      }
    );

    return () => {
      scanner.clear().catch((error) => {
        console.log("Scanner clear error:", error);
      });
    };
  }, []);

  return (
    <div>
      <h1>Scan QR Code</h1>

      <p>Scan the QR code attached to the item.</p>

      <div id="qr-reader" style={{ width: "300px" }}></div>

      {scanResult && (
        <p>
          <strong>Scanned Result:</strong> {scanResult}
        </p>
      )}

      <br />

      <button onClick={() => (window.location.href = "/dashboard")}>
        Back to Dashboard
      </button>
    </div>
  );
}

export default ScanQR;