import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import "../styles/Reports.css";
const REPORTS_HISTORY_PAGE_SIZE = 10;

function Reports() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { userData } = outletContext;
  const { showToast } = useToast();

  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);
const [searchTerm, setSearchTerm] = useState("");
const [statusFilter, setStatusFilter] = useState("All");
const [dateFrom, setDateFrom] = useState("");
const [dateTo, setDateTo] = useState("");
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(
    REPORTS_HISTORY_PAGE_SIZE
  );
  const [viewingHistoryRequest, setViewingHistoryRequest] = useState(null);
  const [viewingDamagedItem, setViewingDamagedItem] = useState(null);

  const isCategoryAdmin = userData?.role === "categoryAdmin";
  const UNCATEGORIZED_CATEGORY_ID = "uncategorized";
  const UNCATEGORIZED_CATEGORY_NAME = "Uncategorized";

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

function isPlaceholderCategory(value) {
  const normalizedValue = normalizeText(value);

  return (
    !normalizedValue ||
    normalizedValue === "unknown" ||
    normalizedValue === "equipment" ||
    normalizedValue === "n/a" ||
    normalizedValue === "not set"
  );
}

function findActiveCategory(value) {
  if (isPlaceholderCategory(value)) {
    return null;
  }

  return categories.find((categoryItem) => {
    const categoryId = normalizeText(categoryItem.id);
    const categoryName = normalizeText(categoryItem.name);
    const searchValue = normalizeText(value);

    return categoryId === searchValue || categoryName === searchValue;
  });
}

function getCategoryInfo(record) {
  const possibleValues = [
    record.categoryId,
    record.categoryName,
    record.category,
  ];

  for (const value of possibleValues) {
    const matchedCategory = findActiveCategory(value);

    if (matchedCategory) {
      return {
        id: matchedCategory.id,
        name: matchedCategory.name || matchedCategory.id,
      };
    }
  }

  return {
    id: UNCATEGORIZED_CATEGORY_ID,
    name: UNCATEGORIZED_CATEGORY_NAME,
  };
}

  function getAssignedCategoryNames() {
    if (!Array.isArray(userData?.assignedCategories)) {
      return "No assigned categories yet";
    }

    if (userData.assignedCategories.length === 0) {
      return "No assigned categories yet";
    }

    return userData.assignedCategories
  .map((categoryId) => {
    const category = findActiveCategory(categoryId);
    return category?.name || categoryId;
  })
  .join(", ");
  }
function getItemCategoryId(item) {
  return getCategoryInfo(item).id;
}

function getItemCategoryName(item) {
  return getCategoryInfo(item).name;
}

function getRequestCategoryId(request) {
  return getCategoryInfo(request).id;
}

function getRequestCategoryName(request) {
  return getCategoryInfo(request).name;
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
    if (request.approvalStatus !== "Borrowed") {
      return false;
    }

    if (!request.expectedReturnDate) return false;

    const today = new Date();
    const expectedDate = new Date(request.expectedReturnDate);

    today.setHours(0, 0, 0, 0);
    expectedDate.setHours(0, 0, 0, 0);

    return today > expectedDate;
  }

  function getComparableDateKey(value) {
    if (!value) return "";

    if (typeof value === "string") {
      return formatDateForInput(value) || value;
    }

    if (value?.toMillis) {
      return formatDateForInput(value.toMillis());
    }

    if (value?.seconds) {
      return formatDateForInput(value.seconds * 1000);
    }

    return formatDateForInput(value);
  }

  function isReturnedLate(request) {
    if (request.approvalStatus !== "Returned") {
      return false;
    }

    const expectedDateKey = getComparableDateKey(request.expectedReturnDate);
    const actualDateKey = getComparableDateKey(request.actualReturnDate);

    if (!expectedDateKey || !actualDateKey) {
      return false;
    }

    return actualDateKey > expectedDateKey;
  }

  function getRequestStatusLabel(request) {
    if (checkOverdue(request)) return "Overdue";

    if (request.approvalStatus === "Returned") {
      return isReturnedLate(request) ? "Returned Late" : "Returned On Time";
    }

    return request.approvalStatus || "Unknown";
  }

  function getRequestStatusClass(request) {
    const statusLabel = getRequestStatusLabel(request);

    return String(statusLabel || "Unknown")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function getCreatedTime(record) {
    if (record.createdAt?.toMillis) return record.createdAt.toMillis();
    if (record.createdAt?.seconds) return record.createdAt.seconds * 1000;
    return 0;
  }
function formatDateForInput(dateValue) {
  if (!dateValue) return "";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getRequestReportDate(request) {
  if (request.borrowDate) {
    return request.borrowDate;
  }

  if (request.createdAt?.toMillis) {
    return formatDateForInput(request.createdAt.toMillis());
  }

  if (request.createdAt?.seconds) {
    return formatDateForInput(request.createdAt.seconds * 1000);
  }

  return "";
}

function isRequestInsideDateRange(request) {
  const reportDate = getRequestReportDate(request);

  if (!reportDate) return true;

  if (dateFrom && reportDate < dateFrom) {
    return false;
  }

  if (dateTo && reportDate > dateTo) {
    return false;
  }

  return true;
}

function resetDateRange() {
  setDateFrom("");
  setDateTo("");
}

function getDateRangeLabel() {
  if (dateFrom && dateTo) {
    return `${dateFrom} to ${dateTo}`;
  }

  if (dateFrom) {
    return `From ${dateFrom}`;
  }

  if (dateTo) {
    return `Until ${dateTo}`;
  }

  return "All dates";
}

function showActionError(shortMessage, error) {
  console.error(shortMessage, error);

  showToast(shortMessage, "error");
}

function showActionSuccess(message) {
  showToast(message, "success");
}

async function fetchReportsData(options = {}) {
  const { showSuccessToast = false } = options;

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

    if (showSuccessToast) {
      showActionSuccess("Reports Refreshed");
    }
  } catch (error) {
    showActionError("Failed to load reports", error);
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    fetchReportsData();
  }, []);
useEffect(() => {
  setVisibleHistoryCount(REPORTS_HISTORY_PAGE_SIZE);
}, [searchTerm, statusFilter, dateFrom, dateTo]);

  const visibleItems = useMemo(() => {
    return items.filter((item) =>
      canCategoryAdminSeeCategory(
        getItemCategoryId(item),
        getItemCategoryName(item)
      )
    );
  }, [items, categories, userData]);

const visibleRequests = useMemo(() => {
  return requests.filter((request) => {
    const canSeeCategory = canCategoryAdminSeeCategory(
      getRequestCategoryId(request),
      getRequestCategoryName(request)
    );

    return canSeeCategory && isRequestInsideDateRange(request);
  });
}, [requests, categories, userData, dateFrom, dateTo]);

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

  const activeRequestTotal = borrowedRequests.length;

const returnableRequestTotal =
  borrowedRequests.length + returnedRequests.length;

const reportStatistics = [
  {
    label: "Available Item Rate",
    value: getPercentage(availableItems.length, visibleItems.length),
    detail: `${availableItems.length} of ${visibleItems.length} visible items are available.`,
  },
  {
    label: "Borrowed Item Rate",
    value: getPercentage(borrowedItems.length, visibleItems.length),
    detail: `${borrowedItems.length} of ${visibleItems.length} visible items are currently borrowed.`,
  },
  {
    label: "Damaged/Lost Rate",
    value: getPercentage(damagedLostItems.length, visibleItems.length),
    detail: `${damagedLostItems.length} of ${visibleItems.length} visible items are damaged or lost.`,
  },
  {
    label: "Overdue Borrowed Rate",
    value: getPercentage(overdueRequests.length, activeRequestTotal),
    detail: `${overdueRequests.length} of ${activeRequestTotal} borrowed requests are overdue.`,
  },
  {
    label: "Return Completion Rate",
    value: getPercentage(returnedRequests.length, returnableRequestTotal),
    detail: `${returnedRequests.length} of ${returnableRequestTotal} borrowed/returned records are completed.`,
  },
  {
    label: "Closed Request Rate",
    value: getPercentage(closedRequests.length, visibleRequests.length),
    detail: `${closedRequests.length} of ${visibleRequests.length} requests are rejected or cancelled.`,
  },
];

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

      const reportStatusLabel = getRequestStatusLabel(request);

      const matchesStatus =
        statusFilter === "All" ||
        request.approvalStatus === statusFilter ||
        reportStatusLabel === statusFilter ||
        (statusFilter === "Overdue" && checkOverdue(request));

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => getCreatedTime(b) - getCreatedTime(a));
    const displayedHistory = filteredHistory.slice(0, visibleHistoryCount);
const hasMoreHistory = visibleHistoryCount < filteredHistory.length;

function handleLoadMoreHistory() {
  setVisibleHistoryCount((currentCount) =>
    Math.min(currentCount + REPORTS_HISTORY_PAGE_SIZE, filteredHistory.length)
  );
}

function handlePrintReport() {
  window.print();
}
function getCsvDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function escapeCsvValue(value) {
  const cleanedValue = String(value ?? "")
    .replace(/\r?\n|\r/g, " ")
    .trim();

  if (
    cleanedValue.includes(",") ||
    cleanedValue.includes('"') ||
    cleanedValue.includes("\n")
  ) {
    return `"${cleanedValue.replace(/"/g, '""')}"`;
  }

  return cleanedValue;
}

function downloadCsvFile(fileName, headers, rows) {
  const csvRows = [
    headers,
    ...rows,
  ];

  const csvText = csvRows
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  const blob = new Blob([`\ufeff${csvText}`], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

function handleExportBorrowingHistoryCsv() {
  if (filteredHistory.length === 0) {
    showToast("No borrowing history records to export", "error");
    return;
  }

  try {
    const headers = [
      "Item Code",
      "Item Name",
      "Borrower",
      "Email",
      "User Type",
      "ID Number",
      "Course / Department",
      "Year / Section",
      "Mobile Number",
      "Category",
      "Borrow Date",
      "Expected Return",
      "Actual Return",
      "Status",
      "Purpose",
    ];

    const rows = filteredHistory.map((request) => [
      request.itemCode || request.itemId || "No code",
      request.itemName || "Untitled Item",
      request.borrowerName || "Unnamed Borrower",
      request.borrowerEmail || "No email",
      getBorrowerUserType(request),
      getBorrowerIdNumber(request),
      cleanDisplay(request.borrowerCourseDepartment),
      getBorrowerYearSection(request),
      cleanDisplay(request.borrowerMobileNumber),
      getRequestCategoryName(request),
      request.borrowDate || "Not set",
      request.expectedReturnDate || "Not set",
      request.actualReturnDate || "Not returned",
      getRequestStatusLabel(request),
      request.purpose || "No purpose provided",
    ]);

    downloadCsvFile(
      `qborrow-borrowing-history-${getCsvDateStamp()}.csv`,
      headers,
      rows
    );

    showActionSuccess("Borrowing History Exported");
  } catch (error) {
    showActionError("Failed to export borrowing history", error);
  }
}

function handleExportCategoryReportCsv() {
  if (categoryReports.length === 0) {
    showToast("No category report records to export", "error");
    return;
  }

  try {
    const headers = [
      "Category",
      "Total Items",
      "Available",
      "Reserved",
      "Borrowed",
      "Damaged / Lost",
      "Total Requests",
    ];

    const rows = categoryReports.map((category) => [
      category.categoryName,
      category.totalItems,
      category.available,
      category.reserved,
      category.borrowed,
      category.damagedLost,
      category.totalRequests,
    ]);

    downloadCsvFile(
      `qborrow-category-report-${getCsvDateStamp()}.csv`,
      headers,
      rows
    );

    showActionSuccess("Category Report Exported");
  } catch (error) {
    showActionError("Failed to export category report", error);
  }
}

function handleExportOverdueItemsCsv() {
  if (overdueRequests.length === 0) {
    showToast("No overdue item records to export", "error");
    return;
  }

  try {
    const headers = [
      "Item Code",
      "Item Name",
      "Borrower",
      "Email",
      "ID Number",
      "Course / Department",
      "Category",
      "Borrow Date",
      "Expected Return",
      "Status",
    ];

    const rows = overdueRequests.map((request) => [
      request.itemCode || request.itemId || "No code",
      request.itemName || "Untitled Item",
      request.borrowerName || "Unnamed Borrower",
      request.borrowerEmail || "No email",
      getBorrowerIdNumber(request),
      cleanDisplay(request.borrowerCourseDepartment),
      getRequestCategoryName(request),
      request.borrowDate || "Not set",
      request.expectedReturnDate || "Not set",
      getRequestStatusLabel(request),
    ]);

    downloadCsvFile(
      `qborrow-overdue-items-${getCsvDateStamp()}.csv`,
      headers,
      rows
    );

    showActionSuccess("Overdue Items Exported");
  } catch (error) {
    showActionError("Failed to export overdue items", error);
  }
}

function handleExportDamagedLostCsv() {
  if (damagedLostItems.length === 0) {
    showToast("No damaged or lost item records to export", "error");
    return;
  }

  try {
    const headers = [
      "Item Code",
      "Item Name",
      "Category",
      "Availability",
      "Condition",
      "Item ID",
    ];

    const rows = damagedLostItems.map((item) => [
      item.itemCode || item.id,
      item.itemName || "Untitled Item",
      getItemCategoryName(item),
      item.availability || "N/A",
      item.condition || item.availability || "N/A",
      item.id,
    ]);

    downloadCsvFile(
      `qborrow-damaged-lost-items-${getCsvDateStamp()}.csv`,
      headers,
      rows
    );

    showActionSuccess("Damaged / Lost Items Exported");
  } catch (error) {
    showActionError("Failed to export damaged or lost items", error);
  }
}

function getPercentage(value, total) {
  if (!total || total <= 0) return 0;

  return Math.round((value / total) * 100);
}

function getChartPercent(value, total) {
  if (!total || total <= 0) return 0;

  return Math.max(4, Math.round((value / total) * 100));
}

function getReportGeneratedDate() {
  return new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}


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
      const categoryInfo = getCategoryInfo(item);
      const categoryId = categoryInfo.id;
      const categoryName = categoryInfo.name;

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
      const categoryInfo = getCategoryInfo(request);
      const categoryId = categoryInfo.id;
      const categoryName = categoryInfo.name;

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

return Object.values(categoryMap)
  .filter((category) => {
    if (category.categoryId !== UNCATEGORIZED_CATEGORY_ID) {
      return true;
    }

    return category.totalItems > 0;
  })
  .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  }, [categories, visibleItems, visibleRequests, userData]);

  const itemAvailabilityChartTotal =
  availableItems.length +
  reservedItems.length +
  borrowedItems.length +
  damagedLostItems.length;

const itemAvailabilityChart = [
  {
    label: "Available",
    value: availableItems.length,
    percent: getChartPercent(availableItems.length, itemAvailabilityChartTotal),
  },
  {
    label: "Reserved",
    value: reservedItems.length,
    percent: getChartPercent(reservedItems.length, itemAvailabilityChartTotal),
  },
  {
    label: "Borrowed",
    value: borrowedItems.length,
    percent: getChartPercent(borrowedItems.length, itemAvailabilityChartTotal),
  },
  {
    label: "Damaged / Lost",
    value: damagedLostItems.length,
    percent: getChartPercent(damagedLostItems.length, itemAvailabilityChartTotal),
  },
];

const requestStatusChartTotal =
  pendingRequests.length +
  approvedRequests.length +
  borrowedRequests.length +
  returnedRequests.length +
  closedRequests.length;

const requestStatusChart = [
  {
    label: "Pending",
    value: pendingRequests.length,
    percent: getChartPercent(pendingRequests.length, requestStatusChartTotal),
  },
  {
    label: "Approved",
    value: approvedRequests.length,
    percent: getChartPercent(approvedRequests.length, requestStatusChartTotal),
  },
  {
    label: "Borrowed",
    value: borrowedRequests.length,
    percent: getChartPercent(borrowedRequests.length, requestStatusChartTotal),
  },
  {
    label: "Returned",
    value: returnedRequests.length,
    percent: getChartPercent(returnedRequests.length, requestStatusChartTotal),
  },
  {
    label: "Closed",
    value: closedRequests.length,
    percent: getChartPercent(closedRequests.length, requestStatusChartTotal),
  },
  {
    label: "Overdue",
    value: overdueRequests.length,
    percent: getChartPercent(overdueRequests.length, requestStatusChartTotal),
  },
];

const topBorrowedChartMax = Math.max(
  ...frequentlyBorrowedItems.slice(0, 8).map((item) => item.count),
  1
);

const topBorrowedChart = frequentlyBorrowedItems.slice(0, 8).map((item) => ({
  ...item,
  percent: getChartPercent(item.count, topBorrowedChartMax),
}));

const categoryPerformanceMax = Math.max(
  ...categoryReports.map((category) =>
    Math.max(category.totalItems, category.totalRequests)
  ),
  1
);

const categoryPerformanceChart = categoryReports.slice(0, 8).map((category) => ({
  ...category,
  itemPercent: getChartPercent(category.totalItems, categoryPerformanceMax),
  requestPercent: getChartPercent(category.totalRequests, categoryPerformanceMax),
}));

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
      <div className="reports-print-only reports-print-header">
  <h1>QBorrow Reports</h1>
  <p>QR-Based Digital Borrowing System</p>
  <span>Generated: {getReportGeneratedDate()}</span>
  <span>Report Range: {getDateRangeLabel()}</span>

  {isCategoryAdmin && (
    <strong>Assigned categories: {getAssignedCategoryNames()}</strong>
  )}
</div>
<div className="reports-print-only reports-formal-report">
  <section className="reports-print-section">
    <h2>Inventory Summary</h2>

    <table>
      <thead>
        <tr>
          <th>Total Items</th>
          <th>Available</th>
          <th>Reserved</th>
          <th>Borrowed</th>
          <th>Overdue</th>
          <th>Damaged / Lost</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>{visibleItems.length}</td>
          <td>{availableItems.length}</td>
          <td>{reservedItems.length}</td>
          <td>{borrowedItems.length}</td>
          <td>{overdueRequests.length}</td>
          <td>{damagedLostItems.length}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section className="reports-print-section">
    <h2>Borrow Request Summary</h2>

    <table>
      <thead>
        <tr>
          <th>Pending</th>
          <th>Approved</th>
          <th>Active Borrowed</th>
          <th>Returned</th>
          <th>Closed</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>{pendingRequests.length}</td>
          <td>{approvedRequests.length}</td>
          <td>{borrowedRequests.length}</td>
          <td>{returnedRequests.length}</td>
          <td>{closedRequests.length}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section className="reports-print-section">
  <h2>Statistics Overview</h2>

  <table>
    <thead>
      <tr>
        <th>Statistic</th>
        <th>Percentage</th>
        <th>Details</th>
      </tr>
    </thead>

    <tbody>
      {reportStatistics.map((statistic) => (
        <tr key={statistic.label}>
          <td>{statistic.label}</td>
          <td>{statistic.value}%</td>
          <td>{statistic.detail}</td>
        </tr>
      ))}
    </tbody>
  </table>
</section>

  <section className="reports-print-section">
    <h2>Category Report</h2>

    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Total Items</th>
          <th>Available</th>
          <th>Reserved</th>
          <th>Borrowed</th>
          <th>Damaged / Lost</th>
          <th>Total Requests</th>
        </tr>
      </thead>

      <tbody>
        {categoryReports.length === 0 ? (
          <tr>
            <td colSpan="7">No category data available.</td>
          </tr>
        ) : (
          categoryReports.map((category) => (
            <tr key={category.categoryId}>
              <td>{category.categoryName}</td>
              <td>{category.totalItems}</td>
              <td>{category.available}</td>
              <td>{category.reserved}</td>
              <td>{category.borrowed}</td>
              <td>{category.damagedLost}</td>
              <td>{category.totalRequests}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </section>

  <section className="reports-print-section">
    <h2>Frequently Borrowed Items</h2>

    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Item Name</th>
          <th>Category</th>
          <th>Borrow Count</th>
        </tr>
      </thead>

      <tbody>
        {frequentlyBorrowedItems.length === 0 ? (
          <tr>
            <td colSpan="4">No borrowed item records available.</td>
          </tr>
        ) : (
          frequentlyBorrowedItems.slice(0, 10).map((item, index) => (
            <tr key={item.itemKey}>
              <td>{index + 1}</td>
              <td>{item.itemName}</td>
              <td>{item.categoryName}</td>
              <td>{item.count}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </section>

  <section className="reports-print-section">
    <h2>Overdue Items</h2>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Borrower</th>
          <th>Email</th>
          <th>ID Number</th>
          <th>Course / Department</th>
          <th>Expected Return</th>
        </tr>
      </thead>

      <tbody>
        {overdueRequests.length === 0 ? (
          <tr>
            <td colSpan="6">No overdue items.</td>
          </tr>
        ) : (
          overdueRequests.map((request) => (
            <tr key={request.id}>
              <td>{request.itemName || "Untitled Item"}</td>
              <td>{request.borrowerName || "Unnamed Borrower"}</td>
              <td>{request.borrowerEmail || "No email"}</td>
              <td>{getBorrowerIdNumber(request)}</td>
              <td>{cleanDisplay(request.borrowerCourseDepartment)}</td>
              <td>{request.expectedReturnDate || "Not set"}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </section>

  <section className="reports-print-section">
    <h2>Borrowing History</h2>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Borrower</th>
          <th>Category</th>
          <th>Borrow Date</th>
          <th>Expected Return</th>
          <th>Actual Return</th>
          <th>Status</th>
        </tr>
      </thead>

      <tbody>
        {filteredHistory.length === 0 ? (
          <tr>
            <td colSpan="7">No borrowing history found.</td>
          </tr>
        ) : (
          filteredHistory.map((request) => (
            <tr key={request.id}>
              <td>{request.itemName || "Untitled Item"}</td>
              <td>{request.borrowerName || request.borrowerEmail || "Borrower"}</td>
              <td>{getRequestCategoryName(request)}</td>
              <td>{request.borrowDate || "Not set"}</td>
              <td>{request.expectedReturnDate || "Not set"}</td>
              <td>{request.actualReturnDate || "Not returned"}</td>
              <td>{getRequestStatusLabel(request)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </section>

  <section className="reports-print-section">
    <h2>Damaged / Lost Items</h2>

    <table>
      <thead>
        <tr>
          <th>Item Code</th>
          <th>Item Name</th>
          <th>Category</th>
          <th>Availability</th>
          <th>Condition</th>
        </tr>
      </thead>

      <tbody>
        {damagedLostItems.length === 0 ? (
          <tr>
            <td colSpan="5">No damaged or lost items.</td>
          </tr>
        ) : (
          damagedLostItems.map((item) => (
            <tr key={item.id}>
              <td>{item.itemCode || item.id}</td>
              <td>{item.itemName || "Untitled Item"}</td>
              <td>{getItemCategoryName(item)}</td>
              <td>{item.availability || "N/A"}</td>
              <td>{item.condition || item.availability || "N/A"}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </section>
</div>
      {viewingHistoryRequest && (
  <div
    className="reports-history-modal-backdrop"
    role="dialog"
    aria-modal="true"
    onClick={() => setViewingHistoryRequest(null)}
  >
    <section
      className="reports-history-modal-card"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="reports-history-modal-close"
        onClick={() => setViewingHistoryRequest(null)}
        aria-label="Close borrowing history details"
      >
        ×
      </button>

      <div className="reports-history-modal-heading">
        <span>{viewingHistoryRequest.itemCode || viewingHistoryRequest.itemId || "No code"}</span>

        <strong
          className={`reports-status-pill status-${getRequestStatusClass(
            viewingHistoryRequest
          )}`}
        >
          {getRequestStatusLabel(viewingHistoryRequest)}
        </strong>

        <h2>{viewingHistoryRequest.itemName || "Untitled Item"}</h2>
        <p>Complete borrowing record details.</p>
      </div>

      <div className="reports-history-modal-grid">
        <div>
          <span>Borrower</span>
          <strong>{viewingHistoryRequest.borrowerName || "Unnamed Borrower"}</strong>
          <p>{viewingHistoryRequest.borrowerEmail || "No email"}</p>
        </div>

        <div>
          <span>User Type</span>
          <strong>{getBorrowerUserType(viewingHistoryRequest)}</strong>
        </div>

        <div>
          <span>ID Number</span>
          <strong>{getBorrowerIdNumber(viewingHistoryRequest)}</strong>
        </div>

        <div>
          <span>Course / Department</span>
          <strong>{cleanDisplay(viewingHistoryRequest.borrowerCourseDepartment)}</strong>
        </div>

        <div>
          <span>Year / Section</span>
          <strong>{getBorrowerYearSection(viewingHistoryRequest)}</strong>
        </div>

        <div>
          <span>Mobile Number</span>
          <strong>{cleanDisplay(viewingHistoryRequest.borrowerMobileNumber)}</strong>
        </div>

        <div>
          <span>Category</span>
          <strong>{getRequestCategoryName(viewingHistoryRequest)}</strong>
        </div>

        <div>
          <span>Borrow Date</span>
          <strong>{viewingHistoryRequest.borrowDate || "Not set"}</strong>
        </div>

        <div>
          <span>Expected Return</span>
          <strong>{viewingHistoryRequest.expectedReturnDate || "Not set"}</strong>
        </div>

        <div>
          <span>Actual Return</span>
          <strong>{viewingHistoryRequest.actualReturnDate || "Not returned"}</strong>
        </div>

        <div>
          <span>Return Condition</span>
          <strong>{viewingHistoryRequest.returnCondition || "N/A"}</strong>
        </div>
      </div>

      <div className="reports-history-modal-purpose">
        <span>Purpose</span>
        <p>{viewingHistoryRequest.purpose || "No purpose provided."}</p>
      </div>

      <div className="reports-history-modal-actions">
        <button
          type="button"
          className="reports-secondary-btn"
          onClick={() => setViewingHistoryRequest(null)}
        >
          Close
        </button>
      </div>
    </section>
  </div>
)}
{viewingDamagedItem && (
  <div
    className="reports-damaged-modal-backdrop"
    role="dialog"
    aria-modal="true"
    onClick={() => setViewingDamagedItem(null)}
  >
    <section
      className="reports-damaged-modal-card"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="reports-damaged-modal-close"
        onClick={() => setViewingDamagedItem(null)}
        aria-label="Close damaged item details"
      >
        ×
      </button>

      <div className="reports-damaged-modal-heading">
        <span>{viewingDamagedItem.itemCode || viewingDamagedItem.id}</span>
        <h2>{viewingDamagedItem.itemName || "Untitled Item"}</h2>
        <p>Complete damaged or lost item information.</p>
      </div>

      <div className="reports-damaged-modal-grid">
        <div>
          <span>Category</span>
          <strong>{getItemCategoryName(viewingDamagedItem)}</strong>
        </div>

        <div>
          <span>Availability</span>
          <strong>{viewingDamagedItem.availability || "N/A"}</strong>
        </div>

        <div>
          <span>Condition</span>
          <strong>{viewingDamagedItem.condition || viewingDamagedItem.availability || "N/A"}</strong>
        </div>

        <div>
          <span>Item ID</span>
          <strong>{viewingDamagedItem.id}</strong>
        </div>
      </div>

      <div className="reports-damaged-modal-actions">
        <button
          type="button"
          className="reports-secondary-btn"
          onClick={() => setViewingDamagedItem(null)}
        >
          Close
        </button>
      </div>
    </section>
  </div>
)}
 <section className="reports-header reports-header-compact">
  <div className="reports-header-content">
<div className="reports-header-text">
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

<div className="reports-header-actions">
  <button
    type="button"
    className="reports-secondary-btn reports-header-back-btn"
    onClick={() => navigate("/dashboard")}
  >
    Back to Dashboard
  </button>
</div>
  </div>
</section>

<section className="reports-panel reports-export-panel reports-control-export-panel">
  <div className="reports-section-heading">
    <div>
      <h2>Report Controls & Export</h2>
      <p>
        Filter reports by date range, print a PDF copy, or download report
        records as CSV files.
      </p>
    </div>
  </div>

  <div className="reports-export-control-grid">
    <div>
      <label className="qb-label" htmlFor="reports-date-from">
        From Date
      </label>

      <input
        id="reports-date-from"
        type="date"
        value={dateFrom}
        onChange={(event) => setDateFrom(event.target.value)}
      />
    </div>

    <div>
      <label className="qb-label" htmlFor="reports-date-to">
        To Date
      </label>

      <input
        id="reports-date-to"
        type="date"
        value={dateTo}
        onChange={(event) => setDateTo(event.target.value)}
      />
    </div>

<button
  type="button"
  className="reports-refresh-btn"
  onClick={() => fetchReportsData({ showSuccessToast: true })}
>
  Refresh
</button>

    <button
      type="button"
      className="reports-secondary-btn reports-reset-date-btn"
      onClick={resetDateRange}
      disabled={!dateFrom && !dateTo}
    >
      Reset Date
    </button>
  </div>

  <div className="reports-export-range-row">
    <div className="reports-date-range-note reports-compact-range-note">
      <span>Showing report range:</span>
      <strong>{getDateRangeLabel()}</strong>
    </div>

    <button
      type="button"
      className="reports-secondary-btn reports-print-btn reports-inline-print-btn"
      onClick={handlePrintReport}
    >
      Print / Save PDF
    </button>
  </div>

  <div className="reports-export-grid">
    <button
      type="button"
      className="reports-secondary-btn"
      onClick={handleExportBorrowingHistoryCsv}
      disabled={filteredHistory.length === 0}
    >
      Export Borrowing History
    </button>

    <button
      type="button"
      className="reports-secondary-btn"
      onClick={handleExportCategoryReportCsv}
      disabled={categoryReports.length === 0}
    >
      Export Category Report
    </button>

    <button
      type="button"
      className="reports-secondary-btn"
      onClick={handleExportOverdueItemsCsv}
      disabled={overdueRequests.length === 0}
    >
      Export Overdue Items
    </button>

    <button
      type="button"
      className="reports-secondary-btn"
      onClick={handleExportDamagedLostCsv}
      disabled={damagedLostItems.length === 0}
    >
      Export Damaged / Lost
    </button>
  </div>
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

      <section className="reports-panel reports-statistics-panel">
  <div className="reports-section-heading">
    <div>
      <h2>Statistics Overview</h2>
      <p>
        Percentage analytics based on the current visible report range and
        category permissions.
      </p>
    </div>
  </div>

  <div className="reports-statistics-grid">
    {reportStatistics.map((statistic) => (
      <article className="reports-statistics-card" key={statistic.label}>
        <div className="reports-statistics-card-top">
          <h3>{statistic.label}</h3>
          <strong>{statistic.value}%</strong>
        </div>

        <div className="reports-statistics-bar">
          <span style={{ width: `${statistic.value}%` }}></span>
        </div>

        <p>{statistic.detail}</p>
      </article>
    ))}
  </div>
</section>

<section className="reports-panel reports-chart-panel">
  <div className="reports-section-heading">
    <div>
      <h2>Visual Analytics</h2>
      <p>
        Simple chart overview of item availability, request status, frequently
        borrowed items, and category performance.
      </p>
    </div>
  </div>

  <div className="reports-chart-grid">
    <article className="reports-chart-card">
      <div className="reports-chart-card-heading">
        <h3>Item Availability</h3>
        <span>{itemAvailabilityChartTotal} records</span>
      </div>

      <div className="reports-chart-list">
        {itemAvailabilityChart.map((item) => (
          <div className="reports-chart-row" key={item.label}>
            <div className="reports-chart-row-label">
              <strong>{item.label}</strong>
              <span>{item.value}</span>
            </div>

            <div className="reports-chart-bar">
              <span style={{ width: `${item.percent}%` }}></span>
            </div>
          </div>
        ))}
      </div>
    </article>

    <article className="reports-chart-card">
      <div className="reports-chart-card-heading">
        <h3>Request Status</h3>
        <span>{requestStatusChartTotal} records</span>
      </div>

      <div className="reports-chart-list">
        {requestStatusChart.map((request) => (
          <div className="reports-chart-row" key={request.label}>
            <div className="reports-chart-row-label">
              <strong>{request.label}</strong>
              <span>{request.value}</span>
            </div>

            <div className="reports-chart-bar">
              <span style={{ width: `${request.percent}%` }}></span>
            </div>
          </div>
        ))}
      </div>
    </article>

    <article className="reports-chart-card">
      <div className="reports-chart-card-heading">
        <h3>Top Borrowed Items</h3>
        <span>Top {topBorrowedChart.length}</span>
      </div>

      {topBorrowedChart.length === 0 ? (
        <div className="reports-chart-empty">No borrowed item data yet.</div>
      ) : (
        <div className="reports-chart-list">
          {topBorrowedChart.map((item) => (
            <div className="reports-chart-row" key={item.itemKey}>
              <div className="reports-chart-row-label">
                <strong>{item.itemName}</strong>
                <span>{item.count}</span>
              </div>

              <div className="reports-chart-bar">
                <span style={{ width: `${item.percent}%` }}></span>
              </div>

              <small>{item.categoryName}</small>
            </div>
          ))}
        </div>
      )}
    </article>

    <article className="reports-chart-card">
      <div className="reports-chart-card-heading">
        <h3>Category Performance</h3>
        <span>Top {categoryPerformanceChart.length}</span>
      </div>

      {categoryPerformanceChart.length === 0 ? (
        <div className="reports-chart-empty">No category data yet.</div>
      ) : (
        <div className="reports-chart-list">
          {categoryPerformanceChart.map((category) => (
            <div className="reports-chart-row" key={category.categoryId}>
              <div className="reports-chart-row-label">
                <strong>{category.categoryName}</strong>
                <span>{category.totalRequests} req.</span>
              </div>

              <div className="reports-chart-dual">
                <div>
                  <small>Items</small>
                  <div className="reports-chart-bar">
                    <span style={{ width: `${category.itemPercent}%` }}></span>
                  </div>
                </div>

                <div>
                  <small>Requests</small>
                  <div className="reports-chart-bar">
                    <span style={{ width: `${category.requestPercent}%` }}></span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  </div>
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
              <p>Borrowed requests past expected return date.</p>
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
              Showing {displayedHistory.length} of {filteredHistory.length} matched request
              record{filteredHistory.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>
        <div className="reports-history-controls">
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
      <option value="Returned On Time">Returned On Time</option>
      <option value="Returned Late">Returned Late</option>
      <option value="Rejected">Rejected</option>
      <option value="Cancelled">Cancelled</option>
      <option value="Overdue">Overdue</option>
    </select>
  </div>

  <button
    type="button"
    className="reports-secondary-btn reports-clear-history-filter-btn"
    onClick={() => {
      setSearchTerm("");
      setStatusFilter("All");
    }}
    disabled={!searchTerm && statusFilter === "All"}
  >
    Clear Filter
  </button>
</div>

        {filteredHistory.length === 0 ? (
          <div className="reports-empty">
            <img src="/qborrow-logo.png" alt="QBorrow Logo" />
            <h2>No borrowing history found</h2>
            <p>Try changing the search keyword or status filter.</p>
          </div>
        ) : (

          <>
<div className="reports-history-table-header">
  <span>Item</span>
  <span>Borrower</span>
  <span>Category</span>
  <span>Borrow</span>
  <span>Expected</span>
  <span>Status</span>
  <span>Action</span>
</div>

<div className="reports-history-table-grid">
  {displayedHistory.map((request) => (
    <article className="reports-history-table-row" key={request.id}>
      <div className="reports-history-table-cell reports-history-item-cell">
        <span>{request.itemCode || request.itemId || "No code"}</span>
        <strong>{request.itemName || "Untitled Item"}</strong>
      </div>

      <div className="reports-history-table-cell reports-history-borrower-cell">
        <span>{request.borrowerEmail || "No email"}</span>
        <strong>{request.borrowerName || "Unnamed Borrower"}</strong>
      </div>

      <div className="reports-history-table-cell">
        <span>Category</span>
        <strong>{getRequestCategoryName(request)}</strong>
      </div>

      <div className="reports-history-table-cell">
        <span>Borrow</span>
        <strong>{request.borrowDate || "Not set"}</strong>
      </div>

      <div className="reports-history-table-cell">
        <span>Expected</span>
        <strong>{request.expectedReturnDate || "Not set"}</strong>
      </div>

      <div className="reports-history-table-status">
        <strong
          className={`reports-status-pill status-${getRequestStatusClass(
            request
          )}`}
        >
          {getRequestStatusLabel(request)}
        </strong>
      </div>

      <div className="reports-history-table-actions">
        <button
          type="button"
          className="reports-secondary-btn"
          onClick={() => setViewingHistoryRequest(request)}
        >
          Details
        </button>
      </div>
    </article>
  ))}
</div>

            {hasMoreHistory && (
              <div className="reports-load-more-row">
                <button
                  type="button"
                  className="reports-secondary-btn"
                  onClick={handleLoadMoreHistory}
                >
                  Load More History
                </button>
              </div>
            )}
          </>
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
  <>
    <div className="reports-damaged-table-header">
      <span>Item</span>
      <span>Category</span>
      <span>Availability</span>
      <span>Condition</span>
      <span>Action</span>
    </div>

    <div className="reports-damaged-table-grid">
      {damagedLostItems.map((item) => (
        <article className="reports-damaged-table-row" key={item.id}>
          <div className="reports-damaged-table-cell reports-damaged-item-cell">
            <span>{item.itemCode || item.id}</span>
            <strong>{item.itemName || "Untitled Item"}</strong>
          </div>

          <div className="reports-damaged-table-cell">
            <span>Category</span>
            <strong>{getItemCategoryName(item)}</strong>
          </div>

          <div className="reports-damaged-table-cell">
            <span>Availability</span>
            <strong>{item.availability || "N/A"}</strong>
          </div>

          <div className="reports-damaged-table-status">
            <strong className="reports-damage-pill">
              {item.condition || item.availability || "N/A"}
            </strong>
          </div>

          <div className="reports-damaged-table-actions">
            <button
              type="button"
              className="reports-secondary-btn"
              onClick={() => setViewingDamagedItem(item)}
            >
              Details
            </button>
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

export default Reports;