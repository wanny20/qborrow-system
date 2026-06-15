import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { auth, db, storage } from "../firebase/firebaseConfig";
import "../styles/EditItem.css";

const defaultCategories = [
  { id: "sports", name: "Sports Items" },
  { id: "laboratory", name: "Laboratory Items" },
  { id: "stem", name: "STEM Items" },
  { id: "it", name: "IT Items" },
];

function EditItem() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

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

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);
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
      defaultCategories.find((category) => category.id === categoryId) ||
      null
    );
  }

  function getFinalAvailability() {
    if (condition === "Damaged") return "Damaged";
    if (condition === "Lost") return "Lost";

    return availability;
  }

  async function fetchItem(id) {
    setLoading(true);
    showStatus("", "");

    try {
      const itemRef = doc(db, "items", id);
      const itemSnap = await getDoc(itemRef);

      if (!itemSnap.exists()) {
        showStatus("Item not found.", "error");
        setLoading(false);
        return;
      }

      const item = {
        id: itemSnap.id,
        ...itemSnap.data(),
      };

      const existingCategoryId =
        item.categoryId || item.category || "";
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
    } catch (error) {
      showStatus("Error loading item: " + error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function handleImageChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      setImageFile(null);
      setImagePreview(imageUrl || "");
      return;
    }

    if (!file.type.startsWith("image/")) {
      showStatus("Please upload an image file only.", "error");
      event.target.value = "";
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function uploadItemImage(finalItemCode) {
    if (!imageFile) return imageUrl || "";

    const safeFileName = imageFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const imageRef = ref(
      storage,
      `items/${finalItemCode || itemId}-${Date.now()}-${safeFileName}`
    );

    await uploadBytes(imageRef, imageFile);
    return getDownloadURL(imageRef);
  }

  async function handleUpdateItem(e) {
    e.preventDefault();
    showStatus("", "");

    if (!isSuperAdmin && !isCategoryAdmin) {
      showStatus("Only super admins and category admins can edit items.", "error");
      return;
    }

    if (isForbidden) {
      showStatus("You are not allowed to edit this item.", "error");
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

    setSubmitting(true);

    try {
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

      showStatus("Item updated successfully.", "success");

      setTimeout(() => {
        navigate("/items");
      }, 700);
    } catch (error) {
      showStatus("Error updating item: " + error.message, "error");
    } finally {
      setSubmitting(false);
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
    fetchItem(idFromUrl);
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
      <section className="edit-item-header">
        <div>
          <p className="qb-kicker">Inventory Update</p>

          <h1>Edit Item</h1>

          <p>
            Update item details, image, category, condition, availability, and
            borrowing limits.
          </p>

          {isCategoryAdmin && (
            <div className="edit-item-assigned-note">
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
          className="edit-item-secondary-btn"
          onClick={() => navigate("/items")}
        >
          Back to Item List
        </button>
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

            <form onSubmit={handleUpdateItem}>
              <div className="edit-item-field">
                <label className="qb-label" htmlFor="item-name">
                  Item Name
                </label>

                <input
                  id="item-name"
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                />
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
                  placeholder="Describe the item..."
                />
              </div>

              <div className="edit-item-grid">
                <div className="edit-item-field">
                  <label className="qb-label" htmlFor="category">
                    Category
                  </label>

                  <select
                    id="category"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    {availableCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="edit-item-field">
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

              <div className="edit-item-grid">
                <div className="edit-item-field">
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

                <div className="edit-item-field">
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
                />

                <p>Optional. Upload only if you want to replace the image.</p>
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
                  disabled={submitting}
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