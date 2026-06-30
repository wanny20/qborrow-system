import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
  query as firestoreQuery,
  orderBy,
  limit,
  startAfter,
  documentId,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { db, auth } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import ConfirmActionModal from "../components/ConfirmActionModal.jsx";
import "../styles/ItemList.css";

const activeRequestStatuses = ["Pending", "Approved", "Borrowed"];
const ITEMS_PAGE_SIZE = 12;

function ItemList() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();

  const [items, setItems] = useState([]);
  const [lastItemDoc, setLastItemDoc] = useState(null);
  const [hasMoreItems, setHasMoreItems] = useState(false);
  const [loadingMoreItems, setLoadingMoreItems] = useState(false);

  const [categories, setCategories] = useState([]);
  const [localUserData, setLocalUserData] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");

  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const userData = outletContext?.userData || localUserData;

  const deleteLockRef = useRef("");

  const [confirmAction, setConfirmAction] = useState(null);
const [confirmActionLoading, setConfirmActionLoading] = useState(false);

  const isSuperAdmin = userData?.role === "superAdmin";
  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isBorrower = userData?.role === "borrower";
  const isAdmin = isSuperAdmin || isCategoryAdmin;

  function startDeleteAction(itemId) {
  if (deleteLockRef.current || deletingId) {
    return false;
  }

  deleteLockRef.current = itemId;
  setDeletingId(itemId);

  return true;
}

function finishDeleteAction() {
  deleteLockRef.current = "";
  setDeletingId("");
}
function openConfirmAction(config) {
  setConfirmAction(config);
}

function closeConfirmAction() {
  if (confirmActionLoading) return;
  setConfirmAction(null);
}

async function runConfirmAction() {
  if (!confirmAction?.onConfirm) return;

  setConfirmActionLoading(true);

  try {
    await confirmAction.onConfirm();
    setConfirmAction(null);
  } finally {
    setConfirmActionLoading(false);
  }
}

function isDeleteBusy() {
  return Boolean(deleteLockRef.current || deletingId);
}

    function showActionError(shortMessage, error) {
      console.error(shortMessage, error);
      showToast(shortMessage, "error");
    }

    function showBlockedAction(message) {
      showToast(message, "error");
    }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getItemCategoryId(item) {
    return item.categoryId || item.category || "";
  }

  function getItemCategoryName(item) {
    return item.categoryName || item.category || item.categoryId || "Uncategorized";
  }

  function getItemCode(item) {
    return item.itemCode || item.id;
  }

  function getCategoryNameById(categoryId) {
    const category = categories.find(
      (categoryItem) => normalizeText(categoryItem.id) === normalizeText(categoryId)
    );

    return category?.name || categoryId || "Unknown";
  }

  function getAssignedCategoryNames() {
    if (!Array.isArray(userData?.assignedCategories)) return "No assigned categories yet";

    if (userData.assignedCategories.length === 0) {
      return "No assigned categories yet";
    }

    return userData.assignedCategories.map(getCategoryNameById).join(", ");
  }

  function canCategoryAdminSeeItem(item) {
    if (!isCategoryAdmin) return true;

    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.map(normalizeText)
      : [];

    const itemCategoryId = normalizeText(getItemCategoryId(item));
    const itemCategoryName = normalizeText(getItemCategoryName(item));

    return (
      assignedCategories.includes(itemCategoryId) ||
      assignedCategories.includes(itemCategoryName)
    );
  }

async function fetchCategories() {
  const categorySnapshot = await getDocs(collection(db, "categories"));

  const categoryData = categorySnapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .filter((category) => category.isActive !== false)
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );

  setCategories(categoryData);
}

async function fetchItemsPage(mode = "reset") {
  const itemQuery =
    mode === "more" && lastItemDoc
      ? firestoreQuery(
          collection(db, "items"),
          orderBy(documentId()),
          startAfter(lastItemDoc),
          limit(ITEMS_PAGE_SIZE + 1)
        )
      : firestoreQuery(
          collection(db, "items"),
          orderBy(documentId()),
          limit(ITEMS_PAGE_SIZE + 1)
        );

  const itemSnapshot = await getDocs(itemQuery);
  const docs = itemSnapshot.docs;
  const visibleDocs = docs.slice(0, ITEMS_PAGE_SIZE);

  const itemData = visibleDocs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));

  setHasMoreItems(docs.length > ITEMS_PAGE_SIZE);
  setLastItemDoc(visibleDocs[visibleDocs.length - 1] || null);

  if (mode === "more") {
    setItems((previousItems) => {
      const existingIds = new Set(previousItems.map((item) => item.id));
      const newItems = itemData.filter((item) => !existingIds.has(item.id));

      return [...previousItems, ...newItems];
    });

    return;
  }

  setItems(itemData);
}

async function fetchItemsAndCategories(options = {}) {
  const { showSuccessToast = false } = options;

  try {
    await Promise.all([
      fetchCategories(),
      fetchItemsPage("reset"),
    ]);

    if (showSuccessToast) {
      showToast("Items refreshed", "success");
    }
  } catch (error) {
    showActionError("Failed to load items", error);
  }
}

async function handleLoadMoreItems() {
  if (!hasMoreItems || loadingMoreItems) return;

  setLoadingMoreItems(true);

  try {
    await fetchItemsPage("more");
  } catch (error) {
    showActionError("Failed to load more items", error);
  } finally {
    setLoadingMoreItems(false);
  }
}

async function hasActiveBorrowRequest(itemId) {
  const requestsQuery = firestoreQuery(
    collection(db, "borrowRequests"),
    where("itemId", "==", itemId)
  );

  const requestsSnapshot = await getDocs(requestsQuery);

  return requestsSnapshot.docs.some((document) => {
    const request = document.data();

    return activeRequestStatuses.includes(request.approvalStatus);
  });
}
async function handleDeleteItem(item) {
  if (!isAdmin) return;

  if (isDeleteBusy()) return;

  if (["Reserved", "Borrowed"].includes(item.availability)) {
    showBlockedAction("This item cannot be deleted because it is reserved or borrowed.");
    return;
  }

  openConfirmAction({
    title: "Delete Item?",
    message: `Delete "${item.itemName || "this item"}"? This action cannot be undone.`,
    confirmText: "Delete Item",
    danger: true,
    onConfirm: async () => {
      const started = startDeleteAction(item.id);

      if (!started) return;

      try {
        const itemRef = doc(db, "items", item.id);
        const latestItemSnap = await getDoc(itemRef);

        if (!latestItemSnap.exists()) {
          showBlockedAction("This item no longer exists.");
          await fetchItemsAndCategories();
          return;
        }

        const latestItem = {
          id: latestItemSnap.id,
          ...latestItemSnap.data(),
        };

        if (["Reserved", "Borrowed"].includes(latestItem.availability)) {
          showBlockedAction("This item cannot be deleted because it is now reserved or borrowed.");
          await fetchItemsAndCategories();
          return;
        }

        const hasActiveRequest = await hasActiveBorrowRequest(item.id);

        if (hasActiveRequest) {
          showBlockedAction("This item cannot be deleted because it has an active borrow request.");
          await fetchItemsAndCategories();
          return;
        }

        await deleteDoc(itemRef);

        showToast("Successfully Deleted", "success");
        await fetchItemsAndCategories();
      } catch (error) {
        showActionError("Failed to delete item", error);
      } finally {
        finishDeleteAction();
      }
    },
  });
}

  useEffect(() => {
    const availabilityFromUrl = searchParams.get("availability");

    if (availabilityFromUrl) {
      setAvailabilityFilter(availabilityFromUrl);
    }
  }, [searchParams]);

  useEffect(() => {
  if (isCategoryAdmin) {
    setCategoryFilter("All");
  }
}, [isCategoryAdmin, userData?.assignedCategories?.join("|")]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login");
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          setLocalUserData({
            id: userSnap.id,
            uid: user.uid,
            email: user.email,
            ...userSnap.data(),
          });
        }

        await fetchItemsAndCategories();
      } catch (error) {
        showActionError("Failed to load item list", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  const roleVisibleItems = useMemo(() => {
    if (isCategoryAdmin) {
      return items.filter((item) => canCategoryAdminSeeItem(item));
    }

    if (isBorrower) {
      return items.filter((item) => item.availability === "Available");
    }

    return items;
  }, [items, userData, categories]);

  const availableCategories = useMemo(() => {
    const visibleCategoryIds = new Set(
      roleVisibleItems
        .map((item) => getItemCategoryId(item))
        .filter(Boolean)
        .map(normalizeText)
    );

    const fromCategoryCollection = categories
      .filter((category) => {
        if (isCategoryAdmin) {
          const assignedCategories = Array.isArray(userData?.assignedCategories)
            ? userData.assignedCategories.map(normalizeText)
            : [];

          return assignedCategories.includes(normalizeText(category.id));
        }

        if (isBorrower) {
          return visibleCategoryIds.has(normalizeText(category.id));
        }

        return true;
      })
      .map((category) => ({
        value: category.id,
        label: category.name || category.id,
      }));

    const categoryMap = new Map();

    fromCategoryCollection.forEach((category) => {
      categoryMap.set(category.value, category.label);
    });

    roleVisibleItems.forEach((item) => {
      const categoryId = getItemCategoryId(item);
      const categoryName = getItemCategoryName(item);

      if (categoryId || categoryName) {
        categoryMap.set(categoryId || categoryName, categoryName);
      }
    });

    return Array.from(categoryMap.entries())
      .map(([value, label]) => ({
        value,
        label,
      }))
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
  }, [categories, roleVisibleItems, userData, isCategoryAdmin, isBorrower]);

  const filteredItems = roleVisibleItems.filter((item) => {
    const searchableText = `
      ${item.itemName || ""}
      ${getItemCode(item)}
      ${getItemCategoryId(item)}
      ${getItemCategoryName(item)}
      ${item.condition || ""}
      ${item.availability || ""}
      ${item.description || ""}
    `.toLowerCase();

    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());

    const matchesAvailability =
      availabilityFilter === "All" ||
      item.availability === availabilityFilter ||
      (availabilityFilter === "DamagedLost" &&
        (item.availability === "Damaged" ||
          item.availability === "Lost" ||
          item.condition === "Damaged" ||
          item.condition === "Lost"));

    const matchesCategory =
      categoryFilter === "All" ||
      normalizeText(getItemCategoryId(item)) === normalizeText(categoryFilter) ||
      normalizeText(getItemCategoryName(item)) === normalizeText(categoryFilter);

    return matchesSearch && matchesAvailability && matchesCategory;
  });

  function getAvailabilityClass(availability) {
    if (availability === "Available") return "available";
    if (availability === "Reserved") return "reserved";
    if (availability === "Borrowed") return "borrowed";
    if (availability === "Damaged") return "damaged";
    if (availability === "Lost") return "lost";
    return "unavailable";
  }

  function getConditionClass(condition) {
    if (condition === "Good") return "good";
    if (condition === "Fair") return "fair";
    if (condition === "Damaged") return "damaged";
    if (condition === "Lost") return "lost";
    return "unknown";
  }

  const totalItems = roleVisibleItems.length;

  const availableItems = roleVisibleItems.filter(
    (item) => item.availability === "Available"
  ).length;

  const borrowedItems = roleVisibleItems.filter(
    (item) => item.availability === "Borrowed"
  ).length;

  const unavailableItems = roleVisibleItems.filter(
    (item) =>
      item.availability === "Unavailable" ||
      item.availability === "Damaged" ||
      item.availability === "Lost" ||
      item.condition === "Damaged" ||
      item.condition === "Lost"
  ).length;

  if (loading) {
    return (
      <div className="inventory-loading">
        <div className="inventory-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading Items...</h2>
          <p>Preparing your item inventory.</p>
        </div>
      </div>
    );
  }

return (
  <div className="inventory-page">
    <ConfirmActionModal
      open={Boolean(confirmAction)}
      title={confirmAction?.title}
      message={confirmAction?.message}
      confirmText={confirmAction?.confirmText}
      cancelText={confirmAction?.cancelText || "Cancel"}
      danger={confirmAction?.danger}
      loading={confirmActionLoading}
      onConfirm={runConfirmAction}
      onCancel={closeConfirmAction}
    />

<section className="inventory-header-row inventory-header-compact">
  <div className="inventory-title-area inventory-title-area-compact">
    <div className="inventory-header-text">
      <h1>{isBorrower ? "Available Items" : "View Items"}</h1>

      <p>
        {isBorrower
          ? "Browse available items and submit borrow requests."
          : "View and manage inventory records based on your assigned permissions."}
      </p>

      {isCategoryAdmin && (
        <div className="inventory-assigned-note">
          Assigned categories: {getAssignedCategoryNames()}
        </div>
      )}
    </div>

    <div className="inventory-header-actions inventory-header-actions-compact">
      <button
        type="button"
        className="inventory-refresh-btn inventory-header-action-btn"
        onClick={() => navigate("/dashboard")}
      >
        Back to Dashboard
      </button>
    </div>
  </div>        
</section>

      <section className="inventory-tools">
        <div className="inventory-search">
          <label className="qb-label" htmlFor="item-search">
            Search Items
          </label>

          <input
            id="item-search"
            type="text"
            placeholder="Search item name, code, category, condition..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="inventory-filter">
          <label className="qb-label" htmlFor="availability-filter">
            Availability
          </label>

          <select
            id="availability-filter"
            value={availabilityFilter}
            onChange={(event) => setAvailabilityFilter(event.target.value)}
          >
            <option value="All">All Availability</option>
            <option value="Available">Available</option>
            {!isBorrower && <option value="Reserved">Reserved</option>}
            {!isBorrower && <option value="Borrowed">Borrowed</option>}
            {!isBorrower && <option value="Unavailable">Unavailable</option>}
            {!isBorrower && <option value="Damaged">Damaged</option>}
            {!isBorrower && <option value="Lost">Lost</option>}
            {!isBorrower && <option value="DamagedLost">Damaged/Lost</option>}
          </select>
        </div>

  {isCategoryAdmin ? (
  <div className="inventory-filter">
    <label className="qb-label">Category</label>

    <div className="inventory-fixed-category-card">
      <span>Fixed Assigned Category</span>
      <strong>{getAssignedCategoryNames()}</strong>
    </div>
  </div>
) : (
  <div className="inventory-filter">
    <label className="qb-label" htmlFor="category-filter">
      Category
    </label>

    <select
      id="category-filter"
      value={categoryFilter}
      onChange={(event) => setCategoryFilter(event.target.value)}
    >
      <option value="All">All Categories</option>
      {availableCategories.map((category) => (
        <option key={category.value} value={category.value}>
          {category.label}
        </option>
      ))}
    </select>
  </div>
)}
      </section>

      <section className="inventory-summary">
        <div>
          <span className="inventory-summary-icon">Σ</span>
          <h3>{totalItems}</h3>
          <p>{isBorrower ? "Borrowable Items" : "Visible Items"}</p>
        </div>

        <div>
          <span className="inventory-summary-icon">✓</span>
          <h3>{availableItems}</h3>
          <p>Available</p>
        </div>

        <div>
          <span className="inventory-summary-icon">↗</span>
          <h3>{borrowedItems}</h3>
          <p>Borrowed</p>
        </div>

        <div>
          <span className="inventory-summary-icon">!</span>
          <h3>{unavailableItems}</h3>
          <p>Unavailable</p>
        </div>
      </section>

      <section className="inventory-card-panel">
        <div className="inventory-section-heading">
          <div>
            <h2>Items</h2>
            <p>
              Showing {filteredItems.length} of {roleVisibleItems.length} loaded item
              {roleVisibleItems.length === 1 ? "" : "s"}.
              {hasMoreItems && " Load more items to continue browsing."}
            </p>
          </div>

          <button
            type="button"
            className="inventory-refresh-btn"
            onClick={() => fetchItemsAndCategories({ showSuccessToast: true })}
            disabled={isDeleteBusy() || loadingMoreItems}
          >
            Refresh
          </button>
        </div>

        {filteredItems.length === 0 ? (
          <div className="inventory-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No items found</h2>
            <p>Try changing your search or filter.</p>
          </div>
        ) : isAdmin ? (
          <div className="inventory-admin-table-wrap">
            <table className="inventory-admin-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Category</th>
                  <th scope="col">Condition</th>
                  <th scope="col">Availability</th>
                  <th scope="col">Max Days</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Item">
                      <div className="inventory-table-item">
                        <div className="inventory-table-image">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.itemName || "Item"} />
                          ) : (
                            <span>{(item.itemName || "I").charAt(0)}</span>
                          )}
                        </div>

                        <div className="inventory-table-item-info">
                          <span>{getItemCode(item)}</span>
                          <strong>{item.itemName || "Untitled Item"}</strong>
                          <p>{item.description || "No description yet."}</p>
                        </div>
                      </div>
                    </td>

                    <td data-label="Category">
                      <span className="inventory-table-category">
                        {getItemCategoryName(item)}
                      </span>
                    </td>

                    <td data-label="Condition">
                      <span
                        className={`condition-pill ${getConditionClass(
                          item.condition
                        )}`}
                      >
                        {item.condition || "Unknown"}
                      </span>
                    </td>

                    <td data-label="Availability">
                      <span
                        className={`availability-pill ${getAvailabilityClass(
                          item.availability
                        )}`}
                      >
                        {item.availability || "Unavailable"}
                      </span>
                    </td>

                    <td data-label="Max Days">
                      <span className="inventory-table-days">
                        {item.maxBorrowDays ? `${item.maxBorrowDays}d` : "—"}
                      </span>
                    </td>

                    <td data-label="Actions">
                      <div className="inventory-table-actions">
                        <button
                          type="button"
                          className="inventory-icon-action view-btn"
                          onClick={() => navigate(`/item/${item.id}`)}
                          disabled={isDeleteBusy()}
                          aria-label={`View ${item.itemName || "item"}`}
                          data-tooltip="View"
                        >
                          <span aria-hidden="true">👁</span>
                          <span className="inventory-action-text">View</span>
                        </button>

                        <button
                          type="button"
                          className="inventory-icon-action edit-btn"
                          onClick={() => navigate(`/edit-item?id=${item.id}`)}
                          disabled={isDeleteBusy()}
                          aria-label={`Edit ${item.itemName || "item"}`}
                          data-tooltip="Edit"
                        >
                          <span aria-hidden="true">✎</span>
                          <span className="inventory-action-text">Edit</span>
                        </button>

                        <button
                          type="button"
                          className="inventory-icon-action delete-btn"
                          onClick={() => handleDeleteItem(item)}
                          disabled={isDeleteBusy()}
                          aria-label={`Delete ${item.itemName || "item"}`}
                          data-tooltip={deletingId === item.id ? "Deleting" : "Delete"}
                        >
                          <span aria-hidden="true">
                            {deletingId === item.id ? "…" : "🗑"}
                          </span>
                          <span className="inventory-action-text">
                            {deletingId === item.id ? "Deleting..." : "Delete"}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inventory-grid">
            {filteredItems.map((item) => (
              <article className="inventory-item-card" key={item.id}>
                <div className="inventory-item-media">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.itemName || "Item"} />
                  ) : (
                    <span>{(item.itemName || "Item").charAt(0)}</span>
                  )}
                </div>

                <div className="inventory-item-main">
                  <div className="inventory-item-topline">
                    <span>{getItemCode(item)}</span>

                    <span
                      className={`availability-pill ${getAvailabilityClass(
                        item.availability
                      )}`}
                    >
                      {item.availability || "Unavailable"}
                    </span>
                  </div>

                  <h3>{item.itemName || "Untitled Item"}</h3>

                  <p className="inventory-item-description">
                    {item.description || "No description yet."}
                  </p>

                  <div className="inventory-meta-row">
                    <span>{getItemCategoryName(item)}</span>

                    <span
                      className={`condition-pill ${getConditionClass(
                        item.condition
                      )}`}
                    >
                      {item.condition || "Unknown"}
                    </span>
                  </div>

                  <div className="inventory-actions">
                    <button
                      type="button"
                      className="view-btn"
                      onClick={() => navigate(`/item/${item.id}`)}
                    >
                      View
                    </button>

                    {item.availability === "Available" && (
                      <button
                        type="button"
                        className="borrow-btn"
                        onClick={() => navigate(`/borrow-request/${item.id}`)}
                      >
                        Borrow
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {hasMoreItems && (
  <div className="inventory-load-more-row">
    <button
      type="button"
      className="inventory-refresh-btn"
      onClick={handleLoadMoreItems}
      disabled={loadingMoreItems || isDeleteBusy()}
    >
      {loadingMoreItems ? "Loading..." : "Load More Items"}
    </button>
  </div>
)}
      </section>
    </div>
  );
}

export default ItemList;