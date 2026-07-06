import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
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
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
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
  const [duplicatingId, setDuplicatingId] = useState("");
  const [selectedPrintItemIds, setSelectedPrintItemIds] = useState([]);
  const [printingLabels, setPrintingLabels] = useState(false);

  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const userData = outletContext?.userData || localUserData;

  const deleteLockRef = useRef("");
  const duplicateLockRef = useRef("");

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

function startDuplicateAction(itemId) {
  if (duplicateLockRef.current || duplicatingId) {
    return false;
  }

  duplicateLockRef.current = itemId;
  setDuplicatingId(itemId);

  return true;
}

function finishDuplicateAction() {
  duplicateLockRef.current = "";
  setDuplicatingId("");
}

function isDuplicateBusy() {
  return Boolean(duplicateLockRef.current || duplicatingId);
}

function isInventoryActionBusy() {
  return Boolean(isDeleteBusy() || isDuplicateBusy() || printingLabels);
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

function sanitizePrintText(value, fallback = "Not set") {
  return String(value || fallback)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getFinalQrValue(item) {
  return item.qrValue || `${window.location.origin}/item/${item.id}`;
}

function getFinalBarcodeValue(item) {
  return item.barcodeValue || item.itemCode || item.id || "";
}

function isPrintItemSelected(itemId) {
  return selectedPrintItemIds.includes(itemId);
}

function togglePrintItemSelection(itemId) {
  setSelectedPrintItemIds((previousIds) => {
    if (previousIds.includes(itemId)) {
      return previousIds.filter((selectedId) => selectedId !== itemId);
    }

    return [...previousIds, itemId];
  });
}

function selectVisiblePrintItems() {
  setSelectedPrintItemIds(filteredItems.map((item) => item.id));
}

function clearPrintSelection() {
  setSelectedPrintItemIds([]);
}

async function generatePrintLabelData(item) {
  const finalQrValue = getFinalQrValue(item);
  const finalBarcodeValue = getFinalBarcodeValue(item);

  if (!finalQrValue || !finalBarcodeValue) {
    throw new Error(`Missing QR or barcode value for ${item.itemName || "an item"}.`);
  }

  const qrImage = await QRCode.toDataURL(finalQrValue, {
    width: 220,
    margin: 2,
    errorCorrectionLevel: "H",
    color: {
      dark: "#1E293B",
      light: "#FFFFFF",
    },
  });

  const barcodeCanvas = document.createElement("canvas");

  JsBarcode(barcodeCanvas, finalBarcodeValue, {
    format: "CODE128",
    width: 2,
    height: 78,
    displayValue: true,
    font: "monospace",
    fontSize: 15,
    textMargin: 7,
    margin: 16,
    lineColor: "#000000",
    background: "#FFFFFF",
  });

  return {
    id: item.id,
    itemName: item.itemName || "Untitled Item",
    itemCode: getItemCode(item),
    categoryName: getItemCategoryName(item),
    condition: item.condition || "Unknown",
    availability: item.availability || "Unavailable",
    bulkSequence: item.bulkSequence || "",
    bulkTotal: item.bulkTotal || "",
    qrImage,
    barcodeImage: barcodeCanvas.toDataURL("image/png"),
  };
}

function openPrintWindow(labelData, printTitle = "QBorrow QR / Barcode Labels") {
  const printWindow = window.open("", "_blank", "width=1100,height=900");

  if (!printWindow) {
    showBlockedAction("Popup blocked. Please allow popups to print labels.");
    return false;
  }

  const cards = labelData
    .map((label) => {
      const sequenceLabel = label.bulkSequence
        ? `<div class="sequence">Piece ${sanitizePrintText(label.bulkSequence)} of ${sanitizePrintText(label.bulkTotal || "?")}</div>`
        : "";

      return `
        <article class="label-card">
          <div class="label-header">
            <div>
              <h2>${sanitizePrintText(label.itemName)}</h2>
              <p>${sanitizePrintText(label.itemCode)}</p>
            </div>
            ${sequenceLabel}
          </div>

          <div class="code-row">
            <img class="qr" src="${label.qrImage}" alt="QR Code" />
            <div class="label-meta">
              <span>Category</span>
              <strong>${sanitizePrintText(label.categoryName)}</strong>
              <span>Condition</span>
              <strong>${sanitizePrintText(label.condition)}</strong>
              <span>Availability</span>
              <strong>${sanitizePrintText(label.availability)}</strong>
            </div>
          </div>

          <img class="barcode" src="${label.barcodeImage}" alt="Barcode" />
          <div class="scan-note">Scan using QBorrow QR / Barcode Scanner</div>
        </article>
      `;
    })
    .join("");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${sanitizePrintText(printTitle)}</title>
        <style>
          * { box-sizing: border-box; }

          body {
            margin: 0;
            padding: 24px;
            font-family: Arial, sans-serif;
            color: #1E293B;
            background: #ffffff;
          }

          .print-header {
            margin-bottom: 18px;
            border: 3px solid #1E293B;
            border-radius: 18px;
            padding: 14px 18px;
          }

          .print-header h1 {
            margin: 0;
            font-size: 22px;
            line-height: 1.1;
          }

          .print-header p {
            margin: 6px 0 0;
            color: #64748B;
            font-size: 13px;
            font-weight: 700;
          }

          .label-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
          }

          .label-card {
            break-inside: avoid;
            page-break-inside: avoid;
            border: 3px solid #1E293B;
            border-radius: 18px;
            padding: 14px;
            min-height: 310px;
          }

          .label-header {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
          }

          h2 {
            margin: 0;
            font-size: 17px;
            line-height: 1.1;
          }

          .label-header p {
            margin: 5px 0 0;
            font-size: 12px;
            font-weight: 800;
          }

          .sequence {
            min-width: 74px;
            height: fit-content;
            border-radius: 999px;
            background: #FEF3C7;
            padding: 6px 8px;
            font-size: 10px;
            font-weight: 800;
            text-align: center;
            white-space: nowrap;
          }

          .code-row {
            display: grid;
            grid-template-columns: 145px minmax(0, 1fr);
            gap: 10px;
            align-items: center;
          }

          .qr {
            width: 145px;
            height: 145px;
            object-fit: contain;
          }

          .label-meta {
            display: grid;
            gap: 4px;
            font-size: 11px;
          }

          .label-meta span {
            color: #64748B;
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .label-meta strong {
            margin-bottom: 4px;
            font-size: 12px;
            line-height: 1.2;
          }

          .barcode {
            width: 100%;
            max-height: 82px;
            object-fit: contain;
            margin-top: 8px;
            background: #ffffff;
          }

          .scan-note {
            margin-top: 8px;
            color: #64748B;
            font-size: 10px;
            font-weight: 700;
            text-align: center;
          }

          @media print {
            body { padding: 12px; }
            .label-grid { gap: 10px; }
            .label-card { border-width: 2px; }
          }
        </style>
      </head>

      <body>
        <section class="print-header">
          <h1>${sanitizePrintText(printTitle)}</h1>
          <p>${labelData.length} label${labelData.length === 1 ? "" : "s"} prepared for printing.</p>
        </section>

        <section class="label-grid">
          ${cards}
        </section>

        <script>
          window.onload = function () {
            window.print();
          };
        </script>
      </body>
    </html>
  `);

  printWindow.document.close();
  return true;
}

async function handlePrintItems(targetItems, printTitle) {
  if (!isAdmin) return;

  if (!targetItems || targetItems.length === 0) {
    showBlockedAction("Please select at least one item to print.");
    return;
  }

  setPrintingLabels(true);

  try {
    const labelData = [];

    for (const item of targetItems) {
      // Generate in sequence so low-end devices do not freeze when printing many labels.
      // eslint-disable-next-line no-await-in-loop
      labelData.push(await generatePrintLabelData(item));
    }

    const opened = openPrintWindow(labelData, printTitle);

    if (opened) {
      showToast("Print labels opened", "success");
    }
  } catch (error) {
    showActionError("Failed to prepare print labels", error);
  } finally {
    setPrintingLabels(false);
  }
}

async function handlePrintSelectedItems() {
  const selectedItems = roleVisibleItems
    .filter((item) => selectedPrintItemIds.includes(item.id))
    .sort((a, b) => String(getItemCode(a)).localeCompare(String(getItemCode(b))));

  await handlePrintItems(selectedItems, "QBorrow Selected Item Labels");
}

async function handlePrintVisibleItems() {
  await handlePrintItems(filteredItems, "QBorrow Visible Item Labels");
}

async function handlePrintBatch(batchCode) {
  if (!batchCode) return;

  setPrintingLabels(true);

  try {
    const batchQuery = firestoreQuery(
      collection(db, "items"),
      where("bulkBatchCode", "==", batchCode)
    );

    const batchSnapshot = await getDocs(batchQuery);

    const batchItems = batchSnapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      .filter((item) => canCategoryAdminSeeItem(item))
      .sort((a, b) => Number(a.bulkSequence || 0) - Number(b.bulkSequence || 0));

    if (batchItems.length === 0) {
      showBlockedAction("No printable items were found for this batch.");
      return;
    }

    const firstItem = batchItems[0];

    const labelData = [];

    for (const item of batchItems) {
      // eslint-disable-next-line no-await-in-loop
      labelData.push(await generatePrintLabelData(item));
    }

    const printTitle = `${firstItem.itemName || "Item"} Batch Labels - ${batchCode}`;
    const opened = openPrintWindow(labelData, printTitle);

    if (opened) {
      showToast("Batch print labels opened", "success");
    }
  } catch (error) {
    showActionError("Failed to print batch labels", error);
  } finally {
    setPrintingLabels(false);
  }
}

function getAdminId() {
  return userData?.uid || auth.currentUser?.uid || "";
}

function getAdminEmail() {
  return userData?.email || auth.currentUser?.email || "";
}

function sanitizeCodePart(value, fallback = "QBR", maxLength = 4) {
  const cleanedValue = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return (cleanedValue || fallback).slice(0, maxLength);
}

function getTodayDateKey() {
  const date = new Date();
  const timezoneOffset = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - timezoneOffset).toISOString().split("T")[0];
}

function generateDuplicateItemCode(sourceItem) {
  const categoryPrefix = sanitizeCodePart(
    getItemCategoryId(sourceItem) || getItemCategoryName(sourceItem),
    "QBR",
    3
  );

  const itemPrefix = sanitizeCodePart(sourceItem?.itemName, "ITEM", 4);
  const timePart = Date.now().toString().slice(-6);
  const randomPart = Math.floor(1000 + Math.random() * 9000);

  return `${categoryPrefix}-${itemPrefix}-${timePart}-${randomPart}`;
}

function getDuplicateAvailability(sourceItem) {
  if (sourceItem?.condition === "Damaged") return "Damaged";
  if (sourceItem?.condition === "Lost") return "Lost";

  return "Available";
}

function getDuplicateCondition(sourceItem) {
  return sourceItem?.condition || "Good";
}

async function handleDuplicateItem(item) {
  if (!isAdmin) return;

  if (isInventoryActionBusy()) return;

  if (!canCategoryAdminSeeItem(item)) {
    showBlockedAction("You can only duplicate items inside your assigned categories.");
    return;
  }

  openConfirmAction({
    title: "Duplicate Item?",
    message: `Create a new copy of "${item.itemName || "this item"}" with a new item code, QR code, and barcode?`,
    confirmText: "Duplicate Item",
    cancelText: "Cancel",
    onConfirm: async () => {
      const started = startDuplicateAction(item.id);

      if (!started) return;

      try {
        const sourceRef = doc(db, "items", item.id);
        const sourceSnap = await getDoc(sourceRef);

        if (!sourceSnap.exists()) {
          showBlockedAction("This item no longer exists.");
          await fetchItemsAndCategories();
          return;
        }

        const sourceItem = {
          id: sourceSnap.id,
          ...sourceSnap.data(),
        };

        if (!canCategoryAdminSeeItem(sourceItem)) {
          showBlockedAction("You can only duplicate items inside your assigned categories.");
          return;
        }

        const newItemCode = generateDuplicateItemCode(sourceItem);
        const duplicateCondition = getDuplicateCondition(sourceItem);
        const duplicateAvailability = getDuplicateAvailability(sourceItem);
        const isDuplicateDamagedLost = ["Damaged", "Lost"].includes(duplicateAvailability);

        const duplicateRef = await addDoc(collection(db, "items"), {
          itemCode: newItemCode,
          itemName: sourceItem.itemName || "Untitled Item Copy",
          imageUrl: sourceItem.imageUrl || "",
          description: sourceItem.description || "",

          categoryId: getItemCategoryId(sourceItem),
          categoryName: getItemCategoryName(sourceItem),
          category: getItemCategoryId(sourceItem),

          condition: duplicateCondition,
          availability: duplicateAvailability,
          maxBorrowDays: Number(sourceItem.maxBorrowDays) || 1,

          qrValue: "",
          barcodeValue: "",

          duplicatedFromItemId: sourceItem.id,
          duplicatedFromItemCode: getItemCode(sourceItem),
          duplicatedAt: serverTimestamp(),
          duplicatedBy: getAdminId(),
          duplicatedByEmail: getAdminEmail(),

          ...(isDuplicateDamagedLost
            ? {
                damagedLostAt: serverTimestamp(),
                damagedLostDate: getTodayDateKey(),
                damagedLostBy: getAdminId(),
                damagedLostByEmail: getAdminEmail(),
                damagedLostStatus: duplicateAvailability,
                damagedLostReport: `Item duplicated with ${duplicateAvailability} status.`,
                damagedLostSource: "duplicateItem",
              }
            : {}),

          createdBy: getAdminId(),
          createdByEmail: getAdminEmail(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await updateDoc(duplicateRef, {
          qrValue: `${window.location.origin}/item/${duplicateRef.id}`,
          barcodeValue: duplicateRef.id,
          updatedAt: serverTimestamp(),
        });

        showToast("Item duplicated successfully", "success");
        await fetchItemsAndCategories();
      } catch (error) {
        showActionError("Failed to duplicate item", error);
      } finally {
        finishDuplicateAction();
      }
    },
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

  const printableBatchGroups = useMemo(() => {
    const batchMap = new Map();

    filteredItems.forEach((item) => {
      if (!item.bulkCreated || !item.bulkBatchCode) return;

      if (!batchMap.has(item.bulkBatchCode)) {
        batchMap.set(item.bulkBatchCode, {
          batchCode: item.bulkBatchCode,
          itemName: item.itemName || "Untitled Item",
          categoryName: getItemCategoryName(item),
          visibleCount: 0,
          total: item.bulkTotal || 0,
        });
      }

      const batch = batchMap.get(item.bulkBatchCode);
      batch.visibleCount += 1;
      batch.total = Math.max(Number(batch.total || 0), Number(item.bulkTotal || 0));
    });

    return Array.from(batchMap.values()).sort((a, b) =>
      String(a.itemName || "").localeCompare(String(b.itemName || ""))
    );
  }, [filteredItems]);

  useEffect(() => {
    setSelectedPrintItemIds((previousIds) => {
      const visibleIds = new Set(roleVisibleItems.map((item) => item.id));
      return previousIds.filter((itemId) => visibleIds.has(itemId));
    });
  }, [roleVisibleItems]);

  function getAvailabilityClass(availability) {
    if (availability === "Available") return "available";
    if (availability === "Reserved") return "reserved";
    if (availability === "Borrowed") return "borrowed";
    if (availability === "Under Maintenance") return "maintenance";
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
      item.availability === "Under Maintenance" ||
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
            {!isBorrower && <option value="Under Maintenance">Under Maintenance</option>}
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
            disabled={isDeleteBusy() || isDuplicateBusy() || loadingMoreItems}
          >
            Refresh
          </button>
        </div>

        {isAdmin && filteredItems.length > 0 && (
          <div className="inventory-print-panel">
            <div className="inventory-print-heading">
              <strong>Bulk QR / Barcode Printing</strong>
              <span>
                {selectedPrintItemIds.length} selected • {filteredItems.length} visible
              </span>
            </div>

            <div className="inventory-print-actions">
              <button
                type="button"
                className="inventory-refresh-btn"
                onClick={selectVisiblePrintItems}
                disabled={printingLabels || isDeleteBusy() || isDuplicateBusy()}
              >
                Select Visible
              </button>

              <button
                type="button"
                className="inventory-refresh-btn"
                onClick={clearPrintSelection}
                disabled={printingLabels || selectedPrintItemIds.length === 0}
              >
                Clear Selection
              </button>

              <button
                type="button"
                className="inventory-add-btn"
                onClick={handlePrintSelectedItems}
                disabled={printingLabels || selectedPrintItemIds.length === 0}
              >
                {printingLabels ? "Preparing..." : "Print Selected Labels"}
              </button>

              <button
                type="button"
                className="inventory-refresh-btn"
                onClick={handlePrintVisibleItems}
                disabled={printingLabels || filteredItems.length === 0}
              >
                Print Visible
              </button>
            </div>

            {printableBatchGroups.length > 0 && (
              <div className="inventory-batch-print-list">
                {printableBatchGroups.map((batch) => (
                  <button
                    type="button"
                    key={batch.batchCode}
                    className="inventory-batch-print-btn"
                    onClick={() => handlePrintBatch(batch.batchCode)}
                    disabled={printingLabels}
                  >
                    <span>{batch.itemName}</span>
                    <strong>
                      Print Batch {batch.visibleCount}/{batch.total || batch.visibleCount}
                    </strong>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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
                  <th scope="col">Print</th>
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
                    <td data-label="Print">
                      <label className="inventory-print-check">
                        <input
                          type="checkbox"
                          checked={isPrintItemSelected(item.id)}
                          onChange={() => togglePrintItemSelection(item.id)}
                          disabled={printingLabels || isDeleteBusy() || isDuplicateBusy()}
                        />
                        <span>Select</span>
                      </label>
                    </td>

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
                          disabled={isDeleteBusy() || isDuplicateBusy()}
                          aria-label={`View ${item.itemName || "item"}`}
                          data-tooltip="View"
                        >
                          <span aria-hidden="true">👁</span>
                          <span className="inventory-action-text">View</span>
                        </button>

                        <button
                          type="button"
                          className="inventory-icon-action print-btn"
                          onClick={() => handlePrintItems([item], `${item.itemName || "Item"} Label`)}
                          disabled={printingLabels || isDeleteBusy() || isDuplicateBusy()}
                          aria-label={`Print ${item.itemName || "item"} label`}
                          data-tooltip="Print Label"
                        >
                          <span aria-hidden="true">▣</span>
                          <span className="inventory-action-text">Print</span>
                        </button>

                        <button
                          type="button"
                          className="inventory-icon-action edit-btn"
                          onClick={() => navigate(`/edit-item?id=${item.id}`)}
                          disabled={isDeleteBusy() || isDuplicateBusy()}
                          aria-label={`Edit ${item.itemName || "item"}`}
                          data-tooltip="Edit"
                        >
                          <span aria-hidden="true">✎</span>
                          <span className="inventory-action-text">Edit</span>
                        </button>

                        <button
                          type="button"
                          className="inventory-icon-action duplicate-btn"
                          onClick={() => handleDuplicateItem(item)}
                          disabled={isInventoryActionBusy()}
                          aria-label={`Duplicate ${item.itemName || "item"}`}
                          data-tooltip={duplicatingId === item.id ? "Duplicating" : "Duplicate"}
                        >
                          <span aria-hidden="true">
                            {duplicatingId === item.id ? "…" : "⧉"}
                          </span>
                          <span className="inventory-action-text">
                            {duplicatingId === item.id ? "Duplicating..." : "Duplicate"}
                          </span>
                        </button>

                        <button
                          type="button"
                          className="inventory-icon-action delete-btn"
                          onClick={() => handleDeleteItem(item)}
                          disabled={isDeleteBusy() || isDuplicateBusy()}
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