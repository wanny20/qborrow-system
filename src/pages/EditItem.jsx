import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
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
import { useToast } from "../components/ToastProvider.jsx";
import "../styles/EditItem.css";

function EditItem() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;
  const { showToast } = useToast();

  const [categories, setCategories] = useState([]);

  const [itemId, setItemId] = useState("");
  const [originalItem, setOriginalItem] = useState(null);

  const [itemName, setItemName] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [condition, setCondition] = useState("Good");
  const [availability, setAvailability] = useState("Available");
  const [maxBorrowDays, setMaxBorrowDays] = useState("7");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [cropSourceFile, setCropSourceFile] = useState(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);
  const [statusMessage, setStatusMessage] = useState(""); 
  const [statusType, setStatusType] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isSuperAdmin = userData?.role === "superAdmin";
  const submitLockRef = useRef(false);

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }
  function clearFieldError(fieldName) {
  setFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function validateEditItemForm() {
  const errors = {};

  if (!itemName.trim()) {
    errors.itemName = "Item name is required.";
  }

  if (!categoryId) {
    errors.categoryId = "Category is required.";
  }

  if (!maxBorrowDays || Number(maxBorrowDays) <= 0) {
    errors.maxBorrowDays = "Max borrow days must be greater than 0.";
  }

  if (!condition) {
    errors.condition = "Condition is required.";
  }

  if (!getFinalAvailability()) {
    errors.availability = "Availability is required.";
  }

  setFieldErrors(errors);

  return Object.keys(errors).length === 0;
}

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function revokePreview(url) {
    if (url && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }

  function getCategoryName(categoryIdValue) {
    const category = categories.find(
      (item) => normalizeText(item.id) === normalizeText(categoryIdValue)
    );

    return category?.name || categoryIdValue || "Unknown";
  }

  async function fetchCategories() {
    const categoriesSnapshot = await getDocs(collection(db, "categories"));

    return categoriesSnapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      .filter((category) => category.isActive !== false)
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      );
  }

  const availableCategories = useMemo(() => {
    if (!isCategoryAdmin) {
      return categories;
    }

    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.map(normalizeText)
      : [];

    return categories.filter((category) =>
      assignedCategories.includes(normalizeText(category.id))
    );
  }, [categories, userData, isCategoryAdmin]);

  function canEditCategory(targetCategoryId, targetCategoryName) {
    if (isSuperAdmin) return true;

    if (!isCategoryAdmin) return false;

    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.map(normalizeText)
      : [];

    return (
      assignedCategories.includes(normalizeText(targetCategoryId)) ||
      assignedCategories.includes(normalizeText(targetCategoryName))
    );
  }

  function getSelectedCategory() {
    return (
      availableCategories.find((category) => category.id === categoryId) ||
      categories.find((category) => category.id === categoryId) ||
      null
    );
  }

  function getFinalAvailability() {
    if (condition === "Damaged") return "Damaged";
    if (condition === "Lost") return "Lost";

    return availability;
  }

  async function fetchPageData(id) {
    setLoading(true);
    showStatus("", "");
    setIsForbidden(false);

    try {
      const [categoryData, itemSnap] = await Promise.all([
        fetchCategories(),
        getDoc(doc(db, "items", id)),
      ]);

      setCategories(categoryData);

      if (!itemSnap.exists()) {
        showStatus("Item not found.", "error");
        setLoading(false);
        return;
      }

      const item = {
        id: itemSnap.id,
        ...itemSnap.data(),
      };

      const existingCategoryId = item.categoryId || item.category || "";
      const existingCategoryName =
        item.categoryName || item.category || existingCategoryId;

      if (!canEditCategory(existingCategoryId, existingCategoryName)) {
        setIsForbidden(true);
        showStatus(
          "You are not allowed to edit this item because it is outside your assigned category.",
          "error"
        );
      }

      setOriginalItem(item);
      setItemName(item.itemName || "");
      setItemCode(item.itemCode || "");
      setDescription(item.description || "");
      setCategoryId(existingCategoryId);
      setCondition(item.condition || "Good");
      setAvailability(
        ["Available", "Reserved", "Borrowed", "Unavailable"].includes(
          item.availability
        )
          ? item.availability
          : "Available"
      );
      setMaxBorrowDays(String(item.maxBorrowDays || 7));
      setImageUrl(item.imageUrl || "");
      setImagePreview(item.imageUrl || "");
      setImageFile(null);
      setCropSourceFile(null);
    } catch (error) {
      showStatus("Error loading item: " + error.message, "error");
    } finally {
      setLoading(false);
    }
  }

function handleImageChange(event) {
  if (submitting) return;

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
      `Replacement image cropped and compressed to ${(blob.size / 1024).toFixed(
        1
      )} KB.`,
      "success"
    );
  }

  async function uploadItemImage(finalItemCode) {
    if (!imageFile) return imageUrl || "";

    const safeFileName = `${finalItemCode || itemId}-${Date.now()}.jpg`;
    const imageRef = ref(storage, `items/${safeFileName}`);

    await uploadBytes(imageRef, imageFile, {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=3600",
    });

    return getDownloadURL(imageRef);
  }

async function handleUpdateItem(e) {
  e.preventDefault();

  if (submitLockRef.current || submitting) {
    return;
  }

showStatus("", "");

const isValid = validateEditItemForm();

if (!isValid) {
  return;
}

submitLockRef.current = true;
setSubmitting(true);

let updatedSuccessfully = false;

  try {
    if (!isSuperAdmin && !isCategoryAdmin) {
      showStatus("Only super admins and category admins can edit items.", "error");
      return;
    }

    if (isForbidden) {
      showStatus("You are not allowed to edit this item.", "error");
      return;
    }

    if (categories.length === 0) {
      showStatus(
        "No categories found. Go to User Management and seed or add categories first.",
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

    if (!canEditCategory(selectedCategory.id, selectedCategory.name)) {
      showStatus("You cannot move this item to an unassigned category.", "error");
      return;
    }

    const finalItemCode = itemCode.trim() || originalItem?.itemCode || itemId;
    const finalImageUrl = await uploadItemImage(finalItemCode);
    const itemRef = doc(db, "items", itemId);

    await updateDoc(itemRef, {
      itemCode: finalItemCode,
      itemName: itemName.trim(),
      imageUrl: finalImageUrl,
      description: description.trim(),

      categoryId: selectedCategory.id,
      categoryName: selectedCategory.name,
      category: selectedCategory.id,

      condition,
      availability: getFinalAvailability(),
      maxBorrowDays: Number(maxBorrowDays),

      qrValue:
        originalItem?.qrValue ||
        `${window.location.origin}/item/${itemId}`,
      barcodeValue: originalItem?.barcodeValue || itemId,

      updatedBy: userData?.uid || auth.currentUser?.uid || "",
      updatedByEmail: userData?.email || auth.currentUser?.email || "",
      updatedAt: serverTimestamp(),
    });

    updatedSuccessfully = true;

showToast("Successfully Updated", "success");

setTimeout(() => {
  navigate("/items");
}, 700);

  } catch (error) {
    showStatus("Error updating item: " + error.message, "error");
  } finally {
    if (!updatedSuccessfully) {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }
}
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get("id");

    if (!idFromUrl) {
      showStatus("No item ID found.", "error");
      setLoading(false);
      return;
    }

    setItemId(idFromUrl);
    fetchPageData(idFromUrl);
  }, [userData]);

  const selectedCategory = getSelectedCategory();

  if (loading) {
    return (
      <div className="edit-item-loading">
        <div className="edit-item-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading item...</h2>
          <p>Preparing item details for editing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-item-page">
      {cropSourceFile && (
        <ImageCropModal
          file={cropSourceFile}
          title="Crop Replacement Image"
          outputSize={800}
          maxOutputBytes={450 * 1024}
          onCancel={() => setCropSourceFile(null)}
          onCropComplete={handleItemCropComplete}
        />
      )}

<section className="edit-item-header edit-item-header-compact">
  <div className="edit-item-header-content">
<div className="edit-item-header-text">
  <h1>Edit Item</h1>

  <span>{itemCode || itemId || "No item code"}</span>

  <p>
    Update item details, image, category, condition, availability, and
    borrowing limits.
  </p>

      {isCategoryAdmin && (
        <div className="edit-item-assigned-note">
          Assigned categories:{" "}
          {Array.isArray(userData?.assignedCategories) &&
          userData.assignedCategories.length > 0
            ? userData.assignedCategories.map(getCategoryName).join(", ")
            : "No assigned categories yet"}
        </div>
      )}
    </div>

    <button
      type="button"
      className="edit-item-secondary-btn edit-item-header-back-btn"
      onClick={() => navigate("/items")}
    >
      Back to Item List
    </button>
  </div>
</section>

      {statusMessage && (
        <div
          className={`edit-item-status edit-item-status-${statusType}`}
          role="status"
        >
          {statusMessage}
        </div>
      )}

      {isForbidden || !originalItem ? (
        <section className="edit-item-empty">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>{originalItem ? "Access denied" : "Item not found"}</h2>
          <p>
            {originalItem
              ? "This item is outside your assigned category."
              : "The item may have been deleted or the ID is invalid."}
          </p>

          <button
            type="button"
            className="edit-item-primary-btn"
            onClick={() => navigate("/items")}
          >
            Back to Items
          </button>
        </section>
      ) : (
        <section className="edit-item-layout">
          <section className="edit-item-form-card">
            <div className="edit-item-section-heading">
              <h2>Item Details</h2>
              <p>
                Changes will update the item record used by Item List, Item
                Details, scanning, borrowing, and reports.
              </p>
            </div>

            <form onSubmit={handleUpdateItem} noValidate>

              <div className="edit-item-field">
  <label className="qb-label" htmlFor="item-name">
    Item Name <span className="required-star">*</span>
  </label>

  <input
    id="item-name"
    type="text"
    className={fieldErrors.itemName ? "input-error" : ""}
    value={itemName}
    onFocus={() => clearFieldError("itemName")}
    onChange={(e) => {
      setItemName(e.target.value);
      clearFieldError("itemName");
    }}
    disabled={submitting}
    placeholder="Example: Projector"
  />

  {fieldErrors.itemName && (
    <p className="field-error-message">{fieldErrors.itemName}</p>
  )}
</div>

<div className="edit-item-field">
  <label className="qb-label" htmlFor="category">
    Category <span className="required-star">*</span>
  </label>

  {isCategoryAdmin ? (
    <div
      className={`edit-item-fixed-category-card ${
        fieldErrors.categoryId ? "input-error" : ""
      }`}
    >
      <span>Fixed Assigned Category</span>

      <strong>{selectedCategory?.name || "No assigned category"}</strong>

      <p>
        Category admins cannot manually change the item category. This item can
        only stay within your assigned category.
      </p>
    </div>
  ) : (
    <select
      id="category"
      className={fieldErrors.categoryId ? "input-error" : ""}
      value={categoryId}
      onFocus={() => clearFieldError("categoryId")}
      onChange={(e) => {
        setCategoryId(e.target.value);
        clearFieldError("categoryId");
      }}
      disabled={submitting || availableCategories.length === 0}
    >
      {availableCategories.length === 0 ? (
        <option value="">No category available</option>
      ) : (
        availableCategories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))
      )}
    </select>
  )}

  {fieldErrors.categoryId && (
    <p className="field-error-message">{fieldErrors.categoryId}</p>
  )}
</div>

              <div className="edit-item-field">
                <label className="qb-label" htmlFor="item-code">
                  Item Code
                </label>

                <input
                  id="item-code"
                  type="text"
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  disabled={submitting}
                  placeholder="Example: IT-12345"
                />
              </div>

              <div className="edit-item-field">
                <label className="qb-label" htmlFor="description">
                  Description
                </label>

                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={submitting}
                  placeholder="Describe the item..."
                />
              </div>

              <div className="edit-item-grid">

                <div className="edit-item-field">
<label className="qb-label" htmlFor="max-borrow-days">
  Max Borrow Days <span className="required-star">*</span>
</label>

<input
  id="max-borrow-days"
  type="number"
  min="1"
  className={fieldErrors.maxBorrowDays ? "input-error" : ""}
  value={maxBorrowDays}
  onFocus={() => clearFieldError("maxBorrowDays")}
  onChange={(e) => {
    setMaxBorrowDays(e.target.value);
    clearFieldError("maxBorrowDays");
  }}
  disabled={submitting}
/>

{fieldErrors.maxBorrowDays && (
  <p className="field-error-message">{fieldErrors.maxBorrowDays}</p>
)}
                </div>
              </div>

              <div className="edit-item-grid">
                <div className="edit-item-field">
                  <label className="qb-label" htmlFor="condition">
                    Condition
                  </label>

                  <select
                    id="condition"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    disabled={submitting}
                  >
                    <option value="Good">Good</option>
                    <option value="Fair">Fair</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>

                <div className="edit-item-field">
                  <label className="qb-label" htmlFor="availability">
                    Availability
                  </label>

                  <select
                    id="availability"
                    value={availability}
                    onChange={(e) => setAvailability(e.target.value)}
                    disabled={submitting || condition === "Damaged" || condition === "Lost"}
                  >
                    <option value="Available">Available</option>
                    <option value="Reserved">Reserved</option>
                    <option value="Borrowed">Borrowed</option>
                    <option value="Unavailable">Unavailable</option>
                  </select>

                  {(condition === "Damaged" || condition === "Lost") && (
                    <p>Availability will automatically become {condition}.</p>
                  )}
                </div>
              </div>

              <div className="edit-item-field">
                <label className="qb-label" htmlFor="item-image">
                  Replace Item Image
                </label>

                <input
                  id="item-image"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  disabled={submitting}
                />

                <p>
                  Optional. Upload only if you want to replace the image. The
                  new image will be cropped before uploading.
                </p>
              </div>

              <div className="edit-item-actions">
                <button
                  type="button"
                  className="edit-item-secondary-btn"
                  onClick={() => navigate(`/item/${itemId}`)}
                  disabled={submitting}
                >
                  View Item
                </button>

                <button
                  type="submit"
                  className="edit-item-primary-btn"
                  disabled={submitting || availableCategories.length === 0}
                >
                  {submitting ? "Updating..." : "Update Item"}
                </button>
              </div>
            </form>
          </section>

          <aside className="edit-item-preview-card">
            <div className="edit-item-section-heading">
              <h2>Preview</h2>
              <p>Current edited item display.</p>
            </div>

            <div className="edit-item-preview-media">
              {imagePreview ? (
                <img src={imagePreview} alt="Item preview" />
              ) : (
                <span>{(itemName || "Item").charAt(0)}</span>
              )}
            </div>

            <div className="edit-item-preview-info">
              <span>{itemCode || itemId}</span>
              <h3>{itemName || "Untitled Item"}</h3>
              <p>{description || "No description yet."}</p>

              <div className="edit-item-preview-meta">
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

              <div className="edit-item-qr-note">
                <strong>QR / Barcode</strong>
                <p>
                  QR value and barcode value are preserved. Missing values are
                  generated automatically on update.
                </p>
              </div>
            </div>
          </aside>
        </section>
      )}
    </div>
  );
}

export default EditItem;