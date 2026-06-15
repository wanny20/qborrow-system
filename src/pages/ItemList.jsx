import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { db, auth } from "../firebase/firebaseConfig";
import "../styles/ItemList.css";

const activeRequestStatuses = ["Pending", "Approved", "Borrowed"];

function ItemList() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [localUserData, setLocalUserData] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");

  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const userData = outletContext?.userData || localUserData;

  const isSuperAdmin = userData?.role === "superAdmin";
  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const isBorrower = userData?.role === "borrower";
  const isAdmin = isSuperAdmin || isCategoryAdmin;

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

  async function fetchItems() {
    try {
      const querySnapshot = await getDocs(collection(db, "items"));

      const itemData = querySnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setItems(itemData);
    } catch (error) {
      alert("Error loading items: " + error.message);
    }
  }

  async function hasActiveBorrowRequest(itemId) {
    const requestsSnapshot = await getDocs(collection(db, "borrowRequests"));

    return requestsSnapshot.docs.some((document) => {
      const request = document.data();

      return (
        request.itemId === itemId &&
        activeRequestStatuses.includes(request.approvalStatus)
      );
    });
  }

  async function handleDeleteItem(item) {
    if (!isAdmin) return;

    if (["Reserved", "Borrowed"].includes(item.availability)) {
      alert("This item cannot be deleted because it is reserved or borrowed.");
      return;
    }

    const confirmDelete = window.confirm(
      `Delete "${item.itemName || "this item"}"? This action cannot be undone.`
    );

    if (!confirmDelete) return;

    setDeletingId(item.id);

    try {
      const hasActiveRequest = await hasActiveBorrowRequest(item.id);

      if (hasActiveRequest) {
        alert("This item cannot be deleted because it has an active borrow request.");
        return;
      }

      await deleteDoc(doc(db, "items", item.id));
      alert("Item deleted successfully.");
      await fetchItems();
    } catch (error) {
      alert("Error deleting item: " + error.message);
    } finally {
      setDeletingId("");
    }
  }

  useEffect(() => {
    const availabilityFromUrl = searchParams.get("availability");

    if (availabilityFromUrl) {
      setAvailabilityFilter(availabilityFromUrl);
    }
  }, [searchParams]);

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

        await fetchItems();
      } catch (error) {
        alert("Error loading item list: " + error.message);
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
  }, [items, userData]);

  const availableCategories = useMemo(() => {
    const categoryMap = new Map();

    roleVisibleItems.forEach((item) => {
      const categoryId = getItemCategoryId(item);
      const categoryName = getItemCategoryName(item);

      if (categoryId || categoryName) {
        categoryMap.set(categoryId || categoryName, categoryName);
      }
    });

    return Array.from(categoryMap.entries()).map(([value, label]) => ({
      value,
      label,
    }));
  }, [roleVisibleItems]);

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
      getItemCategoryId(item) === categoryFilter ||
      getItemCategoryName(item) === categoryFilter;

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
      <section className={`inventory-header-row ${isAdmin ? "has-actions" : ""}`}>
        <div className="inventory-title-area">
          <p className="qb-kicker">Item Inventory</p>

          <h1>{isBorrower ? "Available Items" : "Manage Items"}</h1>

          <p>
            {isBorrower
              ? "Browse available items and submit borrow requests."
              : "View and manage inventory records based on your assigned permissions."}
          </p>

          {isCategoryAdmin && (
            <div className="inventory-assigned-note">
              Assigned categories:{" "}
              {Array.isArray(userData?.assignedCategories) &&
              userData.assignedCategories.length > 0
                ? userData.assignedCategories.join(", ")
                : "No assigned categories yet"}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="inventory-header-actions">
            <button
              type="button"
              className="inventory-add-btn"
              onClick={() => navigate("/add-item")}
            >
              + Add Item
            </button>
          </div>
        )}
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
              Showing {filteredItems.length} of {roleVisibleItems.length} item
              {roleVisibleItems.length === 1 ? "" : "s"}.
            </p>
          </div>

          <button
            type="button"
            className="inventory-refresh-btn"
            onClick={fetchItems}
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
          <div className="inventory-admin-list">
            {filteredItems.map((item) => (
              <article className="inventory-admin-row" key={item.id}>
                <div className="inventory-admin-image">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.itemName || "Item"} />
                  ) : (
                    <span>{(item.itemName || "I").charAt(0)}</span>
                  )}
                </div>

                <div className="inventory-admin-info">
                  <span>{getItemCode(item)}</span>
                  <h3>{item.itemName || "Untitled Item"}</h3>
                  <p>{item.description || "No description yet."}</p>

                  <div className="inventory-meta-row">
                    <span>{getItemCategoryName(item)}</span>

                    <span
                      className={`condition-pill ${getConditionClass(
                        item.condition
                      )}`}
                    >
                      {item.condition || "Unknown"}
                    </span>

                    <span
                      className={`availability-pill ${getAvailabilityClass(
                        item.availability
                      )}`}
                    >
                      {item.availability || "Unavailable"}
                    </span>
                  </div>
                </div>

                <div className="inventory-admin-actions">
                  <button
                    type="button"
                    className="view-btn"
                    onClick={() => navigate(`/item/${item.id}`)}
                  >
                    View
                  </button>

                  <button
                    type="button"
                    className="edit-btn"
                    onClick={() => navigate(`/edit-item?id=${item.id}`)}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="delete-btn"
                    onClick={() => handleDeleteItem(item)}
                    disabled={deletingId === item.id}
                  >
                    {deletingId === item.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
            ))}
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
      </section>
    </div>
  );
}

export default ItemList;