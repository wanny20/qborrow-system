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
import { useToast } from "../components/ToastContext.jsx";
import "../styles/EditItem.css";

function EditItem() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData, setUnsavedChanges, guardedNavigate } = outletContext;
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
  const [maintenanceReason, setMaintenanceReason] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [imageFileName, setImageFileName] = useState("");
  const [cropSourceFile, setCropSourceFile] = useState(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);
  const [statusMessage, setStatusMessage] = useState(""); 
  const [statusType, setStatusType] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formTouched, setFormTouched] = useState(false);

  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isSuperAdmin = userData?.role === "superAdmin";
  const submitLockRef = useRef(false);

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  useEffect(() => {
    if (!statusMessage) {
      return undefined;
    }

    const dismissTimer = setTimeout(() => {
      setStatusMessage("");
      setStatusType("");
    }, 5000);

    return () => clearTimeout(dismissTimer);
  }, [statusMessage, statusType]);

  function showActionError(shortMessage, error) {
  const detailedMessage = error?.message
    ? `${shortMessage}: ${error.message}`
    : shortMessage;

  showStatus(detailedMessage, "error");
  showToast(shortMessage, "error");
}

function showBlockedAction(message) {
  showStatus(message, "error");
  showToast(message, "error");
}

  function clearFieldError(fieldName) {
  setFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function markFormChanged() {
  setFormTouched(true);
}

function validateEditItemForm() {
  const errors = {};
  const sanitizedName = sanitizeItemName(itemName);

  if (!sanitizedName.trim()) {
    errors.itemName = "Item name is required.";
  } else if (sanitizedName.length > 50) {
    errors.itemName = "Item name must be 50 characters or less.";
  } else if (sanitizedName !== String(itemName || "").trim()) {
    errors.itemName = "Only letters, numbers, spaces, and basic punctuation allowed.";
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

  if (
    getFinalAvailability() === "Under Maintenance" &&
    !maintenanceReason.trim()
  ) {
    errors.maintenanceReason = "Maintenance reason is required.";
  }

  setFieldErrors(errors);

  return Object.keys(errors).length === 0;
}

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getTodayDate() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;

    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  function isDamagedLostStatus(value) {
    return ["Damaged", "Lost"].includes(String(value || ""));
  }

  function isMaintenanceStatus(value) {
    return String(value || "") === "Under Maintenance";
  }

  function sanitizeItemName(value) {
    // Allow letters, numbers, spaces, periods, hyphens, apostrophes, ampersands
    // Remove emojis and other special characters
    // DO NOT trim spaces – users should be able to type spaces freely
    return String(value || "").replace(/[^\p{L}\p{N}\s.'\-&]/gu, "");
  }

  function sanitizeMaintenanceReason(value) {
    return String(value || "").replace(/[<>`]/g, "");
  }

  function getItemDamagedLostStatus(item) {
    if (!item) return "";

    if (isDamagedLostStatus(item.condition)) {
      return item.condition;
    }

    if (isDamagedLostStatus(item.availability)) {
      return item.availability;
    }

    return "";
  }

  function getAdminId() {
    return userData?.uid || auth.currentUser?.uid || "";
  }

  function getAdminEmail() {
    return userData?.email || auth.currentUser?.email || "";
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

  function validateEditItemField(fieldName) {
  setFieldErrors((previousErrors) => {
    const nextErrors = { ...previousErrors };

    if (fieldName === "itemName") {
      const sanitized = sanitizeItemName(itemName);

      if (!sanitized.trim()) {
        nextErrors.itemName = "Item name is required.";
      } else if (sanitized.length > 50) {
        nextErrors.itemName = "Item name must be 50 characters or less.";
      } else if (sanitized !== String(itemName || "").trim()) {
        nextErrors.itemName = "Only letters, numbers, spaces, and basic punctuation allowed.";
      } else {
        delete nextErrors.itemName;
      }
    }

    if (fieldName === "categoryId") {
      if (!categoryId) {
        nextErrors.categoryId = "Category is required.";
      } else {
        delete nextErrors.categoryId;
      }
    }

    if (fieldName === "maxBorrowDays") {
      if (!maxBorrowDays || Number(maxBorrowDays) <= 0) {
        nextErrors.maxBorrowDays = "Max borrow days must be greater than 0.";
      } else {
        delete nextErrors.maxBorrowDays;
      }
    }

    if (fieldName === "condition") {
      if (!condition) {
        nextErrors.condition = "Condition is required.";
      } else {
        delete nextErrors.condition;
      }
    }

    if (fieldName === "availability") {
      if (!getFinalAvailability()) {
        nextErrors.availability = "Availability is required.";
      } else {
        delete nextErrors.availability;
      }

      if (getFinalAvailability() !== "Under Maintenance") {
        delete nextErrors.maintenanceReason;
      }
    }

    if (fieldName === "maintenanceReason") {
      if (
        getFinalAvailability() === "Under Maintenance" &&
        !maintenanceReason.trim()
      ) {
        nextErrors.maintenanceReason = "Maintenance reason is required.";
      } else {
        delete nextErrors.maintenanceReason;
      }
    }

    return nextErrors;
  });
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
        [
          "Available",
          "Reserved",
          "Borrowed",
          "Under Maintenance",
          "Unavailable",
        ].includes(item.availability)
          ? item.availability
          : "Available"
      );
      setMaintenanceReason(item.maintenanceReason || "");
      setMaxBorrowDays(String(item.maxBorrowDays || 7));
      setImageUrl(item.imageUrl || "");
      setImagePreview(item.imageUrl || "");
      setImageFile(null);
      setImageFileName("");
      setCropSourceFile(null);
    } catch (error) {
      showActionError("Failed to load item", error);
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
showBlockedAction("Please upload an image file only.");
return;;
    }

    if (file.size > 5 * 1024 * 1024) {
showBlockedAction("Image is too large. Please upload an image below 5MB.");
return;
    }

    setImageFileName(file.name);
    setCropSourceFile(file);
  }

  function handleItemCropComplete(blob, previewUrl) {
    revokePreview(imagePreview);

    setImageFile(blob);
    setImagePreview(previewUrl);
    setCropSourceFile(null);
    setFormTouched(true);

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
showBlockedAction("Only super admins and category admins can edit items.");
return;
    }

    if (isForbidden) {
showBlockedAction("You are not allowed to edit this item.");
return;
    }

    if (categories.length === 0) {
showBlockedAction(
  "No categories found. Go to User Management and seed or add categories first."
);
return;
    }

    if (!itemName.trim() || !categoryId) {
showBlockedAction("Please fill in item name and category.");
return;
    }

    if (!maxBorrowDays || Number(maxBorrowDays) <= 0) {
showBlockedAction("Max borrow days must be greater than 0.");
return;
    }

    const selectedCategory = getSelectedCategory();

    if (!selectedCategory) {
showBlockedAction("Selected category is invalid.");
return;
    }

    if (!canEditCategory(selectedCategory.id, selectedCategory.name)) {
showBlockedAction("You cannot move this item to an unassigned category.");
return;
    }

    const finalItemCode = originalItem?.itemCode || itemCode || itemId;
    const finalImageUrl = await uploadItemImage(finalItemCode);
    const finalAvailability = getFinalAvailability();
    const previousDamagedLostStatus = getItemDamagedLostStatus(originalItem);
    const nextDamagedLostStatus = isDamagedLostStatus(condition)
      ? condition
      : isDamagedLostStatus(finalAvailability)
      ? finalAvailability
      : "";
    const previousMaintenanceStatus = isMaintenanceStatus(originalItem?.availability)
      ? "Under Maintenance"
      : "";
    const nextMaintenanceStatus = isMaintenanceStatus(finalAvailability)
      ? "Under Maintenance"
      : "";
    const cleanedMaintenanceReason = sanitizeMaintenanceReason(maintenanceReason);

    const itemRef = doc(db, "items", itemId);

    const itemUpdatePayload = {
      itemCode: finalItemCode,
      itemName: itemName.trim(),
      imageUrl: finalImageUrl,
      description: description.trim(),

      categoryId: selectedCategory.id,
      categoryName: selectedCategory.name,
      category: selectedCategory.id,

      condition,
      availability: finalAvailability,
      maxBorrowDays: Number(maxBorrowDays),

      qrValue:
        originalItem?.qrValue ||
        `${window.location.origin}/item/${itemId}`,
      barcodeValue: originalItem?.barcodeValue || itemId,

      updatedBy: getAdminId(),
      updatedByEmail: getAdminEmail(),
      updatedAt: serverTimestamp(),
    };

    if (nextDamagedLostStatus) {
      itemUpdatePayload.damagedLostStatus = nextDamagedLostStatus;
      itemUpdatePayload.damagedLostBy = getAdminId();
      itemUpdatePayload.damagedLostByEmail = getAdminEmail();
      itemUpdatePayload.damagedLostSource = "editItem";

      if (
        previousDamagedLostStatus !== nextDamagedLostStatus ||
        (!originalItem?.damagedLostAt && !originalItem?.damagedLostDate)
      ) {
        itemUpdatePayload.damagedLostAt = serverTimestamp();
        itemUpdatePayload.damagedLostDate = getTodayDate();
        itemUpdatePayload.damagedLostReport = `Item manually marked as ${nextDamagedLostStatus}.`;
      }
    }

    if (nextMaintenanceStatus) {
      itemUpdatePayload.maintenanceReason = cleanedMaintenanceReason;
      itemUpdatePayload.maintenanceStatus = "Under Maintenance";
      itemUpdatePayload.maintenanceSource = "editItem";
      itemUpdatePayload.maintenanceStartedBy = getAdminId();
      itemUpdatePayload.maintenanceStartedByEmail = getAdminEmail();

      if (
        previousMaintenanceStatus !== nextMaintenanceStatus ||
        (!originalItem?.maintenanceStartedAt && !originalItem?.maintenanceStartedDate)
      ) {
        itemUpdatePayload.maintenanceStartedAt = serverTimestamp();
        itemUpdatePayload.maintenanceStartedDate = getTodayDate();
      }
    }

    if (previousMaintenanceStatus && !nextMaintenanceStatus) {
      itemUpdatePayload.maintenanceResolvedAt = serverTimestamp();
      itemUpdatePayload.maintenanceResolvedBy = getAdminId();
      itemUpdatePayload.maintenanceResolvedByEmail = getAdminEmail();
      itemUpdatePayload.maintenanceStatus = "Resolved";
    }

    await updateDoc(itemRef, itemUpdatePayload);

    updatedSuccessfully = true;

setFormTouched(false);
setUnsavedChanges?.(false);

showToast("Successfully Updated", "success");

setTimeout(() => {
  navigate("/items");
}, 700);

  } catch (error) {
    showActionError("Failed to update item", error);
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
      showBlockedAction("No item ID found.");
      setLoading(false);
      return;
    }

    setItemId(idFromUrl);
    fetchPageData(idFromUrl);
  }, [userData]);

  useEffect(() => {
  setUnsavedChanges?.(
    formTouched && !submitting,
    "You have unsaved item changes. Leaving this page will discard your progress."
  );

  return () => {
    setUnsavedChanges?.(false);
  };
}, [formTouched, submitting, setUnsavedChanges]);

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
          outputSize={500}
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
      onClick={() => {
  if (guardedNavigate) {
    guardedNavigate("/items");
    return;
  }

  navigate("/items");
}}
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
          <span className="edit-item-status-text">{statusMessage}</span>

          <button
            type="button"
            className="edit-item-status-close"
            aria-label="Dismiss notification"
            onClick={() => showStatus("", "")}
          >
            &times;
          </button>
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
            onClick={() => {
  if (guardedNavigate) {
    guardedNavigate("/items");
    return;
  }

  navigate("/items");
}}
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
    maxLength={50}
    onFocus={() => clearFieldError("itemName")}
    onBlur={() => validateEditItemField("itemName")}
onChange={(e) => {
  const rawValue = e.target.value;
  const sanitized = sanitizeItemName(rawValue);

  markFormChanged();
  setItemName(sanitized);
  clearFieldError("itemName");

  if (sanitized !== rawValue && rawValue.trim()) {
    setFieldErrors((prev) => ({
      ...prev,
      itemName: "Only letters, numbers, spaces, and basic punctuation allowed.",
    }));
  }
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
      onBlur={() => validateEditItemField("categoryId")}
onChange={(e) => {
  markFormChanged();
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

              <div className="edit-item-field edit-item-code-field">
                <label className="qb-label" htmlFor="item-code">
                  Item Code
                </label>

                <div
                  id="item-code"
                  className="edit-item-fixed-code-display"
                  aria-label="Fixed item code"
                >
                  <span>{itemCode || originalItem?.itemCode || itemId}</span>
                </div>

                <p>
                  Item code is fixed and cannot be edited because it is used for
                  QR, barcode, borrowing records, and item tracking.
                </p>
              </div>

              <div className="edit-item-field edit-item-description-field">
                <label className="qb-label" htmlFor="description">
                  Description
                </label>

                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => {
  markFormChanged();
  setDescription(e.target.value);
}}
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
  onBlur={() => validateEditItemField("maxBorrowDays")}
onChange={(e) => {
  markFormChanged();
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
                    className={fieldErrors.condition ? "input-error" : ""}
                    value={condition}
                    onBlur={() => validateEditItemField("condition")}
                    onChange={(e) => {
  markFormChanged();
  setCondition(e.target.value);
  clearFieldError("condition");
  clearFieldError("availability");
}}
                    disabled={submitting}
                  >
                    <option value="Good">Good</option>
                    <option value="Fair">Fair</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Lost">Lost</option>
                  </select>
                  {fieldErrors.condition && (
  <p className="field-error-message">{fieldErrors.condition}</p>
)}
                </div>

                <div className="edit-item-field">
                  <label className="qb-label" htmlFor="availability">
                    Availability
                  </label>

                  <select
                    id="availability"
                    className={fieldErrors.availability ? "input-error" : ""}
                    value={availability}
                    onBlur={() => validateEditItemField("availability")}
                    onChange={(e) => {
  markFormChanged();
  setAvailability(e.target.value);
  clearFieldError("availability");
  clearFieldError("maintenanceReason");
}}
                    disabled={submitting || condition === "Damaged" || condition === "Lost"}
                  >
                    <option value="Available">Available</option>
                    <option value="Reserved">Reserved</option>
                    <option value="Borrowed">Borrowed</option>
                    <option value="Under Maintenance">Under Maintenance</option>
                    <option value="Unavailable">Unavailable</option>
                  </select>
                  {fieldErrors.availability && (
  <p className="field-error-message">{fieldErrors.availability}</p>
)}

                  {(condition === "Damaged" || condition === "Lost") && (
                    <p>Availability will automatically become {condition}.</p>
                  )}

                  {getFinalAvailability() === "Under Maintenance" && (
                    <p>This item cannot be borrowed until maintenance is resolved.</p>
                  )}
                </div>
              </div>

              {getFinalAvailability() === "Under Maintenance" && (
                <div className="edit-item-field edit-item-maintenance-field">
                  <label className="qb-label" htmlFor="maintenance-reason">
                    Maintenance Reason <span className="required-star">*</span>
                  </label>

                  <textarea
                    id="maintenance-reason"
                    className={fieldErrors.maintenanceReason ? "input-error" : ""}
                    placeholder="Example: Needs repair, missing cable, for inspection..."
                    value={maintenanceReason}
                    onBlur={() => validateEditItemField("maintenanceReason")}
                    onChange={(e) => {
                      markFormChanged();
                      setMaintenanceReason(sanitizeMaintenanceReason(e.target.value));
                      clearFieldError("maintenanceReason");
                    }}
                    disabled={submitting}
                  />

                  {fieldErrors.maintenanceReason && (
                    <p className="field-error-message">{fieldErrors.maintenanceReason}</p>
                  )}
                </div>
              )}

              <div className="edit-item-field edit-item-image-field">
                <label className="qb-label" htmlFor="item-image">
                  Replace Item Image
                </label>

                <div className={`qb-file-input${submitting ? " qb-file-input-disabled" : ""}`}>
                  <input
                    id="item-image"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    disabled={submitting}
                    className="qb-file-input-native"
                  />
                  <span className="qb-file-input-button">Choose File</span>
                  <span className="qb-file-input-name">
                    {imageFileName || "No file chosen"}
                  </span>
                </div>

                <p>
                  Optional. Upload only if you want to replace the image. The
                  new image will be cropped before uploading.
                </p>
              </div>

              <div className="edit-item-actions">
                <button
                  type="button"
                  className="edit-item-secondary-btn"
                  onClick={() => {
  if (guardedNavigate) {
    guardedNavigate(`/item/${itemId}`);
    return;
  }

  navigate(`/item/${itemId}`);
}}
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