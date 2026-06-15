import { useEffect, useMemo, useState } from "react";
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
} from "firebase/firestore";
import { db, secondaryAuth } from "../firebase/firebaseConfig";
import "../styles/UserManagement.css";

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [role, setRole] = useState("borrower");
  const [assignedCategories, setAssignedCategories] = useState([]);

  const [editingUserId, setEditingUserId] = useState("");
  const [editRole, setEditRole] = useState("borrower");
  const [editAssignedCategories, setEditAssignedCategories] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

  const defaultCategories = [
    { id: "sports", name: "Sports Items" },
    { id: "laboratory", name: "Laboratory Items" },
    { id: "stem", name: "STEM Items" },
    { id: "it", name: "IT Items" },
  ];

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function getCreatedTime(user) {
    if (user.createdAt?.toMillis) return user.createdAt.toMillis();
    if (user.createdAt?.seconds) return user.createdAt.seconds * 1000;
    return 0;
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

  async function fetchUsers() {
    setLoading(true);

    try {
      const usersSnapshot = await getDocs(collection(db, "users"));

      const userData = usersSnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .sort((a, b) => getCreatedTime(b) - getCreatedTime(a));

      setUsers(userData);
    } catch (error) {
      showStatus("Error loading users: " + error.message, "error");
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

    if (role === "categoryAdmin" && assignedCategories.length === 0) {
      showStatus("Please assign at least one category for category admin.", "error");
      return;
    }

    setCreating(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(
        secondaryAuth,
        email.trim(),
        temporaryPassword
      );

      const newUser = userCredential.user;

      await setDoc(doc(db, "users", newUser.uid), {
        fullName: fullName.trim(),
        email: email.trim(),
        role,

        assignedCategories:
          role === "categoryAdmin" ? assignedCategories : [],

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
      fetchUsers();
    } catch (error) {
      showStatus("Error creating user: " + error.message, "error");
    } finally {
      setCreating(false);
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
        assignedCategories:
          editRole === "categoryAdmin" ? editAssignedCategories : [],
        updatedAt: serverTimestamp(),
      });

      showStatus("User role and categories updated successfully.", "success");
      cancelEditingUser();
      fetchUsers();
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

      fetchUsers();
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
      fetchUsers();
    } catch (error) {
      showStatus("Error resetting suspension: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = users.filter((user) => {
    const searchableText = `
      ${user.fullName || ""}
      ${user.email || ""}
      ${user.role || ""}
      ${Array.isArray(user.assignedCategories) ? user.assignedCategories.join(" ") : ""}
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
      categoryAdmins: users.filter((user) => user.role === "categoryAdmin").length,
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
            Create assigned accounts, control roles, assign category admins, and
            manage borrower suspension records.
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
          <p>Total Users</p>
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

                <div className="user-category-grid">
                  {defaultCategories.map((category) => (
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

        <section className="user-list-card">
          <div className="user-section-heading">
            <h2>Existing Users</h2>
            <p>
              Showing {filteredUsers.length} of {users.length} account
              {users.length === 1 ? "" : "s"}.
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
              onClick={fetchUsers}
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
                          {Array.isArray(user.assignedCategories) &&
                          user.assignedCategories.length > 0
                            ? user.assignedCategories.join(", ")
                            : "None"}
                        </strong>
                      </div>

                      <div>
                        <span>Overdue Count</span>
                        <strong>{user.overdueCount || 0}</strong>
                      </div>

                      <div>
                        <span>Can Borrow</span>
                        <strong>{user.canBorrow === false ? "No" : "Yes"}</strong>
                      </div>

                      <div>
                        <span>Suspended Until</span>
                        <strong>{formatSuspendedUntil(user.suspendedUntil)}</strong>
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

                            <div className="user-category-grid">
                              {defaultCategories.map((category) => (
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
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

export default UserManagement;