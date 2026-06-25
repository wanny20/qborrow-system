import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { useToast } from "./ToastProvider.jsx";
import "../styles/QRCodeGenerator.css";

function QRCodeGenerator({
  itemId,
  itemName,
  itemCode,
  qrValue,
  barcodeValue,
  qrSize = 150,
  barcodeHeight = 80,
  compact = false,
}) {
  const qrCanvasRef = useRef(null);
  const barcodeCanvasRef = useRef(null);

  const { showToast } = useToast();

  const [statusMessage, setStatusMessage] = useState("");
  const [hasGenerated, setHasGenerated] = useState(false);

  function showActionError(shortMessage, error) {
  const detailedMessage = error?.message
    ? `${shortMessage}: ${error.message}`
    : shortMessage;

  console.error(shortMessage, error);
  setStatusMessage(detailedMessage);
  showToast(shortMessage, "error");
}

function showBlockedAction(message) {
  setStatusMessage(message);
  showToast(message, "error");
}

function showActionSuccess(message) {
  setStatusMessage("");
  showToast(message, "success");
}


  const finalQrValue = useMemo(() => {
    if (qrValue) return qrValue;

    if (itemId) {
      return `${window.location.origin}/item/${itemId}`;
    }

    return "";
  }, [qrValue, itemId]);

  const finalBarcodeValue = useMemo(() => {
    return barcodeValue || itemCode || itemId || "";
  }, [barcodeValue, itemCode, itemId]);

  const displayItemCode = itemCode || finalBarcodeValue || "No code";
  const displayItemName = itemName || "Untitled Item";

  function sanitizeFileName(value) {
    return String(value || "item")
      .trim()
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase();
  }

  useEffect(() => {
    async function generateCodes() {
      setStatusMessage("");
      setHasGenerated(false);

      if (!finalQrValue || !finalBarcodeValue) {
        showBlockedAction("Missing QR or barcode value.");
        return;
      }

      try {
        if (qrCanvasRef.current) {
          await QRCode.toCanvas(qrCanvasRef.current, finalQrValue, {
            width: qrSize,
            margin: 2,
            errorCorrectionLevel: "H",
            color: {
              dark: "#1E293B",
              light: "#FFFFFF",
            },
          });
        }

        if (barcodeCanvasRef.current) {
            JsBarcode(barcodeCanvasRef.current, finalBarcodeValue, {
              format: "CODE128",
              width: compact ? 1.6 : 2.4,
              height: compact ? Math.max(barcodeHeight, 64) : Math.max(barcodeHeight, 90),
              displayValue: !compact,
              font: "monospace",
              fontSize: compact ? 12 : 18,
              textMargin: compact ? 6 : 10,
              margin: compact ? 14 : 28,
              lineColor: "#000000",
              background: "#FFFFFF",
            });
        }

        setHasGenerated(true);
      } catch (error) {
        showActionError("Code generation failed", error);
      }
    }

    generateCodes();
  }, [finalQrValue, finalBarcodeValue, qrSize, barcodeHeight, compact]);

  function downloadCanvas(canvasRef, filename, successMessage) {
    if (!canvasRef.current || !hasGenerated) {
      showBlockedAction("Code is not ready yet. Please wait and try again.");
      return;
    }

    try {
      const link = document.createElement("a");
      link.download = filename;
      link.href = canvasRef.current.toDataURL("image/png");
      link.click();

      showActionSuccess(successMessage);
    } catch (error) {
      showActionError("Failed to download code", error);
    }
  }

  function handleDownloadQR() {
    downloadCanvas(
      qrCanvasRef,
      `${sanitizeFileName(displayItemName)}-${sanitizeFileName(
        displayItemCode
      )}-qr-code.png`,
      "QR Code Downloaded"
    );
  }

  function handleDownloadBarcode() {
    downloadCanvas(
      barcodeCanvasRef,
      `${sanitizeFileName(displayItemName)}-${sanitizeFileName(
        displayItemCode
      )}-barcode.png`,
      "Barcode Downloaded"
    );
  }

  function handlePrintLabel() {
    if (!qrCanvasRef.current || !barcodeCanvasRef.current || !hasGenerated) {
  showBlockedAction("Code is not ready yet. Please wait and try again.");
  return;
}

    const qrImage = qrCanvasRef.current.toDataURL("image/png");
    const barcodeImage = barcodeCanvasRef.current.toDataURL("image/png");

    const printWindow = window.open("", "_blank", "width=700,height=800");

    if (!printWindow) {
      showBlockedAction("Popup blocked. Please allow popups to print labels.");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${displayItemName} Label</title>
          <style>
            body {
              margin: 0;
              padding: 32px;
              font-family: Arial, sans-serif;
              color: #1E293B;
              background: #ffffff;
            }

            .label {
              width: 360px;
              border: 3px solid #1E293B;
              border-radius: 20px;
              padding: 20px;
              text-align: center;
            }

            h1 {
              margin: 0;
              font-size: 22px;
              line-height: 1.1;
            }

            p {
              margin: 8px 0 18px;
              font-size: 13px;
              font-weight: 700;
            }

            .qr {
              width: 150px;
              height: 150px;
              object-fit: contain;
              margin: 0 auto 18px;
            }

            .barcode {
              width: 320px;
              max-width: 100%;
              object-fit: contain;
              margin: 0 auto;
              background: #ffffff;
            }

            .note {
              margin-top: 16px;
              font-size: 11px;
              color: #64748B;
            }
          </style>
        </head>

        <body>
          <div class="label">
            <h1>${displayItemName}</h1>
            <p>${displayItemCode}</p>
            <img class="qr" src="${qrImage}" alt="QR Code" />
            <img class="barcode" src="${barcodeImage}" alt="Barcode" />
            <div class="note">Scan using QBorrow QR / Barcode Scanner</div>
          </div>

          <script>
            window.onload = function () {
              window.print();
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
    showActionSuccess("Print label opened");
  }

  return (
    <div className={`code-generator-box ${compact ? "compact" : ""}`}>
      {!compact && (
        <div className="code-generator-header">
          <div>
            <span>Scan Label</span>
            <h3>{displayItemName}</h3>
            <p>{displayItemCode}</p>
          </div>

          <strong>{hasGenerated ? "Ready" : "Generating"}</strong>
        </div>
      )}

      {statusMessage && (
        <div className="code-generator-status" role="status">
          {statusMessage}
        </div>
      )}

      <div className="code-generator-grid">
        <div className="qr-code-area">
          <div className="code-area-title">
            <span>QR</span>
            {!compact && <p>Opens item details</p>}
          </div>

          <div className="code-canvas-shell qr-shell">
            <canvas ref={qrCanvasRef}></canvas>
          </div>

          <button type="button" onClick={handleDownloadQR}>
            Download QR
          </button>
        </div>

        <div className="barcode-area">
          <div className="code-area-title">
            <span>Barcode</span>
            {!compact && <p>CODE 128 scanner value</p>}
          </div>

          <div className="code-canvas-shell barcode-shell">
            <canvas ref={barcodeCanvasRef}></canvas>
          </div>

          <button type="button" onClick={handleDownloadBarcode}>
            Download Barcode
          </button>
         </div>
      </div>

      {compact && (
        <div className="code-generator-compact-actions">
          <button
            type="button"
            className="code-generator-print-label-btn"
            onClick={handlePrintLabel}
          >
            Print Label
          </button>
        </div>
      )}

      <div className="code-generator-footer">
        {!compact && (
          <button type="button" onClick={handlePrintLabel}>
            Print Label
          </button>
        )}

        {!compact && (
          <div>
            <span>QR Value</span>
            <p>{finalQrValue || "No QR value"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default QRCodeGenerator;