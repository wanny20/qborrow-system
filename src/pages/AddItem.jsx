import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  collection,
  addDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { auth, db, storage } from "../firebase/firebaseConfig";
import ImageCropModal from "../components/ImageCropModal";
import "../styles/AddItem.css";

const defaultCategories = [
  { id: "sports", name: "Sports Items" },
  { id: "laboratory", name: "Laboratory Items" },
  { id: "stem", name: "STEM Items" },
  { id: "it", name: "IT Items" },
];

function AddItem() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

  const [itemName, setItemName] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("sports");
  const [condition, setCondition] = useState("Good");
  const [availability, setAvailability] = useState("Available");
  const [maxBorrowDays, setMaxBorrowDays] = useState("7");

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [cropSourceFile, setCropSourceFile] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isSuperAdmin = userData?.role === "superAdmin";

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function revokePreview(url) {
    if (url && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }

  const availableCategories = useMemo(() => {
    if (!isCategoryAdmin) {
      return defaultCategories;
    }

    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.map(normalizeText)
      : [];

    return defaultCategories.filter((category) =>
      assignedCategories.includes(normalizeText(category.id))
    );
  }, [userData, isCategoryAdmin]);

  useEffect(() => {
    if (availableCategories.length === 0) {
      setCategoryId("");
      return;
    }

    const categoryExists = availableCategories.some(
      (category) => category.id === categoryId
    );

    if (!categoryExists) {
      setCategoryId(availableCategories[0].id);
    }
  }, [availableCategories, categoryId]);

  function getSelectedCategory() {
    return (
      availableCategories.find((category) => category.id === categoryId) ||
      defaultCategories.find((category) => category.id === categoryId) ||
      null
    );
  }

  function generateItemCode() {
    const selectedCategory = getSelectedCategory();
    const prefix = selectedCategory?.id
      ? selectedCategory.id.slice(0, 3).toUpperCase()
      : "QBR";

    const randomNumber = Math.floor(1000 + Math.random() * 9000);

    return `${prefix}-${Date.now().toString().slice(-5)}-${randomNumber}`;
  }

  function getFinalAvailability() {
    if (condition === "Damaged") return "Damaged";
    if (condition === "Lost") return "Lost";

    return availability;
  }

  function resetForm() {
    revokePreview(imagePreview);

    setItemName("");
    setItemCode("");
    setDescription("");
    setCondition("Good");
    setAvailability("Available");
    setMaxBorrowDays("7");
    setImageFile(null);
    setImagePreview("");
    setCropSourceFile(null);

    if (availableCategories.length > 0) {
      setCategoryId(availableCategories[0].id);
    }
  }

  function handleImageChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    showStatus("", "");

    if (!file.type.startsWith("image/")) {
      showStatus("Please upload an image file only.", "error");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      showStatus("Image is too large. Please upload an image below 8MB.", "error");
      return;
    }

    setCropSourceFile(file);
  }

  function handleItemCropComplete(blob, previewUrl) {
    revokePreview(imagePreview);

    setImageFile(blob);
    setImagePreview(previewUrl);
    setCropSourceFile(null);

    showStatus(
      `Item image cropped and compressed to ${(blob.size / 1024).toFixed(1)} KB.`,
      "success"
    );
  }

  async function uploadItemImage(finalItemCode) {
    if (!imageFile) return "";

    const safeFileName = `${finalItemCode}-${Date.now()}.jpg`;
    const imageRef = ref(storage, `items/${safeFileName}`);

    await uploadBytes(imageRef, imageFile, {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=3600",
    });

    return getDownloadURL(imageRef);
  }

  async function handleAddItem(e) {
    e.preventDefault();
    showStatus("", "");

    if (!isSuperAdmin && !isCategoryAdmin) {
      showStatus("Only super admins and category admins can add items.", "error");
      return;
    }

    if (availableCategories.length === 0) {
      showStatus(
        "You do not have assigned categories yet. Ask the super admin to assign categories first.",
        "error"
      );
      return;
    }

    if (!itemName.trim() || !categoryId) {
      showStatus("Please fill in item name and category.", "error");
      return;
    }

    if (!maxBorrowDays || Number(maxBorrowDays) <= 0) {
      showStatus("Max borrow days must be greater than 0.", "error");
      return;
    }

    const selectedCategory = getSelectedCategory();

    if (!selectedCategory) {
      showStatus("Selected category is invalid.", "error");
      return;
    }

    setSubmitting(true);

    try {
      const finalItemCode = itemCode.trim() || generateItemCode();
      const imageUrl = await uploadItemImage(finalItemCode);

      const itemRef = await addDoc(collection(db, "items"), {
        itemCode: finalItemCode,
        itemName: itemName.trim(),
        imageUrl,
        description: description.trim(),

        categoryId: selectedCategory.id,
        categoryName: selectedCategory.name,
        category: selectedCategory.id,

        condition,
        availability: getFinalAvailability(),
        maxBorrowDays: Number(maxBorrowDays),

        qrValue: "",
        barcodeValue: "",

        createdBy: userData?.uid || auth.currentUser?.uid || "",
        createdByEmail: userData?.email || auth.currentUser?.email || "",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const qrValue = `${window.location.origin}/item/${itemRef.id}`;
      const barcodeValue = itemRef.id;

      await updateDoc(itemRef, {
        qrValue,
        barcodeValue,
        updatedAt: serverTimestamp(),
      });

      showStatus("Item added successfully.", "success");
      resetForm();
    } catch (error) {
      showStatus("Error adding item: " + error.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCategory = getSelectedCategory();

  return (
    <div className="add-item-page">
      {cropSourceFile && (
        <ImageCropModal
          file={cropSourceFile}
          title="Crop Item Image"
          outputSize={800}
          maxOutputBytes={450 * 1024}
          onCancel={() => setCropSourceFile(null)}
          onCropComplete={handleItemCropComplete}
        />
      )}

      <section className="add-item-header">
        <div>
          <p className="qb-kicker">Inventory Setup</p>

          <h1>Add Item</h1>

          <p>
            Create a borrowable item record with category, condition,
            availability, image, QR value, and barcode value.
          </p>

          {isCategoryAdmin && (
            <div className="add-item-assigned-note">
              Assigned categories:{" "}
              {Array.isArray(userData?.assignedCategories) &&
              userData.assignedCategories.length > 0
                ? userData.assignedCategories.join(", ")
                : "No assigned categories yet"}
            </div>
          )}
        </div>

        <button
          type="button"
          className="add-item-secondary-btn"
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </button>
      </section>

      {statusMessage && (
        <div
          className={`add-item-status add-item-status-${statusType}`}
          role="status"
        >
          {statusMessage}
        </div>
      )}

      <section className="add-item-layout">
        <section className="add-item-form-card">
          <div className="add-item-section-heading">
            <h2>Item Information</h2>
            <p>
              Fill out the item details. The QR and barcode values are generated
              automatically after saving.
            </p>
          </div>

          <form onSubmit={handleAddItem}>
            <div className="add-item-field">
              <label className="qb-label" htmlFor="item-name">
                Item Name
              </label>

              <input
                id="item-name"
                type="text"
                placeholder="Example: Projector"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
              />
            </div>

            <div className="add-item-field">
              <label className="qb-label" htmlFor="item-code">
                Item Code
              </label>

              <input
                id="item-code"
                type="text"
                placeholder="Leave blank to auto-generate"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
              />

              <p>Example: IT-12345. Leave this blank for automatic code.</p>
            </div>

            <div className="add-item-field">
              <label className="qb-label" htmlFor="description">
                Description
              </label>

              <textarea
                id="description"
                placeholder="Describe the item, included accessories, or notes..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="add-item-grid">
              <div className="add-item-field">
                <label className="qb-label" htmlFor="category">
                  Category
                </label>

                <select
                  id="category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={availableCategories.length === 0}
                >
                  {availableCategories.length === 0 ? (
                    <option value="">No assigned category</option>
                  ) : (
                    availableCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="add-item-field">
                <label className="qb-label" htmlFor="max-borrow-days">
                  Max Borrow Days
                </label>

                <input
                  id="max-borrow-days"
                  type="number"
                  min="1"
                  value={maxBorrowDays}
                  onChange={(e) => setMaxBorrowDays(e.target.value)}
                />
              </div>
            </div>

            <div className="add-item-grid">
              <div className="add-item-field">
                <label className="qb-label" htmlFor="condition">
                  Condition
                </label>

                <select
                  id="condition"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                >
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                  <option value="Damaged">Damaged</option>
                  <option value="Lost">Lost</option>
                </select>
              </div>

              <div className="add-item-field">
                <label className="qb-label" htmlFor="availability">
                  Availability
                </label>

                <select
                  id="availability"
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value)}
                  disabled={condition === "Damaged" || condition === "Lost"}
                >
                  <option value="Available">Available</option>
                  <option value="Unavailable">Unavailable</option>
                </select>

                {(condition === "Damaged" || condition === "Lost") && (
                  <p>Availability will automatically become {condition}.</p>
                )}
              </div>
            </div>

            <div className="add-item-field">
              <label className="qb-label" htmlFor="item-image">
                Item Image
              </label>

              <input
                id="item-image"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
              />

              <p>
                Optional. The image will be manually cropped into a square and
                compressed before uploading.
              </p>
            </div>

            <div className="add-item-actions">
              <button
                type="button"
                className="add-item-secondary-btn"
                onClick={resetForm}
                disabled={submitting}
              >
                Clear
              </button>

              <button
                type="submit"
                className="add-item-primary-btn"
                disabled={submitting || availableCategories.length === 0}
              >
                {submitting ? "Saving..." : "Save Item"}
              </button>
            </div>
          </form>
        </section>

        <aside className="add-item-preview-card">
          <div className="add-item-section-heading">
            <h2>Preview</h2>
            <p>This is how the item will appear in the inventory.</p>
          </div>

          <div className="add-item-preview-media">
            {imagePreview ? (
              <img src={imagePreview} alt="Item preview" />
            ) : (
              <span>{(itemName || "Item").charAt(0)}</span>
            )}
          </div>

          <div className="add-item-preview-info">
            <span>{itemCode.trim() || "Auto-generated code"}</span>
            <h3>{itemName || "Untitled Item"}</h3>
            <p>{description || "No description yet."}</p>

            <div className="add-item-preview-meta">
              <div>
                <span>Category</span>
                <strong>{selectedCategory?.name || "No category"}</strong>
              </div>

              <div>
                <span>Condition</span>
                <strong>{condition}</strong>
              </div>

              <div>
                <span>Availability</span>
                <strong>{getFinalAvailability()}</strong>
              </div>

              <div>
                <span>Max Days</span>
                <strong>{maxBorrowDays || "0"}</strong>
              </div>
            </div>

            <div className="add-item-qr-note">
              <strong>QR / Barcode</strong>
              <p>
                QR and barcode values will be generated after the item is saved.
              </p>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

export default AddItem;