import { useEffect, useMemo, useRef, useState } from "react";
import "../styles/ImageCropModal.css";

function ImageCropModal({
  file,
  title = "Crop Image",
  outputSize = 320,
  maxOutputBytes = 190 * 1024,
  onCancel,
  onCropComplete,
}) {
  const imageRef = useRef(null);

  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [processing, setProcessing] = useState(false);

  const [cropBoxSize, setCropBoxSize] = useState(320);

useEffect(() => {
  function updateCropBoxSize() {
    const availableWidth = window.innerWidth - 72;
    const nextSize = Math.min(320, Math.max(240, availableWidth));

    setCropBoxSize(nextSize);
  }

  updateCropBoxSize();

  window.addEventListener("resize", updateCropBoxSize);

  return () => {
    window.removeEventListener("resize", updateCropBoxSize);
  };
}, []);

  useEffect(() => {
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setImageUrl(objectUrl);
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const cropData = useMemo(() => {
    if (!imageSize.width || !imageSize.height) {
      return {
        baseScale: 1,
        displayScale: 1,
        displayWidth: cropBoxSize,
        displayHeight: cropBoxSize,
        maxOffsetX: 0,
        maxOffsetY: 0,
      };
    }

    const baseScale = Math.max(
      cropBoxSize / imageSize.width,
      cropBoxSize / imageSize.height
    );

    const displayScale = baseScale * zoom;
    const displayWidth = imageSize.width * displayScale;
    const displayHeight = imageSize.height * displayScale;

    return {
      baseScale,
      displayScale,
      displayWidth,
      displayHeight,
      maxOffsetX: Math.max(0, (displayWidth - cropBoxSize) / 2),
      maxOffsetY: Math.max(0, (displayHeight - cropBoxSize) / 2),
    };
  }, [imageSize, zoom, cropBoxSize]);

  useEffect(() => {
    setOffsetX((current) =>
      Math.min(Math.max(current, -cropData.maxOffsetX), cropData.maxOffsetX)
    );

    setOffsetY((current) =>
      Math.min(Math.max(current, -cropData.maxOffsetY), cropData.maxOffsetY)
    );
  }, [cropData.maxOffsetX, cropData.maxOffsetY]);

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          resolve(blob);
        },
        "image/jpeg",
        quality
      );
    });
  }

  async function createCroppedBlob(size, quality) {
    const image = imageRef.current;

    if (!image) {
      throw new Error("Image is not ready yet.");
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = size;
    canvas.height = size;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);

    const sourceSize = cropBoxSize / cropData.displayScale;

    let sourceX =
      ((cropData.displayWidth - cropBoxSize) / 2 - offsetX) /
      cropData.displayScale;

    let sourceY =
      ((cropData.displayHeight - cropBoxSize) / 2 - offsetY) /
      cropData.displayScale;

    sourceX = Math.max(
      0,
      Math.min(sourceX, image.naturalWidth - sourceSize)
    );

    sourceY = Math.max(
      0,
      Math.min(sourceY, image.naturalHeight - sourceSize)
    );

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      size,
      size
    );

    return canvasToBlob(canvas, quality);
  }

  async function handleConfirmCrop() {
    setProcessing(true);

    try {
      const sizeOptions = [
        outputSize,
        Math.round(outputSize * 0.85),
        Math.round(outputSize * 0.7),
      ];

      const qualityOptions = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42];

      let fallbackBlob = null;

      for (const size of sizeOptions) {
        for (const quality of qualityOptions) {
          const blob = await createCroppedBlob(size, quality);

          if (!blob) continue;

          fallbackBlob = blob;

          if (blob.size <= maxOutputBytes) {
            const previewUrl = URL.createObjectURL(blob);
            onCropComplete(blob, previewUrl);
            return;
          }
        }
      }

      if (fallbackBlob) {
        const previewUrl = URL.createObjectURL(fallbackBlob);
        onCropComplete(fallbackBlob, previewUrl);
        return;
      }

      throw new Error("Unable to crop image.");
    } catch (error) {
      alert("Crop failed: " + error.message);
    } finally {
      setProcessing(false);
    }
  }

  if (!file) return null;

  return (
    <div className="image-crop-backdrop" role="dialog" aria-modal="true">
      <div className="image-crop-modal">
        <div className="image-crop-header">
          <div>
            <p className="qb-kicker">Manual Crop</p>
            <h2>{title}</h2>
            <span>
              Move and zoom the image until the important part is centered.
            </span>
          </div>

          <button
            type="button"
            className="image-crop-close-btn"
            onClick={onCancel}
            disabled={processing}
          >
            ×
          </button>
        </div>

        <div className="image-crop-body">
          <div className="image-crop-preview-shell">
            <div
              className="image-crop-preview"
              style={{
                width: cropBoxSize,
                height: cropBoxSize,
              }}
            >
              {imageUrl && (
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt="Crop preview"
                  style={{
                    width: `${cropData.displayWidth}px`,
                    height: `${cropData.displayHeight}px`,
                    transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`,
                  }}
                  onLoad={(event) => {
                    setImageSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                  }}
                />
              )}

              <div className="image-crop-grid"></div>
            </div>
          </div>

          <div className="image-crop-controls">
            <label>
              <span>Zoom</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>

            <label>
              <span>Move Left / Right</span>
              <input
                type="range"
                min={-cropData.maxOffsetX}
                max={cropData.maxOffsetX}
                step="1"
                value={offsetX}
                onChange={(event) => setOffsetX(Number(event.target.value))}
              />
            </label>

            <label>
              <span>Move Up / Down</span>
              <input
                type="range"
                min={-cropData.maxOffsetY}
                max={cropData.maxOffsetY}
                step="1"
                value={offsetY}
                onChange={(event) => setOffsetY(Number(event.target.value))}
              />
            </label>

            <div className="image-crop-tip">
              Output: {outputSize}×{outputSize} JPEG, compressed for Firebase
              Storage.
            </div>
          </div>
        </div>

        <div className="image-crop-actions">
          <button
            type="button"
            className="image-crop-secondary-btn"
            onClick={onCancel}
            disabled={processing}
          >
            Cancel
          </button>

          <button
            type="button"
            className="image-crop-primary-btn"
            onClick={handleConfirmCrop}
            disabled={processing}
          >
            {processing ? "Cropping..." : "Use Cropped Image"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageCropModal;