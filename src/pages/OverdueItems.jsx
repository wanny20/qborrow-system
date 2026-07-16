import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import "../styles/OverdueItems.css";

function OverdueItems() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { schoolStatus } = outletContext;
  const { showToast } = useToast();

  const [currentUser, setCurrentUser] = useState(null);
  const [overdueItems, setOverdueItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

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

  function isSystemSuspended() {
    return Boolean(schoolStatus?.isSystemSuspended);
  }

  function getTodayDate() {
    const date = new Date();
    const timezoneOffset = date.getTimezoneOffset() * 60000;

    return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
  }

  function getCategoryName(request) {
    return (
      request.categoryName ||
      request.category ||
      request.categoryId ||
      "Uncategorized"
    );
  }

  function getRequestItemImageUrl(request) {
    return (
      request?.itemImageUrl ||
      request?.itemImage ||
      request?.imageUrl ||
      request?.itemPhotoUrl ||
      ""
    );
  }

  function getRequestItemInitial(request) {
    return (
      String(request?.itemName || request?.itemCode || "Q")
        .trim()
        .charAt(0)
        .toUpperCase() || "Q"
    );
  }

  function isRequestOverdue(request) {
    if (request.approvalStatus !== "Borrowed") return false;
    if (!request.expectedReturnDate) return false;
    if (isSystemSuspended()) return false;

    const today = new Date(getTodayDate());
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    return today > expectedDate;
  }

  function getDaysOverdue(request) {
    const today = new Date(getTodayDate());
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    const diffMs = today.getTime() - expectedDate.getTime();
    return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
  }

  function getUrgencyClass(daysOverdue) {
    if (daysOverdue >= 8) return "critical";
    if (daysOverdue >= 4) return "high";
    return "moderate";
  }

  function getUrgencyLabel(daysOverdue) {
    if (daysOverdue >= 8) return "Critical";
    if (daysOverdue >= 4) return "High";
    return "Moderate";
  }

  async function enrichRequestsWithItemImages(requestList) {
    const uniqueItemIds = [
      ...new Set(requestList.map((request) => request.itemId).filter(Boolean)),
    ];

    if (uniqueItemIds.length === 0) {
      return requestList;
    }

    const itemEntries = await Promise.all(
      uniqueItemIds.map(async (itemId) => {
        try {
          const itemSnap = await getDoc(doc(db, "items", itemId));

          return [
            itemId,
            itemSnap.exists() ? { id: itemSnap.id, ...itemSnap.data() } : null,
          ];
        } catch (error) {
          console.warn("Failed to load item details", itemId, error);
          return [itemId, null];
        }
      })
    );

    const itemMap = new Map(itemEntries);

    return requestList.map((request) => {
      const itemRecord = itemMap.get(request.itemId);

      return {
        ...request,
        itemImageUrl:
          getRequestItemImageUrl(request) ||
          itemRecord?.imageUrl ||
          itemRecord?.itemImageUrl ||
          "",
        itemCondition: request.itemCondition || itemRecord?.condition || "",
      };
    });
  }

  async function fetchOverdueItems(userId, options = {}) {
    const { showSuccessToast = false } = options;

    setLoading(true);
    showStatus("", "");

    try {
      const requestsQuery = query(
        collection(db, "borrowRequests"),
        where("borrowerId", "==", userId),
        where("approvalStatus", "==", "Borrowed")
      );

      const querySnapshot = await getDocs(requestsQuery);

      const borrowedRequests = querySnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const enrichedRequests = await enrichRequestsWithItemImages(
        borrowedRequests
      );

      const overdueOnly = enrichedRequests
        .filter((request) => isRequestOverdue(request))
        .sort(
          (a, b) =>
            new Date(a.expectedReturnDate) - new Date(b.expectedReturnDate)
        );

      setOverdueItems(overdueOnly);

      if (showSuccessToast) {
        showToast("Overdue items refreshed", "success");
      }
    } catch (error) {
      showActionError("Failed to load your overdue items", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        showBlockedAction("Please login first.");
        navigate("/login");
        return;
      }

      setCurrentUser(user);
      await fetchOverdueItems(user.uid);
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const filteredOverdueItems = overdueItems.filter((request) => {
    const searchableText = `
      ${request.itemName || ""}
      ${request.itemCode || ""}
      ${request.purpose || ""}
      ${getCategoryName(request)}
    `.toLowerCase();

    return searchableText.includes(searchTerm.toLowerCase());
  });

  const totalDaysOverdueCombined = overdueItems.reduce(
    (total, request) => total + getDaysOverdue(request),
    0
  );

  const mostUrgentDaysOverdue = overdueItems.reduce(
    (max, request) => Math.max(max, getDaysOverdue(request)),
    0
  );

  if (loading) {
    return (
      <div className="overdue-items-loading">
        <div className="overdue-items-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Checking your overdue items...</h2>
          <p>Looking through your currently borrowed items.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overdue-items-page">
      <section className="overdue-items-header overdue-items-header-compact">
        <div className="overdue-items-header-content">
          <div className="overdue-items-header-text">
            <h1>My Overdue Items</h1>

            <p>
              Items you're currently borrowing that are past their expected
              return date. Please return these as soon as possible.
            </p>
          </div>

          <button
            type="button"
            className="overdue-items-secondary-btn overdue-items-header-back-btn"
            onClick={() => navigate("/dashboard")}
          >
            Back to Dashboard
          </button>
        </div>
      </section>

      {statusMessage && (
        <div
          className={`overdue-items-status overdue-items-status-${statusType}`}
          role="status"
        >
          {statusMessage}
        </div>
      )}

      {isSystemSuspended() && (
        <div className="overdue-items-suspended-banner" role="status">
          <strong>System Suspended</strong>
          <p>
            The school is currently closed and return deadlines are paused.
            Overdue calculations will resume once the system reopens.
          </p>
        </div>
      )}

      {selectedItem && (
        <div
          className="overdue-items-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedItem(null)}
        >
          <section
            className="overdue-items-modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="overdue-items-modal-close"
              onClick={() => setSelectedItem(null)}
              aria-label="Close item details"
            >
              ×
            </button>

            <div className="overdue-items-modal-heading">
              <span>{selectedItem.itemCode || selectedItem.itemId}</span>

              <h2>{selectedItem.itemName || "Untitled Item"}</h2>

              <strong
                className={`overdue-items-urgency-pill urgency-${getUrgencyClass(
                  getDaysOverdue(selectedItem)
                )}`}
              >
                {getUrgencyLabel(getDaysOverdue(selectedItem))} Priority
              </strong>
            </div>

            <div className="overdue-items-modal-item-preview">
              {getRequestItemImageUrl(selectedItem) ? (
                <img
                  src={getRequestItemImageUrl(selectedItem)}
                  alt={selectedItem.itemName || "Borrowed item"}
                />
              ) : (
                <span>{getRequestItemInitial(selectedItem)}</span>
              )}

              <div>
                <span>Item Photo</span>
                <strong>{selectedItem.itemName || "Untitled Item"}</strong>
                <p>{selectedItem.itemCode || selectedItem.itemId || "No item code"}</p>
              </div>
            </div>

            <p className="overdue-items-modal-purpose">
              <strong>Purpose:</strong>{" "}
              {selectedItem.purpose || "No purpose provided."}
            </p>

            <div className="overdue-items-modal-grid">
              <div>
                <span>Category</span>
                <strong>{getCategoryName(selectedItem)}</strong>
              </div>

              <div>
                <span>Borrow Date</span>
                <strong>{selectedItem.borrowDate || "Not set"}</strong>
              </div>

              <div>
                <span>Expected Return</span>
                <strong>{selectedItem.expectedReturnDate || "Not set"}</strong>
              </div>

              <div>
                <span>Days Overdue</span>
                <strong>{getDaysOverdue(selectedItem)} day(s)</strong>
              </div>
            </div>

            <div className="overdue-items-modal-actions">
              <button
                type="button"
                className="overdue-items-primary-btn"
                onClick={() => navigate(`/item/${selectedItem.itemId}`)}
              >
                View Item
              </button>

              <button
                type="button"
                className="overdue-items-secondary-btn"
                onClick={() => setSelectedItem(null)}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="overdue-items-summary-grid">
        <div>
          <h3>{overdueItems.length}</h3>
          <p>Overdue Items</p>
        </div>

        <div>
          <h3>{totalDaysOverdueCombined}</h3>
          <p>Combined Days Overdue</p>
        </div>

        <div>
          <h3>{mostUrgentDaysOverdue}</h3>
          <p>Most Days Overdue</p>
        </div>
      </section>

      <section className="overdue-items-tools">
        <div>
          <label className="qb-label" htmlFor="overdue-search">
            Search Overdue Items
          </label>

          <input
            id="overdue-search"
            type="text"
            placeholder="Search item, code, category, purpose..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <button
          type="button"
          className="overdue-items-refresh-btn"
          onClick={() =>
            currentUser?.uid &&
            fetchOverdueItems(currentUser.uid, { showSuccessToast: true })
          }
        >
          Refresh
        </button>
      </section>

      <section className="overdue-items-panel">
        <div className="overdue-items-section-heading">
          <div>
            <h2>Currently Overdue</h2>
            <p>
              Showing {filteredOverdueItems.length} of {overdueItems.length}{" "}
              overdue item{overdueItems.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>

        {filteredOverdueItems.length === 0 ? (
          <div className="overdue-items-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>
              {overdueItems.length === 0
                ? "You're all caught up!"
                : "No matching overdue items"}
            </h2>
            <p>
              {overdueItems.length === 0
                ? "You have no overdue items right now. Keep up the good work returning items on time."
                : "Try a different search keyword."}
            </p>

            {overdueItems.length === 0 && (
              <button
                type="button"
                className="overdue-items-primary-btn"
                onClick={() => navigate("/my-requests")}
              >
                View My Requests
              </button>
            )}
          </div>
        ) : (
          <div className="overdue-items-table-shell">
            <div className="overdue-items-table-header">
              <span>Item</span>
              <span>Category</span>
              <span>Expected Return</span>
              <span>Days Overdue</span>
              <span>Priority</span>
              <span>Action</span>
            </div>

            <div className="overdue-items-table-body">
              {filteredOverdueItems.map((request) => (
                <article className="overdue-item-table-row" key={request.id}>
                  <div
                    className="overdue-item-table-cell overdue-item-table-item"
                    data-label="Item"
                  >
                    <span>{request.itemCode || request.itemId}</span>
                    <strong>{request.itemName || "Untitled Item"}</strong>
                  </div>

                  <div className="overdue-item-table-cell" data-label="Category">
                    <strong>{getCategoryName(request)}</strong>
                  </div>

                  <div
                    className="overdue-item-table-cell"
                    data-label="Expected Return"
                  >
                    <strong>{request.expectedReturnDate || "Not set"}</strong>
                  </div>

                  <div
                    className="overdue-item-table-cell"
                    data-label="Days Overdue"
                  >
                    <strong>{getDaysOverdue(request)} day(s)</strong>
                  </div>

                  <div
                    className="overdue-item-table-cell overdue-item-priority-cell"
                    data-label="Priority"
                  >
                    <span
                      className={`overdue-items-urgency-pill urgency-${getUrgencyClass(
                        getDaysOverdue(request)
                      )}`}
                    >
                      {getUrgencyLabel(getDaysOverdue(request))}
                    </span>
                  </div>

                  <div
                    className="overdue-item-table-actions"
                    data-label="Action"
                  >
                    <button
                      type="button"
                      className="overdue-item-icon-btn"
                      data-tooltip="Details"
                      title="Details"
                      aria-label="View overdue item details"
                      onClick={() => setSelectedItem(request)}
                    >
                      <span aria-hidden="true">i</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default OverdueItems;