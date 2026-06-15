import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  query as firestoreQuery,
  orderBy,
  limit,
  startAfter,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, secondaryAuth, functions } from "../firebase/firebaseConfig";
import "../styles/UserManagement.css";

const USERS_PAGE_SIZE = 5;

function UserManagement() {
  const outletContext = useOutletContext() || {};
  const { userData: currentAdmin } = outletContext;

  const [users, setUsers] = useState([]);
  const [lastUserDoc, setLastUserDoc] = useState(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [loadingMoreUsers, setLoadingMoreUsers] = useState(false);

  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [borrowRequests, setBorrowRequests] = useState([]);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [categoryAction, setCategoryAction] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [role, setRole] = useState("borrower");
  const [assignedCategories, setAssignedCategories] = useState([]);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [showCategoryList, setShowCategoryList] = useState(false);

  const [csvFileName, setCsvFileName] = useState("");
  const [csvBorrowers, setCsvBorrowers] = useState([]);
  const [importResults, setImportResults] = useState([]);

  const [editingUserId, setEditingUserId] = useState("");
  const [editRole, setEditRole] = useState("borrower");
  const [editAssignedCategories, setEditAssignedCategories] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function formatSuspendedUntil(value) {
    if (!value) return "Not suspended";

    if (typeof value?.toDate === "function") {
      return value.toDate().toLocaleDateString();
    }

    if (typeof value === "string") {
      return value || "Not suspended";
    }

    return "Not suspended";
  }

  function isUserSuspended(user) {
    if (!user.suspendedUntil) return false;

    let suspendedDate = null;

    if (typeof user.suspendedUntil?.toDate === "function") {
      suspendedDate = user.suspendedUntil.toDate();
    } else {
      suspendedDate = new Date(user.suspendedUntil);
    }

    if (!suspendedDate || Number.isNaN(suspendedDate.getTime())) {
      return false;
    }

    return suspendedDate > new Date();
  }

  function getRoleLabel(userRole) {
    if (userRole === "superAdmin") return "Super Admin";
    if (userRole === "categoryAdmin") return "Category Admin";
    return "Borrower";
  }

  function getCategoryName(categoryId) {
    const category = categories.find(
      (item) => normalizeText(item.id) === normalizeText(categoryId)
    );

    return category?.name || categoryId || "Unknown";
  }

  function formatAssignedCategories(categoryIds) {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return "None";
    }

    return categoryIds.map(getCategoryName).join(", ");
  }

  async function fetchUsersPage(mode = "reset") {
    const userQuery =
      mode === "more" && lastUserDoc
        ? firestoreQuery(
            collection(db, "users"),
            orderBy("email", "asc"),
            startAfter(lastUserDoc),
            limit(USERS_PAGE_SIZE + 1)
          )
        : firestoreQuery(
            collection(db, "users"),
            orderBy("email", "asc"),
            limit(USERS_PAGE_SIZE + 1)
          );

    const usersSnapshot = await getDocs(userQuery);
    const docs = usersSnapshot.docs;
    const visibleDocs = docs.slice(0, USERS_PAGE_SIZE);

    const userData = visibleDocs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

    setHasMoreUsers(docs.length > USERS_PAGE_SIZE);
    setLastUserDoc(visibleDocs[visibleDocs.length - 1] || null);

    if (mode === "more") {
      setUsers((previousUsers) => {
        const existingIds = new Set(previousUsers.map((user) => user.id));
        const newUsers = userData.filter((user) => !existingIds.has(user.id));

        return [...previousUsers, ...newUsers];
      });

      return;
    }

    setUsers(userData);
  }

  async function handleLoadMoreUsers() {
    if (!hasMoreUsers || loadingMoreUsers) return;

    setLoadingMoreUsers(true);
    showStatus("", "");

    try {
      await fetchUsersPage("more");
    } catch (error) {
      showStatus("Error loading more users: " + error.message, "error");
    } finally {
      setLoadingMoreUsers(false);
    }
  }

  async function fetchData() {
    setLoading(true);

    try {
      const [categoriesSnapshot, itemsSnapshot, requestsSnapshot] =
        await Promise.all([
          getDocs(collection(db, "categories")),
          getDocs(collection(db, "items")),
          getDocs(collection(db, "borrowRequests")),
        ]);

      const categoryData = categoriesSnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""))
        );

      const itemData = itemsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const requestData = requestsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setCategories(categoryData);
      setItems(itemData);
      setBorrowRequests(requestData);

      await fetchUsersPage("reset");
    } catch (error) {
      showStatus("Error loading user management data: " + error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function handleCategoryToggle(categoryId) {
    setAssignedCategories((previousCategories) => {
      if (previousCategories.includes(categoryId)) {
        return previousCategories.filter((category) => category !== categoryId);
      }

      return [...previousCategories, categoryId];
    });
  }

  function handleEditCategoryToggle(categoryId) {
    setEditAssignedCategories((previousCategories) => {
      if (previousCategories.includes(categoryId)) {
        return previousCategories.filter((category) => category !== categoryId);
      }

      return [...previousCategories, categoryId];
    });
  }

  function resetCreateForm() {
    setFullName("");
    setEmail("");
    setTemporaryPassword("");
    setRole("borrower");
    setAssignedCategories([]);
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    showStatus("", "");

    if (!fullName.trim() || !email.trim() || !temporaryPassword.trim() || !role) {
      showStatus("Please fill in all fields.", "error");
      return;
    }

    if (temporaryPassword.length < 6) {
      showStatus("Temporary password must be at least 6 characters.", "error");
      return;
    }

    if (role === "categoryAdmin" && categories.length === 0) {
      showStatus("Please add or seed categories first.", "error");
      return;
    }

    if (role === "categoryAdmin" && assignedCategories.length === 0) {
      showStatus("Please assign at least one category for category admin.", "error");
      return;
    }

    setCreating(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(
        secondaryAuth,
        email.trim().toLowerCase(),
        temporaryPassword
      );

      const newUser = userCredential.user;

      await setDoc(doc(db, "users", newUser.uid), {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        assignedCategories: role === "categoryAdmin" ? assignedCategories : [],
        overdueCount: 0,
        suspendedUntil: "",
        suspensionReason: "",
        canBorrow: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await signOut(secondaryAuth);

      showStatus("User account created successfully.", "success");
      resetCreateForm();
      fetchData();
    } catch (error) {
      showStatus("Error creating user: " + error.message, "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleSeedCategories() {
    const confirmSeed = window.confirm(
      "Seed default categories: Sports, Laboratory, STEM, and IT?"
    );

    if (!confirmSeed) return;

    setCategoryAction("seed");
    showStatus("", "");

    try {
      const seedDefaultCategories = httpsCallable(
        functions,
        "seedDefaultCategories"
      );

      await seedDefaultCategories();

      showStatus("Default categories are ready.", "success");
      fetchData();
    } catch (error) {
      showStatus("Error seeding categories: " + error.message, "error");
    } finally {
      setCategoryAction("");
    }
  }

  async function handleAddCategory(event) {
    event.preventDefault();
    showStatus("", "");

    if (!newCategoryName.trim()) {
      showStatus("Please enter a category name.", "error");
      return;
    }

    setCategoryAction("add");

    try {
      const addCategory = httpsCallable(functions, "addCategory");

      await addCategory({
        name: newCategoryName.trim(),
      });

      showStatus("Category added successfully.", "success");
      setNewCategoryName("");
      fetchData();
    } catch (error) {
      showStatus("Error adding category: " + error.message, "error");
    } finally {
      setCategoryAction("");
    }
  }

  async function handleDeleteCategory(category) {
    const usage = getCategoryUsage(category.id);

    if (!usage.canDelete) {
      showStatus(
        "This category cannot be deleted because it is still used by items, admins, or borrow requests.",
        "error"
      );
      return;
    }

    const confirmDelete = window.confirm(
      `Delete category "${category.name}"? This is allowed only because it has no items, admins, or borrow requests.`
    );

    if (!confirmDelete) return;

    setCategoryAction(category.id);
    showStatus("", "");

    try {
      const deleteCategory = httpsCallable(functions, "deleteCategory");

      await deleteCategory({
        categoryId: category.id,
      });

      showStatus("Category deleted successfully.", "success");
      fetchData();
    } catch (error) {
      showStatus("Error deleting category: " + error.message, "error");
    } finally {
      setCategoryAction("");
    }
  }

  function startEditingUser(user) {
    setEditingUserId(user.id);
    setEditRole(user.role || "borrower");
    setEditAssignedCategories(
      Array.isArray(user.assignedCategories) ? user.assignedCategories : []
    );
  }

  function cancelEditingUser() {
    setEditingUserId("");
    setEditRole("borrower");
    setEditAssignedCategories([]);
  }

  async function handleSaveUserChanges(user) {
    if (editRole === "categoryAdmin" && categories.length === 0) {
      showStatus("Please add or seed categories first.", "error");
      return;
    }

    if (editRole === "categoryAdmin" && editAssignedCategories.length === 0) {
      showStatus("Category admin must have at least one assigned category.", "error");
      return;
    }

    setUpdatingId(user.id);
    showStatus("", "");

    try {
      const userRef = doc(db, "users", user.id);

      await updateDoc(userRef, {
        role: editRole,
        assignedCategories: editRole === "categoryAdmin"
          ? editAssignedCategories
          : [],
        updatedAt: serverTimestamp(),
      });

      showStatus("User role and categories updated successfully.", "success");
      cancelEditingUser();
      fetchData();
    } catch (error) {
      showStatus("Error updating user: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleToggleBorrowing(user) {
    const nextValue = user.canBorrow === false;

    const confirmAction = window.confirm(
      nextValue
        ? `Enable borrowing for ${user.fullName || user.email}?`
        : `Disable borrowing for ${user.fullName || user.email}?`
    );

    if (!confirmAction) return;

    setUpdatingId(user.id);
    showStatus("", "");

    try {
      const userRef = doc(db, "users", user.id);

      await updateDoc(userRef, {
        canBorrow: nextValue,
        updatedAt: serverTimestamp(),
      });

      showStatus(
        nextValue ? "Borrowing enabled." : "Borrowing disabled.",
        "success"
      );

      fetchData();
    } catch (error) {
      showStatus("Error updating borrowing status: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleResetSuspension(user) {
    const confirmReset = window.confirm(
      `Reset suspension and overdue count for ${user.fullName || user.email}?`
    );

    if (!confirmReset) return;

    setUpdatingId(user.id);
    showStatus("", "");

    try {
      const userRef = doc(db, "users", user.id);

      await updateDoc(userRef, {
        overdueCount: 0,
        suspendedUntil: "",
        suspensionReason: "",
        canBorrow: true,
        updatedAt: serverTimestamp(),
      });

      showStatus("Suspension record reset successfully.", "success");
      fetchData();
    } catch (error) {
      showStatus("Error resetting suspension: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleDeleteUser(user) {
    if (user.role === "superAdmin") {
      showStatus("Super admin accounts cannot be deleted here.", "error");
      return;
    }

    if (currentAdmin?.uid === user.id) {
      showStatus("You cannot delete your own account.", "error");
      return;
    }

    const confirmDelete = window.confirm(
      `Permanently delete ${user.fullName || user.email}? This deletes the Firebase Auth account and Firestore user record.`
    );

    if (!confirmDelete) return;

    setUpdatingId(user.id);
    showStatus("", "");

    try {
      const deleteUserCompletely = httpsCallable(
        functions,
        "deleteUserCompletely"
      );

      await deleteUserCompletely({
        uid: user.id,
      });

      showStatus("User deleted completely.", "success");
      fetchData();
    } catch (error) {
      showStatus("Error deleting user: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
  }

  function parseCsvText(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let insideQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const nextCharacter = text[index + 1];

      if (character === '"' && insideQuotes && nextCharacter === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      if (character === '"') {
        insideQuotes = !insideQuotes;
        continue;
      }

      if (character === "," && !insideQuotes) {
        row.push(cell.trim());
        cell = "";
        continue;
      }

      if ((character === "\n" || character === "\r") && !insideQuotes) {
        if (character === "\r" && nextCharacter === "\n") {
          index += 1;
        }

        row.push(cell.trim());

        if (row.some((value) => value !== "")) {
          rows.push(row);
        }

        row = [];
        cell = "";
        continue;
      }

      cell += character;
    }

    row.push(cell.trim());

    if (row.some((value) => value !== "")) {
      rows.push(row);
    }

    return rows;
  }

  function findHeaderIndex(headers, possibleNames) {
    return headers.findIndex((header) => possibleNames.includes(header));
  }

  async function handleCsvChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    setCsvBorrowers([]);
    setImportResults([]);
    setCsvFileName("");

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      showStatus("Please upload a CSV file only.", "error");
      return;
    }

    try {
      const text = await file.text();
      const rows = parseCsvText(text);

      if (rows.length < 2) {
        showStatus("CSV must contain headers and at least one borrower.", "error");
        return;
      }

      const headers = rows[0].map((header) =>
        header.trim().toLowerCase().replace(/\s+/g, " ")
      );

      const nameIndex = findHeaderIndex(headers, [
        "name",
        "full name",
        "fullname",
      ]);

      const emailIndex = findHeaderIndex(headers, ["email", "email address"]);

      const passwordIndex = findHeaderIndex(headers, [
        "password",
        "temporary password",
        "temp password",
      ]);

      if (nameIndex === -1 || emailIndex === -1 || passwordIndex === -1) {
        showStatus(
          "CSV headers must include Name, Email, and Password.",
          "error"
        );
        return;
      }

      const borrowers = rows
        .slice(1)
        .map((row) => ({
          fullName: row[nameIndex] || "",
          email: row[emailIndex] || "",
          password: row[passwordIndex] || "",
        }))
        .filter(
          (borrower) =>
            borrower.fullName.trim() ||
            borrower.email.trim() ||
            borrower.password.trim()
        );

      if (borrowers.length === 0) {
        showStatus("No valid borrower rows found in the CSV.", "error");
        return;
      }

      if (borrowers.length > 100) {
        showStatus("You can import up to 100 borrowers per CSV.", "error");
        return;
      }

      setCsvFileName(file.name);
      setCsvBorrowers(borrowers);

      showStatus(
        `CSV loaded: ${borrowers.length} borrower${borrowers.length === 1 ? "" : "s"} ready for import.`,
        "success"
      );
    } catch (error) {
      showStatus("Error reading CSV: " + error.message, "error");
    }
  }

  function clearCsvImport() {
    setCsvFileName("");
    setCsvBorrowers([]);
    setImportResults([]);
  }

  async function handleBulkImportBorrowers() {
    if (csvBorrowers.length === 0) {
      showStatus("Please select a CSV file first.", "error");
      return;
    }

    const confirmImport = window.confirm(
      `Import ${csvBorrowers.length} borrower account${csvBorrowers.length === 1 ? "" : "s"}?`
    );

    if (!confirmImport) return;

    setImportingCsv(true);
    showStatus("", "");

    try {
      const bulkCreateBorrowers = httpsCallable(
        functions,
        "bulkCreateBorrowers"
      );

      const response = await bulkCreateBorrowers({
        borrowers: csvBorrowers,
      });

      const resultData = response.data || {};
      const created = resultData.created || 0;
      const failed = resultData.failed || 0;
      const results = Array.isArray(resultData.results)
        ? resultData.results
        : [];

      setImportResults(results);

      showStatus(
        `CSV import finished. Created: ${created}. Failed: ${failed}.`,
        failed > 0 ? "error" : "success"
      );

      fetchData();
    } catch (error) {
      showStatus("Error importing borrowers: " + error.message, "error");
    } finally {
      setImportingCsv(false);
    }
  }

  function getCategoryUsage(categoryId) {
    const normalizedCategoryId = normalizeText(categoryId);

    const itemCount = items.filter((item) => {
      const itemCategory = normalizeText(item.categoryId || item.category);
      return itemCategory === normalizedCategoryId;
    }).length;

    const adminCount = users.filter((user) => {
      const assigned = Array.isArray(user.assignedCategories)
        ? user.assignedCategories.map(normalizeText)
        : [];

      return (
        user.role === "categoryAdmin" &&
        assigned.includes(normalizedCategoryId)
      );
    }).length;

    const requestCount = borrowRequests.filter((request) => {
      const requestCategory = normalizeText(
        request.categoryId || request.category
      );

      return requestCategory === normalizedCategoryId;
    }).length;

    return {
      itemCount,
      adminCount,
      requestCount,
      canDelete: itemCount === 0 && adminCount === 0 && requestCount === 0,
    };
  }

  useEffect(() => {
    fetchData();
  }, []);

  const filteredUsers = users.filter((user) => {
    const searchableText = `
      ${user.fullName || ""}
      ${user.email || ""}
      ${user.role || ""}
      ${formatAssignedCategories(user.assignedCategories)}
      ${user.suspensionReason || ""}
    `.toLowerCase();

    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "All" || user.role === roleFilter;

    return matchesSearch && matchesRole;
  });

  const userStats = useMemo(
    () => ({
      total: users.length,
      borrowers: users.filter((user) => user.role === "borrower").length,
      categoryAdmins: users.filter((user) => user.role === "categoryAdmin")
        .length,
      superAdmins: users.filter((user) => user.role === "superAdmin").length,
      suspended: users.filter(
        (user) => user.canBorrow === false || isUserSuspended(user)
      ).length,
    }),
    [users]
  );

  if (loading) {
    return (
      <div className="user-management-loading">
        <div className="user-management-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading users...</h2>
          <p>Checking QBorrow account records.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="user-management-page">
      <section className="user-management-header">
        <div>
          <p className="qb-kicker">Super Admin Control</p>

          <h1>User Management</h1>

          <p>
            Create assigned accounts, manage dynamic categories, import borrower
            CSV files, and delete borrower/category admin accounts properly.
          </p>
        </div>

        <button
          type="button"
          className="user-secondary-btn"
          onClick={() => window.history.back()}
        >
          Back
        </button>
      </section>

      {statusMessage && (
        <div
          className={`user-management-status user-management-status-${statusType}`}
          role="status"
        >
          {statusMessage}
        </div>
      )}

      <section className="user-summary-grid">
        <div>
          <span>Σ</span>
          <h3>{userStats.total}</h3>
          <p>Loaded Users</p>
        </div>

        <div>
          <span>B</span>
          <h3>{userStats.borrowers}</h3>
          <p>Borrowers</p>
        </div>

        <div>
          <span>C</span>
          <h3>{userStats.categoryAdmins}</h3>
          <p>Category Admins</p>
        </div>

        <div>
          <span>S</span>
          <h3>{userStats.superAdmins}</h3>
          <p>Super Admins</p>
        </div>

        <div>
          <span>!</span>
          <h3>{userStats.suspended}</h3>
          <p>Suspended</p>
        </div>
      </section>

      <section className="user-management-layout">
        <div className="user-left-stack">
          <section className="user-create-card">
            <div className="user-section-heading">
              <h2>Create User</h2>
              <p>
                Use a temporary password. The user can login using the assigned
                email and password.
              </p>
            </div>

            <form onSubmit={handleCreateUser}>
              <div className="user-field">
                <label className="qb-label" htmlFor="full-name">
                  Full Name
                </label>

                <input
                  id="full-name"
                  type="text"
                  placeholder="Example: Juan Dela Cruz"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div className="user-field">
                <label className="qb-label" htmlFor="email">
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  placeholder="example@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="user-field">
                <label className="qb-label" htmlFor="temporary-password">
                  Temporary Password
                </label>

                <input
                  id="temporary-password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={temporaryPassword}
                  onChange={(e) => setTemporaryPassword(e.target.value)}
                />
              </div>

              <div className="user-field">
                <label className="qb-label" htmlFor="role">
                  Role
                </label>

                <select
                  id="role"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value);

                    if (e.target.value !== "categoryAdmin") {
                      setAssignedCategories([]);
                    }
                  }}
                >
                  <option value="borrower">Borrower</option>
                  <option value="categoryAdmin">Category Admin / Mini Admin</option>
                  <option value="superAdmin">Super Admin</option>
                </select>
              </div>

              {role === "categoryAdmin" && (
                <div className="user-category-box">
                  <span>Assigned Categories</span>

                  {categories.length === 0 ? (
                    <p className="user-small-note">
                      No categories yet. Seed defaults or add a category first.
                    </p>
                  ) : (
                    <div className="user-category-grid">
                      {categories.map((category) => (
                        <label key={category.id}>
                          <input
                            type="checkbox"
                            checked={assignedCategories.includes(category.id)}
                            onChange={() => handleCategoryToggle(category.id)}
                          />
                          <span>{category.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                className="user-primary-btn"
                disabled={creating}
              >
                {creating ? "Creating..." : "Create User"}
              </button>
            </form>
          </section>

          <section className="user-admin-card">
            <div className="user-section-heading">
              <h2>Categories</h2>
              <p>
                Add flexible categories. Delete is allowed only when unused by
                items, admins, and borrow requests.
              </p>
            </div>

            <button
              type="button"
              className="user-secondary-btn user-full-btn"
              onClick={handleSeedCategories}
              disabled={categoryAction === "seed"}
            >
              {categoryAction === "seed"
                ? "Seeding..."
                : "Seed Default Categories"}
            </button>

            <form className="user-category-add-form" onSubmit={handleAddCategory}>
              <div className="user-field">
                <label className="qb-label" htmlFor="new-category">
                  New Category
                </label>

                <input
                  id="new-category"
                  type="text"
                  placeholder="Example: Audio Visual Items"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                />
              </div>

              <button
                type="submit"
                className="user-primary-btn"
                disabled={categoryAction === "add"}
              >
                {categoryAction === "add" ? "Adding..." : "Add Category"}
              </button>
            </form>

            <div className="user-category-toggle-row">
              <button
                type="button"
                className="user-secondary-btn user-category-toggle-btn"
                onClick={() => setShowCategoryList((current) => !current)}
              >
                {showCategoryList
                  ? "Hide Categories"
                  : `View Categories (${categories.length})`}
                <span>{showCategoryList ? "▲" : "▼"}</span>
              </button>
            </div>

            {showCategoryList && (
              <div className="user-category-list">
                {categories.length === 0 ? (
                  <div className="user-category-empty">No categories yet.</div>
                ) : (
                  categories.map((category) => {
                    const usage = getCategoryUsage(category.id);

                    return (
                      <article className="user-category-row" key={category.id}>
                        <div className="user-category-row-main">
                          <div>
                            <strong>{category.name}</strong>
                            <span>{category.id}</span>
                          </div>

                          <button
                            type="button"
                            className={
                              usage.canDelete
                                ? "user-danger-btn"
                                : "user-secondary-btn"
                            }
                            onClick={() => handleDeleteCategory(category)}
                            disabled={
                              !usage.canDelete ||
                              categoryAction === category.id
                            }
                          >
                            {categoryAction === category.id
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </div>

                        <div className="user-category-counts">
                          <span>{usage.itemCount} item</span>
                          <span>{usage.adminCount} admin</span>
                          <span>{usage.requestCount} request</span>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            )}
          </section>

          <section className="user-admin-card">
            <div className="user-section-heading">
              <h2>Import Borrowers</h2>
              <p>
                CSV must include Name, Email, and Password. Passwords are used
                only to create accounts.
              </p>
            </div>

            <div className="user-field">
              <label className="qb-label" htmlFor="borrower-csv">
                Borrower CSV
              </label>

              <input
                id="borrower-csv"
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvChange}
              />
            </div>

            {csvFileName && (
              <div className="user-csv-preview">
                <strong>{csvFileName}</strong>
                <span>{csvBorrowers.length} borrower rows ready</span>
              </div>
            )}

            <div className="user-csv-actions">
              <button
                type="button"
                className="user-primary-btn"
                onClick={handleBulkImportBorrowers}
                disabled={importingCsv || csvBorrowers.length === 0}
              >
                {importingCsv ? "Importing..." : "Import CSV"}
              </button>

              <button
                type="button"
                className="user-secondary-btn"
                onClick={clearCsvImport}
                disabled={importingCsv}
              >
                Clear
              </button>
            </div>

            {importResults.length > 0 && (
              <div className="user-import-results">
                {importResults.slice(0, 8).map((result, index) => (
                  <div
                    key={`${result.email}-${index}`}
                    className={result.success ? "success" : "failed"}
                  >
                    <strong>{result.email || "No email"}</strong>
                    <span>{result.message}</span>
                  </div>
                ))}

                {importResults.length > 8 && (
                  <p>Showing first 8 results only.</p>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="user-list-card">
          <div className="user-section-heading">
            <h2>Existing Users</h2>

            <p>
              Showing {filteredUsers.length} of {users.length} loaded account
              {users.length === 1 ? "" : "s"}.
              {hasMoreUsers ? " Load more to view additional users." : ""}
            </p>
          </div>

          <div className="user-tools">
            <div>
              <label className="qb-label" htmlFor="user-search">
                Search Users
              </label>

              <input
                id="user-search"
                type="text"
                placeholder="Search name, email, role, category..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>

            <div>
              <label className="qb-label" htmlFor="user-role-filter">
                Role
              </label>

              <select
                id="user-role-filter"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
              >
                <option value="All">All Roles</option>
                <option value="borrower">Borrower</option>
                <option value="categoryAdmin">Category Admin</option>
                <option value="superAdmin">Super Admin</option>
              </select>
            </div>

            <button
              type="button"
              className="user-refresh-btn"
              onClick={fetchData}
            >
              Refresh
            </button>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="user-empty">
              <img src="/qborrow-logo.png" alt="QBorrow Logo" />
              <h2>No users found</h2>
              <p>Try changing your search or role filter.</p>
            </div>
          ) : (
            <>
              <div className="user-grid">
                {filteredUsers.map((user) => {
                  const isEditing = editingUserId === user.id;

                  return (
                    <article className="user-card" key={user.id}>
                      <div className="user-card-topline">
                        <span>{user.email}</span>

                        <strong className={`role-${user.role || "borrower"}`}>
                          {getRoleLabel(user.role)}
                        </strong>
                      </div>

                      <h3>{user.fullName || "No name"}</h3>

                      <div className="user-info-grid">
                        <div>
                          <span>Assigned Categories</span>
                          <strong>
                            {formatAssignedCategories(user.assignedCategories)}
                          </strong>
                        </div>

                        <div>
                          <span>Overdue Count</span>
                          <strong>{user.overdueCount || 0}</strong>
                        </div>

                        <div>
                          <span>Can Borrow</span>
                          <strong>
                            {user.canBorrow === false ? "No" : "Yes"}
                          </strong>
                        </div>

                        <div>
                          <span>Suspended Until</span>
                          <strong>
                            {formatSuspendedUntil(user.suspendedUntil)}
                          </strong>
                        </div>
                      </div>

                      {user.suspensionReason && (
                        <div className="user-suspension-note">
                          <span>Suspension Reason</span>
                          <p>{user.suspensionReason}</p>
                        </div>
                      )}

                      {isEditing && (
                        <div className="user-edit-panel">
                          <div className="user-field">
                            <label className="qb-label">Edit Role</label>

                            <select
                              value={editRole}
                              onChange={(e) => {
                                setEditRole(e.target.value);

                                if (e.target.value !== "categoryAdmin") {
                                  setEditAssignedCategories([]);
                                }
                              }}
                            >
                              <option value="borrower">Borrower</option>
                              <option value="categoryAdmin">
                                Category Admin / Mini Admin
                              </option>
                              <option value="superAdmin">Super Admin</option>
                            </select>
                          </div>

                          {editRole === "categoryAdmin" && (
                            <div className="user-category-box compact">
                              <span>Edit Assigned Categories</span>

                              {categories.length === 0 ? (
                                <p className="user-small-note">
                                  No categories available.
                                </p>
                              ) : (
                                <div className="user-category-grid">
                                  {categories.map((category) => (
                                    <label key={category.id}>
                                      <input
                                        type="checkbox"
                                        checked={editAssignedCategories.includes(
                                          category.id
                                        )}
                                        onChange={() =>
                                          handleEditCategoryToggle(category.id)
                                        }
                                      />
                                      <span>{category.name}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="user-actions">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className="user-primary-btn"
                              onClick={() => handleSaveUserChanges(user)}
                              disabled={updatingId === user.id}
                            >
                              {updatingId === user.id ? "Saving..." : "Save"}
                            </button>

                            <button
                              type="button"
                              className="user-secondary-btn"
                              onClick={cancelEditingUser}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="user-secondary-btn"
                              onClick={() => startEditingUser(user)}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              className={
                                user.canBorrow === false
                                  ? "user-primary-btn"
                                  : "user-warning-btn"
                              }
                              onClick={() => handleToggleBorrowing(user)}
                              disabled={updatingId === user.id}
                            >
                              {user.canBorrow === false
                                ? "Enable Borrowing"
                                : "Disable Borrowing"}
                            </button>

                            <button
                              type="button"
                              className="user-danger-btn"
                              onClick={() => handleResetSuspension(user)}
                              disabled={updatingId === user.id}
                            >
                              Reset Suspension
                            </button>

                            <button
                              type="button"
                              className="user-delete-btn"
                              onClick={() => handleDeleteUser(user)}
                              disabled={
                                updatingId === user.id ||
                                user.role === "superAdmin" ||
                                currentAdmin?.uid === user.id
                              }
                            >
                              {updatingId === user.id
                                ? "Deleting..."
                                : "Delete User"}
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {hasMoreUsers && (
                <div className="user-load-more-row">
                  <button
                    type="button"
                    className="user-secondary-btn"
                    onClick={handleLoadMoreUsers}
                    disabled={loadingMoreUsers}
                  >
                    {loadingMoreUsers ? "Loading..." : "Load More Users"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </section>
    </div>
  );
}

export default UserManagement;