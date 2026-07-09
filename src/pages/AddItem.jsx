import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  collection,
  addDoc,
  updateDoc,
  getDocs,
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
import "../styles/AddItem.css";

function AddItem() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData, setUnsavedChanges, guardedNavigate } = outletContext;
  const { showToast } = useToast();

  const [categories, setCategories] = useState([]);

  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [condition, setCondition] = useState("Good");
  const [availability, setAvailability] = useState("Available");
  const [maxBorrowDays, setMaxBorrowDays] = useState("7");
  const [bulkQuantity, setBulkQuantity] = useState("1");
  const [maintenanceReason, setMaintenanceReason] = useState("");

  const [formTouched, setFormTouched] = useState(false);

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [cropSourceFile, setCropSourceFile] = useState(null);

  const [loadingCategories, setLoadingCategories] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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

function sanitizeItemName(value) {
  // Allow letters, numbers, spaces, periods, hyphens, apostrophes, ampersands
  // Remove emojis and other special characters
  // DO NOT trim spaces – users should be able to type spaces freely
  return String(value || "").replace(/[^\p{L}\p{N}\s.'\-&]/gu, "");
}

function sanitizeDescription(value) {
  // Keep only printable characters (ASCII printable + Unicode letters, numbers, punctuation, spaces)
  // This removes all control characters without needing to list them.
  return String(value || "")
    .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

  function clearFieldError(fieldName) {
    setFieldErrors((previousErrors) => ({
      ...previousErrors,
      [fieldName]: "",
    }));
  }

  function validateAddItemForm() {
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

    if (!bulkQuantity || Number(bulkQuantity) <= 0) {
      errors.bulkQuantity = "Quantity must be at least 1.";
    } else if (Number(bulkQuantity) > 100) {
      errors.bulkQuantity = "Quantity cannot exceed 100 items per batch.";
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

  function sanitizeMaintenanceReason(value) {
    return String(value || "").replace(/[<>`]/g, "").trim();
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

  async function fetchCategories() {
    setLoadingCategories(true);

    try {
      const categoriesSnapshot = await getDocs(collection(db, "categories"));

      const categoryData = categoriesSnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter((category) => category.isActive !== false)
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""))
        );

      setCategories(categoryData);
    } catch (error) {
      showActionError("Failed to load categories", error);
    } finally {
      setLoadingCategories(false);
    }
  }

  const availableCategories = useMemo(() => {
    if (!isCategoryAdmin) {
      return categories;
    }

    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.map(normalizeText)
      : [];

    return categories.filter((category) => {
      const categoryIdValue = normalizeText(category.id);
      const categoryNameValue = normalizeText(category.name);

      return (
        assignedCategories.includes(categoryIdValue) ||
        assignedCategories.includes(categoryNameValue)
      );
    });
  }, [categories, userData, isCategoryAdmin]);

  useEffect(() => {
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setUnsavedChanges?.(
      formTouched && !submitting,
      "You have unsaved item details. Leaving this page will discard your progress."
    );

    return () => {
      setUnsavedChanges?.(false);
    };
  }, [formTouched, submitting, setUnsavedChanges]);

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
      null
    );
  }

  function markFormChanged() {
    setFormTouched(true);
  }

  function sanitizeCodePart(value, fallback = "QBR", maxLength = 4) {
    const cleanedValue = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    return (cleanedValue || fallback).slice(0, maxLength);
  }

  function getBulkQuantity() {
    const parsedQuantity = Number(bulkQuantity);

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return 1;
    }

    return Math.min(Math.floor(parsedQuantity), 100);
  }

  function getBulkQuantityLabel() {
    const quantity = getBulkQuantity();

    return `${quantity} item${quantity === 1 ? "" : "s"}`;
  }

  function generateBatchCode() {
    const selectedCategory = getSelectedCategory();

    const categoryPrefix = sanitizeCodePart(
      selectedCategory?.id || selectedCategory?.name,
      "QBR",
      3
    );

    const itemPrefix = sanitizeCodePart(itemName, "ITEM", 4);
    const timePart = Date.now().toString().slice(-6);

    return `${categoryPrefix}-${itemPrefix}-${timePart}`;
  }

  function generateItemCode(batchCode, sequenceNumber, totalQuantity) {
    if (totalQuantity > 1) {
      const sequenceWidth = Math.max(3, String(totalQuantity).length);
      const sequenceLabel = String(sequenceNumber).padStart(sequenceWidth, "0");

      return `${batchCode}-${sequenceLabel}`;
    }

    const randomNumber = Math.floor(1000 + Math.random() * 9000);

    return `${batchCode}-${randomNumber}`;
  }

  function getFinalAvailability() {
    if (condition === "Damaged") return "Damaged";
    if (condition === "Lost") return "Lost";

    return availability;
  }

  function validateAddItemField(fieldName) {
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

if (fieldName === "description") {
  const sanitized = sanitizeDescription(description);
  
  if (sanitized.length > 500) {
    nextErrors.description = "Description must be 500 characters or less.";
  } else {
    delete nextErrors.description;
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

      if (fieldName === "bulkQuantity") {
        if (!bulkQuantity || Number(bulkQuantity) <= 0) {
          nextErrors.bulkQuantity = "Quantity must be at least 1.";
        } else if (Number(bulkQuantity) > 100) {
          nextErrors.bulkQuantity = "Quantity cannot exceed 100 items per batch.";
        } else {
          delete nextErrors.bulkQuantity;
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

  function resetForm() {
    revokePreview(imagePreview);

    setItemName("");
    setDescription("");
    setCondition("Good");
    setAvailability("Available");
    setMaxBorrowDays("7");
    setBulkQuantity("1");
    setMaintenanceReason("");
    setImageFile(null);
    setImagePreview("");
    setCropSourceFile(null);
    setFieldErrors({});

    if (availableCategories.length > 0) {
      setCategoryId(availableCategories[0].id);
    }

    setFormTouched(false);
  }

  function handleImageChange(event) {
    if (submitting) return;

    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    showStatus("", "");

    if (!file.type.startsWith("image/")) {
      showBlockedAction("Please upload an image file only.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      showBlockedAction("Image is too large. Please upload an image below 8MB.");
      return;
    }

    setCropSourceFile(file);
  }

  function handleItemCropComplete(blob, previewUrl) {
    revokePreview(imagePreview);

    setImageFile(blob);
    setImagePreview(previewUrl);
    setCropSourceFile(null);
    setFormTouched(true);

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

    if (submitLockRef.current || submitting) {
      return;
    }

    showStatus("", "");

    const isValid = validateAddItemForm();

    if (!isValid) {
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      if (!isSuperAdmin && !isCategoryAdmin) {
        showBlockedAction("Only super admins and category admins can add items.");
        return;
      }

      if (categories.length === 0) {
        showBlockedAction(
          "No categories found. Go to User Management and seed or add categories first."
        );
        return;
      }

      if (availableCategories.length === 0) {
        showBlockedAction(
          "You do not have assigned categories yet. Ask the super admin to assign categories first."
        );
        return;
      }

      const selectedCategory = getSelectedCategory();

      if (!selectedCategory) {
        showBlockedAction("Selected category is invalid.");
        return;
      }

      const totalQuantity = getBulkQuantity();
      const batchCode = generateBatchCode();
      const imageUrl = await uploadItemImage(batchCode);
      const finalAvailability = getFinalAvailability();
      const isInitialDamagedLost = isDamagedLostStatus(finalAvailability);
      const isInitialMaintenance = isMaintenanceStatus(finalAvailability);
      const cleanedMaintenanceReason = sanitizeMaintenanceReason(maintenanceReason);
      const createdItemCodes = [];

      for (let index = 1; index <= totalQuantity; index += 1) {
        const finalItemCode = generateItemCode(batchCode, index, totalQuantity);

        const itemRef = await addDoc(collection(db, "items"), {
          itemCode: finalItemCode,
          itemName: itemName.trim(),
          imageUrl,
          description: description.trim(),

          categoryId: selectedCategory.id,
          categoryName: selectedCategory.name,
          category: selectedCategory.id,

          condition,
          availability: finalAvailability,
          maxBorrowDays: Number(maxBorrowDays),

          bulkCreated: totalQuantity > 1,
          bulkBatchCode: batchCode,
          bulkSequence: index,
          bulkTotal: totalQuantity,

          ...(isInitialDamagedLost
            ? {
                damagedLostAt: serverTimestamp(),
                damagedLostDate: getTodayDate(),
                damagedLostBy: getAdminId(),
                damagedLostByEmail: getAdminEmail(),
                damagedLostStatus: finalAvailability,
                damagedLostReport: `Item created with ${finalAvailability} status.`,
                damagedLostSource: "addItem",
              }
            : {}),

          ...(isInitialMaintenance
            ? {
                maintenanceReason: cleanedMaintenanceReason,
                maintenanceStartedAt: serverTimestamp(),
                maintenanceStartedDate: getTodayDate(),
                maintenanceStartedBy: getAdminId(),
                maintenanceStartedByEmail: getAdminEmail(),
                maintenanceStatus: "Under Maintenance",
                maintenanceSource: "addItem",
              }
            : {}),

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

        createdItemCodes.push(finalItemCode);
      }

      const successMessage =
        totalQuantity === 1
          ? "Successfully created 1 item."
          : `Successfully created ${totalQuantity} individual item records with unique QR codes.`;

      showStatus(successMessage, "success");
      showToast("Successfully Created", "success");
      resetForm();
    } catch (error) {
      showActionError("Failed to add item", error);
    } finally {
      submitLockRef.current = false;
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

      <section className="add-item-header add-item-header-compact">
        <div className="add-item-header-content">
          <div className="add-item-header-text">
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
            className="add-item-secondary-btn add-item-header-back-btn"
            onClick={() => {
              if (guardedNavigate) {
                guardedNavigate("/dashboard");
                return;
              }

              navigate("/dashboard");
            }}
          >
            Back to Dashboard
          </button>
        </div>
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

          <form onSubmit={handleAddItem} noValidate>
            <div className="add-item-field">
              <label className="qb-label" htmlFor="item-name">
                Item Name <span className="required-star">*</span>
              </label>

<input
  id="item-name"
  type="text"
  className={fieldErrors.itemName ? "input-error" : ""}
  placeholder="Example: Projector"
  value={itemName}
  maxLength={50}
  onFocus={() => clearFieldError("itemName")}
  onBlur={() => validateAddItemField("itemName")}
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
/>

              {fieldErrors.itemName && (
                <p className="field-error-message">{fieldErrors.itemName}</p>
              )}
            </div>

            <div className="add-item-field add-item-code-field">
              <label className="qb-label">Item Code</label>

              <div className="add-item-auto-code-display" aria-label="Auto-generated item code">
                <span>{getBulkQuantity() > 1 ? "Bulk codes generated after saving" : "Auto-generated after saving"}</span>
              </div>

              <p>
                The item code is generated automatically after saving and is used
                for QR, barcode, borrowing records, and item tracking.
              </p>
            </div>

            <div className="add-item-field add-item-quantity-field">
              <label className="qb-label" htmlFor="bulk-quantity">
                Quantity <span className="required-star">*</span>
              </label>

              <input
                id="bulk-quantity"
                type="number"
                min="1"
                max="100"
                className={fieldErrors.bulkQuantity ? "input-error" : ""}
                value={bulkQuantity}
                onFocus={() => clearFieldError("bulkQuantity")}
                onBlur={() => validateAddItemField("bulkQuantity")}
                onChange={(e) => {
                  markFormChanged();
                  setBulkQuantity(e.target.value);
                  clearFieldError("bulkQuantity");
                }}
                disabled={submitting}
              />

              {fieldErrors.bulkQuantity && (
                <p className="field-error-message">{fieldErrors.bulkQuantity}</p>
              )}

              <p>
                Use 1 for a single item. Use more than 1 to create individual
                item records with unique QR/barcode values using the same details.
              </p>
            </div>

<div className="add-item-field add-item-description-field">
  <label className="qb-label" htmlFor="description">
    Description
    <span className="add-item-char-counter">
      {description.length}/500
    </span>
  </label>

  <textarea
    id="description"
    placeholder="Describe the item, included accessories, or notes..."
    value={description}
    maxLength={500}
    className={fieldErrors.description ? "input-error" : ""}
    onChange={(e) => {
      const rawValue = e.target.value;
      const sanitized = sanitizeDescription(rawValue);
      
      markFormChanged();
      setDescription(sanitized);
      clearFieldError("description");
      
      if (sanitized.length > 500) {
        setFieldErrors((prev) => ({
          ...prev,
          description: "Description must be 500 characters or less.",
        }));
      }
    }}
    onFocus={() => clearFieldError("description")}
    onBlur={() => validateAddItemField("description")}
    disabled={submitting}
  />

  {fieldErrors.description && (
    <p className="field-error-message">{fieldErrors.description}</p>
  )}
</div>

            <div className="add-item-grid">
              <div className="add-item-field">
                <label className="qb-label" htmlFor="category">
                  Category <span className="required-star">*</span>
                </label>

                {isCategoryAdmin ? (
                  <div
                    className={`add-item-fixed-category-card ${
                      fieldErrors.categoryId ? "input-error" : ""
                    }`}
                  >
                    <span>Fixed Assigned Category</span>

                    <strong>
                      {loadingCategories
                        ? "Loading category..."
                        : selectedCategory?.name || "No assigned category"}
                    </strong>

                    <p>
                      Category admins cannot manually select a category. Items
                      will be saved under the assigned category only.
                    </p>
                  </div>
                ) : (
                  <select
                    id="category"
                    className={fieldErrors.categoryId ? "input-error" : ""}
                    value={categoryId}
                    onFocus={() => clearFieldError("categoryId")}
                    onBlur={() => validateAddItemField("categoryId")}
                    onChange={(e) => {
                      markFormChanged();
                      setCategoryId(e.target.value);
                      clearFieldError("categoryId");
                    }}
                    disabled={
                      submitting || loadingCategories || availableCategories.length === 0
                    }
                  >
                    {loadingCategories ? (
                      <option value="">Loading categories...</option>
                    ) : availableCategories.length === 0 ? (
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

              <div className="add-item-field">
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
                  onBlur={() => validateAddItemField("maxBorrowDays")}
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

            <div className="add-item-grid">
              <div className="add-item-field">
                <label className="qb-label" htmlFor="condition">
                  Condition <span className="required-star">*</span>
                </label>

                <select
                  id="condition"
                  className={fieldErrors.condition ? "input-error" : ""}
                  value={condition}
                  onFocus={() => clearFieldError("condition")}
                  onBlur={() => validateAddItemField("condition")}
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

              <div className="add-item-field">
                <label className="qb-label" htmlFor="availability">
                  Availability <span className="required-star">*</span>
                </label>

                <select
                  id="availability"
                  className={fieldErrors.availability ? "input-error" : ""}
                  value={availability}
                  onFocus={() => clearFieldError("availability")}
                  onBlur={() => validateAddItemField("availability")}
                  onChange={(e) => {
                    markFormChanged();
                    setAvailability(e.target.value);
                    clearFieldError("availability");
                    clearFieldError("maintenanceReason");
                  }}
                  disabled={submitting || condition === "Damaged" || condition === "Lost"}
                >
                  <option value="Available">Available</option>
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
              <div className="add-item-field add-item-maintenance-field">
                <label className="qb-label" htmlFor="maintenance-reason">
                  Maintenance Reason <span className="required-star">*</span>
                </label>

                <textarea
                  id="maintenance-reason"
                  className={fieldErrors.maintenanceReason ? "input-error" : ""}
                  placeholder="Example: Needs repair, missing cable, for inspection..."
                  value={maintenanceReason}
                  onFocus={() => clearFieldError("maintenanceReason")}
                  onBlur={() => validateAddItemField("maintenanceReason")}
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

            <div className="add-item-field add-item-image-field">
              <label className="qb-label" htmlFor="item-image">
                Item Image
              </label>

              <input
                id="item-image"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={submitting}
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
                disabled={
                  submitting ||
                  loadingCategories ||
                  availableCategories.length === 0
                }
              >
                {submitting ? "Saving..." : getBulkQuantity() > 1 ? `Save ${getBulkQuantity()} Items` : "Save Item"}
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
            <span>{getBulkQuantity() > 1 ? `${getBulkQuantity()} individual records` : "Auto-generated after saving"}</span>
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

              <div>
                <span>Quantity</span>
                <strong>{getBulkQuantityLabel()}</strong>
              </div>

              {getFinalAvailability() === "Under Maintenance" && (
                <div>
                  <span>Maintenance</span>
                  <strong>{maintenanceReason || "Reason required"}</strong>
                </div>
              )}
            </div>

            <div className="add-item-qr-note">
              <strong>QR / Barcode</strong>
              <p>
                {getBulkQuantity() > 1
                  ? "Each physical item will receive its own QR and barcode after saving."
                  : "QR and barcode values will be generated after the item is saved."}
              </p>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

export default AddItem;
