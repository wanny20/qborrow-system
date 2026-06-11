import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";

function QRCodeGenerator({ itemId, itemName }) {
  const qrCanvasRef = useRef(null);
  const barcodeCanvasRef = useRef(null);

  useEffect(() => {
    async function generateCodes() {
      try {
        const itemUrl = `${window.location.origin}/item/${itemId}`;

        if (qrCanvasRef.current) {
          await QRCode.toCanvas(qrCanvasRef.current, itemUrl, {
            width: 95,
            margin: 1,
          });
        }

        if (barcodeCanvasRef.current) {
          JsBarcode(barcodeCanvasRef.current, itemId, {
            format: "CODE128",
            width: 1,
            height: 38,
            displayValue: false,
            margin: 0,
          });
        }
      } catch (error) {
        console.error("Code generation failed:", error);
      }
    }

    generateCodes();
  }, [itemId]);

  function downloadCanvas(canvasRef, filename) {
    if (!canvasRef.current) return;

    const link = document.createElement("a");
    link.download = filename;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="code-generator-box">
      <div className="qr-code-area">
        <p>QR Code</p>
        <canvas ref={qrCanvasRef}></canvas>

        <button
          type="button"
          onClick={() =>
            downloadCanvas(
              qrCanvasRef,
              `${itemName || "item"}-${itemId}-qr-code.png`
            )
          }
        >
          Download QR
        </button>
      </div>

      <div className="barcode-area">
        <p>Barcode</p>
        <canvas ref={barcodeCanvasRef}></canvas>

        <button
          type="button"
          onClick={() =>
            downloadCanvas(
              barcodeCanvasRef,
              `${itemName || "item"}-${itemId}-barcode.png`
            )
          }
        >
          Download Barcode
        </button>
      </div>
    </div>
  );
}

export default QRCodeGenerator;