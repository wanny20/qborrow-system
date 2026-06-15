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
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

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
      emptyTitle: "No requests found",
      emptyText: "No records matched this dashboard card or search keyword.",
      type: "requests",
    },
    pending: {
      label: "Dashboard List",
      title: "Pending Requests",
      subtitle: "Borrow requests waiting for admin approval.",
      emptyTitle: "No requests found",
      emptyText: "No records matched this dashboard card or search keyword.",
      type: "requests",
    },
    overdue: {
      label: "Dashboard List",
      title: "Overdue Records",
      subtitle: "Approved or borrowed requests past the expected return date.",
      emptyTitle: "No requests found",
      emptyText: "No records matched this dashboard card or search keyword.",
      type: "requests",
    },
    "damaged-lost": {
      label: "Dashboard List",
      title: "Damaged/Lost Items",
      subtitle: "Items marked as damaged or lost.",
      emptyTitle: "No items found",
      emptyText: "No records matched this dashboard card or search keyword.",
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
      const itemSnapshot = await getDocs(collection(db, "items"));
      const requestSnapshot = await getDocs(collection(db, "borrowRequests"));

      const itemData = itemSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const requestData = requestSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setItems(itemData);
      setRequests(requestData);
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
  }, [items, userData]);

  const visibleRequests = useMemo(() => {
    return requests.filter((request) =>
      canCategoryAdminSeeCategory(
        getRequestCategoryId(request),
        getRequestCategoryName(request)
      )
    );
  }, [requests, userData]);

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
              ${getRequestCategoryName(record)}
              ${record.approvalStatus || ""}
            `;

        return searchableText.toLowerCase().includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => getCreatedTime(b) - getCreatedTime(a));
  }, [rawRecords, searchTerm, currentList.type]);

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
      <section className="admin-list-header">
        <div>
          <p className="qb-kicker">{currentList.label}</p>
          <h1>{currentList.title}</h1>
          <p>{currentList.subtitle}</p>
        </div>

        <button
          type="button"
          className="admin-list-secondary-btn"
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </button>
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
            <h2>{currentList.emptyTitle}</h2>
            <p>{currentList.emptyText}</p>
          </div>
        ) : currentList.type === "items" ? (
          <div className="admin-list-table">
            {filteredRecords.map((item) => (
              <article className="admin-list-row item-row" key={item.id}>
                <div className="admin-list-row-main">
                  <span className="admin-list-code">
                    {item.itemCode || item.id}
                  </span>

                  <h3>{item.itemName || "Untitled Item"}</h3>

                  <p>{item.description || "No description available."}</p>
                </div>

                <div className="admin-list-row-details">
                  <div>
                    <span>Category</span>
                    <strong>{getItemCategoryName(item)}</strong>
                  </div>

                  <div>
                    <span>Condition</span>
                    <strong>{item.condition || "N/A"}</strong>
                  </div>

                  <div>
                    <span>Availability</span>
                    <strong
                      className={`admin-list-pill status-${String(
                        item.availability || "unknown"
                      ).toLowerCase()}`}
                    >
                      {item.availability || "Unknown"}
                    </strong>
                  </div>
                </div>

                <div className="admin-list-actions">
                  <button
                    type="button"
                    className="admin-list-primary-btn"
                    onClick={() => navigate(`/item/${item.id}`)}
                  >
                    View Item
                  </button>

                  <button
                    type="button"
                    className="admin-list-secondary-btn"
                    onClick={() => navigate(`/edit-item/${item.id}`)}
                  >
                    Edit
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-list-table">
            {filteredRecords.map((request) => (
              <article className="admin-list-row request-row" key={request.id}>
                <div className="admin-list-row-main">
                  <span className="admin-list-code">
                    {request.itemCode || request.itemId || request.id}
                  </span>

                  <h3>{request.itemName || "Untitled Item"}</h3>

                  <p>{request.purpose || "No purpose provided."}</p>
                </div>

                <div className="admin-list-row-details request-details">
                  <div>
                    <span>Borrower</span>
                    <strong>{request.borrowerName || "Unnamed Borrower"}</strong>
                    <p>{request.borrowerEmail || "No email"}</p>
                  </div>

                  <div>
                    <span>Category</span>
                    <strong>{getRequestCategoryName(request)}</strong>
                  </div>

                  <div>
                    <span>Status</span>
                    <strong
                      className={`admin-list-pill status-${String(
                        request.approvalStatus || "unknown"
                      ).toLowerCase()}`}
                    >
                      {isOverdue(request)
                        ? "Overdue"
                        : request.approvalStatus || "Unknown"}
                    </strong>
                  </div>

                  <div>
                    <span>Borrow Date</span>
                    <strong>{request.borrowDate || "Not set"}</strong>
                  </div>

                  <div>
                    <span>Expected Return</span>
                    <strong>{request.expectedReturnDate || "Not set"}</strong>
                  </div>
                </div>

                <div className="admin-list-actions">
                  {request.itemId && (
                    <button
                      type="button"
                      className="admin-list-primary-btn"
                      onClick={() => navigate(`/item/${request.itemId}`)}
                    >
                      View Item
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
        )}
      </section>
    </div>
  );
}

export default AdminDashboardList;