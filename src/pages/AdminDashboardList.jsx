import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import "../styles/AdminDashboardList.css";

function AdminDashboardList() {
  const { listType } = useParams();
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [categories, setCategories] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewingRecord, setViewingRecord] = useState(null);

  const isCategoryAdmin = userData?.role === "categoryAdmin";

  const listConfig = {
    items: {
      label: "Dashboard List",
      title: "Total Items",
      subtitle: "All items visible based on your admin role.",
      emptyTitle: "No items found",
      emptyText: "No records matched this dashboard card or search keyword.",
      type: "items",
    },
    available: {
      label: "Dashboard List",
      title: "Available Items",
      subtitle: "Items currently available for borrowing.",
      emptyTitle: "No available items found",
      emptyText: "No available items matched this dashboard card or search keyword.",
      type: "items",
    },
    borrowed: {
      label: "Dashboard List",
      title: "Borrowed Items",
      subtitle: "Borrowed records with borrower information.",
      emptyTitle: "No borrowed records found",
      emptyText: "No borrowed records matched this dashboard card or search keyword.",
      type: "requests",
    },
    pending: {
      label: "Dashboard List",
      title: "Pending Requests",
      subtitle: "Borrow requests waiting for admin approval.",
      emptyTitle: "No pending requests found",
      emptyText: "No pending requests matched this dashboard card or search keyword.",
      type: "requests",
    },
    overdue: {
      label: "Dashboard List",
      title: "Overdue Records",
      subtitle: "Approved or borrowed requests past the expected return date.",
      emptyTitle: "No overdue records found",
      emptyText: "No overdue records matched this dashboard card or search keyword.",
      type: "requests",
    },
    "damaged-lost": {
      label: "Dashboard List",
      title: "Damaged / Lost Items",
      subtitle: "Items currently marked as damaged or lost.",
      emptyTitle: "No damaged or lost items found",
      emptyText: "No damaged/lost records matched this dashboard card or search keyword.",
      type: "items",
    },
  };

  const currentList = listConfig[listType] || listConfig.items;

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getItemCategoryId(item) {
    return item.categoryId || item.category || "";
  }

  function getItemCategoryName(item) {
    return item.categoryName || item.category || item.categoryId || "Uncategorized";
  }

  function getRequestCategoryId(request) {
    return request.categoryId || request.category || "";
  }

  function getRequestCategoryName(request) {
    return (
      request.categoryName ||
      request.category ||
      request.categoryId ||
      "Uncategorized"
    );
  }

  function getCategoryNameById(categoryId) {
    const category = categories.find(
      (categoryItem) => normalizeText(categoryItem.id) === normalizeText(categoryId)
    );

    return category?.name || categoryId || "Unknown";
  }

  function getAssignedCategoryNames() {
    if (!Array.isArray(userData?.assignedCategories)) {
      return "No assigned categories yet";
    }

    if (userData.assignedCategories.length === 0) {
      return "No assigned categories yet";
    }

    return userData.assignedCategories.map(getCategoryNameById).join(", ");
  }

  function canCategoryAdminSeeCategory(categoryId, categoryName) {
    if (!isCategoryAdmin) return true;

    const assignedCategories = Array.isArray(userData?.assignedCategories)
      ? userData.assignedCategories.map(normalizeText)
      : [];

    return (
      assignedCategories.includes(normalizeText(categoryId)) ||
      assignedCategories.includes(normalizeText(categoryName))
    );
  }

  function isOverdue(request) {
    if (!["Approved", "Borrowed"].includes(request.approvalStatus)) return false;
    if (!request.expectedReturnDate) return false;

    const today = new Date();
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    return today > expectedDate;
  }

  function getCreatedTime(record) {
    if (record.createdAt?.toMillis) return record.createdAt.toMillis();
    if (record.createdAt?.seconds) return record.createdAt.seconds * 1000;
    return 0;
  }

  async function fetchListData() {
    setLoading(true);

    try {
      const [itemSnapshot, requestSnapshot, categorySnapshot] =
        await Promise.all([
          getDocs(collection(db, "items")),
          getDocs(collection(db, "borrowRequests")),
          getDocs(collection(db, "categories")),
        ]);

      const itemData = itemSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const requestData = requestSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const categoryData = categorySnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter((category) => category.isActive !== false)
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""))
        );

      setItems(itemData);
      setRequests(requestData);
      setCategories(categoryData);
    } catch (error) {
      alert("Error loading dashboard list: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchListData();
  }, []);

  const visibleItems = useMemo(() => {
    return items.filter((item) =>
      canCategoryAdminSeeCategory(getItemCategoryId(item), getItemCategoryName(item))
    );
  }, [items, userData, categories]);

  const visibleRequests = useMemo(() => {
    return requests.filter((request) =>
      canCategoryAdminSeeCategory(
        getRequestCategoryId(request),
        getRequestCategoryName(request)
      )
    );
  }, [requests, userData, categories]);

  const rawRecords = useMemo(() => {
    if (listType === "available") {
      return visibleItems.filter((item) => item.availability === "Available");
    }

    if (listType === "damaged-lost") {
      return visibleItems.filter(
        (item) =>
          item.condition === "Damaged" ||
          item.condition === "Lost" ||
          item.availability === "Damaged" ||
          item.availability === "Lost"
      );
    }

    if (listType === "borrowed") {
      return visibleRequests.filter(
        (request) => request.approvalStatus === "Borrowed"
      );
    }

    if (listType === "pending") {
      return visibleRequests.filter(
        (request) => request.approvalStatus === "Pending"
      );
    }

    if (listType === "overdue") {
      return visibleRequests.filter((request) => isOverdue(request));
    }

    return visibleItems;
  }, [listType, visibleItems, visibleRequests]);

  const filteredRecords = useMemo(() => {
    return rawRecords
      .filter((record) => {
        const searchableText =
          currentList.type === "items"
            ? `
              ${record.itemName || ""}
              ${record.itemCode || ""}
              ${record.description || ""}
              ${getItemCategoryId(record)}
              ${getItemCategoryName(record)}
              ${record.availability || ""}
              ${record.condition || ""}
            `
            : `
              ${record.itemName || ""}
              ${record.itemCode || ""}
              ${record.borrowerName || ""}
              ${record.borrowerEmail || ""}
              ${record.purpose || ""}
              ${getRequestCategoryId(record)}
              ${getRequestCategoryName(record)}
              ${record.approvalStatus || ""}
            `;

        return searchableText.toLowerCase().includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => getCreatedTime(b) - getCreatedTime(a));
  }, [rawRecords, searchTerm, currentList.type]);

  function getItemStatusLabel(item) {
    if (item.condition === "Damaged" || item.availability === "Damaged") {
      return "Damaged";
    }

    if (item.condition === "Lost" || item.availability === "Lost") {
      return "Lost";
    }

    return item.availability || "Unknown";
  }

  function getRequestStatusLabel(request) {
    if (isOverdue(request)) return "Overdue";
    return request.approvalStatus || "Unknown";
  }

  if (loading) {
    return (
      <div className="admin-list-loading">
        <div className="admin-list-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading list...</h2>
          <p>Preparing dashboard records.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-list-page">
      {viewingRecord && (
  <div
    className="admin-list-modal-backdrop"
    role="dialog"
    aria-modal="true"
    onClick={() => setViewingRecord(null)}
  >
    <section
      className="admin-list-modal-card"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="admin-list-modal-close"
        onClick={() => setViewingRecord(null)}
        aria-label="Close details"
      >
        ×
      </button>

      {currentList.type === "items" ? (
        <>
          <div className="admin-list-modal-heading">
            <span>{viewingRecord.itemCode || viewingRecord.id}</span>
            <h2>{viewingRecord.itemName || "Untitled Item"}</h2>
            <p>{viewingRecord.description || "No description available."}</p>
          </div>

          <div className="admin-list-modal-grid">
            <div>
              <span>Category</span>
              <strong>{getItemCategoryName(viewingRecord)}</strong>
            </div>

            <div>
              <span>Condition</span>
              <strong>{viewingRecord.condition || "N/A"}</strong>
            </div>

            <div>
              <span>Availability</span>
              <strong
                className={`admin-list-pill status-${String(
                  getItemStatusLabel(viewingRecord)
                ).toLowerCase()}`}
              >
                {getItemStatusLabel(viewingRecord)}
              </strong>
            </div>

            <div>
              <span>Item ID</span>
              <strong>{viewingRecord.id}</strong>
            </div>
          </div>

          <div className="admin-list-modal-actions">
            <button
              type="button"
              className="admin-list-secondary-btn"
              onClick={() => setViewingRecord(null)}
            >
              Close
            </button>

            <button
              type="button"
              className="admin-list-primary-btn"
              onClick={() => navigate(`/item/${viewingRecord.id}`)}
            >
              View Item
            </button>

            <button
              type="button"
              className="admin-list-secondary-btn"
              onClick={() => navigate(`/edit-item?id=${viewingRecord.id}`)}
            >
              Edit
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="admin-list-modal-heading">
            <span>{viewingRecord.itemCode || viewingRecord.itemId || viewingRecord.id}</span>
            <h2>{viewingRecord.itemName || "Untitled Item"}</h2>
            <p>{viewingRecord.purpose || "No purpose provided."}</p>
          </div>

          <div className="admin-list-modal-grid">
            <div>
              <span>Borrower</span>
              <strong>{viewingRecord.borrowerName || "Unnamed Borrower"}</strong>
              <p>{viewingRecord.borrowerEmail || "No email"}</p>
            </div>

            <div>
              <span>Category</span>
              <strong>{getRequestCategoryName(viewingRecord)}</strong>
            </div>

            <div>
              <span>Status</span>
              <strong
                className={`admin-list-pill status-${String(
                  getRequestStatusLabel(viewingRecord)
                ).toLowerCase()}`}
              >
                {getRequestStatusLabel(viewingRecord)}
              </strong>
            </div>

            <div>
              <span>Borrow Date</span>
              <strong>{viewingRecord.borrowDate || "Not set"}</strong>
            </div>

            <div>
              <span>Expected Return</span>
              <strong>{viewingRecord.expectedReturnDate || "Not set"}</strong>
            </div>
          </div>

          <div className="admin-list-modal-actions">
            <button
              type="button"
              className="admin-list-secondary-btn"
              onClick={() => setViewingRecord(null)}
            >
              Close
            </button>

            {viewingRecord.itemId && (
              <button
                type="button"
                className="admin-list-primary-btn"
                onClick={() => navigate(`/item/${viewingRecord.itemId}`)}
              >
                View Item
              </button>
            )}

            {viewingRecord.approvalStatus === "Pending" && (
              <button
                type="button"
                className="admin-list-secondary-btn"
                onClick={() => navigate("/manage-requests")}
              >
                Manage
              </button>
            )}

            {viewingRecord.approvalStatus === "Borrowed" && (
              <button
                type="button"
                className="admin-list-secondary-btn"
                onClick={() => navigate("/return-confirmation")}
              >
                Return
              </button>
            )}
          </div>
        </>
      )}
    </section>
  </div>
)}
  <section className="admin-list-header admin-list-header-compact">
  <div className="admin-list-header-content">
    <div className="admin-list-header-text">
      <h2>{currentList.title}</h2>
      <p>{currentList.subtitle}</p>

      {isCategoryAdmin && (
        <div className="admin-list-assigned-note">
          Assigned categories: {getAssignedCategoryNames()}
        </div>
      )}
    </div>

    <button
      type="button"
      className="admin-list-secondary-btn admin-list-header-back-btn"
      onClick={() => navigate("/dashboard")}
    >
      Back to Dashboard
    </button>
  </div>
</section>

      <section className="admin-list-tools">
        <div>
          <label className="qb-label" htmlFor="admin-list-search">
            Search
          </label>

          <input
            id="admin-list-search"
            type="text"
            placeholder="Search item, borrower, category, status..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="admin-list-count-card">
          <span>Showing</span>
          <strong>{filteredRecords.length}</strong>
        </div>
      </section>
<section className="admin-list-panel">
  {filteredRecords.length === 0 ? (
    <div className="admin-list-empty">
      <img src="/qborrow-logo.png" alt="QBorrow Logo" />
      <h2>{currentList.emptyTitle}</h2>
      <p>{currentList.emptyText}</p>
    </div>
  ) : currentList.type === "items" ? (
    <>
      <div className="admin-list-compact-header item-table">
        <span>Item</span>
        <span>Category</span>
        <span>Condition</span>
        <span>Status</span>
        <span>Actions</span>
      </div>

      <div className="admin-list-compact-grid">
        {filteredRecords.map((item) => (
          <article className="admin-list-compact-row item-table" key={item.id}>
            <div className="admin-list-compact-cell admin-list-main-cell">
              <span>{item.itemCode || item.id}</span>
              <strong>{item.itemName || "Untitled Item"}</strong>
              <p>{item.description || "No description available."}</p>
            </div>

            <div className="admin-list-compact-cell">
              <span>Category</span>
              <strong>{getItemCategoryName(item)}</strong>
            </div>

            <div className="admin-list-compact-cell">
              <span>Condition</span>
              <strong>{item.condition || "N/A"}</strong>
            </div>

            <div className="admin-list-compact-status">
              <strong
                className={`admin-list-pill status-${String(
                  getItemStatusLabel(item)
                ).toLowerCase()}`}
              >
                {getItemStatusLabel(item)}
              </strong>
            </div>

            <div className="admin-list-compact-actions">
              <button
                type="button"
                className="admin-list-secondary-btn"
                onClick={() => setViewingRecord(item)}
              >
                Details
              </button>

              <button
                type="button"
                className="admin-list-primary-btn"
                onClick={() => navigate(`/item/${item.id}`)}
              >
                View
              </button>

              <button
                type="button"
                className="admin-list-secondary-btn"
                onClick={() => navigate(`/edit-item?id=${item.id}`)}
              >
                Edit
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  ) : (
    <>
      <div className="admin-list-compact-header request-table">
        <span>Item</span>
        <span>Borrower</span>
        <span>Category</span>
        <span>Expected</span>
        <span>Status</span>
        <span>Actions</span>
      </div>

      <div className="admin-list-compact-grid">
        {filteredRecords.map((request) => (
          <article className="admin-list-compact-row request-table" key={request.id}>
            <div className="admin-list-compact-cell admin-list-main-cell">
              <span>{request.itemCode || request.itemId || request.id}</span>
              <strong>{request.itemName || "Untitled Item"}</strong>
              <p>{request.purpose || "No purpose provided."}</p>
            </div>

            <div className="admin-list-compact-cell admin-list-borrower-cell">
              <span>{request.borrowerEmail || "No email"}</span>
              <strong>{request.borrowerName || "Unnamed Borrower"}</strong>
            </div>

            <div className="admin-list-compact-cell">
              <span>Category</span>
              <strong>{getRequestCategoryName(request)}</strong>
            </div>

            <div className="admin-list-compact-cell">
              <span>Expected</span>
              <strong>{request.expectedReturnDate || "Not set"}</strong>
            </div>

            <div className="admin-list-compact-status">
              <strong
                className={`admin-list-pill status-${String(
                  getRequestStatusLabel(request)
                ).toLowerCase()}`}
              >
                {getRequestStatusLabel(request)}
              </strong>
            </div>

            <div className="admin-list-compact-actions">
              <button
                type="button"
                className="admin-list-secondary-btn"
                onClick={() => setViewingRecord(request)}
              >
                Details
              </button>

              {request.itemId && (
                <button
                  type="button"
                  className="admin-list-primary-btn"
                  onClick={() => navigate(`/item/${request.itemId}`)}
                >
                  View
                </button>
              )}

              {request.approvalStatus === "Pending" && (
                <button
                  type="button"
                  className="admin-list-secondary-btn"
                  onClick={() => navigate("/manage-requests")}
                >
                  Manage
                </button>
              )}

              {request.approvalStatus === "Borrowed" && (
                <button
                  type="button"
                  className="admin-list-secondary-btn"
                  onClick={() => navigate("/return-confirmation")}
                >
                  Return
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  )}
</section>
    </div>
  );
}

export default AdminDashboardList;