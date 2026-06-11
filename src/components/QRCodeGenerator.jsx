import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";

function QRCodeGenerator({ itemId, itemName }) {
  const [qrImage, setQrImage] = useState("");
  const barcodeRef = useRef(null);

  useEffect(() => {
    async function generateQR() {
      try {
        const itemLink = `${window.location.origin}/item/${itemId}`;
        const qrDataUrl = await QRCode.toDataURL(itemLink);
        setQrImage(qrDataUrl);
      } catch (error) {
        console.error("QR generation error:", error);
      }
    }

    generateQR();
  }, [itemId]);

  useEffect(() => {
    if (barcodeRef.current && itemId) {
      JsBarcode(barcodeRef.current, itemId, {
        format: "CODE128",
        width: 1.5,
        height: 50,
        displayValue: true,
      });
    }
  }, [itemId]);

  function downloadQR() {
    const link = document.createElement("a");
    link.href = qrImage;
    link.download = `${itemName}-QR.png`;
    link.click();
  }

  function downloadBarcode() {
    const svg = barcodeRef.current;
    const svgData = new XMLSerializer().serializeToString(svg);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = function () {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const pngFile = canvas.toDataURL("image/png");

      const link = document.createElement("a");
      link.href = pngFile;
      link.download = `${itemName}-Barcode.png`;
      link.click();
    };

    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  }

  return (
    <div>
      <div>
        <p>QR Code</p>
        {qrImage && <img src={qrImage} alt="QR Code" width="100" />}
        <br />
        <button onClick={downloadQR}>Download QR</button>
      </div>

      <br />

      <div>
        <p>Barcode</p>
        <svg ref={barcodeRef}></svg>
        <br />
        <button onClick={downloadBarcode}>Download Barcode</button>
      </div>
    </div>
  );
}

export default QRCodeGenerator;