import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import "../styles/Reports.css";

function Reports() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;

  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const isCategoryAdmin = userData?.role === "categoryAdmin";

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getCategoryNameById(categoryId) {
    const category = categories.find(
      (categoryItem) =>
        normalizeText(categoryItem.id) === normalizeText(categoryId)
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

  function getItemCategoryId(item) {
    return item.categoryId || item.category || "";
  }

  function getItemCategoryName(item) {
    return (
      item.categoryName ||
      getCategoryNameById(item.categoryId || item.category) ||
      item.category ||
      item.categoryId ||
      "Uncategorized"
    );
  }

  function getRequestCategoryId(request) {
    return request.categoryId || request.category || "";
  }

  function getRequestCategoryName(request) {
    return (
      request.categoryName ||
      getCategoryNameById(request.categoryId || request.category) ||
      request.category ||
      request.categoryId ||
      "Uncategorized"
    );
  }

  function cleanDisplay(value, fallback = "Not set") {
    const cleanedValue = String(value || "").trim();
    return cleanedValue || fallback;
  }

  function getBorrowerUserType(request) {
    return cleanDisplay(request.borrowerUserType, "Student");
  }

  function getBorrowerIdNumber(request) {
    const borrowerType = getBorrowerUserType(request);

    if (borrowerType === "Faculty" || borrowerType === "Staff") {
      return cleanDisplay(request.borrowerEmployeeId);
    }

    return cleanDisplay(request.borrowerStudentNumber);
  }

  function getBorrowerYearSection(request) {
    const values = [
      request.borrowerYearLevel,
      request.borrowerSection,
    ].filter(Boolean);

    return values.length > 0 ? values.join(" - ") : "Not set";
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

  function checkOverdue(request) {
    if (!["Approved", "Borrowed"].includes(request.approvalStatus)) {
      return false;
    }

    if (!request.expectedReturnDate) return false;

    const today = new Date();
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    return today > expectedDate;
  }

  function getRequestStatusLabel(request) {
    if (checkOverdue(request)) return "Overdue";
    return request.approvalStatus || "Unknown";
  }

  function getCreatedTime(record) {
    if (record.createdAt?.toMillis) return record.createdAt.toMillis();
    if (record.createdAt?.seconds) return record.createdAt.seconds * 1000;
    return 0;
  }

  async function fetchReportsData() {
    setLoading(true);

    try {
      const [itemsSnapshot, requestsSnapshot, categoriesSnapshot] =
        await Promise.all([
          getDocs(collection(db, "items")),
          getDocs(collection(db, "borrowRequests")),
          getDocs(collection(db, "categories")),
        ]);

      const itemData = itemsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const requestData = requestsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const categoryData = categoriesSnapshot.docs
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
      alert("Error loading reports: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReportsData();
  }, []);

  const visibleItems = useMemo(() => {
    return items.filter((item) =>
      canCategoryAdminSeeCategory(
        getItemCategoryId(item),
        getItemCategoryName(item)
      )
    );
  }, [items, categories, userData]);

  const visibleRequests = useMemo(() => {
    return requests.filter((request) =>
      canCategoryAdminSeeCategory(
        getRequestCategoryId(request),
        getRequestCategoryName(request)
      )
    );
  }, [requests, categories, userData]);

  const availableItems = visibleItems.filter(
    (item) => item.availability === "Available"
  );

  const reservedItems = visibleItems.filter(
    (item) => item.availability === "Reserved"
  );

  const borrowedItems = visibleItems.filter(
    (item) => item.availability === "Borrowed"
  );

  const damagedLostItems = visibleItems.filter(
    (item) =>
      item.condition === "Damaged" ||
      item.condition === "Lost" ||
      item.availability === "Damaged" ||
      item.availability === "Lost"
  );

  const overdueRequests = visibleRequests.filter((request) =>
    checkOverdue(request)
  );

  const pendingRequests = visibleRequests.filter(
    (request) => request.approvalStatus === "Pending"
  );

  const approvedRequests = visibleRequests.filter(
    (request) => request.approvalStatus === "Approved"
  );

  const borrowedRequests = visibleRequests.filter(
    (request) => request.approvalStatus === "Borrowed"
  );

  const returnedRequests = visibleRequests.filter(
    (request) => request.approvalStatus === "Returned"
  );

  const closedRequests = visibleRequests.filter(
    (request) =>
      request.approvalStatus === "Rejected" ||
      request.approvalStatus === "Cancelled"
  );

  const filteredHistory = visibleRequests
    .filter((request) => {
      const searchableText = `
        ${request.itemName || ""}
        ${request.itemCode || ""}
        ${request.borrowerName || ""}
        ${request.borrowerEmail || ""}
        ${request.borrowerUserType || ""}
        ${request.borrowerStudentNumber || ""}
        ${request.borrowerEmployeeId || ""}
        ${request.borrowerCourseDepartment || ""}
        ${request.borrowerYearLevel || ""}
        ${request.borrowerSection || ""}
        ${request.borrowerMobileNumber || ""}
        ${request.purpose || ""}
        ${getRequestCategoryId(request)}
        ${getRequestCategoryName(request)}
        ${request.approvalStatus || ""}
        ${getRequestStatusLabel(request)}
      `.toLowerCase();

      const matchesSearch = searchableText.includes(searchTerm.toLowerCase());

      const matchesStatus =
        statusFilter === "All" ||
        request.approvalStatus === statusFilter ||
        (statusFilter === "Overdue" && checkOverdue(request));

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => getCreatedTime(b) - getCreatedTime(a));

  const frequentlyBorrowedItems = useMemo(() => {
    const countMap = {};

    visibleRequests.forEach((request) => {
      const countedStatuses = ["Borrowed", "Returned"];

      if (!countedStatuses.includes(request.approvalStatus)) return;

      const itemKey = request.itemId || request.itemName || "Unknown Item";

      if (!countMap[itemKey]) {
        countMap[itemKey] = {
          itemKey,
          itemName: request.itemName || "Unknown Item",
          categoryName: getRequestCategoryName(request),
          count: 0,
        };
      }

      countMap[itemKey].count += 1;
    });

    return Object.values(countMap).sort((a, b) => b.count - a.count);
  }, [visibleRequests, categories]);

  const categoryReports = useMemo(() => {
    const categoryMap = {};

    categories.forEach((category) => {
      if (!canCategoryAdminSeeCategory(category.id, category.name)) return;

      categoryMap[category.id] = {
        categoryId: category.id,
        categoryName: category.name || category.id,
        totalItems: 0,
        available: 0,
        reserved: 0,
        borrowed: 0,
        damagedLost: 0,
        totalRequests: 0,
      };
    });

    visibleItems.forEach((item) => {
      const categoryId = getItemCategoryId(item) || getItemCategoryName(item);
      const categoryName = getItemCategoryName(item);

      if (!categoryMap[categoryId]) {
        categoryMap[categoryId] = {
          categoryId,
          categoryName,
          totalItems: 0,
          available: 0,
          reserved: 0,
          borrowed: 0,
          damagedLost: 0,
          totalRequests: 0,
        };
      }

      categoryMap[categoryId].totalItems += 1;

      if (item.availability === "Available") {
        categoryMap[categoryId].available += 1;
      }

      if (item.availability === "Reserved") {
        categoryMap[categoryId].reserved += 1;
      }

      if (item.availability === "Borrowed") {
        categoryMap[categoryId].borrowed += 1;
      }

      if (
        item.condition === "Damaged" ||
        item.condition === "Lost" ||
        item.availability === "Damaged" ||
        item.availability === "Lost"
      ) {
        categoryMap[categoryId].damagedLost += 1;
      }
    });

    visibleRequests.forEach((request) => {
      const categoryId =
        getRequestCategoryId(request) || getRequestCategoryName(request);
      const categoryName = getRequestCategoryName(request);

      if (!categoryMap[categoryId]) {
        categoryMap[categoryId] = {
          categoryId,
          categoryName,
          totalItems: 0,
          available: 0,
          reserved: 0,
          borrowed: 0,
          damagedLost: 0,
          totalRequests: 0,
        };
      }

      categoryMap[categoryId].totalRequests += 1;
    });

    return Object.values(categoryMap).sort((a, b) =>
      a.categoryName.localeCompare(b.categoryName)
    );
  }, [categories, visibleItems, visibleRequests, userData]);

  if (loading) {
    return (
      <div className="reports-loading">
        <div className="reports-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading reports...</h2>
          <p>Preparing inventory and borrowing analytics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="reports-page">
      <section className="reports-header">
        <div>
          <p className="qb-kicker">Admin Analytics</p>

          <h1>Reports</h1>

          <p>
            Monitor inventory status, borrowing activity, overdue records,
            damaged/lost items, and category-based performance.
          </p>

          {isCategoryAdmin && (
            <div className="reports-assigned-note">
              Assigned categories: {getAssignedCategoryNames()}
            </div>
          )}
        </div>

        <button
          type="button"
          className="reports-secondary-btn"
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </button>
      </section>

      <section className="reports-summary-grid">
        <div>
          <span>Σ</span>
          <h3>{visibleItems.length}</h3>
          <p>Total Items</p>
        </div>

        <div>
          <span>✓</span>
          <h3>{availableItems.length}</h3>
          <p>Available</p>
        </div>

        <div>
          <span>R</span>
          <h3>{reservedItems.length}</h3>
          <p>Reserved</p>
        </div>

        <div>
          <span>↗</span>
          <h3>{borrowedItems.length}</h3>
          <p>Borrowed</p>
        </div>

        <div>
          <span>!</span>
          <h3>{overdueRequests.length}</h3>
          <p>Overdue</p>
        </div>

        <div>
          <span>×</span>
          <h3>{damagedLostItems.length}</h3>
          <p>Damaged/Lost</p>
        </div>
      </section>

      <section className="reports-request-summary">
        <div>
          <span>?</span>
          <h3>{pendingRequests.length}</h3>
          <p>Pending</p>
        </div>

        <div>
          <span>✓</span>
          <h3>{approvedRequests.length}</h3>
          <p>Approved</p>
        </div>

        <div>
          <span>↗</span>
          <h3>{borrowedRequests.length}</h3>
          <p>Active Borrowed</p>
        </div>

        <div>
          <span>↩</span>
          <h3>{returnedRequests.length}</h3>
          <p>Returned</p>
        </div>

        <div>
          <span>×</span>
          <h3>{closedRequests.length}</h3>
          <p>Closed</p>
        </div>
      </section>

      <section className="reports-tools">
        <div>
          <label className="qb-label" htmlFor="reports-search">
            Search History
          </label>

          <input
            id="reports-search"
            type="text"
            placeholder="Search item, borrower, purpose, category..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div>
          <label className="qb-label" htmlFor="reports-status-filter">
            Request Status
          </label>

          <select
            id="reports-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="All">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Borrowed">Borrowed</option>
            <option value="Returned">Returned</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Overdue">Overdue</option>
          </select>
        </div>

        <button
          type="button"
          className="reports-refresh-btn"
          onClick={fetchReportsData}
        >
          Refresh
        </button>
      </section>

      <section className="reports-panel">
        <div className="reports-section-heading">
          <div>
            <h2>Category Report</h2>
            <p>Item and request totals grouped by active category.</p>
          </div>
        </div>

        {categoryReports.length === 0 ? (
          <div className="reports-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No category data</h2>
            <p>No categories, items, or requests are available for your role.</p>
          </div>
        ) : (
          <div className="reports-category-grid">
            {categoryReports.map((category) => (
              <article className="reports-category-card" key={category.categoryId}>
                <h3>{category.categoryName}</h3>

                <div className="reports-category-stats">
                  <div>
                    <span>Total Items</span>
                    <strong>{category.totalItems}</strong>
                  </div>

                  <div>
                    <span>Available</span>
                    <strong>{category.available}</strong>
                  </div>

                  <div>
                    <span>Reserved</span>
                    <strong>{category.reserved}</strong>
                  </div>

                  <div>
                    <span>Borrowed</span>
                    <strong>{category.borrowed}</strong>
                  </div>

                  <div>
                    <span>Damaged/Lost</span>
                    <strong>{category.damagedLost}</strong>
                  </div>

                  <div>
                    <span>Requests</span>
                    <strong>{category.totalRequests}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="reports-two-column">
        <div className="reports-panel">
          <div className="reports-section-heading">
            <div>
              <h2>Frequently Borrowed Items</h2>
              <p>Based on Borrowed and Returned request records.</p>
            </div>
          </div>

          {frequentlyBorrowedItems.length === 0 ? (
            <div className="reports-empty small">
              <h2>No borrowed items yet</h2>
              <p>No item has been released or returned yet.</p>
            </div>
          ) : (
            <div className="reports-list">
              {frequentlyBorrowedItems.slice(0, 8).map((item) => (
                <article className="reports-mini-card" key={item.itemKey}>
                  <div>
                    <h3>{item.itemName}</h3>
                    <p>{item.categoryName}</p>
                  </div>

                  <strong>{item.count}</strong>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="reports-panel">
          <div className="reports-section-heading">
            <div>
              <h2>Overdue Items</h2>
              <p>Approved or borrowed requests past expected return date.</p>
            </div>
          </div>

          {overdueRequests.length === 0 ? (
            <div className="reports-empty small">
              <h2>No overdue items</h2>
              <p>All active records are within their return date.</p>
            </div>
          ) : (
            <div className="reports-list">
              {overdueRequests.slice(0, 8).map((request) => (
                <article className="reports-mini-card danger" key={request.id}>
                  <div>
                    <h3>{request.itemName || "Untitled Item"}</h3>
                    <p>{request.borrowerEmail || "No email"}</p>
                    <p>{getBorrowerIdNumber(request)}</p>
                    <p>{cleanDisplay(request.borrowerCourseDepartment)}</p>
                    <p>Expected: {request.expectedReturnDate || "Not set"}</p>
                  </div>

                  <strong>Overdue</strong>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="reports-panel">
        <div className="reports-section-heading">
          <div>
            <h2>Borrowing History</h2>
            <p>
              Showing {filteredHistory.length} of {visibleRequests.length} request
              record{visibleRequests.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="reports-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No borrowing history found</h2>
            <p>Try changing the search keyword or status filter.</p>
          </div>
        ) : (
          <div className="reports-history-list">
            {filteredHistory.map((request) => (
              <article className="reports-history-row" key={request.id}>
                <div className="reports-history-main">
                  <div className="reports-history-titleline">
                    <div>
                      <span className="reports-row-code">
                        {request.itemCode || request.itemId || "No code"}
                      </span>

                      <h3>{request.itemName || "Untitled Item"}</h3>
                    </div>

                    <strong
                      className={`reports-status-pill status-${String(
                        getRequestStatusLabel(request)
                      ).toLowerCase()}`}
                    >
                      {getRequestStatusLabel(request)}
                    </strong>
                  </div>

                  <div className="reports-history-subline">
                    <span>{request.borrowerName || "Unnamed Borrower"}</span>
                    <span>{request.borrowerEmail || "No email"}</span>
                    <span>{getBorrowerUserType(request)}</span>
                    <span>{getBorrowerIdNumber(request)}</span>
                    <span>{cleanDisplay(request.borrowerCourseDepartment)}</span>
                    <span>{getBorrowerYearSection(request)}</span>
                    <span>{cleanDisplay(request.borrowerMobileNumber)}</span>
                    <span>{getRequestCategoryName(request)}</span>
                  </div>
                </div>

                <div className="reports-history-date-list">
                  <div>
                    <span>Borrow</span>
                    <strong>{request.borrowDate || "Not set"}</strong>
                  </div>

                  <div>
                    <span>Expected</span>
                    <strong>{request.expectedReturnDate || "Not set"}</strong>
                  </div>

                  <div>
                    <span>Actual</span>
                    <strong>{request.actualReturnDate || "Not returned"}</strong>
                  </div>

                  <div>
                    <span>Condition</span>
                    <strong>{request.returnCondition || "N/A"}</strong>
                  </div>
                </div>

                <div className="reports-history-purpose-list">
                  <span>Purpose</span>
                  <p>{request.purpose || "No purpose provided."}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="reports-panel">
        <div className="reports-section-heading">
          <div>
            <h2>Damaged / Lost Items</h2>
            <p>Items currently marked as damaged or lost.</p>
          </div>
        </div>

        {damagedLostItems.length === 0 ? (
          <div className="reports-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No damaged or lost items</h2>
            <p>Your visible inventory has no damaged or lost records.</p>
          </div>
        ) : (
          <div className="reports-damaged-list">
            {damagedLostItems.map((item) => (
              <article className="reports-damaged-row" key={item.id}>
                <div className="reports-damaged-main">
                  <span className="reports-row-code">
                    {item.itemCode || item.id}
                  </span>

                  <h3>{item.itemName || "Untitled Item"}</h3>

                  <p>{getItemCategoryName(item)}</p>
                </div>

                <div className="reports-damaged-meta">
                  <div>
                    <span>Availability</span>
                    <strong>{item.availability || "N/A"}</strong>
                  </div>

                  <div>
                    <span>Condition</span>
                    <strong className="reports-damage-pill">
                      {item.condition || item.availability || "N/A"}
                    </strong>
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

export default Reports;